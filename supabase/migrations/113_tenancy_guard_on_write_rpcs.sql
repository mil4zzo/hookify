-- Migration 113: guard de tenancy nas RPCs DEFINER de ESCRITA expostas ao PostgREST
--
-- ACHADO (revisao de 2026-08-19, mesma classe da migration 106 - so que em ESCRITA)
--   Seis funcoes SECURITY DEFINER de escrita aceitam p_user_id como parametro e
--   estavam executaveis por `authenticated` E `anon`, SEM guard. Qualquer portador
--   da publishable key podia, via PostgREST direto:
--     - gravar leadscore_values arbitrarios no silo de QUALQUER usuario
--       (batch_update_ad_metrics_enrichment) - corromper o MQL alheio;
--     - mexer nos arrays de pack_ids de ads alheios (batch_add/remove);
--     - roubar/derrubar leases de jobs alheios (claim/renew/release).
--   E get_admin_users_list devolvia e-mail + tier + meta_email de TODOS os
--   usuarios a qualquer authenticated/anon.
--
-- CORRECAO
--   - get_admin_users_list: REVOKE de anon/authenticated (backend chama com
--     service role; nenhum outro caller legitimo).
--   - As 6 de escrita: guard no corpo - auth.uid() NULO (service role, caminho
--     do backend p/ packs compartilhados) OU IGUAL a p_user_id. REVOKE so de
--     anon: os caminhos de DONO chamam com o JWT do usuario (JobTracker sem
--     service role, importer no sync proprio, delete_pack); revogar
--     authenticated os quebraria. O guard fecha a forja mantendo os callers.
--     batch_update_ad_metrics_enrichment tem catch-all (WHEN OTHERS) que
--     engoliria o RAISE - o handler re-lanca a violacao de tenancy.
--   Corpos gerados de pg_get_functiondef - nao e reescrita manual.

BEGIN;

CREATE OR REPLACE FUNCTION public.batch_update_ad_metrics_enrichment(p_user_id uuid, p_updates jsonb, p_pack_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$



DECLARE



  total_rows_updated int := 0;



  total_ids_sent     int := 0;



  existing_count     int := 0;



  in_pack_count      int := 0;



  all_ids            text[];



BEGIN
  -- Guard de tenancy (migration 113): caller autenticado so opera o PROPRIO
  -- silo; service role (auth.uid() nulo) passa - e o caminho do backend para
  -- operacoes de pack compartilhado (P3.3), que ja derivou o dono via
  -- resolve_pack_access antes de chegar aqui.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Forbidden: p_user_id must match auth.uid()';
  END IF;











  SELECT array_agg(id_val)



  INTO all_ids



  FROM jsonb_array_elements(p_updates) AS item,



  LATERAL jsonb_array_elements_text(item->'ids') AS id_val;







  total_ids_sent := coalesce(array_length(all_ids, 1), 0);







  WITH expanded AS (



    SELECT



      id_val AS id,



      CASE



        WHEN item ? 'leadscore_values'



          AND item->'leadscore_values' IS NOT NULL



          AND item->'leadscore_values' != 'null'::jsonb



          AND jsonb_array_length(item->'leadscore_values') > 0



        THEN ARRAY(



          SELECT v::numeric



          FROM jsonb_array_elements(item->'leadscore_values') AS v



        )



        ELSE NULL



      END AS leadscore_vals



    FROM jsonb_array_elements(p_updates) AS item,



    LATERAL jsonb_array_elements_text(item->'ids') AS id_val



  )



  UPDATE public.ad_metrics am



  SET



    leadscore_values = CASE



      WHEN e.leadscore_vals IS NOT NULL THEN e.leadscore_vals



      ELSE am.leadscore_values



    END,



    updated_at = now()



  FROM expanded e



  WHERE am.id = e.id



    AND am.user_id = p_user_id



    AND (



      p_pack_id IS NULL



      OR EXISTS (



        SELECT 1 FROM public.ad_metric_pack_map apm



        WHERE apm.user_id = am.user_id



          AND apm.ad_id = am.ad_id



          AND apm.metric_date = am.date



          AND apm.pack_id = p_pack_id



      )



    );







  GET DIAGNOSTICS total_rows_updated = ROW_COUNT;







  IF total_ids_sent > 0 THEN



    SELECT



      count(*)::int,



      count(*) FILTER (



        WHERE p_pack_id IS NULL



          OR EXISTS (



            SELECT 1 FROM public.ad_metric_pack_map apm2



            WHERE apm2.user_id = p_user_id



              AND apm2.ad_id = am_diag.ad_id



              AND apm2.metric_date = am_diag.date



              AND apm2.pack_id = p_pack_id



          )



      )::int



    INTO existing_count, in_pack_count



    FROM public.ad_metrics am_diag



    WHERE user_id = p_user_id AND id = ANY(all_ids);



  END IF;







  RETURN jsonb_build_object(



    'total_groups_processed', jsonb_array_length(p_updates),



    'total_rows_updated',     total_rows_updated,



    'total_ids_sent',         total_ids_sent,



    'ids_not_found_count',    greatest(0, total_ids_sent - existing_count),



    'ids_out_of_pack_count',  greatest(0, existing_count - in_pack_count),



    'status',                 'success'



  );



EXCEPTION



  WHEN OTHERS THEN
    IF SQLERRM LIKE 'Forbidden: p_user_id%' THEN RAISE; END IF;



    RETURN jsonb_build_object(



      'status',                 'error',



      'error_message',          SQLERRM,



      'total_groups_processed', jsonb_array_length(p_updates),



      'total_rows_updated',     total_rows_updated,



      'total_ids_sent',         total_ids_sent,



      'ids_not_found_count',    0,



      'ids_out_of_pack_count',  0



    );



END;



$function$;

CREATE OR REPLACE FUNCTION public.batch_add_pack_id_to_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$



DECLARE



  updated_count int := 0;



BEGIN
  -- Guard de tenancy (migration 113): caller autenticado so opera o PROPRIO
  -- silo; service role (auth.uid() nulo) passa - e o caminho do backend para
  -- operacoes de pack compartilhado (P3.3), que ja derivou o dono via
  -- resolve_pack_access antes de chegar aqui.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Forbidden: p_user_id must match auth.uid()';
  END IF;











  IF p_table_name NOT IN ('ads', 'ad_metrics') THEN



    RAISE EXCEPTION 'Tabela inválida: %. Use "ads" ou "ad_metrics"', p_table_name;



  END IF;







  IF p_table_name = 'ads' THEN



    UPDATE public.ads



    SET



      pack_ids = CASE



        WHEN p_pack_id = ANY(COALESCE(pack_ids, ARRAY[]::uuid[])) THEN COALESCE(pack_ids, ARRAY[]::uuid[])



        ELSE array_append(COALESCE(pack_ids, ARRAY[]::uuid[]), p_pack_id)



      END,



      updated_at = now()



    WHERE user_id = p_user_id



      AND ad_id = ANY(p_ids_to_update);







    GET DIAGNOSTICS updated_count = ROW_COUNT;



  ELSE



    UPDATE public.ad_metrics



    SET



      pack_ids = CASE



        WHEN p_pack_id = ANY(COALESCE(pack_ids, ARRAY[]::uuid[])) THEN COALESCE(pack_ids, ARRAY[]::uuid[])



        ELSE array_append(COALESCE(pack_ids, ARRAY[]::uuid[]), p_pack_id)



      END,



      updated_at = now()



    WHERE user_id = p_user_id



      AND id = ANY(p_ids_to_update);







    GET DIAGNOSTICS updated_count = ROW_COUNT;



  END IF;







  RETURN jsonb_build_object(



    'rows_updated', updated_count,



    'status', 'success'



  );



EXCEPTION



  WHEN OTHERS THEN
    IF SQLERRM LIKE 'Forbidden: p_user_id%' THEN RAISE; END IF;



    RETURN jsonb_build_object(



      'status', 'error',



      'error_message', SQLERRM,



      'rows_updated', 0



    );



END;



$function$;

CREATE OR REPLACE FUNCTION public.batch_remove_pack_id_from_arrays(p_user_id uuid, p_pack_id uuid, p_table_name text, p_ids_to_update text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$



DECLARE



  updated_count int;



BEGIN
  -- Guard de tenancy (migration 113): caller autenticado so opera o PROPRIO
  -- silo; service role (auth.uid() nulo) passa - e o caminho do backend para
  -- operacoes de pack compartilhado (P3.3), que ja derivou o dono via
  -- resolve_pack_access antes de chegar aqui.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Forbidden: p_user_id must match auth.uid()';
  END IF;











  -- Validar tabela



  IF p_table_name NOT IN ('ads', 'ad_metrics') THEN



    RAISE EXCEPTION 'Tabela inválida: %. Use "ads" ou "ad_metrics"', p_table_name;



  END IF;



  



  -- Atualizar ads



  IF p_table_name = 'ads' THEN



    UPDATE public.ads



    SET 



      pack_ids = array_remove(pack_ids, p_pack_id),



      updated_at = now()



    WHERE 



      user_id = p_user_id



      AND ad_id = ANY(p_ids_to_update)



      AND p_pack_id = ANY(pack_ids);



    



    GET DIAGNOSTICS updated_count = ROW_COUNT;



    



  -- Atualizar ad_metrics



  ELSIF p_table_name = 'ad_metrics' THEN



    UPDATE public.ad_metrics



    SET 



      pack_ids = array_remove(pack_ids, p_pack_id),



      updated_at = now()



    WHERE 



      user_id = p_user_id



      AND id = ANY(p_ids_to_update)



      AND p_pack_id = ANY(pack_ids);



    



    GET DIAGNOSTICS updated_count = ROW_COUNT;



  END IF;



  



  RETURN jsonb_build_object(



    'rows_updated', updated_count,



    'status', 'success'



  );



EXCEPTION



  WHEN OTHERS THEN
    IF SQLERRM LIKE 'Forbidden: p_user_id%' THEN RAISE; END IF;



    -- Retornar erro de forma estruturada



    RETURN jsonb_build_object(



      'status', 'error',



      'error_message', SQLERRM,



      'rows_updated', 0



    );



END;



$function$;

CREATE OR REPLACE FUNCTION public.claim_job_processing(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer DEFAULT 300)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$



DECLARE



  v_status text;



  v_claimed boolean := false;



BEGIN
  -- Guard de tenancy (migration 113): caller autenticado so opera o PROPRIO
  -- silo; service role (auth.uid() nulo) passa - e o caminho do backend para
  -- operacoes de pack compartilhado (P3.3), que ja derivou o dono via
  -- resolve_pack_access antes de chegar aqui.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Forbidden: p_user_id must match auth.uid()';
  END IF;











  UPDATE public.jobs



  SET



    status = CASE WHEN status = 'meta_completed' THEN 'processing' ELSE status END,



    message = CASE WHEN status = 'meta_completed' THEN 'Iniciando coleta de anúncios...' ELSE message END,



    processing_owner = p_owner,



    processing_claimed_at = now(),



    processing_lease_until = now() + make_interval(secs => GREATEST(p_lease_seconds, 30)),



    processing_attempts = COALESCE(processing_attempts, 0) + 1,



    updated_at = now()



  WHERE id = p_job_id



    AND user_id = p_user_id



    AND status IN ('meta_completed', 'processing', 'persisting')



    AND (



      status = 'meta_completed'



      OR processing_lease_until IS NULL



      OR processing_lease_until <= now()



      OR processing_owner = p_owner



    )



  RETURNING status INTO v_status;







  v_claimed := FOUND;







  RETURN jsonb_build_object(



    'claimed', v_claimed,



    'status', COALESCE(v_status, ''),



    'owner', CASE WHEN v_claimed THEN p_owner ELSE NULL END



  );



END;



$function$;

CREATE OR REPLACE FUNCTION public.renew_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text, p_lease_seconds integer DEFAULT 300)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$



DECLARE



  v_renewed boolean := false;



BEGIN
  -- Guard de tenancy (migration 113): caller autenticado so opera o PROPRIO
  -- silo; service role (auth.uid() nulo) passa - e o caminho do backend para
  -- operacoes de pack compartilhado (P3.3), que ja derivou o dono via
  -- resolve_pack_access antes de chegar aqui.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Forbidden: p_user_id must match auth.uid()';
  END IF;











  UPDATE public.jobs



  SET



    processing_lease_until = now() + make_interval(secs => GREATEST(p_lease_seconds, 30)),



    updated_at = now()



  WHERE id = p_job_id



    AND user_id = p_user_id



    AND processing_owner = p_owner



    AND status IN ('processing', 'persisting');







  v_renewed := FOUND;







  RETURN jsonb_build_object(



    'renewed', v_renewed



  );



END;



$function$;

CREATE OR REPLACE FUNCTION public.release_job_processing_lease(p_job_id text, p_user_id uuid, p_owner text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$



DECLARE



  v_released boolean := false;



BEGIN
  -- Guard de tenancy (migration 113): caller autenticado so opera o PROPRIO
  -- silo; service role (auth.uid() nulo) passa - e o caminho do backend para
  -- operacoes de pack compartilhado (P3.3), que ja derivou o dono via
  -- resolve_pack_access antes de chegar aqui.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Forbidden: p_user_id must match auth.uid()';
  END IF;











  UPDATE public.jobs



  SET



    processing_owner = NULL,



    processing_claimed_at = NULL,



    processing_lease_until = NULL,



    updated_at = now()



  WHERE id = p_job_id



    AND user_id = p_user_id



    AND processing_owner = p_owner;







  v_released := FOUND;







  RETURN jsonb_build_object(



    'released', v_released



  );



END;



$function$;

-- get_admin_users_list: so service role
REVOKE ALL ON FUNCTION public.get_admin_users_list() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_users_list() FROM anon;
REVOKE ALL ON FUNCTION public.get_admin_users_list() FROM authenticated;

-- anon fora de TODAS as 6 (nenhum caller anonimo legitimo); authenticated mantem
DO $revoke$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'batch_update_ad_metrics_enrichment', 'batch_add_pack_id_to_arrays',
        'batch_remove_pack_id_from_arrays', 'claim_job_processing',
        'renew_job_processing_lease', 'release_job_processing_lease'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn.sig);
  END LOOP;
END
$revoke$;

DO $post$
DECLARE
  v_sem_guard text;
  v_anon text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_sem_guard
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN (
      'batch_update_ad_metrics_enrichment', 'batch_add_pack_id_to_arrays',
      'batch_remove_pack_id_from_arrays', 'claim_job_processing',
      'renew_job_processing_lease', 'release_job_processing_lease'
    )
    AND p.prosrc NOT LIKE '%Forbidden: p_user_id must match auth.uid()%';
  IF v_sem_guard IS NOT NULL THEN
    RAISE EXCEPTION 'ABORTADO: sem guard: %', v_sem_guard;
  END IF;

  SELECT string_agg(p.proname, ', ') INTO v_anon
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN (
      'batch_update_ad_metrics_enrichment', 'batch_add_pack_id_to_arrays',
      'batch_remove_pack_id_from_arrays', 'claim_job_processing',
      'renew_job_processing_lease', 'release_job_processing_lease',
      'get_admin_users_list'
    )
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_anon IS NOT NULL THEN
    RAISE EXCEPTION 'ABORTADO: anon ainda executa: %', v_anon;
  END IF;
END
$post$;

COMMIT;

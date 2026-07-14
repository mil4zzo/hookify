-- 096: elimina os statement timeouts intermitentes (57014) do Manager.
--
-- Causa raiz medida em produção (2026-07-13): o plan cache do Postgres troca
-- o custom plan por um GENERIC plan a partir da 6ª execução da RPC na mesma
-- conexão (e o PostgREST mantém conexões persistentes). As RPCs analíticas
-- dependem de constant-folding dos parâmetros opcionais ("p_x is null or ...",
-- "case when v_group_by = ..."), que só acontece no custom plan.
--
-- Medição (fetch_manager_rankings_core_v2, 4 packs, 75 dias, group_by=ad_id,
-- mesma sessão, mesmos parâmetros):
--   exec 1..5  →    ~860 ms  (custom plan)
--   exec 6     → 233.814 ms  (generic plan, 273x) → 57014 sob timeout de 30s
--   com plan_cache_mode=force_custom_plan → 10/10 execuções em ~860 ms
--
-- O custo do force_custom_plan é replanejar a cada chamada (dezenas de ms) —
-- irrelevante perto do cliff que ele elimina.

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as ident
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'fetch_manager_rankings_core_v2_base_v093',
        'fetch_manager_rankings_series_v2',
        'fetch_manager_rankings_retention_v2',
        'fetch_manager_analytics_aggregated_base_v047',
        'fetch_manager_analytics_aggregated_base_v048',
        'fetch_manager_analytics_aggregated_base_v049',
        'fetch_ad_metrics_for_analytics',
        'batch_update_ad_metrics_enrichment'
      )
  loop
    execute format('alter function %s set plan_cache_mode = force_custom_plan', fn.ident);
    raise notice 'plan_cache_mode=force_custom_plan aplicado em %', fn.ident;
  end loop;
end $$;

-- diagnose_manager_rpc_timing está defasada em relação à RPC real: filtra pack
-- por am.pack_ids && p_pack_ids, enquanto a core_v2 usa EXISTS contra
-- ad_metric_pack_map — ela mede uma query que não existe mais. Fora de uso.
drop function if exists public.diagnose_manager_rpc_timing(uuid, date, date, text, uuid[]);

-- Migration 112: detect_pack_conflicts — camada 1 do bloqueio de conflito
--
-- CONTEXTO (plano aprovado em 2026-08-18)
--   Selecionar juntos dois packs de DONOS diferentes que contem o mesmo anuncio
--   no mesmo dia forca o dedup cross-silo (v104/v105) a escolher uma das duas
--   linhas — e o total deixa de ser exato. Decisao de produto: "impreciso e
--   impreciso" — nao se avisa com porcentagem, BLOQUEIA-SE.
--
--   Tres camadas:
--     1. PREVENIR (esta migration): a UI desabilita, na selecao, os packs que
--        conflitam com os ja selecionados. Esta funcao fornece o grafo.
--     2. SINAL (migration 105): a RPC conta as linhas dedupadas e emite
--        `overlap` no payload — rede de seguranca no read-path.
--     3. EXPLICAR (frontend): se o estado ruim ainda ocorrer (pack mudou apos a
--        selecao), a area de analise vira um bloqueio com "Desmarcar «X»".
--
-- SO CROSS-SILO. Dois packs do MESMO dono compartilhando anuncios e um estado
-- normal do produto (mesma linha fisica, nenhuma imprecisao) — decisao de
-- 2026-08-18 de deixar como esta. Por isso `a.owner_id <> b.owner_id`.
--
-- FORMA DA QUERY
--   - Acesso via resolve_pack_access: pack inacessivel nao entra no grafo, e o
--     dono esta SEMPRE amarrado nos dois lados do EXISTS — e o que liga as 4
--     colunas de ad_metric_pack_map_user_pack_date_ad_idx (a licao dos 67ms ->
--     4010ms da P3.2 vale aqui tambem).
--   - EXISTS, nao COUNT: interessa SE conflita, nao quanto. Para no 1o match.
--   - Pior caso medido (2 packs de ~40k linhas de donos diferentes, ZERO
--     overlap): ~218ms frio. Com match, para muito antes.
--
-- Uma linha por par NAO-ordenado (pack_a < pack_b por uuid).

BEGIN;

CREATE OR REPLACE FUNCTION public.detect_pack_conflicts(
  p_pack_ids uuid[],
  p_actor_id uuid
) RETURNS TABLE(pack_a uuid, pack_b uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $fn$
  with acc as (
    select a.pack_id, a.owner_id
    from public.resolve_pack_access(p_pack_ids, p_actor_id) a
  )
  select a.pack_id as pack_a, b.pack_id as pack_b
  from acc a
  join acc b
    on a.owner_id <> b.owner_id      -- so cross-silo; mesmo dono nunca conflita
   and a.pack_id < b.pack_id         -- cada par nao-ordenado uma vez
  where exists (
    select 1
    from public.ad_metric_pack_map ma
    join public.ad_metric_pack_map mb
      on mb.user_id = b.owner_id
     and mb.pack_id = b.pack_id
     and mb.metric_date = ma.metric_date
     and mb.ad_id = ma.ad_id
    where ma.user_id = a.owner_id
      and ma.pack_id = a.pack_id
  );
$fn$;

COMMENT ON FUNCTION public.detect_pack_conflicts(uuid[], uuid) IS
  'Pares de packs ACESSIVEIS ao ator (proprios ou compartilhados) que compartilham ao menos um (ad_id, metric_date) entre DONOS diferentes. Alimenta o bloqueio de selecao (camada 1). Mesmo dono nunca conflita. Helper interno — nao exposto ao PostgREST.';

REVOKE ALL ON FUNCTION public.detect_pack_conflicts(uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.detect_pack_conflicts(uuid[], uuid) FROM anon;
REVOKE ALL ON FUNCTION public.detect_pack_conflicts(uuid[], uuid) FROM authenticated;

-- ---------------------------------------------------------------------------
-- Pos-condicao
-- ---------------------------------------------------------------------------
DO $post$
DECLARE
  v_ok integer;
BEGIN
  SELECT count(*) INTO v_ok
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'detect_pack_conflicts'
    AND p.prosecdef
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE');

  IF v_ok <> 1 THEN
    RAISE EXCEPTION 'ABORTADO: detect_pack_conflicts ausente, sem SECURITY DEFINER ou exposta a authenticated.';
  END IF;
END
$post$;

COMMIT;

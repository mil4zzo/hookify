-- ===========================================================================
-- 146. detect_pack_conflicts: sem pre-filtro por metadado, e com folga de tempo.
--
-- A 145 tirou a excecao de "mesmo dono" (certo: desde ela cada pack tem a sua
-- linha, entao dois packs com o mesmo anuncio no mesmo dia contariam o dia duas
-- vezes). Mas trocou o par-a-par por um pre-filtro tirado dos METADADOS do pack
-- (adaccount_id + date_start/date_stop). Esse pre-filtro nao e seguro: em
-- producao ha 847 linhas do mapa fora da janela declarada do proprio pack e 75
-- com anuncio fora do ad_ids do pack. Um par assim seria descartado antes do
-- teste real — conflito verdadeiro passando batido, que e exatamente o erro que
-- a 145 existia para acabar.
--
-- Aqui o pertencimento volta a ser lido do DADO: uma varredura agrupada do mapa
-- (indice cobrindo user_id, pack_id, metric_date, ad_id) que acha os (anuncio,
-- dia) presentes em mais de um pack do escopo. Nao ha filtro que possa esconder
-- par: ou o dia e compartilhado no mapa, ou nao e.
--
-- Custo medido em producao (37 packs, 687 mil linhas do mapa):
--   par-a-par com pre-filtro inseguro ... 3,0 s
--   varredura agrupada .................. 2,4 s frio / 1,3 s morno
-- Como o papel de servico do PostgREST herda statement_timeout de 8 s do
-- authenticator, a funcao carrega a sua propria folga: 25 s. Sem isso, um pico
-- de carga derruba a rota com 500 e a UI perde o grafo de conflito.
-- ===========================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.detect_pack_conflicts(p_pack_ids uuid[], p_actor_id uuid) RETURNS TABLE(pack_a uuid, pack_b uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '25s'
    AS $$
  with acc as (
    select a.pack_id, a.owner_id
    from public.resolve_pack_access(p_pack_ids, p_actor_id) a
  ),
  scoped as (
    select m.pack_id, m.ad_id, m.metric_date
    from acc a
    join public.ad_metric_pack_map m
      on m.user_id = a.owner_id
     and m.pack_id = a.pack_id
  ),
  dup as (
    -- (user_id, pack_id, ad_id, metric_date) e a PK do mapa, entao count(*) > 1
    -- num grupo (ad_id, metric_date) ja significa "mais de um pack".
    select ad_id, metric_date, array_agg(pack_id) as packs
    from scoped
    group by ad_id, metric_date
    having count(*) > 1
  )
  select distinct p1 as pack_a, p2 as pack_b
  from dup, unnest(packs) p1, unnest(packs) p2
  where p1 < p2;
$$;

COMMENT ON FUNCTION public.detect_pack_conflicts(uuid[], uuid) IS
  'Pares de packs acessiveis ao ator que compartilham ao menos um (ad_id, dia) — qualquer dono, desde a 145. Le o pertencimento do mapa, sem pre-filtro por metadado do pack: janela e ad_ids do pack podem estar defasados do mapa e esconderiam conflito real (146). statement_timeout proprio de 25s porque o papel de servico do PostgREST so tem 8s.';

COMMIT;

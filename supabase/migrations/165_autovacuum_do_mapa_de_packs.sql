-- ===========================================================================
-- 165 — Autovacuum mais frequente em `ad_metric_pack_map` (Bloco 4 do plano pós-157)
-- ===========================================================================
--
-- MEDIDO EM 16/09/2026 (`detect_pack_conflicts`, 38 packs do Igor, 0 conflitos):
--   antes do VACUUM: 0% das páginas do mapa marcadas como visíveis; 156.580 idas à
--     tabela por chamada; 0,45 s (4,8 s com cache frio);
--   depois:          100% marcadas; 0 idas à tabela; 0,375 s.
-- A marca só é posta pelo VACUUM, e o padrão (20% da tabela alterada) a deixou zerada
-- por dias — o mapa é reescrito a cada refresh de pack. Mesmo ajuste da 163.
--
-- TESTADO E DESCARTADO: `SET work_mem TO '16MB'` na função tira do disco a ordenação
-- de 7 MB, mas o tempo mudou ~20 ms (353–375 contra 380–422 ms) — ruído. Não entra
-- (como na v157, que já tinha testado e descartado).
--
-- VOLTA ATRÁS: `ALTER TABLE public.ad_metric_pack_map RESET
-- (autovacuum_vacuum_scale_factor, autovacuum_vacuum_insert_scale_factor,
-- autovacuum_analyze_scale_factor)`.
-- ===========================================================================

BEGIN;

ALTER TABLE public.ad_metric_pack_map SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.05
);

DO $$
DECLARE
  v_opts text[];
BEGIN
  SELECT reloptions INTO v_opts FROM pg_class WHERE oid = 'public.ad_metric_pack_map'::regclass;
  IF v_opts IS NULL
     OR NOT ('autovacuum_vacuum_scale_factor=0.02' = ANY(v_opts))
     OR NOT ('autovacuum_vacuum_insert_scale_factor=0.02' = ANY(v_opts)) THEN
    RAISE EXCEPTION '165: ad_metric_pack_map sem o ajuste de autovacuum. reloptions=%', v_opts;
  END IF;
END;
$$;

COMMIT;

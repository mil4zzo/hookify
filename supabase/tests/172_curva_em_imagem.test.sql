-- ===========================================================================
-- Teste da migration 172 — a curva de retenção segue a regra de imagem
-- ===========================================================================
--
-- A curva do Manager tem função própria (`fetch_manager_rankings_retention_v2`), que o
-- backend chama direto. Ela lia `ad_metrics` cru: a Meta manda curva até em anúncio de
-- imagem (82 anúncios / 453 linhas-dia na cópia de produção), e a curva saía.
--
-- R1. Nome só de IMAGEM: curva vazia.
-- R2. Nome MISTURADO (vídeo + estático): a curva é a do VÍDEO, ponto a ponto — nem
--     contaminada nem apagada.
-- R3. Nome de VÍDEO: intacto (a regra não encosta em quem é vídeo).
-- R4. Formato DESCONHECIDO não é imagem: mantém a curva.
--
-- Cada asserção vem pareada com a mesma conta pela v2, que TEM de dar o número
-- contaminado — senão o teste passaria sem a migration.
--
-- COMO RODAR (só no laboratório, com a 172 aplicada)
--   psql -d hookify_lab -X -v ON_ERROR_STOP=1 -f supabase/tests/172_curva_em_imagem.test.sql
-- ===========================================================================

BEGIN;

CREATE FUNCTION pg_temp.expect(rotulo text, obtido text, esperado text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF obtido IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION 'FALHOU %: obtido=% esperado=%', rotulo, left(obtido, 400), left(esperado, 400);
  END IF;
END $$;

\set u  '''00000000-0000-4000-8000-000000000172'''
\set p  '''11111111-1111-4111-8111-000000001721'''

INSERT INTO auth.users (id) VALUES (:u::uuid) ON CONFLICT DO NOTHING;

INSERT INTO public.packs (id, user_id, name, level, adaccount_id, date_start, date_stop, ad_ids) VALUES
  (:p::uuid, :u::uuid, 'lab 172 curva', 'ad', 'act_172', '2026-09-01', '2026-09-02', ARRAY[]::text[]);

INSERT INTO public.ads (ad_id, user_id, ad_name, account_id, adset_id, adset_name, campaign_id, campaign_name,
                        effective_status, media_type)
SELECT x.ad_id, :u::uuid, x.nome, 'act_172', 's172', 'Conj 172', 'c172', 'Camp 172', 'ACTIVE', x.mt
FROM (VALUES
  ('t172-v1', 'Misto',       'video'),
  ('t172-i1', 'Misto',       'image'),     -- a mesma peça como estático, com curva espúria
  ('t172-i2', 'So imagem',   'image'),
  ('t172-u1', 'Sem formato', 'unknown')
) AS x(ad_id, nome, mt);

-- Curvas distintas de propósito: a do vídeo cai 100→50→25; as das imagens ficam em 100.
-- Se a curva da imagem entrar na média ponderada, o ponto 2 do nome misto sobe.
INSERT INTO public.ad_metrics (id, user_id, pack_id, ad_id, date, ad_name, account_id, campaign_id, campaign_name,
    adset_id, adset_name, spend, impressions, clicks, inline_link_clicks, lpv, reach, frequency,
    video_total_plays, video_total_thruplays, hook_rate, video_play_curve_actions)
SELECT '2026-09-0' || d || '-' || a.ad_id, :u::uuid, :p::uuid, a.ad_id, ('2026-09-0' || d)::date, n.nome,
       'act_172', 'c172', 'Camp 172', 's172', 'Conj 172',
       10, 1000, 10, 8, 5, 1000, 1.0, a.plays, 10, 0.5, a.curva::jsonb
FROM (VALUES
  ('t172-v1', 1000, '[100, 50, 25]'),
  ('t172-i1',  100, '[100, 100, 100]'),
  ('t172-i2',   10, '[100, 100, 100]'),
  ('t172-u1',  500, '[100, 80, 60]')
) AS a(ad_id, plays, curva)
CROSS JOIN generate_series(1, 2) AS d
CROSS JOIN LATERAL (SELECT CASE a.ad_id WHEN 't172-v1' THEN 'Misto' WHEN 't172-i1' THEN 'Misto'
                                        WHEN 't172-i2' THEN 'So imagem' ELSE 'Sem formato' END AS nome) n;

CREATE FUNCTION pg_temp.curva(p_fn text, p_nome text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000172', 'role', 'authenticated')::text, true);
  EXECUTE format($q$
    SELECT public.%I('00000000-0000-4000-8000-000000000172'::uuid, '2026-09-01'::date, '2026-09-02'::date,
      'ad_name', ARRAY['11111111-1111-4111-8111-000000001721']::uuid[], null, null, null, null, %L) $q$, p_fn, p_nome)
  INTO r;
  RETURN (r -> 'video_play_curve_actions')::text;
END $$;

-- R1. Nome só de imagem: curva vazia (a v2 devolvia a curva espúria).
SELECT pg_temp.expect('R1.imagem-sem-curva',  pg_temp.curva('fetch_manager_rankings_retention_v172', 'So imagem'), '[]');
SELECT pg_temp.expect('R1.v2-tinha-curva',    pg_temp.curva('fetch_manager_rankings_retention_v2', 'So imagem'), '[100, 100, 100]');

-- R2. Nome misturado: a curva é a do vídeo. Pela v2, o ponto 2 sobe de 50 para 55
--     ((50×2000 + 100×200) / 2200 = 54,5 → 55) e o ponto 3, de 25 para 32.
SELECT pg_temp.expect('R2.misto-e-a-do-video', pg_temp.curva('fetch_manager_rankings_retention_v172', 'Misto'), '[100, 50, 25]');
SELECT pg_temp.expect('R2.v2-contaminada',     pg_temp.curva('fetch_manager_rankings_retention_v2', 'Misto'), '[100, 55, 32]');

-- R3/R4. Vídeo e formato desconhecido: intactos, e idênticos entre as duas versões.
SELECT pg_temp.expect('R4.desconhecido-intacto', pg_temp.curva('fetch_manager_rankings_retention_v172', 'Sem formato'), '[100, 80, 60]');
SELECT pg_temp.expect('R4.desconhecido-igual-na-v2',
  pg_temp.curva('fetch_manager_rankings_retention_v172', 'Sem formato'),
  pg_temp.curva('fetch_manager_rankings_retention_v2', 'Sem formato'));

DO $$ BEGIN RAISE NOTICE 'OK: 172 — curva em imagem, 6 checagens'; END $$;

ROLLBACK;

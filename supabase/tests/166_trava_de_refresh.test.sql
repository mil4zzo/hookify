-- Teste da 166: a trava de refresh e compare-and-set — so um adquire.
--
-- Sabotagens que TEM de fazer este teste falhar:
--   1. Tirar o "AND (refresh_status IS DISTINCT FROM 'running' OR ...)" -> falha em B
--   2. Trocar "< (now() AT TIME ZONE 'utc')" por ">"                     -> falha em C (e B)
--   3. Tirar "AND user_id = p_owner"                                       -> falha em E
\set ON_ERROR_STOP on
\timing off
BEGIN;

CREATE FUNCTION pg_temp.expect(rotulo text, obtido text, esperado text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF obtido IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION 'FALHOU %: obtido=% esperado=%', rotulo, obtido, esperado;
  END IF;
END $$;

-- Um pack real do laboratorio, deixado livre.
CREATE TEMP TABLE t_pack AS
SELECT id, user_id FROM public.packs ORDER BY updated_at DESC LIMIT 1;

UPDATE public.packs SET refresh_status = 'idle', refresh_lock_until = NULL, refresh_actor_id = NULL
WHERE id = (SELECT id FROM t_pack);

-- A. Livre: adquire, e o pack fica running com prazo e ator.
SELECT pg_temp.expect('A1 adquire livre',
  (SELECT public.pack_acquire_refresh_lock(user_id, id, '00000000-0000-4000-8000-000000000166'::uuid, 15)::text FROM t_pack),
  'true');
SELECT pg_temp.expect('A2 status',
  (SELECT p.refresh_status FROM public.packs p JOIN t_pack t ON t.id = p.id), 'running');
SELECT pg_temp.expect('A3 ator',
  (SELECT p.refresh_actor_id::text FROM public.packs p JOIN t_pack t ON t.id = p.id),
  '00000000-0000-4000-8000-000000000166');
SELECT pg_temp.expect('A4 prazo no futuro',
  (SELECT (p.refresh_lock_until > (now() AT TIME ZONE 'utc'))::text FROM public.packs p JOIN t_pack t ON t.id = p.id),
  'true');

-- B. Ocupado: a segunda tentativa (outro ator) NAO adquire e nao troca o ator.
SELECT pg_temp.expect('B1 segunda nao adquire',
  (SELECT public.pack_acquire_refresh_lock(user_id, id, '00000000-0000-4000-8000-000000000167'::uuid, 15)::text FROM t_pack),
  'false');
SELECT pg_temp.expect('B2 ator preservado',
  (SELECT p.refresh_actor_id::text FROM public.packs p JOIN t_pack t ON t.id = p.id),
  '00000000-0000-4000-8000-000000000166');

-- C. Prazo vencido (job que morreu): livre de novo, mesmo com status running.
UPDATE public.packs SET refresh_lock_until = (now() AT TIME ZONE 'utc') - interval '1 minute'
WHERE id = (SELECT id FROM t_pack);
SELECT pg_temp.expect('C1 prazo vencido adquire',
  (SELECT public.pack_acquire_refresh_lock(user_id, id, '00000000-0000-4000-8000-000000000167'::uuid, 15)::text FROM t_pack),
  'true');
SELECT pg_temp.expect('C2 novo ator',
  (SELECT p.refresh_actor_id::text FROM public.packs p JOIN t_pack t ON t.id = p.id),
  '00000000-0000-4000-8000-000000000167');

-- D. Status terminal libera (e o que update_pack_refresh_status grava ao terminar).
UPDATE public.packs SET refresh_status = 'success', refresh_lock_until = NULL, refresh_actor_id = NULL
WHERE id = (SELECT id FROM t_pack);
SELECT pg_temp.expect('D1 apos success adquire',
  (SELECT public.pack_acquire_refresh_lock(user_id, id, '00000000-0000-4000-8000-000000000166'::uuid, 15)::text FROM t_pack),
  'true');

-- E. Dono errado nunca adquire (nem com o pack livre).
UPDATE public.packs SET refresh_status = 'idle', refresh_lock_until = NULL, refresh_actor_id = NULL
WHERE id = (SELECT id FROM t_pack);
SELECT pg_temp.expect('E1 dono errado',
  (SELECT public.pack_acquire_refresh_lock('00000000-0000-4000-8000-000000000999'::uuid, id, user_id, 15)::text FROM t_pack),
  'false');
SELECT pg_temp.expect('E2 pack continua livre',
  (SELECT p.refresh_status FROM public.packs p JOIN t_pack t ON t.id = p.id), 'idle');

-- F. Pack inexistente: false, sem erro.
SELECT pg_temp.expect('F1 pack inexistente',
  (SELECT public.pack_acquire_refresh_lock(user_id, '00000000-0000-4000-8000-000000000000'::uuid, user_id, 15)::text FROM t_pack),
  'false');

SELECT 'OK: 12 asserções' AS resultado;
ROLLBACK;

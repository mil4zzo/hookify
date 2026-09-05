-- Migration 141 — Higiene do refresh: quem disparou, varredura do 'running' morto
-- e descarte do que a 004 criou e nunca foi usado.
--
-- CONTEXTO (2026-09-05)
-- ---------------------
-- Em 2026-09-04 o "este pack esta atualizando" passou a ser legivel por QUALQUER
-- membro de um pack compartilhado (antes vivia so no navegador de quem clicou).
-- O par que sustenta isso e `refresh_status` + `refresh_lock_until` — o segundo
-- e prazo de validade, porque ha caminhos que nunca escrevem o status final.
--
-- Esta migration fecha tres pontas:
--
-- 1. QUEM esta atualizando. `refresh_actor_id` e o ATOR (quem disparou), que num
--    pack compartilhado difere do dono. Estatico: nasce com o 'running' e nao muda
--    ate o fim — por isso e barato, ao contrario da porcentagem. Vai escrito no
--    MESMO update que ja grava status e prazo: zero ida extra ao banco.
--
-- 2. VARREDURA. O prazo protege a TELA, mas nao conserta o DADO: a linha continua
--    'running' no banco para sempre. Provado em producao — dois packs ficaram 16 e
--    17 dias em 'running' e nada os corrigiu (limpos a mao em 2026-09-04). Sem isto,
--    daqui a meses uma pergunta legitima ("quais packs falharam ao atualizar?")
--    encontra 'running' que na verdade morreram. A varredura so consegue julgar
--    linhas COM prazo; as antigas, de prazo nulo, ja foram tratadas.
--
-- 3. DESCARTE do que a 004 criou e nunca ligou:
--    - `refresh_progress_json`: nenhuma linha de codigo jamais a escreveu (varredura
--      do git em toda a historia + 42 packs em producao, zero com valor). Guardar
--      "para a porcentagem um dia" ja custou caro: foi ela e a irma que fizeram um
--      documento de roadmap afirmar uma serializacao que nunca existiu. Adicionar
--      coluna depois e trivial; carregar coluna morta engana leitor.
--    - `packs_refresh_lock_idx`: indice que nenhuma query usa. Enquanto a coluna era
--      sempre nula ele era um indice parcial VAZIO, inofensivo. Agora que passamos a
--      escrever o prazo, ele comecaria a ser mantido de verdade — escrita a cada
--      inicio e fim de refresh, para ninguem ler. Desperdicio criado pela mudanca.
--
-- ORDEM: esta migration vai ANTES do deploy do codigo (o backend passa a escrever
-- `refresh_actor_id`). Os DROPs sao seguros em qualquer ordem porque nenhum codigo,
-- nem o antigo nem o novo, toca no que esta sendo removido.

-- ── 1. Quem disparou ────────────────────────────────────────────────────────────
ALTER TABLE public.packs
  ADD COLUMN IF NOT EXISTS refresh_actor_id uuid;

COMMENT ON COLUMN public.packs.refresh_actor_id IS
  'Ator do refresh em andamento (quem disparou; num pack compartilhado difere do dono). Escrito junto com refresh_status=running, limpo em qualquer status terminal. Le-se sempre com refresh_status + refresh_lock_until, nunca sozinho.';

-- ── 2. Varredura do 'running' vencido ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sweep_stale_pack_refresh()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  afetados integer;
BEGIN
  -- `refresh_lock_until` e `timestamp` SEM timezone e guarda UTC. Comparar direto
  -- com `now()` (timestamptz) faria o Postgres interpretar a coluna no fuso da
  -- SESSAO: correto hoje (o banco esta em UTC), silenciosamente errado no dia em
  -- que alguem mudar isso. `now() at time zone 'utc'` torna a comparacao
  -- naive-contra-naive e imune ao fuso da sessao.
  UPDATE public.packs
     SET refresh_status = 'failed',
         refresh_lock_until = NULL,
         refresh_actor_id = NULL
   WHERE refresh_status = 'running'
     AND refresh_lock_until IS NOT NULL
     AND refresh_lock_until < (now() AT TIME ZONE 'utc');

  GET DIAGNOSTICS afetados = ROW_COUNT;
  RETURN afetados;
END;
$function$;

COMMENT ON FUNCTION public.sweep_stale_pack_refresh() IS
  'Marca como failed os packs presos em refresh_status=running cujo prazo (refresh_lock_until) venceu — job que morreu sem escrever o status final. Agendada por pg_cron; chamavel manualmente se o agendamento nao existir.';

REVOKE ALL ON FUNCTION public.sweep_stale_pack_refresh() FROM PUBLIC, anon, authenticated;

-- Roda 04:37 UTC, longe do purge-pack-action-log (04:23) para nao empilhar.
-- Se falhar num ambiente sem pg_cron, a funcao continua de pe e a limpeza vira
-- chamada manual — degrada, nao quebra.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-stale-pack-refresh') THEN
    PERFORM cron.schedule(
      'sweep-stale-pack-refresh',
      '37 4 * * *',
      'SELECT public.sweep_stale_pack_refresh()'
    );
  END IF;
END
$do$;

-- ── 3. Descarte do que nunca foi usado ──────────────────────────────────────────
DROP INDEX IF EXISTS public.packs_refresh_lock_idx;

ALTER TABLE public.packs
  DROP COLUMN IF EXISTS refresh_progress_json;

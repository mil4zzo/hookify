-- =====================================================================
-- 135 — Critério de validação passa a ser uma ÁRVORE DE REGRA
-- =====================================================================
--
-- O QUE ESTE CAMPO DECIDE, NA PRÁTICA
--   `user_preferences.validation_criteria` responde "a partir de quando um
--   anúncio já tem amostra suficiente para ser julgado". Quem não atende fica
--   de fora do G.O.L.D., do plano de ação e das oportunidades.
--
-- O QUE MUDA
--   O formato. Era um ARRAY de condições num vocabulário próprio, criado em
--   2025-11 e nunca revisto:
--
--     [{"id":"...","type":"condition","field":"impressions",
--       "operator":"GREATER_THAN_OR_EQUAL","value":"3000"}]
--
--   Passa a ser a MESMA árvore de regra dos filtros do Manager e dos grupos do
--   Boards (`lib/rules/types.ts`), o único formato de regra do app:
--
--     {"logic":"AND","conditions":[{"id":"...","type":"condition",
--       "field":"impressions","operator":">","value":3000}]}
--
--   Com ela o Critério ganha E/OU no topo, subgrupos, "contém regex", tags,
--   status, pack e conta — e perde os 11 campos que rejeitavam todo anúncio em
--   silêncio (o mapper antigo não os repassava, e campo ausente devolvia false).
--
-- POR QUE REESCREVER EM VEZ DE TRADUZIR
--   A escala de porcentagem mudou junto: `ctr > 0.02` significava 2% no formato
--   antigo e significaria 0,02% no novo. Traduzir automaticamente exigiria
--   adivinhar a intenção métrica a métrica, e um critério traduzido errado não
--   dá erro — só esvazia três telas, o que se lê como "não tenho anúncio bom".
--   O levantamento de 2026-08-30 mostrou que, nas 11 linhas existentes, NINGUÉM
--   usava outra coisa além de `impressions >= N` (5 linhas com 3000, 3 com 1,
--   3 vazias). Não há critério real a preservar. Decisão do idealizador.
--
-- ESCOPO DO UPDATE
--   Linha COM critério salvo  -> a semente `impressões > 3000`.
--   Linha vazia (`[]`/null)   -> árvore vazia, que é o mesmo "não configurado".
--   Ninguém muda de estado no onboarding: `validation_criteria_configured`
--   continua verdadeiro para quem já tinha, falso para quem não tinha.
--
-- REVERSÃO
--   Não há: o conteúdo antigo é descartado. O levantamento acima está no
--   histórico desta migration justamente por isso.
-- =====================================================================

begin;

-- Fotografia do que existe antes de escrever — some no fim da transação,
-- mas aparece no log da execução (regra sql_update_verify_before_run).
do $$
declare
  r record;
begin
  raise notice '--- validation_criteria ANTES da 135 ---';
  for r in
    select user_id,
           jsonb_typeof(validation_criteria) as tipo,
           left(coalesce(validation_criteria::text, 'null'), 200) as conteudo
    from public.user_preferences
    order by user_id
  loop
    raise notice '% | % | %', r.user_id, r.tipo, r.conteudo;
  end loop;
end $$;

-- 1) Quem TINHA critério recebe a semente.
update public.user_preferences
set validation_criteria = jsonb_build_object(
      'logic', 'AND',
      'conditions', jsonb_build_array(
        jsonb_build_object(
          'id', 'seed_impressions_135',
          'type', 'condition',
          'field', 'impressions',
          'operator', '>',
          'value', 3000
        )
      )
    ),
    updated_at = now()
-- `jsonb_array_length` nao pode ficar solto ao lado do teste de tipo: o planner
-- nao garante ordem de avaliacao entre as condicoes do AND, e numa reexecucao
-- (linha ja no formato objeto) ele estoura com "nao e uma matriz". O CASE torna
-- a guarda parte da propria expressao.
where case
        when jsonb_typeof(validation_criteria) = 'array' then jsonb_array_length(validation_criteria)
        else 0
      end > 0;

-- 2) Quem NÃO tinha fica com a árvore vazia — mesmo significado de antes
--    ("sem critério"), já no formato novo.
update public.user_preferences
set validation_criteria = '{"logic":"AND","conditions":[]}'::jsonb,
    updated_at = now()
where validation_criteria is null
   or jsonb_typeof(validation_criteria) <> 'object';

-- Verificação: nenhuma linha pode sobrar fora do formato novo.
do $$
declare
  fora int;
  com_criterio int;
  sem_criterio int;
begin
  select count(*) into fora
  from public.user_preferences
  where jsonb_typeof(validation_criteria) is distinct from 'object'
     or jsonb_typeof(validation_criteria -> 'conditions') is distinct from 'array';

  if fora > 0 then
    raise exception '135: % linha(s) de user_preferences ficaram fora do formato de árvore', fora;
  end if;

  select count(*) filter (where jsonb_array_length(validation_criteria -> 'conditions') > 0),
         count(*) filter (where jsonb_array_length(validation_criteria -> 'conditions') = 0)
    into com_criterio, sem_criterio
  from public.user_preferences;

  raise notice '135 OK: % com critério (impressões > 3000), % sem critério', com_criterio, sem_criterio;
end $$;

commit;

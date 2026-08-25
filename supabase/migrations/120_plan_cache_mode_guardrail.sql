-- Migration: 120_plan_cache_mode_guardrail.sql
-- Data: 2026-08-24
-- Descrição: Fecha a lacuna de `plan_cache_mode = force_custom_plan` nas RPCs com
--            parâmetros opcionais e cria o guarda-chuva para que a correção não se
--            perca em versões futuras.
--
-- CONTEXTO — por que isto existe:
--   RPCs que usam o padrão `p_x is null or ...` só são rápidas com CUSTOM plan, onde o
--   planner conhece os valores e faz constant-folding. O PL/pgSQL cacheia o plano por
--   sessão; a partir da ~6ª execução na MESMA conexão o planner pode adotar o GENERIC
--   plan, que usa seletividade default e escolhe um plano catastrófico (medido em
--   2026-07-13: 860 ms -> 233.814 ms, ~270x, depois statement timeout / 57014).
--   Como o PostgREST mantém conexões persistentes, isso aparece como lentidão
--   INTERMITENTE e some quando a query é testada isolada.
--
--   A correção já havia sido aplicada nos `_base_vNNN` e no `retention_v2`, mas o
--   `series_v2` ficou para trás: o hábito de versionar a base em `_base_vNNN` faz o
--   `ALTER FUNCTION ... SET plan_cache_mode` se perder em silêncio a cada versão nova.
--   Em 2026-08-24 isso contribuiu para as queries de 16-18 s que esgotaram o pool de
--   conexões e precederam o crash do Postgres.

-- ---------------------------------------------------------------------------
-- 1) Correção explícita das funções identificadas na auditoria de 2026-08-24
-- ---------------------------------------------------------------------------
alter function public.fetch_manager_rankings_series_v2(
  uuid, date, date, text, uuid[], text[], text, text, text, text, text[], integer
) set plan_cache_mode = force_custom_plan;

alter function public.resolve_pack_mql_leadscore_min(uuid, uuid[])
  set plan_cache_mode = force_custom_plan;

-- ---------------------------------------------------------------------------
-- 2) Varredura idempotente: aplica em QUALQUER função que exiba o padrão de risco
--    e ainda não tenha a config. Cobre overloads e o que tiver escapado acima.
-- ---------------------------------------------------------------------------
do $guard$
declare
  r record;
  n integer := 0;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.prokind = 'f'
       and p.proname <> 'check_plan_cache_mode_gaps'
       and p.prosrc ~ 'p_\w+ is null or'
       and coalesce(array_to_string(p.proconfig, ','), '')
           not like '%plan_cache_mode=force_custom_plan%'
  loop
    execute format('alter function %s set plan_cache_mode = force_custom_plan', r.sig);
    raise notice '[120] plan_cache_mode aplicado em %', r.sig;
    n := n + 1;
  end loop;
  raise notice '[120] total de funcoes corrigidas na varredura: %', n;
end
$guard$;

-- ---------------------------------------------------------------------------
-- 3) GUARDA-CHUVA para as próximas rodadas
--    Retorna as funções em risco que estão SEM a config. O contrato é: esta
--    consulta deve devolver ZERO linhas. Rodar no CI / pré-deploy e falhar se
--    voltar qualquer linha — é isso que impede a regressão silenciosa quando
--    alguém criar um `_base_vNNN` novo.
-- ---------------------------------------------------------------------------
create or replace function public.check_plan_cache_mode_gaps()
returns table (funcao text, motivo text)
language sql
stable
set search_path = public
as $check$
  select
    p.oid::regprocedure::text as funcao,
    'usa o padrao "p_x is null or" e esta SEM plan_cache_mode=force_custom_plan' as motivo
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.prokind = 'f'
    -- exclui a si mesma: o corpo desta funcao contem o padrao que ela procura
    and p.proname <> 'check_plan_cache_mode_gaps'
    and p.prosrc ~ 'p_\w+ is null or'
    and coalesce(array_to_string(p.proconfig, ','), '')
        not like '%plan_cache_mode=force_custom_plan%'
  order by 1
$check$;

comment on function public.check_plan_cache_mode_gaps() is
  'Guarda-chuva da migration 120. DEVE retornar zero linhas. Qualquer linha = RPC com '
  'parametro opcional sem plan_cache_mode=force_custom_plan, sujeita ao cliff de generic '
  'plan (~270x, vira 57014). Fix: ALTER FUNCTION <sig> SET plan_cache_mode = force_custom_plan;';

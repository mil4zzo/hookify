-- 095: remove a cadeia MORTA de fetch_manager_rankings_core_v2 (drift acumulado).
--
-- CONTEXTO
--   O read-path do Manager acumulou 6 funções órfãs ao longo das migrations. Pior: um
--   overload de 15 args do wrapper AINDA existia apontando para o _base_v060 (antigo). O app
--   nunca o aciona — o backend sempre envia p_campaign_id, e o PostgREST resolve overload
--   pelo conjunto de chaves do body, casando com o de 16 args. Mas a ambiguidade era uma
--   armadilha real: qualquer caller que omitisse p_campaign_id cairia silenciosamente numa
--   agregação de 30+ migrations atrás. (Chamar a função pelo psql com args posicionais já
--   falhava com "is not unique".)
--
-- GRAFO VERIFICADO ANTES DO DROP (varredura em pg_proc + pg_views + pg_policy + pg_trigger)
--   VIVO : fetch_manager_rankings_core_v2(16) -> _base_v093   <- único caminho do backend
--   MORTO: fetch_manager_rankings_core_v2(15) -> _base_v060
--          _base_v066(15) -> _base_v060        (só era chamada por _base_v067)
--          _base_v067(16)                      (órfã)
--          _base_v059(15)                      (órfã)
--          _base_v090(16)                      (órfã)
--   Nenhuma view/policy/trigger referencia qualquer uma delas.
--
-- NOTA: corpo de plpgsql NÃO é rastreado como dependência pelo Postgres (a resolução é por
-- nome, em runtime). Portanto o DROP não protege contra referência viva — a checagem acima é
-- a única rede. Refeita aqui como guarda de execução: se o wrapper vivo mudar de base, aborta.
do $$
declare
  v_base text;
begin
  select substring(pg_get_functiondef(p.oid) from 'core_v2_base_v[0-9]+')
    into v_base
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname = 'fetch_manager_rankings_core_v2'
    and p.pronargs = 16;

  if v_base is distinct from 'core_v2_base_v093' then
    raise exception
      'ABORTADO: o wrapper vivo (16 args) delega a %, nao a _base_v093. Retracear a cadeia antes de dropar.',
      coalesce(v_base, '(nenhuma)');
  end if;
end $$;

-- Wrapper morto (15 args). Some a ambiguidade de overload: a partir daqui só existe um
-- fetch_manager_rankings_core_v2, e ele é o certo.
drop function if exists public.fetch_manager_rankings_core_v2(
  uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text
);

-- Bases órfãs. Ordem: caller antes de callee (irrelevante para plpgsql, mas mantém a leitura honesta).
drop function if exists public.fetch_manager_rankings_core_v2_base_v067(
  uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text
);
drop function if exists public.fetch_manager_rankings_core_v2_base_v066(
  uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text
);
drop function if exists public.fetch_manager_rankings_core_v2_base_v060(
  uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text
);
drop function if exists public.fetch_manager_rankings_core_v2_base_v059(
  uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text
);
drop function if exists public.fetch_manager_rankings_core_v2_base_v090(
  uuid, date, date, text, uuid[], text[], text, text, text, text, boolean, boolean, integer, integer, text, text
);

-- Pós-condição: sobram exatamente 2 funções (o wrapper de 16 args + _base_v093).
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname like 'fetch_manager_rankings_core%';

  if v_count <> 2 then
    raise exception 'ABORTADO: esperava 2 funcoes core apos a limpeza, encontrei %.', v_count;
  end if;
end $$;

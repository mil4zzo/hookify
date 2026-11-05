-- Diferencial da migration 184 contra as funções VIVAS (v170 e v171), em produção,
-- DENTRO DE UMA TRANSAÇÃO QUE TERMINA EM ROLLBACK: as funções novas existem só nesta
-- sessão; nada fica no banco.
--
-- Uso (da raiz do repo; o arquivo da migration sem BEGIN/COMMIT é gerado na hora):
--   sed -e '/^BEGIN;$/d' -e '/^COMMIT;$/d' supabase/migrations/184_leads_por_vigencia.sql > /tmp/184_body.sql
--   psql "$PGCONN" -X -v ON_ERROR_STOP=1 -v uid=<user> -v body=/tmp/184_body.sql -f backend/scripts/diff_v184.sql
--
-- Prova, para cada caso (packs × agrupamento × cortes):
--   1. v184 SEM cortes = v170, pedaço a pedaço (texto idêntico).
--   2. v184 COM cortes = v170 + só o pedaço `leadscore_by_period`.
--   3. Em cada linha, a soma dos trechos = `leadscore_histogram`, nota a nota.
--   4. Detalhe: v184 sem cortes = v171; com cortes, só `totals.leads_by_period` a mais,
--      e a soma dos trechos = `totals.leads`.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '180s';
\i :body
set local request.jwt.claim.sub = :'uid';

create temp table casos (n int, packs uuid[], gb text, d0 date, d1 date, cuts date[]) on commit drop;
insert into casos values
  (1, array['33d0853c-5359-4ef9-9848-e5976b2b8a3c']::uuid[], 'ad_name', '2026-10-01', '2026-11-02', array['2026-10-20', '2026-10-27']::date[]),
  (2, array['33d0853c-5359-4ef9-9848-e5976b2b8a3c']::uuid[], 'ad_id', '2026-10-01', '2026-11-02', array['2026-10-27', '2026-10-20', '2026-10-23', null]::date[]),
  (3, array['33d0853c-5359-4ef9-9848-e5976b2b8a3c', '6250198f-8358-4815-994f-0f14fbd2fff2']::uuid[], 'adset_id', '2026-08-01', '2026-11-02', array['2026-01-01', '2026-09-01', '2026-10-20', '2026-12-31']::date[]),
  (4, array['490ac302-f694-49ae-900b-5855d61e5868', '6250198f-8358-4815-994f-0f14fbd2fff2']::uuid[], 'campaign_id', '2026-04-01', '2026-10-01', array['2026-05-01']::date[]),
  (5, array['490ac302-f694-49ae-900b-5855d61e5868']::uuid[], 'ad_name', '2026-04-01', '2026-06-01', array['2026-04-27', '2026-05-04', '2026-05-11']::date[]);

create temp table saida (n int, versao text, v json) on commit drop;
insert into saida
select c.n, 'v170', x
from casos c, public.fetch_manager_rankings_v170(:'uid'::uuid, c.d0, c.d1, c.gb, c.packs, p_limit => 100000, p_thumb_public_prefix => 'x') x;
insert into saida
select c.n, 'v184_sem', x
from casos c, public.fetch_manager_rankings_v184(:'uid'::uuid, c.d0, c.d1, c.gb, c.packs, p_limit => 100000, p_thumb_public_prefix => 'x') x;
insert into saida
select c.n, 'v184_com', x
from casos c, public.fetch_manager_rankings_v184(:'uid'::uuid, c.d0, c.d1, c.gb, c.packs, p_limit => 100000, p_thumb_public_prefix => 'x', p_lead_period_starts => c.cuts) x;

\echo '--- 1 e 2: pedaços iguais (o com cortes sem o pedaço novo)'
select c.n,
  (select count(*) from saida s where s.n = c.n and s.versao = 'v170') as pedacos,
  (select (s.v ->> 'row_count')::int from saida s where s.n = c.n and s.versao = 'v170' and s.v::jsonb ? 'row_count') as linhas,
  (select string_agg(v::text, '|' order by v::text) from saida s where s.n = c.n and s.versao = 'v170')
    = (select string_agg(v::text, '|' order by v::text) from saida s where s.n = c.n and s.versao = 'v184_sem') as sem_cortes_igual,
  (select string_agg(v::text, '|' order by v::text) from saida s where s.n = c.n and s.versao = 'v170')
    = (select string_agg(v::text, '|' order by v::text) from saida s where s.n = c.n and s.versao = 'v184_com' and not (s.v::jsonb ? 'leadscore_by_period')) as com_cortes_resto_igual,
  (select count(*) from saida s where s.n = c.n and s.versao = 'v184_sem' and s.v::jsonb ? 'leadscore_by_period') as sem_cortes_pedaco_novo,
  (select count(*) from saida s where s.n = c.n and s.versao = 'v184_com' and s.v::jsonb ? 'leadscore_by_period') as com_cortes_pedaco_novo
from casos c order by c.n;

\echo '--- 3: soma dos trechos = histograma, nota a nota (divergencias por caso)'
with tot as (
  select s.n, e.i, e.h
  from saida s, jsonb_array_elements(s.v::jsonb -> 'leadscore_histogram') with ordinality e(h, i)
  where s.versao = 'v184_com' and s.v::jsonb ? 'leadscore_histogram'
),
per as (
  select s.n, e.i, e.p
  from saida s, jsonb_array_elements(s.v::jsonb -> 'leadscore_by_period') with ordinality e(p, i)
  where s.versao = 'v184_com' and s.v::jsonb ? 'leadscore_by_period'
),
a as (select t.n, t.i, k.key as score, k.value::int as qty from tot t, jsonb_each_text(t.h) k),
b as (
  select p.n, p.i, k.key as score, sum(k.value::int) as qty
  from per p, jsonb_each(p.p) tr, jsonb_each_text(tr.value) k
  group by 1, 2, 3
),
trechos as (
  select p.n, max(tr.key::int) as maior, min(tr.key::int) as menor, count(*) filter (where p.p = '{}'::jsonb) as linhas_vazias
  from per p left join lateral jsonb_each(p.p) tr on true group by 1
)
select c.n,
  (select count(*) from a full join b using (n, i, score) where coalesce(a.n, b.n) = c.n and a.qty is distinct from b.qty) as divergencias,
  (select sum(qty) from a where a.n = c.n) as leads,
  (select count(*) from per where per.n = c.n) as linhas_por_trecho,
  (select count(*) from tot where tot.n = c.n) as linhas_total,
  (select menor || '..' || maior from trechos t where t.n = c.n) as trechos,
  cardinality(array_remove(c.cuts, null)) as cortes
from casos c order by c.n;

\echo '--- 4: detalhe (v171 x v184)'
create temp table ent (n int, gb text, id text, cuts date[]) on commit drop;
insert into ent
select 1, 'entity', x.ad_name, array['2026-10-20', '2026-10-27']::date[]
from (select a.ad_name from public.ad_performance_daily a
      where a.pack_id = '33d0853c-5359-4ef9-9848-e5976b2b8a3c' and cardinality(a.lead_scores) > 0 and a.ad_name is not null
      group by 1 order by sum(cardinality(a.lead_scores)) desc limit 1) x;
insert into ent select 2, 'ad_id', id, cuts from ent where n = 1;

create temp table esaida (n int, versao text, v jsonb) on commit drop;
insert into esaida select e.n, 'v171', public.fetch_entity_performance_v171(:'uid'::uuid, '2026-10-01', '2026-11-02', 'ad_name', e.id, array['33d0853c-5359-4ef9-9848-e5976b2b8a3c']::uuid[], e.gb, true, null, false) from ent e;
insert into esaida select e.n, 'v184_sem', public.fetch_entity_performance_v184(:'uid'::uuid, '2026-10-01', '2026-11-02', 'ad_name', e.id, array['33d0853c-5359-4ef9-9848-e5976b2b8a3c']::uuid[], e.gb, true, null, false) from ent e;
insert into esaida select e.n, 'v184_com', public.fetch_entity_performance_v184(:'uid'::uuid, '2026-10-01', '2026-11-02', 'ad_name', e.id, array['33d0853c-5359-4ef9-9848-e5976b2b8a3c']::uuid[], e.gb, true, null, false, e.cuts) from ent e;

with g as (
  select s.n, s.versao, gr.value as grp, gr.ordinality as i
  from esaida s, jsonb_array_elements(s.v -> 'groups') with ordinality gr
),
leads as (
  select g.n, g.i, k.key as score, k.value::int as qty from g, jsonb_each_text(g.grp -> 'totals' -> 'leads') k where g.versao = 'v184_com'
),
per as (
  select g.n, g.i, k.key as score, sum(k.value::int) as qty
  from g, jsonb_each(g.grp -> 'totals' -> 'leads_by_period') tr, jsonb_each_text(tr.value) k
  where g.versao = 'v184_com' group by 1, 2, 3
)
select e.n, e.gb,
  (select v from esaida where n = e.n and versao = 'v171') = (select v from esaida where n = e.n and versao = 'v184_sem') as sem_cortes_igual,
  (select v from esaida where n = e.n and versao = 'v171') = (
    select jsonb_set(v, '{groups}', (select jsonb_agg(gr #- '{totals,leads_by_period}' order by o) from jsonb_array_elements(v -> 'groups') with ordinality x(gr, o)))
    from esaida where n = e.n and versao = 'v184_com') as com_cortes_resto_igual,
  (select count(*) from g where g.n = e.n and g.versao = 'v184_com') as grupos,
  (select count(*) from g where g.n = e.n and g.versao = 'v184_com' and g.grp -> 'totals' ? 'leads_by_period') as grupos_com_trecho,
  (select count(*) from leads full join per using (n, i, score) where coalesce(leads.n, per.n) = e.n and leads.qty is distinct from per.qty) as divergencias,
  (select sum(qty) from leads where leads.n = e.n) as leads
from ent e order by e.n;

rollback;

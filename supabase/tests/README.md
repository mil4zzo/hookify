# Testes SQL

Testes de mecanismos que vivem no banco (triggers, funções, RPCs). Cada arquivo roda
numa transação e termina em `ROLLBACK`: não deixa rastro. **Nunca rodar em produção** —
o alvo é um Postgres local com o schema (e, idealmente, os dados) restaurados do dump.

## Laboratório local

```bash
# 1. dump do remoto (schema + dados de public; ~90 MB)
pg_dump "$DB_URL" -Fc --schema=public --no-owner --no-acl \
  --exclude-table-data=public.meta_api_usage -f hookify.dump

# 2. banco local (Postgres 17) com os stubs que o schema do Supabase exige:
#    roles anon/authenticated/service_role, schema auth com auth.users e auth.uid()
createdb hookify_lab
psql -d hookify_lab -f supabase/tests/lab_prep.sql
pg_restore -d hookify_lab --no-owner --no-acl --section=pre-data --section=data hookify.dump
psql -d hookify_lab -c "insert into auth.users(id) select distinct user_id from public.packs on conflict do nothing"
pg_restore -d hookify_lab --no-owner --no-acl --section=post-data hookify.dump   # erros de "já existe" são normais

# 3. aplicar as migrations sob teste (o teste da 128 cobre a 129: mesma tabela, read model completo)
psql -d hookify_lab -v ON_ERROR_STOP=1 -f supabase/migrations/128_rollup_de_performance_conversoes_e_leads.sql
psql -d hookify_lab -v ON_ERROR_STOP=1 -f supabase/migrations/129_read_model_completo_ad_performance_daily.sql
```

## Rodar um teste

```bash
psql -d hookify_lab -X -v ON_ERROR_STOP=1 -f supabase/tests/128_rollup_de_performance.test.sql
# → "OK: N asserções" e código 0; ou para na primeira asserção com o esperado/obtido
```

## Sabotagem (obrigatória para teste novo)

Um teste que nunca falhou não provou nada. Desabilite o mecanismo e confirme que o
teste **falha**:

```bash
# injeta a sabotagem logo após o BEGIN e roda; o exit code TEM de ser diferente de 0
sed '0,/^BEGIN;/s//BEGIN;\nALTER TABLE public.ad_metrics DISABLE TRIGGER ad_metrics_rollup_sync_upd;/' \
  supabase/tests/128_rollup_de_performance.test.sql | psql -d hookify_lab -X -v ON_ERROR_STOP=1
# esperado: ERROR:  FALHOU: B conv após update de actions
```

Sabotagens já provadas para o 128 (2026-08-26): trigger de UPDATE desligado → falha em B;
trigger de INSERT desligado → falha em A; FK sem `ON UPDATE CASCADE` → falha em G.

## Diferenciais (rota/RPC antiga × nova, sobre os dados do laboratório)

Toda troca de cálculo passa por um diferencial contra a versão anterior antes do cutover.
Dois scripts, ambos recusam URL do Supabase:

| Script | O que compara | Como fala com o banco |
|---|---|---|
| `backend/scripts/diff_rankings_rollup.py` | RPC do Manager: v116 × v130 (`--series`, `--v132`) | `psql` (sem driver Python) |
| `backend/scripts/diff_entity_routes.py` | As 7 rotas de detalhe: código Python ANTIGO (carregado do git, `--old-ref`) × rotas novas sobre `fetch_entity_performance_v133` (migration 133) | `psycopg` — instale só no venv de laboratório: `pip install "psycopg[binary]"` (não está no requirements: produção fala PostgREST) |

O segundo executa as duas implementações no mesmo processo com um cliente Supabase
falso que traduz o query builder do PostgREST para SQL (ordem física por `ctid` sem
ORDER BY — a paginação por offset da rota antiga exige ordem estável entre páginas).
Aplique a migration 133 no lab antes de rodar:

```bash
psql -d hookify_lab -v ON_ERROR_STOP=1 -f supabase/migrations/133_detalhe_de_entidade_no_read_model.sql
LAB_URL=postgresql://postgres@127.0.0.1:5433/hookify_lab backend/venv/Scripts/python backend/scripts/diff_entity_routes.py
```

O cabeçalho de cada script lista o que é exato e o que é tolerado (e por quê). Critério
de saída: zero divergências não classificadas.

## Migration 140 (planilha flexível)

```bash
psql -d hookify_lab -X -v ON_ERROR_STOP=1 -f supabase/tests/140_planilha_flexivel.test.sql
# → "OK: 26 asserções" (~3 min: a C1 roda a checagem de consistência real do usuário inteiro)
```

Sabotagens provadas em 2026-09-03 (o teste TEM de falhar com cada uma):
- `ALTER TABLE public.ad_metrics DISABLE TRIGGER ad_metrics_rollup_sync_upd;` após o BEGIN → falha em A2;
- `ad_performance_rollup_consistency_check` com `NULL::jsonb` no lugar de `d.custom_hist` no CTE `stored` → falha em C1
  (a função da 128 nem roda: `EXCEPT` com número de colunas diferente da `derive_row` nova);
- `fetch_manager_performance_base_v140` com `max(v.value::bigint)` em vez de `sum(...)` no `custom_by_group` → falha em D1.

## Migration 157 (detalhe de entidade linear)

```bash
psql -d hookify_lab -X -v ON_ERROR_STOP=1 -f supabase/tests/157_detalhe_linear.test.sql
# → "157 OK — 515 telas idênticas à v155 + escala linear" (~2 min; exige 154, 155 e 157 no lab)
psql -d hookify_lab -X -v ON_ERROR_STOP=1 -v alvo=fetch_entity_performance_v155 -f supabase/tests/157_detalhe_linear.test.sql
# → TEM de falhar em B1 (a v155 é N²; ~2 min a mais)
```

Sabotagens provadas em 2026-09-15 (cada uma aplicada como `CREATE OR REPLACE` da v157 no lab):
- alvo v155 → falha em B1 (razão 1600/200 = 137,7; a v157 deu 9,7 e 12,3);
- `pack_ids` dos totais também no modo `entity` → falha em A;
- nomes do representante só de `ad_metrics` (sem o inventário) → falha em A;
- dia sem o histograma de leads → falha em A;
- `days` sem o filtro da janela de série → falha em A;
- histogramas da planilha fora da dobra final → falha em A.

A primeira calibração da escala (300 × 1.200 anúncios, 3 dias, razão < 8) **passava com a v155**
(razão 6,6): nesse tamanho a parte quadrática ainda não domina. Teste de escala só vale num
tamanho em que a versão ruim já é visivelmente ruim — e com folga larga, porque a máquina do lab
varia ±40% entre rodadas.

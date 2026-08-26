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

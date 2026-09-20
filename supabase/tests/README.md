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

## Migration 170 — métrica de vídeo não se aplica a imagem

```bash
export PATH="/c/Program Files/PostgreSQL/17/bin:$PATH"
export PGPASSWORD='lab_hookify_2026'; export PGHOST=127.0.0.1; export PGUSER=hookify_lab

psql -d hookify_lab -X -v ON_ERROR_STOP=1 -f supabase/tests/170_video_em_imagem.test.sql
PGPASSWORD=lab_hookify_2026 PSQL="C:/Program Files/PostgreSQL/17/bin/psql.exe"   py backend/scripts/diff_manager_v170.py --jobs 3        # v162 x v170, ~25 min
```

O diferencial não compara por igualdade — a mudança é o objetivo. Ele cobra um contrato:
mesmo conjunto de linhas (exceto em ranking ORDENADO por métrica de vídeo, onde mudar é o
ponto), tudo que não é vídeo idêntico, plays/thruplays nunca aumentam, linha de imagem
zerada, e no grão do anúncio quem não é imagem fica igual.

Medições (19/09, laboratório com a cópia de 08/09):
- índice: pedir `media_type` sem pô-lo no índice de cobertura troca *index-only scan*
  (5.323 páginas, 0 heap fetches) por **Seq Scan** (~21 mil páginas). Com ele no índice:
  5.406 páginas, 0 heap fetches, mesmo tamanho de índice (12 MB);
- tempo: diferença dentro do ruído da máquina (−4% a +23%, cenas grandes empatadas).

Sabotagens (19/09) — **duas passaram pelo diferencial e só o teste SQL pegou**:
- regra invertida (trava o vídeo) → diferencial acusa (178 de 178 execuções);
- gasto travado junto → diferencial acusa (dano colateral fora do vídeo);
- travar só plays/thruplays → diferencial ILESO; o teste pega no nome misturado (hook 0,6
  em vez de 0,5);
- travar também `unknown` → diferencial ILESO (nenhum anúncio sem formato tem play: dos
  1.812, só 2 tiveram entrega); o teste pega em C3/C4.

## Migration 171 — série e detalhe seguem a regra de imagem

```bash
export PATH="/c/Program Files/PostgreSQL/17/bin:$PATH"
export PGPASSWORD='lab_hookify_2026'; export PGHOST=127.0.0.1; export PGUSER=hookify_lab

psql -d hookify_lab -X -v ON_ERROR_STOP=1 -f supabase/tests/171_serie_em_imagem.test.sql
py backend/scripts/diff_series_v171.py --packs 8 --nomes 14
```

A 171 trava as duas funções que entregam número dia a dia: a série do sparkline
(`fetch_manager_performance_series_v171`, atrás do wrapper `fetch_manager_rankings_series_v2`)
e o detalhe do modal (`fetch_entity_performance_v171` — totais, série e curva de retenção).
Nas duas, a trava entra num CTE só, por anúncio-dia. Com `plays` em 0 a série devolve
**NULL** no dia (a fórmula é `case when plays > 0 ... else null`) e a curva nem sai (ela
exige `plays > 0`).

Volta atrás: `171_rollback.sql` (o wrapper volta para a v145) e
`ANALYTICS_ENTITY_RPC=fetch_entity_performance_v158` para o detalhe.

Duas armadilhas que custaram tempo ao escrever os testes:
- a série só devolve os grupos **pedidos** em `p_group_keys` — sem eles a resposta vem
  vazia e a asserção falha por "grupo ausente", não por número errado;
- o corpo gravado das funções vem com CRLF quando a migration foi aplicada de um arquivo
  convertido pelo Windows: ao gerar uma versão nova a partir de `pg_get_functiondef`,
  normalize antes, senão nenhum texto casa.

## Migration 172 — a curva de retenção segue a regra de imagem

```bash
psql -d hookify_lab -X -v ON_ERROR_STOP=1 -f supabase/tests/172_curva_em_imagem.test.sql
```

Terceira porta da mesma regra: `fetch_manager_rankings_retention_v2` (a curva de um grupo,
chamada direto pela rota `/analytics/rankings/retention`) lia `ad_metrics` cru. **A 171
piorou a exposição a ela**: como o detalhe passou a devolver curva vazia para imagem, o
modal conclui "não veio curva da fonte primária" e cai justamente no fallback não tratado.
Volta atrás: `ANALYTICS_RETENTION_RPC=fetch_manager_rankings_retention_v2`.

## O que a revisão de 20/09 mudou nas provas (e por quê)

Dois revisores independentes leram a 170/171 e o resultado foi **um furo de prova, não de
código** — vale como lembrete de como esta série de testes pode enganar:

- **A trava é um `case` por coluna, e cada um sustenta o seu sozinho.** Sabotagem: apagar
  só a de `hold_rate` passava ileso pelo teste sintético E pelo diferencial de 907 mil
  linhas. Motivo: a única asserção que tocava as outras quatro razões era num anúncio 100%
  imagem — onde `plays = 0` já zera a razão por divisão, com ou sem trava. **Asserção
  tautológica.** Agora o nome MISTO afirma as sete colunas, nos três arquivos (170, 171 e
  o detalhe), e a sabotagem coluna a coluna é parte do roteiro.
- **O diferencial das linhas só comparava `data`** — cabeçalho, médias e paginação ficavam
  de fora (R6 fechou isso). O do detalhe nunca comparava o array de dias.
- **A prova no próprio arquivo da 170** agora confere as sete travas POR COLUNA (contar
  ocorrências não basta: passaria com `plays` travado sete vezes).

Regra prática que fica: **num grupo onde o denominador zera, a asserção não prova a trava.**
Quem prova é o grupo MISTO, onde sobra denominador do vídeo.

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

## Migration 160 — série de dias sob demanda

```bash
export PATH="/c/Program Files/PostgreSQL/17/bin:$PATH"
export PGPASSWORD='lab_hookify_2026'; export PGHOST=127.0.0.1; export PGUSER=hookify_lab

# o teste novo
psql -d hookify_lab -X -v ON_ERROR_STOP=1 -f supabase/tests/160_serie_sob_demanda.test.sql

# não-regressão: o diferencial da 157 rodado contra a v158
psql -d hookify_lab -X -v ON_ERROR_STOP=1 -v alvo=fetch_entity_performance_v158 \
     -f supabase/tests/157_detalhe_linear.test.sql
```

A v158 é a v157 com `p_series_days = 0` significando NENHUM dia (na v157 o zero caía
junto do NULL e pedia o período inteiro). As 515 combinações da 157 continuam idênticas
à v155 — a mudança só cria significado para um valor que ninguém usava.

Sabotagens provadas (15/09): rodar com `alvo=...v157` (A1 falha, 3 dias em vez de 0);
`v_date_stop` em vez de `v_date_stop + 1` (A1 falha, sobra 1 dia); fazer a CTE `totals`
respeitar `v_series_start` — o jeito errado de zerar dias — (A1b falha com `<NULL>`: sem
total, o `having` descarta o grupo e ele SOME da resposta).

**Armadilha de medição:** não estime "o custo de um dia" com `p_series_days = 1` quando o
período termina hoje. A janela vira `[date_stop, date_stop]`, não há linha do dia corrente,
e a chamada devolve ZERO dia — o mesmo tamanho de "sem série". Confira a contagem de dias
na saída, não só os bytes. Isso produziu um ganho inventado de 44% antes de a medição com
a função real mostrar 35%.

## Migration 161 — Manager em colunas, todas as linhas

```bash
export PATH="/c/Program Files/PostgreSQL/17/bin:$PATH"
export PGPASSWORD='lab_hookify_2026'; export PGHOST=127.0.0.1; export PGUSER=hookify_lab
export PGCLIENTENCODING=UTF8

# ramos que os dados reais não exercitam (status vazio, miniatura já do Storage,
# caminho com acento, conjunto, renome, 10.050 linhas sem corte)
psql -d hookify_lab -X -v ON_ERROR_STOP=1 -f supabase/tests/161_manager_em_colunas.test.sql

# diferencial: resposta HTTP antiga (v155 + core_v2 + hidratação Python) contra a
# nova convertida em linhas — 591 cenários, ~25 min no laboratório
PSQL="C:/Program Files/PostgreSQL/17/bin/psql.exe" py backend/scripts/diff_manager_v161.py --jobs 3
```

Resultado em 16/09: **591 cenários, 344.605 linhas, zero divergências** (inclusive a
ordem das linhas, que a v161 calcula sobre `grp` e entrega em `row_order`).

**O diferencial sozinho não bastava — provado por sabotagem.** `status_resolved` forçado
a verdadeiro passou ileso por ele, porque nenhum anúncio do laboratório tem status vazio;
idem renome (nenhum dos 58.499 anúncios de produção foi renomeado). Daí o teste SQL.

Sabotagens provadas (16/09):
- no diferencial: tags/transcrição trocadas, miniatura sem Storage, `budget_mode` do
  próprio conjunto, filtro de campanha pelo conjunto — todas acusadas;
- no teste SQL: `status_resolved` sempre verdadeiro e sem tirar espaços (C2), caminho sem
  codificar (C3), sem o ramo "já é do Storage" (C4), corte de 10 mil de volta (C1),
  motivo da pausa invertido (C6), orçamento em aba de anúncio (C7), sem plano B de
  `ad_metrics` (C6), e voltar a ler o nome do DIA antes do atual (C8);
- nos leitores (Python e TypeScript): ignorar `row_order` derruba a paridade com o fixture.

Duas armadilhas desta rodada:
1. **Sabotagem que não passa pela linha alterada não prova nada.** "Preferir o nome do
   dia" não mudou o resultado enquanto `ad_metrics` só era lida SEM linha em `ads`; a
   regressão real era voltar a ler sempre. Sabote o comportamento antigo, não um
   detalhe do novo.
2. **Um script de sabotagem que falha antes de gravar deixa o arquivo da sabotagem
   ANTERIOR no lugar** — e o psql aplica aquele. Apague o arquivo antes de gerar.

## Migration 162 — Manager em pedaços (memória)

```bash
# mesmo cenário sintético da 161, sobre os pedaços, + forma da 162 e equivalência à v161
psql -d hookify_lab -X -v ON_ERROR_STOP=1 -f supabase/tests/162_manager_em_pedacos.test.sql

# diferencial v161 x v162 (linhas montadas pelo leitor), com e sem prefixo de miniatura
PSQL="C:/Program Files/PostgreSQL/17/bin/psql.exe" py backend/scripts/diff_manager_v162.py --jobs 3
```

Resultado em 16/09: **1.182 execuções (591 cenários × com/sem prefixo), 689.210 linhas,
zero divergências**; respostas somadas 955 → 730 MB.

**Memória se mede no laboratório** (o disco não interfere): pico de memória privada do
processo do banco — `pg_backend_pid()` num arquivo e, no fim, `Get-Process -Id <pid>` →
`PeakPagedMemorySize64` (controle: uma varredura com resposta pequena fica em ~5 MB).
Para ver ONDE está a memória: `pg_log_backend_memory_contexts(pid)` de outra sessão durante
a consulta e ler o log do laboratório (`C:/Program Files/PostgreSQL/17/data/log`).

Sabotagens provadas (16/09):
- razão de volta a `numeric`: o teste SQL acusa (C9); o diferencial NÃO, e está certo —
  o número lido pelo navegador é o mesmo; o que muda são os bytes;
- sem `row_order` nos metadados, campo extra na saída, `thumb_storage_path` com prefixo,
  `ctr` trocado por `website_ctr`: teste SQL e diferencial acusam (o caminho com prefixo
  faz o leitor falhar alto: lista nula com linhas);
- nos leitores (Python e TypeScript): aceitar dois pedaços de metadados derruba
  "pedaços malformados falham alto".

Armadilha: uma verificação "razão sem as 20 casas do numeric" por quantidade de casas
decimais dá falso positivo — float8 pequeno (0,00012…) tem 20+ casas. A assinatura
inequívoca do numeric é zero no fim depois do ponto, que o float8 nunca imprime.

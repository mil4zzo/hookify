# Plano pós-157 — o que sobrou da caçada ao "Erro ao carregar variações."

Criado em 2026-09-15, depois de o modal de variações voltar a funcionar. Este arquivo é o
**contrato de retomada**: cada bloco é independente, cabe numa sessão e termina em produção
com medição. Quem pegar isto do zero consegue continuar sem o histórico do chat.

Contexto do problema original e das decisões já tomadas:
`documentation/decisoes-tecnicas.md` (seções de 15/09) e `supabase/migrations/157_detalhe_linear.sql`.
O plano de eficiência (F1..F7) continua em `documentation/plano-eficiencia-carregamento.md`;
o bloco 5 daqui **é** o F2b de lá.

---

## Estado em 15/09 (já feito, não refazer)

| O quê | Estado |
|---|---|
| `fetch_entity_performance_v157` (montagem linear) | 🚢 em produção; backend usa `RPC_NAME = "fetch_entity_performance_v157"`; a v155 segue intacta para rollback |
| Teste `supabase/tests/157_detalhe_linear.test.sql` | ✅ 515 telas idênticas + escala linear; 6 sabotagens provadas (README dos testes) |
| Nome de anúncio com "/" nas rotas `/rankings/ad-name/*` | 🚢 em produção (`b2c3ace`), teste `backend/tests/test_ad_name_route_with_slash.py` |
| `schema.sql` / `schema_map.md` | ✅ sincronizados com produção em 15/09 |

**Medições que não precisam ser refeitas** (produção, 15/09): ADNV89 com 630 anúncios em
21 dias: v155 874–1.737 ms → v157 317 ms. Escala no laboratório (200 → 1.600 anúncios,
8× mais): v157 ~10×, v155 138×.

---

## Bloco 1 — CI de guardas do banco volta a ficar verde ✅ FEITO (15/09)

Migration `158_plan_cache_mode_no_backfill_do_inventario.sql` aplicada em produção;
`check_plan_cache_mode_gaps()` devolve zero linhas; workflow verde no commit `48943c3`.
Confirmado pelo `gh` que o gate falhava em **todos os 7 pushes** desde a 154 (último verde:
14/09). A migration carrega a própria prova (bloco `DO`), sabotada no laboratório.
Armadilha registrada: `pg_get_function_identity_arguments()` devolve o nome do parâmetro
junto (`p_user_id uuid`) — identificar função por `regprocedure`.

**Por quê (contexto original).** A migration 154 criou `ad_pack_inventory_backfill(uuid)` com o padrão
`p_x is null or ...` e **sem** `plan_cache_mode = force_custom_plan`. O gate
`check_plan_cache_mode_gaps()` (workflow `.github/workflows/db-guardrails.yml`) falha o build
desde então. Risco real baixo (função de manutenção), risco de processo alto: alarme sempre
vermelho deixa de ser lido.

**Passos**
1. O idealizador instala o `gh` (não está nesta máquina). Conferir:
   `gh run list --workflow db-guardrails.yml --limit 10`.
2. Migration `158_plan_cache_mode_no_backfill_do_inventario.sql`:
   `ALTER FUNCTION public.ad_pack_inventory_backfill(uuid) SET plan_cache_mode TO 'force_custom_plan';`
3. Aplicar em produção e conferir `select * from public.check_plan_cache_mode_gaps()` → **zero linhas**.
4. Commit + push; confirmar o workflow verde no `gh`.

**Pronto quando:** gate sem lacunas e último run verde. Sem deploy de backend.

---

## Bloco 2 — Repetir só quando o trabalho não aconteceu ✅ FEITO (15/09)

Migration `159_o_banco_desiste_antes_do_cliente.sql` em produção (papel `authenticated`
30 s → 20 s; `detect_pack_conflicts` 25 s → 20 s) e backend com teto de cliente de 25 s,
orçamento separado por fase (connect 5 s, write 15 s, pool 5 s). Retry corrigido nos
**dois** mecanismos, 796 testes passando, 4 sabotagens provadas.

Três coisas que o plano original não previa e que ficaram sabidas:
- **Havia um segundo mecanismo de retry**, só para as RPCs do Manager
  (`analytics._is_transient_analytics_rpc_error`) — e era o pior dos dois: classificava por
  TEXTO antes do tipo, e o marcador `"Timeout"` casava com ReadTimeout.
- **O desalinhamento era de dois caminhos, não de um**: o detalhe/variações e o
  `detect_pack_conflicts`, exatamente os dois que deram problema. As rotas do Manager já
  estavam certas (cliente 35 s > banco 30 s).
- **O venv local estava divergente de produção** (postgrest 2.27.0 aqui, 0.16.11 lá),
  o que fazia 4 testes de `test_db_concurrency.py` falharem localmente sem serem bug.
  Alinhado com `pip install "supabase>=2.5.1,<2.7.0"`. Ver [[supabase_py_upgrade_desliga_o_teto_de_concorrencia]] e o **Bloco 6**.

**Por quê (contexto original).** `with_postgrest_retry` repete também em `ReadTimeout`. Medido em produção em
15/09: quando o backend desiste, **a consulta continua rodando no banco por mais de 1 s**
(teste com cliente desistindo em 0,15 s numa leitura de ~3 s). Resultado no incidente de
14/09: 4 tentativas de 15 s da mesma consulta de 18 s — 1 minuto de espera para o usuário e
até 4 cópias no banco. Repetir só ajuda quando o trabalho não aconteceu (queda de conexão,
deadlock, erro rápido de API externa).

**Passos**
1. `backend/app/core/supabase_retry.py`: separar as classes de falha. Repetir
   `ConnectError`, `ConnectTimeout`, `RemoteProtocolError`, `ReadError`, `PoolTimeout` e
   deadlock (40P01). **Não** repetir `ReadTimeout`/`WriteTimeout` — com escape explícito por
   chamada, se aparecer um caso que precise.
2. Alinhar os limites para não sobrar consulta órfã: hoje o backend espera 15 s
   (`POSTGREST_TIMEOUT_SECONDS`), `authenticated` corta em 30 s, `service_role` herda 8 s do
   `authenticator` e `detect_pack_conflicts` tem 25 s próprios. Decidir por rota: ou o banco
   corta antes (statement_timeout por função), ou o backend espera mais que o banco.
3. Testes em `backend/tests/`: contar tentativas por tipo de erro (timeout = 1; queda de
   conexão = 4; deadlock = 4). **Sabotagem obrigatória:** voltar o `ReadTimeout` para a lista
   e conferir que o teste falha.
4. Deploy do backend. Acompanhar o log por `supabase_retry:` nas 24 h seguintes.

**Cuidado.** O helper embrulha ~98 chamadas, incluindo **escritas** (upserts do refresh). Para
escrita, tempo esgotado é ambíguo: pode ter gravado. Decidir explicitamente (os upserts são
idempotentes) e registrar a decisão no código.

**Pronto quando:** testes passam, sabotagem falha, backend no ar sem novo 500 por esse caminho.

---

## Bloco 3 — Resposta das variações mais leve ✅ FEITO (15/09)

Migration `160_serie_de_dias_sob_demanda.sql` (v158) em produção, backend usando
`fetch_entity_performance_v158`, gzip no nível 6, frontend tirando a série do
`useAdDetails`. 807 testes no backend, teste SQL novo com 3 sabotagens, diferencial da
157 rodado contra a v158 (515 telas idênticas).

**Medido na função real, em produção** (ADNV89, 630 anúncios, 13 dias, rodadas quentes):

| | antes | depois |
|---|---|---|
| saindo do banco | 1.396 KB (796 dias) | **909 KB** (0 dias) |
| tempo da função | ~301 ms | **~229 ms** |
| na rede (gzip) | ~130 KB (nível 9) | **67 KB** (nível 6) |
| CPU de compressão | ~60 ms | **8 ms** |

**Três coisas que o plano original errava:**
- `series_days=0` **não** desligava a série na v157: caía no ramo do NULL e pedia o
  PERÍODO INTEIRO. Daí a v158 — três significados (NULL = tudo, 0 = nada, N > 0 = N).
- "a série é usada ao clicar numa variação (1 de 630)" estava errado: dentro do modal a
  tabela é renderizada **sem `onRowClick`**. Quem usa é o modal aberto pela tabela
  expandida do Manager, na aba de vídeo — onde `useAdDetails` já é buscado.
- O ganho é **35%**, não 44%. A estimativa de 44% veio de medir com `series_days=1`
  quando o período termina hoje: a janela vira `[date_stop, date_stop]`, não há linha do
  dia corrente e a saída tem ZERO dia. Conferir contagem de dias, não só bytes.

**Falta:** conferir na tela que os mini-gráficos continuam aparecendo ao abrir uma
variação (aba de vídeo do modal) — a série agora chega pelo `useAdDetails`.

**Por quê (contexto original, medido em 15/09, ADNV89 com 630 anúncios).** A resposta tem 1.636 KB crus, 130 KB
na rede. **Metade é a mini-série de 5 dias por anúncio, que a tabela de variações não
desenha** — ela só é usada ao clicar numa variação (1 de 630). E comprimir no nível 9 custa
60 ms por resposta; no nível 6 custa 8 ms e o arquivo fica 12% maior.

| | Atual | Esperado |
|---|---|---|
| Saída do banco | 1.481 KB | 908 KB |
| Resposta crua | 1.636 KB | 898 KB |
| Na rede | 130 KB | 74 KB |
| Compressão | 60 ms | 8 ms |

**Passos**
1. Backend: as rotas de filhos (`/rankings/ad-name/{nome}/children` e
   `/rankings/adset-id/{id}/children`) chamam a RPC com `series_days=0` e devolvem `series: null`.
   Conferir antes se `series_days=0` faz a v157 não montar os dias (`v_series_start`).
2. Frontend: em `components/ads/AdDetailsDialog.tsx`, a série dos mini-gráficos passa a vir do
   detalhe por anúncio (`useAdDetails`, que já é buscado na aba de vídeo) em vez de `ad.series`.
   Remover o plano B de conversões em `ManagerChildrenTable.tsx` (linhas ~217-226), que lê a série.
3. `backend/app/main.py`: `GZipMiddleware(compresslevel=6)`.
4. Testes: (a) comparar a resposta real da rota antes/depois campo a campo — só `series` pode
   mudar; (b) teste de frontend de que a tabela não depende da série; (c) conferir no app que
   os mini-gráficos aparecem ao abrir uma variação; (d) medir bytes e tempo antes/depois.

**Pronto quando:** medição confirma os números acima e os mini-gráficos continuam aparecendo.

---

## Bloco 7 — Aba "Por anúncio" com TODAS as linhas 🚀 PRONTO PARA DEPLOY (16/09)

**Estado.** Migration `161_manager_em_colunas.sql` aplicada em produção (a função nova não é
chamada por ninguém até o backend subir); backend com `ANALYTICS_MANAGER_V161` (padrão ligado;
`false` volta à v155 sem deploy); frontend pedindo `format: 'columns'`, lendo em um ponto só
(`lib/api/managerColumns.ts`) e gravando em colunas no IndexedDB; `limit` 100000 no Manager e
no Boards. Diferencial: 591 cenários, 344.605 linhas, zero divergências. Testes: 829 no
backend, 28 no frontend, teste SQL novo com 10 sabotagens provadas.

**Medido em produção (v155+core_v2 → v161):**

| aba (Igor) | antes | depois |
|---|---|---|
| por anúncio, 7 packs (26.015 linhas) | 39–44 s, cortado em 10 mil | **7,7–10,6 s, completo** |
| por conjunto, 38 packs | 21,8 s (estourava) | **11,7 s** |
| por conjunto, 7 packs | 7,2 s | 3,8 s |
| por criativo, 7 / 38 packs | ~2 s / 16,6–17,7 s | ~2 s / 12,8–17,1 s |
| por campanha, 7 / 38 packs | 3,2 s / 13,3 s | 3,1 s / 12,1 s |
| **por anúncio, 38 packs, 120 dias (51 mil linhas)** | — | **36–45 s — ainda falha** |

**O que sobrou (decisão pendente).** Por anúncio com todos os packs ainda passa dos 20 s. Em
produção o custo restante é: agregação de base (~9 s a 51 mil linhas), montar o JSON (~4 s a
cada 26 mil linhas, CPU) e ler `ads` com cache frio (~7 s). Alavancas, em ordem de custo:
1. mais memória na instância (hoje 256 MB para 1,2 GB de banco — o gargalo de fundo);
2. índices de cobertura (nomes por campanha/conjunto; colunas de `ads` do representante);
3. `VACUUM` para marcar páginas visíveis (`ad_metrics` com 0%);
4. agregado pré-calculado por período (projeto).

Melhorias ENCONTRADAS e ainda NÃO aplicadas (16/09, confirmado em produção pelo idealizador
que a aba com 7 packs funciona, "não tão rápido"):
- **Montar o JSON mais barato** (~4 s a cada 26 mil linhas, CPU): converter as razões
  (hook, ctr, cpm…) para `float8` (menos dígitos, mesmo valor no navegador) e cortar campos
  que o Manager não lê (`thumb_storage_path`, `adcreatives_videos_thumbs` — conferir Explorer,
  Insights e Boards antes). Medir antes: o ganho é estimado, não medido.
- **Índices de cobertura** em `ads`: `(user_id, campaign_id) INCLUDE (campaign_name)` e o
  equivalente para conjunto (o plano B do dicionário `names` custa ~5 s na aba por criativo com
  38 packs); e um para os campos do representante (evitaria ler as linhas largas de `ads`).
  `CREATE INDEX CONCURRENTLY` fora de transação, migration própria.
- **`VACUUM (ANALYZE)`** em `ads`, `ad_metrics` (0% visível) e `ad_performance_daily` (67%):
  permitiria leitura só pelo índice. Manutenção em produção — precisa do ok (é o Bloco 4).
- **Resposta em partes** para o caso extremo: primeiro as linhas de maior gasto, o resto em
  seguida, cada parte abaixo do limite de tempo. Custo: a agregação roda por parte (medir se a
  soma cabe) e a tela lida com "ainda carregando".
- **Aumentar o limite só desta função** (ex.: 60 s na v161 e 70 s no cliente do Manager,
  mantendo banco < cliente): destrava a tela à custa de espera longa e de prender memória e
  conexão numa instância pequena. É remendo, não solução.

**A descobrir no mesmo tema:** Explorer e Insights pedem `limit: 1000` — o Igor tem ~3,4 mil
criativos; o mesmo corte silencioso pode existir lá (decidir se é proposital).

**Correção deste plano:** a primeira versão desta seção atribuía ~10 s ao invólucro
`core_v2`. Errado para as abas de anúncio e criativo — nelas ele devolve a base sem tocar.

### Contexto original (aberto em 16/09)

**O incidente.** A aba "Por anúncio" do Igor (7 packs, 26/08–15/09, purchase) deu 500 duas vezes:
`57014` aos 20 s. Medido sem limite: **39–44 s** — falharia também com os 30 s de antes da 159.
A 159 escolheu 20 s olhando o nível de criativo (1,2 s) e não mediu o nível `ad_id` com o maior
usuário. Não houve rollback do teto: não resolveria nada.

**O corte silencioso de 10 mil.** O `limit: 10000` do Manager (e do Boards) nasceu em 03/03/2026
como "remover o limite de 1.000" — ninguém escolheu 10 mil como teto. A função do banco repete o
teto (`least(p_limit, 10000)`). O Igor tem **26.015** linhas nesses 7 packs (55 mil com os 38).
Com o corte:
- médias de taxa (hook, CTR, CPM, CPR) vêm do servidor sobre TUDO → certas;
- **somas do cabeçalho (Spend, Results, MQLs, CPMQL…) são calculadas no navegador sobre as
  linhas carregadas → erradas**;
- filtros, busca, "Exibindo X de Y" e seleção em massa só enxergam as 10 mil (há um aviso
  discreto "N no total" na FilterBar, e só ele).

**Decisão (idealizador, 16/09): carregar TUDO**, com teto de segurança alto (100 mil) e o aviso
de truncamento como rede. Não paginar: filtros por regra, busca, ordenação, somas e seleção
rodam no navegador (paginar = portar o motor de regras para SQL), e paginar por offset refaz a
agregação inteira a cada página ([[manager_rpc_cost_model]]). O "sob demanda" já existe onde
importa: a tabela é virtualizada, séries só das linhas visíveis (até 100), miniaturas só ao
aparecer. 12 MB de download no pior caso real (38 packs) aceito.

**Onde vai o tempo hoje — as três camadas** (Igor, 26 mil linhas; medições de 16/09)

| camada | o quê | custo |
|---|---|---|
| banco | ler os anúncios IRMÃOS por anúncio (353 por vez) só para o tipo de mídia | ~9 s — **N²** |
| banco | invólucro `core_v2` relendo o JSON inteiro para status/orçamento | ~10 s |
| banco | nomes de campanha/conjunto buscados linha a linha em `ad_metrics` | ~7,5 s |
| banco | a agregação de verdade | ~3 s |
| backend | `jsonable_encoder` do FastAPI reescrevendo JSON que já é JSON | **1–3 s por 10 mil linhas** |
| backend | decodificar + `json.dumps` + gzip | ~0,8 s por 10 mil |
| navegador | ler o JSON (Chrome) | ~52 ms por 10 mil — ok |
| navegador | **persister grava cada resposta como TEXTO JSON no IndexedDB**, sem teto de tamanho | 16 MB por 10 mil linhas |

**Formato de colunas — medido com as 10 mil linhas reais**

| formato | cru | rede (gzip 6) | Python: ler | navegador: ler + montar linhas | memória no navegador |
|---|---|---|---|---|---|
| linhas (hoje) | 15,9 MB | 1,98 MB | 162 ms | 52 ms | 23 MB |
| lista de listas | 8,9 MB | 1,66 MB | 91 ms | 67 ms | 56 MB |
| **uma lista por campo** | **8,9 MB** | **1,08 MB** | 67 ms | 77 ms | 33 MB |

"Uma lista por campo" ganha na rede (−45%) porque valores parecidos ficam juntos; no navegador
não ajuda (o Chrome já lê linhas muito bem: objetos iguais compartilham forma), custa +25 ms por
10 mil. Ou seja: **colunas para trafegar e para gravar; linhas para usar.**

**Desenho**
- **A. Banco** — base nova (v161) sem o N² (mídia/transcrição/tags uma vez por NOME, hash join;
  nomes de campanha/conjunto sem ida linha a linha), o trabalho do `core_v2` dobrado para dentro
  sem reler JSON, teto 100 mil, saída já no formato de colunas, com `status_resolved` e a URL de
  miniatura do Storage montadas em SQL. A v155/core_v2 ficam para rollback. Diferencial linha a
  linha contra a saída atual (convertida), em produção, vários usuários e as 4 abas. Medir em
  26 mil e **55 mil** (o pior caso real; lição da 157: teste de tamanho onde a versão ruim já é
  ruim).
- **B. Backend** — a rota **repassa os bytes** do PostgREST, sem decodificar nem reencodar
  (some o `jsonable_encoder`). Continua pelo cliente com slot (`db_slot`). Opt-in por campo do
  request (`format: "columns"`) enquanto houver consumidor antigo.
- **C. Frontend** — um adaptador só em `api.analytics.getAdPerformance` (colunas → linhas):
  Manager, Boards, Explorer e Insights passam por ali. O CACHE continua em linhas (há
  `setQueryData` otimista de status que edita linhas); o **persister** grava em colunas
  (serializa linhas → colunas na escrita e desfaz na leitura). Tirar o `limit: 10000` do
  Manager e do Boards.
- **D. Medir ponta a ponta** em 26 mil e 55 mil: banco, backend, bytes, leitura no navegador,
  gravação no IndexedDB; conferência visual (inclui a pendência do Bloco 3: mini-gráficos ao
  abrir uma variação).

**Pronto quando:** a aba do Igor abre com os 38 packs, soma do cabeçalho igual à do servidor,
diferencial zerado, e o tempo total medido e registrado.

---

## Bloco 4 — `detect_pack_conflicts`: a afinação barata

**Por quê (medido em 15/09).** Depois do F5 a função caiu para 0,5–0,8 s nos 38 packs do Igor
(antes: média 4,6 s, pior caso 19,7 s). O que sobra de desperdício: lê as **142 mil linhas de
anúncio-dia de todos os packs** para responder **0 conflitos**, ordena 7 MB em disco e faz 156
mil idas extras à tabela porque a limpeza automática não passa no mapa desde 07/09 — antes da
exclusão em massa da 156. O plano de eficiência já listava isto como "afinação barata,
independente do resto" (§5, riscos do F2b).

**Passos**
1. **Autorização do idealizador para manutenção em produção** (o acesso atual é só leitura):
   `VACUUM (ANALYZE) public.ad_metric_pack_map` — não trava a tabela.
2. Medir antes/depois: tempo da função e `Heap Fetches` no plano.
3. Se a ordenação em disco continuar, migration com `SET work_mem` na função (o mesmo padrão
   de `fetch_manager_performance_base_v155`) e medir de novo. **Só entra se o ganho aparecer**
   — na v157 esse ajuste foi testado e descartado por não mudar nada.
4. Avaliar autovacuum mais agressivo no mapa (`autovacuum_vacuum_scale_factor` na tabela).

**Não serve como atalho:** usar `ad_pack_inventory` para pré-filtrar. Medido: 28.125 dos
58.499 pares (pack, anúncio) do mapa **não** estão no inventário, que só cobre anúncio sem
entrega. É o mesmo tipo de pré-filtro inseguro que a migration 146 rejeitou.

**Pronto quando:** tempo medido antes e depois, com o ganho (ou a ausência dele) registrado.

---

## Bloco 5 — Grafo de conflito incremental (é o F2b)

**Por quê.** Mesmo afinado, o custo cresce com o volume e o grafo é refeito inteiro sempre que
qualquer pack muda. O F2b já tem estimativa: incremental por pack custa ~196 ms.

**Dependências e riscos (de `plano-eficiencia-carregamento.md`, §5):**
- **É decisão de segurança, não de performance:** alarga a janela de grafo velho, e este grafo
  é a ÚNICA proteção contra somar o mesmo anúncio duas vezes. Tem de falhar fechado.
- **Deve vir depois da feature de editar a data do pack** (outro chat): é a única ação capaz de
  criar sobreposição onde não havia, e ela precisa revalidar o grafo ao salvar.
- Guardar arestas + marca d'água por pack, tratando pack apagado, pack compartilhado e dois
  refreshes ao mesmo tempo. É a parte cara.
- A migration 145 prevê remover `ad_metric_pack_map` numa fase 2. O desenho definitivo deve
  nascer lendo a chave de `ad_metrics`, senão nasce para ser refeito.

**Passos**
1. Medir a frequência real: quantas vezes por dia o grafo muda (refresh por pack) contra
   quantas vezes é buscado. Sem isso não dá para dizer que o incremental compensa.
2. Desenhar (documento curto no próprio plano de eficiência, item F2b).
3. Implementar com teste e sabotagem: um conflito criado depois do último cálculo **tem** de
   aparecer; grafo indisponível **tem** de bloquear.

**Pronto quando:** medição, desenho aprovado e implementação com teste sabotado.

---

## Bloco 6 — Atualizar o `supabase-py` (levantado em 15/09, NÃO urgente)

**O que é.** `supabase-py` é o cliente Python oficial do Supabase — por onde todo o backend
fala com o banco, com o Auth e com o Storage. Produção está na **2.6.0, de 24/07/2024**
(mais de dois anos atrás); o PyPI está na 2.31.0. O `httpx` está preso em 0.27.2 por causa dela.
O resto do stack está em dia (FastAPI 0.139, cryptography 50.0.1, pydantic 2.13.5).

**Por que NÃO é urgente (medido em 15/09).** `pip-audit` sobre o `pip freeze` exato do
container: **zero vulnerabilidades** em `supabase`, `postgrest`, `gotrue`, `storage3`,
`realtime` e `httpx`. O único achado em 47 pacotes é `ecdsa 0.19.2` (PYSEC-2026-1325), que
vem do `python-jose`, é um ataque de temporização ao **assinar** com P-256 — e o backend só
**verifica** assinatura de JWT (o próprio advisory diz que verificação não é afetada).
O projeto `python-ecdsa` declara que não vai corrigir; não há versão de conserto.

**Por que vale fazer um dia.** Dois anos sem atualizar é dívida que só encarece, e a versão
nova **simplifica** a proteção em vez de dificultar: `ClientOptions.httpx_client` é API
pública nas versões novas — é exatamente o campo que a tentativa de 2026-08 procurou, não
achou no 2.6.0, e custou um outage. Passaríamos o `_SlottedHTTPXClient` direto, sem
sobrescrever método interno. O filtro por `/rest/v1/` que já existe no `send()` (hoje
descrito como "cinto e suspensório") passa a ser a peça que impede o Storage de disputar
slot de banco.

**Superfície real:** só **5 imports diretos** da família no backend inteiro — três em
`app/core/supabase_client.py` (o arquivo da proteção) e dois de `postgrest.exceptions.APIError`
(que continua existindo). O resto usa o objeto `Client` genericamente.

**Riscos, em ordem de importância**
1. **Falha silenciosa da proteção.** Se a instalação do slot não migrar junto, a fila do banco
   some sem erro — o estado que precedeu o crash de 2026-08-24. Já existe alarme para isso:
   `test_db_concurrency.py::test_a_lib_ainda_tem_o_gancho_em_que_a_protecao_se_apoia` falha
   com mensagem explicativa (sabotagem provada em 15/09).
2. **O timeout do ClientOptions é IGNORADO quando se passa `http_client`** (conferido no código
   da 2.31.0). O alinhamento do Bloco 2 teria de mudar para dentro do cliente httpx, ou a
   consulta órfã volta calada. `test_timeout_alinhado.py` cobre o lado dos números, mas não
   que eles cheguem ao cliente — vale um teste novo nessa hora.
3. `gotrue` virou `supabase-auth` e `realtime` pula de 1.0.6 para 2.31.0 (major). O backend não
   importa nenhum dos dois diretamente, mas o `create_client` os instancia.
4. `httpx` sobe para a faixa 0.28 (`>=0.26,<0.29`), que tem mudanças próprias.

**Passos**
1. Atualizar num branch, com `requirements.txt` fixando as versões novas.
2. Migrar a instalação do slot para `ClientOptions(httpx_client=...)` e mover o orçamento de
   tempo para dentro do cliente httpx. Rodar `tests/` inteiro (796 hoje).
3. **Teste funcional no app, não só unitário** — é o que os testes não cobrem: login, upload
   de miniatura (Storage), refresh de um pack (escrita), uma tela do Manager (leitura pesada).
4. Deploy fora de horário de uso, com rollback pronto (`git revert` + redeploy).

**Pronto quando:** app exercitado nos quatro caminhos acima e o teste do gancho passando pela
API nova, não pela antiga.

---

## Como retomar (para uma sessão sem histórico)

- **Banco de produção:** session pooler; credencial na memória `db_connection`. Só leitura sem
  autorização explícita; manutenção (VACUUM, migration) precisa do ok do idealizador.
- **Laboratório:** `hookify_lab` local, porta 5432, migrations 154/155/157 aplicadas. Testes SQL
  rodam SÓ lá (`supabase/tests/README.md`).
- **Deploy:** `ssh root@77.37.126.210`, `cd /var/www/hookify/deploy && ./deploy.sh` disparado com
  `setsid nohup`; esperar pela trava (`flock /tmp/hookify_deploy.lock true`), nunca por `pgrep`.
- **Ordem sugerida:** 7 (urgente: aba quebrada) → 4 → 5 (1, 2 e 3 já feitos). Os blocos 4 e 6 são independentes; o 5 espera
  a feature de editar data do pack.

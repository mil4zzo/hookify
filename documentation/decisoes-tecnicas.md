# Decisões Técnicas — Hookify

Registro de decisões de arquitetura, abordagens escolhidas e lições aprendidas ao longo do desenvolvimento. Serve como guia para evitar retrabalho e esclarecer o "por quê" por trás de soluções não óbvias.

> Este arquivo é espelho da memória do Claude (`memory/meta_video_access.md` etc.). Ao criar, atualizar ou remover uma entrada, faça nos dois lugares.

---

## Meta API — Acesso a vídeo de anúncios via `source_ad`

**Data:** 2026-04-21

**Problema:** Anúncios duplicados na Meta armazenam uma cópia do vídeo no criativo direto (`creative.video_id`, `adcreatives.asset_feed_spec.videos`) com permissões restritas. A app recebia erro `#10: Application does not have permission for this action` ao tentar reproduzir vídeos no modal de detalhes.

**Causa raiz:** Quando um ad é duplicado entre contas/campanhas, a Meta cria um asset de vídeo novo vinculado ao ad duplicado mas sem conceder permissão à app para acessá-lo diretamente.

**Solução:** O vídeo original e acessível está no `source_ad` (anúncio de origem da duplicação). Mudamos o `_DETAILS_FIELDS` em `ads_enricher.py` para buscar `source_ad{creative{...}, adcreatives{asset_feed_spec}}` e priorizamos esses dados em `merge_details`, com fallback para os campos diretos (cobre ads originais, não duplicados).

**Cadeia de resolução de vídeo (fluxo atual):**

1. Enrichment → `source_ad.adcreatives.asset_feed_spec.videos[0].video_id` → salvo como `ads.primary_video_id`
2. Modal abre → `GET /{video_id}?fields=from` → `video_owner_page_id` (salvo lazy em `ads.video_owner_page_id` na 1ª visualização)
3. `GET /me/accounts?fields=id,name,access_token&limit=200` → `page_access_token` (cache em memória 300s com fingerprint do user_token — ver `facebook_page_token_service.py`)
4. `GET /{video_id}?fields=source` com `page_access_token` → URL do vídeo para o player

**Arquivos alterados:** `backend/app/services/ads_enricher.py` (`_DETAILS_FIELDS`, `merge_details`)

**Limitações:**
- Packs criados antes de 2026-04-21 podem ter `primary_video_id` do asset sem permissão; só corrigidos com re-enriquecimento do zero.
- Ads originais (não duplicados) não têm `source_ad` — o fallback para `creative` direto os cobre corretamente.

---

## Meta API — Tabela `meta_api_usage` e tracking de quota

**Data:** 2026-04-23

**Contexto:** Usuários atingindo limites de quota da Meta sem visibilidade de qual flow era responsável.

**O que cada linha representa (não-óbvio):** Cada registro é um **snapshot cumulativo do quota total da conta** no momento da chamada — NÃO o custo individual daquela chamada. `cputime_pct: 4` significa "a conta está em 4% do limite agora", não "essa chamada custou 4%". Para estimar o custo de uma flow, compare snapshots consecutivos.

**Detecção de throttling:**
- `regain_access_minutes > 0` → conta bloqueada; valor indica minutos até liberação
- Meta usa HTTP 400 com error code 17 ou 613 para throttling (NÃO 429)
- Campo extraído de `estimated_time_to_regain_access` dentro do header `x-business-use-case-usage`

**Ads API access tier vs. Live mode:** `ads_api_access_tier: "development_access"` é independente do app estar em Live mode. Mesmo em Live, fica em development_access até solicitar Advanced Access para `ads_management`/`ads_read` via App Review. Development access tem quota muito inferior ao Standard.

**Padrões de implementação:**
- `ContextVar` em `request_context.py` propaga `user_id`/`route`/`page_route` sem alterar assinaturas
- `ThreadPoolExecutor` (4 workers) para inserts fire-and-forget — não bloqueia a chamada Meta
- BUC fallback: maioria das chamadas Marketing API retorna só `x-business-use-case-usage`, não `x-app-usage`
- `json.dumps()` explícito para colunas jsonb — supabase-py pode double-encodar dicts em algumas versões
- Header `X-Page-Route`: frontend injeta `window.location.pathname`; backend armazena em `page_route` separado de `route`

**Arquivos principais:** `backend/app/services/meta_usage_logger.py`, `backend/app/routes/meta_usage.py`, `backend/app/core/request_context.py`, `frontend/components/meta-usage/`

---

## Sistema de Tiers de Usuário (subscriptions)

**Data:** 2026-04-26

**Contexto:** Necessidade de controlar acesso a páginas premium por tier, com fundação para billing futuro (Stripe).

**Decisões:**

- Tabela `subscriptions` (não `user_tiers`) — nome alinhado com vocabulário de billing
- 3 tiers: `standard` (padrão) < `insider` < `admin` — `admin` inclui acesso a tudo de `insider` via hierarquia
- Enforcement via **Next.js middleware** (server-side, antes do render) — não bypassável client-side, sem overhead em todos os endpoints de API
- Middleware usa cliente Supabase com a sessão do usuário (anon key + RLS) — não precisa service role para ler o tier do próprio usuário
- Novo usuário recebe `standard` automaticamente via trigger `trg_new_user_subscription` em `auth.users INSERT`
- Coluna `subscriptions.user_id` tem constraint `UNIQUE` — um row ativo por usuário. Para billing com múltiplos planos simultâneos, remover unique e adicionar `is_active`.

**Como adicionar nova página restrita:**
1. `ROUTE_MINIMUM_TIER` em `tierConfig.ts`
2. `minimumTier` na entrada de `pageConfigs` em `pageConfig.ts`
Nada mais necessário — middleware e sidebar filtram automaticamente.

**UX ao bloquear:** redireciona para `/planos?from=<rota>` (informativo, sem payment flow por ora).

**Admin UI:** `/admin` gated por tier `admin`; chama RPC `get_admin_users_list` (join auth.users + subscriptions + packs + facebook_connections) e `PATCH /admin/users/{id}/tier` no FastAPI com validação de tier do caller.

**Arquivos chave:** `frontend/lib/config/tierConfig.ts`, `frontend/middleware.ts`, `frontend/lib/hooks/useUserTier.ts`, `backend/app/routes/admin.py`, migrations 068 e 069.

---

## Analytics — Paridade entre RPC e fallback legado em endpoints de séries

**Data:** 2026-04-27

**Problema:** `/analytics/rankings/series` aceita uma lista de `group_keys` e deveria devolver uma série por chave. Em produção, o usuário pediu 10 chaves e recebeu apenas 4. As 6 ausentes não tinham linhas em `ad_metrics` dentro da janela `window=5` (últimos N dias do range).

**Causa raiz:** Existem dois caminhos para esse endpoint:
- **RPC** (`_get_rankings_series_v2_rpc` → função `fetch_manager_rankings_series_v2`): após receber a resposta do Postgres, percorre os `keys` requisitados e preenche stub vazio (`_empty_series_for_axis(axis)`) para qualquer chave ausente.
- **Legado** (`_get_rankings_series_v2`): iterava as linhas retornadas pelo `_get_rankings_legacy` e descartava silenciosamente qualquer chave sem dados na janela (`if not series: continue`).

Como `ANALYTICS_MANAGER_RPC_FAIL_OPEN=true`, qualquer falha do RPC cai para o legado sem alerta visível ao usuário, e o legado emitia uma resposta com chaves faltando.

**Por que isso quebra a UI:** O Manager (`frontend/app/manager/page.tsx`, `buildPendingSet`) calcula chaves "pendentes" como aquelas ausentes do cache. Chaves silenciosamente descartadas ficam pendentes indefinidamente — sparkline não renderiza e o frontend dispara nova requisição a cada repaint.

**Solução:** No fallback legado, depois de montar `out`, preencher stubs para qualquer `group_keys_set - out.keys()` usando `_empty_series_for_axis(axis)` — comportamento idêntico ao do RPC. Frontend e contratos não precisam mudar.

**Plano de descontinuação do legado (não nesta PR):**
1. Manter `FAIL_OPEN=true` enquanto AB-compare (`ANALYTICS_MANAGER_RPC_AB_COMPARE_ENABLED=true`) confirma paridade entre RPC e legado.
2. Desligar `ANALYTICS_MANAGER_RPC_AB_COMPARE_ENABLED=false` para rodar somente RPC em produção e validar.
3. Se estável, mudar `ANALYTICS_MANAGER_RPC_FAIL_OPEN=false` no `.env.production` (reversível com restart).
4. Apenas então remover `_get_rankings_series_v2` e o ramo de fallback no handler — atenção: `_get_rankings_legacy` também é usado por `_get_rankings_core_v2` e pelo shadow de AB-compare; remoção exige cascata.

**Regra geral:** Em qualquer endpoint cuja resposta seja indexada por chaves requisitadas pelo cliente, todos os caminhos servidores devem garantir que toda chave pedida apareça na resposta (com payload vazio quando aplicável). Divergência silenciosa entre paths é particularmente perigosa em pares com `FAIL_OPEN`.

**Arquivos alterados:** `backend/app/routes/analytics.py` (`_get_rankings_series_v2`).

---

## Schema drift do remoto — `_v066`/`_v067` ausentes nos migrations locais

**Data:** 2026-04-28

**Problema:** Após aplicar migration 074 (drop `ad_metrics.pack_ids`), todos os endpoints do Manager passaram a falhar com `column am.pack_ids does not exist`. Migrations 071 e 072 supostamente já tinham migrado todos os reads para `ad_metric_pack_map`.

**Causa raiz:** O DB remoto tinha duas funções (`fetch_manager_rankings_core_v2_base_v066` e `_v067`) que **não existem em nenhum migration local** — foram introduzidas direto no remoto em algum momento, possivelmente via Supabase Studio ou SQL ad-hoc. A cadeia real de chamadas era:

```
wrapper fetch_manager_rankings_core_v2 (com p_campaign_id)
  → _v067 (campaign_id filter)
    → _v066 (passthrough)
      → _v059  ← legado, ainda usava am.pack_ids
```

Migration 072 trocou o **wrapper** para apontar para `_v060` (sem fallback `pack_ids`), mas `_v066` continuou chamando `_v059`. `_v060` ficou órfão. Quando 074 dropou a coluna, a cadeia `_v067 → _v066 → _v059` quebrou.

**Solução (migration 075):** Reescrever `_v066` para chamar `_v060` em vez de `_v059`. Mudança de uma única linha, sem efeito colateral conhecido (assinaturas idênticas, body de `_v060` é estritamente igual ao de `_v059` menos o fallback `or am.pack_ids && p_pack_ids`).

**Lições:**
1. Antes de qualquer drop de coluna ou alteração estrutural em RPCs, rodar `pg_dump --schema-only` para sincronizar `schema.sql` com o remoto. Os arquivos locais não são fonte de verdade.
2. Se há overload de wrapper (mesma `proname`, signatures diferentes), Python/PostgREST roteia pelo conjunto de params nomeados. Verificar em `analytics.py` (ex: `p_campaign_id` ativa `_v067`).
3. Funções base versionadas (`_v0XX`) podem se acumular silenciosamente. Antes de propor uma migration, listar todas:
   ```sql
   SELECT proname FROM pg_proc
   WHERE proname LIKE 'fetch_manager_rankings_core_v2_base_v%'
     AND pronamespace = 'public'::regnamespace;
   ```

**Cleanup pendente (futuro):** `_v059`, `_v047`, `_v048` ainda existem mas ficaram sem callers após 075. Podem ser dropadas quando o schema for ressincronizado e validado.

**Arquivos alterados:** `supabase/migrations/075_fix_v066_route_to_v060.sql`.

---

## Supabase / PostgREST — Cap silencioso de 1000 linhas em `.select().execute()`

**Data:** 2026-04-29

**Problema:** Após criar um pack com 5019 (ad_id, date) entries, o card mostrava `totalSpend = 77.654,78` enquanto Meta Ads Manager (mesmos filtros e datas) mostrava `~191.000`. Os dados em `ad_metrics` e `ad_metric_pack_map` estavam corretos (191k somando via SQL direto), mas as stats salvas pelo backend estavam erradas.

**Causa raiz:** PostgREST corta respostas de `.select().execute()` em **1000 linhas por padrão, sem erro nem warning**. Em `calculate_pack_stats_essential`, a primeira query — `sb.table("ad_metric_pack_map").select("ad_id").eq(...).execute()` — não tinha paginação. Para o pack com 5019 linhas no junction table, só as primeiras 1000 voltavam, então `ad_ids_in_pack` cobria ~52% dos ads únicos, e a soma de spend caía para ~40% do real (os ads truncados tendiam a ter mais cobertura de datas, então pesavam mais na soma).

**Solução:** Trocar a query direta por `_fetch_all_paginated(sb, "ad_metric_pack_map", "ad_id", ...)` (helper já existente em `supabase_repo.py`). A função usa `range(offset, offset + page_size - 1)` em loop até esgotar o resultado.

**Lições:**
1. Qualquer query contra tabelas de alto volume (`ad_metrics`, `ad_metric_pack_map`, `ads`) deve passar por `_fetch_all_paginated` — nunca `.execute()` direto. O cap não é configurável no client side; ele vem do servidor.
2. "Pack pequeno" não existe para essas tabelas: 1 pack do usuário real já gerou 5019 linhas no map (1914 ads × ~2,6 datas em média). O bug ficou latente porque packs de teste anteriores tinham menos.
3. Bugs causados por esse cap são **silenciosamente plausíveis**: a soma parcial não é zero nem absurdamente alta, então passa despercebida em revisão. Sempre conferir contra SQL direto quando há divergência com fonte externa (Ads Manager).

**Arquivos alterados:** `backend/app/services/supabase_repo.py` (`calculate_pack_stats_essential`).

---

## Supabase HTTP/2 — Conexões caem mid-request em bulk upserts (WinError 10054 / 10035)

**Data:** 2026-04-29

**Problema:** Após corrigir o cap de 1000 linhas, o refresh do mesmo pack falhou no batch 5 de 35 do `upsert_ad_metrics` com `httpx.ReadError: [WinError 10054] Foi forçado o cancelamento de uma conexão existente pelo host remoto`. O traceback nasceu em `httpcore/_sync/http2.py: _send_request_body`, durante a leitura de eventos HTTP/2 (controle de fluxo). A exceção subia até `PersistStageError` e abortava o job inteiro, deixando o pack com stats antigas (77k) e `ad_metric_pack_map` parcialmente atualizado.

**Causa raiz:** A sessão HTTP/2 com o Supabase (multiplexada via httpx + httpcore) é encerrada de forma transitória no meio do upload — pode ser pgbouncer matando conexão lenta, statement_timeout do Postgres, ou comportamento específico do TCP stack do Windows com HTTP/2. O socket fica inutilizável; uma nova request em conexão fresca funciona.

**Solução:** Envolver os três `.execute()` de `upsert_ad_metrics` em `with_postgrest_retry` (já existente em `app/core/supabase_retry.py`). O helper já cobre `httpx.ReadError`, `RemoteProtocolError`, `ConnectError`, `TimeoutException` e equivalentes do httpcore. Em loops, capturar variáveis via default arg (`lambda b=batch: ...`) para evitar late-binding.

**Lições:**
1. Qualquer `.execute()` que faz upload de payload não-trivial (multi-row upsert, jsonb pesado) deve usar `with_postgrest_retry`. Reads curtos geralmente não precisam.
2. `WinError 10054` / `10035` no dev local Windows são equivalentes funcionais de `ECONNRESET` / `EAGAIN` — todos transitórios, todos resolvem com retry.
3. Reduzir batch size NÃO é a primeira solução para drops transitórios — o problema não é tamanho, é a sessão HTTP/2 sendo encerrada. Retry-with-backoff resolve sem aumentar latência total no caso feliz.
4. Bugs anteriores acharam que `WinError 10035` era "não-fatal e ignorável". Em refresh real (com 35 batches sequenciais), 1 falha = job inteiro abortado. Tratar como sempre.

**Arquivos alterados:** `backend/app/services/supabase_repo.py` (`upsert_ad_metrics`).

---

## PostgREST — Cap silencioso de URL em `.in_()` (HTTP 400 "JSON could not be generated")

**Data:** 2026-04-29

**Problema (descoberto na mesma sessão de debugging do pack):** Após corrigir o cap de 1000 linhas em `calculate_pack_stats_essential`, dois novos sintomas apareceram:
1. Refresh do Pack 01 não atualizava as stats (continuava 77k)
2. Pack novo "El.29 - Captacao" criado com 1975 anúncios mostrava R$ 0,00 de spend, mesmo com `ad_metrics` populado corretamente

Logs revelaram:
```
WARNING [CALCULATE_PACK_STATS_ESSENTIAL] Erro ao buscar métricas para pack 27dd1bd4...:
{'message': 'JSON could not be generated', 'code': 400, 'details': "b'Bad Request'"}
```

**Causa raiz:** PostgREST serializa `.in_("col", [...])` na query string da URL. Cada ad_id da Meta tem ~18 chars. Com 1900+ ids, o `?ad_id=in.(...)` resultante passa de 32KB e o servidor rejeita com HTTP 400. O `try/except` em `calculate_pack_stats_essential` engolia a exceção, retornava `{}`, e o `job_processor` logava "best-effort" e seguia adiante — stats nunca eram salvas.

**Os dois bugs se mascaravam mutuamente:** antes da correção do cap de 1000 linhas, a query truncada do `ad_metric_pack_map` retornava só ~995 ad_ids únicos, gerando URL ~18KB que cabia (apertado). Quando o cap foi corrigido e a query passou a retornar os 1914 ids reais, a URL inflou pra ~35KB e estourou.

**Solução:** Aplicar o mesmo padrão de batching que `get_ads_for_pack` já usa (linha ~2287): dividir `ad_ids_in_pack` em lotes de 200, chamar `_fetch_all_paginated` uma vez por lote, acumular `metrics`. Captura via default arg (`def metrics_filters(q, _batch=batch_ad_ids)`) pra evitar late-binding na closure.

**Lições:**
1. Sempre presumir **duas camadas** de truncamento silencioso no PostgREST: tamanho da URL (request) E número de linhas da resposta (response). Resolver as duas juntas — paginação resolve só uma.
2. A mensagem de erro "JSON could not be generated" é enganosa — soa como problema de serialização do lado do servidor, mas em `.in_()` quase sempre é URL longa demais. Sempre suspeitar de tamanho da URL primeiro.
3. Bugs em camadas se mascaram. Corrigir um pode "criar" outro que sempre esteve lá. Não assumir que a primeira correção é suficiente — re-testar com volume real.
4. 200 é o batch size estabelecido no codebase para `.in_()` com ad_ids. Não inventar um número novo sem medir.

**Arquivos alterados:** `backend/app/services/supabase_repo.py` (`calculate_pack_stats_essential`).

---

## Meta video upload — Padronizado em chunked /act_{id}/advideos (start/transfer-loop/finish)

**Data:** 2026-04-29

**Problema:** "Duplicar campanhas" funcionava só com vídeos pequenos. Para arquivos médios/grandes (>1 GB), o caminho falhava sempre. A implementação tinha duas etapas:

1. **Não-resumável** — POST único em `/act_{id}/advideos` via `requests` (Linux) ou `curl.exe` subprocess (Windows). Limitado por HTTP 413 em ~1 GB.
2. **Fallback "resumable"** em `rupload.facebook.com/video-ads-upload/{ver}/{video_id}` — mas era ainda outro **POST único** com headers `offset`/`file_size` e o arquivo inteiro no body, com timeout de 30 min e zero retry. Falhava reliably:
   - Conexões HTTP/2 longas a CDN edges caem (NAT timeouts, proxies intermediários)
   - Sem GET para descobrir o offset atual após drop
   - Sem retry por chunk
   - `upload_url` retornado pelo `start` era capturado e ignorado (URL própria hardcoded)
   - Arquivo inteiro carregado em RAM (`upload_content.read()`)

**Causa raiz:** O design "single-shot" é incompatível com a realidade da rede em uploads longos. O nome "resumable" no código era enganoso — não havia resume, só um POST grande disfarçado.

**Solução:** Substituir os dois caminhos por um único orchestrator chunked espelhando o SDK oficial da Meta ([facebook-python-business-sdk/video_uploader.py](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/video_uploader.py)):

- `GraphAPI.upload_ad_video_chunked(act_id, file_name, file_source, file_size, on_progress, on_check_cancel)` — único entry point.
- Três métodos finos: `start_chunked_video_upload` (POST `/advideos` `upload_phase=start`), `transfer_video_chunk` (POST com `data=` form + `files={video_file_chunk}` multipart), `finish_chunked_video_upload`.
- Server-driven chunking: cada response de transfer retorna `start_offset`/`end_offset` do próximo chunk. Loop até `start_offset == end_offset`.
- **Recovery patterns** copiados do SDK oficial:
  - Subcode `1363037`: o body do erro contém `error_data.start_offset`/`end_offset` para retomar. Budget `max(file_size_mb // 10, 2)`.
  - `is_transient: true`: sleep 1s, retry mesmo chunk. Budget separado de 10.
- `_handle_graph_request` ganhou parâmetro `data=` (form fields) além do `json_payload=`.
- Callers: `CampaignBulkProcessor._upload_video` e `BulkAdProcessor._upload_single_media` (branch video) usam `_open_seekable_source(file_data)` que retorna `open(temp_path, 'rb')` ou `io.BytesIO(content)`.
- `on_check_cancel` chama `_heartbeat` entre chunks → cancelamento detectado em ≤1 chunk sem precisar da `_HeartbeatThread` antiga.
- **Removidos:** `upload_ad_video`, `upload_ad_video_curl` (subprocess curl no Windows não é mais necessário — chunks curtos não disparam o bug do urllib3 16KB-per-write), `start_video_upload`, `transfer_video_resumable`, `finish_video_upload`, `_HeartbeatThread`, `_ProgressStream`, `_is_request_entity_too_large`, `_upload_video_non_resumable`, `_upload_video_resumable`, `import platform`/`mimetypes`/`tempfile`/`subprocess`/`httpx` em graph_api.py.

**Lições:**
1. Quando a documentação da Meta lista um endpoint "resumable", verifique se o SDK oficial dela usa esse mesmo endpoint. Se o SDK usa outro caminho (ex.: chunked `/advideos`), siga o SDK — é o que está testado em escala.
2. "Single POST com offset header" não é resumable de verdade. Resumable real = chunks múltiplos + recuperação por offset retornado pelo servidor.
3. O subcode `1363037` da Meta é uma feature: o servidor te diz exatamente de onde retomar quando os offsets divergem (ex.: chunk parcialmente recebido). Tratar como "transient + offset corrigido", não como erro fatal.
4. O bug do urllib3 16KB-per-write (que motivou o curl subprocess no Windows) **não afeta requests curtos**. Cada chunk de upload é um POST independente que termina rápido — o socket nunca acumula buffer suficiente pra disparar o pathological behavior. Deletar o curl hack foi seguro.
5. Heartbeat thread em background era necessária quando o upload era um único bloqueio de 30 min. Com chunks (cada um <3 min), o callback `on_progress` per-chunk dá o mesmo efeito sem thread, sem race conditions, e com progresso real (`bytes_sent/file_size`).

**Arquivos alterados:**
- `backend/app/services/graph_api.py` — adicionado chunked flow, removidos 5 métodos obsoletos + 5 imports
- `backend/app/services/campaign_bulk_service.py` — `_upload_video` único, `_open_seekable_source`, removidos `_HeartbeatThread`, `_ProgressStream`, `_is_request_entity_too_large`, `_upload_video_non_resumable`, `_upload_video_resumable`
- `backend/app/services/bulk_ad_service.py` — branch video usa chunked, helpers `_open_seekable_source`/`_get_file_size` adicionados

---

## Sync de Leadscore — invalidação obrigatória de caches do Manager

**Data:** 2026-04-29

**Problema:** Usuário relatou que após atualizar o Leadscore de um pack, o Manager não exibia os novos valores até fazer logout/login. O sync persistia os dados em `ad_metrics` corretamente no Supabase.

**Causa raiz:** O caminho do leadscore (frontend) só despachava `pack-integration-updated`, cujo único listener (`useLoadPacks`) atualiza apenas `sheet_integration` (metadata: data do último sync, status). Nenhum cache de dados de ad era invalidado. Como `useAdPerformance`, `useAdPerformanceSeries` e `usePackAds` têm `staleTime: Infinity` (decisão registrada no commit `5a7bc05`), o React Query nunca refazia fetch automático. Logout/login resolvia porque destrói o `QueryClient` em memória.

Comparativamente, o caminho do **Meta refresh** já chamava `invalidatePackAds(packId)` + `invalidateAdPerformance()` corretamente.

**Solução:**

1. Novo callback `onSuccessInvalidate?: (packId) => void | Promise<void>` em `pollSheetsSyncJob.ts`, executado no completion path **antes** de `onPackIntegrationUpdated`.
2. Os dois call sites (`usePackRefresh.runPollSheetsSyncJob` e `useGoogleSyncJob.startSync` + `startSyncWithToast`) passam o callback chamando `invalidateAdPerformance()` + `invalidatePackAds(packId)` (ambas vindas de `useInvalidatePackAds`).
3. Quando `packId` é desconhecido (sync sem pack vinculado), só `invalidateAdPerformance()` é chamado.

**Arquivos alterados:**
- `frontend/lib/utils/pollSheetsSyncJob.ts` — adiciona callback `onSuccessInvalidate`
- `frontend/lib/hooks/usePackRefresh.ts` — wira invalidações em `runPollSheetsSyncJob`
- `frontend/components/ads/googleSheetsDialog/hooks/useGoogleSyncJob.tsx` — wira invalidações em `startSync` e `startSyncWithToast`

**Melhorias incluídas no mesmo trabalho:**

- **Resiliência HTTP/2 no RPC do importer:** `_execute_batch_update` (em `ad_metrics_sheet_importer.py`) agora envolve `sb.rpc("batch_update_ad_metrics_enrichment", ...).execute()` com `with_postgrest_retry` (4 tentativas). Antes, o retry manual cobria apenas timeouts lógicos do RPC; HTTP/2 transient drops (`RemoteProtocolError`, `ReadError` — ver memória `supabase_http2_transient_drops`) quebrariam o sync. O retry manual de timeout permanece como segunda camada.

- **Log limpo:** linhas totalmente vazias da planilha (típico de trailing rows) agora são puladas silenciosamente em `_parse_and_aggregate_rows` em vez de gerar warnings `Falha ao parsear data: ''`. Warnings de data malformada permanecem apenas quando há `ad_id` válido.

**Lição:** Quando uma view tem `staleTime: Infinity` por design, **toda** mutação backend que afeta dados dessa view precisa de uma invalidação explícita. Não basta despachar um event genérico — verifique que existe um listener real que invalide o `queryKey` correto. O caminho do Meta refresh é a referência canônica neste projeto.

---

## Pack stats — filtrar por `(ad_id, date)` via composite id, não só por `ad_id`

**Data:** 2026-04-29

**Problema (gap residual identificado após correções de cap/URL):** `calculate_pack_stats_essential` filtrava `ad_metrics` apenas por `.in_("ad_id", ad_ids_in_pack)`. Como `ad_metrics` é global por `(user_id, ad_id, date)` (não pack-escopado), ads compartilhados entre packs com date_ranges diferentes super-contavam spend. Cenário: ad_X em Pack A [D1-D14] e Pack B [D15-D30] → stats do Pack A somavam todas as datas de ad_X (D1-D30), incluindo D15-D30 que pertencem só ao Pack B.

Bug ficou silencioso por anos porque a truncação de 1000 linhas (corrigida hoje) sub-contava de forma mais agressiva, mascarando o over-count.

**Causa raiz:** `ad_metrics.id` é composto `{date}-{ad_id}` (gerado em `upsert_ad_metrics`, linha ~814). `ad_metric_pack_map` tem tuplas `(user_id, pack_id, ad_id, metric_date)`. A arquitetura intencional é: métricas globais deduplicadas + map por pack. Mas a query de stats não usava o map como filtro autoritativo — usava só os ad_ids extraídos dele.

**Solução:** Ler `(ad_id, metric_date)` do map filtrado por pack → reconstruir o composite id `{metric_date}-{ad_id}` → `.in_("id", batch_of_composite_ids)` em `ad_metrics`. Lotes de 200 (composite ids ~30 chars × 200 = ~6KB, dentro do limite de URL).

**Por que NÃO adicionar `pack_id` ao id de `ad_metrics`:** quebraria a dedup intencional do modelo (mesma (ad_id, date) seria armazenada N vezes, uma por pack que contém o ad). O `pack_id` filter pertence ao map, não às métricas.

**Gap #2 corrigido junto — `update_pack_ad_ids` agora faz MERGE em vez de replace:** refresh `since_last_refresh` traz só ads da janela recente; substituição purgava ads do range original. `pack.ad_ids` é usado por `delete_pack` (limpa ads/metrics órfãos) e `get_pack_thumbnail_cache` (thumbs do card) — replace causaria orfãos no delete e thumbs faltando. Função agora lê existing, faz union, escreve.

**Lições:**
1. `ad_metrics` é global por (user, ad_id, date) — pack ownership vive em `ad_metric_pack_map`. Qualquer agregação per-pack precisa passar pelo map como filtro autoritativo, não só por ad_id.
2. Composite ids existentes (`{date}-{ad_id}`) já dão o filtro exato necessário; reconstruir e filtrar por `.in_("id", ...)` é mais correto E mais barato que filtrar por ad_id (menos linhas trafegadas).
3. Mutações de campo "lista" (como `pack.ad_ids`) em fluxos parciais (refresh) devem ser merge por padrão — replace só quando explicitamente intencional. Default não-destrutivo previne regressões silenciosas em código que lê o campo.

**Arquivos alterados:** `backend/app/services/supabase_repo.py` (`calculate_pack_stats_essential`, `update_pack_ad_ids`).

---

## Manager — endpoints `/children` por ad_name e adset_id agora suportam `pack_ids`

**Data:** 2026-04-29

**Problema:** Na tela "Criativos" do Manager, a linha-pai (agrupada por `ad_name`) já era pack-filtrada via RPC `fetch_manager_rankings_core_v2`, mas ao expandir as variações filhas, todas as variações desse `ad_name` em qualquer pack do usuário apareciam misturadas. Exemplo reportado: card mostrava "ADNI05 — R$ 149,12" (correto pra El.29 - Captação), mas a primeira variação expandida tinha R$ 4.447,98 (de outro pack que continha o mesmo criativo). O bug existia também em `/rankings/adset-id/{adset_id}/children` (tab "Por conjunto").

**Causa raiz:** Os endpoints `get_rankings_children` (linha ~1539) e `get_adset_children` (linha ~2028) consultavam `ad_metrics` direto por `ad_name` (ou `adset_id`) + `date` range, sem nenhum filtro de pack. Diferente do RPC do parent (que aceita `p_pack_ids`), esses endpoints não tinham o parâmetro.

**Solução:**
1. Helper compartilhado `supabase_repo.get_pack_metric_ids(sb, user_id, pack_ids, date_start, date_stop)` que lê `(ad_id, metric_date)` do `ad_metric_pack_map` filtrado por pack e reconstrói os composite ids `{date}-{ad_id}` que `ad_metrics.id` usa.
2. Ambos endpoints aceitam `pack_ids: List[str]` opcional via `Query`. Quando fornecido, substituem o filtro `ad_name=X + date BETWEEN ...` por `id IN (composite_ids do pack)`, em lotes de 200 (URL ~6KB). Quando ausente, mantêm comportamento legado.
3. Frontend: `useAdVariations` e `useAdsetChildren` agora aceitam `packIds`; `ExpandedChildrenRow` propaga `selectedPackIds` do `MinimalTableContent`/`TableContent` (que já tinham o array no escopo via `ManagerTable`); `endpoints.ts` serializa via `URLSearchParams` (FastAPI espera múltiplos `pack_ids=` na query).

**Lições:**
1. Sempre que tem RPC parent suportando `pack_ids`, conferir se os endpoints children têm o mesmo. Aqui ficaram dois meses divergentes — só apareceu quando o usuário olhou as variações.
2. `useCampaignChildren` já era pack-aware (servia de modelo). `useAdVariations` e `useAdsetChildren` ficaram pra trás. Lição: ao replicar padrão "endpoint+hook+queryKey+caller", checar todos os irmãos do mesmo cluster (children).
3. queryKeys com pack scope: incluir `packIdsKey` (sorted-joined) na chave evita cache hit cruzado entre packs. Default `''` mantém compat com callers sem packs.

**Arquivos alterados:**
- `backend/app/services/supabase_repo.py` — novo helper `get_pack_metric_ids`
- `backend/app/routes/analytics.py` — `get_rankings_children`, `get_adset_children`
- `frontend/lib/api/endpoints.ts` — `getRankingsChildren`, `getAdsetChildren`
- `frontend/lib/api/hooks.ts` — `useAdVariations`, `useAdsetChildren`, `queryKeys`
- `frontend/components/manager/ExpandedChildrenRow.tsx` — prop `packIds`
- `frontend/components/manager/{TableContent,MinimalTableContent}.tsx` — passa `selectedPackIds`
- `frontend/components/ads/AdDetailsDialog.tsx` — passa `[]` (preserva all-packs)

---

## Sweep completo de pack-scoping em todos os agregadores de `ad_metrics`

**Data:** 2026-04-29

**Contexto:** Após corrigir os children endpoints e `calculate_pack_stats_essential`, fizemos uma auditoria completa do backend pra fechar o resto da classe de bug "agregar ad_metrics sem pack filter → over-count em ads compartilhados".

**Endpoints fechados nesta passada (5):**
- `/rankings/ad-id/{ad_id}` (`get_ad_details`)
- `/rankings/ad-id/{ad_id}/history` (`get_ad_history`)
- `/rankings/ad-name/{ad_name}/details` (`get_ad_name_details`)
- `/rankings/ad-name/{ad_name}/history` (`get_ad_name_history`)
- `/rankings/adset-id/{adset_id}` (`get_adset_details`)

Todos seguem o mesmo padrão das correções anteriores: `pack_ids: Optional[List[str]] = Query(default=None)`; quando fornecido, usa `supabase_repo.get_pack_metric_ids` pra montar composite ids do pack e filtra `ad_metrics` por `.in_("id", batch_de_200)`. Quando ausente, mantém legacy (todos os packs do user) — preserva uso fora de contexto Manager.

**Função interna refatorada:** `supabase_repo.get_ads_for_pack` deixou de fazer date-range scan em `ad_metrics` e passou a ler ad_ids únicos do `ad_metric_pack_map` filtrado por `pack_id`. Mantém os filtros em memória (campaign.name / adset.name / ad.name com CONTAIN/EQUALS) — só troca a fonte do ad_ids. Callers (transcription job, `GET /analytics/packs?include_ads=true`, `GET /analytics/packs/{pack_id}?include_ads=true`) não precisaram mudar.

**Frontend — propagação de `selectedPackIds`:**
- Hooks (`useAdDetails`, `useAdHistory`, `useAdNameDetails`, `useAdNameHistory`) aceitam `packIds: string[] = []` como 4º arg, antes do `enabled`. queryKeys incluem `packIdsKey` sorted-join.
- `endpoints.ts` serializa `pack_ids` via `URLSearchParams` em todos os 5 endpoints novos + `getAdsetDetails` (que estava sendo chamado direto sem hook).
- `AdDetailsDialog` e `AdsetDetailsDialog` aceitam prop `packIds`; ManagerTable passa `selectedPackIds` quando renderiza esses dialogs.
- `BaseKanbanWidget.modalProps` ganhou campo `packIds`. `GemsWidget`, `InsightsKanbanWidget`, `GoldKanbanWidget` aceitam prop `packIds` e propagam ao modalProps. As páginas `/insights` e `/gold` passam `Array.from(selectedPackIds)`.
- `sharedAdDetail.useSharedAdNameDetail` já lia `selectedPackIds` do `useFilters()` — agora propaga para `useAdNameDetails` (Explorer fica pack-scoped).

**Migration:** nenhuma. Índice existente `ad_metric_pack_map_user_pack_date_ad_idx` em `(user_id, pack_id, metric_date, ad_id)` cobre todas as queries com index-only scan.

**Lições:**
1. Ao identificar uma classe de bug arquitetural ("X precisa filtrar por pack"), varrer TODOS os endpoints/funções da mesma classe — fixar dois e deixar outros cinco abertos vira regressão escondida.
2. Hooks que ganham parâmetro novo entre args existentes (ex: `packIds` antes de `enabled`) podem quebrar callers silenciosamente em TypeScript se a tipagem for boolean-aceitando-array. Pesquisar TODOS os callers e atualizar antes de mergear.
3. Componentes "wrapper" (`BaseKanbanWidget`, `*KanbanWidget`) precisam de prop drilling explícito — não dá pra contar com Context se a árvore atravessa fronteiras de feature.

**Arquivos alterados:**
- Backend: `routes/analytics.py` (5 endpoints), `services/supabase_repo.py` (`get_ads_for_pack`)
- Frontend: `lib/api/{endpoints,hooks}.ts`, `components/ads/{AdDetailsDialog,AdsetDetailsDialog}.tsx`, `components/manager/ManagerTable.tsx`, `components/common/BaseKanbanWidget.tsx`, `components/insights/{GemsWidget,InsightsKanbanWidget}.tsx`, `components/gold/GoldKanbanWidget.tsx`, `lib/ads/sharedAdDetail.ts`, `app/{insights,gold}/page.tsx`

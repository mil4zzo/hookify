# Decisões Técnicas — Hookify

Registro de decisões de arquitetura, abordagens escolhidas e lições aprendidas ao longo do desenvolvimento. Serve como guia para evitar retrabalho e esclarecer o "por quê" por trás de soluções não óbvias.

> Este arquivo é espelho da memória do Claude (`memory/meta_video_access.md` etc.). Ao criar, atualizar ou remover uma entrada, faça nos dois lugares.

---

## Eixo Y de retenção precisa de ancestrais overflow-visible

**Data:** 2026-05-31

**Regra:** o eixo Y de retenção (0%–100%) do `AdDetailsDialog` é desenhado **fora** da borda esquerda do player, em `left-[-2rem]` (no `RetentionChartOverlay` e no `RetentionVideoPlayerSkeleton`). O contêiner do vídeo deve reservar `ml-8` à esquerda e permanecer `overflow-visible`. Qualquer ancestral com `overflow-hidden`/`overflow-y-auto` corta o eixo.

**Por quê:** caso real — uma edição adicionou `overflow-hidden bg-black rounded-lg` ao contêiner do player (para frame preto arredondado) e o eixo sumiu no player e no skeleton. O `VideoPlayer` já aplica `bg-black rounded-lg overflow-hidden` internamente, então clipar no wrapper externo era redundante **e** quebrava o eixo.

**Como aplicar:** `overflow-hidden bg-black` só no caso **imagem** (`isImageAd`); no vídeo, contêiner com `ml-8 rounded-lg` sem `overflow-hidden`, deixando o `VideoPlayer` cuidar do clip/fundo. Ao embutir `RetentionVideoPlayer` em qualquer lugar, garantir ancestrais `overflow-visible`.

**Arquivos:** `frontend/components/ads/AdDetailsDialog.tsx` (contêiner do player + `VideoTabSkeleton`); `frontend/components/common/RetentionVideoPlayer.tsx`; `frontend/components/common/VideoPlayer.tsx`; `frontend/components/charts/RetentionChartOverlay.tsx`.

---

## conversion_types: materializar como metadado do pack em vez de RPC no read-path

**Data:** 2026-05-31

**Regra:** a lista de conversion types do dropdown do Manager é **materializada** em `packs.conversion_types text[]` (migration 081) via **union incremental monotônico** no refresh, e o frontend deriva o dropdown da **união dos packs selecionados** (metadado que já vem no payload de `/analytics/packs`). Não calcular no read-path.

**Por quê:** o endpoint dedicado `fetch_available_conversion_types_v1` (`/analytics/conversion-types`) não era leve de verdade — varre `ad_metrics` do range + `DISTINCT ON` + unnest (~10s) — e, por rodar sob `service_role` (que tem `statement_timeout` **menor** que `authenticated` neste projeto), estourava `statement_timeout` (57014) onde o rankings (sob authenticated) passava em 17s. Conversion types mudam devagar (só quando entram `ad_metrics` novos = no refresh), então o custo certo é compute-on-write. Bônus: os packs já são carregados em toda tela pelo PacksLoader → dropdown vira `union(packs selecionados.conversion_types)`, zero request/RPC, instantâneo em qualquer página.

**Como aplicar:**
1. **Union INCREMENTAL, nunca recompute completo no refresh.** Um refresh de "últimos 2 dias" não enxerga tipos só presentes em dias antigos; recompute apagaria opções válidas. Acumula, nunca remove (self-healing). Scan completo só no backfill (migration 081).
2. Write-path: `_union_pack_conversion_types` em `upsert_ad_metrics` (já recebe `pack_id`) extrai `'conversion:'|'action:' || action_type` dos `formatted_ads` em memória e faz read-modify-write union (best-effort, não derruba refresh). Seguro sem RPC atômico porque refresh do mesmo pack é serializado por job lease.
3. Read-path é grátis: `list_packs` usa `select("*")` e a rota retorna dict cru (sem response_model) → campo passa direto. Frontend: `AdsPack.conversion_types` + map em `useLoadPacks` + dropdown no Manager.
4. Mudança de semântica aceita: dropdown reflete o pack inteiro (all-range), não o sub-range. Selecionar tipo sem dados no range mostra zeros — ok.
5. Endpoint dedicado + RPC ficam deprecados (não removidos — fallback manual).

**Lição geral:** para lookup derivado que muda devagar, materializar no write-path > RPC dedicada no read-path. E atenção: `service_role` tem `statement_timeout` menor que `authenticated` aqui — a escolha do cliente (`get_supabase_service()` vs JWT do user) muda o timeout efetivo, não só RLS.

**Arquivos:** `supabase/migrations/081_add_conversion_types_to_packs.sql`; `backend/app/services/supabase_repo.py` (`_extract_conv_keys`, `_union_pack_conversion_types`, call em `upsert_ad_metrics`); `frontend/lib/types/index.ts`; `frontend/lib/hooks/useLoadPacks.ts`; `frontend/app/manager/page.tsx`.

---

## Logout durante carga: guard de auth deve ceder navegação + queries pesadas precisam de AbortSignal

**Data:** 2026-05-30

**Regra (parte 1 — tela de login travada):** o guard de auth `useRequireAuth` **não pode** disparar `router.replace('/login')` concorrente durante um logout — precisa checar `getIsLoggingOut()` e ceder a navegação ao fluxo dono (`handleLogout` / `AuthSessionExpiredHandler`), que redireciona com o param correto (`?logout=true` / `?expired=true`).

**Regra (parte 2 — timeouts 57014):** os hooks de query pesada de analytics (rankings, ad-performance, conversion-types, series, retention) devem threadar o `signal` do TanStack Query (`queryFn: ({ signal }) => api...(params, { signal })`) até o `apiClient.post(url, data, { signal })`.

**Por quê:** caso real — logout durante o carregamento do Manager travou na tela de login (só "Entrar / Carregando...", form nunca aparece, URL `/login` limpa) **e** deixou requests pesados rodando no backend por 16–31s, estourando `statement_timeout` (57014) com 500 + Sentry. Duas causas independentes:
1. **Corrida de redirects.** `handleLogout` navega via `window.location.href = '/login?logout=true'`, mas no instante em que a sessão vira `null` o guard do Manager dispara `router.replace('/login')` **sem** o param. O `?logout=true` existe pra o middleware não rebater `/login → /packs` enquanto os cookies residuais do Supabase ainda não limparam. Sem ele: middleware rebate pra `/packs` → sem sessão → rebate pra `/login?redirect=/packs`, colidindo com o `window.location.href` → tela meio-carregada/travada.
2. **Soft-cancel não aborta HTTP.** `handleLogout` chama `queryClient.cancelQueries()`, que só impede novos fetches — não aborta o HTTP em-voo. Sem o `signal` threadado, o backend segue executando a RPC abandonada até o timeout. Sinal de contenção (não query patológica): um rankings falhou em 31s enquanto outro passou em 29s, e o conversion-types "leve" levou 16s.

**Como aplicar:**
1. Redirect client-side de guard durante transição de sessão deve checar `getIsLoggingOut()` (de `lib/api/client.ts`) e abortar se true. O param na URL de `/login` não é cosmético — o middleware o usa.
2. Threadar `signal` em toda query pesada faz `cancelQueries()` virar abort de HTTP real → libera o DB no logout e some o ruído de 500/Sentry de requests abandonados. Endpoints aceitam `options?: { signal?: AbortSignal }`.
3. O interceptor de resposta silencia `axios.isCancel(error)` — cancelamento não é erro (sem log/Sentry/toast).
4. **Não resolve** o storm estrutural de RPCs pesadas concorrentes no mount do Manager (3× rankings + 2× conversion-types + pack-details) — esse continua sendo item de fundo a perfilar/serializar.

**Arquivos:** `frontend/lib/hooks/useRequireAuth.ts` (early-return se `getIsLoggingOut()`); `frontend/lib/api/endpoints.ts` (param `options.signal` nos analytics POSTs); `frontend/lib/api/hooks.ts` (queryFn passa `{ signal }`); `frontend/lib/api/client.ts` (silencia `axios.isCancel`).

---

## docker-compose `environment:` sobrescreve `env_file:` com vazio

**Data:** 2026-05-10

**Regra:** quando um service do compose tem `env_file: ../backend/.env`, **não duplicar as mesmas variáveis em `environment:`** com `- VAR=${VAR}`. A precedência é `environment > env_file`. Se `${VAR}` resolver para string vazia (porque `deploy/.env` não existe e o shell não exportou), o vazio **sobrescreve** o valor que vinha do `env_file`.

**Por quê:** caso real — login no VPS começou a entrar em loop com 401 em `/facebook/connections`, `/analytics/packs`, `/onboarding/status`. `/health` passava (não exige auth). Causa: as 12+ linhas `- SUPABASE_URL=${SUPABASE_URL}` etc. no compose expandiam contra `deploy/.env` (inexistente). Container subia com `SUPABASE_URL=""`, `SUPABASE_JWKS_URL=None`, e JWT validation falhava. Sintoma diagnóstico no output do `docker compose`: `WARN[0000] The "X" variable is not set. Defaulting to a blank string.` para cada var listada como `${X}`.

**Como aplicar:**
1. **Vars de runtime do backend** (Supabase, OAuth, API keys) ficam SÓ em `env_file: ../backend/.env`. Bloco `environment:` lista apenas vars hardcoded (ex.: `CORS_ORIGINS=https://...`) ou com defaults (`${LOG_LEVEL:-info}`).
2. **Build args do Next** (`NEXT_PUBLIC_*`, `SENTRY_*`) NÃO podem vir de `env_file` — build acontece antes do runtime. Eles precisam de `deploy/.env` ou de vars exportadas no shell.
3. **Atalho no VPS:** `ln -sf ../frontend/.env.local deploy/.env` se os valores são os mesmos.
4. **Detecção rápida:** `docker compose config` mostra o valor renderizado que vai pro container. Var vazia ali = esse bug.

**Arquivos:** `deploy/docker-compose.yml` (limpeza); `deploy/ENV_TEMPLATE.md` (seção "Deploy - deploy/.env" documentando o `deploy/.env` para build args).

---

## Toast terminal de erro precisa de ícone de contexto (senão parece "loading")

**Data:** 2026-05-10

**Regra:** ao chamar `finishProgressToast(toastId, false, message)` no frontend, **sempre** passar `{ context: "meta" | "sheets" | "transcription", packName }`. Sem `context`, o `ProgressToastCard` ficava sem ícone e caía no fallback `IconLoader2 animate-spin` — toast vermelho com spinner girando, lido pelo usuário como "ainda processando" em vez de erro.

**Por quê:** caso real — transcrição falhava no VPS por `ASSEMBLYAI_API_KEY` não configurada (metadata em `ad_transcriptions.metadata.error_message`). As 4 chamadas de `finishProgressToast` no fluxo de transcrição (`failed`, `onTimeout`, `onMaxConsecutiveErrors`, `catch` de `startTranscriptionOnly`) não passavam `context`, e a mensagem do backend era genérica (`"Transcrição falhou: 1 falha(s)"`), sem mencionar a causa raiz.

**Como aplicar:**
1. Qualquer novo `finishProgressToast(_, false, _)` deve passar `context` + `packName` no options.
2. Para erros sistêmicos (API key, scope OAuth, timeout), incluir também `diagnosticLine` — renderiza em mono-space abaixo da mensagem principal e dá pista pra suporte.
3. **Backend de jobs em batch:** quando o batch termina como `FAILED`, capturar `last_error_message` durante o loop e incluí-lo tanto no `message` final do heartbeat quanto em `details.last_error_message`. "X falha(s)" sem causa raiz é inútil pro usuário.
4. Reforço extra: `ProgressToastCard` agora também tem fallback `IconAlertCircle` quando `inlineError=true` sem `icon` — defensivo, mas não substitui passar o `context` correto.

**Arquivos:** `frontend/components/common/ProgressToastCard.tsx` (fallback de erro); `frontend/lib/hooks/usePackRefresh.ts` (4 callsites de transcription); `backend/app/services/transcription_worker.py:374-394` (`last_error_message` capturado e propagado).

---

## Otimização "skip se já tem campo X" depende do SELECT do helper de leitura

**Data:** 2026-05-07

**Regra:** ao introduzir uma otimização que pula trabalho com base na presença de um campo X no estado existente (e.g. "se já tem `video_owner_page_id`, não re-enriquece"), o helper que carrega esse estado **precisa** incluir X no `SELECT`. Caso contrário, X estará ausente do dict, `.get("X")` retorna None, o trigger sempre dispara, e a otimização nunca acontece — sem nenhum erro visível.

**Por quê:** caso real em `backend/app/services/supabase_repo.py:get_existing_ads_map`. O `select_fields` listava 16 colunas mas omitia `video_owner_page_id`. O `AdsEnricher.enrich` (linha 498-502) usava ausência desse campo como gatilho de re-enriquecimento. Resultado: TODO refresh re-enriquecia 100% dos ads existentes (e.g. 766 ads em pack `e19c454c`), mesmo com o DB tendo o campo 100% preenchido (confirmado por SQL: 7072 ads, todos `filled`). Métrica `enrichment_total` no payload do job ficava sempre 0. Custo: 1 round-trip Meta `/details` por refresh, eternamente.

**Como aplicar:**
1. Ao introduzir um novo campo em uma tabela cujo helper-de-leitura faz `SELECT` explícito (não `*`), conferir e atualizar o `SELECT` no MESMO PR.
2. Code review de otimizações condicionais: traçar o caminho `DB → SELECT → dict → trigger`. Se qualquer elo intermediário não carrega o campo, a otimização é morta-viva.
3. **Sintoma de detecção em produção:** contadores de "reuso/cache hit" sempre 0 com volume crescente sem outra explicação. Confronte log do app com SQL real do DB — divergência de 100% delata o bug.
4. **Não substituir** `SELECT` explícito por `select("*")` só por segurança — a explicitação é boa prática. A vigilância tem que estar no review.

**Arquivos:** `backend/app/services/supabase_repo.py:1122-1128` (fix: incluir `video_owner_page_id`); `backend/app/services/ads_enricher.py:498-502` (consumidor do trigger).

---

## `with_postgrest_retry` absorve deadlocks 40P01 (Meta upsert vs Leadscore RPC)

**Data:** 2026-05-06

**Regra:** o helper `with_postgrest_retry` em `backend/app/core/supabase_retry.py` agora detecta SQLSTATE `40P01` (deadlock_detected) via `.code`, `.details.code` ou string da exception e faz retry com backoff exponencial e jitter de 0–400ms (vs 0–100ms para HTTP/2 drops). Aplica-se automaticamente a todos os callers existentes — não precisa tratar 40P01 manualmente.

**Por quê:** confirmado por log do Postgres que `upsert_ad_metrics` (INSERT bulk do Meta refresh) e `batch_update_ad_metrics_enrichment` (UPDATE bulk do Leadscore sync) podem deadlockar quando rodam concorrentes sobre `ad_metrics`. Mesmo com `ad_id` disjuntos entre packs (zero overlap em `ad_metric_pack_map`), há contenção a nível de página/índice quando os 6 packs com `auto_refresh=true` + `sheet_integration_id` rodam em sequência rápida — o `BackgroundTasks` do FastAPI cria janela onde leadscore RPC do pack N ainda processa enquanto Meta upsert do pack N+1 começa.

**Por que retry é seguro:** as duas operações escrevem em **colunas disjuntas** de `ad_metrics`:
- Meta UPSERT: `clicks, impressions, spend, hook_rate, ctr, actions, ...` + `updated_at`
- Leadscore RPC: apenas `leadscore_values` + `updated_at`

E **nenhuma faz read-modify-write** — ambas escrevem valores absolutos vindos de fontes externas (Meta API / Sheet). Postgres mata uma das tx (ROLLBACK 100%, atomicidade garante zero estado parcial); a vítima retry roda contra o estado da vencedora e converge para o mesmo resultado final, independente da ordem. Sem perda de dado nem sobrescrita de versão mais nova.

**Como aplicar:**
1. Para fluxos que escrevem em `ad_metrics` ou `ad_metric_pack_map`, sempre envolver em `with_postgrest_retry` — caso contrário ficam expostos ao deadlock.
2. Se aparecer `falha persistente apos 4 tentativas` no log com `kind=deadlock`, suspeitar de deadlock determinístico (raríssimo) — investigar query.
3. **Não confundir com overlap real de chave:** se múltiplos jobs upsertam **mesmas** linhas, o caminho é serialização (advisory lock por `user_id`), não retry. Retry só cobre conflito a nível de página/índice em rows disjuntos.

**Arquivos:** `backend/app/core/supabase_retry.py` (`_is_deadlock`, retry expandido); cobertura automática em `backend/app/services/supabase_repo.py:968,1038` (Meta upserts) e `backend/app/services/ad_metrics_sheet_importer.py:370` (Leadscore RPC).

---

## Meta `/copies` — valida targeting mais estrito que `/adsets`

**Data:** 2026-05-04

**Regra:** `/copies` em adset aplica validação de `targeting` mais estrita que `create_adset`. Adsets rodando ativamente, criados via Ads Manager e aceitos sem problema, podem falhar `/copies` com subcode `2490392` ("Você também deve selecionar o Explorar do Instagram") — `instagram_positions: [..., 'explore_home']` sem `'explore'` junto.

**Por quê:** descoberto empiricamente. Source aceito por `create_adset`/Ads Manager passa pela validação mais permissiva; `/copies` rejeita pela mesma config. **Não mutar source** — é dado do usuário, está rodando, e mudar `instagram_positions` mudaria comportamento das ads em produção (passariam a aparecer também no Explore principal, não só Explore Home).

**Como aplicar:**
1. Tentar `/copies` primeiro (caminho feliz, código simples).
2. Se falhar com subcode `2490392` + `'instagram_positions'` em `blame_field_specs`: cair para `create_adset` manual.
3. Buscar config completa do source via GET, normalizar targeting localmente (`['explore'] + ig`), POST `/act_X/adsets` com a config corrigida.
4. Source intocado — apenas o payload novo é normalizado.

**Não generalizar:** outros subcodes de validação propagam. Não voltar a fazer `create_adset` pra tudo — é fallback narrow só pro caso específico.

**Arquivos:** `backend/app/services/campaign_bulk_service.py:_copy_adset_with_targeting_normalization`.

---

## Meta `/copies` — limite <3 entidades em modo sync

**Data:** 2026-05-04

**Regra:** `POST /{id}/copies` da Meta em modo síncrono rejeita com subcode `1885194` ("A solicitação de cópia é muito grande") se o **total** de campanhas + adsets + ads a copiar for **>= 3**. Em duplicação via `/copies`, **nunca usar `deep_copy=true`** em campanhas com adsets/ads reais.

**Por quê:** descoberto empiricamente ao tentar duplicar campanha com 3 adsets via `deep_copy=true`. Total = 1 campanha + 3 adsets + N ads >= 4 entidades = bloqueado. A mensagem do Meta sugere `asynchronous-batch-requests` como alternativa, mas isso é overkill — iterar é mais simples e correto.

**Como aplicar:**
1. `POST /{campaign_id}/copies` com `deep_copy=false` → copia shell vazia (1 entidade ✓)
2. Para cada adset que quer copiar: `POST /{source_adset_id}/copies?campaign_id={new}&deep_copy=false` → copia adset sem ads (1 entidade ✓)
3. Para cada ad: `POST /{source_ad_id}/copies?adset_id={new_adset}` → 1 entidade ✓
4. Aplicar PATCHs (nome, status, schedule) entre as cópias.

**Bônus de simplicidade do `deep_copy=false` iterativo:**
- Sem polling de async session — cada chamada é 1 entidade, síncrona.
- Sem mapeamento `source_adset` — resposta retorna direto o id da nova entidade.
- Sem deletar adsets não-selecionados — só copia o que vai usar.
- Sem deletar ads copiados — nem copia em primeiro lugar.

**Arquivos:** `backend/app/services/campaign_bulk_service.py` (`_create_single_campaign`); `selected_adsets_meta` no payload carrega `{id, name, end_time}` por adset.

---

## Meta API — Nunca chutar nome de campo, sempre validar no SDK

**Data:** 2026-05-04

**Regra:** Para qualquer chamada à Meta Graph API, **sempre confirmar nomes de campo em fonte oficial antes de incluí-los** numa requisição. Nunca codificar com base em "acho que esse campo existe" ou extrapolando de blog post.

**Por quê:** Ao adicionar `is_smart_promotion` (que parecia óbvio) na lista de fields de `get_campaign_config`, o Meta retornou `(#100) Tried accessing nonexisting field (is_smart_promotion)` e derrubou o endpoint `/facebook/campaign-template/{ad_id}` com 502 em produção. O campo correto era `smart_promotion_type` (legacy ASC/AAC) + `advantage_state_info{advantage_state}` (Advantage+ unificado). Um único campo chutado = endpoint inteiro inutilizado.

**Como aplicar:**
1. **Fonte canônica primária:** SDK Python oficial em `https://raw.githubusercontent.com/facebook/facebook-python-business-sdk/main/facebook_business/adobjects/<node>.py`. A classe `Field` lista todos os campos readables — se não tá lá, não pede no `?fields=`.
2. **Para parâmetros de POST/PATCH:** ler o `param_types` dict do método relevante no SDK (`create_*`, `update_*`, `create_copy`).
3. **Para enums** (status_option, optimization_goal, etc.): inner classes do SDK (ex.: `Campaign.StatusOption`).
4. **Doc HTML do Meta** (`developers.facebook.com/docs/marketing-api/reference/...`) é boa pra contexto, mas trunca via WebFetch — usar como complementar, não como única fonte.
5. **Marcadores de Advantage+ que existem:** `smart_promotion_type` (legacy: `AUTOMATED_SHOPPING_ADS`/ASC, `SMART_APP_PROMOTION`/AAC) e `advantage_state_info{advantage_state}` (`ADVANTAGE_PLUS_SALES`/`APP`/`LEADS`/`DISABLED`). **Que não existem:** `is_smart_promotion`, `is_advantage_plus`, `ad_strategy_id`.
6. **`GUIDED_CREATION` ≠ Advantage+** (descoberto empiricamente em 2026-05-04): valor `GUIDED_CREATION` em `smart_promotion_type` apenas indica que a campanha foi criada via fluxo guiado da Meta — pode ser tanto Advantage+ quanto tradicional. Campanha tradicional com `advantage_state=DISABLED` e `smart_promotion_type=GUIDED_CREATION` é caso comum. **Bloquear apenas pelo `GUIDED_CREATION` quebra duplicação de campanhas comuns.** Detecção correta de Advantage+ ativo é via `advantage_state` ∈ `{ADVANTAGE_PLUS_SALES, ADVANTAGE_PLUS_APP, ADVANTAGE_PLUS_LEADS}`.

**Custo:** Validar 1 campo no SDK leva ~30s. Endpoint quebrado em produção custa muito mais — incluindo a confiança do usuário em mudanças futuras.

---

## Thumbnails — sempre Storage cache, nunca Meta CDN

**Data:** 2026-05-02

**Regra:** Backend nunca expõe `thumbnail_url` cru do Meta para o frontend. Todo endpoint que retornar info de ad com thumbnail deve usar `_resolve_ad_thumbnail_url(row)` em `backend/app/routes/facebook.py` — que retorna URL gerada do `thumb_storage_path` no Supabase Storage, ou `None` se ainda não houver cache.

**Por quê:** Os links da Meta CDN (`thumbnail_url`) expiram silenciosamente em horas/dias. Quando expostos ao frontend, imagens "somem" sem erro visível, parecendo bug de loading intermitente. O cache em Supabase Storage é a única fonte estável.

**Como aplicar:**
- Endpoints novos: chamar `_resolve_ad_thumbnail_url(ad)` — não fazer `ad.get("thumbnail_url")` direto, e não duplicar a lógica inline em outros endpoints.
- Frontend: tratar `thumbnail_url: null` como "sem cache ainda" e renderizar placeholder cinza, não como erro.
- A função NÃO tem fallback para Meta CDN (removido em 2026-05-02 após bug em `TranscriptionStatusDialog` mostrar links expirados).

**Arquivos:** `backend/app/routes/facebook.py:73`

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

---

## Meta API — Compliance fields obrigatórios no clone de adsets para países regulados

**Data:** 2026-04-30

**Problema:** Ao duplicar campanhas via "Duplicar campanhas" (upload page), `create_adset` falhava com subcode `3858495` e `error_data: {"blame_field_specs":[["compliance_section"]]}`. A mensagem ao usuário em português dizia "Taiwan" mesmo com targeting no Brasil (mensagem genérica/confusa da Meta).

**Causa raiz:** Meta exige campos de compliance nos adsets que miram países regulados. Existem **dois conjuntos distintos** de campos:

- **EU (DSA):** `dsa_beneficiary`, `dsa_payor`
- **TW, BR, SG, AU, IN, TH:** `regional_regulated_categories`, `regional_regulation_identities`

Os adsets fonte têm esses campos preenchidos (por isso rodam). Nosso `get_adsets_for_campaign` não listava nenhum dos dois conjuntos no `fields=`, e o `ADSET_CLONE_FIELD_KEYS` também não os incluía — logo o novo adset era criado sem eles e a Meta rejeitava.

A primeira tentativa de fix (apenas `dsa_*`) **não resolveu** porque o targeting era Brasil, que usa `regional_regulation_identities`, não `dsa_*`. O erro voltou e o `blame_field_specs=["compliance_section"]` foi a pista decisiva — `compliance_section` é nome da seção da UI da Meta, não um campo real da API. Os campos reais são `regional_regulated_categories` e `regional_regulation_identities`.

O bug estava latente mas só surfacou após a correção do upload chunked (que pela primeira vez permitiu que jobs com vídeos maiores chegassem à etapa de criação de adsets).

**Solução (final, 4 campos):**
1. Adicionados `dsa_beneficiary,dsa_payor,regional_regulated_categories,regional_regulation_identities` ao `fields=` em `get_adsets_for_campaign` ([graph_api.py](../backend/app/services/graph_api.py))
2. Adicionados os mesmos 4 ao `ADSET_CLONE_FIELD_KEYS` em [meta_campaign_clone.py](../backend/app/services/meta_campaign_clone.py)

**Regras para o futuro:**
- Sempre que adicionar campos ao `ADSET_CLONE_FIELD_KEYS`, também adicioná-los ao `fields=` de `get_adsets_for_campaign`. As duas listas devem ficar em sincronia.
- Em erros da Meta com `blame_field_specs`, cuidado com nomes de **seção da UI** (`compliance_section`) que não são campos reais da API. Buscar quais campos da API compõem aquela seção.

**Atualização 2026-05-02 — UX proativa (flag persistida + bloqueio na UI):**

Tentativas adicionais (copy endpoint, fetch de `default_dsa_beneficiary` na conta, hardcode de países regulados) falharam ou eram frágeis. Insights chave:
- A regra é aplicada pelo Meta **por conta**, com critérios próprios — não puramente por país. Hardcodar `BR/TW/SG/AU/IN/TH` é imprudente.
- A identidade de compliance (`universal_beneficiary`/`universal_payer`) é uma entidade Meta Business, **não derivável** de nenhum campo único do ad account (`business`, `owner_business`, `promoted_pages` todos retornam null ou IDs distintos).
- Adsets antigos (criados antes da exigência) genuinamente não têm os campos preenchidos. Não há como injetá-los automaticamente — o usuário precisa editar o adset original no Gerenciador da Meta.

**Abordagem final:**
1. **Reativa no backend** ([campaign_bulk_service.py](../backend/app/services/campaign_bulk_service.py)): try/except em `create_adset`. No `subcode == 3858495`:
   - `UPDATE ad_accounts SET requires_ads_transparency = true` (best-effort)
   - Re-raise `MetaAPIError("adset_missing_compliance", ...)` com mensagem clara
2. **Proativa no frontend** ([app/upload/page.tsx](../frontend/app/upload/page.tsx)): `/campaign-template/{ad_id}` agora retorna `account_requires_ads_transparency` e `has_ads_transparency` por adset. Frontend pré-seleciona apenas adsets compliantes, bloqueia "Continuar" se zero adsets forem compliantes, e mostra banner explicativo.
3. **Schema:** `ad_accounts.requires_ads_transparency boolean NOT NULL DEFAULT false` (migration 080). Nunca limpa automaticamente — Meta não retira a exigência uma vez aplicada.

**Arquivos alterados:**
- `supabase/migrations/080_add_requires_ads_transparency_to_ad_accounts.sql` (novo)
- `backend/app/{schemas,routes/facebook,services/campaign_bulk_service}.py`
- `frontend/{lib/api/schemas.ts,app/upload/page.tsx}`

---

## TanStack Query — Patch in-place vs invalidate broad em mutations de status

**Data:** 2026-05-01

**Sintoma:** Logs de produção mostrando `statement timeout` (Postgres 57014) na RPC `fetch_manager_rankings_core_v2` quando o usuário fazia toggles rápidos de status de ad. O usuário não percebia erro visual (toast de sucesso aparecia normalmente), mas algumas queries ficavam stale silenciosamente.

**Causa raiz: amplificação de requests por invalidação broad.**

Hierarquia do problema:
1. `useAdStatusControl.onSuccess` chamava `qc.invalidateQueries({ queryKey: ["analytics","rankings"], refetchType: "active" })`
2. O prefixo `["analytics","rankings"]` casa com **9+ query keys distintas** (`adVariations`, `adDetails`, `adCreative`, `adHistory`, `adNameDetails`, `adNameHistory`, `campaignChildren`, `adsetChildren`, `rankings`/`adPerformance`)
3. Múltiplos componentes da Manager assinam variações com params diferentes (`limit=10000` vs `limit=1`, `group_by=ad_id` vs `group_by=ad_name`)
4. Com `refetchType: "active"`, **todas** as queries ativas refazem em paralelo imediatamente
5. 1 toggle → ~6 refetches paralelos. 5 toggles em ~20s → ~30 hits concorrentes na mesma RPC → Postgres mata por timeout

**Solução:** Patch in-place via `qc.setQueriesData` em vez de `invalidateQueries`. Status toggle não muda métricas — só `effective_status` da row daquele ad. Helper `patchAdStatusInCaches` walk cega-shape (lida com `Item[]`, `{data: Item[]}`, single `Item`) e atualiza apenas rows com `ad_id` matching.

**Decisão de escopo:**
- `entityType === "ad"` → patch in-place, **zero refetch** de rankings
- `entityType === "adset"` / `"campaign"` → mantém invalidate broad (cascade `ADSET_PAUSED`/`CAMPAIGN_PAUSED` nos filhos é difícil de inferir client-side; toggles de adset/campaign são raros e não amplificam)
- `["facebook","me"]` → mantém invalidate (cache pequeno e barato)

**Arquivos alterados:** [frontend/lib/hooks/useAdStatusControl.ts](../frontend/lib/hooks/useAdStatusControl.ts) — novo helper `patchAdStatusInCaches` + branch por `entityType` no `onSuccess`.

**Regra geral aplicável:** Antes de usar `invalidateQueries` em uma mutation, perguntar: "essa mutation muda métricas/dados agregados ou só um campo derivado/display?" Se for só display, prefira `setQueriesData` para evitar amplificação. O custo de manter invalidação broad é proporcional a (componentes ativos) × (frequência da ação).

---

## Eliminação da probe de `available_conversion_types` (D + C + B)

**Data:** 2026-05-01

**Sintoma:** A cada load do Manager, 3 queries quase-idênticas para `/analytics/ad-performance` saíam em paralelo. A 3ª (`limit=1, include_available_conversion_types=true, include_leadscore=false`) servia apenas para popular o dropdown de actionType no topbar antes da Query 1 (`limit=10000`) terminar. O ganho de UX era real (~1s antes), mas o backend pagava o custo completo da agregação no `fetch_manager_rankings_core_v2_base_v060` (LIMIT é aplicado só no final das CTEs).

**Causa raiz:** O RPC pesado é monolítico — não tem fast-path para "só me dê os conversion types". E não havia persistência client-side de lookup data raramente-mutável.

**Solução tripla, em ordem D → C → B:**

### D — Logging enriquecido ([backend/app/routes/analytics.py](../backend/app/routes/analytics.py))

Logs `[rankings] request_start`, `rpc_success`, `rpc_failed` agora incluem: `include_available_conversion_types`, `limit`, `action_type`, `is_probe` (flag derivada), `act_count` (tamanho do array retornado). Permite detectar regressões futuras (ex: alguém adicionar uma 4ª query, ou probe deixar de ser usada).

### C — Persistência seletiva via TanStack persister ([frontend/components/providers/ReactQueryProvider.tsx](../frontend/components/providers/ReactQueryProvider.tsx))

- `PersistQueryClientProvider` envolvendo o root, com `createSyncStoragePersister` (localStorage)
- `dehydrateOptions.shouldDehydrateQuery`: filtra **apenas** `["analytics", "conversion-types", ...]` — métricas dinâmicas NUNCA são persistidas
- `maxAge: 7d`, `buster: "hookify-2026-05-01"` (constante — bumpar para invalidar tudo)
- Cross-user safety: queryKey do `useConversionTypes` inclui `user_id` da sessão Supabase

### B — RPC + endpoint dedicado para cache miss

**Migration nova:** [`supabase/migrations/079_fetch_available_conversion_types_v1.sql`](../supabase/migrations/079_fetch_available_conversion_types_v1.sql)

A função `fetch_available_conversion_types_v1` copia **verbatim** os filtros e dedup do v060 ([schema.sql:3819-3863](../supabase/schema.sql#L3819-L3863)) — mesma cláusula `WHERE` (date, account_ids, ILIKE name filters, pack_ids via `EXISTS` em `ad_metric_pack_map`), mesmo `DISTINCT ON (user_id, ad_id, date)` com mesmo `ORDER BY` tie-break. Reduz custo de ~500ms para <50ms.

**Filtros intencionalmente omitidos:** `p_action_type`, `p_campaign_id` — não afetam o universo de conversion types disponíveis.

**Permissões:** `SECURITY DEFINER` + `REVOKE EXECUTE FROM anon, authenticated` + `GRANT EXECUTE TO service_role` (alinhado com migration 078).

**Endpoint backend:** `POST /analytics/conversion-types` em [analytics.py](../backend/app/routes/analytics.py).

**Frontend:** novo hook `useConversionTypes` em [hooks.ts](../frontend/lib/api/hooks.ts) com `staleTime: 24h`, `gcTime: 7d`. Manager ([manager/page.tsx:271](../frontend/app/manager/page.tsx#L271)) mantém fallback `convTypesData?.available_conversion_types || managerData?.available_conversion_types` — se o endpoint dedicado falhar, dropdown ainda popula via Query 1.

**Resultado esperado:**
- Sessão repetida (cache hit do persister): **0 requests** para conversion types — popula instantaneamente do localStorage
- Cache miss (filtros novos, primeiro acesso): chama endpoint dedicado em <50ms vs ~500ms anteriores
- Probe pesado em `/analytics/ad-performance` com `limit=1` desaparece dos logs

**Validação crítica antes de deploy:** rodar `SELECT fetch_available_conversion_types_v1(...)` e `SELECT (fetch_manager_rankings_core_v2(...))->'available_conversion_types'` lado a lado para o mesmo (user, packs, date range). Arrays devem ser **idênticos** (mesmo conteúdo, mesma ordem). Se divergir, NÃO migrar.

**Regra geral aplicável:** quando uma probe (`limit=1`) é usada apenas para extrair metadata de uma RPC pesada, é sinal de que a RPC precisa de um fast-path ou de uma RPC dedicada. Combinada com persistência seletiva via TanStack, vira "0 requests no caso comum, request leve no caso raro".

---

## Refresh de Pack — Meta → (Leadscore ∥ Transcrição) sequencial

**Data:** 2026-05-02

**Problema:** Usuário relatou que o Leadscore "não atualiza no primeiro refresh do dia". Abria o app, aceitava o modal de auto-refresh dos 5 packs, e dados de leadscore vinham incompletos. Refresh manual subsequente trazia os dados corretos.

**Causa raiz** (confirmada pelos logs em produção): em [usePackRefresh.ts](../frontend/lib/hooks/usePackRefresh.ts), Meta refresh, Leadscore sync e Transcrição rodavam **em paralelo** via `Promise.allSettled`. Leadscore termina em ~30s (read planilha + RPC `batch_update_ad_metrics_enrichment`), enquanto Meta leva minutos polling. O RPC do Leadscore atualiza linhas existentes em `ad_metrics`; o Meta refresh é quem **cria** essas linhas para ads recém-ativos. Mesma lógica vale para Transcrição: ads novos só aparecem em `ads` depois do Meta upsert. Resultado: Leadscore/Transcrição consultavam o estado antes de Meta popular → ads novos passavam batido silenciosamente até o próximo refresh manual.

**Evidência nos logs:** em todas as 5 integrações analisadas, `not_found` do Leadscore caía entre run 1 e run 2 do mesmo dia (ex: integração `42a78a69` 220→63, `1866f259` 162→63, `e53e30c0` 140→63). Os ~50–150 ads "rescatados" no run 2 são exatamente os que o Meta refresh criou no intervalo.

**Solução:** Meta roda primeiro dentro de uma async IIFE. Leadscore e Transcrição rodam em paralelo entre si, mas só **depois** que Meta concluir com sucesso. Se Meta falhar ou for cancelado pelo usuário, **ambos abortam** com warning específico no console (`[PACK_REFRESH] Leadscore abortado / Transcrição abortada para pack X: Meta não concluiu com sucesso`). Dados parciais não justificam confusão.

**Edge cases:**
- Quando `toggles.meta === false` (usuário escolhe rodar só dependentes via modal de toggles), `metaSucceeded` começa `true` e Leadscore/Transcrição rodam normalmente em paralelo — não há gating contra Meta que não foi pedido.
- Cancelamento individual de Leadscore (`sheetsCancelled`) ou Transcrição (`transcriptionCancelled`) continua respeitado independentemente.

**Arquivos alterados:** [frontend/lib/hooks/usePackRefresh.ts](../frontend/lib/hooks/usePackRefresh.ts) — única mudança de código.

**Call-sites cobertos automaticamente:** os 3 entry points convergem em `refreshPack` e herdam o gating sem mudança própria — modal de auto-refresh ([useAutoRefreshPacks.ts](../frontend/lib/hooks/useAutoRefreshPacks.ts)), página /packs ([packs/page.tsx](../frontend/app/packs/page.tsx)) e ícone do topbar ([Topbar.tsx](../frontend/components/layout/Topbar.tsx)).

**Tradeoff:** tempo total de refresh por pack vira `meta + max(leadscore, transcrição)` em vez de `max(meta, leadscore, transcrição)`. Como Meta domina (minutos vs ~30s), o overhead percebido é ~10–15% — aceitável em troca de dados consistentes no primeiro refresh.

**Regra geral aplicável:** orquestração de jobs paralelos só é segura quando **nenhum job lê dados que outro está escrevendo**. Aqui, Meta era escritor de `ad_metrics`/`ads` e Leadscore/Transcrição eram leitores — relação produtor-consumidor que exige sequenciamento. Antes de paralelizar processos, mapear quem cria/modifica vs quem lê cada tabela.

---

## Design System — Opacidade: hífen para tokens do projeto, slash para cores default do Tailwind

**Data:** 2026-05-02

**Regra:** Existem **duas famílias de cores** no projeto, com **sintaxes diferentes** para opacidade. Escolher a sintaxe certa depende de qual família a cor pertence.

### Família 1 — Tokens semânticos do projeto → **hífen**

Tokens definidos em [frontend/tailwind.config.ts](../frontend/tailwind.config.ts) via `alphaScale(cssVar)`: primary, destructive, success, muted, accent, border, input, ring, warning, info, attention, foreground, background, card-foreground, popover-foreground, brand, chart-1..5, etc.

`alphaScale()` gera tokens nomeados nos passos `[5, 10, 20, 30, 40, 45, 50, 60, 70, 75, 80, 82, 88, 90, 95]`, cada um expandindo para `color-mix(in oklab, var(--token) N%, var(--background))` — uma **mistura com a superfície**, não alpha transparency.

**Por que hífen e não slash:** comentário no próprio config: *"Evita `transparent` em color-mix (OKLab trata transparent como preto sem alpha e pode virar branco)."* Usar `/N` faria Tailwind aplicar transparência alpha, que sob interpolação OKLab pode renderizar como preto/branco em vez do tom mixed esperado.

| ✅ Correto | ❌ Evitar |
|---|---|
| `bg-primary-10` | `bg-primary/10` |
| `border-border-50` | `border-border/50` |
| `hover:bg-destructive-10` | `hover:bg-destructive/10` |
| `bg-muted-30` | `bg-muted/30` |

Passos disponíveis: apenas os definidos em `alphaSteps` — 5, 10, 20, 30, 40, 45, 50, 60, 70, 75, 80, 82, 88, 90, 95.

### Família 2 — Cores default do Tailwind → **slash**

Cores padrão (white, black, gray, slate, zinc, red, blue, green, yellow, amber, orange, purple, pink, indigo, cyan, teal, emerald, lime, rose, violet, fuchsia, sky, etc.) são RGB-based e suportam o modificador nativo `/N` do Tailwind sem problemas de OKLab.

| ✅ Correto |
|---|
| `bg-black/60` |
| `text-white/90` |
| `bg-white/20` |
| `dark:bg-amber-900/20` |
| `hover:bg-black/70` |

❌ `bg-black-60` resolveria para nada — esses tokens não existem na config.

**Já em uso confirmado:** AdPlayArea, ExplorerPage, RetentionVideoPlayer, MetricHistoryChart, SlotUploadZone, CreativePreview, etc.

### Como decidir

1. Identifique a cor: é do `tailwind.config.ts` (semântica, do tema do app) ou da paleta default do Tailwind?
2. Semântica → hífen. Default → slash.
3. Se em dúvida, conferir `tailwind.config.ts` — qualquer cor que passa por `alphaScale()` é hífen.

**Inconsistências existentes:** alguns arquivos antigos usam slash em tokens semânticos (`bg-muted/40` em [QuotaGauges.tsx](../frontend/components/meta-usage/QuotaGauges.tsx) e [MetaUsageTable.tsx](../frontend/components/meta-usage/MetaUsageTable.tsx)). São desvios, não a convenção — não replicar.

---

## Cross-type media adaptation no upload de campanhas

**Data:** 2026-05-03

**Problema:** A duplicação de campanhas falhava com `error_code=media_type_mismatch` quando o tipo do arquivo (image/video) não batia com o tipo esperado pelo slot do template. Usuário batia em hard-fail mesmo quando a Meta API aceitava perfeitamente o tipo enviado nos placements relevantes.

**Investigação:** Confirmado via documentação Meta que image ads são suportados em Instagram Reels (9:16, 1440×2560, JPG/PNG, max 30 MB), Stories+Reels combinado, Feed, etc. A restrição no Hookify era infundada.

**Decisão:** Adaptar silenciosamente em vez de bloquear. Detectar o tipo real do arquivo no upload e construir o `object_story_spec` apropriado:
- Template tem `video_data` + upload é imagem → converte para `link_data` preservando `message`/`call_to_action`/`name`/`description`; resolve `link` via `resolve_creative_destination_url`
- Template tem `link_data` + upload é vídeo → mantém `link_data` shape com `video_id` (Meta aceita)
- Bare-spec (sem link/photo/video data) + upload é imagem → `photo_data` (não exige `link`)
- `AssetFeedCreativeBuilder`: dispatch de `videos`/`images` por tipo real de cada asset (não por `template.media_slots[0].media_type`); rules reescritas com `target_key` apropriado

**Gates removidos** (substituídos por log informativo):
- [backend/app/routes/facebook.py:207-211 e 219-223](../backend/app/routes/facebook.py#L207) — pré-validação no endpoint
- [backend/app/services/campaign_bulk_service.py:90-94](../backend/app/services/campaign_bulk_service.py#L90) — `_map_slot_files_to_template`
- [backend/app/services/bulk_ad_service.py:513-518](../backend/app/services/bulk_ad_service.py#L513) — `_build_creative_params`

**Por que não restringir Reels:** verificado que image ads são suportados em Reels — minha suposição inicial era infundada. Documentação Meta confirma.

**Por que adaptação silenciosa (sem warning UI):** usuário pediu IDEAL — flexibilidade transparente. Se feedback indicar surpresa, podemos adicionar hint no `SlotUploadZone` depois.

---

## Smart retry button — categorização de erros no bulk

**Data:** 2026-05-03

**Problema:** Botão "Tentar novamente" aparecia em erros determinísticos onde retry nunca funciona (compliance, bundle incompleto, template inválido). Frustrava usuário.

**Decisão:** Categorizar cada `MetaAPIError` em uma de 4 categorias e expor ao frontend para escolher a ação certa:
- `retryable` — transient (timeout, 5xx, `is_transient`, subcode 1363037): botão "Tentar novamente"
- `template_replaceable` — precisa trocar template/bundle (`adset_missing_compliance`, `bundle_missing_slot`, `template_missing_slots`, `unsupported_template_family`, etc): botão "Selecionar outro modelo"
- `auth` — code 190, TokenExpiredError: hoje sem botão dedicado (Topbar mostra)
- `fatal` — Meta retornou OK sem ID, indeterminado: sem botão

**Implementação:** `MetaAPIError.__init__` ganhou kwarg `category`. Default mapping vive em `derive_error_category(error_code, subcode, raw_error)` em [meta_api_errors.py](../backend/app/services/meta_api_errors.py). Endpoints `/campaign-bulk/{job_id}` e `/bulk-ads/{job_id}` derivam `error_category` em runtime — sem migration de DB.

**Frontend:** [`CampaignProgressView`](../frontend/app/upload/page.tsx) coleta categorias dos itens com erro; prioridade `template_replaceable > retryable > nenhum`. `template_replaceable` chama `onSelectNewTemplate` (volta pra step 1, preserva creatives já uploadados).

**Idempotência confirmada:** retry endpoint copia `media_refs` do payload; processor pula re-upload via `_upload_all_media` cache.

---

## Performance + robustez no upload chunked de vídeos

**Data:** 2026-05-03

**Problema:** Bulk de 100 items + uploads de >1 GB sofrem com (a) ~200 heartbeat DB writes por GB de vídeo, (b) 0.2s de sleep proativo após **cada** chamada Meta (5 calls × 100 items = 100s overhead), (c) polling fixo de 5s no `_wait_for_video_ready`.

**Mudanças:**

1. **Heartbeat throttle 1/seg** ([campaign_bulk_service.py:_ThrottledCallback](../backend/app/services/campaign_bulk_service.py)): wrapper que limita `tracker.heartbeat()` a 1/seg wallclock. `.flush()` no final do upload pra UI não travar em 99%.

2. **Rate-limit reativo** ([graph_api.py:_handle_graph_request](../backend/app/services/graph_api.py)): floor `META_RATE_LIMIT_DELAY_SECONDS` 0.2 → 0.05; em HTTP 429, backoff exponencial (1s, 2s, 4s) com até 3 retries; honra `Retry-After` quando Meta envia. Token bucket per-account NÃO implementado (overkill para workflow sequencial atual).

3. **Polling adaptativo** ([campaign_bulk_service.py:_wait_for_video_ready](../backend/app/services/campaign_bulk_service.py) + [bulk_ad_service.py:_wait_for_video_ready](../backend/app/services/bulk_ad_service.py)): intervalo cresce 2s → 1.5× → 10s; exige **2 leituras consecutivas** de `video_status in {ready, active}` antes de retornar (Meta às vezes flipa ready→error em finalização de encoding).

**Out of scope (deferido):**
- Paralelismo intra-bundle (complexidade vs ganho)
- Cleanup de assets órfãos no Meta (vídeo upload OK + creative create FAIL)
- Streaming de image upload (RAM) — só importa para imagens >100 MB

**Regra geral aplicável:** quando um design system define tokens semânticos via `color-mix` para evitar bugs de gamut (OKLab/transparent), o sistema **substitui** o modificador opacity nativo do Tailwind para essa família — mas **não afeta** cores default que continuam usando a sintaxe original. Sempre identifique a família da cor antes de aplicar opacidade.

---

## Async insights `Job Failed 0%` mascarando scope OAuth incompleto

**Data:** 2026-05-08

**Problema:** Pack El.29 - Captação CA5 em `act_1088942488268239` falhava sistematicamente com `async_status=Job Failed`, `async_percent_completion=0`, e o GET de status do job retornava sem campo `error`. Outros packs do mesmo usuário em outros ad accounts atualizavam normalmente. Mesmo payload (fields, time_range, filtering) rodado no Graph API Explorer com o mesmo app `Hookify Ads` selecionado completava normalmente.

**Diagnóstico:**

1. Descartado quota — `meta_api_usage` mostrou `cputime_pct=1`, `regain_access_minutes=null`, `estimated_time_to_regain_access=0`, tier `standard_access`.
2. Descartado payload — `filtering=[{campaign.name CONTAIN "DOR29] [CAP"}, {NOT_CONTAIN "TESTE"}]` rodou síncrono no Explorer e retornou data válida.
3. Descartado conta — outros packs em outros acts funcionavam com o mesmo token salvo.
4. `GET /act_1088942488268239?fields=name` com token salvo retornou `(#3) AdAccount must pass GK: plr_beta_gk_existing_feature` — Gate Keeper interno da Meta.
5. Comparação com Explorer (mesmo app `Hookify Ads`, permissões `ads_management, ads_read, business_management, pages_read_engagement, email, pages_show_list` granted) confirmou que era state do token, não do app.

**Causa raiz:** desde 2018 a Meta tornou quase todos os scopes opcionais com checkbox na tela de consent OAuth. Durante o OAuth original do Hookify, o usuário não marcou (ou desmarcou) `business_management`. O token salvo autenticava normalmente, lia ad accounts pessoais e ad accounts de Business onde o scope não é exigido — mas falhava em queries async no `act_1088942488268239` porque essa conta pertence a uma Business Manager que exige `business_management` para ler dados via API.

**Por que o sintoma é tão enganoso:**
- `start_ads_job` faz checagem rasa de scope (`ads_read`) e aceita o pedido com HTTP 200 + `report_run_id`.
- Worker async re-valida no nível do ad account, dispara o GK e mata o job.
- Como a falha é via GK interno (não OAuth), Meta não popula `error` no status response. Sintoma idêntico a quota/throttle.

**Como confirmar:** `GET /me/permissions` com o token salvo decriptado. Se `business_management` aparecer com `status=declined` (ou ausente da lista), é scope incompleto.

**Solução para o usuário afetado:** reconectar Facebook via fluxo `?reauth=true` (já existente em [connectors_facebook.py:69](../backend/app/routes/connectors_facebook.py)), e na tela de consent **marcar todos os scopes**.

**Solução estrutural (proposta):** após callback OAuth, validar que scopes críticos (`business_management`, `ads_management`) vieram `granted`; se não, marcar a connection como `degraded` e exigir reauth antes de qualquer refresh de pack.

**Lição:** `Job Failed 0%` sem `error` é três coisas em ordem de probabilidade — quota/throttle, payload inválido, e **scope OAuth faltando**. Antes de assumir as duas primeiras, testar o mesmo payload no Explorer com app igual + token regenerado. Se Explorer funciona e backend não, o token salvo é o suspeito — mas pode ser scope, não expiração.

---

## Landing de waitlist `/waitlist` e o padrão de rota pública de 3 pontos

**Data:** 2026-06-01

**Contexto:** criada a landing de captação de early access em `/waitlist` (tom de exclusividade/vagas limitadas), reaproveitando o design system existente (tokens semânticos + shadcn) em vez do default dark-saas do gerador.

**Captura de lead:** tabela `public.waitlist` (migration `083_create_waitlist_table.sql`) com RLS de **INSERT para `anon`/`authenticated`, sem policy de SELECT**. O formulário client (`components/waitlist/WaitlistForm.tsx`) insere direto via `getSupabaseClient()` (publishable key) — sem endpoint backend. Dedup por índice único em `lower(email)`; duplicata retorna `23505` e o front trata como "você já está na lista". Ninguém lê a lista pelo cliente (só service_role/dashboard).

**Lição — rota pública = 3 pontos coordenados:** todas as rotas são protegidas por padrão. Para uma rota pública nova é preciso atualizar **três** listas independentes, e esquecer qualquer uma quebra silenciosamente:

1. `frontend/middleware.ts` → `PUBLIC_ROUTES` (senão redireciona pro `/login`).
2. `frontend/components/layout/AppLayout.tsx` → `isPublicRoute` (senão herda Sidebar/Topbar/BottomNav do app autenticado).
3. `frontend/scripts/check-design-system.ts` → `RULE_ALLOWLIST` (páginas de marketing usam `Card` raw; `opengraph-image.tsx` em edge/satori exige hex literal — não enxerga CSS vars). Precedente seguido: entradas `pv|waitlist` nas regras de COLOR_RULES (OG image) e DIRECT_PRIMITIVE/SKELETON/INLINE_NOTICE (pasta).

**Observação operacional:** a migration `083` ainda precisa ser aplicada no banco remoto para o formulário persistir de verdade.

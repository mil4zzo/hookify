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

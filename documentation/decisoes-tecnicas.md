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

# Plano — Upgrade da Graph/Marketing API v24.0 → v26.0

Documento vivo. Mapeia o que o app usa da Meta, o que muda de v24 para v26 e o grau
de complexidade/risco de cada item. Atualizar o **Status** a cada etapa.

Aberto em 2026-10-31. Origem: ao reconstruir a duplicação de campanha
(`plano-duplicacao-de-campanha.md`) descobrimos que o app inteiro roda na v24.0, que
chegou ao fim de vida para Marketing API (changelog da Meta: 2026-10-06 numa página,
2026-11-10 em outra). A Meta também faz **upgrade automático** de versão em Marketing
API desde 2026-07-29 — ou seja, o comportamento de v25/v26 pode já estar chegando em
chamadas que a gente acha que são v24.

---

## Status

| Etapa | O quê | Estado |
|---|---|---|
| 0 | Inventário do que o app usa (este documento, seções 2–3) | ✅ |
| 1 | Cruzamento com changelog v25/v26 (seções 4–5) | ✅ feito em 2026-10-31 (fonte = resumos; ver ressalvas) |
| 2 | Duplicação de campanha em v26 (já feita, falta validar na Meta real) | 🟡 código pronto, sem teste real |
| 2.1 | Teste de contrato (`tests/test_meta_api_contract.py` + `fixtures/meta_api_contract.json`, 49 de 50 métodos do `GraphAPI`; sabotado 2×: campo removido e URL com versão à mão — ambos pegos) | ✅ 2026-11-01 |
| 2.2 | Script de diferencial (`scripts/meta_version_diff.py`, só leitura) rodado na conta act_1088942488268239: 13 consultas; **12 idênticas** (login/permissões, contas, páginas, insights async 1226 linhas com totais iguais, atribuição, orçamento, status, enriquecimento, vídeo); **1 quebra só na v26**: `GET /?ids=` → #100 "ids query parameter is deprecated in v26.0+" (na v24 ainda funciona) | ✅ 2026-11-01 |
| 2.4 | `fetch_ig_media_types` migrado para Batch API (`_batch_graph`); diferencial real v24 antigo × v26 novo em 158 mídias: 157/157 idênticas; `tests/test_ads_enricher_igm.py` (sabotado, pego) | ✅ 2026-11-01 |
| 2.3 | `.env` da VPS: `FACEBOOK_AUTH_BASE_URL` / `FACEBOOK_TOKEN_URL` fixadas em v24 **removidas** pelo idealizador; entram no próximo deploy (comportamento idêntico até a virada) | ✅ 2026-11-01 |
| 2.5 | Teste de ESCRITA real em v26 (`scripts/meta_write_smoke.py`, conta act_1088942488268239, tudo pausado e apagado no fim): duplicação (caminho cópia E plano B forçado), status, orçamento — **todos verdes** depois de 2 correções medidas: `media_sourcing_spec` (subcode 4931013) e melhorias Advantage+ explícitas na cópia (`video_filtering` nascia OPT_IN) | ✅ 2026-11-01 |
| 2.6 | Migrations **182 e 183 aplicadas em produção** (2026-11-01); conferido: `bulk_ad_items` e 17 jobs legados fora, tabelas novas com RLS, anon sem leitura; `schema.sql`/`schema_map.md` regenerados | ✅ 2026-11-01 |
| 2.7 | **Deploy em produção (commit a51120e, 2026-11-01)**, app ainda em v24 (duplicação em v26): backend+frontend saudáveis, 0 erros nos logs, `/campaign-launch` 401 / `/facebook/bulk-ads` 404, `.env` sem versão fixada. O deploy achou 2 buracos de build do trabalho de idiomas (lockfile incompatível com npm 10; `Dockerfile.frontend` sem `COPY messages/`) — corrigidos | ✅ 2026-11-01 |
| 3 | Troca "só o número" (seção 5, classe A) — virada: `META_API_VERSION=v26.0` no `.env` da VPS + recriar o container do backend (rollback: apagar a linha) | ⏳ |
| 4 | Itens com mudança de parâmetro/comportamento (classe B/C) | ⏳ |
| 5 | Teste em conta real + virada da variável de ambiente em produção | ⏳ |

---

## 1. Pendências já conhecidas (herdadas da duplicação de campanha)

Estas aparecem **só** quando a chamada vai em v26 e já valem para a feature nova
(`META_LAUNCH_API_VERSION=v26.0`):

1. **`advantage_audience` explícito na cópia de conjunto.** _(2026-11-01: não apareceu no teste real — o modelo testado não é Habitação/Emprego/Financeiro; segue pendente para essas contas.)_ Na v26, `POST
   /{adset_id}/copies` de campanha com público restrito (HEF) exige o campo. Hoje
   `_copy_adset` (`campaign_launch_service.py`) não envia. Se aparecer no teste real o
   item falha com a mensagem da Meta. Correção provável: ler `targeting_automation`
   do conjunto modelo e repassar. **Risco médio** — depende de ver o erro real.
2. **Posicionamentos removidos (Messenger Stories, Instagram Explore Feed).** Conjunto
   modelo que ainda usa esses posicionamentos pode ser recusado na cópia. O fallback
   `explore_home → explore` (`_create_adset_from_source`) precisa ser revisto: se
   "Explore Feed" deixou de existir, a regra que ele contorna pode ter mudado.
3. **`placement_registry.py`** (357 linhas) tem o catálogo de posicionamentos "da v24":
   revisar contra os valores válidos da v26 (afeta o rótulo dos slots de mídia).
4. **Validar na Meta real** que `POST /{ad_id}/copies` com `creative_parameters` é aceito
   em v26. Sem isso o fluxo cai no fallback manual (já coberto por teste).

---

## 2. Onde a versão está definida hoje

| Lugar | Detalhe | Classe |
|---|---|---|
| `backend/app/core/config.py:42` | `META_API_VERSION` (default `v24.0`) — fonte única; deriva `META_GRAPH_BASE_URL`, `FACEBOOK_AUTH_BASE_URL`, `FACEBOOK_TOKEN_URL` | A |
| `backend/app/core/config.py:46` | `META_LAUNCH_API_VERSION` (default `v26.0`) — só a duplicação de campanha | — |
| `deploy/ENV_TEMPLATE.md`, `deploy/README.md` | exemplos com `…/v24.0/dialog/oauth` e `…/v24.0/oauth/access_token` — **se o `.env` do servidor fixa essas duas URLs, a variável `META_API_VERSION` NÃO as muda** (override explícito) | A (atenção) |
| `backend/scripts/check_config.py:23`, `test_facebook_config.py:17` | URL v24.0 escrita à mão | A |
| `backend/app/routes/facebook.py:2070`, `graph_api.py:803,850` | só docstrings/comentários | A |
| `backend/app/services/placement_registry.py:2` | docstring "(v24.0)" — mas o **conteúdo** precisa de revisão (seção 1, item 3) | C |
| `frontend/lib/docs/metaDevReference.ts:7` | `META_CURRENT_VERSION = "v24.0"` — aparece na página `/docs` e no material de App Review | A |

**Armadilha de produção:** `FACEBOOK_AUTH_BASE_URL` e `FACEBOOK_TOKEN_URL` aceitam
override por variável de ambiente (`os.getenv(..., f"…{META_API_VERSION}…")`). Antes
de virar a versão, conferir no `.env` da VPS se essas duas estão definidas — se
estiverem, o login e a troca de token continuam em v24 mesmo com `META_API_VERSION=v26.0`.

---

## 3. Inventário do que o app chama (todas as chamadas passam pela versão global)

Todas as classes abaixo hoje saem de `GraphAPI.base_url` / `META_GRAPH_BASE_URL`.
**Nada no app fixa versão por chamada** além da duplicação de campanha.

### 3.1 Login e permissões (OAuth)
| Chamada | Onde | Observação |
|---|---|---|
| `GET /dialog/oauth` (redirect) | `routes/facebook.py:385`, `connectors_facebook.py:90` | escopos: `public_profile,email,ads_read,ads_management,pages_show_list,pages_read_engagement,business_management` (`config.py:61`) |
| `GET /oauth/access_token` (código → token; troca p/ longa duração) | `routes/facebook.py:4486`, `connectors_facebook.py:115` | |
| `GET /me`, `GET /me/adaccounts` | `graph_api.py:196,252` | campos: `adaccounts{name,id,account_status,user_tasks,instagram_accounts{username,id}}`, `currency` |
| `GET /me/permissions` | `facebook_scopes.py:39` | `CRITICAL_SCOPES` → marca conexão `degraded` |
| `GET /me/accounts` (token de página) | `facebook_page_token_service.py:130` | `fields=id,name,access_token` |

### 3.2 Relatórios de insights (o coração do app)
| Chamada | Onde | Observação |
|---|---|---|
| `POST /act_X/insights` assíncrono | `graph_api.py:305` (`start_ads_job`), `meta_job_client.py:107` | `level=ad`, `time_increment=1`, `action_breakdowns=action_type`, `action_attribution_windows=['7d_click','1d_view']`, `use_account_attribution_setting=true`, `filtering` por `ad.effective_status` |
| Campos pedidos | `graph_api.py:322` | `actions, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, clicks, conversions, cost_per_conversion, cpm, ctr, frequency, impressions, inline_link_clicks, reach, spend, video_play_actions, video_thruplay_watched_actions, video_play_curve_actions, video_p50_watched_actions, video_p75_watched_actions, website_ctr` |
| `GET /{report_run_id}` (status do job) | `meta_job_client.py` | lê `async_status`, `async_percent_completion`; usa `?fields=error_message` para achar a causa real de "Job Failed" (truque documentado em memória — comportamento **não** documentado pela Meta) |
| `GET /{report_run_id}/insights` (paginação) | `insights_collector.py:200` | segue `paging.next` |
| `GET /act_X/insights` nível conjunto | `graph_api.py:367` (`fetch_attribution_window`) | `fields=adset_id,attribution_setting` |

### 3.3 Leituras de entidades (anúncios, conjuntos, campanhas, criativos)
| Chamada | Onde | Campos sensíveis |
|---|---|---|
| Enriquecimento em lote `GET /act_X/ads?filtering=…` | `ads_enricher.py:296,448` | `creative{actor_id,body,call_to_action_type,instagram_permalink_url,…,effective_instagram_media_id,image_url,image_hash,asset_feed_spec,object_story_spec}`, `source_ad{creative{…}}`, `adcreatives` |
| Status em massa | `graph_api.py:1422–1660` | `effective_status`; batch (`relative_url`) e `filtering` |
| Orçamento | `graph_api.py:891` | `daily_budget,lifetime_budget,is_adset_budget_sharing_enabled` (campanha); `…,campaign_id` (conjunto) |
| Árvore da conta | `list_campaign_adsets_with_source` etc. | `source_adset{id}`, `source_ad{id}` |

### 3.4 Mídia
| Chamada | Onde | Observação |
|---|---|---|
| `GET /{video_id}?fields=source` / `from` | `graph_api.py:454–540` | URL do vídeo (perecível); `from` = página dona |
| `GET /{ig_media_id}?fields=media_url,children{media_url}` | `graph_api.py:489` | Instagram Graph via mesma base |
| `GET /act_X/adimages?hashes=` | `graph_api.py:679,752` | `hash,permalink_url,url,original_width,original_height` |
| `POST /act_X/advideos` (start/transfer/finish) | `graph_api.py:2101–2147` | upload em pedaços; subcode 1363037 |
| `POST /act_X/adimages` | `graph_api.py:2087` | |
| `GET /{video_id}` status / `…/thumbnails` | `graph_api.py:2068,2286` | `status{video_status,uploading_phase,processing_phase}` |

### 3.5 Escrita (gerenciar anúncios)
| Chamada | Onde | Observação |
|---|---|---|
| `POST /{id}` status (anúncio/conjunto/campanha) + verificação por leitura | `graph_api.py:800–880,1669` | pipeline "escreve → relê → persiste a verdade" |
| `POST /{id}` orçamento + batch | `graph_api.py:928,1107` | `daily_budget`/`lifetime_budget`, `adset_budgets` |
| `POST /{id}/copies` campanha / conjunto / anúncio | `graph_api.py:1904,1914,2047` | **já em v26** (duplicação) |
| `POST /act_X/adsets`, `/adcreatives`, `/ads`, `/campaigns` | `graph_api.py:1894,2001,2268,2277` | **já em v26** (fallbacks da duplicação) |

### 3.6 Erros e limites (transversal)
`meta_api_errors.py` (códigos 190, 1, 2, 4, 17, 32, 613, 80004; subcodes 1341012,
1487078, 1363037, 2490392, 3858495, 1885194), cabeçalho de uso (`log_meta_usage`,
`meta_api_usage`), `gk_retry` (recuo de "Job Failed" por GK). Mudança no **formato**
de erro ou nos códigos afeta tudo isso.

---

## 4. O que a Meta mudou, cruzado com o nosso código

Fonte: changelogs da Meta lidos em 2026-10-31 por uma ferramenta que **resume** a
página (não vimos o HTML cru). Tratar cada item como "provável, a confirmar no teste".
Onde os dois changelogs da Meta divergem, está dito.

**O que muda a urgência:** várias mudanças valem para **todas as versões** a partir de
27/10/2026 (hoje é 31/10). Ou seja, já podem estar afetando o app **na v24**, antes de
qualquer upgrade. A v24.0 sai do ar em **10/11/2026** (outra página da Meta diz
06/10 — não conciliadas), então a janela é de dias.

### 4.1 Já vale para a v24 hoje (não depende do upgrade)
| Mudança | Onde o app toca | Situação |
|---|---|---|
| `GET /?ids=a,b,c` na raiz passa a dar erro (protocolo legado removido; todas as versões em 27/10) | `ads_enricher.py:481` (`fetch_ig_media_types`): classifica mídia do Instagram em imagem/vídeo | 🔴 **Provavelmente já quebrado.** É melhor-esforço: não derruba o refresh, mas a classificação cai no plano B e pode errar imagem×vídeo. **Verificar nos logs de produção** (`[AdsEnricher] igm batch status=`) |
| Messenger Stories sai de `messenger_positions` (auto-removido; o campo some se só tinha `story`) | cópia de conjunto (duplicação) | 🟡 comportamento muda; checar no teste real |
| `advantage_audience` explícito em conjuntos de Habitação/Emprego/Financeiro com público restrito (27/10; outra página diz "data a definir") | cópia de conjunto | 🟡 só contas nessas categorias |
| Campanhas Advantage+ (ASC/AAC) não copiam | duplicação | ✅ já barrado (`advantage_plus_not_supported`) |
| Interesses de segmentação consolidados (jan/2026); conjunto com interesse extinto dá erro ao publicar | cópia de conjunto | 🟡 a Meta substitui por "interesses combinados" na cópia; conferir |
| Insights: `7d_view`/`28d_view` sem dados; `unique_*` e quebras por hora limitados a 13 meses | relatório de insights | ✅ **não usamos** (pedimos `7d_click` + `1d_view`; nenhum campo `unique_*`) |
| Quebras `dma`, `impression_device`, `frequency_value` | relatório | ✅ não usamos |
| `use_unified_attribution_setting` / `action_report_time` ignorados | relatório | ✅ não usamos (usamos `use_account_attribution_setting`) |
| Enquetes (`poll_spec`) e `applink_treatment=web_only` proibidos | criação de criativo/anúncio | ✅ cópia herda; só criamos criativo no fallback manual |
| `media_url` pode vir vazio em Reels com música protegida | `graph_api.py:489` | ✅ já tratado (devolve `None` e cai no plano B) |
| Tier de acesso da Marketing API mudou (nomes, regra de 500 chamadas/15 dias, erro < 15%) | app no painel Meta | 🟡 fora do código: conferir qual tier o app tem |

### 4.2 Só passa a valer ao subir para v26
| Mudança | Onde toca | Risco |
|---|---|---|
| Posicionamento **Instagram Explore Feed** removido: pedir explicitamente dá erro | cópia de conjunto; `_create_adset_from_source` (fallback `explore_home→explore`) | 🔴 conjunto modelo que ainda lista Explore Feed falha na cópia; o fallback atual **acrescenta** `explore`, que pode ser justamente o valor proibido |
| Protocolo legado: `pretty`/`debug` ignorados, `date_format` e `ids=` raiz dão erro, ETag/304 removidos | todas as chamadas | 🟢 só o `ids=` raiz nos afeta (4.1); os `date_format` do código são da planilha Google, não do Graph |
| Falha de relatório assíncrono passa a trazer `error_code`/`error_message`/`error_subcode`/`error_user_title`/`error_user_msg` por padrão; `error_code` muda de `uint` para `int` | `meta_job_client.py` (`_extract_meta_error_fields`, truque `?fields=error_message`) | 🟡 positivo (dá a causa de "Job Failed" sem truque), mas o leitor atual pode não achar o campo onde espera: testar com um job forçado a falhar |
| Criativo com loja: `destination_spec.destination_type` passa a `WEBSITE_AND_SHOP` por padrão se o anunciante tem loja | criativo do fallback manual | 🟡 a cópia herda; só o fallback manual pode mudar |
| `wamo_whatsapp_identity_spec` novo em criativos | leitura de criativo | 🟢 aditivo |
| Campos de `delivery_estimate`, Commerce Order API, campos legados de Páginas, Rights Manager, lookalike por país | , | 🟢 não usamos |

### 4.3 Não encontrado / não verificado
- **Facebook Login** (`dialog/oauth`, `/oauth/access_token`, `/me/permissions`, expiração de token): a página oficial devolveu só conteúdo antigo. **Nada achado não prova que nada mudou**; vira teste obrigatório.
- Formato de erro, cabeçalhos de uso (`x-app-usage`, `X-Business-Use-Case-Usage`), limites de batch, métricas de vídeo (`thruplay`, `p50`, `p75`, `play_curve`), `/advideos`, `/adimages`, `source_ad`: nenhuma mudança reportada, mas a fonte foram resumos.
- Mecânica exata do "upgrade automático" de versão da Meta (chamadas sem versão sobem sozinhas?): não encontrada. Nossas URLs sempre levam versão explícita.

---

## 5. Classificação por complexidade e risco

**A. Trocar só o número** (risco ~zero, minutos)
| Item | Onde |
|---|---|
| Default da versão | `config.py:42` `META_API_VERSION` |
| Textos/exemplos | `deploy/ENV_TEMPLATE.md`, `deploy/README.md`, `scripts/check_config.py`, `scripts/test_facebook_config.py`, docstrings (`facebook.py:2070`, `graph_api.py:803,850`) |
| Página `/docs` e material de App Review | `frontend/lib/docs/metaDevReference.ts:7` |
| ⚠️ **Conferir no `.env` da VPS** se `FACEBOOK_AUTH_BASE_URL` / `FACEBOOK_TOKEN_URL` estão fixadas em v24: se estiverem, login e troca de token **não sobem** com a variável de versão | servidor |

**B. Mesma chamada, comportamento a validar** (sem mudar código se o teste passar; risco baixo/médio)
| Item | Por que validar |
|---|---|
| Login OAuth, `/me`, `/me/adaccounts`, `/me/permissions`, `/me/accounts` | Meta não documenta mudança, mas a página de Login não foi lida |
| Relatório de insights assíncrono + paginação | campos e janelas continuam válidos; confirmar que os números batem com a v24 (diferencial) |
| Status em massa (`effective_status`, batch `relative_url`, `filtering`) | pipeline "escreve → relê"; muito exercitado |
| Orçamento (`daily/lifetime_budget`, `is_adset_budget_sharing_enabled`, `adset_budgets`) | desde a v24 criar campanha com orçamento por conjunto exige `is_adset_budget_sharing_enabled`; só importa se um dia **criarmos** campanha (hoje só lemos/copiamos) |
| Upload de vídeo em pedaços, `/adimages`, polling de status do vídeo | nenhuma mudança reportada |
| Enriquecimento de criativos (`adcreatives`, `source_ad`, `asset_feed_spec`) | campos novos são aditivos |
| Leitura de `source`/`from` do vídeo e `media_url` do Instagram | `media_url` ausente já é tratado |
| Duplicação de campanha | já em v26; validar no teste real (seção 1) |

**C. Precisa mudar código** (risco médio; cada um com teste novo)
| Item | O que fazer | Risco |
|---|---|---|
| 🔴 `GET /?ids=` raiz (`fetch_ig_media_types`) | trocar por `POST /` com `batch=[{method:GET, relative_url:...}]` (padrão que já usamos em `graph_api.py:1088,1440`) ou GET por id. **Independe do upgrade: fazer já** | médio: altera a classificação imagem×vídeo do app inteiro, então exige diferencial contra o resultado atual |
| Cópia de conjunto: `advantage_audience` | ler `targeting_automation` do modelo e repassar; mensagem clara para o erro `ADS_TARGETING__REQUIRE_EXPLICIT_ADVANTAGE_AUDIENCE_FLAG` | médio |
| Cópia de conjunto: posicionamentos removidos | remover Explore Feed / Messenger Stories do `targeting` antes de copiar e rever `_create_adset_from_source` | médio-alto: mexe em segmentação de conjunto que roda. **Nunca alterar o conjunto modelo**, só o payload da cópia |
| `placement_registry.py` | revisar as 357 linhas contra os valores válidos na v26 (rótulos dos slots) | baixo |
| Leitor de erro do relatório assíncrono | aceitar `error_code` como `int` e ler os campos novos; manter o truque `?fields=error_message` como plano B | baixo |
| Criativo do fallback manual | carregar `destination_spec` do modelo para não cair no default novo de loja | baixo |

**D. Fora do código**
- Conferir o tier de acesso da Marketing API do app (painel Meta).
- Reler os changelogs **no HTML cru** (esta pesquisa foi por resumo) antes da virada.
- Atualizar o texto de App Review / `/docs` se escopos ou fluxos mudarem.

---

## 6. Estratégia de teste

O app **não tem teste contra a Meta real**: os ~20 arquivos de teste que tocam Graph
usam dublês. Isso protege a lógica, mas é cego para mudança de comportamento da Meta.
Então:

1. **Teste de contrato das chamadas (novo, barato).** Registra, para cada método do
   `GraphAPI`, caminho + `fields` + parâmetros enviados e falha se mudar sem querer.
   Rede de segurança para a troca de versão e para os itens C.
2. **Diferencial v24 × v26 em leitura (script novo, só leitura).** Roda as mesmas
   consultas nas duas versões numa conta real e compara: `/me/adaccounts`,
   `/me/permissions`, relatório de insights de um período curto (mesmas linhas? mesmos
   totais?), enriquecimento de 50 anúncios, status e orçamento de entidades, `source` de
   um vídeo. Mesmo princípio do rollup: **diferencial contra a versão anterior antes da
   virada**.
3. **Falha forçada do relatório assíncrono** (intervalo inválido) para ver o formato
   novo de `error_code`.
4. **Escrita só em conta de teste, tudo pausado:** duplicação de campanha (roteiro da
   Fase 5 do plano de duplicação), troca de status, mudança de orçamento (e desfazer).
5. **Login completo** (conectar o Facebook do zero e reconectar) em v26: é o buraco de
   documentação.
6. **Virada em produção** só pela variável `META_API_VERSION` (reversível sem deploy),
   conferindo antes o `.env` (seção 5-A). Acompanhar logs de `[GraphAPI`, `igm batch`,
   `Job Failed` e o painel `meta_api_usage` nas primeiras horas.

## 7. Ordem sugerida
1. **Já, independe do upgrade:** item C `ids=` raiz + olhar os logs de produção.
2. Testes 1 e 2 (contrato + diferencial de leitura): mostram se a virada é segura.
3. Demais itens C, junto com o teste real da duplicação.
4. Itens A + virada de `META_API_VERSION` antes de **10/11/2026**.

---

## 8. Oportunidades encontradas na revisão (medidas em 2026-11-01)

Uso real da Meta, 7 dias (`meta_api_usage`, 6 usuários): **23.520 chamadas**.
`AdsEnricher` = 15.756 (67%), das quais **13.189 são o sync de status on-focus**
(`/facebook/packs/status-sync`, TTL 5 min por pack). Só a lista de conjuntos da conta
(`/act_X/adsets`) = 8.131 chamadas (35% de tudo).

| # | Oportunidade | Medido | Ganho estimado | Risco / o que provar antes |
|---|---|---|---|---|
| 1 | **Sync de status incremental**: `updated_since` (param oficial de `AdAccount.get_ad_sets`/`get_ads`, SDK v26) nos conjuntos; campanhas seguem lidas inteiras (1 página) e `CAMPAIGN_PAUSED` é derivado do pai | conta act_1088942488268239: 1.452 conjuntos/3 páginas/4,8 s → `updated_since` 1 h: 0; 24 h: 5; 7 d: 42 (1 página) | ~⅔ das chamadas de conjuntos ≈ **20–25% de todas as chamadas** do app; sync de status ~4× mais rápido | status efetivo pode mudar SEM `updated_time` (fim de agenda, cobrança, pai). Provar com diferencial: rodar incremental e completo lado a lado por alguns dias e comparar status por conjunto. Leitura completa continua no refresh do pack |
| 2 | Filtrar conjuntos por pack | packs cobrem ~80% dos conjuntos da conta | ~20% de linhas, mas **mais chamadas**: filtro por id vai em lotes de ~50 → conta grande 3.862/50 ≈ 78 chamadas vs ~10 páginas de 500 hoje | **descartado** |
| 3 | **Remover o backend legado do upload** (`/facebook/bulk-ads*`, `/campaign-template`, `/campaign-bulk*`, `bulk_ad_service.py`, `campaign_bulk_service.py` e testes) | sem tela que chame desde a duplicação nova; ~3.100 linhas | menos superfície para validar na v26 | ✅ **feito 2026-11-01**: 5 rotas + `/ads/{id}/creative` + `/ads/tree`, 2 serviços, 7 métodos Graph, 4 funções de banco, 7+28 esquemas, testes e script legados. Tabela `bulk_ad_items` mantida (apagar dado é decisão à parte) |
| 4 | Duplicação: pré-voo do modelo lê anúncio + campanha + conjuntos em 3 GETs e roda 2× (prévia e lançamento) | — | 1 GET com expansão de campos (`campaign{…,adsets{…}}`) | baixo; feature de uso raro, prioridade baixa |
| 5 | `MetaJobClient.get_status`: 2.396 polls para 333 relatórios (~7 por relatório) | — | backoff já existe; ganho marginal | não mexer |

Classificação imagem×vídeo do Instagram (`fetch_ig_media_types`): Batch API é o substituto
oficial recomendado pela Meta para `?ids=`. A função só roda para criativo SHARE de mídia
única sem tipo estrutural — **0 chamadas em 7 dias**; não há o que otimizar.

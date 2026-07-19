# Decisões Técnicas — Hookify

Registro de decisões de arquitetura, abordagens escolhidas e lições aprendidas ao longo do desenvolvimento. Serve como guia para evitar retrabalho e esclarecer o "por quê" por trás de soluções não óbvias.

> Este arquivo é espelho da memória do Claude (`memory/meta_video_access.md` etc.). Ao criar, atualizar ou remover uma entrada, faça nos dois lugares.

---

## URL de source de vídeo da Meta é perecível — cache lazy no banco, nunca eager no refresh

**Data:** 2026-07-18 · status: **implementado (migration 097 aplicada; video_source_cache.py; export CSV com URLs de mídia)**

**Contexto:** o export do Manager ganhou colunas "URL da mídia / URL expira em / Video ID" (para análise de criativos por IA com ffmpeg). A URL reproduzível vem de `GET /{video_id}?fields=source` — e é **CDN assinada que expira** (~horas a ~48h; o expiry real está no parâmetro `oe=` da URL, unix timestamp em hex). Três consumidores precisam dela (transcrição, export, player do modal) e, sem cache, cada um refazia as mesmas chamadas à Meta.

**Decisões:**
- **Cache no banco com expiry explícito** (`ads.video_source_url` + `video_source_expires_at`): diferente da lição das thumbnails (nunca servir CDN Meta como permanente), aqui a URL nunca é tratada como verdade — só como atalho válido-até, revalidado a cada uso. Write-back por `primary_video_id`: todos os ads que compartilham o criativo herdam o cache numa escrita.
- **Lazy, nunca eager:** o enrichment do refresh **não** busca `fields=source` (isso custaria +1 chamada/vídeo no fluxo mais frequente do app). O cache é populado sob demanda pelo primeiro consumidor que precisar.
- **Margem mínima por consumidor** em vez de UI de "atualizar links": transcrição/modal exigem 1h restante; export exige 12h (garante planilha útil sem perguntar nada ao usuário — uma UI de opt-in induziria "atualizar sempre", anulando o cache). Constantes em `video_source_cache.py`.
- **Consumidor novo deve usar `resolve_video_source_cached`**, nunca `get_video_source_url` direto.
- Endpoint batch `POST /facebook/video-source-urls/batch`: dedupe por vídeo único, pool de 4, erro por item (um vídeo inacessível não derruba o batch), 401 padronizado só para token expirado.

**Regra derivada:** qualquer URL de CDN da Meta (thumbnail, source, media_url de IG) expira. Antes de expor uma numa feature, decidir: Storage (permanente, para render) ou cache-com-expiry (para consumo pontual). Memória: `meta_video_access.md`.

---

## Timeouts intermitentes (57014) no Manager — generic plan do Postgres na 6ª execução da conexão, não volume de dados

**Data:** 2026-07-13 · status: **implementado (migration 096 aplicada em produção; analytics.py)**

**Sintoma:** "de vez em quando" o `/analytics/ad-performance` estourava `statement timeout` (57014) e a tela não carregava — tipicamente com vários packs, um deles grande. A mesma query, testada isolada, rodava em ~1,7s.

**Causa raiz (medida em produção):** o PL/pgSQL cacheia planos por conexão. Após 5 execuções, o Postgres pode trocar o *custom plan* pelo *generic plan* — e as RPCs analíticas dependem de constant-folding dos parâmetros opcionais (`p_pack_ids is null or exists (...)`, `case when v_group_by = ...`), que só existe no custom plan. Sob generic plan, o plano vira catastrófico. Medição na mesma sessão, mesmos parâmetros (`fetch_manager_rankings_core_v2`, 4 packs, 75 dias, `group_by=ad_id`):

```
exec 1..5 →    ~860 ms   (custom plan)
exec 6    → 233.814 ms   (generic plan — 273x) → 57014 sob o timeout de 30s do authenticated
```

Como o PostgREST mantém conexões persistentes, o fenômeno depende de qual conexão do pool atende a chamada e quantas vezes ela já executou a função — daí a intermitência. **Não era volume:** `ad_metrics` inteira tem ~73k linhas (108 MB); a janela que falhava toca 16k linhas. Subir a instância não resolveria.

**Fix (migration 096):** `ALTER FUNCTION ... SET plan_cache_mode = force_custom_plan` nas 8 RPCs com o padrão de parâmetro opcional (`rankings_core_v2_base_v093`, `series_v2`, `retention_v2`, `aggregated_base_v047/48/49`, `fetch_ad_metrics_for_analytics`, `batch_update_ad_metrics_enrichment`). Custo: replanejar a cada chamada (dezenas de ms) vs. eliminar o cliff de 273x. Validado pós-migration: 10/10 execuções em ~855ms na mesma conexão.

**Fixes acessórios:**
- `_is_transient_analytics_rpc_error` agora recusa retry explícito para `57014` — retentar a query idêntica cai na mesma conexão com o mesmo plano ruim e só dobra a carga.
- `diagnose_manager_rpc_timing` foi **dropada**: estava defasada (filtrava pack por `am.pack_ids && p_pack_ids` enquanto a RPC real usa `EXISTS` contra `ad_metric_pack_map`) — media uma query que não existe mais e teria apontado a causa errada.

**Regra derivada:** 57014 intermitente em RPC com parâmetros opcionais → reproduzir com 6+ execuções na mesma sessão psql **antes** de mexer em índice, query ou instância. Se as 5 primeiras voam e a 6ª explode, é plan cache. Memória: `postgres_generic_plan_flip_on_optional_params.md`.

---

## "N / M anúncios" do conjunto não batia com o Gerenciador — anúncio pausado que nunca entregou não existe no nosso banco

**Data:** 2026-07-12 · status: **implementado (migration 094 aplicada; ad_inventory.py, supabase_repo.py, job_processor.py); 178 testes backend**

**Sintoma:** conjunto que o Gerenciador da Meta mostrava com **19 anúncios** aparecia no Hookify como **10 / 12**. Os 10 ativos estavam certos; o total é que divergia. Sintoma correlato do mesmo usuário: **trocar o filtro de período mudava o total** de cada conjunto, sem correlação óbvia.

**Causa raiz:** o denominador vinha de `count(distinct ad_id)` sobre `ad_metrics` **dentro da janela** — ou seja, "anúncios com alguma linha no período", não "anúncios do conjunto". E `ad_metrics` só recebe quem **entregou** (via `/insights`) ou quem é **deliverable** (linha-zero sintetizada, ver a entrada do inventário-first). Logo:

> Um anúncio **PAUSADO que nunca entregou** não existe em lugar nenhum do nosso banco — nem em `ad_metrics`, nem em `ads` (porque `upsert_ads` grava só o que veio de `raw_data`). Ele é baixado da Meta pelo `fetch_inventory` e **descartado** no `select_zero_delivery_ads`.

A aritmética do caso fechou exata: 19 na Meta = 10 ativos + 9 pausados; desses 9, **2** foram pausados *dentro* da janela (entregaram → têm linha real → entram) e **7** foram pausados antes (gasto zero → invisíveis). 10 + 2 = 12. Confirmado por SQL no banco e pelo usuário no Gerenciador.

Isso também explicava a variação por período: alargar a janela captura mais dias de entrega dos pausados, e eles reaparecem.

**Decisão: corrigir SÓ o denominador.** Persistir os pausados-sem-entrega como anúncios de verdade foi **rejeitado** — eles virariam zumbis all-zero nas abas Criativos/Por anúncio em qualquer período, e custariam enrichment de criativo/thumbnail de anúncio que nunca rodou. A regra "pausado sem métrica no range é ruído histórico" continua certa para as **métricas**; ela só não servia para a **contagem**.

**Fix:** o inventário completo já era baixado a cada refresh (edge `/ads`, que inclui pausados e exclui archived/deleted — exatamente o universo do Gerenciador). Agora `ad_inventory.count_ads_by_adset()` conta **todos os status** e a contagem por conjunto é persistida em `parent_entities.ads_count`; o wrapper de leitura a usa como `ad_count` na aba Por conjunto. `active_count` não muda. Resultado: **10 / 19**.

**Duas armadilhas que o fix teve de desviar:**
1. **Não injetar `ads_count` no payload de `upsert_parent_entities`.** Aquele payload cobre **todos** os adsets da conta (snapshot dos edges), enquanto o inventário é escopado ao pack do job → gravaria `NULL` nos adsets dos *outros* packs a cada refresh. Por isso existe o `upsert_parent_ads_counts` dedicado, que só carrega as colunas da contagem (PostgREST faz `ON CONFLICT DO UPDATE` apenas das colunas presentes no payload).
2. **O read-path é o WRAPPER, não o `_base_v*`.** O `fetch_manager_rankings_core_v2` (overload de **16 args** — o que o backend aciona, por enviar `p_campaign_id`) já pós-processava as linhas de adset/campanha com um `left join lateral` em `parent_entities` para injetar budget. Foi ali que o `ad_count` entrou — **sem tocar a agregação pesada** (`_base_v093`), evitando o risco de `statement_timeout`. Há um overload **morto** de 15 args ainda apontando pro `_base_v060` antigo: sempre tracear a cadeia real no banco antes de editar RPC.

**Rollout sem big-bang:** enquanto `ads_count` é `NULL`, o wrapper cai no `ad_count` antigo. Verificado em produção: antes do refresh a RPC devolve `10/12` (fallback intacto); com `ads_count=19` simulado, devolve `10/19`. Os números corrigem conforme cada pack é atualizado.

**Regra derivada:** contagem de inventário e agregação de métricas são eixos diferentes — não derive "quantos anúncios existem" de uma tabela que só guarda "quem teve atividade". `active_count` (status atual) sobre `ad_count` (period-scoped) é razão entre populações distintas.

---

## O verify pós-write de status também mente — read-after-write de effective_status é eventualmente consistente

**Data:** 2026-07-12 · status: **implementado (graph_api.py, facebook.py, useAdStatusControl.ts, BulkActionsBar.tsx); 209 testes backend + tsc/design-system clean**

**Sintoma:** pausar um anúncio mostrava "Pausado com sucesso" mas o toggle continuava ativo — inclusive após F5 — embora o Meta tivesse pausado de fato. Corrigia sozinho só no on-focus sync (TTL 5 min). A divergência toast/toggle é a assinatura: o toast usava `data.status` (pedido) e o toggle `data.effective_status` (verify).

**Causa raiz:** o fluxo write→verify relê o `effective_status` **imediatamente** após o POST, e esse campo é derivado/assíncrono no Meta — em ~18% dos casos (medido: 27/147 num batch de pause) a releitura volta transitória (`IN_PROCESS`) ou defasada. O valor era congelado como "verdade lida" no Supabase (`ads.effective_status`) e devolvido ao frontend; `isPausedStatus` não reconhece `IN_PROCESS` → renderiza como ativo. Ironia: o verify existe para matar o "sucesso fantasma" inverso (docs de 2026-07-03/06/07 nesta mesma saga) — ele resolve aquilo, mas confiar cegamente numa leitura read-after-write de campo eventualmente consistente criou este.

**Fix (3 camadas — `_reconcile_verified_status` + `_STATUS_VERIFY_BACKOFFS` em graph_api.py):**
1. **Reconciliação lógica:** verify que contradiz um write aceito é descartado — pausou→`ACTIVE` e ativou→`PAUSED` são impossíveis (o own status é determinístico após o 200); `IN_PROCESS` é transitório. Estados **informativos** (`ADSET_PAUSED`, `CAMPAIGN_PAUSED`, `PENDING_REVIEW`, `WITH_ISSUES`) continuam aceitos na 1ª leitura — são a razão de ser do verify.
2. **Retry só dos não-assentados** (backoff 2s/3s, individual e batch); esgotado → vale o status pedido. A UI cobre a janela com `toast.loading` imediato no `onMutate` (individual e bulk — antes o bulk ficava segundos sem feedback nenhum, "nem vi toast").
3. **`IN_PROCESS` nunca persiste** (guard em `_write_local_statuses`) — protege também o on-focus sync, que podia regravar transitório por cima do valor correto segundos após um toggle.

**Bônus de rate limit:** pre-check/verify do bulk de ads migrou de Batch GET (1 sub-request/ad, cada uma contando no rate limit) para leitura filtrada `ad.id IN` no edge `/ads` (`get_ad_statuses_by_ids` + `_read_effective_statuses`, ~1 chamada por conta, agrupamento vindo da tabela `ads`). O campo `ad.id` não é enumerado na doc do edge (que é omissa sobre `filtering`), então o caminho é **auto-validante**: se a Meta rejeitar o filtro (#100), cai no Batch GET — degrada exatamente para o comportamento anterior.

**UX de segurança:** toda ação em massa (pausar/ativar) agora exige `ConfirmDialog` (dentro da `BulkActionsBar`, ambas as superfícies ganham de graça) — pausa acidental de 147 anúncios já aconteceu. Toggle individual segue sem confirmação.

**Regra derivada:** verify pós-write de campo derivado nunca é verdade absoluta — reconcilie com o que o write determinou, re-leia o que for transitório e **jamais persista estado transitório**. Testes: `backend/tests/test_status_verify_reconciliation.py`.

---

## Evento de conversão do topbar "sempre resetava" no /manager — gate de sync tem de ser "dados carregados", não "seleção existe"

**Data:** 2026-07-11 · status: **corrigido (frontend/app/manager/page.tsx)**

**Sintoma reportado:** o evento de conversão selecionado no topbar parecia não ser guardado em cache — resetava a cada visita.

**Diagnóstico:** o valor **era** persistido corretamente (`persist`/`partialize` em `lib/store/filters.ts`) e restaurado na rehidratação. Quem apagava era a própria `/manager`. No manager, `availableConversionTypes` **não** vem de query async — é derivado SÍNCRONO do metadado `packs[].conversion_types`, e vale `[]` enquanto os packs carregam. O effect que propaga a lista pro store gateava apenas em `selectedPackIds.size > 0`. Como `packPreferences` é persistido, `selectedPackIds.size > 0` já é verdade na rehidratação — **antes** dos packs chegarem. Então dispara `setActionTypeOptions([])` na janela de loading, e o store limpa o `actionType` persistido (ramo "sem tipos disponíveis → `actionType=''`"). Quando os packs finalmente carregam, o fetch cai em `options[0]`. Resultado: seleção salva trocada pelo 1º item a cada abertura do manager.

**Por que só o manager:** as outras superfícies gateiam em "dados resolvidos" — o pipeline (`useAdPerformancePipeline`) espera `queryData`; o Explorer gateia em `length > 0`. Só o manager chamava `setActionTypeOptions([])` durante o load.

**Fix:** gatear o effect em `packsReady` (`packsClient && packs.length>0 && !packsLoading`) — o análogo de "queryData resolvido" para uma fonte síncrona. Preserva a limpeza legítima de `actionType` órfão (só quando os packs de fato têm 0 tipos), sem apagar a seleção durante o carregamento. **Não** gatear em `length>0` (isso reabriria o bug de CPR=0 por `actionType` órfão documentado em `actiontype_options_unconditional_sync`).

**Regra derivada:** "chamar `setActionTypeOptions` após dados reais" tem de significar *dados carregados*, não *seleção não-vazia*. O gate de prontidão é `queryData` (fonte async) ou `packsReady` (fonte síncrona do metadado). Um gate por seleção deixa a rehidratação do persist disparar um `[]` transiente que zera a preferência salva.

---

## Diagnóstico do dia = 1ª aba do /insights; redesign "Hangar" da Packs rejeitado

**Data:** 2026-07-08 · status: **implementado (commits 060d4cd revert + dd2e3be)**

**Decisão:** a análise "o que mudou hoje" (`DayComparisonBlock` + `PackDiagnosticPanel`) fica como a **primeira aba do /insights** ("Diagnóstico", ativa por padrão), reusando a seleção de packs / evento de conversão / date-range que o **Topbar já oferece**. Mesmo motor do /plano (`serverData` = todos os ads = média global + `usePackDiagnostic`). O /plano mantém a cópia própria por ora.

**Contexto / lição (o usuário mudou de ideia):** antes disso, tentou-se dar um "toque gamer" à página Packs — o **"Hangar" / Packs 2.0**: estante horizontal + carrossel, cards de saúde estilo carta FUT (health-ring + score 0–100 vs custo-alvo), seleção-por-clique que virava o filtro global do app, e o diagnóstico consolidado migrado pra Packs. Passou por brainstorming multi-agente (3 revisores + árbitro → APPROVED com ajustes) e mockup HTML aprovado. O usuário então **rejeitou tudo**: *"é frescura e só vai deixar o app mais confuso e menos intuitivo. Vamos voltar para o arroz com feijão que funciona."* Revertido (Packs voltou a grid + CRUD; deletados `usePacksHealth.ts`, `PackHealthBadge.tsx` e o design doc).

**Regra derivada:** não re-propor redesign gamificado / character-card / carrossel da página Packs — a prioridade declarada é **simplicidade/intuitividade acima de "wow"**. Feature analítica nova → preferir **aba numa página cujo nome já faz sentido**, reusando os filtros globais, em vez de inventar superfície nova com modelo de seleção próprio. O princípio "gamificar a leitura, não a ação" continua válido, mas subordinado à simplicidade.

---

## Revisão completa do billing Stripe — 5 bugs corrigidos + reconciliação anti-webhook-perdido

**Data:** 2026-07-01 · status: **implementado, 35 testes passando (16 novos), tsc clean**

**Contexto:** auditoria completa do fluxo de pagamento (checkout → webhook → tier → UI) atrás de bugs latentes e lacunas de resiliência. O sistema estava funcional no caminho feliz; os problemas moravam nos caminhos de erro e em eventos fora de ordem (Stripe **não garante ordem de entrega** de webhooks).

**Bugs corrigidos:**

1. **`stripe.errors.SignatureVerificationError` não existe no SDK** (nem no 10.x nem no 15.x — o módulo é `stripe.error`/top-level). Ao receber assinatura inválida, o `except` avaliava `stripe.errors` → `AttributeError` → 500 (e o `except Exception → 400` seguinte **não** captura, porque a exceção nasce na avaliação da cláusula). Sintoma real: se o `STRIPE_WEBHOOK_SECRET` estivesse errado/rotacionado, veríamos 500s confusos no Sentry em vez de 400 "Invalid signature" com warning claro. Fix: `stripe.SignatureVerificationError` (export top-level, existe desde v7).

2. **Dupla assinatura possível** — `POST /billing/checkout-session` não checava sub ativa existente. Duas abas / clique duplo / UI stale → duas subscriptions ativas na Stripe → **cobrança dupla**; a row guarda só o último `stripe_subscription_id`, então webhooks da sub antiga viram no-op silencioso. Fix: `_find_blocking_subscription` — se a row local sugere sub ativa, **confirma live** na Stripe antes de rejeitar (row pode estar stale por webhook perdido); live confirmada → 409 `already_subscribed` (frontend abre o portal); live cancelada → **self-heal da row** e checkout liberado.

3. **`invoice.payment_failed` gravava `past_due` cegamente** — chegando fora de ordem (depois de `customer.subscription.deleted`), sobrescrevia `stripe_status='canceled'` → o `/planos` mostrava "Gerenciar assinatura" (portal) para sempre em vez do checkout → **usuário cancelado não conseguia reassinar pela UI**. Fix: grava o status **live** (`Subscription.retrieve`), nunca toca `expires_at` (ciclo falhado não estende acesso).

4. **Grant manual do admin não era manual** — `PATCH /admin/users/{id}/tier` não gravava `source='manual'` nem limpava `expires_at`. Consequência dupla: (a) um `subscription.deleted` atrasado da sub antiga **clobberava o grant manual** (guard `_is_stripe_managed` via `source='stripe'` e deixava passar); (b) `expires_at` residual da sub morta **expirava o grant silenciosamente** após o grace period. Fix: override do admin grava `source='manual'` + `expires_at=NULL` (nunca expira, até revogar). Compra futura via checkout re-anexa ao Stripe normalmente (checkout ignora source por design — P0 fix de 2026-06-12).

5. **Skew de SDK dev vs prod** — `requirements.txt` pinava `stripe>=10,<11` (API 2024) mas o venv local roda **15.2.0** (API basil 2025). Prod (Docker instala do requirements) e dev testavam contra majors diferentes de um SDK de pagamento — as respostas de `Subscription.retrieve` mudam de shape entre eles (`current_period_end` migrou pra items no basil). Os helpers basil-proof cobrem ambos, mas o pin foi alinhado a `>=15.2,<16` (a versão efetivamente testada).

**Melhorias de resiliência:**

- **`POST /billing/sync`** (novo) — reconcilia a row do caller contra o estado live da Stripe (`Subscription.list` por customer, prioridade active > trialing > past_due > ...). Aplica as **mesmas regras do webhook de checkout** via `_apply_subscription_state` (extraído/compartilhado): nunca rebaixa tier, nunca toca admin, grant só em status ativo. No retorno do checkout (`?checkout=success`), o frontend agora chama sync **imediatamente** em vez de só torcer pelo webhook por 16s de polling — ativação instantânea mesmo com webhook perdido/atrasado.
- **Self-heal no `customer.subscription.updated`** — se o evento diz active/trialing mas a row está `standard` (ex.: `invoice.payment_succeeded` perdido), confirma **live** e re-concede insider. Confirmação live é obrigatória: evento pode ser snapshot stale fora de ordem.
- **`plan_id` sincronizado no subscription.updated** — troca de plano mensal↔anual via portal não deixa mais `plan_id` stale.
- **`_subscription_price_id` null-safe** — `items.data[0].price` presente-mas-None não explode mais o handler.
- **`stripe_customer_id` também persistido no webhook de checkout** (defesa em profundidade).
- **/planos:** `setInterval` do polling agora tem cleanup (antes vazava ao navegar durante a ativação); efeito de ativação separado do efeito de URL (o `router.replace` matava o ciclo com cleanup correto); toast de confirmação quando o tier flipa; 409 no checkout → invalida cache + abre portal.

**Observações operacionais (sem código, conferir no Dashboard):**
- Dunning: garantir "cancel subscription" como desfecho após esgotarem os retries (se ficar `unpaid`, o `expires_at` estendido pelo `subscription.updated` do ciclo dá acesso não pago até o enforcement do grace period).
- `stripe_events` cresce sem TTL — inofensivo por ora (algumas linhas/dia), revisar quando houver volume.
- Melhoria futura de checkout BR: `tax_id_collection` (CPF/CNPJ) + considerar `pix` (exige fluxo invoice-based para recorrência).

**Arquivos:** `backend/app/routes/billing.py`, `backend/app/routes/admin.py`, `backend/requirements.txt`, `backend/tests/test_billing_webhooks.py`, `frontend/app/planos/page.tsx`, `frontend/lib/api/endpoints.ts`. Schema de referência (`supabase/schema.sql` + `schema_map.md`) regenerado — estava desatualizado (não mostrava `stripe_events` nem as colunas stripe de `subscriptions`, o que quase mascarou o estado real do billing nesta revisão).

**Fase 2 (mesma data, 47 testes passando):** 4 extensões aprovadas pelo usuário:

1. **Dunning guard no código** — `subscription.updated` só estende `expires_at` quando o status do evento é `active`/`trialing`. Motivo: a Stripe avança o período no início do ciclo **independente do pagamento**; gravar `expires_at` em `past_due`/`unpaid` daria o ciclo não pago de graça (indefinidamente, se o Dashboard estiver configurado como "mark unpaid" em vez de "cancel"). Recuperação de pagamento estende via `invoice.payment_succeeded`. Complemento operacional: Dashboard → Billing → *If all retries fail* = **Cancel the subscription**.

2. **CPF/CNPJ no checkout** — `tax_id_collection: {enabled: true}` + `customer_update: {name: 'auto'}` (exigência da Stripe ao combinar tax_id_collection com `customer` existente — validado na doc oficial via Context7).

3. **Pix no plano anual** — pagamento avulso de 12 meses (Pix não suporta recorrência): checkout `mode=payment` + `price_data` inline em BRL (`STRIPE_PIX_ANNUAL_AMOUNT_CENTS`, padrão R$790) + metadata `plan=annual_pix`. Grant via `_grant_prepaid_access`: **idempotente por construção** (expiry = `session.created` + 365d — retries/sync recomputam a mesma data absoluta, sem stacking), nunca encurta expiry futuro existente, nunca toca admin, e **limpa `stripe_subscription_id`/`stripe_status`** (sem sub por trás; evita webhook velho de sub antiga tocar o row e sinaliza o estado prepago à guarda de checkout, que devolve 409 `prepaid` enquanto o ano pago corre). Eventos: `checkout.session.completed` gate por `payment_status='paid'` + `checkout.session.async_payment_succeeded` (Pix pendente) — **habilitar o evento novo no webhook do Dashboard**. `/billing/sync` também recupera compras Pix com webhook perdido (lista checkout sessions pagas). Feature flag dupla: `STRIPE_PIX_ENABLED` (backend) + `NEXT_PUBLIC_BILLING_PIX_ENABLED` (frontend, threaded por Dockerfile.frontend + compose build args) — ligar as duas juntas, após habilitar Pix no Dashboard.

4. **Billing fora do event loop** — checkout/portal/sync viraram rotas `def` (threadpool automático do FastAPI); webhook continua `async` (precisa de `await request.body()`) mas todo o trabalho blocking (record/handler/mark) roda via `run_in_threadpool`. O resto do app continua no padrão antigo — revisar quando houver tráfego.

---

## Princípio: só existe UMA média — a global ponderada; validação só filtra quem é julgado

**Data:** 2026-07-06 · status: **implementado em todo o app (3 rodadas na mesma data) · tsc limpo**

**Doutrina final (travada pelo usuário na 3ª rodada):** *"Só existe uma média: a global."* Média **ponderada por volume** (Σ contagens brutas → recomputa a taxa, exatamente como o Meta agrega) sobre **todos os ads** do escopo, servida pelo backend (`serverAverages`). Os critérios de validação (`validatedAds`) servem **apenas** para filtrar **quais anúncios são elegíveis a classificação/julgamento** (framework G.O.L.D., to-dos do /plano, listas do /insights) — não têm nada a ver com média. Julga-se **sobre** os validados, **contra** a média global. As três subseções abaixo documentam a evolução na mesma data (cada rodada ampliou a anterior até esta forma final).

**Contexto:** o spend de "ontem" na widget de comparação do dia do `/plano` mostrava R$167,50 enquanto o mesmo pack/date-range no `/manager` ("Soma total do pack") mostrava R$183,51. Causa-raiz: as duas telas somavam spend sobre **populações diferentes** de ads — `/manager` sobre todos, `/plano` só sobre `validatedAds`. E o `/plano` herdou `validatedAds` **por acidente**: a widget "Comparação do dia" foi ~100% reuso do pipeline de diagnóstico (`usePackDiagnostic(validatedAds)`); ninguém decidiu que "spend deve excluir ad não-validado".

**Regra travada:**

- **Cálculo de MÉTRICA (spend, results, CPR, CPM, taxas de funil) → sempre sobre TODOS os ads.** Motivos: (a) coerência interna — a razão `CPR = spend/results` não pode ter numerador e denominador de populações diferentes (isso infla/distorce o número); (b) coerência com o Gerenciador do Meta — o número precisa bater com o que o cliente vê lá.
- **`validatedAds` (piso de impressões/resultados) → só quando há JUÍZO sobre o anúncio** (avaliar bom/ruim, pausar ou não, escalar/otimizar, veredito G.O.L.D.). Aí sim é preciso volume mínimo para julgar.

É a extensão numérica do princípio-mãe já travado no diagnóstico comparativo (descritivo usa tudo, prescritivo usa validados).

**Por que é seguro migrar o diagnóstico para todos-os-ads:** `validatedAds` era só **1 de 4** freios de ruído do motor. Os outros 3 seguem ativos e bastam: ponderação por gasto (`w̄·Δr ≈ 0` para ad minúsculo), cutoff cumulativo 85% (cauda vai para o `remainder`), `minVolumeOk` (pack de gasto ínfimo). O piso de validação era redundante para o diagnóstico e só tinha o efeito colateral de não bater com o Meta. A reconciliação `Σcontribuições = Δheadline` **continua exata** — ela depende de consistência *interna* do bloco, não de qual população. O que quebra é **misturar** (spend de todos + results de validados numa mesma razão), nunca trocar o bloco inteiro.

**Implementação:** `usePackDiagnostic` teve o parâmetro `validatedAds` renomeado para `ads`, e `app/plano/page.tsx` passa `filteredRankings` (todos os ads do pack, antes do split validado/não-validado) em vez de `validatedAds`. Mudou apenas o **escopo de entrada** — `groupKeys` passa a cobrir todos os ads → a série de dias vem por todos → o headline CPR, o spend, os driver cards, o waterfall e as tabelas de impacto do bloco de comparação/painel batem com o `/manager` e o Meta. A matemática (`diagnostics.ts`) ficou intocada; `tsc --noEmit` limpo. O to-do list continua **listando** só validados (não dá para julgar sem volume), mas os **números** de contexto que exibe (CPR/spend do pack) vêm do diagnóstico (todos).

**Escopo cirúrgico (o que NÃO mudou):** `/gold` e `/insights` são superfícies de **juízo** (kanban de classificação, ranking de métricas, opportunity scores, gems) — a **classificação** segue usando `validatedAds`/`validatedAverages` corretamente. `metricRankings.ts` idem (ranking = juízo). O `PlanHero` já mistura certo: números **prescritivos** ("recuperar até R$X", potencial modelado) sobre validados + `diagnostic.summary` **descritivo** (agora todos).

### Benchmark "média do conjunto" do AdDetailsDialog padronizado (mesma data)

O dialog de detalhe do anúncio (clique num ad) exibe, por métrica, uma referência **"[métrica] médio"**. Essa média **divergia por página**: /insights (aba Oportunidades) usava `serverAverages` (todos os ads), mas /plano, /gold, os kanbans e o Gems usavam `validatedAverages`; o /manager era híbrido (volume de todos, taxas de funil dos validados via `averagesOverride` na aba "Por anúncio"). Resultado: o **mesmo anúncio** mostrava uma "média" diferente dependendo de onde era aberto.

**Decisão:** a "média do conjunto" é uma **métrica exibida** (a média do pack), não um veredito → deve ser sempre a média **ponderada de todos os ads** (`serverAverages` / backend `averages`), que é o número real que bate com o Meta. Uma média simples por ad NÃO bateria; a ponderada (Σcontagens → recomputa taxa) é como o Meta agrega. Como é ponderada, validado ≈ todos (o ad de baixo volume se auto-suprime); a diferença só aparece quando um ad de volume real falha a validação por critério não-volumétrico — e aí **incluí-lo é o correto** (é spend/impressões reais).

**Implementação:** benchmark do dialog = `serverAverages` em todos os hosts — /plano (`DayComparisonBlock`, `PackDiagnosticPanel`: prop `validatedAverages`→`benchmarkAverages`; `ActionPlanRow` via `ActionPlanList.averages`=`serverAverages`), /manager (base do `averagesOverride`=`activeServerAverages`; mecanismo de média validada por-anúncio removido — memo + imports órfãos), e gold/insights kanban+gems via novo prop dedicado **`benchmarkAverages`** em `BaseKanbanWidget.modalProps` (fallback para `averages`), threading `serverAverages` de `gold/page.tsx` e `insights/page.tsx`. `tsc --noEmit` limpo.

**Superado na rodada seguinte:** o prop `benchmarkAverages` dos kanbans e a distinção "classificação em validados vs benchmark em todos" desta rodada foram **eliminados** pela rodada 3 (abaixo) — mantidos aqui só como registro da evolução.

### Rodada 3 (mesma data): thresholds de julgamento também na média global — `validatedAverages` eliminado

O usuário fechou a doutrina: mudar também o **threshold de classificação** para a média global ("na verdade, só existe uma média, que é a global"). O risco de vereditos mudarem é mínimo (média ponderada → validado ≈ todos) e, quando muda, muda para o número correto.

**Implementação:**
- **Thresholds de julgamento → média global**: `splitAdsIntoGoldBuckets` / `computeOpportunityScores` / `buildActionPlan` (/plano), `GoldKanbanWidget` + `GoldTable` (/gold), `InsightsKanbanWidget` + `GemsWidget` + `OpportunityWidget` e os dois memos de opportunity (/insights) — todos agora recebem `serverAverages`.
- **`validatedAverages` deixou de existir**: `useAdPerformancePipeline` não o computa nem retorna (o memo faz só o split validado/não-validado); o prop `benchmarkAverages` dos kanbans (criado na rodada 2 para separar dialog de classificação) foi **removido** — com uma média só, o `averages` único dos widgets basta (agora global). Nos componentes do /plano (`DayComparisonBlock`, `PackDiagnosticPanel`) o prop segue chamado `benchmarkAverages` (recebe `serverAverages`) — nome correto para o papel (benchmark do dialog).
- **Centralização (3 implementações → papéis claros):** (1) **backend `analytics.py`** = fonte canônica → `serverAverages`; (2) `lib/utils/validatedAverages.ts` **renomeado** para **`lib/utils/weightedAverages.ts`** (`computeWeightedAveragesFromAdPerformance`, alias legado deletado) — único consumidor restante é o **fallback do Explorer** quando a resposta não traz `averages` (o Explorer já preferia o server e portanto já era compliant); (3) `computeManagerAverages` (`lib/metrics/manager.ts`) permanece separado por ter job diferente: agregação local das linhas correntes da tabela do Manager (por aba/filtro, com sums para headers, cpc/cplc/cpmql/mqls) — precisa ser client-side e reativa a filtros locais. Não vale unificar (2) e (3): shapes e responsabilidades diferentes; a regra é que **nenhuma delas deve ser usada para criar uma "segunda média" de subconjunto**.

**Zero validados não bloqueia mais o /plano:** o guard de página inteira (`validatedAds.length === 0` → empty state total) virou `filteredRankings.length === 0` — sem **nenhum** ad no período não há o que diagnosticar; mas com ads e zero validados, o **diagnóstico renderiza normalmente** (é descritivo, roda sobre todos) e só a área do plano de ação mostra empty state explicando ("o diagnóstico acima considera todos os anúncios; ajuste os critérios..."). Limitação aceita por ora: o toggle do painel colapsável (`PackDiagnosticPanel`) mora no `PlanHero`, que só renderiza com `actionPlan` — nesse estado o painel fica inacessível (o `DayComparisonBlock`, diagnóstico principal, aparece). Resolver na separação diagnóstico/plano pendente.

`AdsetDetailsDialog` computa a própria média internamente (não recebe prop) — revisar em oportunidade futura.

> Discussão em aberto na mesma data: separar o `/plano` em duas superfícies — diagnóstico (descritivo, candidato a virar uma página "Packs" repaginada como browser de saúde de packs) e plano de ação (prescritivo, o to-do list). Não decidido; não implementar ainda.

---

## Flicker de carregamento (empty→skeleton→dados) — guards de loading antes de empty states

**Data:** 2026-07-06 · status: **implementado (/plano, /gold, /insights) · tsc limpo**

**Sintoma:** as páginas de analytics piscavam um empty state ("Selecione um pack" / "Sem dados") **antes** do skeleton, e só depois mostravam os dados.

**Causa:** o `isLoading` do `useAdPerformancePipeline` cobre só o fetch de ad-performance (`queryLoading || criteriaLoading || packsAdsLoading`). Na janela em que os **packs ainda estão hidratando/carregando** (store zustand persist + `useLoadPacks` global via `PacksLoader`), `fetchEnabled` é `false` → a query está desabilitada → `isLoading` é **false**. Como o guard de empty state (`selectedPackIds.size === 0 || !packsClient`, ou `!hasData`) rodava **antes** de um gate que cobrisse essa janela, ele renderizava um empty prematuro. Aí os packs chegam, `fetchEnabled` vira true, `isLoading` sobe → skeleton → dados.

**Princípio:** `isLoading` do pipeline ≠ "a página está pronta". O sinal de "packs ainda carregando" é **ortogonal** ao fetch e vem de outra fonte: `usePacksLoading()` (contexto do `PacksLoader`, default `true`) + `packsClient` (hidratação client do store).

**Fix (padrão para toda página de analytics):** `const { isLoading: packsLoading } = usePacksLoading();` e ordenar os guards com **todo estado de loading ANTES de qualquer empty state**:
```
if (!isClient || !isAuthorized) return <Skeleton/>;
if (!packsClient || packsLoading)  return <Skeleton/>;   // hidratação dos packs
if (isLoading)                     return <Skeleton/>;   // fetch de ad-performance
// settled → empties genuínos
if (selectedPackIds.size === 0) return <EmptyState/>;
...
```
Em página sem guards separados (Insights renderiza inline por tab), dobrar o loading: `isLoadingData = loading || !packsClient || packsLoading`. O `/manager` já fazia certo (`packsReady = packsClient && packs.length > 0 && !packsLoading`) — foi a referência. `packsLoading` default é `true`, então só funciona sob `<PacksLoader>` (está no `AppLayout`, cobre todas as páginas autenticadas).

---

## Painel Diagnóstico "O que mudou hoje?" — /plano (topo) com LMDI-I + shift-share

**Data:** 2026-06-27 · status: **implementado, 21 testes passando, tsc clean**

**Contexto:** O usuário abre o /plano e não sabe *por que* o CPR mudou. O painel insere um diagnóstico bate-pronto no topo da página, criando fluxo: *diagnóstico → plano de ação*.

**Motor matemático:** `frontend/lib/metrics/diagnostics.ts` (puro, sem React)

Identidade: `CPR = (CPM/1000) / (website_ctr × connect_rate × page_conv)`. CPMQL = CPR / mql_rate.

**Nível 2 — LMDI-I (Logarithmic Mean Divisia Index):** Decomposição aditiva exata de ΔCPR em contribuições por driver. Peso compartilhado `L(cost1,cost0) = (cost1-cost0)/(ln cost1 - ln cost0)`. Contribuição: `L × sign_k × ln(rate_k1/rate_k0)`. Soma **exatamente** ao delta — sem resíduo de interação. Escolhido sobre diferenças finitas simples que produzem um termo de interação sem driver dono.

**Nível 3 — shift-share simétrico (mix centrado na média do pack, desde 01/07/2026):** Por driver clicado, decompõe Δrate_pack por ad em `RATE_a = w̄·Δr` (a taxa do ad piorou) e `MIX_a = (r̄_a − r̄_pack)·Δw` (share migrou pra/de um ad pior/melhor **que a média**). ⚠️ A forma não-centrada (`r̄·Δw`) estava errada por-ad: todo ad ganhando share aparecia como "encareceu" incondicionalmente, mesmo um ad barato ganhando share (que dilui o CPM do pack). Centrar conserta sem mudar a soma (ΣΔw=0). Soma exatamente. Conversão pra R$ é proporcional (aproximação documentada). Cutoff cumulativo 85% — ads além do cutoff colapsados em "+N outros".

**Arquivos:**
- `lib/metrics/diagnostics.ts` — motor puro (logMean, selectTarget, decomposePack, attributeDriverToAds, buildBudgetShareSeries, buildDiagnosticSummary, buildAdTwoDaySnapshots)
- `components/plano/PackDiagnosticPanel.tsx` — orquestrador; usa useAdPerformanceSeries com window=14
- `components/charts/DiagnosticTrendChart.tsx` — linhas normalizadas índice=100 (visx) + barras de verba embutidas + legenda interativa
- `components/charts/DriverWaterfall.tsx` — waterfall clicável dos drivers
- `components/charts/DriverAdList.tsx` — lista de ads por driver (shift-share)
- `lib/metrics/__tests__/diagnostics.test.ts` — 23 testes: logMean, LMDI exactness, shift-share, cutoff, sameSignTotal, funil-mudou, adapter

**Redesign visual (27/06/2026, feedback do usuário):** `BudgetShareBars.tsx` removido — barras de verba viraram camada de fundo monocromática (não-colidente com as linhas) dentro do `DiagnosticTrendChart`, com **legenda interativa** que liga/desliga cada linha e as barras. Domínio Y adaptativo (não fixo) p/ revelar mudanças pequenas; sem `AreaClosed` (4 fills viravam borrão). Linha-alvo colorida por direção. Gráfico **nunca colapsa** mesmo com CPR estável — `buildDiagnosticSummary` passa a dizer "CPR estável, mas o funil mudou" quando um driver move ≥3% com outro compensando. Waterfall: base bars desenham do piso (não `from:0`, que saía da banda → caixas vazias). `DriverAdList` coverage divide por `sameSignTotal` (não pelo net → evitava "201% do impacto").

**group_key + group_by (causa-raiz do "Volume baixo" zerado):** dois acoplamentos com o pipeline. (1) `group_keys` = `ad.group_key || ad.ad_id`, nunca `"${account_id}:${ad_id}"`. (2) **O `group_by` da chamada de série precisa espelhar o do pipeline.** O `/plano` roda `useAdPerformancePipeline()` sem args → `groupBy="ad_name"`, logo cada `validatedAds[].group_key` é o **ad_name** (um nome agrega vários ad_ids). Chamar a série com `group_by:"ad_id"` faz o RPC emitir `group_key = am.ad_id`, o JOIN da CTE `filtered` nunca casa com os ad_names → série toda zerada → "Volume baixo" mesmo com R$9k/dia de gasto. Fix: `group_by:"ad_name"`. Confirmado direto no RPC `fetch_manager_rankings_series_v2`: em ad_name mode devolve spend/conversions reais (ex.: ADOV02 → CPR R$8,77 em 03/05); em ad_id mode devolve vazio. Ver `resolveGroupKey` em mapRankingRow.ts como referência canônica.

**mqls derivado:** série tem `cpmql` mas não `mqls`; derivado como `mqls = spend / cpmql` no adapter.

---

## Diagnóstico comparativo dia-a-dia — /plano — descritivo puro

**Data:** 2026-06-30 · status: **implementado, 33 testes passando, tsc clean** (refinado via discussão de mentoria data-science + workflow multi-agente de 7 agentes que validou a matemática contra o código real)

**Princípio-mãe (não-óbvio):** esta tela é **100% descritiva** — revela *o que mudou e por quê*, **nunca sugere ação**. "É um problema?", "vale reagir?", alvo e veredito são prescritivos → moram no plano de ação, não no diagnóstico. Essa separação **resolve** a dúvida original "esses anúncios podem estar no alvo, não são necessariamente um problema": a resposta é estrutural — não se responde isso aqui. Tentativas anteriores de embutir alvo/veredito no diagnóstico foram retratadas (geravam o ambíguo "subiu E acima do alvo").

**Cascata Q1→Q2→Q3 = mapa 1:1 no motor existente:**
- **Q1** (melhorou/piorou? quanto?) = ΔCPR/ΔCPMQL do headline. Acrescentar **Δ 7 dias ao lado do Δ hoje** (dois fatos, sem rótulo). Um selo "provável ruído/atípico" foi **rejeitado**: é prescritivo *e* suprimiria o *slow cook* (−3%/dia × 7 dias = −19% que "cada dia parecia ruído").
- **Q2** (quais métricas?) = decomposição LMDI em R$ por driver (driver cards).
- **Q3** (quais anúncios moveram ESSA métrica?) = `attributeDriverToAds(driverKey)` — **é por-driver, já existe**. O `attributeAllDriversToAds` (cross-driver) vira só o default "Resultado total". Filtrar por métrica = trocar a função, não escrever math nova.

**Interação:** seletor de métrica em **pills (primário)**, default Resultado/CPR; clicar no driver card **sincroniza** o seletor (secundário — clicar card não é intuitivo como mecanismo principal).

**Duas tabelas "melhoraram / pioraram o [métrica] do conjunto"** (não "impactos positivos/negativos" — número positivo = custo subiu = colisão número-vs-negócio). Sinal→rótulo **uniforme**: `sign=+1` CPM / `−1` taxas absorve a inversão taxa-vs-custo antes do número existir; `contrib>0`=encareceu=vermelho, `<0`=barateou=verde; idêntico p/ CPR e CPMQL. `contribTone()` já implementa.

**Opção A (escolhida) — verba e métrica mudam quase sempre juntas:** a identidade shift-share simétrica `Δ(w·r) = r̄·Δw + w̄·Δr` é exata (interação dividida meio a meio pelas médias), então cada anúncio já carrega as duas parcelas. **Não colapsar no tag dominante** (o `tag` em `diagnostics.ts:360` esconde a 2ª parcela). Linha = **total + quebra "por verba" e "por desempenho", assinadas**. Membership pelo **líquido no conjunto** (reconcilia com o headline — inegociável); alavancas opostas (perdeu verba mas piorou o próprio CPM) ganham linha visível com nota. Rejeitada Opção B (organizar por mecanismo) por quebrar Σlinhas = Δheadline.

**Volume baixo dispensa marcador** (usuário corrigiu; confirmado no código): o diagnóstico roda sobre `validatedAds` (piso de impressões do usuário já aplicado a montante) + ponderação por gasto (`w̄·Δr`≈0 p/ ad minúsculo) + cutoff cumulativo (cauda no remainder) + `minVolumeOk` (pack com gasto ínfimo). Um marcador "estimativa instável" resolveria um fantasma.

**Alerta condicional de comparação injusta** (não readout de volume permanente — "12 conversões a menos" absoluto foi rejeitado): só aparece quando |Δspend| ou |Δresults| passa ~25-30% ou results < MIN_RESULTS. Rodapé de **cobertura/residual** por tabela (usa `sameSignTotal`/`remainder`).

**Layout:** tabelas lado a lado no desktop (piorou à esquerda); no mobile também lado a lado via tabs ou scroll horizontal (não empilhar).

**Ponte pro plano de ação:** só **navegação** (CTA), zero veredito embutido.

**Tabela colunar (refinamento pós-implementação, feedback do usuário):** a quebra "por verba/por desempenho" da Opção A virou tabela de verdade — `# | Ad | Impacto (R$) | Share | Métrica` — em vez de texto empilhado, mais legível. Invariante crítico: **a cor de Share/Métrica vem sempre do sinal do par em R$ já computado** (`verbaCurrency`/`desempenhoCurrency`), nunca recalculada a partir do delta bruto exibido — prova: o multiplicador `driverContribCurrency/deltaRatePack` é uma constante de pack (igual pra todo ad daquele driver), então `sign(rateCurrency_a) = sign(constante)·sign(Δrate_bruto_a)` é uniforme entre ads, garantindo caret (sinal do número bruto) e cor (tone) nunca divergirem. No modo "Resultado" (cross-driver, soma até 5 drivers) não há um único Share/Métrica coerente — em vez de célula vazia, as colunas caem pros pares em R$ já existentes com o header nomeando a unidade ("Share (R$)" vs "Share (p.p.)"); selecionar uma métrica troca pro delta bruto daquele driver. `MetricDeltaBadge` foi generalizado (`deltaPct`→`value` + `format:"percent"|"currency"|"points"`) pra servir as 3 colunas coloridas com o mesmo componente.

**Bug do mix não-centrado → mix centrado na média do pack (achado pelo usuário, 01/07/2026):** o usuário notou que o Share colorira verde quando o share de um anúncio de boa métrica caía. Causa: `MIX = r̄_ad·Δshare` (não-centrado) colore pelo sentido do share incondicionalmente. Fix (decomposição estrutural/Bennet): `MIX = (r̄_ad − r̄_pack)·Δshare` — ganhar share só encarece se o ad roda pior que a média. `ΣΔshare = 0` ⇒ soma inalterada ⇒ reconciliação com o headline continua exata; a alocação por-ad (e a membership melhorou/piorou de alguns ads) muda — é o fix, não efeito colateral. Aplicado nas duas funções (per-driver + cross-driver). Tag "ganhou verba" → "verba realocada" (mix-dominado positivo agora pode vir de perder share num ad barato). **Regra geral: atribuição de mix por-unidade compara-se sempre contra a média do grupo, nunca contra zero.**

**UI da tabela (01/07/2026):** Impacto = badge sólido (coluna primária); Share/Métrica = texto colorido + caret sem fundo (`MetricDeltaBadge appearance="plain"`). Absolutos a um hover: tooltip "ontem X → hoje Y" nas células Share/Métrica (só com driver selecionado) + tooltip ℹ no header "Impacto (R$)" explicando que é contribuição ao custo do conjunto, não o custo do anúncio. Com o mix centrado, caret e cor divergem legitimamente (share ↑ num ad barato = caret ↑ + verde).

**Tabela única + coluna de nível (01/07/2026, supersede as duas tabelas):** deltas (fluxos) não explicam o vermelho do share quando a métrica do ad melhorou — a explicação é o **nível** (o ad segue acima da média do pack), que não estava na tela. As duas tabelas não tinham largura pra coluna extra. Decisão: **uma tabela full-width "top movers"** ordenada por |impacto| (direção mora no badge assinado/colorido do Impacto) + coluna **"[métrica] hoje"** colorida vs a média do pack hoje (`getMetricQualityToneByAverage`, mesma escala do Manager; custos inverse, taxas não), tooltip "média do conjunto hoje: X". No modo Resultado vira "CPR/CPMQL hoje" (custo do ad vs custo do pack). Base do nível = hoje-vs-hoje; divergência rara com a cor do mix (ad cruzou a média entre os dois dias) é informativa. `cutImpactBucket` exportado em diagnostics.ts (cutoff 85% sobre sinais mistos; remainder é net assinado — rodapé diz "líquido"). Mobile via overflow-x-auto (tabs removidas junto com o layout de 2 tabelas).

**Células valor+badge + Spend + ordenação (02/07/2026):** Share/Métrica/nível viraram **duas** colunas no padrão DriverMetricCard — **Spend** (% da verba do pack hoje + badge Δ p.p.; valor em foreground neutro pois alocação não tem nível bom/ruim; tom do badge = verbaCurrency) e **Métrica** (valor de hoje colorido vs média do pack — o nível fundiu aqui, coluna "hoje" separada removida — + badge Δ; tom do badge = desempenhoCurrency). "Share"→"Spend" (termo familiar): exibe share de **verba** nos dois modos, o que universaliza a coluna e elimina o fallback "Share (R$)"/"Métrica (R$)" do modo Resultado (que agora mostra o CPR do ad + Δ% relativo). ⚠ Display-only: o mix continua computado no share do **denominador** do driver internamente; divergência direcional spend-vs-denominador é rara e coberta pelo princípio caret≠cor. `spendSharePrev` adicionado a `AdAttribution`+`AdTotalImpact`. **Ordenação por qualquer coluna**: ciclo direção-padrão→invertida→ordem default (|impacto|); ordena pelo valor primário da coluna (não pelo delta); nulls sempre no fim; sort reseta ao trocar o filtro de métrica; re-rank 1..N na ordem exibida.

**Composição virou tooltip do Impacto, não coluna própria (02/07/2026, refinamento same-day):** usuário aprovou a barra divergente mas pediu pra relocar — em vez de coluna "Composição" sempre visível, o bar+breakdown aparece no **hover do badge de Impacto** (1ª coluna). `CompositionBar` virou 2 peças: `CompositionBarVisual` (só a barra) + `CompositionBreakdown` (barra + lista assinada) montadas como conteúdo do tooltip. Coluna dedicada removida; escala compartilhada entre linhas (`maxCompSide`) mantida mesmo com um tooltip visível por vez. Tooltip do header "Impacto (R$)" ganhou frase avisando do hover — única affordance, pra não poluir o badge com ícone extra.

**Composição + conexão card↔tabela + alvo no headline (02/07/2026):** (a) coluna **Composição**: barra divergente por linha (zero central; barateou→esquerda/success, encareceu→direita/destructive; segmentos diferenciados por opacidade decrescente, sem cores categóricas — mesma lição das barras de verba; escala única entre linhas visíveis; hover lista R$ por parte). Dados: `AdTotalImpact.driverParts` (Σ = total por ad, testado) + `parts` no hook (cross = por driver; driver = verba/desempenho). (b) células Spend/Métrica em formato **jornada** `ontem(muted) → badge(Δ) → hoje(bold)` — o badge é a seta; tooltip só guarda a média do conjunto. (c) **conexão de seleção** em 4 pontos no mesmo accent primary: card com ring+lift, irmãos esmaecidos (`opacity-60 saturate-50` — sinal de filtro ativo), métrica do título em `text-primary`, pill ativa; linhas com stagger `animate-in` (30ms/linha, container keyed pelo driver — sort não re-anima pois keys estáveis). (d) **alvo no headline**: valor grande colorido vs ALVO (nível) enquanto o badge segue vs ontem (fluxo); linha `alvo R$X [badge Δ%]`; **linha tracejada de alvo no gráfico 7d** (muted, label à esquerda; só desenha se alvo ≤ 2× o máximo da série, senão esmagaria a linha; domínio estica pra incluir alvo×1.15).

**Bug de % relativo em base quase-zero → percentage-points (achado pelo usuário em produção):** Share e as 4 taxas de funil (website_ctr/connect_rate/page_conv/mql_rate) são proporções (0–1). `Δ% relativo = (last-prev)/prev` explode quando `prev` é quase zero — um ad escalado de ~0,1% pra ~7% de share do pack (evento normal) lia como "+7113%", tecnicamente correto mas ilegível. Fix: essas quantidades (Share sempre; Métrica quando o driver ≠ cpm) agora mostram **percentage-points** (diferença simples `last-prev`) em vez de % relativo. CPM continua em % relativo (currency-scale, não é uma proporção limitada, não sofre o efeito). Mesmo fix aplicado nos driver cards do topo, que tinham o mesmo bug latente (menos exposto por ser nível-pack, não por-ad). **Regra geral: nunca usar % relativo pra medir a variação de uma quantidade que já é uma proporção — usar diferença absoluta (p.p.); reservar % relativo pra quantidades unbounded (moeda, contagens).**

---

## Plano de Ação — Redesign v2 ("wow" + executor), design validado via review multi-agente

**Data:** 2026-06-26 · status: **design aprovado (condicional), ainda não implementado**

**Contexto:** Objetivo de tornar `/plano` bonita, intuitiva, com efeito "wow", evidenciando o valor do Hookify e a oportunidade de melhoria — **sem perder** a lista simples e prática para o "executor" (usuário que só quer tarefas). Brainstorming estruturado com 4 papéis (Skeptic, Constraint Guardian, User Advocate, Arbiter). Reusa o motor do v0 (abaixo).

**Estrutura aprovada:**
- **Hero — decisão do dono (2026-06-26): R$ protagonista** (economia potencial é o número grande), apesar do review apontar risco (número modelado/mean-reverting). Aceito com **4 guard-rails obrigatórios**: (1) âncora colada "de R$ {investido} investido em {N} anúncios" — nunca sozinho; (2) tooltip "como calculamos?" colado; (3) cálculo seguro (só otimizar !lowData + impactSavings finito, sobre validatedAds dedup por ad_name); (4) **os 3 estados não-felizes SUBSTITUEM o número grande** — saudável ("tudo saudável 🎉" + vencedores), dados-finos (baixa confiança, esconde R$), só-pausar ("R$ {gasto} sob risco" = loss real, não potencial). Chips de forma-da-conta clicáveis = âncora p/ grupo na lista. Card de custo-alvo **absorvido** na hero ("alvo: R$X ✎"). Componente `components/plano/PlanHero.tsx`, props puras, aditivo, **zero request novo** (tudo derivado de `actionPlan`+`validatedAds` já em `page.tsx`).
- **Lista agrupada por veredito por padrão** (não flat impact-first — `priority` é índice por-grupo, não rank global), sequenciada como fluxo: Escalar→Otimizar→Reciclar→Pausar→Observar. Urgência do bleeder sobe como callout no hero.
- **Reciclar = lane "Referência/Inspiração"**, não task interleaved (é a única classe que o app não cumpre in-app). Gems contextuais são o material de referência. Sem CTA falso "usar como modelo".
- **Sem checkbox "mark done" persistido no v1** (só hide cosmético de sessão, longe do verbo "Pausar").
- **Gems contextuais só onde há fonte** (não existe coluna de gems p/ connect_rate); leaderboards calculados 1× na lista. **Drawer "Referências/Gems" escopado às rotas de analytics** (Plano/Insights/GOLD), lendo cache — **não app-wide**.

**Lições não-óbvias (coração do review):**
1. **`impact_abs_savings`/`cpr_potential` é tautológico:** `opportunity.ts` eleva cada métrica abaixo-da-média *até a média do pack* (`Math.max(metric, avg)`) → sempre positivo, nunca pequeno, e o alvo sobe conforme se otimiza (média reverte). Não pode ser headline nem promessa.
2. **Checkbox ao lado de "Pausar" custa dinheiro real:** usuário interpreta check = pausar o ad. Affordance enganosa + "done" sem semântica honesta entre refreshes. Cortado.
3. **Drawer de Gems não pode ser app-wide:** montar `useAdPerformancePipeline` no app-shell dispara o RPC pesado de rankings (statement_timeout 57014) em toda navegação, e gems não existem fora de contexto analytics. Orb flutuante lê como bolha de chat + oclui polegar no mobile.

**Condição resolvida (2026-06-26):** usuário aprovou o drawer "Referências/Gems" escopado às rotas de analytics (não orb app-wide). Design 100% aprovado, sem pendências — pronto para fase de implementação.

**Compatibilização com o Painel Diagnóstico (2026-06-27):** o painel "O que mudou hoje?" (seção acima) é eixo **retrospectivo**; a hero é **prospectivo** (estado + oportunidade). Não conflita em código (hero é aditiva). Reconciliação de IA — decisão do usuário: **hero nº1 + diagnóstico colapsável**:
- Frase-resumo do diagnóstico (`buildDiagnosticSummary` → `summary.headline`) vira a **linha de momentum** dentro da hero ("Hoje: CPR caiu 12%").
- **Desambiguar R$**: hero = "até R$ X recuperável" (potencial) × diagnóstico = "R$ Y de variação" (retrospectivo). Nunca ambos como "economia".
- **Confiança unificada**: `decomposition.minVolumeOk===false` OU lowData alto → hero esconde o R$ protagonista (estado "dados finos"). Uma fonte de verdade p/ os dois blocos.
- Painel completo colapsável abaixo da hero (default fechado; toggle na hero/page).
- **Costura de implementação**: extrair `usePackDiagnostic` (series query + `decomposePack` + `buildDiagnosticSummary`) chamado 1× em `page.tsx`; alimentar hero (summary+minVolumeOk) e `PackDiagnosticPanel` (objeto completo — vira apresentacional, sem fetch próprio) → evita request de série duplicado e divergência hero×painel. ⚠ Limiares de confiança hoje divergem: diagnóstico `MIN_IMPRESSIONS=500`/`MIN_RESULTS=3` por pack-dia × hero `lowData=impressions<3000` por ad.

---

## Plano de Ação (to-do list v0) = reuso de G.O.L.D. + Oportunidades, não motor novo

**Data:** 2026-06-14 · atualizado 2026-06-17

**Contexto:** O norte do produto é um motor de ação prescritivo (to-do list Manage/Recycle/Create). O v0 do modo **Manage** (read-only) foi desenhado em brainstorming. Decisão central: **não reconstruir regras** — o Plano de Ação é uma camada de apresentação + veredito sobre dois motores que já existem, evitando uma segunda fonte de verdade que silenciosamente diverge.

**Reuso:**
- **G.O.L.D.** (`splitAdsIntoGoldBuckets`/`classifyGoldBucket`) dá o **veredito**: classifica ads validados em Golds/Oportunidades/Lições/Descartes/Neutros. Eixo **CPR=spend/results**; métricas {hook, website_ctr, page_conv} vs médias do set validado.
- **Oportunidades** (`lib/utils/opportunity.ts` `computeOpportunityScores`) dá **prioridade + porquê**: `below_avg_flags` {website_ctr, connect_rate, page_conv}, `cpr_potential`, `cpr_if_X_only`, `impact_abs_savings`, `impact_relative = improvement_pct × (spend/totalSpend)`.

**Modelo de veredito hierárquico (§8.6) — eixo absoluto é PRIMÁRIO:**
```
1. Não passou em validation_criteria → OBSERVAR
2. custo ≤ target_cpr[actionType]:
     todas as 3 métricas acima da média → GEM (escalar + duplicar)
     senão → OTIMIZAR (escalar + corrigir lever fraco)
3. custo > target_cpr[actionType]:
     todas as 3 métricas abaixo da média → DESCARTAR (pausar)
     pelo menos 1 acima → LIÇÃO (pausar + reciclar traço forte)
Sem target_cpr → fallback relativo: golds=GEM, opors=OTIMIZAR, licoes=LIÇÃO, descartes=DESCARTAR, neutros=OBSERVAR
```
Função central: `classifyActionVerdict(custo, alvo, metricsAboveCount)` em `lib/utils/actionPlan.ts`. Badge "poucos dados" quando `impressions < 3000`.

**`target_cpr` (nova user_preference):** coluna `target_cpr jsonb` na tabela `user_preferences` (migration 085). No store: `targetCprByActionType: Record<string, number>`. Configurado diretamente na página `/plano`. **Não usar `cpr_max` legado.** Fallback relativo quando não definido.

**3 costuras reconciliadas:** (1) CPR oficial = spend/results (veredito), funil só p/ potencial; (2) **sets de métrica DISTINTOS por propósito** — hook = alavanca criativa (hook abaixo da média → futuro Recycle/Create, não fix de funil); website_ctr/connect_rate/page_conv = otimização; (3) Oportunidades exclui Golds → Scale ordena por spend.

**Loop de medição:** nada no v0. Tier 1 (`action_plan_log`) ao lançar para medir adesão. Historizar `target_cpr` descartado — reconstrução infiel (ad_metrics enriquecido depois + precisa re-rodar pipeline).

**Fase 2:** `target_cpmql` + eixo CPR↔CPMQL; cobertura leadscore ≥90% por resultado na conexão da planilha; funil de custo multi-alvo.

**Fixo:** ad-level (group_by ad_name); UI = lista agrupada por veredito ordenada por impacto R$ (não Kanban); página nova `/plano` herdando `useFilters`; **read-only**; client-side; Insider tier.

**Arquivos criados:** `frontend/lib/utils/actionPlan.ts`, `frontend/app/plano/page.tsx`, `frontend/components/plano/ActionPlanList.tsx`, `frontend/components/plano/ActionPlanRow.tsx`, `frontend/lib/utils/metricColor.ts`, `supabase/migrations/085_add_target_cpr_to_user_preferences.sql`.

**Design completo:** `documentation/plano-de-acao-design.md`. Espelho na memória: `memory/plano_de_acao_reuse_architecture.md`.

---

## /insights omite ads sem entrega — e o read path parte de ad_metrics

**Data:** 2026-06-12

**Sintoma:** adset mostra "3/16 ativos" no Hookify quando o real é "11/24" — os ads ativos que nunca gastaram não existem no app.

**Três fatos que governam o fix:**

1. **`/act_X/insights` é endpoint de performance, não de inventário.** Por design só retorna linhas de ads com atividade (impressions/spend > 0) no `time_range`. Não há parâmetro para incluir zerados.
2. **O inventário completo já é baixado hoje e descartado.** `AdsEnricher.fetch_status_by_filter` chama `/act_X/ads?filtering=[pack]` paginado e recebe todos os ads que casam com os filtros — incluindo os zerados — mas usa o resultado só como lookup de `effective_status` para ads vindos do insights. Promover essa chamada a fonte canônica do universo custa **zero chamadas extras** à Meta, pode rodar em paralelo com o insights async, e libera o enrichment para rodar durante o polling.
3. **Consertar o fetch é só metade.** Todas as RPCs do read path (`fetch_ad_metrics_for_analytics`, `fetch_manager_rankings_core/series/retention_v2` e bases `_v0xx`) partem de `FROM public.ad_metrics`; `ads` entra só como LEFT JOIN. Ad sem linha de métrica é invisível no Manager mesmo salvo em `ads` + `packs.ad_ids`. E `ad_metric_pack_map` é keyed por `(ad_id, metric_date, pack_id)` — ad sem métrica não tem entrada no map.

**Arquitetura IMPLEMENTADA (2026-06-12):**

- **Write path inventário-first:** o antigo passe de status foi promovido a `fetch_inventory` (`/act_X/ads` com filtros do pack; campos `id,name,effective_status,created_time,adset_id,campaign_id,adset{name},campaign{name}` — todos validados no SDK oficial). Zero chamadas extras: o resultado vira o universo E é reusado como `status_details` no `enrich()`. Universo final = inventário ∪ insights (união, não left join estrito — ad deletado que gastou vem só do insights e permanece).
- **Ads zerados** só entram se `effective_status` ∈ {ACTIVE, PENDING_REVIEW, IN_PROCESS, WITH_ISSUES, PREAPPROVED} (`DELIVERABLE_STATUSES` em `ad_inventory.py`). Pausado/arquivado/deletado sem métrica no range = ruído histórico, fora. Consequência consciente: pausar um ad zerado pelo Hookify faz ele parar de ganhar linhas-zero novas — some de janelas de data futuras, igual um ad que parou de gastar.
- **Read path por síntese:** linhas-zero diárias em `ad_metrics` (uma por dia, clamped ao `created_time` — ad criado no meio do range não ganha zeros de antes de existir). Síntese no nível RAW ("FASE 1.5" do `job_processor`), então formatter/enricher/upserts/apm tratam a linha-zero como linha normal. A chave composta `(date, ad_id)` faz a linha real sobrescrever a zero via upsert quando o ad começa a gastar.
- **Guardrails:** fail-open (falha no inventário → warning + comportamento antigo); teto de 40 páginas no inventário e 25k linhas sintetizadas (prioriza ads mais recentes, corte logado); inventário vazio → `status_details=None` → caminho antigo de status.
- **Rejeitado:** `insights{}` aninhado em `/ads` (vira sync, paginação 2D por ad, mata o skip de refresh, mesmo nº de páginas pesadas); reescrita das RPCs (drift do wrapper chain `_v066/_v067` + statement_timeout).

**Arquivos:** `backend/app/services/ad_inventory.py` (novo — funções puras testáveis); `backend/app/services/ads_enricher.py` (`fetch_inventory`, `allow_empty_filters` + page cap no paginador, param `status_details` no `enrich`); `backend/app/services/job_processor.py` (FASE 1.5: inventário + síntese); `backend/tests/test_ad_inventory.py` (12 testes, incl. o caso real 16+8=24).

---

## useLoadPacks deve sincronizar todos os campos mutáveis de packs existentes

**Data:** 2026-06-12

**Problema:** O Zustand store de packs é persistido (`persist` middleware, `partialize` em `session.ts` salva packs com datas mas sem ads). Isso significa que toda reload de página cai no branch `else` ("pack já existe") de `useLoadPacks` — nunca no `addPack`. O branch `else` original só atualizava `stats`, `sheet_integration` e `conversion_types`. `date_start`, `date_stop`, `name`, `auto_refresh` e `last_refreshed_at` nunca eram sincronizados. Um pack com range estendido fora desta sessão (cron de auto_refresh, outro device) fazia o Manager consultar o período antigo — dados novos existiam no banco mas não apareciam, sem nenhum erro visível.

**Fix:** no branch `else`, acumular um `patch` com comparação direta (`!==`) para campos escalares e `JSON.stringify` para objetos, e chamar `updatePack(id, patch)` uma única vez apenas se `Object.keys(patch).length > 0` (evita re-render desnecessário).

**Regra:** sempre que um campo mutável for adicionado ao schema do pack (vindo do `listPacks`), incluí-lo na lista de sincronização do branch `else`.

**Arquivos:** `frontend/lib/hooks/useLoadPacks.ts` (branch `else`, linhas 123-150).

---

## Todo hook de query de analytics (performance E drill) deve threadar o abort signal

**Data:** 2026-06-12

**Contexto:** Já era regra threadar o `signal` do TanStack Query até o Axios nos hooks de **performance** (rankings/series/retention) — sem isso, `cancelQueries()` no logout é soft-cancel e o HTTP em-voo segue moendo o DB até `statement_timeout` (57014) + 500/Sentry. Os hooks de **drill** (`useAdVariations`, `useCampaignChildren`, `useAdsetChildren`, `useAdDetails`, `useAdCreative`, `useAdHistory`, `useAdNameDetails`, `useAdNameHistory`) eram a exceção: não threadavam.

**Fix:** os endpoints GET de drill em `endpoints.ts` ganharam `options?: { signal?: AbortSignal }` repassado como `apiClient.get(url, { signal })`, e os hooks passaram a `queryFn: ({ signal }) => api...(..., { signal })`. Abrir um modal de drill e fazer logout deixava o GET pendente até o timeout — agora aborta junto.

**Regra:** **todo** hook de query de analytics threada o signal, não só os pesados.

**Arquivos:** `frontend/lib/api/endpoints.ts`, `frontend/lib/api/hooks.ts`.

---

## Export CSV neutraliza formula-injection só em texto livre

**Data:** 2026-06-12

**Problema:** Células de CSV que começam com `=`, `+`, `-`, `@` (ou tab/CR) são interpretadas como fórmula ao abrir no Excel/Sheets — vetor de injection, já que nomes de ad/campanha vêm do Meta e transcrições vêm do usuário.

**Fix:** `neutralizeFormula(value)` em `exportManagerCsv.ts` prefixa `'` quando o valor casa `/^[=+\-@\t\r]/`. **Armadilha:** aplicar indiscriminadamente quebraria métricas numéricas negativas (`-1,50` → `'-1,50`, tratado como texto). Por isso a neutralização roda **só nos campos de texto livre** (nome, status, transcrição), nunca no resultado de `formatValue`.

**Regra:** todo export CSV com strings de fonte externa passa os campos textuais por `neutralizeFormula` antes do quoting; números ficam de fora.

**Arquivos:** `frontend/lib/utils/exportManagerCsv.ts`.

---

## Setter compartilhado de actionTypeOptions limpa seleção órfã quando o conjunto é vazio

**Data:** 2026-06-12

**Problema:** `setActionTypeOptions` (em `filters.ts`, compartilhado por Manager/Explorer/Insights/Gold) só auto-selecionava `options[0]` quando `options.length > 0`. Quando os packs/período atuais não têm nenhum conversion type (`options=[]`), um `actionType` selecionado anteriormente ficava órfão e produzia `results=0` em tudo, sem aviso.

**Fix:** branch `else if (actionType)` no setter limpa `actionType` para `''` quando `options=[]`. **Por que é seguro mexer no setter compartilhado:** Explorer só chama com guard `length > 0` (nunca passa `[]`); Insights/Gold só chamam no `.then` de fetch bem-sucedida (`[]` ali é resultado real); Manager rehidrata packs com `conversion_types` persistidos (sem transiente vazio durante load) e tem gate `selectedPackIds.size > 0`.

**Arquivos:** `frontend/lib/store/filters.ts` (`setActionTypeOptions`).

---

## Eixo Y de retenção precisa de ancestrais overflow-visible

**Data:** 2026-05-31

**Regra:** o eixo Y de retenção (0%–100%) do `AdDetailsDialog` é desenhado **fora** da borda esquerda do player, em `left-[-2rem]` (no `RetentionChartOverlay` e no `RetentionVideoPlayerSkeleton`). O contêiner do vídeo deve reservar `ml-8` à esquerda e permanecer `overflow-visible`. Qualquer ancestral com `overflow-hidden`/`overflow-y-auto` corta o eixo.

**Por quê:** caso real — uma edição adicionou `overflow-hidden bg-black rounded-lg` ao contêiner do player (para frame preto arredondado) e o eixo sumiu no player e no skeleton. O `VideoPlayer` já aplica `bg-black rounded-lg overflow-hidden` internamente, então clipar no wrapper externo era redundante **e** quebrava o eixo.

**Como aplicar:** `overflow-hidden bg-black` só no caso **imagem** (`isImageAd`); no vídeo, contêiner com `ml-8 rounded-lg` sem `overflow-hidden`, deixando o `VideoPlayer` cuidar do clip/fundo. Ao embutir `RetentionVideoPlayer` em qualquer lugar, garantir ancestrais `overflow-visible`.

**Arquivos:** `frontend/components/ads/AdDetailsDialog.tsx` (contêiner do player + `VideoTabSkeleton`); `frontend/components/common/RetentionVideoPlayer.tsx`; `frontend/components/common/VideoPlayer.tsx`; `frontend/components/charts/RetentionChartOverlay.tsx`.

---

## Design system: padronização fase a fase com a allowlist do checker como backlog

**Data:** 2026-05-31

**Regra:** a padronização do design system do frontend é feita **uma fase por vez**, e a `RULE_ALLOWLIST` em `frontend/scripts/check-design-system.ts` é o **rastreador oficial do backlog**. Entradas marcadas `"legacy ... phase"` = dívida a migrar; entradas como `components/ui/`, `components/icons/`, `components/charts/`, `TopBadge` e fallbacks de framework = exceções **permanentes**. "Pronto" de uma fase = a allowlist encolheu e `npm run check:design-system` continua verde.

**Por quê:** o checker fica verde com ~0 violações ativas porque o grosso da dívida está escondido na allowlist. Sem tratar a allowlist como backlog, "padronizar o que falta" vira invisível. Encolher a allowlist a cada fase torna o progresso mensurável e impede regressão (o checker volta a falhar se alguém reintroduzir o padrão antigo num arquivo já migrado).

**Como aplicar:**
1. Cada fase isolada (um commit): migrar arquivos → remover/estreitar a entrada da allowlist → `cd frontend && npx tsx scripts/check-design-system.ts` (verde) + `tsc --noEmit`.
2. Ordem por valor/esforço: switches → dialogs → form-step → upload → kanban.
3. Antes de remover uma entrada, confirme que o arquivo não dispara mais a regra (grep dos imports de primitivas). Entradas combinadas (ex.: `ManagerTable|StatusCell`) podem ficar obsoletas inteiras.
4. Skeleton de **formato real** (card, linha de tabela, media, chart) é exceção legítima documentada inline com `// design-system-exception: direct-skeleton-import - motivo`, não na allowlist global.
5. `Switch` cru sem label visível (célula densa) → `ToggleSwitch variant="minimal" ariaLabel={...}` (o `ToggleSwitch` agora repassa `aria-label`).

**STATUS: CONCLUÍDA.** Todas as fases fechadas. A `RULE_ALLOWLIST` não tem mais nenhuma entrada `"legacy ... phase"` — só exceções **permanentes** (brand icons, platform/chart previews, badge recipes, overlay opacity, framework fallbacks, dev/demo, primitivas `ui/`, wrappers compartilhados, skeletons bespoke).

Histórico: verde inicial (PackCard switch, FacebookConnectionCard banner→InlineNotice, packs skeleton exception) → switches (StatusCell→ToggleSwitch com `ariaLabel`, PackFilter import órfão) → dialogs (VideoDialog `Modal`→`AppDialog`, depois descoberto **código morto** desde 2025-12-30 e deletado junto com o wiring no ManagerTable) → form-step/upload/kanban/Topbar: **todas eram entradas stale** (nenhum arquivo importava primitivo flagged); só removi/estreitei entradas da allowlist. Topbar estreitado de `[primitive, skeleton]` para `[skeleton]` (avatar redondo + botão de conectar são skeletons bespoke).

**Lição central:** a allowlist **exagerava muito** a dívida — de ~6 fases aparentes, só a de switches teve migração real de código; o resto eram entradas obsoletas de trabalho anterior. Antes de dimensionar uma fase, faça **grep dos imports reais** (`@/components/ui/{card,switch,dialog}`, `@/components/common/Modal`, `@/components/ui/skeleton`) e valide empiricamente removendo a entrada + rodando `npx tsx scripts/check-design-system.ts`. Manutenção futura: ao tocar num arquivo allowlisted, reconfira se a entrada ainda é necessária.

**Arquivos:** `frontend/scripts/check-design-system.ts`; `frontend/components/common/ToggleSwitch.tsx` (`ariaLabel`); `frontend/components/manager/StatusCell.tsx`; `frontend/components/common/PackFilter.tsx`; `frontend/components/packs/PackCard.tsx`; `frontend/components/facebook/FacebookConnectionCard.tsx`.

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

**Recidiva (2026-07-18) — batch de nomes NÃO limita linhas:** o bug voltou em duas queries por `ad_name` que *pareciam* limitadas por batchear 200 nomes por `.in_()`: `get_ads_video_fields_by_names` (batch de URLs de vídeo do export CSV) e `_hydrate_media_type_for_rankings_rows` (coluna "Media type" do Manager). O limite de 200 nomes existe pelo **tamanho da URL**; o número de LINHAS é outra dimensão — `ad_name` tem fan-out de ~27,5 instâncias por nome no workflow real de duplicação em massa (medido: 200 nomes → 1.467 linhas). Sintomas do truncamento (que varia por request, sem ORDER BY): media_type piscando entre fetches no Manager/export, e "ERRO: Anúncio sem vídeo ou não encontrado" no export para ads com 6 instâncias `video` saudáveis no banco. Correção: `_fetch_all_paginated` com `.order("ad_id")` dentro de cada lote de nomes; na hidratação, precedência `video > image` (e `unknown` nunca sobrescreve) em vez de first-row-wins; no dialog de export, snapshot congelado das linhas para o CSV sempre bater com a tela de revisão. Regra nova: **toda query em tabela com fan-out (1 nome → N ads) pagina linhas, mesmo com IN-list pequena**.

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

---

## Stripe Billing — Hosted Checkout + Billing Portal para tier Insider

**Data:** 2026-06-07

**Regra:** o upgrade para Insider usa **Stripe Hosted Checkout** (`mode=subscription`) e o **Billing Portal** para self-service. O webhook é a única fonte de verdade para flips de tier — o frontend nunca concede tier com base no retorno do checkout.

**Por quê:**
- Hosted Checkout elimina toda a superfície PCI no servidor (SAQ A); nenhum dado de cartão passa pelo backend.
- A preocupação "servidor cai enquanto alguém paga" é resolvida pelo próprio Stripe: o pagamento é capturado na infraestrutura deles, e o webhook é reenviado com backoff exponencial por até 72h. Quando o servidor volta, os eventos enfileirados entregam e o tier flipa. Por isso o handler de webhook deve ser **idempotente** (tabela `stripe_events` com PK no `event_id`).
- Guardar `source='stripe'` na linha de `subscriptions` permite o guard que impede o webhook de sobrescrever concessões manuais (`source='manual'` ou `source='promo'`) de admin/promo.

**Preços (2026-06-07):**
- Mensal: R$97 (`STRIPE_PRICE_INSIDER_MONTHLY`)
- Anual: R$790 (`STRIPE_PRICE_INSIDER_ANNUAL`) com parcelamento BR (`payment_method_options.card.installments.enabled=true` no Checkout Session — ativo só se o Dashboard tiver installments habilitado)

**Arquivos críticos:**
- `supabase/migrations/070_subscriptions_stripe.sql` — colunas `stripe_customer_id`, `stripe_subscription_id`, `stripe_status`, `cancel_at_period_end` + tabela `stripe_events`
- `backend/app/routes/billing.py` — router `/billing` (checkout-session, portal-session, webhook)
- `backend/app/core/config.py` — vars `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_INSIDER_MONTHLY`, `STRIPE_PRICE_INSIDER_ANNUAL`, `FRONTEND_BASE_URL`
- `frontend/lib/api/endpoints.ts` — `api.billing.createCheckoutSession` / `createPortalSession`
- `frontend/app/planos/page.tsx` — toggle mensal/anual, botão "Assinar Insider" / "Gerenciar assinatura", invalidação de `["user-tier"]` no retorno do checkout

**Como testar localmente:**
```bash
stripe listen --forward-to localhost:8000/billing/webhook
# copiar o webhook secret impresso como STRIPE_WEBHOOK_SECRET no backend/.env
# testar com cartão 4242 4242 4242 4242
```

**Observação operacional:** a migration `083` ainda precisa ser aplicada no banco remoto para o formulário persistir de verdade.

---

## Billing Stripe — P0 fix, idempotência segura e tier enforcement

**Data:** 2026-06-12

**Contexto:** revisão completa do codebase identificou que todo comprador de primeira viagem pagava e não recebia o tier Insider.

### P0: source='manual' bloqueava grant

Migration 068 cria toda `subscription` com `source='manual'`. O guard `_is_stripe_managed` em `_handle_checkout_completed` rejeitava essas rows, então `tier`, `source` e `stripe_subscription_id` nunca eram gravados. Todos os webhooks subsequentes ficavam no-op (lookup por `stripe_subscription_id` retornava vazio).

**Fix:** `_handle_checkout_completed` agora usa `upsert(on_conflict="user_id")` sem skip por source. Migration 084 faz backfill de usuários pré-068 sem row.

**Remediação de vítimas:** `stripe events resend` não funciona (event_id já dedupado em `stripe_events`). Corrigir via SQL manual por usuário afetado.

### Idempotência correta

**Bug antigo:** evento inserido em `stripe_events` antes do handler — se handler falhasse, retry do Stripe encontrava o registro e skippava para sempre.

**Fix (migration 084 + billing.py):** `stripe_events` ganha coluna `status CHECK('processing','processed')`. Fluxo:
1. `_record_event` insere com `status='processing'` — só `APIError code='23505'` é tratado como duplicado
2. Handler executa
3. `_mark_event_processed` seta `status='processed'` após sucesso
4. Handler com exceção mantém `processing` → Stripe retenta → retry reexecuta o handler (idempotente via `stripe.Subscription.retrieve` live)

### Basil API (Stripe 2025+)

Campos movidos que quebraram silenciosamente:
- `invoice.subscription` → `invoice.parent.subscription_details.subscription`
- `current_period_end` (top-level) → `items.data[].current_period_end`

Helpers `_invoice_subscription_id` e `_subscription_period_end` lêem ambas as localizações.

**Regra crítica:** NUNCA escrever `expires_at=None` num update — NULL = nunca expira. Omitir a chave quando `period_end` for desconhecido.

### Tier enforcement com grace period

**Por quê:** `expires_at` não era enforçado — Insider era eterno se qualquer webhook se perdesse.

**Regra (espelhada em backend e frontend):**
- `expires_at = NULL` → nunca expira
- Expirado há ≤7 dias → grace period (cobre ciclo de retry Stripe em `past_due`)
- Expirado há >7 dias → downgrade para standard

Backend: `backend/app/core/tier.py` → `get_effective_tier` + `require_min_tier(minimum)`. Aplicado em 12 endpoints (9 do facebook.py + 3 do meta_usage.py). `require_min_tier("admin")` substituiu `_require_admin` em admin.py (corrigindo `.single()` → row ausente virava 500 em vez de 403).

Frontend: `getEffectiveTier` em `tierConfig.ts`; middleware usa `.maybeSingle()` + prefix-match de rotas.

### Proteção do tier admin

Webhooks nunca rebaixam tier `admin` (guard explícito em `_handle_checkout_completed`, `_handle_invoice_succeeded` e `_handle_subscription_deleted`).

### Recovery de pagamento

`_handle_invoice_succeeded` re-concede `tier='insider'` quando status live ∈ {active, trialing} — sem isso, usuário que recupera `past_due` após carência ficava standard para sempre mesmo pagando.

**Arquivos:** `backend/app/routes/billing.py`; `backend/app/core/tier.py` (novo); `backend/app/routes/facebook.py`; `backend/app/routes/meta_usage.py`; `backend/app/routes/admin.py`; `frontend/lib/config/tierConfig.ts`; `frontend/lib/hooks/useUserTier.ts`; `frontend/middleware.ts`; `frontend/app/planos/page.tsx`; `supabase/migrations/084_billing_fixes.sql`; `backend/tests/test_billing_webhooks.py` (novo); `backend/tests/test_tier_dependency.py` (novo).

---

## Classificação de media_type: creatives SHARE e evidência por métricas (2026-05)

### O problema

Creatives `object_type: SHARE` (posts boostados do Instagram/Facebook) só expõem `id`, `actor_id`, `thumbnail_url`, `instagram_permalink_url` e `effective_object_story_id` — **sem `video_id` e sem campos de imagem**. O vídeo pertence ao post original, não ao criativo do ad.

`resolve_media_type` usava `thumbnail_url`/`thumb_storage_path` como sinal de imagem — mas **todo ad tem thumbnail, inclusive vídeos**. Resultado: ~8 mil ads de vídeo SHARE gravados como `media_type='image'`; o modal tratava como imagem e chamava `/facebook/image-source` (400), com seção de Retenção desabilitada indevidamente.

Bug agravante: o `dataformatter` descartava `media_type`/`primary_video_id` preservados pelo enricher (`_apply_existing_fixed_fields`) — o dict `formatted_ad` não incluía esses campos do ad de entrada — então a classificação era recomputada do zero a cada sync e **qualquer correção manual no banco era desfeita pelo sync seguinte**.

### A solução: cadeia de classificação com evidência de métricas

Um ad com `video_total_plays > 0` **é vídeo por definição** — só vídeo gera `video_play_actions`. Sinal gratuito (já vem nos insights), decisivo e auto-corretivo. Validação: 0,12% de falso-imagem em 3.354 vídeos confirmados; imagens nunca registram video plays (autoplay garante plays≈impressões em vídeos).

**Não usar a curva (`video_play_curve_actions`) como sinal:** em casos raros ela aparece com valor > 0 em ads de imagem (no banco: 1 linha com curva e zero plays, contra 25.379 com curva+plays). Só `video_total_plays` é confiável. Por isso os campos de imagem são checados ANTES da evidência de métrica — uma imagem com curva/plays espúrios não pode ser derrubada para vídeo.

Ordem em `ad_media.resolve_media_type` (a ordem importa):
1. `video_id` presente → video
2. Campos genuínos de imagem (`image_hash`, `image_url`, `photo_data`, asset images) → image
3. Evidência de plays (`video_total_plays > 0`) → video (corrige `image` stale automaticamente)
4. Classificação anterior preservada (`video`/`image`) → mantém (dia sem delivery não regride o tipo)
5. unknown

**`object_type` retorna `SHARE` (esconde a mídia real):** o drill-down canônico via `effective_object_story_id{attachments}` (traz `media_type` photo/video + a mídia) é requisitado pelo enricher mas vem vazio — a Meta devolve só o ID string (0 de 19.412 SHARE têm attachments). **Causa raiz confirmada:** o enricher faz a requisição com o token da conta de anúncios (`self.access_token`), que não tem permissão para ler o post da página — a expansão de attachments exige **page token**. Por isso `video_total_plays > 0` virou o sinal mais confiável disponível.

**❌ Hipótese page token testada e descartada (2026-06-12):** smoke test (`backend/scripts/test_share_attachments.py`) confirmou que o page token desbloqueia o erro #10, mas os attachments retornam `type=share, media_type=link, target=None` — os "posts" dos ads SHARE são **dark posts gerados pelo próprio ad** (macros `{{campaign.name}}`/`{{product.name}}` na URL), sem objeto de vídeo/foto no post. A solução real está na seção seguinte.

Três pontos coordenados:
- `ad_media.py` — regras acima
- `dataformatter.py` — passthrough de `media_type`/`primary_video_id` do ad de entrada para o `formatted_ad`
- `supabase_repo.upsert_ads` — dedup por ad_id não deixa linha `unknown` (dia sem delivery) sobrescrever classificação definitiva de outra linha do mesmo batch

Frontend: `isImageAd` exige `media_type === "image"` explícito — sem catch-all "sem video_id = imagem".

### Remediação executada (2026-05-25)

Com aprovação prévia e SELECT de verificação antes de cada UPDATE:
- 2.214 ads (plays > 0) → `video`; `video_owner_page_id=NULL` para forçar re-enriquecimento (próximo refresh re-busca `adcreatives`+`source_ad` e pode recuperar o `video_id` reproduzível)
- 6.777 ads (zero plays, ≥100 impressões) → `image`
- +699 ads (zero plays, 1-99 impressões) → `image` numa segunda passada, após validar que vídeos conhecidos nessa faixa registram plays em 99,5% dos casos (372 de 374) → **zero `unknown` restantes**

**Lição de processo:** UPDATE em produção sempre precedido de SELECT com os mesmos filtros + announce do impacto. A primeira tentativa de remediação (sessão anterior) marcou tudo como `unknown` sem validar evidência de vídeo — funcionou por sorte, não por método.

**Arquivos:** `backend/app/services/ad_media.py`; `backend/app/services/dataformatter.py`; `backend/app/services/supabase_repo.py`; `backend/tests/test_ad_media_type.py` (novo); `frontend/components/ads/AdDetailsDialog.tsx`.

## Resolução definitiva de mídia de QUALQUER ad: `effective_instagram_media_id` + `asset_feed_spec` (2026-06-12)

### Descoberta

Investigação empírica (360 ads estratificados por tempo do inventário de 9.640 ads do usuário autenticado, batches reais na Graph API) encontrou o caminho oficial que cobre **100% dos ads** — incluindo os SHARE que escondem a mídia:

1. **`effective_instagram_media_id`** no creative (~90–95% dos SHARE): `GET /{igm}?fields=media_type,media_url,thumbnail_url,permalink` com **user token comum** retorna:
   - `media_type` **autoritativo** (`VIDEO`/`IMAGE`/`CAROUSEL_ALBUM`) — fim da heurística como sinal primário
   - `media_url` direto do CDN — vídeo é `video/mp4` HTTP 200 reproduzível, imagem é jpg
   - **Funciona mesmo com `instagram_basic` declined** — o contexto da Marketing API (`ads_read`) autoriza leitura de IG media de anúncios. Sem App Review extra, sem page token.
   - Batchável via `?ids=` (50 por chamada)
2. **`asset_feed_spec.videos[].video_id` / `.images[]`** no creative direto (criativos flexíveis): resolveu **37/37** dos ads sem igm na amostra — cobertura combinada 100%.
3. Nativo: `video_id` / `image_url` / `image_hash` (ads clássicos não-SHARE).
4. Playback: `GET /{video_id}?fields=source` com page token (fluxo existente) OU a própria `media_url` do IG.

### Auditoria da heurística de plays

Comparando `media_type` do DB vs IG oficial em 213 medias: 318/323 corretos (98,5%); **5 falso-vídeo** detectados (ads de imagem marcados `video` pela remediação). A rota IG permite corrigir em massa e rebaixar a heurística a fallback de última instância.

### Implementação (2026-06-12)

Todos os gaps corrigidos nas etapas abaixo:

**Etapa 1** — `ad_media.resolve_media_type`: checa `ig_media_type` (normalizado pelo enricher via igm) **antes** de qualquer outra regra. `dataformatter.py` passa o campo adiante.

**Etapa 2** — `_DETAILS_FIELDS`: `effective_instagram_media_id,image_url,image_hash` adicionados aos dois blocos `creative{}` (source_ad e direto). `merge_details` indexa por `detail["id"]` (ad_id) com fallback por nome — representante recebe creative exato; asset_feed_spec enxuto injetado no creative quando ausente.

**Etapa 3** — `fetch_ig_media_types()`: batch `GET /?ids=&fields=media_type` (50/call, split-on-error, best-effort). Chamado em `enrich()` após `merge_details`; escreve `ad["ig_media_type"]` normalizado. **Passe restrito aos ads frescos do ciclo** (`ad_id`/`name` presente em `media_details`): ads reusados no refresh não re-buscam o igm — caso contrário, todo refresh re-buscaria o media_type de todo o inventário, contradizendo a otimização que já restringe `fetch_details` ao `rep_ids` reduzido. Full sync resolve todos (media_details = todos os representantes); refresh resolve só novos + sem `video_owner_page_id`. A auto-correção em massa dos falso-vídeo fica a cargo do backfill (uma vez), não do refresh diário.

**Etapa 4** — `get_image_source_url`: campo `effective_instagram_media_id` incluído no read do ad; step 4 novo: `GET /{igm}?fields=media_url` → `{"image_url": media_url}`. Resolve 400 atual dos SHARE sem image_hash.

**Etapa 5** — `get_video_source_url`: param `ig_media_id` optional, `video_id` optional; step 5: `GET /{igm}?fields=media_url` → `{"source": media_url}`. Rota `/video-source`: `video_id` vira opcional, `ig_media_id` adicionado. Frontend: `extractInstagramMediaId()` helper; `shouldLoadVideo` relaxado para `!!videoId || !!igMediaId`; `useVideoSource` recebe `ig_media_id`; guard de empty state considera igm; schemas atualizados.

**Etapa 6** — `backend/scripts/backfill_media_classification.py`: corrige inventário legado do Igor (unknown + video sem fonte + image sem hash), com `--dry-run` default e SELECT antes de UPDATE.

**Decisão mantida:** `merge_details` dedup por nome preservado (custo > correção de homônimos raros). `media_url` do igm não persiste (CDN assínado + expira) — só `media_type` + igm id persistidos; URL on-demand.

### Modelo fechado (revisão final 2026-06-12)

**Taxonomia — 3 grupos, disjuntos por DECISÃO (não por campo):** os campos brutos se sobrepõem (um ad pode ter `video_id` *e* `igm` — 95/120 do bucket with_id têm), mas o gate parte o universo em conjuntos disjuntos:

| Grupo | Mídia mora em | Categorização | Busca igm? |
|---|---|---|---|
| Clássico (não-SHARE) | `video_id` / `image_hash` direto | estrutural | não |
| SHARE multi-asset | `asset_feed_spec.videos` / `.images` | estrutural | não |
| SHARE single-asset | **só** `effective_instagram_media_id` | igm (autoritativo) | **sim** |

`Grupo estrutural ∩ Grupo single-asset = ∅` **por construção**: o lookup do igm é gateado em `resolve_structural_media_type(ad) is None` (extraída em `ad_media.py`, compartilhada por categorização e gate). Soma-se ao gate de frescos → igm só busca **single-asset recém-ingerido ainda não categorizável**; igms distintos deduplicados (1 chamada por post boostado).

**Escada de categorização** (`resolve_media_type`, curto-circuito): `ig_media_type` (só single-asset, pós-gate) → estrutural (`video_id`|`image_hash`) → `video_total_plays>0` → preservado do DB → unknown.

**Cascata do modal** (ramifica pelo `media_type` persistido, independente da categorização):
- `image` → `get_image_source_url`: hashes→`/adimages` → **igm→media_url** → `creative.image_url`
- vídeo/unknown → `get_video_source_url`: `video_id`? cascata page-token : **igm→media_url**

O endpoint do modal (`analytics.py /rankings/ad-id/{id}/creative`) devolve o `creative` cru do DB, que já carrega o `effective_instagram_media_id` persistido — `extractInstagramMediaId` no frontend o consome.

**Carrossel (suporte mínimo):** `fetch_ig_media_types` e `_fetch_igm_media_url` expandem `children{}` e categorizam/servem pelo **primeiro filho** (vídeo/imagem) — não quebra o modal e dá suporte básico. Galeria swipeable completa (novo `media_type="carousel"`, UI multi-card) **adiada** — carrossel não apareceu em 360 ads da amostra.

**Transcrição agnóstica de origem:** `_extract_video_info` + `_resolve_video_url` (transcription_worker) threadam `ig_media_id` → SHARE single-asset de vídeo (sem `video_id`) agora transcreve via `media_url` do igm. Antes era pulado.

**Resíduos aceitos:** (1) carrossel mostra só o 1º item (galeria adiada); (2) falso-vídeo + falha de rede no igm → player recebe jpg, auto-cura no próximo sync; (3) ads legados pré-deploy só ganham igm no creative após re-sync ou backfill.

**Testes:** `test_ad_media_type.py` (estrutural + igm), `test_ads_enricher_merge.py` (merge por id/nome + asset_feed inject), `test_transcription_extract.py` (origem da mídia).

**Evidência:** `backend/scripts/test_share_attachments.py`, `test_media_discovery.py`, `test_media_coverage.py`, `test_media_gaps.py` + relatórios JSON em `backend/scripts/debug_output/`.

## Plano de Ação — alavancas por grupo (2026-06-21)

**Bug corrigido:** o grupo **Aprender** (`licao`) exibia "Ponto forte: Link CTR — recicle esse elemento" apontando para uma métrica **abaixo** da média (-26.5%). Causa: `pickLever()` (em `actionPlan.ts`) só seleciona de `below_avg_flags` (métricas a *corrigir*) e era reusado tanto em `otimizar` quanto em `licao`. Em `otimizar` o copy é "Corrija X" (correto: métrica fraca); em `licao` o copy é "Ponto forte" — semântica **oposta**, mas alimentada pela mesma alavanca. Resultado: a métrica mais fraca era rotulada como ponto forte.

**Correção + melhoria pedida:** `pickLever` → duas funções, e os campos `fixLever?` viraram dois arrays ordenados em `ActionItem`:
- `fixLevers: FixLeverKey[]` (só `otimizar`) — **todas** as métricas abaixo da média (`website_ctr`/`connect_rate`/`page_conv`), ordenadas por impacto: menor `cpr_if_*_only` (maior ganho de CPR) primeiro.
- `strongLevers: StrongLeverKey[]` (só `licao`) — **todas** as métricas acima da média, ordenadas da mais forte para a menos forte por margem relativa `(valor-média)/média`. Inclui `hook` (eixo do veredito, embora não componha o CPR); funnel levers seguem `website_ctr`/`connect_rate`/`page_conv`.

A UI (`ActionPlanRow.tsx`) lista todas as alavancas separadas por vírgula; singular/plural no copy. `LEVER_LABEL` ganhou `hook: "Hook"`.

**Limitação herdada:** `opportunityRows` só existem para ads com ≥1 métrica de funil abaixo da média (filtro `withDeficit` em `computeOpportunityScores`); um ad `licao` sem nenhum déficit de funil não tem opp row → `strongLevers` vazio → cai em "Pausar e aprender com este anúncio". Não é regressão (o `pickLever` antigo tinha a mesma dependência).

## Meta `/me/adaccounts` pagina em 25 por página (2026-06-21)

**Bug:** uma BM mostrava menos ad accounts no Hookify do que o usuário via no Ads Manager. Causa: o edge `GET /me/adaccounts` da Meta retorna **no máximo 25 contas por página** (default), com o restante atrás de `paging.next`. `GraphAPI.get_adaccounts` (`graph_api.py`) lia só a primeira página (`data.get('data', [])`) — então qualquer conexão com **>25 ad accounts** perdia as excedentes **silenciosamente** (sem erro, sem log).

**Correção:** loop seguindo `paging.next` acumulando todas as páginas (mesmo padrão que `get_account_info` já usava no sub-edge `adaccounts{}`) + `limit: 200` no payload para reduzir round-trips.

**Por que era invisível:** o sync (`/adaccounts/sync`) e o read (`list_ad_accounts`) **não filtram** por status nem nada — o Hookify espelha exatamente o que `me/adaccounts` devolve. Se uma conta some, ou (a) o token não a retornou (grant granular do OAuth / falta de role direto na conta) ou (b) ficou atrás da paginação. Esta correção cobre (b); para (a) o diagnóstico é a tela **Business Integrations** do Facebook (mostra os assets concedidos especificamente ao app) + comparar `me/adaccounts` com `owned_ad_accounts`/`client_ad_accounts` da BM no Graph API Explorer.

**Regra geral:** todo edge de lista da Meta (`/me/adaccounts`, `/me/businesses`, `owned_ad_accounts`, `client_ad_accounts`, `/ads`, `/insights`) tem cap de página — **sempre** seguir `paging.next`. Mesma classe de bug do cap silencioso de 1000 linhas do PostgREST.

## Bug CPR=R$0 em todo lugar — RPC de rankings é single-key por action_type (2026-06-22)

**Sintoma:** Plano de Ação (e GOLD, e o "vs média" do modal) mostravam CPR "—" em todas as linhas e média de CPR = R$ 0,00. O modal mostrava o CPR do próprio anúncio correto (R$ 9,68 / 3269 results) porque ele busca de outro endpoint.

**Causa-raiz (verificada via psql na RPC ao vivo):** `fetch_manager_rankings_core_v2` (cadeia de wrappers → `_base_v067`→`_base_v066`→`_base_v060`) monta o `conversions` de CADA linha como objeto de **uma chave só** — `jsonb_build_object(v_selected_key, results)` — onde `v_selected_key` é o `p_action_type` pedido, **prefixado** (`action:purchase`). Sem `p_action_type`, sai `conversions={}` e `results=0` em todas as linhas.

As páginas **Plano, GOLD e Insights** montavam o request de `/ad-performance` **sem `action_type`** (o Manager mandava `action_type: actionType || undefined`). Resultado: `conversions={}` em 228/228 linhas → `conversions[actionType]`=0 → CPR por-ad="—", média CPR=R$0 (safeDiv/0), e a classificação G.O.L.D./Plano colapsa (`computeAdDerivedMetrics`: `results>0 ? spend/results : Infinity` → CPR=Infinity p/ todos → todos `cprAboveAvg` → **golds/oportunidades sempre vazios**). Isto — e não o viés da média ponderada — é a verdadeira razão de Escalar/Otimizar estarem vazios.

**Prova (RPC com auth.uid setado, pack 351ec1a9…, 29/04→07/05):**
- sem `action_type` → `row0.conversions={}`, 228/228 linhas vazias, `per_action_type[purchase]`=MISSING.
- com `action_type='purchase'` (bare) → `{"conversion:purchase":0}` (a RPC assume prefixo `conversion:`, mas "purchase" é um **action**) → ainda 0.
- com `action_type='action:purchase'` (chave prefixada real) → `{"action:purchase":3269}`, 184/228 com results, `per_action_type[action:purchase].cpr=14.14`. ✓

**Contrato correto:** `actionType` no frontend JÁ é a chave prefixada (`ActionTypeFilter` só remove o prefixo no label). Páginas que derivam CPR/results client-side a partir de `/rankings|/ad-performance` DEVEM: (1) mandar `action_type: actionType || undefined`; (2) por `actionType` nas deps do fetch; (3) ler `conversions[actionType]`.

**Fix aplicado:** `action_type` + dep `actionType` em `app/plano/page.tsx` e `app/gold/page.tsx` (alinhado ao `manager/page.tsx`, que já funcionava). **Insights NÃO corrigido**: além do mesmo `action_type` faltando, usa `packActionType` por-pack, incompatível com a RPC single-key — precisa de decisão à parte (provável caminho: reusar a camada de dados do Manager em vez de duplicar o pattern do GOLD).

## Consolidação do pipeline Plano/GOLD/Insights + armadilha do setActionTypeOptions (2026-06-23)

**O quê:** as três páginas duplicavam ~120 linhas do mesmo pipeline (fetch `/ad-performance` → filtro por pack → loop de validação → médias), copiadas de uma versão velha do GOLD — foi por aí que o bug do `action_type` faltando (CPR=R$0) se espalhou. Extraído para o hook compartilhado `useAdPerformancePipeline` (`lib/hooks/`), modelado no Manager (TanStack `useAdPerformance`, abort/retry/cache de graça). O hook **sempre** manda `action_type: actionType || undefined` → conserta o CPR=0 de forma definitiva para todas as páginas migradas. Helper `buildAdMetricsData` extraído para `validateAdCriteria.ts` (com teste). Insights usa `filterToSelectedPacks: false` (valida sobre o `serverData`, que o servidor já escopa via `pack_ids`); o seletor de evento **por-pack** ficou `// KNOWN ISSUE` (incompatível com a RPC single-key + usa médias globais).

**Armadilha encontrada no code-review (quase reintroduziu o CPR=0):** o `setActionTypeOptions` do filters store tem DUAS responsabilidades acopladas — (1) popular `actionTypeOptions`, (2) reconciliar `actionType`: auto-selecionar o 1º quando inválido/vazio **e limpar (→'') um `actionType` órfão quando a lista vem `[]`**. A primeira versão do hook gateava o sync em `availableConversionTypes.length > 0` — o que parecia razoável, mas **matava a limpeza do órfão**: trocar para um pack/período sem aquele evento deixava um `actionType` inexistente → `conversions[actionType]=0` → CPR/results=0 em tudo, silenciosamente (mesma classe do bug single-key acima). **Correção:** o hook gateia só em `queryData` (fetch resolvido, nunca loading transiente) e chama incondicionalmente — inclusive com `[]`. A deduplicação de re-render (não reescrever quando a lista não mudou) mora no **próprio store**, beneficiando todos os callers (Manager/Explorer/pipeline), não num gate do caller.

**Outras correções do mesmo review:** Plano distingue "período sem anúncio" de "nenhum passou na validação" via `filteredRankings.length` (antes mostrava "ajuste os critérios" para período vazio); erro de fetch voltou a ser surfaçado (`console.error` + toast sonner via `showError` no hook — antes ficava indistinguível de "sem dados"); `packsAdsLoading` só bloqueia o render quando `filterToSelectedPacks=true` (Insights Global não espera mais um mapa anúncio→pack que não usa). **Fora de escopo (follow-ups):** índice O(1) para `getPackId` (hoje O(rows×packs×packAds), mas o churn é limitado pelo structural-sharing do TanStack); remover o filtro client-side de pack (redundante com `p_pack_ids` do servidor — `analytics.py` filtra e "se vazio/None não retorna dados"); migrar o bloco inline do Manager para `buildAdMetricsData`. Manager intocado de propósito (é a referência provada).

## Bloco "Comparação do dia" no topo do /plano (2026-06-28)

**O quê:** novo bloco visual acima do `PlanHero` (sem deletar nada) que mostra "o que mudou hoje" comparando o **último dia do date-range vs. o dia anterior**, em 3 widgets: (1) métrica de custo protagonista (CPMQL/CPR com caret) + linha de 7 dias com os 2 últimos dias destacados em cores diferentes; (2) 4 cards (CPM, Link CTR, Connect Rate, Page Conversion; 5º "Taxa MQL" quando CPMQL) com valor de hoje, ontem + delta %, e line sparkline, tudo colorido pelo impacto no custo; (3) top-10 anúncios por impacto total em R$ (piora de métrica + mudança de share de verba, ponderado por gasto), abrindo o `AdDetailsDialog`.

**Decisão central — reuso, não reescrita:** todo o motor já existia (`decomposePack` = LMDI-I; `attributeDriverToAds` = shift-share) e o `usePackDiagnostic` já busca a série uma vez. O bloco é derivação pura (`usePackDayComparison`, sem novo fetch) + apresentação. **Única lógica matemática nova = `attributeAllDriversToAds`**: `attributeDriverToAds` é por-driver e colapsa a cauda no `remainder` (perde detalhe por ad), então não dá pra somar por ad. A nova função roda o mesmo shift-share simétrico para cada driver `ok` e acumula por ad sem cutoff, guardando as partes rate vs mix. Fecha exato (`Σ_a total = Σ_k C_k = Δtarget − residual`, testado). `buildPackDaySeries` acrescenta CPM por dia (o `trendLines` compartilhado não carrega CPM) sem tocar no chart existente.

**Coloração — fonte única:** delta, sparkline, borda e fundo dos cards de driver vêm do **SINAL da `contributionCurrency`** (negativa = baixou o custo = verde/success; positiva = subiu = vermelho/destructive), não do delta cru da métrica. Isso garante que "CTR subiu" (bom) e "CPM subiu" (ruim) recebam a cor certa automaticamente, e que os 4 sinais visuais concordem. A métrica protagonista usa `getMetricTrendTone(deltaPct, inverse=true)` para ter gradação (warning em alta pequena).

**Seletor CPMQL/CPR persiste a escolha** (pedido do usuário): nova preferência `diagnostic_cost_metric` em `user_preferences` (migration 086, coluna `text DEFAULT 'cpr'`, padrão do `mql_leadscore_min`, frontend grava direto no Supabase). `usePackDiagnostic` ganhou `targetOverride` + `canUseCpmql` e resolve o `target` a partir dela (fallback CPMQL→CPR quando não há MQL nos 2 dias) — o que mantém hero, painel colapsável e o bloco novo todos na mesma métrica. ⚠ **Ordering de deploy:** o campo entra na string do `.select()` de preferências → a query erra enquanto a coluna não existe → o loader cai no fallback e as prefs aparecem como default (dados do servidor preservados) até a migration rodar. Aplicar a migration **antes** de subir o código.

**Reuso de UI:** `StandardCard` + `getMetricCardSurfaceClass(tone)`, `definitions.ts` (labels/format/polaridade), `AdPlayArea`/`AdStatusIcon`, `AppDialog`+`AdDetailsDialog`, e o padrão visx do `DiagnosticTrendChart` (novos `DayComparisonLineChart` + `MetricLineSparkline`). Linhas de ad são `div role=button` + `onPlayClick` (nunca `<button>`, por causa do `<button>` interno do `AdPlayArea` — hidratação).

## Fix "sucesso fantasma" ao ativar conjunto/anúncio pausado por um pai (2026-07-02)

**Bug reportado:** usuário ativa um conjunto pausado, o Hookify mostra "Ativado com sucesso", mas no Gerenciador do Meta continua pausado; ao atualizar o Hookify (que relê o oficial do Meta) o status volta para pausado.

**Causa raiz:** o toggle/botão de status (`StatusCell`/`AdStatusControl` → `useAdStatusControl`) **exibe o `effective_status`** — o estado de ENTREGA, que herda pausas dos pais (`ADSET_PAUSED`, `CAMPAIGN_PAUSED`) — mas o write ia para o **`status` PRÓPRIO** da entidade (`POST /{id}` com `{status: ACTIVE}`). Quando o conjunto aparecia "pausado" por um motivo que não era a pausa dele mesmo, ativar não mudava a entrega. O Meta devolvia HTTP 200, e `_update_entity_status` tratava **qualquer 200 como sucesso**; o hook disparava toast de sucesso + `setStatusOverride` otimista sem verificar nada. No próximo refresh, a leitura real do Meta trazia o estado ainda pausado → "reverteu".

**Dois casos que reproduzem** (o caso simples — conjunto pausado no próprio nível, campanha ativa — sempre funcionou, por isso passava em teste básico):
- **Campanha pausada:** os ads do conjunto reportam `CAMPAIGN_PAUSED`; a linha agregada do conjunto (RPC: "ACTIVE se algum ad ACTIVE, senão `min(effective_status)`", `schema.sql` ~1515) vira pausado. Ativar POSTa no CONJUNTO, não na campanha → no-op de entrega. **Entidade errada.**
- **Conjunto ativo, ads pausados individualmente:** ads = `PAUSED`; a linha agrega para pausado; ativar o conjunto (já ativo) = no-op no Meta.
- Mesma classe também no toggle de AD individual quando o ad mostra `ADSET_PAUSED`/`CAMPAIGN_PAUSED`.

**Decisões do fix (escolhidas pelo usuário):** (1) **bloquear + explicar** quando a pausa é herdada de um pai — não fingir sucesso; (2) **verificar contra o Meta** antes de reportar sucesso.

**Implementação:**
- `GraphAPI._activate_or_pause(entity_id, status, entity_type)` (`graph_api.py`) centraliza o fluxo; os wrappers `update_ad/adset/campaign_status` delegam a ele. Ao ATIVAR: lê `get_entity_status` (novo — `GET ?fields=status,effective_status`) **antes** de escrever; se o `effective_status` é uma pausa herdada (`_PARENT_PAUSE_BLOCKERS`: ad←{adset,campaign}, adset←{campaign}) → devolve `blocked` **sem escrever**; se já está `ACTIVE` → `noop_active`. Sempre **relê o effective_status depois** (verify) e o inclui no retorno.
- Rota (`facebook.py`): helper `_finalize_status_update` mapeia `blocked` → **409 `PARENT_PAUSED`** ("ative a campanha/o conjunto primeiro"), `noop_active` → **409 `ALREADY_ACTIVE`**, e só atualiza o cache local (`_update_local_effective_status`) num sucesso real. Devolve o `effective_status` verificado no payload.
- Frontend: `UpdateEntityStatusResponse` ganhou `effective_status`; `useAdStatusControl.onSuccess` usa **o effective_status real do Meta** (não o status pedido) no `setStatusOverride`/patch de cache — mata o sucesso fantasma; `onError` mostra `PARENT_PAUSED`/`ALREADY_ACTIVE` como `toast.warning` (orientação, não erro), e `pause/resume` engolem a rejeição do `mutateAsync` (bloqueio virou fluxo normal).

**Regra geral:** quando a UI mostra `effective_status` (que agrega/herda), a escrita **e a confirmação de sucesso** têm que ser validadas contra o Meta — não assumidas de um HTTP 200.

**Batch coberto (2026-07-03):** o bulk `batch_update_ad_status` ganhou o mesmo bloqueio, amortizado. Ao ATIVAR: 1 **Meta Batch GET** (`batch_get_effective_status`, `fields=effective_status`, chunk de 50) lê o effective_status **fresco** de todos os ads → particiona os herdados-pausados (`ADSET_PAUSED`/`CAMPAIGN_PAUSED`) para `blocked` (não escreve) → escreve só o resto via `_batch_write_status` (loop extraído do método antigo). Custo ~2 chamadas Meta por 50 ads (não GET por-item). Confirmação **no nível do AD** (não do pai): 1 read por ad cobre pausa herdada de qualquer nível e evita o gap "ad que parece OK localmente mas cujo pai pausou depois do último refresh"; ads que o Meta não conseguiu ler ficam ausentes → **fail-open** (escreve). A resposta ganhou o bucket `blocked` (ad_id→motivo) em `BatchStatusResult`/`BatchStatusResponseSchema`; o toast do `useBulkAdStatusControl` ficou honesto ("X ativados, Y bloqueados (pai pausado)"). Testes: `backend/tests/test_status_update_flow.py` (12 casos, individual + batch).

## Filtro global de packs (Topbar): busca + atalhos bulk + 0 packs válido (2026-07-02)

**O quê:** o seletor de packs do Topbar ficava difícil de operar com muitos packs (ativar/desativar individuais um a um). Adicionado em `PackFilter.tsx` (modo multi-select): **busca por nome** (aparece com >5 packs, reusa o padrão do `ActionTypeFilter` — Input + filtro client-side; Enter alterna o único resultado, Esc fecha) e um header com **"Selecionar todos" / "Limpar"** + contador `selecionados/total`. Os atalhos bulk são props opcionais (`onSelectAll`/`onDeselectAll`) que só o Topbar passa, então `AdGrid` e `FiltersDropdown` (outros callers do `PackFilter`) ficam intocados — mas também ganham a busca de graça quando passam de 5 packs.

**Decisão que muda um invariante anterior — 0 packs é estado válido e persistente:** o usuário confirmou que selecionar 0 packs "só mostra o empty state, tá tudo bem". O app antes garantia ≥1 pack em 3 lugares; removidos 2:
- `TopbarFilters.handlePackFilterClose` — não reverte mais para a última seleção quando o pending fica vazio; commita `packPreferences` com todos `false`.
- `filters.ts syncPacksOnLoad` — removido o fallback "Guarantee at least one pack enabled" (`enabledCount === 0 → newPrefs[allPackIds[0]] = true`). **Esse era o bloqueador de verdade:** o efeito roda em quase todo mount de página (via `useFilters`), então sem removê-lo qualquer seleção 0 voltava para 1 pack na navegação seguinte. Remover só o guard do commit não bastava.

**Por que é seguro (verificado antes de mexer):** todo hook de query de analytics já gateia em `selectedPackIds.size > 0` — `useAdPerformancePipeline` (`fetchEnabled`), `usePackDiagnostic`, `useExplorerData` (`hasSelectedPacks`), `useMultiplePackAds` (`packIds.length > 0`). Com 0 packs nenhuma query dispara → as páginas renderizam o empty state, sem request quebrado nem custo.

**Ainda com guard ≥1 de propósito:** `store.togglePack` (`if (isEnabled && enabledCount <= 1) return`) — usado por `FiltersDropdown`/`AdGrid`, não pelo Topbar. Então o Topbar chega a 0 e esses dois não; sem deadlock (adicionar pack nunca é bloqueado). Consistência total exigiria relaxar esse guard também (follow-up).

**Regra para código futuro:** não reintroduzir guards ≥1 pack; manter o gate de queries em `selectedPackIds.size > 0` — é o que torna 0-packs seguro.

## Conexão do Facebook falhava com "Network Error" — status 'degraded' sem migration + CORS ausente no 500 (2026-07-06)

**Sintoma:** um usuário (fase de teste) tentava conectar o Facebook e o frontend só mostrava um toast genérico **"Network Error"** — sem sentido. No backend, um 500 no `POST /facebook/connect/callback`.

**Causa raiz (o 500):** `app/services/facebook_scopes.py::evaluate_token_scopes` computa `status='degraded'` quando um scope crítico (`ads_read`, `ads_management`, `business_management`, `pages_show_list`) vem ausente do `GET /me/permissions` pós-OAuth. O token desse usuário não trouxe `business_management` granted. O `connect_callback` grava `status='degraded'` direto em `facebook_connections.status`, mas a check constraint (migration 003) só admitia `('active','expired','invalid')` → **23514** (`facebook_connections_status_check`) → 500. **Código na frente da migration** — mesma classe do fix do `diagnostic_cost_metric` ("migration ANTES do código"). A feature "degraded" foi escrita assumindo um valor que o schema nunca aprendeu a aceitar.

- **Por que `business_management` vem ausente (mecanismo real):** o app **pede** `business_management` (`FACEBOOK_OAUTH_SCOPES` em config.py inclui) — o que falta é o **grant**. Não é "o usuário desmarcou um checkbox" (o popup padrão do FB Login não permite desmarcar uma permissão isolada; essa foi uma especulação inicial minha, e estava errada). O gatilho é uma **autorização anterior sendo reusada**: quando o app+usuário já foi autorizado num estado sem `business_management` (scope adicionado depois do primeiro connect, ou grant anterior não incluiu), o fluxo OAuth **default** (`reauth=false`, sem `auth_type`) **não re-pergunta** pela permissão faltante — o FB redireciona direto e devolve token ainda sem ela. Só `auth_type=rerequest` força o re-prompt. O código já trata isso (`connect/url?reauth=true` → `auth_type=rerequest`, `connectors_facebook.py:86-89`); os botões "Reconectar" (Topbar/onboarding) passam `reauth:true`, mas o **connect normal** usa `reauth=false`. A intuição "algo antigo" está essencialmente correta — não é expiração, e sim **grant anterior reutilizado**. O log confirma: o `POST /facebook/connect/url` desse caso foi sem `reauth`. Consequência prática: um plain-connect de usuário já-autorizado volta `degraded` repetidamente até rodar o rerequest (ou o usuário remover o app nas configs do Facebook). Caveat: mesmo com rerequest, `business_management` pode não vir se o app não tiver Advanced Access (App Review) para ele ou a conta não tiver Business Manager — confirmar via `/me/permissions`.
- **Fix:** migration `087_allow_degraded_facebook_connection_status.sql` recria a constraint com os 4 valores (`+ 'degraded'`). Aplicada no banco remoto em 2026-07-06; `schema.sql` sincronizado (edição cirúrgica da linha da constraint, sem `pg_dump` completo por causa da drift de RPCs já conhecida).

**Causa raiz secundária (o "Network Error"):** no Starlette/FastAPI o `ServerErrorMiddleware` é **sempre** o mais externo e emite o 500 de exceções não-tratadas com o `send` cru — **por fora** do `CORSMiddleware`. A resposta sai sem `Access-Control-Allow-Origin`, o browser a rejeita por CORS, o Axios não recebe `response` (só XHR rejeitado) → frontend mostra "Network Error" e o 500 real fica invisível. Mascara **qualquer** 500 futuro, não só esse.

- **Só reordenar o CORS para ser o mais externo NÃO basta** — o `ServerErrorMiddleware` continua por fora dele. Fix em `backend/app/main.py` tem 2 partes: (1) registrar o `CORSMiddleware` **por último** (fica o mais externo entre os user middlewares) — na prática, definir o `@app.middleware("http")` `_set_request_context` **antes** do `add_middleware(CORSMiddleware)`; (2) `_set_request_context` (agora por dentro do CORS) captura `except Exception`, faz `logger.exception(...)` e devolve `JSONResponse(500)` — esse retorno flui de volta **através do CORS** e ganha os headers. `HTTPException` não passa por esse `except` (o `ExceptionMiddleware`, mais interno, já as resolve como resposta); `CancelledError` herda de `BaseException`, não é capturada.

**Regra para código futuro:** manter o `CORSMiddleware` como o último `add_middleware` e o request-context middleware capturando exceções não-tratadas — não reintroduzir a ordem antiga (CORS antes). E, ao introduzir um novo valor de status/enum que o código grava, criar a migration **antes** de deployar o código.

## Bug do "shift de mídia" entre anúncios vizinhos — herança cega do `source_ad.creative` (2026-07-06)

**Sintoma (reporte de usuário):** com nomenclatura sequencial (`adnv10`, `adnv11`, `adnv12`...), a mídia exibida em um anúncio é a de um vizinho da sequência ("a mídia do 12 tá no 11, a do 11 tá no 10, e assim sucessivamente"). Thumb E vídeo do modal, ambos errados.

**Causa raiz (confirmada com evidência da Meta API):** `AdsEnricher.merge_details` (`ads_enricher.py`) prioriza `source_ad.creative` / `source_ad.adcreatives` sobre o creative próprio do ad. Essa priorização existe por causa do erro #10 (vídeo da cópia sem permissão de acesso — ver seção "acesso a vídeo via source_ad"), e assume implicitamente que **cópia tem a mesma mídia do original**. A premissa quebra no workflow mais comum de media buyer: **duplicar ad → renomear com o número seguinte → trocar a mídia**. O `source_ad_id` da cópia continua apontando para o ad anterior, e o Hookify herda a mídia dele — em cadeia, cada ad exibe a mídia do ad do qual foi duplicado.

**Evidência (conta `act_375919623592885`):** ADNV216, ADNV217 e ADNV219 têm cada um vídeos próprios e distintos na Meta (`asset_feed_spec.videos`: `978936...`, `1012585...`, `944021...`), e todos têm `source_ad_id` → ADNV215. O Hookify gravou para os três `primary_video_id = 25981528508192658` — exatamente o vídeo do ADNV215. Escala (proxy por DB): ~175 ad_names em 4 usuários com o mesmo `primary_video_id` sob nomes distintos, frequentemente números adjacentes (212/213, 216/217/219, 80/81, 31/32...). Casos onde o source não está em nenhum pack não aparecem nessa query (impacto real ≥ proxy).

**Por que tudo downstream fica errado:** o creative herdado contamina `upsert_ads` (`creative`, `creative_video_id`, `primary_video_id`, `media_type`, `thumbnail_url`), o cache de thumbnail por ad_name no Storage (`thumbs/{user}/by-adname/{sha16}.webp`) e o playback do modal. O read-path é todo chaveado por `ad_id`/`ad_name` (sem bug posicional) — ele apenas serve fielmente o dado errado.

**Fix implementado (2026-07-06, mesmo dia):**
1. **Enricher** (`ads_enricher.py::merge_details`): creative/adcreatives do **próprio** ad têm precedência; `source_ad` só é usado quando o detail não traz **nenhum** dado próprio (ausência total — legado como last-resort). Seguro porque playback e transcrição já resolvem vídeo inacessível (#10) pelo fallback via `effective_instagram_media_id` em `get_video_source_url` (o frontend envia `ig_media_id` ao `/video-source` — a "receita definitiva de mídia" cobre o acesso; a herança do source era desnecessária para exibir). De carona: thumbs do asset_feed agora só vêm de vídeos com `video_id` (evita desalinhar `thumbs[0]`) e `primary_video_id` usa o primeiro vídeo COM id (não `videos[0]` cru). Testes novos em `tests/test_ads_enricher_merge.py`.
2. **Backfill** (`backend/scripts/backfill_source_ad_media_swap.py`, dry-run default / `--apply` / `--user-prefix` / `--skip-thumbs`): re-fetcha o creative próprio por ad_id (nunca `source_ad`), diff apenas por **chaves de identidade** (`video_id`/`igm`/`image_hash`/arrays/`media_type`/`page_id` — nunca URLs assinadas de CDN, que mudam a cada fetch e falso-positivariam tudo), UPDATE por linha com SELECT de verificação prévio. Necessário porque `_apply_existing_fixed_fields` re-hidrata o creative errado do DB a cada refresh — o fix no código sozinho não corrige nada.
3. **Re-cache de thumbs** no mesmo script: `cache_first_thumbs_for_ad_names` com `x-upsert: true` **sobrescreve** o objeto by-adname no Storage (a política normal "só cacheia ad_name sem cache prévio" nunca substituiria a thumb errada); atualiza `thumb_*` de todos os ad_ids do grupo do nome.

**Dry-run validado** (user 8363e117): 2129/2345 ads com identidade de mídia trocada. O número é maior que o proxy (~175 names) porque cópias com a **mesma** mídia também trocam de identidade (o asset da cópia tem id próprio; antes era gravado o do source) — correção igualmente correta sob a nova semântica. Os 3 ads-referência (ADNV216/217/219) recebem exatamente os vídeos próprios confirmados na Meta; 18 correções de `media_type` (15 video→image, 3 image→video), zero regressões para `unknown`.

**Regra para código futuro:** `source_ad` na Meta é rastreio de duplicação, NÃO garantia de mesma mídia. Nunca herdar creative/mídia do `source_ad` sem verificar equivalência da mídia.

## Auditoria do ciclo de vida de status — cache local grava só verdade LIDA, nunca dedução (2026-07-06)

**Contexto:** usuários reportando inconsistências de status (badge que "volta sozinho", abas se contradizendo, status errado depois de pausar/ativar campanha). Auditoria completa do ciclo obtenção → leitura → toggle → persistência achou 7 causas; todas na camada de **cache** (Supabase `ads.effective_status` + caches TanStack) — o fluxo de escrita no Meta (pre-check + verify de 2026-07-02) estava correto.

**Princípio unificador do fix:** o status do pai NÃO tem correlação direta com o dos filhos (dá para ativar uma campanha com todos os ads pausados individualmente — e é um estado legítimo). Logo **nenhuma escrita local pode ser deduzida de uma ação**; toda escrita local vem de uma **leitura real do Meta** (pre-check, verify ou batch GET), com heurística apenas como fallback não-destrutivo.

**Correções (backend — `facebook.py`/`graph_api.py`):**
1. **Cascata local substituída por sync real:** pausar/ativar adset/campanha marcava/desmarcava `X_PAUSED` em bloco nos filhos — pausar campanha sobrescrevia ads pausados individualmente e, ao reativar, eles viravam `ACTIVE` no Hookify enquanto o Meta seguia `PAUSED`. Agora `_sync_children_statuses_from_meta` relê os filhos (`batch_get_effective_status`, teto `_STATUS_SYNC_MAX_ADS=600`) e grava a verdade por status (`_write_local_statuses`, 1 UPDATE por valor distinto, chunks de 200). Fallback heurístico (`_update_local_effective_status`) virou não-destrutivo: pausa de pai só sobrescreve filhos `ACTIVE`/NULL (via `.or_("effective_status.eq.ACTIVE,effective_status.is.null")`).
2. **Success grava o VERIFICADO:** `_finalize_status_update` persiste `result.effective_status` (verify), não o status pedido — cobre `PENDING_REVIEW`/`WITH_ISSUES` e o cache defasado que o guard estreito `eq("PAUSED")` deixava para trás (era a causa do "ativei, badge atualizou e depois reverteu na refetch").
3. **Self-heal nos 409:** `PARENT_PAUSED`/`ALREADY_ACTIVE` significam que o pre-check acabou de ler a verdade e o cache local estava DEFASADO. Agora `_self_heal_local_status` persiste esse estado (ad: valor lido; adset/campanha: sync dos filhos) — antes o badge ficava "pausado" para sempre com o toast dizendo "já está ativo".
4. **Bulk ganhou verify pós-write:** `batch_update_ad_status` relê os escritos (+1 batch GET/50 ads); ao ATIVAR, quem seguiu `X_PAUSED` no verify (caso fail-open do pre-check) é **reclassificado como `blocked`** em vez de "sucesso fantasma". Resposta ganhou `statuses` (ad_id→verificado) em `BatchStatusResult`; a rota grava esses valores no cache local (fallback conservador só para ads sem leitura).
5. **`status_resolved` no rankings principal** (e children de adset/variações): ad com `effective_status` NULL mostrava toggle "ativo"; agora renderiza "—".

**Correções (frontend):**
6. **Patch de cache escopado por nível** (`isAdLevelRankingsKey` em `useAdStatusControl.ts`): linhas agregadas (adset/campanha/ad_name) carregam `ad_id = rep_ad_id`, então o patch por ad_id em TODOS os caches `["analytics","rankings"]` contaminava a linha do grupo (pausar 1 ad fazia a campanha dele aparecer pausada em outra aba). Agora só caches ad-level são patchados in-place; os de grupo são invalidados com `refetchType: "none"` (stale, refetch ao montar — sem storm de RPC). Self-heal no `onError` dos 409 (patcha com `e.details.effective_status`); bulk patcha com os `statuses` verificados; `statusOverride` reseta quando `currentStatus` fresco chega.
7. **Rules of Hooks no `StatusCell`:** `useMemo` do label estava DEPOIS de dois early-returns condicionais; quando `status_resolved` flipava `false→true` numa refetch, o React lançava "Rendered more hooks than during the previous render" (crash intermitente da célula). Hook movido para antes dos returns.

**Banco (migration `088_fix_manager_group_status_derivation.sql` — criada, aplicar com psql + regenerar schema):** a derivação de status de linha adset/campanha no wrapper `fetch_manager_rankings_core_v2` respondia `ACTIVE` sempre que nenhum filho tinha o marcador exato — conjuntos de campanha PAUSADA apareciam `ACTIVE` na aba "por conjunto" (filhos têm `CAMPAIGN_PAUSED`, não `ADSET_PAUSED`), contradizendo a aba "por campanha". Agora a linha de adset também herda `CAMPAIGN_PAUSED` (`ADSET_PAUSED` > `CAMPAIGN_PAUSED` > `ACTIVE`).

**Limitação conhecida (aceita):** pai pausado cujos filhos estão TODOS pausados individualmente não deixa marcador `X_PAUSED` (o Meta reporta `PAUSED` próprio) → a linha do pai aparece `ACTIVE` até um refresh/toggle trazer marcadores. Sem tabelas de campanha/adset não há onde guardar o status PRÓPRIO do pai — é o custo da arquitetura "status de pai inferido dos filhos".

**Regra para código futuro:** status local (DB ou cache TanStack) é REFLEXO de leitura do Meta. Nunca escrever status deduzido de uma ação do usuário; se a informação não veio de um GET (pre-check/verify/batch), não escreva — deixe o valor antigo e marque stale.

**Testes:** `backend/tests/test_status_update_flow.py` (16 casos — inclui reclassificação fail-open pelo verify no bulk).

**Desfecho (2026-07-07) — por que a permissão não aparecia nem com rerequest:** o App Review de **07/05/2026** aprovou/renovou `public_profile`, `email`, `ads_read`, `ads_management`, `pages_show_list`, `pages_read_engagement` (Advanced Access) + Marketing API Access Tier — mas **`business_management` nunca foi solicitada no review**, então ficou só com **Standard Access**. Com o app em **Live**, permissão em Standard Access só funciona para usuários **com papel no app** (admin/developer/tester) ou vinculados ao Business do app; para qualquer outro usuário o Facebook **omite a permissão do diálogo de consent por completo** (nem no "Editar configurações" aparece — não é escolha do usuário). Confirmado nos dados: 3 de 4 conexões têm o scope (Victor/Lucas/Igor — papéis/grants de dev); só o testador sem papel (João) ficou sem. Standard Access não é inútil: é o modo dev/equipe — serve para construir e testar a integração antes do review; só não vale para público.

**Decisão (avaliada a pedido do usuário): `business_management` PERMANECE em `CRITICAL_SCOPES`.** Motivos: (1) o código não chama Business API direto, mas jobs async de insights em contas de BM falham sem o scope (caso real pack El.29); (2) nessa falha a Meta devolve `Job Failed 0%` **sem `error`** → indetectável na hora da falha (o `isMetaScopeError` do refresh não pega) → o `degraded` no connect é o **único alarme existente**; (3) o mercado-alvo (agência/infoproduto) vive dentro de BM.

**Ações:** curto prazo — adicionar o testador como **Tester** no App Dashboard + "Reconectar" (rerequest) → a permissão passa a aparecer para ele. **Bloqueador de lançamento** — submeter `business_management` ao App Review para Advanced Access (submissão incremental: verificação de negócio já feita para o review anterior); sem isso, nenhum cliente sem papel no app consegue conceder o scope e toda conta de BM cai no Job Failed silencioso.

## Status de pais como dado de primeira classe + sync on-focus (2026-07-07)

**Contexto:** continuação da auditoria de 2026-07-06. O usuário validou 3 direções: (a) o status do pai não é inferível dos filhos ("presença de X_PAUSED num filho ⇒ pai pausado" vale, o inverso NÃO — pai pausado com filhos todos own-paused não deixa marcador); (b) buscar status "de todos os filhos de um pai" via **edge filtrado** (`filtering=[{campaign.id|adset.id IN [id]}]`, 1 chamada/1000) em vez de Batch API (cada sub-request de 50 conta no rate limit); (c) sync on-focus como camada de frescor para mudanças feitas FORA do Hookify.

**Implementado:**
1. **Colunas `ads.adset_status`/`ads.campaign_status`** (migration 089): effective_status OFICIAL do pai, lido dos edges `/act_{id}/campaigns|adsets` no enrich, do verify no toggle de pai e do sync on-focus. O wrapper RPC prefere a coluna e cai nos marcadores (088) quando NULL.
2. **Invariante de escrita: status de pai grava-se POR parent_id, NUNCA por linha de ad** (`supabase_repo.write_parent_statuses`, com interseção contra pais presentes + `updated_at` fresco). A 1ª versão gravava via upsert por linha → linhas do MESMO pai divergiam entre packs (upsert só toca os ads do pack refrescado) e o `LIMIT 1` sem `ORDER BY` do wrapper devolvia linha arbitrária (status oscilando entre requests); também clobberizava valor bom com NULL quando o pai não vinha no edge (deletado/arquivado). A escrita por parent_id + só-truthy mata as três classes; `ORDER BY updated_at DESC NULLS LAST` no wrapper ficou como defesa em profundidade.
3. **Toggle de campanha sincroniza TAMBÉM os adsets dela** (`_sync_campaign_adset_statuses`: edge `/adsets` filtrado por campaign.id; fallback = anular a coluna para reativar os marcadores quando os filhos foram sincronizados). Sem isso, pausar a campanha deixava `adset_status='ACTIVE'` stale e a aba "por conjunto" contradizia a "por campanha" — regressão exata do que a 088 corrigiu (achado HIGH do review multi-agente).
4. **Sync de filhos via edge filtrado** (`GraphAPI.get_ad_statuses_by_parent`, paginado, com `deadline`); batch de 50 virou fallback (com teto 600 detectado em 1 SELECT, não paginando o inventário) e heurística não-destrutiva como último recurso. Orçamento agregado de ~25s (`_CHILD_SYNC_TIME_BUDGET_S`) para nunca estourar o timeout de 120s do axios.
5. **Bulk**: a verdade do pre-check dos ads BLOQUEADOS agora entra em `verified_statuses` → rota persiste e o frontend patcha os badges deles (self-heal, espelhando o 409 individual). Fail-open TOTAL (statuses vazio) deixou de contar como "verdade gravada" → heurística roda.
6. **Endpoint `POST /facebook/packs/status-sync`** (on-focus, TTL 5 min in-memory por (user,pack)): relê ads (by-filter do pack; conta inteira p/ pack sem filtro, cacheado por conta no request) + pais (1 leitura E 1 escrita por conta por request). Cap de 20 syncs REAIS por request com rotação: excedentes voltam `skipped` sem reservar TTL (sem starvation determinística de >20 packs). Frontend `useStatusFocusSync` (Manager): mount+focus/visibility, TTL client espelho liberado em falha (o server libera o slot para retry — o client não pode bloquear o retry), invalidação só quando `synced>0`.

**Review multi-agente (ultracode) do diff:** 5 dimensões × verificação adversarial de 2 lentes; 15 findings brutos → 11 confirmados aplicados (o HIGH era o item 3 acima) + 2 incertos. Incerto documentado como hardening futuro: o TTL do status-sync é por processo e produção roda `uvicorn --workers 4` → teto real é até 4 syncs/pack/5min (operação idempotente, custo duplicado, sem corrupção); se incomodar, mover o TTL para a tabela packs.

**Regra para código futuro:** (1) status de pai NUNCA se escreve por linha de ad — sempre `write_parent_statuses`/`_write_parent_status_column` (por parent_id, só valores truthy, com updated_at); (2) "todos os filhos de um pai/conta" lê-se por edge filtrado, não por Batch API; listas arbitrárias de ids → batch; (3) toggle de campanha tem que reconciliar TRÊS coisas: coluna da campanha, effective_status dos ads E coluna dos adsets.

**Pendências de deploy:** aplicar migrations 088 e 089 (psql) ANTES do deploy; regenerar `schema.sql` + `schema_map.md` após aplicar. Testes: 160 passando (`test_status_update_flow.py` cobre partição blocked/writable, verify pós-write, reclassificação fail-open e o edge filtrado com paginação).

## Métrica 75% View + todas as métricas como colunas do /manager (2026-07-07)

**Pedido:** (1) refresh de packs passa a trazer `video_p75_watched_actions`; (2) 50% e 75% View viram colunas ativáveis no /manager; (3) auditoria de métricas já buscadas mas indisponíveis na tabela — expor todas.

**Auditoria:** já buscávamos e guardávamos por linha, mas o /manager NÃO expunha como coluna: clicks, reach, frequency, lpv, plays, thruplays, hold_rate, scroll_stop e video_watched_p50. `scroll_stop` nem saía por linha na RPC (só nas averages). Única exceção deliberada: `profile_ctr` (derivada frágil `ctr - website_ctr`, não exposta em lugar nenhum — deixada de fora).

**Implementado:**
1. **Fetch p75** (`graph_api.py` + `meta_job_client.py` — as DUAS listas de fields — + `dataformatter.py` + `FormattedAdModel` + `upsert_ad_metrics`). Semântica idêntica ao p50: inteiro 0-100 = % de plays que atingiram 75%.
2. **Migration `090_video_watched_p75_and_manager_row_metrics.sql`** (criada, APLICAR com psql + regenerar schema.sql/schema_map.md):
   - coluna `ad_metrics.video_watched_p75` (NULL em linhas históricas até o próximo refresh cobrir a data);
   - `fetch_manager_rankings_core_v2_base_v090`: cadeia v067→v066→v060 ACHATADA numa única base (fold do thumb_storage_path no CTE rep_ads e do filtro p_campaign_id pós-agregação com semântica idêntica), + `video_watched_p75` e `scroll_stop` por linha e nas averages; entry recriada apontando p/ v090 (mantém resolução de status de pais da 089). v059/v060/v066/v067 ficam órfãs (cleanup futuro);
   - `fetch_manager_rankings_series_v2`: séries novas `video_watched_p75`, `plays`, `thruplays`, `reach` (frequency deriva no cliente de impressions/reach).
3. **Children (Python agg)** `/rankings/ad-name/{x}/children` e `/rankings/adset-id/{x}/children`: + p75, scroll_stop, reach, frequency por filho; details endpoints ganharam p75; `_build_rankings_series` e `_empty_series_for_axis` com as chaves novas (paridade de shape). Campaign-children usa a RPC (herda automático).
4. **Frontend:** 10 novas colunas opcionais (todas default OFF — ninguém tem a tabela alterada sem opt-in): Clicks, Reach, Frequency, Scroll Stop, Hold Rate, 50% View, 75% View, Plays, ThruPlays, LPV. Registry (`definitions.ts`/`calculations.ts`) ganhou `video_watched_p75` e `thruplays`; `MANAGER_COLUMNS` é a fonte única de ordem; blocos padrão via helper `pushStandardMetricColumn`; headers de contagem (clicks/reach/lpv/plays/thruplays) mostram SOMA do pack (como impressions), os demais média ponderada; CSV e zod atualizados.

**Gotcha descoberto (registrado em memória `manager_metric_column_pipeline`):** o FilterBar divide o input do usuário por 100 para colunas `isPercentage` — correto para métricas 0-1 (`ratioPercent`: ctr, hook...), errado para `rawPercent` (p50/p75 vivem em 0-100). Novo helper `isManagerRatioPercentMetric` restringe o flag; rawPercent filtra numérico direto.

**Verificação:** tsc --noEmit limpo, `next build` OK, 31+29+13 testes frontend e 113 backend passando. Pendência de deploy: aplicar migration 090 ANTES de subir o backend/frontend (a coluna nova entra nos SELECTs dos children — sem ela o PostgREST devolve erro de coluna inexistente).

## Pesquisa: gerenciamento de orçamento via Graph API (2026-07-08)

**Contexto:** pesquisa preparatória (feature ainda não implementada) para editar budget de campanhas/adsets pelo Hookify. Regras verificadas na documentação oficial v24.0:

- **Unidade:** `daily_budget`/`lifetime_budget` são int64 em **subunidade da moeda da conta** (offset 100 p/ BRL/USD; moedas sem centavos como JPY usam offset 1). ⚠️ `ad_accounts` não guarda `currency` hoje — pré-requisito buscar via `GET /act_{id}?fields=currency` e persistir.
- **Exclusividade:** daily XOR lifetime; `lifetime_budget` exige `end_time`.
- **CBO vs ABO:** budget na campanha só quando CBO; no adset só quando ABO. Trocar CBO↔ABO via update exige `adset_budgets` com budget de TODOS os adsets filhos — não é PATCH simples. CBO com >70 adsets: não dá pra desligar.
- **Ad Set Budget Sharing (2025+):** `is_adset_budget_sharing_enabled` — ABO com até 20% de budget móvel entre adsets.
- **Budget scheduling:** `budget_schedule_specs` / edge `/budget_schedules` — até 50 períodos de alta demanda, ≥3h, só daily budget, teto 8× o daily, ABSOLUTE|MULTIPLIER.
- **Mínimos:** dependem de bid_strategy + billing_event e país (~2× em US/UK/CA). Não hard-codar: hint via `GET /act_{id}/minimum_budgets` + erro da Meta como verdade final.
- **Infra pronta:** `GraphAPI.update_campaign`/`update_adset` já aceitam payload arbitrário; `ads_management` já está no OAuth. Molde de write = pipeline de status (pre-check → write → verify → persistir a verdade lida).

Memória correspondente: `meta_budget_api_rules.md`.

## Removida a opção "Por Pack" do Insights/Oportunidades (2026-06-24)

**Decisão:** removido o toggle "Global ↔ Por Pack" da aba Oportunidades do `/insights` (e junto: `packActionTypes`, `opportunityRowsByPack`, o seletor de evento de conversão por-pack, os dois localStorage keys `hookify-insights-group-by-packs`/`hookify-insights-pack-action-types`). A tela só mostra o agregado Global agora.

**Por quê (não era só bug — era estrutural):** o `// KNOWN ISSUE` registrado na consolidação do pipeline (ver acima) apontava dois problemas do modo "Por Pack": (1) comparava cada pack contra a **média global** mesmo quando o pack tinha um `actionType` diferente selecionado — comparação inválida (maçã com laranja); (2) a RPC `fetch_manager_rankings_core_v2` é **single-key por request** — um único `action_type` por chamada — então dar suporte de verdade a "evento diferente por pack" exigiria N requests (um por pack × actionType), não é um fix local. Decisão: **remover** em vez de investir no N-fetch, porque (a) feature nichada — só afeta quem usa eventos diferentes por pack, (b) mantém o pipeline compartilhado (`useAdPerformancePipeline`) simples e single-fetch, sem abrir uma exceção estrutural pra um caso de uso raro.

**Efeito colateral positivo:** como o Insights não precisa mais de `getPackId`/`packsAdsMap` (só usados pela quebra por-pack), `useAdPerformancePipeline` agora pula o fetch de `usePacksAds` inteiramente quando `filterToSelectedPacks=false` — `usePacksAds(filterToSelectedPacks ? selectedPacks : [])`. Zero requests de pack-ads a mais no Insights (antes já não bloqueava o render, ver fix anterior; agora nem dispara).

**Se o pedido voltar:** não reimplementar comparando contra média global — ou fazer N fetches (um por pack, cada um com seu `action_type`) e médias calculadas por pack, ou manter Global-only. Relacionado: [[rankings_rpc_single_key_prefixed_conversions]].

## Menu "Exibição" no /manager + colorir métricas pela média (2026-07-08)

**O que:** consolidação dos controles da tabela do `/manager` num dropdown "Exibição" (visualização Detalhada/Minimal, toggles Médias⇄Tendências e "Comparar com a média", e exportar CSV). Ficaram FORA do menu: seletor de Colunas (mais usado) e Fullscreen (ação espacial com feedback imediato). Novo toggle "Comparar com a média" (`colorMetricValue`) colore o NÚMERO de cada métrica pela distância da média usando a mesma escala de 5 tons dos sparklines (reusa `getManagerMetricTrendPresentation` → `getMetricQualityToneByAverage` → `getMetricValueTextClass`; `spend` fica sem cor porque `packAverage` é null p/ soma). Persistido em localStorage, default OFF.

**Bug de re-render (registrado em memória `manager_table_memo_signal_prop_for_cell_rerender`):** ao ativar o toggle de cor, a tabela não atualizava na hora — só aparecia ao mexer no toggle Médias/Tendências. Causa: `TableContent`/`MinimalTableContent` são `React.memo` com comparator manual, e a instância `table` do TanStack é estável. A flag entrava nas deps do `columns` useMemo (colunas recomputadas com novos closures), mas como `colorMetricValue` não estava em `tableContentProps` nem nos comparators, o memo retornava `true` e o `flexRender` nunca re-rodava com os closures novos. Fix: threadar `colorMetricValue` como sinal em `SharedTableContentProps` + `tableContentProps` + os dois comparators (não precisa ser usado dentro do componente). É o mesmo mecanismo pelo qual `showTrends` já funcionava.

**Onde mora o estado do Médias/Tendências:** o toggle foi movido do header da página (`page.tsx`) para dentro do menu (dentro de `ManagerTable`). Como o state `showTrends` vive no `page.tsx`, `ManagerTable` ganhou a prop `onShowTrendsChange` para hospedar o controle.

**Verificação:** tsc --noEmit limpo nos arquivos alterados (erro remanescente em `validateAdCriteria.ts` é de refactor paralelo não relacionado).

## Índice O(1) para pertencimento a pack (packMembership.ts) (2026-06-24)

**Contexto:** `getPackId` (dentro de `useAdPerformancePipeline.ts`), usado por Plano/GOLD para filtrar `serverData` pelos anúncios dos packs selecionados, era uma varredura `O(rows × packs × packAds)` — anúncio por anúncio contra todos os anúncios de todos os packs. Engasgo perceptível em conta grande. Risco de qualquer otimização aqui: incluir/excluir anúncio errado **silenciosamente** (dado errado sem erro).

**Simplificação que destravou o fix com segurança:** após a remoção do "Por Pack" do Insights (ver acima), `getPackId` passou a ser consumido só como booleano (`!== null`) — nenhum consumidor usa mais o valor (qual pack). Isso reduz o problema a "pertence à união dos packAds selecionados?", eliminando a necessidade de preservar "qual pack" / ordem "primeiro pack vence".

**Prova de equivalência:** `membership(ad) = ∃Q∈união(packAds) : guard(ad,Q) ∧ (idMatch∨nameMatch)`. Como `∃` distribui sobre `∨`: `∃Q(guard∧id) ∨ ∃Q(guard∧name)` — exatamente um `Map` por id e um por nome, cada chave guardando os `account_id` de todo packAd que casou naquela chave (`guardPasses` reproduz o guard por-Q agrupando tokens de conta). Caso load-bearing: um único packAd que casa por id **e** nome mas com conta conflitante — a varredura original rejeita esse packAd inteiro (`.some()` roda o guard uma vez, "vê" a mesma conta pros dois testes); o índice acerta porque a conta conflitante entra nos **dois** mapas (id e nome), então nenhum dos dois caminhos passa sozinho.

**Rede de segurança:** `packMembership.test.ts` — bateria unitária dos casos de guard (7 casos "não regredir", incluindo sentinela de conta ausente vs `"   "`) + **teste diferencial exaustivo**: mantém a varredura original verbatim como referência (`referenceMatches`) e testa `índice(ad) === referência(ad)` sobre o produto cartesiano de domínios pequenos e adversariais (falsy, espaços, number-vs-string) — 20.736 combinações, 0 divergências, roda em 16ms.

**Fix:** `lib/utils/packMembership.ts` (`buildPackMembershipIndex` + `isAdInSelectedPacks`), consumido em `useAdPerformancePipeline.ts`. `getPackId` removido do retorno do hook (zero consumidores externos, confirmado por grep + tsc limpo).

**Padrão a reusar:** quando uma otimização de performance troca uma varredura por um índice, e o comportamento correto é sutil (guards condicionais, múltiplos campos de match), a rede de segurança certa é um **teste diferencial** — manter a implementação antiga como função de referência no arquivo de teste e provar equivalência sobre uma matriz de inputs adversariais, em vez de só confiar em uma prova matemática no papel.

## #3 revisitado: duplicação Manager × buildAdMetricsData já não existia; CPM fallback era dead code (2026-06-24)

**Contexto:** um follow-up de sessão anterior apontava que `app/manager/page.tsx` tinha um bloco inline (~30 linhas) duplicando `buildAdMetricsData` (validateAdCriteria.ts), com risco de drift de fórmula entre Manager e Plano/GOLD/Insights. Ao investigar para implementar o fix, essa premissa **já não era verdade**: o Manager foi refatorado (commit `fcabff3`, antes desta sessão) para usar `mapRankingRow.ts` — um mapper com propósito diferente (linha de exibição da tabela, não avaliação de critério de validação). `app/manager/page.tsx` não tem mais nenhuma referência a `AdMetricsData`/`evaluateValidationCriteria`.

**Comparação fórmula-a-fórmula revelou só 2 pontos de sobreposição real:** `page_conv = lpv>0 ? results/lpv : 0` e `overall_conversion = website_ctr*connect_rate*page_conv` — idênticos nos dois arquivos. Uma 3ª diferença (`cpm`) parecia um risco: `buildAdMetricsData` tinha um fallback **calculado** (`impressions>0 ? spend*1000/impressions : 0`) quando `ad.cpm` não era finito; `mapRankingRow` sempre zerava (`Number.isFinite(row.cpm) ? row.cpm : 0`, comentário: "unifica a regra... → 0").

**Prova de que o fallback de CPM nunca executa (verificado em `schema.sql`):** a RPC (`fetch_manager_rankings_core_v2` e toda a cadeia de wrappers, ex. linha ~3575) computa `cpm` no SQL como `case when impressions>0 then spend*1000.0/impressions else 0 end` — **sempre um número finito**, nunca NaN/Infinity/ausente. Isso vale inclusive para as linhas-zero sintéticas do Insights (`ad_inventory.py::synthesize_zero_raw_rows`), que atuam na camada de *sync* (grava `ad_metrics`), não na RPC de leitura — a fórmula acima roda igual em cima do que quer que esteja na tabela. Logo: **nenhum dos dois fallbacks de CPM jamais dispara** — ambos são código morto, escritos de forma independente em momentos diferentes pelo mesmo autor, sem nunca colidir na prática.

**Fix aplicado:** extraído `frontend/lib/utils/conversionMetrics.ts::computeConversionMetrics(website_ctr, connect_rate, results, lpv)` — usado por `buildAdMetricsData` E `mapRankingRow`. O fallback calculado de CPM foi **removido** de `buildAdMetricsData` (agora `Number.isFinite(ad.cpm) ? ad.cpm : 0`, igual ao Manager) — não recalcula mais nada, só um zero defensivo documentado (comentário explica a garantia da RPC). Teste `validateAdCriteria.test.ts` atualizado para refletir o novo contrato (cpm ausente/NaN/Infinity → 0, não mais "calcula fallback"). Novo `conversionMetrics.test.ts` cobre o helper isoladamente. 75/75 testes passam.

**Lição:** antes de "resolver" um achado de review/memória antigo, reconferir se a premissa ainda é verdadeira no código atual — o código muda entre sessões (aqui, por trabalho do próprio usuário) e um "fix" para um problema que já não existe pode introduzir regressão real (mudar o CPM exibido no Manager) em troca de um ganho que não existia.

## Sparkline interativo: hover destaca o dia e sincroniza o valor em todas as colunas da linha (2026-07-08)

**Ideia (do usuário):** no modo Tendências do /manager, ao passar o mouse numa barra do sparkline (qualquer métrica), aplicar opacidade baixa nas outras barras daquela célula e **trocar o número exibido** pelo valor daquele dia (no lugar do tooltip). E ir além: ao fazer isso no CPMQL do dia 2, por exemplo, **todas as outras colunas da mesma linha** também trocam para o dia 2.

**O que torna a parte #2 (sincronização entre colunas) barata:** cada `MetricCell` já tem `original.series` — a série diária de TODAS as métricas daquela linha — e o eixo de datas. Ou seja, cada célula calcula sozinha o valor do dia `i` para a sua própria métrica. A única coisa a compartilhar entre colunas é **um número: o índice do dia em hover**. Premissa que sustenta o alinhamento: todos os sparklines da linha usam a mesma janela de 5 dias e o mesmo eixo → índice `i` = mesmo dia do calendário em todas as colunas.

**Decisão de arquitetura — store de subscription por rowKey, não Context/prop:** criado `frontend/lib/hooks/useRowBarHover.ts` (`setHoveredBar`/`clearHoveredBar` publicam `{rowKey, index}`; `useRowHoveredDay(rowKey)` via `useSyncExternalStore`). Cada célula assina APENAS a própria rowKey → só as ~10-14 células daquela linha re-renderizam no hover. Alternativas rejeitadas:
- **Context por linha:** não existe wrapper React por linha — `flexRender` joga as células direto no `<tr>`, não há onde pendurar um provider.
- **Context global:** re-renderizaria toda célula visível a cada movimento do mouse.
- **Prop + comparator (padrão da memória `manager_table_memo_signal_prop_for_cell_rerender`):** aquele padrão vale para toggles **globais de baixa frequência** (colorMetricValue, showTrends). Para estado **por-linha de alta frequência** (hover), o store dribla o `React.memo` agressivo das células — o re-render é disparado internamente pelo hook, não por uma prop atravessando o comparador.

**Detalhes de UX:** a legenda de data aparece só na coluna sob o cursor (estado local `isHoverSource`), enquanto o valor troca em todas — evita repetir a mesma data em cada coluna. O número do dia é colorido igual à barra em hover (dia × média do pack), respeitando o toggle "Comparar com a média". O `title` nativo do sparkline é removido quando o modo interativo está ativo (substitui o tooltip). Fora do modo Tendências não há barras → feature inerte.

**Refatoração de apoio:** formatação de valor/data extraída em helpers exportados do `SparklineBars` (`getSparklineBarValueDisplay`, `formatSparklineDate`) — fonte única para o texto da barra e para o número trocado no `MetricCell`, evitando drift.

**Verificação:** `tsc --noEmit` limpo. Verificação visual ao vivo (hover na tabela autenticada com série temporal real) fica pendente — depende de sessão logada + dados.

## Sparkline interativo, refinamento: tooltip flutuante (não Radix) + vocabulário coerente de zero/indefinido (2026-07-08)

**Contexto:** dois ajustes de UX pedidos pelo usuário depois de ver a feature de hover do sparkline (ver seção anterior). (1) No modo compacto (minimal) da tabela, a legenda de data — posicionada `absolute` logo acima do número trocado — encostava no sparkline por falta de espaço vertical. (2) Ao hover num dia com "0"/"—" na célula agregada, o número trocado mostrava labels verbais ("Sem leads", "Sem MQLs", "Sem dados") — vocabulário diferente do que a mesma célula usa fora do hover, sentido como incoerente.

**Fix #1 — tooltip flutuante sem Radix:** em vez de mover a legenda para uma Radix `Tooltip` (que envolveria as 5 barras × N colunas × N linhas em `TooltipProvider/Tooltip`, reintroduzindo o custo de ~1250 componentes que o modo `lightweight` do `SparklineBars` foi criado para eliminar), implementado um tooltip flutuante manual: estado local `activeBar` (índice + `getBoundingClientRect()` capturado no `onMouseEnter` da barra) e um único `<div>` `position: fixed`, estilizado com as mesmas classes visuais do `TooltipContent` do shadcn (`rounded-md border bg-popover shadow-md` + `animate-in fade-in-0 zoom-in-95`). Por ser `fixed`, escapa do `overflow-auto` do container de scroll da tabela sem risco de clipping — mesmo padrão já usado pela linha-guia de resize de coluna em `TableContent.tsx`. Como `activeBar` é local à instância (distinto do `hoveredIndex`, que é a prop sincronizada entre colunas via `useRowBarHover`), o tooltip só aparece na coluna onde o mouse está de fato — as outras colunas da linha só recebem o fade + número trocado, sem tooltip duplicado.

**Fix #2 — vocabulário do zero:** criado `getSparklineBarNumericDisplay` (novo helper em `SparklineBars.tsx`), dedicado ao hover interativo: "—" quando não há dado do dia OU a métrica é indefinida naquele dia (ex: CPR num dia com spend mas 0 resultados — divisão por zero é null na série, nunca literal 0), valor formatado quando finito, **inclusive zero legítimo** (ex: page_conv = 0% num dia com LPV>0 mas 0 conversões — aqui o valor da série É literalmente 0, não null). Essa distinção replica exatamente a convenção que `formatMetricCellValue` já usa na célula agregada (`value == null || !Number.isFinite(value) → "—"`, senão formata). **Escopo deliberadamente restrito**: a função pré-existente `getSparklineBarValueDisplay` (com os labels verbais "Sem X") não foi tocada — ela segue sendo usada pela Radix `Tooltip` "modo full" (AdDetailsDialog, aba Series) e pelo `title` nativo do modo lightweight não-interativo, onde esse vocabulário é intencional e pré-existente (não foi introduzido por esta feature, e ninguém pediu para mudar lá). Só o hover novo do ManagerTable ganhou o vocabulário numérico coerente.

**Por que não unificar tudo num único vocabulário globalmente:** mudar `getSparklineBarValueDisplay` alteraria o comportamento de telas que já funcionavam de um jeito conhecido (AdDetailsDialog, Series tab) sem que o usuário tivesse pedido isso — blast radius maior que o necessário para resolver a incoerência apontada (que era específica ao número trocado do hover, comparado à MESMA célula fora do hover).

**Verificação:** `tsc --noEmit` limpo após cada mudança.

## Checkbox de seleção em lote "atrasava" ao marcar — `rowSelection` fora do comparator do `React.memo` (2026-07-09)

**Sintoma reportado:** na aba individual do `/manager`, clicar no checkbox de uma linha subia na hora a contagem "N selecionados", mas o próprio checkbox só marcava depois de um delay — como um lag. Hipótese inicial do usuário: re-render da tabela inteira ao selecionar.

**Diagnóstico — era o inverso.** Não era a tabela re-renderizando; era a tabela **deixando de** re-renderizar. A contagem mora no toolbar (fora do corpo da tabela) e é derivada de `rowSelection` (`selectedAdIds = Object.keys(rowSelection)`), então atualiza no primeiro render do `ManagerTable`. Mas o checkbox lê `row.getIsSelected()` dentro de `TableContent`, que é `React.memo` com comparator manual (`areTableContentPropsEqual`) que **não comparava `rowSelection`**. Como a instância `table` do TanStack é estável (`prev.table === next.table` sempre) e nenhuma outra prop comparada mudava, o comparator devolvia `true` → `TableContent` pulava o render → a célula do checkbox não era reavaliada. O checkbox só "acordava" quando um render **não relacionado** (refetch em background trocando `dataRef`, hover do sparkline, sync de status on-focus com TTL) finalmente passava por uma prop comparada — daí o delay.

**Fix:** threadar `rowSelection` como prop explícita de `TableContent`/`MinimalTableContent` (não dá para ler `table.getState().rowSelection` no comparator, justamente porque `table` é mutável e estável) e comparar por referência (`prev.rowSelection !== next.rowSelection`) nos DOIS comparators — `setRowSelection` gera objeto novo a cada toggle, então referência basta. Os 3 pontos: (1) `rowSelection: RowSelectionState` em `SharedTableContentProps`; (2) incluir no objeto `tableContentProps` + deps do useMemo; (3) a checagem nos comparators de `TableContent.tsx` e `MinimalTableContent.tsx`. Custo baixo: `MetricCell` já é `React.memo`, então na re-renderização os cells de métrica dão bail-out e efetivamente só o checkbox re-renderiza.

**Lição:** este é o mesmo padrão da memória `manager_table_memo_signal_prop_for_cell_rerender` (toggles `colorMetricValue`/`showTrends`), mas num sabor mais amplo — não é toggle de closure de coluna, é **estado da tabela que uma célula LÊ**. Regra generalizada: qualquer estado do TanStack que uma célula consome (`getIsSelected`, `getIsExpanded`, etc.) precisa ser threadado como prop e entrar no comparator, senão o memo engole o update.

**Verificação:** `tsc --noEmit` limpo.

## Seleção em intervalo por shift+click nos checkboxes do /manager (2026-07-09)

**Pedido:** clicar um checkbox de linha, segurar shift e clicar outro bem abaixo → marcar/desmarcar todas as linhas do intervalo. Padrão Gmail/Finder.

**Implementação** (`managerTableColumns.tsx`, coluna `id: "select"` da aba individual, + `selectionAnchorRef` criado em `ManagerTable` e threadado pelo factory): clique normal ancora em `row.id`; shift+click computa o intervalo entre a âncora e a linha clicada e aplica a todas o mesmo estado (`value = !row.getIsSelected()`) via `table.setRowSelection`.

**Gotchas não-óbvios:**
- **Radix `Checkbox` — suprimir o toggle nativo:** o `CheckboxPrimitive.Root` compõe o `onClick` do usuário com o handler interno via `composeEventHandlers`, que só roda o interno se `event.defaultPrevented === false`. Então `e.preventDefault()` no nosso `onClick` **cancela o toggle nativo + `onCheckedChange`** — necessário no shift+click para a própria linha clicada não ser re-alternada por cima da lógica de intervalo. (Vale para qualquer interação custom sobre o shadcn Checkbox.)
- **Ordem visível, não índice de dados:** o intervalo usa `table.getRowModel().rows` (conjunto COMPLETO pós-filtro/sort) para achar as posições — não `row.index` (que é índice no data original) nem os DOM rows virtualizados. Assim o range funciona mesmo com a âncora rolada para fora da viewport.
- **`rowSelection` guarda só `true`:** desmarcar = `delete next[id]`, não `= false`.
- **Âncora fixa** após shift+click (não se move) — permite reajustar o endpoint a partir da mesma origem, como no Explorer/Finder. `onMouseDown` com `preventDefault` quando shift evita o highlight de texto da página.

**Dependência:** só reflete na hora por causa do fix anterior (`rowSelection` no comparator do memo) — sem ele, o range atualizaria o estado mas os checkboxes só apareceriam num render posterior. Os dois se encaixam.

**Verificação:** `tsc --noEmit` limpo.

## Padronização da toolbar do /manager + pegadinha do twMerge com tokens custom (2026-07-09)

**Pedidos:** (1) a caixa de ações em lote ("N selecionados · Pausar · Ativar") tinha altura diferente do botão "Add filter" ao lado — padronizar; (2) `hover:bg-destructive` no Pausar e `hover:bg-success` no Ativar; (3) faltava respiro entre a barra de filtros e a tabela (scrollbar colado no "Add filter").

**(2) Hovers:** adicionados `hover:bg-destructive hover:text-destructive-foreground` (Pausar) e `hover:bg-success hover:text-success-foreground` (Ativar). O `hover:text-*-foreground` acompanha o `bg` senão o texto fica ilegível sobre o fundo saturado. `className` entra depois do `variant="ghost"` no `cn()`, então vence o `hover:bg-accent` do ghost.

**(3) Respiro:** a raiz era `TableWorkspace compact={viewMode==="detailed"}`, que aplica `gap-0` no modo detailed. Fix: `contentClassName={viewMode==="detailed" ? "pt-stack-compact" : undefined}` (0.75rem) — só no detailed; o minimal já tem `gap-stack`.

**(1) Altura + pegadinha do twMerge:** primeira tentativa foi fixar a caixa em `h-8` (32px) para casar com o `className="h-8"` do "Add filter". Ficou MENOR que o botão. **Causa:** o `cn()` é `twMerge` puro (sem `extendTailwindMerge`), então não reconhece o token custom `h-control-default` (base do `SelectTrigger` shadcn) como conflitante com `h-8` → os dois sobrevivem, e `h-control-default` (2.5rem=40px, gerado depois na cascata pois extends são anexados após a escala core) **vence**. Ou seja, o `h-8` do "Add filter" é MORTO — o botão renderiza 40px, não 32. Solução: usar o mesmo token na caixa (`h-control-default`). **Lição geral:** para sobrescrever altura/spacing de um componente cujo base usa token custom (`h-control-default`, `p-widget-*`, `gap-stack-*`), sobrescreva com o mesmo tipo de token OU com valor arbitrário (`h-[32px]`) — um utilitário core NÃO neutraliza um token custom via twMerge. Registrado em `twmerge_ignores_custom_theme_tokens`.

**Verificação:** `tsc --noEmit` limpo.

## Refatoração do design system: contrato de controles + cn() consciente de tokens (2026-07-09)

**Contexto:** inconsistência recorrente de padronização (barras, botões, selects com regras próprias). Diagnóstico: o design system existia em 3 camadas que não se falavam — tokens (`tailwind.config.ts`), wrappers shadcn (`components/ui/`) e doc de padrão visual — e nenhuma cobria o nível "controle/toolbar". Agravante: o `cn()` era `twMerge` puro, então override core (`h-8`) sobre token custom (`h-control-default`) era silenciosamente morto — 58 usos de `h-8` cru no codebase, muitos mortos há meses.

**Decisão de arquitetura:** sizing de controle é *component token* — vive DENTRO do wrapper (variant CVA), nunca no call site. A regra passa a ser binária e lintável: "altura via prop `size`, nunca `h-*` em className". Mover a decisão de 58 call sites para meia dúzia de variants.

**O que mudou:**
1. **`lib/utils/cn.ts`**: `extendTailwindMerge` registrando os 16 tokens de spacing (`control-*`, `row-*`, `widget-*`, `stack-*`, `grid-*`, `workspace`) + classGroups de `shadow-elevation-*` e `z-{dropdown,sticky,overlay,modal,toast}`. Consequência: overrides core AGORA FUNCIONAM (antes eram mortos). Todo token novo em `theme.extend.spacing` deve ser registrado também em `SPACING_TOKENS`.
2. **Size variants**: `Input` e `SelectTrigger` ganharam CVA `size` (`default`=h-control-default 40px | `sm`=h-control-compact 32px, py-1), como o `Button` já tinha. `FilterSelectButton` deixou de fixar `h-control-default` (herda da variant do Button). `SearchInputWithClear` repassa `size` (e faz `Omit<"size">` do attr HTML — igual ao `Input`).
3. **Sweep de ~25 arquivos**: overrides mortos deletados. Critério: **preservar o visual renderizado hoje** (deletar classe morta = zero mudança), EXCETO contextos densos aprovados pelo usuário para compacto 32px: inputs da review table do /upload, selects do ValidationCriteriaBuilder, tier select do /admin, input do SlotUploadZone, buscas das children tables do /manager.
4. **Mudanças visuais automáticas do fix** (h-auto que estava morto e passou a valer — todas intenção original): chips de filtro do FilterBar colapsam para altura de texto; botões da bulk bar do /manager ficam compactos; links do /login com altura natural; células do calendário viram aspect-square (min-h preservado).
5. **Contrato escrito**: seção "Contrato de controles (sizing)" no `authenticated-app-visual-standard.md` (vocabulário, regra binária, cláusula de documento vivo).
6. **Enforcement**: regra `control-height-override` no `check-design-system.ts` — flagra `h-N`/`h-[..]` em className de Button/Input/SelectTrigger/FilterSelectButton/SearchInputWithClear (inline e multi-linha); permite `h-auto`, `h-full` e prefixos de variant (`sm:h-11`); allowlist para `(auth)/` e waitlist. Testada com arquivo-canário.
7. **CLAUDE.md**: bloco "Design system (OBRIGATÓRIO ao criar/editar UI)" apontando o contrato — fecha o gap do "ponto de partida sem instrução".

**Verificação:** `tsc --noEmit` limpo; `check:design-system` verde; /login medido no navegador (input 40px, `h-[42px]` efetivo, link h-auto 20px). Telas autenticadas pendentes de conferência visual do usuário.

**Lição:** regra de design que exige julgamento ("use o token certo") não escala; regra binária ("nunca altura no call site") + variant + lint escala. E lint novo só conta depois de provar que dispara (canário).

---

## Security review pró-produção (go-live) + avaliar CVE por fixed-version-de-linha (2026-07-09)

**Contexto:** security review completa pré-lançamento (frontend Next.js + backend FastAPI + Supabase). Deu origem ao doc de controle vivo `documentation/security-review-go-live-2026-07-09.md` (10 achados + pontos fortes, rastreados por status). Correção item a item começou pelo #1.

**#1 — Erro de diagnóstico corrigido (a lição principal):** classifiquei Next 15.5.9 como 🔴 Crítico exposto ao React2Shell (CVE-2025-55182 / CVE-2025-66478) com base num resumo que dizia "afeta Next.js 15.0.0 → 16.0.6". **Errado.** O advisory oficial (nextjs.org/blog/CVE-2025-66478) lista o fix **por linha de release**: 15.5.x → **15.5.7** (03/12/2025). 15.5.9 é de 11/12/2025 (confirmado por `npm view next time --json`) → **já protegido**. A "faixa afetada" descreve o código vulnerável antes dos backports, não as versões sem patch; patches de segurança são cumulativos (qualquer patch ≥ fixed-version da linha está seguro).

**Risco real que restou:** 15.5.9 estava 11 releases atrás. O **May 2026 Security Release** patchou **13 CVEs** em 15.5.18 — middleware bypass (relevante: `middleware.ts` faz gate de auth/tier), XSS, SSRF, cache poisoning, DoS; + CVE-2026-45109 (fix incompleto em 15.5.16 quando o bundler é Turbopack, completo em 15.5.18). Estar à frente do patch antigo ≠ estar atualizado.

**Ação:** `npm install next@15.5.20` (última da linha 15.5.x; mantém React 18, sem breaking change). Build de produção passou limpo. `npm audit` expôs `ws`(high)/`uuid` no toolchain de build → registrados no backlog de deps (#7 do doc de review), não misturados no #1.

**Lição (memória `cve_exposure_check_per_line_fixed_version`):** ao julgar exposição a CVE de dependência, ler a **fixed-version por linha** no advisory oficial do vendor + ordenar releases por timestamp do registry (`npm view <pkg> time --json`); nunca decidir pela faixa afetada genérica de um resumo. E sempre checar se a linha teve **releases de segurança posteriores** ao CVE em questão.

## Consolidação do design system: tokens únicos + enforcement automático (2026-07-09)

**Contexto:** continuação da refatoração do contrato de controles. Auditoria geral em 4 frentes (enforcement, tokens, camada ui/, duplicação) revelou que a base de cor era exemplar, mas coexistiam sistemas paralelos de tipografia, sombra e z-index — e o checker era decorativo (só manual) e furado (cego a `cn()`).

**Enforcement (a causa-raiz):**
- O regex de `control-height-override` exigia aspas logo após `className=` — `className={cn("h-8")}` (o padrão do projeto) escapava. Consertado; provado com canário.
- Famílias de cor faltantes na regra (`green`, `sky`, `teal`, `indigo`...) adicionadas; range de emoji estendido a dingbats (`✅`/`⚠️`).
- **Pre-commit hook (husky)**: `check:design-system` + `tsc --noEmit` rodam em todo commit (`frontend/.husky/pre-commit`; `prepare` em frontend/package.json aponta o hooksPath). Linter sem gate era o gap mais grave.
- Allowlists de arquivo inteiro para exceções de 1 linha (skeletons) convertidas em `// design-system-exception` inline — allowlist agora é só para diretórios/superfícies.

**Tokens únicos (fim dos sistemas paralelos):**
- **Tipografia:** criado `text-2xs` (10px/14px) — único degrau abaixo de `text-xs`. Migrados 110 usos de `text-[10px]`/`text-[11px]`→`2xs` e `text-[12px]`/`[13px]`→`xs` (36 arquivos). Decisão do usuário: NÃO criar token para 11px — enxuto > fiel ao pixel.
- **Z-index:** o sistema paralelo `z-[9999]`/`z-[10000]`/`z-[10020]` (tooltip/popover/combobox) foi colapsado nos tokens; criado `z-tooltip` (90). Regra nova: camada de app via token; stacking local (dentro de card/tabela) pode usar `z-10/20` core. Exceção documentada: modal-sobre-modal do date-range-picker (`z-[70]/[80]`).
- **Sombras:** overrides crus `shadow-xs/sm/md/lg` REMOVIDOS do tailwind.config; 46 usos migrados (`xs/sm`→`elevation-raised`, `md/lg`→`elevation-overlay`). Button perdeu o eixo CVA `shadow` (8 valores, 1 uso real) — variants outline/secondary/destructiveOutline embutem `elevation-raised`.
- **Tokens mortos:** `workspace` e `row-default` removidos. `row-compact`/`row-detailed` adotados como fonte de verdade documentada de `MANAGER_ROW_HEIGHT` (tableContentTypes.ts) — a altura real das linhas é emergente (measureElement), então a adoção é por ancoragem de constante, não classe.
- 3 regras novas no checker travam tudo: `arbitrary-font-size` (só px), `arbitrary-z-index` (≥60), `raw-shadow`.

**Camada ui/ e órfãos:**
- Deletados: `ui/toggle.tsx` (só no catálogo), `common/Modal.tsx` (substituído por AppDialog; ui-demo migrado), `ui/app-checkbox.tsx` (TranscriptionStatusDialog migrado p/ `label`+`Checkbox`). Button: variants `neutral` (0 usos) e `primary` (1 uso, redundante c/ default) removidas.
- `TabsTrigger` tokenizado (`h-control-compact`); 3 filtros (`ActionTypeFilter`/`PackFilter`/`ManagerColumnFilter`) trocaram `className="h-9"` por `size="sm"`; `Combobox` ganhou prop `size` e parou de re-declarar altura; `date-range-picker` perdeu `sm:h-11` ad-hoc.
- Catálogo `/design-system` agora demonstra Combobox, DropdownMenu e DateRangePicker (justamente os compostos que estavam invisíveis).

**Cores cruas saneadas:** `text-green-500`→`text-success` (/planos), aviso amber→tokens `warning` (MetricHistoryChart), `text-white`→`text-foreground` em ExplorerAdSidebarCard/GenericCard (quebrava no tema claro).

**Backlog (fase 4, não executada):** dedup TableContent≈MinimalTableContent (~700 linhas), MultiSelectFilter genérico (6 reimplementações), checkbox inline 6×, SearchInputWithClear 4×, MetaUsageFilterBar com controls nativos, StatCard/MetricCard/GenericCard, FilterChip 3× no FilterBar, CampaignChildrenRow≈ExpandedChildrenRow.

**Verificação:** tsc limpo, checker verde, build de produção ok. Telas autenticadas não verificadas visualmente (deltas esperados: sombras de popover maiores, sombra de hover de cards, botões do date-picker 40px no desktop).

## Toast "erro desconhecido" ao pausar anúncios um a um: `showError(string)` mascarava a causa (2026-07-09)

**Sintoma:** usuário pausava vários anúncios no /manager clicando um por um (em vez de selecionar + "pausar em massa") e recebia toast genérico "erro desconhecido".

**Causa raiz (2 camadas):**
1. **Mascaramento da mensagem.** `showError()` (frontend/lib/utils/toast.tsx) aceitava `AppError | Error | unknown`. Quando recebia uma **string crua**, o guard `typeof error === "object"` falhava e caía em `parseError(error)` — que só entende erros do Axios (checa `.response`/`.request`). String ia para o ramo genérico → `{ message: "Erro desconhecido" }`, **jogando fora a mensagem real**. O `onError` de `useAdStatusControl` fazia `showError(msg)` com `msg` string, então QUALQUER falha (rate limit, 502, rede) virava "erro desconhecido". Afetava também `app/docs`, `app/admin`, `onboarding/ValidationStep`.
2. **Por que só no um-a-um.** O endpoint individual `POST /facebook/ads/{id}/status` faz **write + verify = 2 chamadas Meta por anúncio** (sem retry, sem tratamento de rate limit — só código 190 vira auth_error; o resto vira 502). Disparar muitos em sequência estoura o limite de requisições do Meta (#17/#613/#80xxx). Já "selecionar vários + pausar em massa" usa `POST /facebook/ads/batch-status` → Meta Batch API (**1 requisição por 50 ads**), que não estoura. A mensagem real do Meta vinha em `e.message`, mas era mascarada pela camada 1.

**Correção:**
- `showError` agora trata `typeof error === "string"` como a própria mensagem antes de tentar `parseError`. Conserta todos os callsites de string de uma vez.
- `useAdStatusControl` (individual + lote) detecta rate limit **pelo texto** da mensagem (`isMetaRateLimitMessage`, cobre #4/#17/#32/#613/#80xxx e frases em inglês) — não pelo código aninhado frágil — e mostra orientação de ação ("aguarde alguns segundos, ou selecione vários e use pausar/ativar em massa") em vez do "(#17) User request limit reached" cru.

**Lição:** `parseError` é específico de Axios; passar string solta para `showError` mascara silenciosamente. Preferir passar objeto/`Error` a `showError`; toast genérico esconde a causa e cega o diagnóstico. Ver também a decisão de CORS-em-500 (erro opaco) e categoria de erro dirigindo a UI.

## Orçamento de campanhas/conjuntos — Fases 0 e 1 (read-only) (2026-07-09)

**Escopo:** exibir o orçamento (daily/lifetime + modo CBO/ABO + moeda da conta) nas abas por-conjunto e por-campanha do /manager. Edição (Fase 2) virá depois de testado. Base de pesquisa na entrada anterior (regras da Graph API) e memória `meta_budget_api_rules.md`.

**Decisão central: tabela dedicada `parent_budgets` (user_id, entity_id PK), NÃO colunas denormalizadas em `ads`.** O padrão do status (088/089) agrupa o UPDATE por valor — funciona porque status tem ~3 valores distintos. Budget é alta-cardinalidade (cada campanha/adset tem o seu), então o mesmo padrão viraria 1 UPDATE por entidade a cada sync (inclusive o on-focus de 5 min). Tabela keyed = 1 upsert por sync, e elimina por construção a classe de bugs de divergência entre linhas do mesmo pai que o status teve.

**Semântica de NULL (diferente do status!):** entidade PRESENTE no edge sem budget grava `daily/lifetime = NULL` explicitamente — é verdade lida (campanha ABO e adset de campanha CBO não têm budget próprio), não ausência de sync. Entidade AUSENTE do edge (deletada/arquivada) não é tocada. `budget_mode` NULL é o que distingue "ainda não sincronizado".

**Implementado:**
1. **Migration `091_budget_read_path.sql`** (criada e validada com BEGIN/ROLLBACK no banco remoto — APLICAR com psql antes do deploy + regenerar schema.sql/schema_map.md): `ad_accounts.currency`; tabela `parent_budgets` (level campaign|adset, daily/lifetime bigint em subunidade, budget_mode cbo|abo|abo_shared, RLS por user_id); entry `fetch_manager_rankings_core_v2` recriada (base v090 intocada) anexando `budget_daily`/`budget_lifetime` (entidade da linha), `budget_mode` (sempre da campanha) e `budget_currency` via laterais — join ad_accounts normalizando o prefixo `act_` (ads.account_id vem SEM, ad_accounts.id COM).
2. **Fase 0 — moeda:** `get_adaccounts` pede `currency`; `upsert_ad_accounts` persiste (fallback remove colunas ainda inexistentes para não perder o sync inteiro).
3. **Sync de pais unificado:** `_fetch_edge_statuses` generalizado em `_fetch_edge_entities`/`fetch_parent_entities` (um único passe paginado nos edges traz status + budget: campanhas pedem `daily_budget,lifetime_budget,is_adset_budget_sharing_enabled`, adsets + `campaign_id`); projeções `project_parent_statuses`/`project_parent_budgets` alimentam os dois writes. `budget_mode` derivado: tem budget → cbo; senão sharing flag → abo_shared; senão abo. Escrita em `supabase_repo.upsert_parent_budgets` (present-check compartilhado via `_fetch_present_parent_ids`, upsert em chunks de 500 com `with_postgrest_retry`). Chamado no refresh de pack (job_processor) e no sync on-focus (`/facebook/packs/status-sync`) — mudança de budget feita no Ads Manager aparece em até 5 min. Sempre best-effort (tabela pode não existir pré-091).
4. **Frontend:** `RankingsItem` + `budget_daily/lifetime/mode/currency`; `BudgetCell.tsx` (read-only, offset da Meta: 12 moedas sem subunidade em `META_OFFSET_ONE`; linha sem budget próprio mostra "na campanha"/"nos conjuntos" pelo modo; title nativo, sem Radix); coluna "Orçamento" em `managerTableColumns.tsx` após o nome, só nas abas por-conjunto/por-campanha, sort por daily??lifetime com nulls por último.

**Verificação:** 171 testes backend passando; `tsc --noEmit` limpo; `next build` OK; `check:design-system` passa (1 falso-positivo pré-existente em comentário de códigos de erro do useAdStatusControl recebeu exception inline).

**Fase 2 (write) deve:** espelhar o pipeline do status (pre-check de modo CBO/ABO → POST → verify read-back → persistir a verdade lida em `parent_budgets`), nunca o valor otimista.

## Adendo: parent_entities + roadmap aprovado (2026-07-09)

**Decisões do usuário sobre a entrada anterior:**
1. **Tabela renomeada `parent_budgets` → `parent_entities`** (antes de aplicar a 091, custo zero) — ela é o lar futuro de TODO estado de pai, não só budget. Ganhou coluna `effective_status` como **double-write passivo**: escrita apenas pelos syncs de conta inteira (enrich do refresh + on-focus), NUNCA pelos writes pontuais do toggle/self-heal. O read-path do status CONTINUA em `ads.adset_status/campaign_status` (088/089) até a migração deliberada — a coluna só acumula backfill e confiança. Não ler status de parent_entities antes disso.
2. **Moeda da conta como verdade única de exibição** (aprovado, implementação no passo (e)): hoje o app formata valores — que vêm da Meta NA MOEDA DA CONTA — com o símbolo da preferência do usuário, sem nenhuma conversão (bug latente quando divergem). Norma futura: exibir na `ad_accounts.currency` do contexto; preferência vira fallback e depois some da UI; **nunca converter** — agregado multi-moeda sinaliza "moedas mistas".

**Sequência aprovada (não pular etapas):** (a) ✔ read-path budget + double-write passivo → (b) usuário testa Fases 0-1 → (c) Fase 2: edição de budget (pre-check modo → write → verify → persistir verdade em parent_entities) → (d) migrar read-path do status para parent_entities (refactor isolado: toggle/self-heal/reconciliação passam a escrever na tabela, wrapper lê dela com fallback 088, atualizar test_status_update_flow.py; só então deprecar as colunas de ads) → (e) sweep da moeda da conta.

**Estado:** migration 091 **APLICADA no banco remoto** (validada antes com BEGIN/ROLLBACK); `schema.sql` + `schema_map.md` regenerados (parent_entities 10 colunas, ad_accounts com currency); smoke test da RPC com usuário real OK (linha por-campanha traz budget_daily/lifetime/mode/currency NULL até o primeiro sync do backend novo, effective_status segue resolvendo); 171 testes backend passando. Backend/frontend prontos para deploy — código antigo em produção convive com o schema novo (não escreve na tabela; RPC devolve chaves extras que o frontend antigo ignora).

## Design system fase 4: deduplicação de componentes (2026-07-09)

**Executado item a item, com tsc + checker + build por item.** Saldo em `components/`: **−1.212 linhas líquidas** (+802/−2014, inclui fases 1–3).

1. **TableContent unificado** — `MinimalTableContent.tsx` deletado; `TableContent` ganhou prop `variant: "detailed" | "minimal"` com mapa `VARIANT_STYLES` (única diferença real era estilo + estimateSize/overscan). Call sites usam `<TableContent key={viewMode} variant={viewMode}>` — o `key` preserva o comportamento antigo de remount na troca (reset de scroll/virtualizador). Bônus: o modo minimal agora exibe estado de erro (antes só o detailed tratava `isError`).
2. **`FilterListPopover`** (common/) — popover genérico de seleção em lista: multi/single, busca, bulk bar (Selecionar todos · Limpar N/M), grupos com header, item disabled-mas-desmarcável, slots `trigger`/`triggerWrap` (tooltip)/`header` (switch). GemsColumnFilter, ManagerColumnFilter, PackFilter e ActionTypeFilter viraram wrappers de configuração com APIs públicas intactas. Nota: ColumnFilter (numérico operador+valor) e FiltersDropdown (agregador) NÃO entraram — não são multi-selects, a auditoria os agrupou errado.
3. **`CheckSquare`** (common/) — quadradinho de seleção presentacional (não-interativo; o clique é do container — evita interativo aninhado, por isso não usa ui/checkbox). Consumido por FilterListPopover, FilterBar (status), AutoRefreshConfirmModal (normalizado de 20px/border-2/bg-brand — brand é alias de --primary) e AdsetSelector.
4. **SearchInputWithClear** adotado em AdsetSelector, AdTree e SortableColumn (AdGrid já usava; os dois últimos ganharam botão de limpar de graça).
5. **MetaUsageFilterBar** migrada de `<select>`/`<input>` nativos para Select/Input/Button do DS, `size="sm"`. Radix Select não aceita `value=""` → sentinela `__all__` mapeada internamente.
6. **ManagerChildrenTable ganhou `entity: "ads" | "variations" | "adsets"`** (ENTITY_CONFIG: labels, busca, coluna de nome, StatusCell tab, textColumns, rowKey). A duplicação real era `CampaignChildrenRow` reimplementando a tabela inteira (~200 linhas) — a auditoria dizia que era gêmeo do ExpandedChildrenRow, impreciso. CampaignChildrenRow agora é wrapper fino (query + entity="adsets"). Corrige de graça: "Nenhuma anúncio encontrada" (concordância), StatePanel nos estados, thead sticky.
7. **`FilterChip` (manager/)** — peças presentacionais do chip de filtro (shell Badge+IconFilter, select de operador borderless, input inline, ação aplicar/remover) extraídas das 3 cópias do FilterBar. A lógica de valor (validação BR de decimais etc.) ficou no FilterBar, onde difere de verdade.
8. **StatCard e MetricCard deletados** — a auditoria propunha consolidá-los com GenericCard, mas eram **órfãos** (zero consumidores). GenericCard (card de ranking com thumbnail) permanece, é outra coisa.

**Lições:**
- Achado de auditoria ≠ plano de execução: 3 dos 8 itens estavam imprecisos (ColumnFilter não era multi-select; o gêmeo real do children row era outro; StatCard/MetricCard eram órfãos). Verificar consumidores reais (`grep` de imports) antes de projetar a consolidação.
- Ao unificar componentes que eram montados/desmontados por ternária, `key={variant}` preserva a semântica de remount (reset de estado interno/scroll) — sem isso a troca de modo vira update in-place com estado herdado.

## Robustez de refresh concorrente: blip HTTP/2 não pode mais matar job (2026-07-09)

**Sintoma (reportado por usuário):** ao atualizar 3 packs simultâneos, alguns falhavam com `Erro: <ConnectionTerminated error_code:1, last_stream_id:111>` ou `Erro: Lease de processamento perdido durante atualização de progresso`. Reatualizar funcionava. Camadas 1+2 implementadas; Camada 3 em aberto.

**Diagnóstico — os dois erros têm a MESMA raiz:** os jobs rodam como FastAPI `BackgroundTasks` concorrentes e todos usam `use_service_role=True` → `get_supabase_service()` é singleton (`_service_client`) → **um único pool httpx (HTTP/2) compartilhado**. Sob multiplexação alta (`last_stream_id:111` = 111 streams numa conexão), o gateway do Supabase manda GOAWAY para reciclar a conexão; streams em voo morrem com `ConnectionTerminated` → `httpx.RemoteProtocolError`. **Não é a Meta** (Graph API usa `requests`/HTTP1.1). O mesmo blip surgia de dois jeitos:
- `<ConnectionTerminated>` cru = drop numa chamada de persistência sem retry (só ~9 de ~68 `.execute()` de `supabase_repo.py` eram wrapped).
- "Lease perdido" = drop num heartbeat. `JobTracker.heartbeat` e `renew_processing_claim` tinham `except Exception: return False`, e `JobProcessor._heartbeat_or_raise` lia esse `False` como "outro worker roubou o lease" → `JobLeaseLostError` matava o job. **Falso positivo**: `job_tracker.py` não tinha nenhum retry. "Tentar de novo funcionava" = menos concorrência/conexão nova.

**Implementado:**
1. **Camada 1 (`job_tracker.py`):** `with_postgrest_retry` em todas as chamadas de DB (get_job/get_payload/create_job/merge_payload/UPDATE do heartbeat/RPCs claim·renew·release). `renew_processing_claim` virou **tri-state** `Optional[bool]`: `True`=renovado, `False`=negado de verdade (outro owner / status saiu de processing→cancel/fail/complete), `None`=transitório (indeterminado). `heartbeat` reescrito como **best-effort**: falha transitória NUNCA retorna `False`/mata o job — só retorna `False` por motivo real (job cancelado por fora, ou `renew`=`False` genuíno). Só o `False` genuíno vira `JobLeaseLostError`.
2. **Camada 2 (`supabase_repo.py`):** `.execute()` da rota crítica de persistência/leitura do job envolvidos em `with_postgrest_retry` — `_fetch_all_paginated`, `_fetch_present_parent_ids`, `upsert_ads`, `write_parent_statuses`, `update_pack_stats`, `update_pack_ad_ids`, `get_existing_ads_map`, `calculate_pack_stats_essential`, `upsert_pack` (UPDATE/SELECT), `check_pack_name_exists`, `get_pack`, `update_pack_refresh_status`.

**Regra que ficou:** heartbeat/progresso é best-effort — só pare o job por motivo real (cancelado / lease genuinamente negado), nunca por falha de rede. "Não consegui escrever" ≠ "perdi o lease". **INSERT puro NÃO é retryable** (ex.: `upsert_pack` sem pack_id): GOAWAY após commit + retry cria linha duplicada → deixado bare de propósito (o índice único `(user_id, lower(name))` vira PackNameConflictError espúrio, mas não corrompe dado); UPDATE/upsert-by-id/SELECT são idempotentes e seguros. O caso reportado é refresh de pack existente, que nem chama `upsert_pack`.

**Verificação:** `tests/test_job_tracker_heartbeat.py` novo (8 testes travam o contrato: transitório→True, lease-loss/cancel→False, renew tri-state; patch de `supabase_retry.time.sleep` p/ rodar instantâneo). Suite backend: 132 passando (excluída `test_billing_webhooks.py` por falta do módulo `stripe` no ambiente local — não relacionado).

**Camada 3 (pendente — a conversar):** tratar a CAUSA da tempestade de GOAWAY, não só o sintoma. Opções: semáforo de concorrência de jobs pesados por instância (enfileira o N+1); `http2=False` no cliente de serviço (elimina a classe inteira de ConnectionTerminated, custo de throughput); ou limites de pool (`max_connections`/`keepalive_expiry`). **Decisão depende de quantas réplicas do backend rodam atrás do Traefik** — semáforo in-process só limita por instância; com múltiplas réplicas talvez precise de lease de concorrência no banco.

## Moeda da conta como verdade única — passo (e) adiantado (2026-07-10)

**Gatilho:** ao testar as Fases 0-1 de orçamento (passo b da sequência), o usuário notou que o seletor de moeda em Configurações > Preferências ainda permitia escolha manual, e perguntou se era intencional — não era: era o bug latente já identificado na entrada de pesquisa original (o app formata valores vindos NA MOEDA DA CONTA com o símbolo da preferência do usuário, sem nenhuma conversão).

**Fix — choke point único em vez de varredura de ~40 arquivos:** `formatCurrency`/`useFormatCurrency` (`lib/utils/currency.ts`) já aceitavam `currency?: string` como override opcional, caindo em `settings.currency` (Zustand) quando omitido — a maioria dos call-sites do app chama sem esse override. Em vez de auditar cada um, bastou fazer `settings.currency` (via `user_preferences.currency`) **auto-sincronizar silenciosamente** com a moeda real assim que detectada; todos os call-sites sem override corrigem sozinhos.

**Implementado:**
1. `FacebookAdAccountSchema.currency` (schemas.ts) + `getAdAccounts` tipado corretamente (era `any[]`).
2. `useDetectedAccountCurrency()` (novo hook): deriva de `useAdAccountsDb()` (`/facebook/adaccounts` → `ad_accounts.currency`, já populada pela pipeline de budget). Único valor se todas as contas conectadas compartilham a moeda; `isMixed=true` se divergem (nunca converter — só sinalizar); `null` se ainda não sincronizado.
3. Topbar.tsx: `useEffect` silencioso (sem toast) chama `saveCurrency(detected)` quando detectado, não-misto e diferente do valor persistido.
4. UI: o `<Select>` de Moeda virou `<Input disabled readOnly>` informativo (mostra moeda detectada, "Múltiplas moedas" ou "Detectando...").

**Verificação:** `tsc --noEmit` limpo, `check:design-system` passa, `next build` OK.

**Pendências** (registradas em memória `account_currency_as_source_of_truth.md`, não bloqueiam o teste do (b)): auditar os poucos call-sites que já passam `currency` explícito por linha (ex. `BudgetCell.tsx` — correto, usa a moeda da PRÓPRIA linha, não mexer); decidir se `user_preferences.currency`/coluna some de vez ou fica como fallback interno permanente. Isso fecha boa parte do passo (e) do roadmap, mas o passo continua marcado como "parcial" até essa auditoria.

## Atualizar vários packs ao mesmo tempo estourava banco (57014) + sockets (WinError 10035): fila serial (2026-07-09)

**Sintoma:** atualizar 4 packs simultaneamente resultava em toasts de falha:
- `Erro ao salvar métricas: {'code': '57014', ...'canceling statement due to statement timeout'}`
- `Erro ao salvar anúncios: [WinError 10035] Uma operação de soquete sem bloqueio não pôde ser concluída imediatamente`

**Causa raiz (uma só, dois sintomas): concorrência.** Cada refresh dispara fetch pesado do Meta + upserts grandes de JSONB em `ad_metrics`/`ads`. Rodando 4 de uma vez:
1. **57014 (salvar métricas):** upserts concorrentes estouram o `statement_timeout` do Postgres. Agravado porque o job roda como **service_role** (statement_timeout menor — ver decisão de assimetria de timeout).
2. **WinError 10035 (salvar anúncios):** WSAEWOULDBLOCK — saturação de sockets em dev **Windows** (cada refresh abre muitos sockets pro Meta + Supabase). Específico de Windows/local; produção (Linux/Docker) não vê esse código, mas veria outro transitório sob a mesma carga.

**Gaps do retry no backend (secundários, não corrigidos):** `with_postgrest_retry` (`core/supabase_retry.py`) só re-tenta transitórios de rede httpx + deadlock 40P01 — **não** cobre 57014 nem `httpx.WriteError`/`NetworkError` (a lista `_transient_httpx_exceptions` tem ReadError/ConnectError mas não WriteError). Por isso ambos escaparam. A fila remove o gatilho; se reaparecer sob carga, ampliar a cobertura do retry.

**Correção (decisão do usuário: "simplesmente enfileirar"):** fila serial de módulo em `usePackRefresh.ts` — `enqueueRefresh`/`pumpRefreshQueue`/`refreshWillQueue`, `REFRESH_MAX_CONCURRENCY = 1`. Singleton de módulo (como `activeRefreshes`), então vale entre TODOS os callers (Topbar, cards, página de packs). A marcação `addUpdatingPack` + dedup por pack continua **síncrona** (antes de enfileirar) → o card mostra estado na hora; só o trabalho pesado (Meta + persistência) é serializado. Toast "Na fila" (mesmo toastId) é sobrescrito pelo toast real do Meta quando o pack começa.

**Por que serializar no frontend resolve o backend:** o backend só faz fetch+persist quando o job daquele pack é poll-ado. Com 1 refresh ativo por vez, nunca há 4 persists concorrentes — a contenção de DB e de socket some na raiz. Seguro porque os upserts são idempotentes (valores absolutos). Para subir o paralelismo, fechar antes os gaps do `with_postgrest_retry` (57014 + WriteError).

**Verificação:** `tsc --noEmit` limpo; semântica da fila testada isolada (serializa estrito, task que falha não trava a fila, drena por completo).

## Logout espúrio durante refresh de packs: um único 401 transitório deslogava global (2026-07-10)

**Sintoma (reportado por usuário + reproduzido no próprio uso):** usuários sendo deslogados sem motivo no meio de uma atualização de packs.

**Diagnóstico — confirmado por log real:** o frontend tratava **qualquer 401** cujo `detail` casasse com `isAppAuthUnauthorized` (`token expired`, `missing bearer token`, `invalid or expired token`, `token validation`) como sessão morta → `AUTH_SESSION_EXPIRED_EVENT` → `AuthSessionExpiredHandler` desloga e redireciona pra `/login?expired=true`. **Um único 401 = logout global**, sem tentativa de recuperação. O log mostrou um `GET /facebook/ads-progress/... 401 Unauthorized` **isolado**, cercado de 200 OK (a request seguinte, outra conexão, voltou 200) — prova de que a sessão estava viva e o 401 era **transitório** (corrida no boundary do token). O refresh de packs faz polling de até 15 min (`maxAttempts: 450`), multiplicando a exposição: basta 1 dos muitos polls pegar o token na janela ruim.

**Três defeitos combinados (`frontend/lib/api/client.ts`):**
1. **Zero refresh proativo/reativo** — o interceptor só lia `getSession()`, nunca `refreshSession()`. Os `retry` do TanStack não salvam (re-disparam pelo mesmo interceptor; o evento de logout já disparou no 1º 401, com once-guard).
2. **Request interceptor se auto-sabotava** — quando achava a sessão expirada, **removia o header `Authorization`** e mandava sem token → backend responde `Missing Bearer token` (que TAMBÉM casa `isAppAuthUnauthorized`) → logout. A lógica "defensiva" causava o logout que tentava evitar.
3. **Cache de sessão de 30s** podia servir o token nos últimos segundos de vida e suprimir a janela de refresh.
- Backend (`app/core/auth.py`): `jwt.decode` com `verify_exp` e **zero leeway** — poucos segundos de clock skew cliente/servidor viravam `Token expired`.

**Fix aplicado:**
1. **Response interceptor** (agora `async`): no 1º 401 com auth-error, tenta **UM** `refreshAccessToken()` e **re-dispara a request original** (`this.client.request(originalConfig)`); só chama `notifyAuthSessionExpired` se o refresh falhar. `_authRetry` no config impede loop infinito; `refreshAccessToken` deduplica refreshes concorrentes via `refreshPromise` compartilhado (N polls batendo 401 juntos → 1 refresh, todos re-tentam).
2. **Request interceptor:** usa `getValidAccessToken()` — refresca proativamente quando falta < 60s (`EXPIRY_MARGIN_MS`) pra expirar e **nunca estripa** um token utilizável; só devolve null se não há sessão E o refresh falhou.
3. **Backend:** `options["leeway"] = 30` no `jwt.decode` (python-jose lê `options.get("leeway", 0)` → `_validate_exp`).

**Regra que ficou:** 401 de auth em SPA de operação longa NUNCA desloga direto — sempre `refreshSession()` + retry primeiro; logout só se o refresh token também morrer. Interceptor não estripa token perto de expirar, refresca. Refresh concorrente tem que ser deduplicado. Backend com `verify_exp` precisa de `leeway`. **Esses logouts são invisíveis no Sentry** (interceptor só manda ≥500); a impressão digital é `/login?expired=true` (vs `?logout=true` do logout manual).

**Verificação:** `tsc --noEmit` limpo; suporte a `leeway` confirmado no source do python-jose (`leeway = options.get("leeway", 0)`). Cenário de expiração mid-poll não é driveável localmente — validado por leitura de código + o log real que reproduziu o 401 transitório. Memória: `auth_single_401_refresh_retry.md`.

## Widget de diagnóstico com números diferentes entre /plano e /insights (2026-07-10)

**Sintoma (reportado por usuário, com print):** o MESMO widget de diagnóstico (hero CPR + cards CPM / Link CTR / Connect Rate / Conv. Página) exibia valores diferentes em `/plano` e `/insights` com filtros idênticos — mesmos packs (3 de 4), mesmo evento (`purchase`), mesmo período. Ex.: CPR R$30,38 vs R$21,33; "ontem" R$11,07 vs R$10,90; **Connect Rate 33,33% vs 0,00%**.

**Causa raiz:** as duas páginas renderizam o mesmo `PackDiagnosticPanel` alimentado por `usePackDiagnostic`, e fazem o mesmo fetch `useAdPerformance` (mesma request → mesmo cache → `serverData` idêntico). A divergência estava no array `ads` passado ao hook:
- `/insights`: `ads: serverData` (`useAdPerformancePipeline({ filterToSelectedPacks: false })`) — todos os ads que o servidor escopou pelos `pack_ids`.
- `/plano`: `ads: filteredRankings` (default `filterToSelectedPacks: true`) = `serverData` re-filtrado no cliente por `isAdInSelectedPacks(membershipIndex, …)` (índice do `packsAdsMap` de `usePacksAds`, via `ad_metric_pack_map`).

`usePackDiagnostic` deriva os `group_keys` do array `ads` e os manda ao endpoint `/ad-performance/series`. Conjuntos de `group_keys` diferentes → séries agregadas diferentes → o `packByDay` soma populações diferentes → CPR/Connect Rate/ontem divergem. Connect Rate 0% no /plano = `lpv=0` no dia → o filtro client-side derrubou justamente os ads com visualização de página de hoje (/plano SUB-contava).

**Por que os dois escopos divergem:** o servidor já escopa por `pack_ids` no RPC (tanto `/ad-performance` quanto `/ad-performance/series`, via `p_pack_ids`). O `filteredRankings` aplica um SEGUNDO filtro de membership client-side por cima disso. Com `group_by="ad_name"`, as linhas agregadas do servidor carregam um ad_id representativo que pode não casar o `membershipIndex` → derruba linhas que o servidor legitimamente atribuiu ao pack.

**Fix (decisão do usuário: alinhar ao /insights, que é o autoritativo — bate com o Meta Ads Manager):** `/plano` passou a alimentar `usePackDiagnostic({ ads: serverData })` (era `filteredRankings`); `serverData` foi exposto no destructuring do pipeline. As superfícies de JULGAMENTO do /plano (plano de ação, G.O.L.D.) continuam usando `validatedAds`/`notValidatedAds`/`filteredRankings` — só o diagnóstico descritivo mudou. `tsc --noEmit` limpo.

**Regra que ficou:** o diagnóstico é DESCRITIVO e deve bater com o Meta Ads Manager → alimente-o com o conjunto server-scoped (`serverData`), nunca com `filteredRankings` (filtro de membership client-side que pode divergir do escopo por `pack_ids` do servidor). Widget descritivo idêntico em 2 páginas TEM que receber o mesmo input; se o componente deriva `group_keys` do input, inputs diferentes = números diferentes. Refina o ponto #1 da doutrina "só existe uma média" (que dizia `ads: filteredRankings`). Memória: `diagnostic_widget_serverdata_not_filteredrankings.md`.

## Seleção em massa (pausar/ativar) em conjuntos, campanhas e modal de expansão (2026-07-10)

**Pedido:** replicar os checkboxes de seleção de linha (com shift-select de intervalo) + a barra "Pausar/Ativar em massa" — que só existiam na aba interna `individual` (rótulo "Por anúncio", por `ad_id`) — para as abas `por-conjunto` (adsets) e `por-campanha` (campanhas), e para o modal de expansão (`ManagerChildrenTable`: anúncios de um conjunto, conjuntos de uma campanha).

**Bloqueio técnico:** só anúncios tinham endpoint batch (`POST /facebook/ads/batch-status`, Meta Batch API, 1 req/50). Adsets/campanhas só tinham endpoints single. **Decisão do usuário: novo endpoint batch no backend** (não fan-out no frontend).

**Backend — batch generalizado por `entity_type`:** a Meta Batch API é agnóstica ao tipo de nó (write = `POST /{id}` com `status`; read = `GET /{id}?fields=effective_status`), então `GraphAPI.batch_update_ad_status` ganhou o param `entity_type` ("ad"|"adset"|"campaign"). O único ponto sensível ao tipo é o mapa `inherited_pause`: ad={ADSET_PAUSED,CAMPAIGN_PAUSED}, adset={CAMPAIGN_PAUSED}, campaign={} (campanha não tem pai → nunca `blocked`). Rotas novas `POST /facebook/adsets/batch-status` e `/campaigns/batch-status` (schema `BatchEntityStatusRequest{ids,status}` → `BatchStatusResult`), com filtro de ownership por `adset_id`/`campaign_id`. Reconciliação de cache local é **heurística em lote** (`_batch_reconcile_parent_status_local`): grava a coluna do pai (`ads.adset_status`/`campaign_status`) com o status verificado (agrupado por valor), cascateia X_PAUSED/ACTIVE nos ads filhos de forma não-destrutiva (só `ACTIVE`/null ↔ X_PAUSED) e, para campanha, anula `adset_status` dos filhos (reativa o fallback por marcadores). NÃO relê os filhos da Meta por entidade (ao contrário do toggle single, que faz N chamadas) — a verdade composta exata reconcilia no próximo refresh do pack / sync on-focus. Mesma filosofia do batch de anúncios.

**Frontend:** `useBulkAdStatusControl` → `useBulkEntityStatusControl(entityType)` (wrapper retrocompat mantido): ad = patch in-place do cache ad-level; adset/campaign = 1 invalidação ampla de `["analytics","rankings"]` (1 mutação = 1 invalidação, sem amplificação — mesma via do toggle single). No `ManagerTable` a seleção é por-aba: `getRowId` e `enableRowSelection` derivam o id da entidade da aba (adset_id/campaign_id/ad_id); o guard da coluna `select` em `managerTableColumns` foi estendido às 3 abas (a mecânica de shift/âncora já era agnóstica à aba); a barra virou `bulkActionBar` reusada nos 3 toolbars. O modal (`ManagerChildrenTable`, tabela HTML pura, sem TanStack) ganhou seleção com `Set` local + anchor ref próprios (chave = ad_id ou adset_id via `config.selectionId`), select-all e shift sobre a lista ordenada; reset ao trocar de nível no drill.

**Verificação:** `tsc --noEmit` limpo; `npm run check:design-system` passou; backend `py_compile` limpo, rotas registradas, `pytest tests/test_status_update_flow.py` (19 testes, +3 novos cobrindo `entity_type`) verde; suite inteira coleta limpa (erro único de `stripe` ausente é pré-existente do ambiente). O E2E real (pausar/ativar conjuntos/campanhas reais na conta Meta do usuário) é destrutivo e fica para validação interativa pelo usuário.

**Regra que ficou:** para pausar/ativar conjuntos/campanhas em lote, reusar a Meta Batch API via `batch_update_ad_status(entity_type=...)` — só o mapa de pausa herdada muda por nível. Reconciliação de filhos em lote é heurística local (sem re-leitura por entidade); a exatidão volta no próximo refresh. Memória: `manager_bulk_selection_adset_campaign.md`.

## Skeletons do /manager: fallback com cromo real + "skeleton dobrado" na coluna Spend (2026-07-10)

**Sintoma (reportado por usuário, com prints):** (1) ao carregar o /manager aparecia um skeleton genérico "esquisito" (grade de barras em 5 colunas, sem abas/toolbar/colunas, título "Manager"), depois trocava bruscamente para o skeleton real (abas + toolbar + colunas, título "Otimize"); (2) no skeleton da tabela, a coluna **Spend** exibia um "skeleton dobrado" (um pill extra vazando bem antes dela).

**Causa raiz:**
1. **Fallback divergente:** `ManagerPageFallback` (usado no Suspense e nos gates de auth/onboarding da página) renderizava `StateSkeleton variant="table"` — um placeholder genérico que não parece com a página. Só depois de `authStatus === "authorized"` o `ManagerTable` com `isLoading` desenhava a cromo real. Título também pulava de "Manager" → "Otimize".
2. **Skeleton dobrado:** o skeleton de linha do `TableContent` iterava `table.getVisibleLeafColumns()` e renderizava um pill `w-16` (64px) para **toda** coluna não-nome. A coluna auxiliar de filtro `active_count_filter` tem `size: 0` mas **não** é escondida via `columnVisibility` (só `adset_name_filter`/`campaign_name_filter` são) → é uma leaf visível de largura 0. O pill de 64px com `mx-auto` transbordava o `<td>` de 0px e straddleava a fronteira exatamente antes de Spend → aparência de pill duplicado.

**Fix aplicado:**
1. **`TableContent`:** o skeleton de célula agora pula colunas auxiliares de largura 0 (`column.getSize() > 0`), renderiza um quadradinho de checkbox para a coluna `select`, e o pill só nas métricas reais. Elimina o vazamento.
2. **Novo `ManagerTableSkeleton`** (apresentacional, sem hooks de dados): reproduz a cromo do `ManagerTable` em loading — abas (`TabbedWorkspace` com `MANAGER_TABS`), placeholders de controles (Colunas/Exibição/Tela cheia), toolbar (busca + filtros) e a tabela "detailed" com header de rótulos reais (`getManagerMetricLabel`, colunas default sem planilha) + 8 linhas skeleton. `ManagerPageFallback` passou a usar esse componente com os MESMOS `title="Otimize"`/`description`/`variant` do render real → sem salto de cabeçalho, transição contínua.

**Verificação:** `tsc --noEmit` limpo; `check:design-system` passou (skeleton importa `Skeleton` com `design-system-exception: direct-skeleton-import`, alturas de placeholder via `h-control-default`, rótulos via token). O estado de loading é transitório e exige auth+dados; validado por leitura de código contra `VARIANT_STYLES.detailed` (paridade de classes) — não driveável offline.

**Regra que ficou:** loops de skeleton sobre `getVisibleLeafColumns()` precisam pular colunas auxiliares de largura 0 (existem leafs visíveis com `size: 0` no /manager — filtros cruzados); senão um pill de largura fixa vaza para a coluna vizinha. Fallback de página (Suspense/gates de auth) deve reproduzir a cromo real da tela e reusar os mesmos `title`/`description`/`variant`, não um `StateSkeleton` genérico — evita o salto visual pré→pós-auth. Memória: `manager_skeleton_fallback_and_zero_width_column.md`.

## Fase 2: edição de orçamento pelo /manager (2026-07-10)

**Contexto:** passo (c) da sequência aprovada, após o usuário validar o read-path (Fases 0-1). Escopo v1: editar o valor do budget VIGENTE (daily OU lifetime) de adset (ABO) e campanha (CBO). Fora de escopo, por decisão: trocar daily↔lifetime (exige end_time), ligar/desligar CBO (exige adset_budgets de todos os filhos), spend_cap.

**Backend — espelho fiel do pipeline de status:**
1. `GraphAPI.update_entity_budget` (graph_api.py): **pre-check** (`get_entity_budget_config`, GET fields de budget) → valida modo e tipo ANTES de escrever, evitando repassar o erro #100 críptico da Meta: entidade sem budget próprio → `no_own_budget` (campanha ABO / adset sob CBO); tipo pedido ≠ vigente → `budget_type_mismatch`; valor igual → `noop` sem write (economiza rate limit) → **write** (POST /{id}) → **verify read-back** (relê a config real). Verify falho pós-write = `success` com `verified=False` e budgets null — o write aconteceu, mas sem verdade lida NADA é persistido localmente (próximo sync corrige).
2. Rotas `POST /facebook/adsets|campaigns/{id}/budget` (`UpdateBudgetRequest`: exatamente UM campo, int positivo em subunidade — model_validator) + `_finalize_budget_update`: ownership via `_assert_entity_belongs_to_user`; 409 com códigos orientativos (BUDGET_ON_CAMPAIGN / BUDGET_ON_ADSETS / BUDGET_TYPE_MISMATCH); 502 prefere `error_user_title/error_user_msg` da Meta (cobre "orçamento abaixo do mínimo" localizado) à mensagem técnica; sucesso persiste em parent_entities via `update_parent_entity_budget` (upsert merge-duplicates de UMA linha — colunas ausentes não são tocadas; campanha com budget verificado força budget_mode='cbo'), best-effort.
3. Testes: `test_budget_update_flow.py` (9 casos — happy paths daily/lifetime, bloqueios sem write, noop, auth_error, erro de write com error obj preservado, verify falho → unverified).

**Frontend:**
1. `useBudgetControl` (novo hook): mutation + patch in-place dos caches `["analytics","rankings"]`. **Guardas do patch** (lição do patch de status): só linhas que TÊM a chave `budget_daily` (a RPC só anexa a linhas de grupo) E `group_key === entityId` — linhas de campanha carregam adset_id/campaign_id de um ad REPRESENTANTE, então match por esses campos contaminaria; `group_key` é o id da própria entidade da linha. Sem invalidação/refetch: métricas não mudam, o valor patchado é a verdade verificada, e o sync on-focus reconfirma em ≤5min. Códigos 409 viram `toast.warning` orientativo; noop vira `toast.info`; `verified=false` vira success sem patch.
2. `BudgetCell` → `BudgetEditor`: valor vira botão (hover mostra lápis) que abre Popover com Input size="sm" (aceita vírgula/ponto; com vírgula, pontos são milhar), símbolo da moeda, Enter/Esc, e **aviso quando a mudança passa de ~25%** (fase de aprendizado do Meta). Estados não-editáveis ("na campanha", "nos conjuntos", "—") intocados. Conversão exibição↔subunidade via `budgetValueToMinor`/`budgetMinorToValue` (offset 1 vs 100 por moeda).

**Verificação:** 191 testes backend passando; tsc limpo; check:design-system passa; next build OK.

## Filtros do Manager: chips inline → botão "Filtros (N)" + popover (2026-07-11)

**Sintoma (reportado com prints, 2 iterações):** os chips de filtro no toolbar da tabela principal e do modal de expansão quebravam o layout conforme filtros eram adicionados — disputavam largura com busca/contagem/barra de ações em massa, com quebra de linha caótica. Uma primeira correção (chips em linha própria de largura total) criava desequilíbrio no estado vazio (busca no topo-esquerda, "Add filter" órfão embaixo-direita).

**Decisão (proposta pelo usuário):** filtros saem do toolbar. O botão "Add filter" virou `[⚲ Filtros (N) ▾]` — ícone + badge com a contagem, idêntico ao FiltersDropdown do Topbar — abrindo popover com linhas verticais `[coluna][operador][valor][🗑]`, no mesmo estilo dos filtros do modal de criar packs, + "Adicionar filtro" e "Limpar todos". A perda do "ver de relance" dos chips é compensada por: badge (QUANTOS filtros) + **tint na coluna filtrada** (`bg-primary-10` no th, `bg-primary-5` nas células — ONDE atuam), na tabela principal (`TableContent`, render de th/td centralizado) e no modal (`ManagerChildrenTable`).

**Iteração — o funil triplicado:** a 1ª versão sinalizava a coluna filtrada com um ícone de funil NOVO no header, que colidiu com DOIS funis pré-existentes: (1) o `ColumnFilter readonly` ao lado do título (indicador original do app, só na coluna filtrada) e (2) o funil da linha de média/soma filtrada, que aparece em TODAS as colunas de métrica quando qualquer filtro/busca está ativo → 3 funis na coluna filtrada (reportado pelo usuário com print). Fix: o glifo de funil passou a ter UM significado ("esta coluna tem filtro") — mantido só o (1); a média filtrada perdeu o ícone (cor primary + tooltip já dizem que é o agregado filtrado). Lição: antes de adicionar indicador em header do manager, inventariar os elementos condicionais que `renderMetricHeader` já renderiza.

**Iteração 2 — tint REJEITADO; funil em todas; bulk bar flutuante:** o sinal de coluna filtrada chegou a ser um tint (`bg-primary-10` no th + `bg-primary-5` nas células), testado pelo usuário e rejeitado ("ficou ruim") — **não re-propor tint de coluna**. Estado final: UM funil preenchido (`IconFilter w-3.5 fill-current text-primary`) em toda coluna filtrável com filtro efetivo — métricas via `ColumnFilter readonly`, Status/Nome via `ActiveFilterIcon` (mesmo visual) em `managerTableColumns` (Status/Nome não tinham indicador nenhum; o valor do filtro pode chegar AGREGADO em array no estado da tabela → `Array.isArray(...).some(isRestrictiveFilterValue)`). A barra de ações em massa saiu do toolbar e virou **`BulkActionsBar` flutuante** (pill centrado na base da área da tabela, `absolute bottom + z-sticky`, pai `relative`), compartilhada pela tabela principal e pelo modal, com "Selecionar/Desmarcar todos" além de Pausar/Ativar/limpar — a ação fica perto das linhas clicadas e o toolbar deixa de ser disputado.

**Implementação:** `FilterBar` reescrito (mesmo modelo de estado: instâncias `${colId}__${ts}`, savedValues/localInputValues, foco automático no filtro novo); helpers `isRestrictiveFilterValue`/`getFilteredColumnIds` em `lib/utils/columnFilters.ts` ("efetivo" = restringe de fato: value≠null; status só com subconjunto das 4 opções). Toolbar final: `[busca] ··· Exibindo X de Y · [Filtros (N)] · [bulk]` — 1 linha permanente nas duas superfícies. Linha de status usa toggles inline (evita popover aninhado). `FilterChip.tsx` deletado (órfão). Filtros de texto auxiliares (conjunto/campanha/ads ativos) mapeiam o tint para a coluna de nome.

**Gotchas:** Selects DENTRO do popover precisam de `disablePortal` (clique no dropdown portalizado conta como interact-outside e fecha o popover). Blur do input APLICA o valor em vez de cancelar — em popover, clicar noutro controle não pode descartar a digitação (Escape cancela). Trocar a coluna de um filtro substitui a instância (novo id + valor default do tipo).

**Regra que ficou:** toolbar de tabela com filtros dinâmicos → popover vertical com badge + tint por coluna; nunca chips inline que crescem com o número de filtros; um glifo = um significado. Memória: `manager_filterbar_popover_pattern.md`.

## Nova coluna "Leadscore Médio" no /manager, com Média + Tendências (2026-07-11)

**Contexto:** usuário pediu uma coluna opcional de leadscore médio no /manager. Como já havia toggle Média/Tendências, foi decidido (com o usuário) fazer o escopo completo — incluindo sparkline diário — em vez de só o modo Média.

**Descoberta que simplificou o trabalho:** `mqls`/`cpmql` (padrão já existente) NUNCA vêm da core RPC nem de `averagesOverride` — são 100% derivadas no cliente a partir de `leadscore_values` (array já presente em `RankingsItem`/`RankingsChildrenItem`), via `computeMqlMetricsFromLeadscore` (que já calculava `leadscoreAvg`, usado até então só em cards do Insights/Gems). Isso significou que **a core RPC (`fetch_manager_rankings_core_v2_base_v090`) não precisou de nenhuma mudança** — nem migration de coluna em `ad_metrics`, nem `averages_payload`. Só a **série diária** precisou de trabalho de backend, porque o modo Tendências (sparkline) exige granularidade por dia que não é derivável do array já agregado.

**Migration 092:** `create or replace` em `fetch_manager_rankings_series_v2` (mesma assinatura, sem novo parâmetro) — adiciona `leadscore_sum`/`leadscore_count` no CTE `daily` e a chave `leadscore_avg` (soma/contagem) em `series_by_group`, no mesmo padrão de `mql_count`/`cpmql` que já existia ali.

**Backend Python (children/drill-down):** `_build_rankings_series` (helper compartilhado por 6 endpoints legados de expansão de linha: ad-name/adset-id/campaign-id children + ad-name/adset-id/ad-id details) ganhou o par `leadscore_sum`/`leadscore_count` no dict `series_acc`/`S` e a série `leadscore_avg` no output — 1 helper novo (`_sum_count_leadscore`) + edição idêntica nos 6 call sites. `get_ad_history`/`get_ad_name_history` (endpoints de "detalhe do anúncio", fora do pipeline do /manager) usam um padrão de agregação diferente e foram deixados de fora, por decisão de escopo.

**Frontend:** seguiu o checklist de `manager_metric_column_pipeline.md` quase integralmente, exceto os passos de core RPC/`averages_payload` (não se aplicam). Ponderação da média: por **contagem de leads** (`leadscoreValues.length`), não por `plays` — leadscore não tem relação com reprodução de vídeo.

**Gotcha de DRY:** o gate `requiresSheetIntegration` (que já existia para cpmql/mqls) está hardcoded por `columnId` em **6 lugares** do frontend, não deriva de `METRIC_DEFINITIONS` automaticamente: `managerColumnPreferences.ts`, `ManagerTable.tsx` (3 pontos: `isColumnEnabled`, `isColumnDisabled` inline, merge de `averages` no branch `averagesOverride`), `ManagerExportDialog.tsx`, `exportManagerCsv.ts`. Toda métrica nova com esse requisito precisa entrar nos 6.

**Verificação:** `tsc --noEmit` limpo, 11/11 testes de `registry.test.ts`, `next build` OK, migration aplicada no banco remoto (confirmada via `pg_get_function_arguments` — assinatura da RPC inalterada) + `schema.sql`/`schema_map.md` regenerados. Memória: `manager_metric_column_pipeline.md` (atualizada, não nova).

## Coluna "% de MQLs" (taxa de qualificação) no /manager (2026-07-11)

**Decisão de produto — o denominador:** o pedido original dizia "MQLs sobre não MQLs". Levantada a ambiguidade com o usuário, que confirmou querer a **taxa de qualificação convencional: MQLs / TOTAL de leads**. A alternativa literal (MQLs / não-MQLs) é uma razão de odds, não uma porcentagem: passa de 100%, vira infinito quando todos os leads qualificam, e o valor "100%" significaria "metade dos leads" — confuso de ler numa tabela. Escala 0-1 (`formatKind: ratioPercent`), `null` quando não houve lead (0% é valor legítimo e distinto de "sem dado").

**Custo quase zero por causa da 092:** o CTE `daily` da RPC de séries já acumulava `mql_count` (desde a versão original) e `leadscore_count` (adicionado na 092 para o leadscore médio). A migration 093 é literalmente **uma divisão a mais** num `jsonb_agg` — nenhum acumulador novo, nenhuma mudança na core RPC. Idem no `_build_rankings_series` do Python: os dois números já estavam no dict `S`.

**Média do pack ponderada por volume de leads,** não média simples das taxas por linha — senão um anúncio com 2 leads pesaria igual a um com 200. Reusa o acumulador `leadscoreWeight` que a 092 já tinha criado: `mql_rate = sumMqls / leadscoreWeight`.

**Teste de regressão com fixture discriminante:** a fixture (A: 6 leads/3 MQLs, B: 2 leads/2 MQLs) foi escolhida para separar as três fórmulas plausíveis — ponderada por leads = 0,625 (correta), média simples das taxas = 0,75, MQLs/não-MQLs = 1,667. Qualquer regressão numa das duas decisões (denominador ou ponderação) quebra o teste com valor distinto.

**Smoke test end-to-end no banco:** RPC chamada com dados reais dentro de transação com `rollback`, simulando `auth.uid()` via `set local request.jwt.claims`. Retorno confirmou 156 MQLs com taxa 0,8168 → 191 leads totais, e a série sempre limitada a 0-1 (com denominador "não-MQLs" daria 4,46).

**Drift corrigido na memória:** a refatoração de colunas reordenáveis mudou dois fatos que estavam registrados. (1) Os pontos de gating `requiresSheetIntegration` caíram de 6 para 5 — `exportManagerCsv.ts` passou a delegar a `getVisibleManagerColumns` e não tem mais gate próprio. (2) A ordem visual da tabela agora vem de `state.columnOrder` (preferência persistida do usuário), não da sequência de `push` no factory; `normalizeManagerColumnOrder` já anexa colunas novas ao final de ordens salvas, então nenhuma migração de preferência é necessária ao adicionar métrica.

**Verificação:** `tsc --noEmit` limpo, 12/12 testes de `registry.test.ts` (11 + o novo), 8/8 dos testes de manager, `check:design-system` passou, `next build` OK, migration 093 aplicada + smoke test com dados reais + `schema.sql`/`schema_map.md` regenerados.

## Sync do Leadscore (Google Sheets) morria em ConnectionReset (WinError 10054): retry de rede faltando (2026-07-11)

**Sintoma:** ao atualizar packs (com a fila serial já funcionando), o sync do Google Sheets falhava com `Erro ao ler planilha do Google: ('Connection aborted.', ConnectionResetError(10054, ...))` no 1º chunk.

**Causa:** `google_sheets_service._request_with_retry` — apesar do nome — re-tentava **só HTTP 401** (refresh de token). Não cobria falha de rede transitória. Quando `requests.get` para a Sheets API levava um `ConnectionResetError` (WinError 10054 — conexão TLS caindo no handshake, típico do dev Windows sob carga de sockets: Meta + Supabase + thumbnails + Sheets simultâneos), o erro subia direto e matava o sync.

**Correção:** helper `_google_get_with_transient_retry` (backoff exponencial + jitter, 4 tentativas) cobrindo `requests.exceptions.ConnectionError/Timeout/ChunkedEncodingError`; aplicado a todos os GETs da Google API (fetch_all_rows, get_spreadsheet_name). Só re-tenta falha de REDE — nunca status HTTP, então 404/401 seguem tratados. Assinatura pública de `_request_with_retry` preservada.

**Padrão (recorrente):** helpers de "retry" no backend costumam cobrir só o caso feliz e deixar passar os transitórios de socket que de fato acontecem. Já visto em `with_postgrest_retry` (não cobre 57014 nem httpx.WriteError). Contexto: WinError 10054/10035 são majoritariamente artefato de **dev Windows**; produção (Linux) vê muito menos, mas retry é correto em qualquer ambiente. A fila serial reduz a carga concorrente, mas não substitui retry por chamada.

**Verificação:** `ast.parse` OK; lógica do retry testada isolada (recupera após N falhas, levanta ao esgotar).

## Card do Leadscore mostrava "Atualizado há 0 anos" após falha de sync (2026-07-11)

**Sintoma:** quando o sync do Leadscore falhava, o card do pack exibia "Atualizado há 0 anos" — sem sentido e sem comunicar o erro.

**Dois bugs:**
1. **Formatador (`formatRelativeTime`):** faltava o ramo `diffDays === 1` quando NÃO é "ontem" no calendário (timestamp de ~24-48h atrás que cai no anteontem por borda de dia/fuso). Sem ele, caía no cálculo de anos → `Math.floor(1/365) === 0` → "Atualizado há 0 anos". Corrigido com ramo explícito → "Atualizado há 1 dia". Agora todos os `diffDays` estão cobertos (0,1,2,3-29,30-364,≥365) — sem fall-through.
2. **UX do estado de erro (`PackCard`):** a infra de falha já existia (backend marca `last_sync_status="failed"`; frontend tinha `leadscoreSyncFailed` + ícone de aviso), mas mostrava o tempo relativo do ÚLTIMO SUCESSO com um ícone sutil — lia como "atualizado ok". Agora, quando falhou, o card mostra explicitamente **"Falha ao atualizar"** (cor de warning) e move a data do último sucesso para o tooltip.

**Relação com o fix anterior:** o retry de rede do Google Sheets (mesma data) reduz a FREQUÊNCIA da falha; este fix trata a EXIBIÇÃO quando ela ainda ocorre. Complementares.

**Verificação:** `tsc --noEmit` limpo; lógica do formatador testada isolada (caso do bug → "há 1 dia"; "ontem" e ranges 2/40/400 dias ok).

## Security review pré-go-live: rate limiting e zerar deps vulneráveis (2026-07-12)

Doc vivo com o inventário completo e o status de cada achado: `documentation/security-review-go-live-2026-07-09.md`. Registro aqui só as duas lições que mudam decisões futuras.

### Limite de rate: calibrar contra telemetria real, não contra intuição

A proposta inicial era uma classe única de "mutações caras" (refresh-pack, transcribe, bulk-ads, sync) a **10/min por usuário** — números escolhidos por raciocínio ("são cliques humanos deliberados"). Consultar o banco antes de implementar **derrubou a proposta**: há registro de **12 jobs criados por um único usuário em 1 minuto** (auto-refresh matinal de vários packs encadeando refresh Meta + sync do Sheets). O limite teria quebrado um fluxo legítimo no primeiro dia.

Correção: **limites por rota individual**, cada um com folga de 3-5× sobre o pico medido (refresh-pack e sheet-sync a 30/min; bulk/billing/transcribe-pack seguem a 10/min porque de fato são 1 request por ação humana — o fan-out de um pack com 3.767 ads acontece server-side). O rate limit é um **disjuntor anti-abuso, não traffic shaping**: usuário legítimo nunca deve ver 429.

Implementação: `backend/app/core/rate_limit.py` — sliding window em memória (suficiente para 1 container; **migrar para Redis se escalar horizontal**, senão os limites se multiplicam silenciosamente por réplica), chaveado pelo `sub` do JWT (decodificado sem verificar — um `sub` forjado troca de bucket mas morre logo depois na auth com um 401 barato) e com fallback pro **último hop** do `X-Forwarded-For` (o que o Traefik anexou; o primeiro hop é spoofável). Registrado **dentro** do CORSMiddleware — senão o 429 sai sem header CORS e o browser o mascara como "Network Error" opaco (mesma armadilha já documentada para o 500).

### 44 alertas de dependência eram, na prática, uma dep direta desatualizada

O Dependabot reportava 44 vulnerabilidades (16 high). Tratar item a item teria sido um desperdício: **`axios` sozinho respondia por 21 dos 44** (prototype pollution, ReDoS, vazamento de `Proxy-Authorization` em redirect, SSRF via `no_proxy`) — um bump 1.13→1.18 matou metade da lista. Resultado final: `npm audit` → **0 vulnerabilidades**.

Ordem que funcionou: (a) bump das **diretas** (axios, postcss), (b) `npm audit fix` **sem `--force`** para as transitivas, (c) `overrides` só para o resíduo que o pai pina (next pina `postcss@8.4.31`; tsx pina `esbuild@0.27.3`), (d) validar com `next build` — que é o teste real de um override de postcss (se o CSS sai gerado, o Tailwind não quebrou).

Três armadilhas do npm nesse caminho (detalhe na memória `npm_audit_next_downgrade_and_overrides`):
- `npm audit` propôs **downgrade do next 15.5.20 → 9.3.3** como "fix". É lixo: o alerta em `next` existia só porque ele empacota `postcss@8.4.31`. **Ler o `via` antes de aceitar qualquer `--force`.**
- Dep transitiva **pinada pelo pai** não é tocada por `npm audit fix` — só `overrides` resolve. E `overrides` é **dívida técnica**: remover cada entrada quando o pai subir a própria dep (o `package.json` carrega uma chave `"//overrides"` com a justificativa de cada uma).
- Override de dep que **também é direta** exige a sintaxe `"postcss": "$postcss"` — a forma literal falha com `EOVERRIDE`.

## Procedência (pack e conta) por linha no Manager (2026-07-12)

**Problema:** ao abrir um anúncio (ou olhar a tabela), não dava para saber de qual **pack** e de qual **conta de anúncio** ele veio. A RPC do Manager *filtra* por pack (semi-join em `ad_metric_pack_map`) mas **descartava** a informação.

### O seletor de packs não substitui a informação na linha — mas nada disso pertence à coluna de nome

Ponto de partida: com um pack selecionado, o seletor já respondeu "de onde vêm estas linhas" — repetir o mesmo nome em todas as linhas seria uma coluna inteira de valor constante, numa tabela que já disputa largura com ~25 métricas. A procedência só vira informação nova quando o resultado **mistura** packs ou contas.

Daí veio a hipótese de um **badge automático na célula de nome**, que apareceria sozinho quando a dimensão variasse. Foi implementada e **REJEITADA na revisão visual: poluiu a coluna de nome** (que já carrega thumbnail, nome, status e subtítulo). **Não re-propor.** A lição: "só aparece quando varia" resolve o problema de *redundância*, mas não o de *densidade* — a célula de nome já estava no limite, e um badge condicional continua sendo mais um elemento competindo por atenção na linha mais carregada da tabela.

Desenho final, com a procedência **fora** da linha:
- **No modal, sempre** — badges no mesmo vocabulário visual do "Agrupado"/"Individual" (`ProvenanceBadge`). Um valor → mostra o nome direto (nada a revelar no hover). Vários → mostra a contagem (“3 Packs”) e revela a lista no tooltip. É a ficha de identidade do anúncio, e é exatamente para isso que se abre o modal.
- **Colunas opcionais Pack/Conta** na tabela (desligadas por padrão) para quem precisa ordenar, filtrar ou exportar — opt-in, sem custo para quem não liga.

### Os dados derrubaram a alternativa barata (e revelaram um bug)

A opção sem backend era expor `packs.ad_ids` (já existe no banco) e cruzar no cliente. Medir antes de implementar matou a ideia e achou um bug:

| Fato medido no banco | Consequência |
|---|---|
| **0 de 17.625** pares (user, ad) pertencem a >1 pack | Para um **ad individual**, pack é 1:1 na prática. A UI otimiza para 1 valor, com `+N` só como salvaguarda. |
| **17%** das linhas da aba "Por anúncio" reúnem ads de **packs diferentes** | Uma linha agregada não expõe os `ad_ids` dos filhos → o cruzamento no cliente **falharia exatamente aqui**. Só o backend resolve. |
| **14%** das linhas da aba "Por anúncio" reúnem **contas diferentes** | **Bug pré-existente:** `account_id` da linha vem do CTE `rep` — o ad **representante** (maior impressões), não uma agregação. Em 1 de cada 7 linhas agregadas, exibir esse `account_id` como "a conta da linha" seria **mentira**. |

Por isso a migration 093 devolve **`account_ids[]`** (todas as contas do grupo) além do `pack_ids[]`. Para exibir conta, usar SEMPRE o array; `account_id` só serve de fallback para payload antigo.

### Custo: essencialmente zero

O `pack_agg` é um join sobre o CTE `filtered` (linhas **já** reduzidas pelos filtros) usando o índice reverso que já existia (`ad_metric_pack_map_user_ad_date_idx` em `(user_id, ad_id, metric_date)`). O `EXPLAIN ANALYZE` mostra **Nested Loop + Memoize a 0,045 ms por lookup**; o custo dominante da RPC continua sendo a varredura de `ad_metrics`. Medido com cache quente: v090 ≈ v093 (~24 ms) — sem regressão detectável.

### Armadilhas que o código encapsula

- **Célula reativa:** os nomes são resolvidos por **hook** dentro da célula (`useProvenanceIndex`), não por prop. `TableContent` é `React.memo` sobre uma instância **estável** de `table` — recriar as colunas quando `adAccounts` termina de carregar **não** re-renderizaria a célula; uma mudança de store, sim.
- **CSV:** as dimensões são resolvidas a partir de `row.original`, **nunca** por `row.getValue(id)` — o dialog de export permite escolher uma coluna que não está ativa na tabela, e para essa o TanStack devolve `undefined` (a coluna nem foi construída) → a coluna sairia vazia. E nome de pack é **texto livre** → passa por `neutralizeFormula` (anti formula-injection), ao contrário de qualquer métrica.
- **Tabela de variações:** dimensões são filtradas fora — os filhos vêm de `RankingsChildrenItem`, que não carrega `pack_ids`/`account_ids`.

**Verificação:** `pack_ids`/`account_ids` conferidos chamando a RPC real no banco com `auth.uid()` simulado; `tsc --noEmit`, `check:design-system`, `next build` e testes (4 de colunas + 5 novos de `provenance`) limpos.

## Rate limit em memória vale ×N com `uvicorn --workers N` (2026-07-13)

**Sintoma (pego na revisão pré-deploy, antes de subir):** o rate limiter do `#4` da security review foi calibrado contra telemetria real, com folga de 3-5× sobre o pico legítimo. Só que o `deploy/Dockerfile.backend` sobe o app com **`uvicorn --workers 4`**.

**Causa:** os contadores vivem na memória **do processo** (`_buckets` em `app/core/rate_limit.py`). Com 4 workers são **4 baldes independentes**, e as requisições de um mesmo usuário caem em workers aleatórios. Resultado: **o teto efetivo é ~4× o número escrito no código** (`user-delete` 5/min vira ~20/min; `transcribe-pack` 10 vira ~40).

**A premissa errada foi minha:** documentei "roda em 1 container ⇒ sliding window local basta". É 1 **container** com 4 **processos** — coisas diferentes. "Escalar horizontalmente" não é a única forma de multiplicar réplicas do estado; `--workers` já faz isso dentro do mesmo container.

**Decisão:** aceito conscientemente para o lançamento (continua sendo um disjuntor: o abuso segue limitado, só que com folga maior). **Correção planejada: Redis compartilhado** (`redis:7-alpine`, ~30MB, +1 serviço no compose), com **fail-open** se o Redis cair — infra de rate limit jamais deve derrubar tráfego legítimo.

**NÃO compensar dividindo os limites por 4:** a distribuição entre workers não é uniforme; `user-delete` viraria 1,25/min por worker e um usuário legítimo tomaria 429 falso. O conserto é o storage compartilhado, não o número.

**Padrão generalizável:** qualquer estado em memória de processo (rate limit, cache de dedup, locks, contadores, circuit breakers) é **silenciosamente multiplicado por `--workers`**. Antes de assumir "processo único", ler o `CMD` do Dockerfile — não só o `docker-compose.yml`.

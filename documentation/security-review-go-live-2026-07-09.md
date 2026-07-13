# 🔒 Security Review Pró-Produção (Go-Live) — Hookify

> **Documento de controle vivo.** Criado em 2026-07-09. Serve como fonte única para rastrear
> as correções de segurança pré-lançamento: o que já foi feito, o que falta, e o contexto
> necessário para implementar cada item sem depender do histórico do chat.
>
> **Como usar:** cada achado tem um campo **Status**. Atualize-o à medida que avançamos.
> Registre decisões/observações no bloco **Log** de cada item e no **Histórico** ao final.

## Legenda de status
- ⬜ **Não iniciado**
- 🟡 **Em andamento**
- ✅ **Concluído** (com verificação)
- ⏭️ **Adiado / Aceito como risco** (justificar no Log)

---

## Veredito atual: 🟡 Bloqueadores críticos resolvidos — falta hardening antes de tráfego real

**Ambos os bloqueadores de go-live foram resolvidos:** #1 (Next 15.5.20) e #2 (segredos
rotacionados + `.env` destrastreado). Não há mais bloqueador 🔴 crítico.

**Todos os 🔴/🟠 estão resolvidos** (#1, #2, #3, #4). Os 🟡/🟢 (#5–#10) seguem como
hardening incremental. Follow-ups em aberto: promover CSP de Report-Only para enforce
(#3) e observar logs `[RATE_LIMIT]` em produção para calibrar limites (#4).

**Stack real confirmada na auditoria:**
Next.js `15.5.20` (era 15.5.9, atualizado em 2026-07-09) + React `18.3.1`
(frontend `output: standalone`, servidor Node completo) ·
FastAPI + Supabase (JWKS/RLS) · Traefik + Let's Encrypt + Cloudflare.

---

## Painel de progresso

| # | Sev | Achado | Status | Bloqueia go-live? |
|---|-----|--------|--------|-------------------|
| 1 | 🟠 Alto (era 🔴) | Next.js desatualizado — May 2026 Security Release, 13 CVEs (middleware bypass/XSS/SSRF/DoS). React2Shell já estava corrigido em 15.5.9 | ✅ | ~~SIM~~ Resolvido |
| 2 | 🔴 Crítico | `.env` raiz (órfão, não-usado) versionado em repo **PÚBLICO** — `ASSEMBLYAI_API_KEY` + `META_API_KEY`(legado). Chaves rotacionadas + destrastreado + push (Opção A) | ✅ | ~~SIM~~ Resolvido |
| 3 | 🟠 Alto | Security headers (CSP, HSTS, X-Frame-Options…) — 5 enforce + CSP Report-Only no next.config.ts | ✅ | Não |
| 4 | 🟠 Alto | Nenhum rate limiting de entrada em toda a API — limiter por usuário no FastAPI + anti-flood por IP no Traefik | ✅ | Não |
| 5 | 🟡 Médio | Middleware usa `getSession()` (não revalida) em vez de `getUser()` | ⬜ | Não |
| 6 | 🟡 Médio | `ignoreBuildErrors` + `ignoreDuringBuilds` no build | ⬜ | Não |
| 7 | 🟡 Médio | Deps vulneráveis (44 → **0**) + esteira de CI/CD (SAST, secret scan) ainda pendente | 🟡 | Não |
| 8 | 🟢 Baixo | `SENTRY_AUTH_TOKEN` como build-arg do Docker | ⬜ | Não |
| 9 | 🟢 Baixo | JSON-LD via `dangerouslySetInnerHTML` sem escapar `</script>` | ⬜ | Não |
| 10 | 🟢 Baixo | CORS `allow_methods/headers=["*"]` + credentials | ⬜ | Não |
| — | ✅ OK | JWT, webhook Stripe, autorização admin, separação de segredos | — | — |

---

## Achados detalhados

### 1. ✅ [Alto — era Crítico] Next.js desatualizado (May 2026 Security Release / 13 CVEs)
**Status:** ✅ **Concluído** (2026-07-09) · **Bloqueia go-live:** Resolvido
**Área:** Supply chain / RSC

**⚠️ Correção do diagnóstico original:** A auditoria inicial classificou isto como 🔴 Crítico por
supor que **15.5.9 estava vulnerável ao React2Shell** (CVE-2025-55182 / CVE-2025-66478). **Isso
estava errado.** O advisory oficial do Next.js lista as versões corrigidas **por linha**: para a
linha 15.5.x, a correção está em **15.5.7** (lançada 03/12/2025). O projeto rodava **15.5.9**
(lançada 11/12/2025) — **posterior ao patch**, portanto **já protegido contra React2Shell**.
Timestamps do npm registry que confirmam:
- `15.5.6` → 2025-10-17 (pré-CVE) · `15.5.7` → 2025-12-03 (patch React2Shell) ·
  `15.5.8` → 2025-12-11 · `15.5.9` → 2025-12-11 (versão que rodava; ≥ 15.5.7 = segura)

**Risco real encontrado (por que o achado continuou válido):** 15.5.9 estava **11 releases atrás**
na linha 15.5.x. O **May 2026 Security Release** corrigiu **13 advisories** (patched em **15.5.18**),
incluindo **middleware bypass** (crítico aqui — o `middleware.ts` faz gate de auth/tier, ver #5),
**XSS, SSRF, cache poisoning e DoS**. Também: CVE-2026-45109 (fix incompleto em 15.5.16 quando o
bundler é Turbopack; completo em 15.5.18). O projeto em 15.5.9 estava exposto a esses 13 CVEs.

**Remediação aplicada:** bump de patch dentro da mesma minor (mantém React 18, sem breaking change):
```bash
cd frontend && npm install next@15.5.20    # última da linha 15.5.x (cobre tudo até maio/2026)
```

**Resultado / verificação (concluída):**
- [x] `npm ls next` → **15.5.20** (deduped em tudo, inclusive sob `@sentry/nextjs`)
- [x] Não vulnerável ao React2Shell (já estava desde 15.5.9) + cobre May 2026 (13 CVEs) via 15.5.18+
- [x] Build de produção (`npm run build`) passa limpo — todas as rotas + middleware compilados
- [x] Versão fixada em `package.json` → `"next": "^15.5.20"`; lockfile atualizado e commitável
- [x] `npm audit`: **nenhuma** vuln de Next/RSC restante (as high/moderate restantes são `ws`/`uuid`
      em toolchain de build — movidas para o achado #7)

**Observações para deploy:** `npm ci` no Docker usa o lockfile (pin exato 15.5.20). Confirmar que o
`package-lock.json` atualizado foi commitado antes do build da imagem. Considerar acompanhar a linha
15.5.x periodicamente (Dependabot, ver #7) — hoje a mais nova é 15.5.20.

**Log:**
- 2026-07-09 — Verificado via advisory oficial (nextjs.org/blog/CVE-2025-66478) + npm registry que
  15.5.9 já cobria React2Shell. Achado reclassificado de 🔴→🟠. Atualizado 15.5.9→15.5.20 para
  cobrir o May 2026 Security Release. Build OK. `npm audit` expôs `ws`(high)/`uuid` no toolchain →
  registrado no #7. Nenhuma memória criada (achado transitório em remediação).

---

### 2. ✅ [Crítico] Segredos versionados em repo PÚBLICO (`.env` raiz órfão)
**Status:** ✅ **Concluído** (2026-07-09, via Opção A) · **Bloqueia go-live:** Resolvido
**Área:** Secrets / Supply chain

**Contexto / risco (atualizado 2026-07-09 após investigação):**
O `.gitignore` cobria `backend/.env`, `frontend/.env`, `supabase/.env` — **mas não o `.env` da
raiz**, que estava rastreado e contém **`ASSEMBLYAI_API_KEY` e `META_API_KEY`** com valores
não-vazios. **O repositório é PÚBLICO** (`github.com/mil4zzo/hookify`, confirmado via API →
HTTP 200) → os valores estão acessíveis a qualquer um no histórico do GitHub (bots varrem repos
públicos em minutos). **Tratar como comprometidas.**

**Escopo real (investigado — melhor do que parecia):**
- **O root `.env` é órfão: nada o carrega.** O backend faz `load_dotenv(backend_dir/".env")`
  ([config.py:7-8](../backend/app/core/config.py#L7-L8)) = `backend/.env`; o Docker usa
  `backend/.env` + `frontend/.env.local`. O root `.env` não é referenciado em código nem no
  compose — nem dev nem prod. É lixo versionado.
- **`META_API_KEY` não é usado em lugar nenhum** (grep no código todo → 0 refs fora deste doc).
  O app autentica por **OAuth/login do Meta** (`FACEBOOK_CLIENT_ID`/`_SECRET` + access token do
  usuário), não por API key. Resquício legado (provável era Streamlit — `localhost:8501` no
  default de CORS). Revogar tem **zero impacto no app**.
- **`ASSEMBLYAI_API_KEY` é usado** ([transcription_service.py:44-47](../backend/app/services/transcription_service.py#L44-L47)),
  mas a partir de `backend/.env` — a cópia no root é duplicado estagnado. ⚠️ **Verificar se o valor
  vazado == a chave viva** em `backend/.env`: se sim, é a chave de produção exposta → rotação
  obrigatória + atualizar `backend/.env` com a nova.
- **Os segredos realmente críticos NUNCA foram commitados:** `git log --all` confirma que o
  **único** `.env` que já existiu no histórico é o root. `backend/.env`/`frontend/.env.local`
  (Supabase service role, Facebook secret, Stripe secret, `ENCRYPTION_KEY`) nunca vazaram. ✅
- Histórico do root `.env`: só 2 commits (`first commit` + `ed87092`) → purga simples.

**Feito nesta sessão (parte git, não-destrutiva):**
- [x] `git rm --cached .env` (destrastreado; arquivo local preservado)
- [x] `.gitignore` recebeu `/.env` e `/.env.*`
- [x] Verificado: `git ls-files .env` vazio · `git check-ignore .env` → `.env` · arquivo local presente
- [x] Staged e pronto (só `.env` deleção + `.gitignore`) — **não commitado, não pushado**

**Falta (decisões suas — outward-facing / destrutivas, não executadas unilateralmente):**
1. **Rotacionar (VOCÊ — em andamento):**
   - `ASSEMBLYAI_API_KEY` (dashboard AssemblyAI → regenerar) e atualizar `backend/.env` com a nova.
   - `META_API_KEY`: revogar o credential legado (sem impacto no app); se souber que nunca foi
     válido, é ponto discutível — revogar por segurança mesmo assim.
2. **Finalizar no remoto público — escolher A ou B:**
   - **A (rápido, recomendado dado que a rotação está em curso):**
     ```bash
     git commit -m "chore(security): stop tracking root .env"
     git push
     ```
     Com as chaves rotacionadas, os valores no histórico ficam inúteis. Deixa o histórico exposto,
     mas sem valor.
   - **B (limpeza completa do histórico público):**
     ```bash
     git filter-repo --path .env --invert-paths   # ou BFG
     git push --force --all                        # coordenado (repo público, re-clone)
     ```
     Remove os valores do histórico do GitHub. Mais trabalhoso; faz sentido se quiser os valores
     fora da história pública independentemente da rotação.

**Verificação (definição de "concluído"):**
- [x] `ASSEMBLYAI_API_KEY` rotacionada (confirmado pelo usuário) — conferir que `backend/.env` tem a nova
- [x] `META_API_KEY` legado revogado (confirmado pelo usuário)
- [x] `.env` raiz destrastreado e coberto pelo `.gitignore`
- [x] Commit + push aplicado (**Opção A**) — commit `7f1f629`, push `de98452..7f1f629 main`
- [x] (Opção A) aceito conscientemente que os valores antigos permanecem no histórico público (já inúteis pós-rotação)

**Risco residual aceito:** os valores antigos continuam visíveis no histórico do GitHub (commits
`fa33ce8`, `ed87092`). Como foram **rotacionados**, são inúteis. Se um dia quiser removê-los da
história pública mesmo assim, executar a **Opção B** (`git filter-repo --path .env --invert-paths`
+ force-push coordenado) — não é necessário para go-live.

**Log:**
- 2026-07-09 — Investigado: repo é PÚBLICO; root `.env` é órfão (não carregado); `META_API_KEY`
  não usado (app é OAuth); `ASSEMBLYAI` usado mas de `backend/.env`; só o root `.env` esteve no
  histórico; segredos críticos nunca commitados. Executada a parte git (`rm --cached` + `.gitignore`).
- 2026-07-09 — Usuário rotacionou ambas as chaves. Finalizado via **Opção A**: commit `7f1f629`
  (só `.env` deleção + `.gitignore`, sem varrer outras mudanças) + `git push origin main` (sucesso).
  `.env` fora do HEAD, arquivo local preservado. #2 concluído. **Ambos os bloqueadores de go-live
  (#1, #2) resolvidos.** No push, o GitHub reportou 62 vulns Dependabot (25 high) → anexado ao #7.

---

### 3. ✅ [Alto] Security headers de resposta (implementados; CSP em Report-Only)
**Status:** ✅ **Concluído** (2026-07-09) · **Bloqueia go-live:** Não
**Área:** Infra / Frontend

**Contexto / risco:**
Nenhum header de segurança em nenhuma camada. O único header no Traefik é `X-Forwarded-Proto`
(request header), não resposta. Faltam **CSP, HSTS, X-Frame-Options, X-Content-Type-Options,
Referrer-Policy, Permissions-Policy**. TLS existe (Let's Encrypt via `certresolver`), mas sem
HSTS o downgrade continua possível; sem X-Frame-Options/frameDeny há risco de clickjacking.

**Evidência:**
- `deploy/docker-compose.yml:69` → única middleware de headers é `X-Forwarded-Proto=https`
- Nenhum `async headers()` em `frontend/next.config.ts`

**Remediação — Traefik (HSTS + clickjacking na borda):**
```yaml
# deploy/docker-compose.yml (labels do frontend)
- "traefik.http.middlewares.sec-headers.headers.stsSeconds=63072000"
- "traefik.http.middlewares.sec-headers.headers.stsIncludeSubdomains=true"
- "traefik.http.middlewares.sec-headers.headers.stsPreload=true"
- "traefik.http.middlewares.sec-headers.headers.frameDeny=true"
- "traefik.http.middlewares.sec-headers.headers.contentTypeNosniff=true"
- "traefik.http.middlewares.sec-headers.headers.referrerPolicy=strict-origin-when-cross-origin"
- "traefik.http.routers.frontend.middlewares=frontend-headers,sec-headers"
```
**CSP no `next.config.ts`** via `async headers()`, começando em `Content-Security-Policy-Report-Only`
para não quebrar o app. Domínios já em uso que a CSP precisa permitir: `*.fbcdn.net`,
`*.supabase.co`, Sentry, Cloudflare, e as fontes `img-src`/`connect-src` do app.

**Feito (2026-07-09) — `frontend/next.config.ts`, `async headers()` em `/:path*`:**
Enforce (imediato, baixo risco):
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` (+ `frame-ancestors 'none'` na CSP) — anti-clickjacking
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` — **só em produção**
  (`isProd = NODE_ENV==='production'`; em localhost quebraria o dev forçando https)

CSP em **Report-Only** (não bloqueia; allowlist dos hosts reais): `default-src 'self'`;
`script-src 'self' 'unsafe-inline'` (+`'unsafe-eval'` só dev); `style-src 'self' 'unsafe-inline'`;
`img-src` self/data/blob/`*.fbcdn.net`/`www.facebook.com`/`*.supabase.co`; `connect-src` self/
`*.supabase.co`(+wss)/`api.hookifyads.com`/`hookifyads.com`/`*.sentry.io`/`*.ingest.sentry.io`;
`object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `worker-src 'self' blob:`.

**Verificação (feita):**
- [x] `next build` OK; `routes-manifest.json` → 1 regra em `/:path*` com as 6 keys compiladas
- [x] HSTS presente só no build de produção (não em dev)
- [x] CSP emitida como `Content-Security-Policy-Report-Only` (não bloqueia nada ainda)

**Follow-ups (não bloqueiam go-live):**
1. **Promover CSP para enforce** após observar reports em produção sem violações no fluxo normal:
   trocar a key `'Content-Security-Policy-Report-Only'` → `'Content-Security-Policy'` em
   `securityHeaders` (`next.config.ts`). Recomendado configurar um `report-uri`/`report-to` antes
   (ex.: Sentry CSP reports) para coletar violações. Upgrade posterior: CSP com **nonce** (remove
   `'unsafe-inline'` de script-src) via middleware.
2. **(Opcional) HSTS na borda (Traefik) + headers no backend (FastAPI):** o app já cobre o
   frontend; adicionar `nosniff`/HSTS no Traefik e uma CSP `default-src 'none'` nas respostas JSON
   do backend é defesa em profundidade. Não urgente.
3. **Validar em produção:** securityheaders.com nota A/A+ após deploy; conferir que imagens
   fbcdn/supabase, Sentry e auth funcionam (esp. ao promover a CSP para enforce).

**Log:**
- 2026-07-09 — Implementados 5 headers enforce + CSP Report-Only em `next.config.ts` (allowlist
  baseada nos hosts reais mapeados: Supabase, backend, Sentry, imagens Meta). HSTS gated por
  `isProd`. Verificado via `routes-manifest.json` no build de produção. CSP deixada em Report-Only
  de propósito — promover para enforce é follow-up pós-observação, não bloqueia go-live.

---

### 4. 🟠 [Alto] Nenhum rate limiting de entrada em toda a API
**Status:** ✅ Concluído (2026-07-12) · **Bloqueia go-live:** Não
**Área:** Backend / DoS

**Contexto / risco:**
Não existia rate limiting em nenhum endpoint. Os únicos "rate limit" no código
(`ads_enricher.py`, `bulk_ad_service.py`) tratam o limite **de saída da Meta**, não protegem o
Hookify. Expunha: força-bruta, scraping, e — crítico — **DoS nos RPCs de analytics** (documentado
nas memórias como capaz de estourar `statement_timeout`). Além de DoS, as rotas de "amplificação
de custo" (1 request → dezenas de chamadas Meta / cobrança AssemblyAI) permitiam fatura arbitrária
com um único JWT válido.

**Implementação (camada dupla):**

1. **App (camada principal)** — `backend/app/core/rate_limit.py`: sliding window em memória
   (sem dependência nova; suficiente para 1 container — **migrar p/ Redis se escalar horizontal**).
   Chave = `user:{sub}` do JWT (decodificado sem verificação — sub forjado morre na auth com 401
   barato) com fallback `ip:{último hop do X-Forwarded-For}` (o hop do Traefik, não-spoofável).
   Registrado em `main.py` DENTRO do CORSMiddleware para o 429 sair com headers CORS.
   Flag `RATE_LIMIT_ENABLED` (default true) em `config.py`.

2. **Borda (anti-flood)** — Traefik `ratelimit` average=50/burst=100 por IP nos dois routers
   do backend (`deploy/docker-compose.yml`). Na rota via Cloudflare o IP visto é da CF
   (agregado) — aceitável, é contenção bruta; a rota principal (`api.hookifyads.com`, DNS-only)
   vê o IP real.

3. **Frontend** — retry global do TanStack Query não re-tenta 4xx (`ReactQueryProvider.tsx`):
   429 não vira tempestade de retries.

**Limites (por usuário/min, validados contra telemetria real do banco em 2026-07-12):**
| Classe | Limite | Base empírica |
|---|---|---|
| Default autenticado | 300 | fan-out do manager ≈ 30 req/load; polling 1/s |
| Analytics pesados (rankings/series/retention/dashboard/children/history) | 120 | máx. 12 packs/usuário; RPCs com histórico de 57014 |
| refresh-pack, sheet-sync | 30 cada | **pico real medido: 12 jobs/min** (auto-refresh matinal) — por isso limites POR ROTA, não classe compartilhada |
| transcription/start (retry por ad) | 30 | clicável em série |
| bulk-ads, campaign-bulk, transcribe-pack, adaccounts/sync, billing | 10 cada | 1 request por ação humana (fan-out é server-side; pack de 3.767 ads = 1 request) |
| status-sync | 20 | frontend manda todos os pack_ids num único POST |
| DELETE account/data | 5 | sem uso legítimo repetido |
| Webhook Stripe (por IP) | 240 | assinatura é a defesa real |

**Verificação:**
- [x] Rajada acima do limite retorna 429 com `Retry-After` (12 testes em `tests/test_rate_limit.py`)
- [x] Endpoints de analytics têm limite dedicado mais baixo (120/min)
- [x] Key function usa JWT sub; IP só como fallback, resolvido pelo último hop do XFF
- [x] Janela desliza (expiração parcial testada); buckets isolados por rota e usuário
- [ ] Follow-up: observar logs `[RATE_LIMIT]` em produção 1-2 semanas; ajustar p/ cima se legítimo

**Log:**
- 2026-07-12: implementado. Decisão importante: proposta inicial de 10/min numa classe única de
  "mutações caras" foi **derrubada por dados reais** (usuário legítimo com packs em auto-refresh
  atinge 12 req/min) → limites por rota individual com folga 3-5× sobre o pico medido.
- Brute-force de login NÃO passa por aqui: auth é direto no Supabase (GoTrue) — conferir rate
  limits no dashboard do Supabase (Auth → Rate Limits).

---

### 5. 🟡 [Médio] Middleware usa `getSession()` em vez de `getUser()`
**Status:** ⬜ Não iniciado · **Bloqueia go-live:** Não
**Área:** Frontend / Auth

**Contexto / risco:**
`frontend/middleware.ts` usa `supabase.auth.getSession()` para gatear rotas. A documentação do
Supabase alerta explicitamente para **não confiar** em `getSession()` em código de servidor
(middleware): ele lê o cookie sem revalidar o token contra o Auth server. O gate de tier no
middleware também depende disso. **Mitigado** pelo fato de a autorização real ser imposta pelo
backend (validação JWT em `auth.py` + RLS), então isto é hardening do gate de UX, não uma
brecha de autorização de dados. Ainda assim, recomendado.

**Evidência:**
- `frontend/middleware.ts:45` → `await supabase.auth.getSession()`

**Remediação:**
Trocar por `supabase.auth.getUser()` (revalida contra o Auth server). Avaliar impacto de
latência (1 request extra por navegação) — pode ser aceitável dado o volume, ou mitigado com
cache curto. Manter o try/catch fail-open já existente.

**Verificação:**
- [ ] Middleware usa `getUser()`
- [ ] Cookie forjado/adulterado não passa o gate
- [ ] Latência de navegação aceitável

**Log:**
- _(vazio)_

---

### 6. 🟡 [Médio] Build ignora type-check e lint
**Status:** ⬜ Não iniciado · **Bloqueia go-live:** Não
**Área:** CI/CD / Frontend

**Contexto / risco:**
`frontend/next.config.ts:8-9`: `typescript.ignoreBuildErrors: true` e
`eslint.ignoreDuringBuilds: true`. O build passa com erros de tipo/lint — remove uma rede que
pega bugs de classe (props não sanitizadas, `any` inseguro). Higiene fraca para go-live.

**Remediação:**
Remover ambos (ou mover a checagem para gate obrigatório de CI) e corrigir o backlog de erros
antes do deploy. Provavelmente há um backlog acumulado — pode exigir esforço; medir primeiro
com `npx tsc --noEmit` e `npm run lint`.

**Verificação:**
- [ ] `npx tsc --noEmit` limpo
- [ ] `npm run lint` limpo (ou erros restantes triados/justificados)
- [ ] Flags removidas de `next.config.ts` OU gate de CI equivalente ativo

**Log:**
- _(vazio)_

---

### 7. 🟡 [Médio] Deps vulneráveis + sem esteira de segurança no CI/CD
**Status:** 🟡 Parcial — **deps zeradas (2026-07-12)**; esteira de CI/CD pendente · **Bloqueia go-live:** Não
**Área:** CI/CD / Supply chain

**Contexto:** Não há SAST, secret scanning nem dep audit no fluxo. O Dependabot (já ativo) vinha
reportando 62 → 44 vulnerabilidades na branch default.

#### 7a. Dependências vulneráveis — ✅ CONCLUÍDO (2026-07-12)

Ponto de partida: **44 alertas** do Dependabot (16 high, 25 moderate, 3 low) / **19** no `npm audit`.
Resultado: **`npm audit` → 0 vulnerabilidades**; backend sem alertas pip.

O grosso era **um único pacote**: `axios` respondia por **21 dos 44 alertas** (prototype pollution,
ReDoS, vazamento de `Proxy-Authorization` em redirect, SSRF via `no_proxy`) — todos resolvidos num
bump de dependência direta.

| Ação | Detalhe |
|---|---|
| `axios` 1.13.2 → **1.18.1** | direta; mata 21 alertas + `form-data`/`follow-redirects` (transitivas dele) |
| `postcss` 8.5.6 → **8.5.18** | direta |
| `npm audit fix` (sem `--force`) | `lodash`, `ws`, `picomatch`, `brace-expansion`, `uuid`, `@babel/core`, `@opentelemetry/*`, `@sentry/*` |
| `overrides` no package.json | `postcss: "$postcss"` (next@15.5.20 **pina 8.4.31** internamente) e `esbuild: ^0.28.1` (tsx@4.21 pina 0.27.3) |
| `requests` 2.32.3 → **2.33.0**, `python-dotenv` 1.0.1 → **1.2.2** | backend |

**Armadilhas encontradas (não repetir):**
- `npm audit` propõe "fix" de `next` para **`next@9.3.3` (downgrade major)** — lixo. O alerta de
  `next` existe **só** porque ele empacota `postcss@8.4.31`; a correção real é o `override`.
- O `override` de uma dep que **também é direta** precisa usar a sintaxe `"$postcss"` (referência à
  direta), senão o npm falha com `EOVERRIDE`.
- Os `overrides` são dívida técnica: **remover cada entrada quando o pai subir a sua própria dep**
  (comentário `//overrides` no package.json registra o porquê de cada uma).

**Validação:** 221 testes backend · `tsc --noEmit` limpo · `next build` OK (CSS gerado ⇒ override do
postcss não quebrou o Tailwind) · design-system check OK.

#### 7b. Esteira de CI/CD — ⬜ PENDENTE

**Remediação — pipeline mínimo antes do deploy:**
- **Secret scanning:** `gitleaks detect` (teria pego o achado #2) ou TruffleHog
- **SAST:** `semgrep --config auto` + `bandit -r backend/app`
- **Deps:** `npm audit --audit-level=high` + `pip-audit` (agora que a base está em 0, o gate segura)
- **DAST (staging):** OWASP ZAP baseline scan
- Rodar `next build` **sem** os `ignore*` (ver #6) como gate

**Verificação:**
- [x] `npm audit` limpo no frontend (0 vulnerabilidades)
- [x] Deps vulneráveis do backend corrigidas (`requests`, `python-dotenv`)
- [x] Dependabot habilitado (já estava)
- [ ] Workflow de CI roda gitleaks + semgrep + audits e falha em achados altos

**Log:**
- 2026-07-09 — `ws`(high)/`uuid` detectados ao rodar `npm audit` durante o #1. Registrados aqui
  para tratamento no escopo de deps.
- 2026-07-12 — **7a concluído.** 44 → 0. Lição: sempre checar se um punhado de alertas não é
  **uma única dep direta** desatualizada antes de tratar item a item (axios = 21/44).

---

### 8. 🟢 [Baixo] `SENTRY_AUTH_TOKEN` como build-arg do Docker
**Status:** ⬜ Não iniciado · **Bloqueia go-live:** Não
**Área:** Infra

**Contexto / risco:**
`deploy/docker-compose.yml:51` passa o token como `build.args`, que fica gravado nas camadas da
imagem (`docker history` revela). É segredo de build (upload de source maps), não vai pro bundle
do cliente — impacto limitado — mas vaza se a imagem for compartilhada.

**Remediação:** BuildKit secret mount (`RUN --mount=type=secret,id=sentry_token`) em vez de `ARG`.

**Verificação:**
- [ ] `docker history` da imagem do frontend não expõe o token

**Log:**
- _(vazio)_

---

### 9. 🟢 [Baixo] JSON-LD sem escapar `</script>`
**Status:** ⬜ Não iniciado · **Bloqueia go-live:** Não
**Área:** Frontend / XSS (latente)

**Contexto / risco:**
3 usos de `dangerouslySetInnerHTML`, **todos com dados estáticos controlados pelo dev** — não
são XSS exploráveis hoje. Risco é latente: `JSON.stringify` não escapa `</script>`, então se
um campo dinâmico entrar nesses schemas no futuro, vira XSS.

**Evidência:**
- `frontend/app/waitlist/page.tsx:145` (JSON-LD estático)
- `frontend/app/pv/page.tsx:129` (JSON-LD estático)
- `frontend/components/waitlist/WaitlistV2.tsx:264` (CSS estático — seguro)

**Remediação (defense-in-depth):**
```tsx
const safeJsonLd = JSON.stringify(schema).replace(/</g, '\\u003c')
<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd }} />
```

**Verificação:**
- [ ] Todos os JSON-LD escapam `<` antes de injetar

**Log:**
- _(vazio)_

---

### 10. 🟢 [Baixo] CORS `allow_methods/headers=["*"]` + credentials
**Status:** ⬜ Não iniciado · **Bloqueia go-live:** Não
**Área:** Backend

**Contexto / risco:**
`backend/app/main.py:40-46` usa `allow_methods=["*"]`, `allow_headers=["*"]`,
`allow_credentials=True`. **Seguro na config atual** porque `CORS_ORIGINS` é explícito em
produção (`https://hookifyads.com,...` no compose). Risco é operacional: se setarem
`CORS_ORIGINS=*`, o Starlette passa a ecoar o Origin com credenciais → roubo de sessão.

**Remediação:**
- Restringir métodos ao necessário: `["GET","POST","PATCH","OPTIONS"]`
- Guard de startup que aborta se `"*" in CORS_ORIGINS and allow_credentials`

**Verificação:**
- [ ] Métodos restritos
- [ ] Guard impede a combinação `*` + credentials

**Log:**
- _(vazio)_

---

## ✅ Pontos fortes confirmados (não regredir)

Verificados na auditoria e considerados corretos — cuidado ao mexer:

- **JWT** (`backend/app/core/auth.py`): allowlist fixa `["RS256","ES256"]`, sem alg-from-header
  (previne alg-confusion), HS256 legado roteado para validação server-side, `verify_signature`
  + `verify_exp` ativos, JWKS cacheado 10min. _Nota menor:_ `verify_aud=False` e sem checagem de
  `iss` — hardening opcional, risco baixo.
- **Webhook Stripe** (`backend/app/routes/billing.py:396`): verificação de assinatura via
  `construct_event` + idempotência via tabela `stripe_events`. Handlers usam retrieve ao vivo e
  protegem tier admin.
- **Autorização admin/tier** (`backend/app/core/tier.py:52`): `require_min_tier` fail-closed para
  admin (503), fail-open só para insider. Rotas admin todas gateadas.
- **Separação de segredos:** nenhum segredo de backend no bundle do frontend; `service_role` só
  server-side. `NEXT_PUBLIC_*` vs. server-only correto.
- **Validação Pydantic** estrita nos endpoints (`Literal[...]`) — defesa direta contra
  desserialização insegura no lado da API.

---

## Ordem de execução recomendada

1. **#1** React2Shell (bloqueador) — atualizar Next
2. **#2** Segredos no git (bloqueador) — rotacionar + purgar
3. **#3** Security headers
4. **#4** Rate limiting
5. **#6** Remover ignore de type-check/lint
6. **#7** Esteira de CI/CD
7. **#5, #8, #9, #10** hardening residual

Itens **#1 e #2 são os únicos que travam o lançamento**. Os demais podem ir em paralelo/logo
após, mas idealmente antes de tráfego real.

---

## Histórico de alterações do documento

| Data | Autor | Alteração |
|------|-------|-----------|
| 2026-07-09 | Claude + usuário | Criação do documento a partir da security review inicial. Todos os itens em ⬜. |
| 2026-07-09 | Claude + usuário | **#1 concluído.** Diagnóstico corrigido: 15.5.9 já cobria React2Shell; risco real era o May 2026 Security Release (13 CVEs). Next 15.5.9→15.5.20, build OK. Reclassificado 🔴→🟠✅. Vulns `ws`/`uuid` registradas no #7. Veredito: bloqueador restante = só #2. |
| 2026-07-09 | Claude + usuário | **#2 em andamento.** Investigado: repo PÚBLICO; root `.env` órfão (não carregado); `META_API_KEY` não usado (app é OAuth); segredos críticos nunca commitados. Parte git feita (`rm --cached` + `.gitignore`, staged sem commit/push). Falta rotação (usuário) + Opção A/B de finalização no remoto. |
| 2026-07-09 | Claude + usuário | **#2 concluído (Opção A).** Usuário rotacionou as chaves; commit `7f1f629` + push para `main`. `.env` fora do HEAD (local preservado). **Ambos bloqueadores (#1,#2) resolvidos → veredito 🔴→🟡.** Dependabot reportou 62 vulns (25 high) no push → anexado ao #7. |
| 2026-07-09 | Claude + usuário | **#3 concluído.** 5 security headers enforce + CSP Report-Only em `next.config.ts` (`/:path*`), allowlist dos hosts reais, HSTS prod-only. Verificado no `routes-manifest.json`. Follow-up: promover CSP para enforce após observar reports. Alto restante antes de tráfego = só #4. |
| 2026-07-12 | Claude + usuário | **#4 concluído.** Rate limit por usuário (JWT sub) em `app/core/rate_limit.py` (sliding window em memória, 12 testes) + anti-flood por IP no Traefik + retry TanStack não re-tenta 4xx. Limites calibrados contra telemetria real do banco (pico de 12 jobs/min legítimo derrubou a proposta inicial de 10/min em classe compartilhada → limites por rota). **Todos os 🔴/🟠 resolvidos.** Follow-up: observar `[RATE_LIMIT]` em prod. |
| 2026-07-12 | Claude + usuário | **#7a concluído (deps).** 44 alertas Dependabot → **0** no `npm audit`. axios 1.13→1.18 (sozinho = 21/44), postcss 8.5.18, `npm audit fix` p/ transitivas, `overrides` p/ postcss (next pina 8.4.31) e esbuild (tsx pina 0.27.3); backend: requests 2.33.0 + python-dotenv 1.2.2. Build/tsc/221 testes OK. #7b (esteira CI/CD) segue pendente. |

---

## Referências (fontes verificadas)

- [React2Shell RCE (CVE-2025-55182) — Zscaler ThreatLabz](https://www.zscaler.com/blogs/security-research/react2shell-remote-code-execution-vulnerability-cve-2025-55182)
- [Security Advisory: CVE-2025-66478 — Next.js](https://nextjs.org/blog/CVE-2025-66478)
- [Critical Security Vulnerability in RSC — React.dev](https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components)
- [Exploitation of CVE-2025-55182 / CVE-2025-66478 — Palo Alto Unit 42](https://unit42.paloaltonetworks.com/cve-2025-55182-react-and-cve-2025-66478-next/)
- [React2Shell Critical Vulnerability — Wiz](https://www.wiz.io/blog/critical-vulnerability-in-react-cve-2025-55182)
- [React2Shell Security Bulletin — Vercel KB](https://vercel.com/kb/bulletin/react2shell)
- [fix-react2shell-next — vercel-labs (GitHub)](https://github.com/vercel-labs/fix-react2shell-next)

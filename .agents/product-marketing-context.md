# Product Marketing Context

*Last updated: 2026-04-30*
*Status: V1 draft — auto-inferred from `/pv` landing page, `/planos` page, and `documentation/como-funciona-o-app.md`. Sections marked **[CONFIRMAR]** need founder review.*

---

## Product Overview

**One-liner:** Hookify transforma campanhas da Meta em um placar de criativos — você compara, entende e age sem planilha infinita.

**What it does:** Importa anúncios da Meta via API, organiza em **Packs** (conta + período + filtros), e ranqueia por métricas que importam para criativo (Hook Rate, CTR, CPR, CPMQL). Permite enriquecer os dados com leadscore e CPR Máximo via Google Sheets, conectando qualidade de lead do CRM ao anúncio que o gerou.

**Product category:** Análise de criativos para Meta Ads / creative analytics tool. O "shelf" mais próximo é "ferramenta de análise de tráfego pago" — concorre na cabeça do gestor com Looker/Data Studio caseiro, planilhas Excel, Triple Whale, Motion (ad analytics), Atria/AdRoll.

**Product type:** SaaS B2B (single-tenant via Supabase RLS), web app.

**Business model:**
- **Standard** (atual / gratuito ou onboarding) — Packs, Manager, Insights
- **Insider** (premium, sob convite/contato) — adiciona Explorer, G.O.L.D. (rankings), Upload em massa, Meta Usage
- Acesso Insider negociado por e-mail (`1milhaocom30@gmail.com`) — modelo high-touch, não self-serve ainda. **[CONFIRMAR preço/cadência]**

---

## Target Audience

**Target companies:**
- Operações de tráfego pago em Meta Ads no Brasil (pt-BR)
- Agências de performance, infoprodutores, e-commerces de médio porte, gestores in-house
- Volume típico: contas com dezenas a centenas de anúncios ativos por período (justifica importação assíncrona e cache local)

**Decision-makers:**
- Gestor de tráfego / media buyer (usuário diário)
- Head de performance ou dono de agência (decisão de compra)
- Dono do negócio / infoprodutor (champion econômico em operações enxutas)

**Primary use case:** Decidir o que escalar e o que cortar em criativos de Meta Ads sem depender de feeling ou de planilhas que ninguém atualiza.

**Jobs to be done:**
- "Quando eu termino uma semana de campanha, preciso saber em 5 minutos qual criativo bombou para fazer mais igual."
- "Quando o cliente cobra resultado, preciso mostrar performance por período/conta/segmento sem montar relatório do zero."
- "Quando recebo leadscore do CRM/SDR, preciso conectar isso de volta ao anúncio para parar de otimizar por CPR baixo que vira lead lixo."

**Use cases:**
- Análise pós-campanha (Black Friday, lançamento, captação)
- Comparação de hooks/ângulos para próxima rodada de produção criativa
- Auditoria de qualidade de lead via leadscore enriquecido
- Briefing para time de criativos com base em padrões reais (UGC vs depoimento vs oferta)

---

## Personas

| Persona | Cares about | Challenge | Value we promise |
|---------|-------------|-----------|------------------|
| **Gestor de tráfego** (usuário) | Velocidade de leitura, clareza, métricas no mesmo padrão | Trocar de aba 20x entre Ads Manager, Sheets e CRM | Placar único, comparação lado a lado, decisão em minutos |
| **Head de performance / dono de agência** (decisor) | Previsibilidade de resultado para o cliente, escala da operação | Cada gestor analisa de um jeito diferente; relatório toma horas | Padronização do método de leitura entre toda a equipe |
| **Infoprodutor / dono do negócio** (financeiro) | ROI real, qualidade de lead, não só CPR baixo | "Tô gastando bem mas o lead não converte" | Enriquecimento via Sheets liga CPR a leadscore — vê o que dá dinheiro de verdade |
| **Time de criativos** (influencer) | Saber quais hooks/ângulos funcionaram | Briefing baseado em achismo ou no que "pareceu" performar | Ranking de criativos por Hook Rate / CTR — briefing com evidência |

---

## Problems & Pain Points

**Core problem:** Gestor de tráfego decide criativo por **feeling** porque ler dados na Meta Ads Manager + cruzar com planilha + cruzar com CRM é trabalho manual, lento e cheio de erro. Resultado: escala o anúncio errado, mata o anúncio certo, e o cliente cobra.

**Why alternatives fall short:**
- **Meta Ads Manager nativo**: colunas demais, métricas com nomes inconsistentes, sem comparação cruzada de período, sem ligação com CRM, sem ranking de criativo
- **Planilhas Excel/Sheets**: ninguém mantém, quebram em volume, exportar da Meta é tedioso, fórmula vira gambiarra, sem visualização de criativo
- **Looker Studio / Data Studio caseiro**: lento de montar, custa caro pra atualizar, ninguém da operação consegue iterar
- **Triple Whale / Motion**: caros, em inglês, focados em e-commerce US, não falam a língua do mercado brasileiro de tráfego pago e infoproduto

**What it costs them:**
- Horas por semana montando relatório que ninguém lê
- Decisão errada de escalar/cortar — orçamento desperdiçado
- Brief criativo ruim — próxima safra de anúncios também flopa
- Cliente perdido por falta de clareza no que está acontecendo

**Emotional tension:**
- "Tô fazendo direito? Ou tô só com sorte?"
- Vergonha de não ter resposta clara quando o cliente pergunta "por que esse anúncio?"
- Ansiedade de cortar um anúncio com bom CPR que talvez fosse o próximo escala
- Fadiga de planilha — a sensação de que "o trabalho real" não é otimizar, é organizar dado

---

## Competitive Landscape

**Direct (mesmo problema, mesma solução):**
- **Triple Whale, Motion, Atria** — caros, gringos, focados em e-com US, complexos. Falham porque não atendem infoproduto brasileiro nem o jeito que media buyer pt-BR pensa
- **Hyros, Madgicx** — focados em atribuição/AI bidding, não em leitura de criativo. Falham porque não resolvem a pergunta "qual hook funciona?"

**Secondary (mesmo problema, abordagem diferente):**
- **Looker Studio + planilhas customizadas** — flexível mas lento de montar e manter; falha porque cada agência reinventa a roda
- **Relatórios manuais em Sheets/Excel** — barato mas sem escala; falha em volume e em padronização

**Indirect (abordagem conflitante):**
- **"Confiar no feeling do gestor sênior"** — falha porque não escala, não treina time novo e some quando o cara sai
- **Contratar BI in-house** — caro, lento, dependente; falha porque a velocidade da decisão de criativo é diária, não trimestral

---

## Differentiation

**Key differentiators:**
- **Conceito de Pack** — período + conta + filtros como unidade de análise (não anúncio solto, não campanha solta)
- **Métricas de criativo no centro** — Hook Rate, Hold Rate, CTR, CPR, CPMQL ranqueados lado a lado
- **Enriquecimento via Google Sheets** — traz leadscore e CPR Máx do CRM/SDR de volta ao anúncio (raríssimo nos concorrentes)
- **Importação assíncrona + cache local (IndexedDB)** — aguenta volume, abre rápido
- **Português, voz direta, modelo mental de tráfego brasileiro** — não é tradução de ferramenta gringa

**How we do it differently:** Em vez de "mais um dashboard", entregamos um **placar do criativo** — a tela existe pra você comparar, entender e agir, não pra você navegar.

**Why that's better:** Decisão em minutos, padronização entre toda a equipe, brief criativo com evidência.

**Why customers choose us:** Porque pararam de aceitar "decidir por feeling" como destino — e porque ferramenta gringa é cara, complexa e não fala a língua deles.

---

## Objections

| Objection | Response |
|-----------|----------|
| "Já tenho minha planilha funcionando" | Hookify substitui o que é repetitivo (puxar dado, cruzar, formatar) e melhora o que importa (leitura, comparação, decisão). Sua planilha é trabalho. Hookify é leitura. |
| "É só mais um dashboard" | Não é. Dashboard mostra número. Hookify ranqueia criativo. Você abre e já sabe o que escalar. |
| "Preciso de Google Sheets pra usar?" | Não. É opcional. Mas vira ouro quando você quer medir qualidade de lead, não só CPR. |
| **[CONFIRMAR]** "Quanto custa?" | Standard liberado. Insider sob contato. **[Founder precisa definir narrativa de preço]** |
| **[CONFIRMAR]** "Meus dados ficam seguros?" | Supabase com RLS por usuário, tokens criptografados, nada compartilhado. **[Validar com founder o tom da resposta]** |

**Anti-persona:**
- E-commerce US-first que precisa de atribuição cross-channel (Shopify + TikTok + Meta + Klaviyo) — vão preferir Triple Whale
- Operação que roda só Google Ads ou só TikTok — Hookify é Meta-first
- Gestor que faz 1-2 anúncios por mês — não tem volume pra justificar a ferramenta
- Empresa que precisa de SOC2/ISO formal — ainda não estamos lá **[CONFIRMAR]**

---

## Switching Dynamics (JTBD Four Forces)

**Push (o que afasta da solução atual):**
- Cansaço de planilha que ninguém atualiza
- Vergonha de não ter resposta clara pro cliente
- Decisão errada que custou orçamento real
- Brief criativo flopando duas vezes seguidas

**Pull (o que atrai pro Hookify):**
- "Placar do criativo" — promessa visual concreta
- Enriquecimento via Sheets que conecta CRM ao anúncio
- Português, direto, sem enrolação
- Onboarding em minutos: conecta Meta, cria Pack, vê resultado

**Habit (o que prende no método antigo):**
- Planilha pessoal customizada que "funciona pra mim"
- Hábito de abrir Ads Manager e olhar coluna por coluna
- Receio de mudar processo no meio do mês/lançamento

**Anxiety (o que preocupa na troca):**
- "E se a importação não pegar tudo?"
- "E se eu conectar a Meta e der ruim?"
- "Vou ter que ensinar minha equipe?"
- "E se os dados não baterem com a Ads Manager?" **[CONFIRMAR — provavelmente a #1 ansiedade]**

---

## Customer Language

**[A PREENCHER COM VERBATIMS REAIS]** — esta seção precisa de frases exatas dos seus usuários atuais, capturadas em call/Whatsapp/e-mail. O que está abaixo é inferência da landing.

**How they describe the problem:**
- "Tô decidindo por feeling"
- "Minha planilha tá uma bagunça"
- "Não sei o que escalar"
- "O CPR tá bom mas o lead não converte"
- **[verbatim real]**

**How they describe us:**
- "Vira um placar"
- "Agora eu sei o que fazer"
- **[verbatim real]**

**Words to use:**
- Placar, criativo, hook, escalar, cortar, leitura, clareza, padrão, pack, enriquecer
- "Sem achismo", "sem enrolação", "vantagem injusta"
- Tom: direto, masculino-neutro, pt-BR coloquial de mercado de tráfego

**Words to avoid:**
- Jargão BI/dataviz ("KPI dashboard", "drill-down", "OLAP")
- Inglês desnecessário ("insights actionable", "data-driven decision making")
- Linguagem corporativa-fria ("solução de business intelligence")
- Vender feature em vez de resultado

**Glossary:**
| Term | Meaning |
|------|---------|
| Pack | Coleção de anúncios filtrada por conta + período + filtros — unidade de análise |
| Hook Rate | % de quem assistiu os primeiros 3s do vídeo — métrica de retenção inicial |
| Hold Rate | % de retenção geral do vídeo |
| CPR | Custo por Resultado (conversão) |
| CPMQL | Custo por Marketing Qualified Lead (vem do enriquecimento) |
| Leadscore | Pontuação de qualidade do lead vinda do CRM via Sheets |
| CPR Máx | Teto de CPR aceitável definido externamente, importado via Sheets |
| Manager | Página de análise de performance com agrupamentos |
| Explorer | Análise profunda de criativos (Insider) |
| G.O.L.D. | Rankings dos melhores anúncios (Insider) |
| Insights | Oportunidades e "gems" automáticas dos criativos |

---

## Brand Voice

**Tone:** Direto, confiante, sem cerimônia. Levemente provocador ("Pare de sentir campanha"), nunca arrogante.

**Style:** Conversacional pt-BR de mercado, frases curtas, contraste binário ("antes / depois", "feeling / dados"), uso de minúsculas em CTAs e seções secundárias para tirar formalidade.

**Personality:** Pragmático, irreverente, técnico-acessível, brasileiro, "do operador para o operador".

---

## Proof Points

**[A PREENCHER]** — landing atual não tem números, logos, depoimentos. Founder precisa puxar:

**Metrics:** **[CONFIRMAR — ex: "X horas/semana economizadas", "Y% de redução em CPR após primeira análise", "Z packs criados na primeira semana"]**

**Customers:** **[CONFIRMAR — listar 3-5 clientes Insider que toparem ser citados, idealmente nomes conhecidos no mercado de tráfego brasileiro]**

**Testimonials:**
> "[verbatim]" — [nome, cargo, empresa]

**Value themes:**

| Theme | Proof |
|-------|-------|
| Decisão rápida | **[caso real: gestor que decidiu cortar/escalar X em Y minutos]** |
| Brief criativo melhor | **[caso real: rodada de criativo que veio de ranking do Hookify]** |
| Qualidade de lead | **[caso real: troca de critério de CPR para CPMQL após enriquecimento]** |

---

## Goals

**Business goal:** **[CONFIRMAR]** — provavelmente: validar Insider como produto pago, converter Standard → Insider, crescer base de gestores de tráfego brasileiros que pagam mensalidade.

**Conversion action:**
- **TOFU/landing (`/pv`)**: clicar em "Começar agora" → `/signup`
- **In-app (Standard)**: criar primeiro Pack → ativação
- **Upgrade**: contatar `1milhaocom30@gmail.com` para virar Insider (high-touch, não self-serve)

**Current metrics:** **[CONFIRMAR — MAU, número de Packs criados, conversão signup→ativação, Standard→Insider]**

---

## Gaps que precisam de input do fundador

1. **Preço e narrativa de Insider** — quanto custa, qual a justificativa, qual o gancho
2. **Verbatims reais** — frases exatas de 3-5 clientes atuais (problema e elogio)
3. **Proof points** — números, logos, depoimentos
4. **Anti-persona detalhada** — quem você já tentou atender e não deu certo, e por quê
5. **Concorrentes que clientes citam** — o que aparece nas calls de venda
6. **Goal de negócio quantificado** — meta de Insiders/MRR/ativação para o trimestre

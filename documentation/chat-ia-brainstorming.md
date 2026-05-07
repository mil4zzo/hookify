# Chat IA dentro do Hookify — Brainstorming

> **Status:** 🟡 Rascunho em construção (brainstorming ativo)
> **Atualizado:** 2026-04-30
> **Modo:** Exploração de design — sem implementação até validação completa

Documento vivo. Captura a essência da conversa de design da feature **Chat IA dentro do Hookify**. Será atualizado conforme o brainstorming avança.

---

## 1. Visão geral

Adicionar um **chat com IA dentro do Hookify** que permite ao usuário consultar, analisar e (futuramente) agir sobre seus dados de Meta Ads usando linguagem natural. Aproveita os dados já enriquecidos no Postgres (transcrições, packs, leadscore, métricas agregadas) que são mais ricos que a Marketing API crua.

A camada de **tools** construída para o chat é desenhada para ser reutilizável — pode ser exposta como **MCP server** numa fase posterior, dando ao Hookify dois canais de IA (chat in-app + integração com Claude Desktop/Cursor/etc.) sem retrabalho.

---

## 2. Origem da ideia (contexto da conversa)

A discussão começou com o usuário perguntando se faria sentido **integrar o MCP oficial da Meta** (`mcp.facebook.com/ads`) ao Hookify. A análise mostrou que **não** — o Hookify já tem integração madura com a Marketing API e o MCP seria uma camada redundante, com risco de perder controle de quirks específicos (chunked video upload, `source_ad` para video access, `dsa_beneficiary` para BR, tracking de `meta_api_usage`).

Da rejeição surgiu o caminho inverso: **expor o Hookify como MCP server**, capitalizando nos dados enriquecidos. Dessa segunda ideia evoluiu para algo ainda mais concreto — um **chat com IA dentro do próprio Hookify** que serviria os mesmos casos de uso de forma integrada à UX existente.

---

## 3. Casos de uso alvo

Sete perguntas/comandos exemplo do usuário, cobrindo categorias distintas:

| # | Exemplo | Categoria |
|---|---|---|
| 1 | "quantos anúncios ativos na campanha @{Nome da Campanha}?" | Read estruturado simples |
| 2 | "quais anúncios com mais de 3000 impressões ou R$50 em gasto têm hook maior que 30%?" | Read estruturado com filtros |
| 3 | "analise os hooks que têm mais de 25% de retenção e me traga insights sobre o padrão de copy" | Read + análise LLM |
| 4 | "me dê 10 ideias de novos hooks baseado nos top 5 hooks" | Generativo puro |
| 5 | "quais anúncios gastaram mais de R$300 e têm CPMQL maior que R$20?" | Read estruturado com filtros |
| 6 | "pause todos os anúncios que gastaram mais de R$300 e têm CPMQL > R$20" | Write destrutivo (fora do MVP) |
| 7 | "crie a copy para 3 novos anúncios com base nos meus 5 melhores ads (top spends com CPMQL < R$25)" | Generativo + read |

### `@mentions` para entidades

Inspiração: Linear, Cursor. Permite referenciar entidades estruturadas no meio do texto.

```
@Pack 22                        → bloco estruturado <entity type="pack" id="22" .../>
@PÚBLICO-FRIO [ANIVERSÁRIO]     → resolve para campaign_id ou adset_id
@Anúncio XYZ                    → resolve para ad_id
```

Tipos no escopo: **Pack, Campaign, AdSet, Ad**.

---

## 4. Decision Log

Decisões tomadas até aqui no brainstorming. Cada uma com alternativas consideradas e justificativa.

| ID | Decisão | Alternativas | Por quê |
|---|---|---|---|
| **D01** | Não integrar MCP oficial da Meta ao Hookify | Adicionar `mcp.facebook.com/ads` como dependência | Redundante; Hookify já cobre Marketing API com tratamento de quirks específicos |
| **D02** | Construir chat in-app, com tools layer reutilizável (futuro MCP server) | (a) Só MCP server externo; (b) só chat sem reuso | Casa com UX existente do Hookify e ainda permite expor tools via MCP em v2 sem retrabalho |
| **D03** | Página dedicada `/chat` com lista de threads à esquerda (estilo Claude/ChatGPT) | Sheet lateral, widget flutuante | UX familiar, escalável para histórico longo, espaço para tool call previews |
| **D04** | MVP com threads **pessoais** (RLS por user_id). Compartilháveis em v2 | Compartilháveis desde o MVP | Reduz complexidade inicial; sharing exige tokens públicos, permissions, UI extra |
| **D05** | Loop de agente em **Python (FastAPI)** | (a) Loop em Next.js com Vercel AI SDK; (b) Híbrido | Tools precisam estar onde estão os dados (Supabase + RLS + padrões existentes); evita HTTP hop adicional |
| **D06** | **Poucas tools genéricas e poderosas** | Muitas tools específicas | Claude monta combinações que humanos não anteciparam; menos manutenção; menos tool calls por pergunta |
| **D07** | **Prompt caching obrigatório** (system + schema + tool defs) | Sem cache | Reduz custo em ~90% nas mensagens 2+; sem isso a feature é insustentável economicamente |
| **D08** | Default **Sonnet 4.6**, com switch manual de modelo | Modelo fixo único | Permite ao usuário escolher trade-off custo/qualidade; nota: trocar modelo invalida cache (cada modelo tem cache próprio) |
| **D09** | Persistir threads/mensagens com **tracking de custo por mensagem** | Conversas efêmeras | Permite usuário voltar a análises; viabiliza otimização e cobrança futura |
| **D10** | Tool dedicada `estimate_query_cost(filters)` antes de queries pesadas | Instrução em prompt apenas | Vira regra do sistema, não algo que o LLM pode "esquecer"; dispara confirmação ao usuário acima de threshold |
| **D11** | MVP **read-only**. Write actions (pause, ativar, criar) ficam para v2 | (a) Read + write com preview cards; (b) Read + write com confirmação textual | Reduz risco financeiro a zero no MVP; preview cards bem feitos demandam ~1 semana extra |
| **D12** | Chat sempre escopado a **um único `ad_account` ativo** | (b) Cross-account por padrão; (c) Híbrido com `@mention` de account | Consistente com Manager/Insights; RLS simples; resultados previsíveis; trocar account = nova thread |
| **D13** | Tool calls com UI **híbrida**: indicador minimalista durante execução + botão "Ver detalhes" expansível | (a) Totalmente transparente (cards completos); (b) Só indicador minimalista | Equilíbrio entre clareza visual e rastreabilidade; permite debug quando necessário sem poluir conversa |
| **D14** | MVP: **threads isoladas** (cada conversa começa do zero). Visão de longo prazo registrada no roadmap | (b) Resumos auto + (c) user memory | Reduz complexidade do MVP em ~2 semanas; visão clara mantida para v2 (ver §11) |
| **D15** | Custo: **modo desenvolvedor opcional** (default invisível, toggle em settings expõe custo por mensagem + total da thread) | (a) Sempre invisível; (b) Sempre discreto | Ligar pra você no MVP sem causar ansiedade de uso quando lançar para usuários reais |
| **D16** | Tool results: **híbrido com truncamento** — payload completo até 50KB, acima disso guarda só metadata + amostra (20 primeiras linhas) | (a) Payload completo; (b) Só metadata | Equilíbrio entre rastreabilidade ("Ver detalhes" mostra dados reais para a maioria) e controle de storage (não explode com análises pesadas) |
| **D17** | **Hard limits com mensagem clara** ao atingir teto: `max_turns=10` e `max_cost_per_message=$0.50` no MVP. Quando atingido, Claude para e devolve mensagem honesta com opção de "Continuar mesmo assim" ou "Refinar pergunta" | (a) Limits silenciosos; (c) Limits configuráveis por usuário | Transparência protege usuário contra custo descontrolado sem virar caixa preta; estado de "pausa aguardando confirmação" tem complexidade pequena |
| **D18** | `@mention` **apenas injeta contexto estruturado** (id, nome, metadata básica da entidade). Claude decide se filtra queries por aquela entidade ou só usa como referência | (b) Auto-escopo: toda query da mensagem é filtrada pela entidade mencionada | Mais flexível; preserva poder de fazer perguntas como "compare @Pack 22 com @Pack 17" sem o sistema impor escopo errado |
| **D19** | **Título de thread gerado automaticamente por Haiku 4.5** após 1ª resposta. Usuário pode editar livremente depois | (a) Sempre manual; (b) Só auto, sem edição | Padrão familiar de Claude/ChatGPT; baixo custo (Haiku); usuário não fica obrigado a pensar em título antes de começar |
| **D20** | **Agent loop com SDK Anthropic puro** (async, manual). Sem framework. | LangChain/LangGraph, PydanticAI | Loop é ~100 linhas; SDK já tem tool use + caching + streaming nativos; frameworks escondem detalhes ruins para otimização de custo |
| **D21** | **SSE custom** (FastAPI `StreamingResponse` + hook React próprio) | Vercel AI SDK adaptado, WebSocket | SSE é nativo do navegador; cross-language perfeito; Vercel AI SDK exigiria implementar protocolo deles em Python |
| **D22** | **Tool registry com decorator + Pydantic** para schema | (a) Lista de dicts monolítica; (b) Plugin pattern | ~40 linhas de decorator que geram schema do Pydantic, registram tool, e adicionam middleware (audit, cost, RLS); paga desde dia 1 com 4 tools |
| **D23** | **Resolução híbrida de `@mentions`**: frontend embeda `(id, name, type)` no submit; Claude chama `resolve_entity` se precisar de mais detalhes | (a) Eager (puxa tudo no submit); (b) Lazy puro (Claude sempre chama resolve) | Sweet spot custo/latência; UX imediata + economia de tokens |

---

## 5. Arquitetura proposta (rascunho)

### Backend (FastAPI)

- Novo módulo `backend/app/chat/` com:
  - **Loop de agente** usando `anthropic` SDK Python (tool use, prompt caching, streaming nativos)
  - **Tools layer** — funções Python que executam queries no Supabase com o JWT do usuário (RLS aplica)
  - **Endpoint** `POST /chat/messages` que faz streaming via SSE
- Tools previstas no MVP (4 genéricas):
  - `query_ads(filters)` — filtra ads por status, account, campaign, adset, pack, etc.
  - `query_metrics(filters, aggregations, date_range)` — agregações sobre `ad_metrics` com joins
  - `get_transcriptions(ad_ids)` — busca transcrições para análise de copy
  - `estimate_query_cost(filters)` — retorna estimativa de linhas/tokens antes de read pesado
  - `resolve_entity(type, name_or_id)` — para `@mentions`

### Frontend (Next.js 15)

- Nova rota `/chat` com layout próprio:
  - Sidebar esquerda: lista de threads, busca, botão "Nova conversa"
  - Área principal: mensagens streamadas, input com `@mention` autocomplete (Tiptap)
  - Indicação visual de tool calls em andamento ("Consultando métricas...")
- Streaming consumido via SSE custom (sem Vercel AI SDK no MVP — agent loop está em Python; AI SDK é nice-to-have, não fundação)

### Persistência (Supabase)

```sql
-- Schema mínimo (rascunho)
chat_threads (
  id uuid PK, user_id uuid FK, title text, model text,
  created_at, updated_at
)

chat_messages (
  id uuid PK, thread_id uuid FK, role text,
  content jsonb,           -- texto + tool_calls + tool_results
  tokens_input int, tokens_output int, tokens_cached int,
  cost_cents int,
  model text,
  created_at
)
```

RLS: `user_id = auth.uid()` em ambas.

### Estratégias de eficiência de tokens

Por ordem de impacto:

1. **Prompt caching agressivo** — system + schema + tool defs (~5-10K tokens) em cache
2. **Tools que retornam dados ricos** — joins prontos > chamadas separadas
3. **Filtros obrigatórios** — `query_ads` sem `adaccount_id` ou `date_range` recusa
4. **Tool de estimativa** — `estimate_query_cost` antes de read pesado
5. **Limite hard de turns** — N tool calls por mensagem (evita loops runaway)
6. **Roteamento por complexidade** (v2) — Haiku decide se basta ele responder; escala pra Sonnet quando necessário

---

## 6. Plano de sprints (rascunho — não confirmado)

| Sprint | Objetivo | Entrega |
|---|---|---|
| **1** | Esqueleto end-to-end | Tabelas + endpoint `POST /chat/messages` sem tools (só Claude direto) + página `/chat` com streaming + tracking de custo |
| **2** | Tools v1 read-only | 4 tools (`query_ads`, `query_metrics`, `get_transcriptions`, `estimate_query_cost`) + loop de tool use no FastAPI |
| **3** | `@mentions` + UX polish | Tiptap mention extension, autocomplete, resolve_entity tool, indicação visual de tool calls |
| **4** | Tools generativas | "Ideias de hooks", "criar copy baseado em top performers" — usa transcrições e métricas como contexto |

Write tools (pause, ativar) ficam em v2 explícito — preview cards + audit log + UX de confirmação.

---

## 7. Perguntas em aberto (a resolver no brainstorming)

Próximas decisões a travar antes de sair de modo brainstorming:

- [ ] Quais tipos de entidades exatamente para `@mention` (Pack, Campaign, AdSet, Ad — todos no MVP?)
- [x] ~~Comportamento multi-account~~ → **D12: escopo único por thread**
- [x] ~~UI de custo~~ → **D15: modo desenvolvedor opcional (toggle em settings)**
- [x] ~~Visibilidade de tool calls~~ → **D13: indicador minimalista + botão "Ver detalhes"**
- [x] ~~Memória entre threads~~ → **D14: isoladas no MVP, B+C planejado para v2 (ver §11)**
- [x] ~~Failure modes~~ → **confirmado: defaults documentados em §8 (assumptions)**
- [x] ~~Persistência de tool results~~ → **D16: híbrido com truncamento em 50KB**
- [x] ~~Limite de turns~~ → **D17: max_turns=10 + max_cost=$0.50/msg com mensagem clara**

### Requisitos não-funcionais

- [x] **Performance** → TTFB <2s; chunks streamados conforme Anthropic entrega
- [x] **Escala MVP** → 1 usuário (dogfood), sem rate limit por enquanto
- [x] **Escala v2** → cap 50 msgs/dia/usuário, ajustável por plano
- [x] **Segurança** → JWT Supabase existente + RLS em todas tools + audit log `(user_id, thread_id, tool_name, params_hash, timestamp)`
- [x] **Privacy** → conteúdo não vai para training (Anthropic workspace settings)
- [x] **Confiabilidade** → retry backoff 3x em 429/5xx; sem provider redundancy no MVP
- [x] **Observabilidade** → por mensagem: `model, tokens_input/output/cached, cost_cents, duration_ms, num_tool_calls, status`. Sem dashboard no MVP — queries SQL ad-hoc.
- [x] **Manutenção** → código no repo Hookify principal; tools versionadas com schema

---

## 8. Premissas confirmadas

- ✅ Modelo de cobrança decidido depois (plano premium ou créditos recarregáveis)
- ✅ MVP é primeiro para uso interno do próprio dono, mas com UI próxima da versão final
- ✅ Eficiência de tokens é prioridade desde o MVP, independente do modelo de cobrança
- ✅ Anthropic API estará disponível e estável (sem provider redundancy no MVP)
- ✅ **Privacy via API comercial Anthropic**: dados de cliente não são usados para treinamento por contrato — comportamento padrão da API, sem configuração necessária. Cuidado a manter: nunca testar prompts com dados reais via `claude.ai` (UI consumer tem termos diferentes).
- ✅ Prompt caching reduz custo em ~90% a partir da 2ª mensagem da thread
- ✅ Tiptap como editor de input com mention extension
- ✅ RLS do Supabase como camada de segurança primária das tools
- ✅ `max_turns=10` e `max_cost=$0.50` cobrem 99% das conversas reais sem disparar

---

## 9. Riscos identificados

| Risco | Mitigação |
|---|---|
| Custo descontrolado por usuário | Hard cap de turns + estimate_query_cost + cap mensal por user |
| LLM alucina IDs e age sobre entidades erradas | (Não aplica no MVP read-only) — em v2: preview cards obrigatórios |
| Análise de transcrições estoura contexto | Tool de estimativa força usuário a escolher amostragem |
| Switch de modelo invalida cache | Documentar comportamento; eventualmente isolar cache por modelo na thread |
| Vendor lock com Anthropic | Aceito no MVP; abstração para multi-provider só se virar dor |

---

## 10. Próximos passos

1. Continuar brainstorming — resolver perguntas em aberto da seção 7 (próxima pergunta a vir)
2. Quando atingir Understanding Lock, gerar design final em documento separado (`/documentation/chat-ia-design.md`)
3. Plano de implementação granular (Sprint 1 detalhado) só depois disso

---

## 11. Visão de longo prazo (pós-MVP)

Ideias e direções claras já desenhadas, mas adiadas do MVP para reduzir escopo. Priorizadas por valor para o usuário.

### 11.1 Memória de longo prazo (continuidade entre conversas)

Combina dois mecanismos complementares:

**(a) Resumos automáticos de conversas** (extensão da Opção B descartada do MVP):

- Ao final de cada thread (ou periodicamente), um job dispara um LLM mais barato (Haiku 4.5) para gerar um resumo conciso da conversa: insights descobertos, ads/packs/campanhas analisadas, conclusões.
- Resumo persiste em nova tabela `thread_summaries`.
- Ao iniciar uma nova thread, o sistema injeta no system prompt os resumos das **últimas N threads** (não o conteúdo completo das conversas).
- Impacto: Claude "lembra" do que o usuário tem investigado nas últimas semanas sem custar fortunas em tokens.

**(b) Memória do usuário (user memory)** (extensão da Opção C descartada do MVP):

- Tabela nova `user_memories` com entries de texto livre.
- Duas formas de criação:
  - **Manual**: usuário escreve em `/chat/configuracoes` ("Sempre considere CPMQL como métrica principal", "Meus packs estratégicos são X, Y, Z")
  - **Automática via tool**: Claude tem acesso a tool `remember_this(text)` que cria entry quando o usuário pede ("lembre que prefiro analisar por hook rate") ou quando o LLM identifica algo relevante para o futuro.
- Memórias entram no system prompt de toda nova thread.
- UI dedicada para o usuário revisar, editar e deletar memórias (incluindo as criadas pelo LLM).
- Inspiração: Claude Projects + custom instructions + memory feature.

**Estimativa**: ~2 semanas adicionais de desenvolvimento bem feito.

### 11.2 Write actions (pause/ativar/criar)

Já planejado em D11. Requer:
- Preview cards visuais ("Vou pausar 17 ads totalizando R$5.420 de spend. Confirmar?")
- Audit log persistente de todas as ações executadas
- Tools com pattern de duas etapas: `propose_action` retorna `action_token` → `execute_action(token)` finaliza
- UX de feedback ("3 de 17 ads pausados. 14 aguardando rate limit.")

### 11.3 Threads compartilháveis

Já planejado em D04. Requer:
- Coluna `share_token` em `chat_threads` (UUID público)
- Endpoint público `GET /chat/shared/{token}` (read-only, sem auth)
- Página `/chat/shared/{token}` que renderiza a conversa em modo read-only
- UI para gerar/revogar links de compartilhamento
- Consideração: vazamento de dados sensíveis (ad_account ids, valores de spend) — pode precisar de modo "anonimizado" antes de compartilhar.

### 11.4 Hookify como MCP server

A camada de tools do chat (D02) é desenhada para ser facilmente exposta como MCP server. Quando o uso interno validar o produto, expor publicamente permite que usuários conectem o Hookify a Claude Desktop, Cursor, ChatGPT, etc.

Requer:
- Endpoint `/mcp` que implementa o protocolo MCP (HTTP transport)
- OAuth flow ou bearer tokens gerados nas settings do usuário
- Documentação de instalação para clients populares
- Mesmas tools, mesmo loop, transport diferente

### 11.5 Roteamento por modelo (cost optimization)

Adicionar pattern de "router model": Haiku 4.5 recebe a pergunta primeiro e decide se basta ele responder ou se precisa escalar para Sonnet 4.6. Reduz custo médio significativamente para perguntas simples ("quantos ads ativos hoje?").

### 11.6 Modo "análise profunda"

Botão dedicado na UI que dispara uma análise mais cara mas mais completa: usa Opus 4.7, processa transcrições completas, produz relatório longo com seções, gráficos textuais, recomendações priorizadas. Cobrado como ação premium (ex: 5 créditos por análise).

---

> **Lembrete:** este documento é atualizado ao longo do brainstorming. Quando o design for finalizado, gerar versão definitiva separada e mover este para `archive/`.

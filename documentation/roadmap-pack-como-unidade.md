# Roadmap — O pack como unidade de configuração e colaboração

> **Documento vivo.** Atualize o status dos projetos conforme forem concluídos.
> Serve para reconstruir contexto entre sessões/chats diferentes sem reler o histórico.
>
> Última atualização: 2026-08-18
>
> **Concluído:** P2 · **P2.1 (julgamento inerente ao pack — revoga a herança do P2)** ·
> P3.1 · P3.2 (RPCs multi-dono + sinal de conflito).
> **Próximo passo:** **deploy em andamento** (o banco está 10 migrations à frente
> do código; a `111` só depois dele e depois de passada a janela de rollback).
> **O compartilhamento está EXPOSTO e o MQL acompanha (2026-08-19)**: dono
> convida, convidado vê/analisa/atualiza — e o refresh de convidado agora roda
> o sync do Leadscore com a credencial do dono (P3.3b-planilha). Próximo:
> **testar com o time real**; depois P3.3b-resto e P3.5 (log de ações).
> ⚠ A conexão Google do dono 8363e117 está com refresh token revogado —
> reconectar antes do teste.
> Nenhuma decisão em aberto bloqueia o P3 — as pendências são todas do P1, adiado.

---

## Tese

Hoje o Hookify trata `user_id` como dono de **tudo**: do dado, da configuração de
julgamento e da identidade de quem pede. Isso gera três problemas encadeados:

1. Times inteiros carregam o mesmo pack, multiplicando linhas no banco e obrigando
   cada pessoa a atualizar por conta própria.
2. O critério de julgamento (validação, MQL, CPR alvo) é global do usuário, mas na
   prática varia por campanha/funil — que é o que o pack representa.
3. Dados que só existem em planilha (etapas do funil comercial) não têm como entrar
   no app, porque a integração atual só sabe importar leadscore.

Este super-projeto move a unidade de **configuração** e de **colaboração** do
usuário para o **pack**.

---

## Ordem e dependências

```
P2 — Configuração de julgamento por pack
      │  sem isso, dois membros veem vereditos diferentes no mesmo pack
      ▼
P3 — Compartilhamento de packs entre usuários
      ·
P1 — Planilha flexível (multi-coluna)   ← ADIADO, ver abaixo
```

**Por que P2 antes de P3:** critério por usuário + pack compartilhado = o gestor e o
copywriter abrem o mesmo pack e veem vereditos diferentes. O pack deixa de ser
linguagem comum do time, que é o objetivo inteiro do P3.

**P2 se sustenta sozinho:** `mql_leadscore_min` é vinculado à planilha, que é do pack.
Cada pack tem escala de leadscore diferente. Útil hoje, com ou sem compartilhamento.

**Por que P1 saiu da frente (revisão de 2026-08-17):** a primeira versão deste
documento afirmava que P1.1 era pré-requisito de P2 porque "os dois escrevem no mesmo
container de config do pack". **Isso estava errado.** P2 move *limiares e alvos*
(escalares); P1 mapeia *colunas de planilha para métricas*. São ambos config do pack,
mas um não depende do outro — o acoplamento é fraco. O único cuidado é deixar o
container do P2 extensível para acomodar mapeamento de colunas depois, evitando
migração quando o P1 voltar.

---

## P1 — Integração de planilhas flexível

**Status:** `ADIADO` — retomar depois de P3, com conversa própria sobre atribuição de data

### Por que foi adiado

Eventos de funil comercial (reunião agendada, executada, fechada) acontecem **dias
depois** da captura do lead. Leadscore não tem esse problema: é calculado no cadastro,
então a data da planilha é a data de captura e a atribuição é trivial.

A parte **mecânica** da retroatividade já está resolvida: o sync lê a planilha inteira
toda vez, sem range incremental, e grava por `{date}-{ad_id}`
(`ad_metrics_sheet_importer.py:440`). Uma reunião marcada hoje atualiza a linha de três
semanas atrás no próximo sync, sem estrutura nova.

O que falta é **semântica**, e é decisão de produto, não de banco:

> Ao filtrar um período, o usuário quer os eventos **daquele período** ou os eventos
> **dos leads capturados naquele período**?

Guardar só a contagem em `ad_metrics(ad_id, date)` **não escapa dessa decisão — ela a
faz por omissão**, pendurando a contagem na data de captura (coorte). Esse modelo é o
correto para julgar anúncio, mas traz duas consequências visíveis no primeiro dia:

- Dias recentes ficam estruturalmente ruins e melhoram sozinhos (os leads de ontem
  ainda não tiveram tempo de agendar). "Custo por reunião" dos últimos dias não
  significa nada.
- Fica impossível responder "quantas reuniões aconteceram esta semana" — só "quantas
  reuniões vieram dos leads capturados esta semana".

Ambas defensáveis; o risco é a escolha ser implícita e a UI não dizer qual está
mostrando. Número com significado errado é pior que número ausente, porque as pessoas
criam hábito em cima dele.

Permitir que o usuário vincule **múltiplas colunas** da planilha, não só leadscore.
Caso de uso: um lead que veio de um anúncio do Meta e avançou no funil comercial
(reunião agendada / no-show / fechada). São etapas que o Meta não conhece e que hoje
ficam fora do Hookify.

### Sub-fases

| # | Escopo | Status |
|---|---|---|
| P1.1 | Container de configuração por pack (onde vive o mapeamento de colunas) | `Não iniciado` |
| P1.2 | Armazenamento + importação de colunas arbitrárias | `Não iniciado` |
| P1.3 | Exposição como métrica (Manager, analytics, registry de colunas) | `Não iniciado` |

Só **P1.1 e P1.2** são pré-requisito de P3. P1.3 é independente do compartilhamento —
dá para intercalar P1.1 → P1.2 → P2 → P3 → P1.3 se o compartilhamento for prioridade.

### Armazenamento decidido (simplificado)

Decisão: **só contagens**, sem detalhe por lead. Custo por reunião marcada/executada
sai de contagem + spend, o que cobre ~90% dos casos.

1. **`ad_metrics.custom_metrics jsonb`** — contadores agregados por `(ad_id, date)`.
   É o que o read path quente lê: extração por linha, sem join, sem unnest.
   jsonb (e não colunas reais) porque as colunas são nomeadas pelo usuário.
2. **`leadscore_values` fica como está.** Funciona, é o caminho mais sensível do app,
   e reescrevê-lo não compra nada.

**Descartado por ora — mas é o caminho conhecido se voltar a ser necessário:** uma
tabela lateral `ad_lead_events` (uma linha por lead) seria obrigatória para cruzar
limiar dinâmico com atributo por lead — ex.: "MQL que agendou reunião". Sem ela, esse
cruzamento não existe. Se um dia for preciso, é essa a estrutura.

### Pontos de atenção

- `ad_metrics.leadscore_values numeric[]` guarda **um valor por linha da planilha**,
  sem identidade do lead (`ad_metrics_sheet_importer.py:288`). O array existe porque o
  limiar de MQL é aplicado **na leitura**, dentro da RPC
  (`schema.sql:553`, `1234`, `1926`, `3599`) — guardar só a contagem faria mudar o
  limiar reescrever o passado.
- Além das 4 RPCs, o leadscore aparece em ~10 pontos de `backend/app/routes/analytics.py`.
- Nova métrica-coluna no Manager tem checklist próprio — ver memória
  `manager_metric_column_pipeline`.
- P1.1 é pré-requisito de P2: os dois escrevem no mesmo container de config por pack.
- **Sem chave estável de lead**, a lateral conta bem mas não acompanha um lead ao
  longo do tempo. E no dia em que alguém mapear uma coluna de e-mail, entra PII no
  banco — decisão para quando chegar lá.

---

## P2 — Configuração de julgamento por pack

**Status:** `Concluído` — 2026-08-17 (migration `101_pack_judgment_config.sql`)
> **⚠ Leia o P2.1 antes desta seção.** A herança descrita abaixo foi **revogada**
> em 2026-08-18. O que continua valendo: os campos existirem no pack, a regra de
> conflito em seleção múltipla e a limpeza da cadeia morta. O que **não** vale
> mais: `user_preferences` como padrão, os toggles de herança no dialog, e o
> "onde a edição vai parar" — hoje a edição vai sempre para o pack.

Mover a configuração de julgamento de `user_preferences` para o pack, com
**herança e override**: o `user_preferences` continua sendo o padrão, o pack pode
sobrescrever. Quem nunca sobrescrever não percebe mudança — regressão zero no dia
da migração.

### O que foi entregue

**Banco** — `packs` ganhou `mql_leadscore_min numeric`, `target_cpr jsonb` e
`diagnostic_cost_metric text`, todas nulas (NULL = herda), com CHECK constraints.
Nova função `public.resolve_pack_mql_leadscore_min(uuid, uuid[])`, revogada de
`anon`/`authenticated` (helper interno, não exposto ao PostgREST).

**A mesma regra existe em três lugares** e os três foram testados com os mesmos
casos até baterem:

| Implementação | Onde | Serve |
|---|---|---|
| SQL | `resolve_pack_mql_leadscore_min` | `fetch_manager_rankings_series_v2` |
| Python | `_resolve_mql_leadscore_min` (`routes/analytics.py`) | 8 endpoints de drill/detalhe |
| TypeScript | `resolveJudgment` (`lib/judgment/`) | contagem de MQL, G.O.L.D., plano, diagnóstico |

Se divergirem, o número da tabela passa a diferir do número do gráfico — qualquer
mexida na regra tem que passar pelos três.

**Descoberta que reduziu o escopo:** só `fetch_manager_rankings_series_v2` lia
`mql_leadscore_min` em SQL no caminho vivo. As três
`fetch_manager_analytics_aggregated_base_v047/48/49` também liam, mas a entrada
`fetch_manager_analytics_aggregated` não era chamada por nenhum lugar do backend
nem do frontend — cadeia inteiramente órfã. Verificado contra o banco remoto, não
contra `schema.sql`.

**Limpeza (migration `102_drop_dead_manager_analytics_aggregated_rpcs.sql`):** a
cadeia foi dropada. Código morto carregando a regra de MQL *anterior* à 101 é pior
que código morto neutro — some antes que alguém ressuscite por engano. A migration
segue a forma da 095: guarda de pré-condição (nenhuma função/view cita o nome —
corpo de plpgsql não é rastreado como dependência pelo Postgres, então a checagem
é a única rede), drops, e pós-condição verificando que as 6 funções vivas do
read-path continuam de pé. Saíram junto os ramos de desempacotamento já
inalcançáveis em `_normalize_rankings_rpc_response`.

**Frontend** — ponto único de resolução em `usePackJudgment()`. `useMqlLeadscore()`
passou a devolver o valor **efetivo**, então os ~10 consumidores de julgamento
(Manager, Insights, G.O.L.D., Plano, AdDetails) foram corrigidos sem serem tocados.

**Onde a edição vai parar** (`useJudgmentEditor`): edita-se **o que está em vigor**.
Se o valor efetivo veio do override de um pack e há exatamente um pack selecionado,
grava no pack; se veio do padrão da conta, grava na conta; se vários packs
compartilham o mesmo override, a edição é travada e aponta para a configuração do
pack. Sem isso, o usuário mexeria num controle mostrando o valor do pack e gravaria
silenciosamente na conta — o número na tela não mudaria e o padrão global seria
corrompido de quebra.

**UI** — `PackJudgmentDialog` (Packs → menu do pack → "Critérios de julgamento"),
com toggle de herança por campo. O painel de MQL no Topbar passou a editar
explicitamente o **padrão da conta** e avisa quando os packs selecionados usam
critério próprio ou divergem entre si.

### Pendência conhecida

`validation_criteria` continua em `user_preferences` por decisão — mas ele ainda é
persistido **em localStorage** além do banco (`hookify-validation-criteria`), o que
é anterior a este projeto e não foi mexido.

### Campos e dependência do pack

| Campo | Hoje | Dependência do pack |
|---|---|---|
| `mql_leadscore_min` | `user_preferences` | **Forte** — vem da planilha, que é do pack |
| `target_cpr` | `user_preferences` (jsonb `Record<action_type, number>`) | **Forte** — indexado por action_type, que vem de `packs.conversion_types` |
| `diagnostic_cost_metric` | `user_preferences` (`'cpr'` \| `'cpmql'`) | **Média** — se `cpmql`, depende de `mql_leadscore_min` |
| `validation_criteria` | `user_preferences` (jsonb) | **Fraca** — é mais preferência do analista ("o que considero validado") |

### Regra de conflito em seleção múltipla

Se os packs selecionados resolvem para o mesmo critério efetivo → usa.
Se divergem → avisa explicitamente e cai no padrão do usuário.

Precedente parcial: `packs.conversion_types` já é metadado materializado por pack.
A diferença é que aquilo é *lista de opções* (união natural), enquanto critério é
*veredito* (conflito real). Por isso a regra acima precisa existir.

### Distribuição do esforço

- `validation_criteria`: ~30 arquivos de frontend consumindo (G.O.L.D., insights,
  plano, manager, export, onboarding) — mas todos derivam de **um** ponto de
  resolução (`useUserPreferences` / store). O trabalho é mover o ponto, não os 30.
- `mql_leadscore_min`: backend pesado — embutido no SQL de 4 RPCs.

---

## P2.1 — Julgamento inerente ao pack (revoga a herança do P2)

**Status:** `Concluído` — 2026-08-18 (migration `110_pack_owned_judgment.sql` aplicada;
`111` — os DROPs — **pendente de deploy**)

O P2 tratou os quatro campos de julgamento como iguais porque estavam na mesma
tabela. Não são. A linha que os separa:

| Campo | Natureza | Onde vive agora |
|---|---|---|
| `mql_leadscore_min` | **parâmetro do dado** — descreve a escala da planilha | pack |
| `target_cpr` | **meta de negócio** — indexado por `conversion_types`, que é do pack | pack |
| `diagnostic_cost_metric` | preferência de visualização | usuário |
| `validation_criteria` | tolerância a risco do analista | usuário |

Os dois primeiros respondem *"o que este número significa"*; os dois últimos,
*"como eu quero olhar"*. **A herança acabou**: cada campo existe em exatamente um
lugar, e a pergunta "o default é de quem?" — que produziu o bug corrigido pela 108
— deixa de ser formulável.

### NULL = não definido, e não zero

Corte indefinido (pack legado) ou não-único (packs selecionados discordam) → MQL e
CPMQL ficam **indisponíveis**. Zero afirmaria "todo lead é MQL", derrubando o CPMQL
para um número excelente e falso, na direção que ninguém investiga.

Foi encontrado **um vazamento real** desse tipo em `series_v2`: `cpmql` e `mqls`
escapavam por acaso (o guard `mql_count > 0` os levava a `null`), mas `mql_rate`
dividia direto — `0/N = 0`, publicado como "0% dos leads são qualificados". A 110
fecha isso. `leadscore_avg` continua disponível: a média não depende do corte.

O mesmo padrão foi removido do frontend em quatro lugares que só existiam porque
`undefined` antes significava apenas "contexto ausente": `context.mqlLeadscoreMin ?? 0`
(6x em `calculations.ts`), `mqlLeadscoreMin: number = 0` (defaults de `gemsTopMetrics`
e `metricRankings`), `Number(detailModel?.cpmql ?? 0)` e `mqlLeadscoreMin || 0`.

### Backfill

20 packs receberam o valor vigente do dono; 6 receberam a meta. Os 3 packs do único
dono com default `0` ficaram **NULL** — zero nunca foi escolha dele, e gravá-lo como
se fosse perpetuaria "todo lead é MQL" com cara de decisão.

### Onde se define

No **último passo da integração de planilha**, junto das amostras da coluna de
leadscore — o único momento em que a escala é visível. Campo obrigatório para
importar. Depois, em Packs → configuração, onde escrevem **dono e editor**
(primeiro ponto em que o papel `editor` vale de verdade; `viewer` recebe 403).

O painel de Leadscore no Topbar virou **somente-leitura**: mostra o que está em
vigor para a seleção atual e aponta para o pack.

### Pendência bloqueada por deploy

`user_preferences.mql_leadscore_min` e `target_cpr`, mais `packs.diagnostic_cost_metric`,
**continuam existindo e ignorados**. O código em produção ainda lê os dois primeiros;
dropar antes do deploy derruba a produção. Os DROPs vão na `111`, depois do deploy.

---

## P3 — Compartilhamento de packs entre usuários

**Status:** `Não iniciado`

Um usuário compartilha um pack com outro usuário do Hookify. O dado **não é
copiado**: permanece no silo do dono e o convidado lê de lá.

### Por que é viável a custo baixo

1. Toda RPC já recebe `p_user_id` como **parâmetro explícito** e é `SECURITY DEFINER`.
   A partição já é variável, não implícito.
2. Existe **um único checkpoint de autorização** por RPC:
   `if auth.uid() is distinct from p_user_id then raise 'Forbidden'`.
3. Toda linha já é fisicamente particionada por `user_id`
   (`ads` PK `(ad_id,user_id)`, `ad_metrics` PK `(id,user_id)`,
   `ad_metric_pack_map` PK `(user_id,pack_id,ad_id,metric_date)`,
   `parent_entities`, Storage em `thumbs/{user_id}/...`). Nada precisa se mover.

### Desenho decidido: RPC deriva o dono dos pack_ids

A RPC **para de receber `p_user_id`** e passa a derivar o conjunto de donos a partir
de `p_pack_ids`. Como pack id é UUID globalmente único, a função:

1. resolve quais packs pedidos o chamador acessa (próprio **ou** com grant ativo);
2. se algum pack pedido não for acessível → `Forbidden`;
3. filtra `am.user_id = ANY(donos)`, com o join no map carregando `m.user_id = am.user_id`.

**Uma query, uma agregação, uma média.** Packs de donos diferentes podem conviver na
mesma seleção — o pack compartilhado aparece como um pack normal na conta do convidado.

Índices aguentam: os relevantes começam por `user_id`
(`ad_metrics_user_date_idx`, `ad_metrics_user_name_date_ad_idx`,
`ad_metric_pack_map_user_pack_date_ad_idx`). `= ANY(array)` com poucos valores vira
N index scans, não varredura.

Efeito colateral positivo: fica **mais seguro que hoje** — o cliente para de enviar
um `user_id`, então não há id para forjar.

### P3.2 — o que já foi feito (migration `104_manager_multi_owner_read_path.sql`)

A RPC principal do Manager (`fetch_manager_rankings_core_v2`) passou a derivar os
**donos** do dado a partir de `p_pack_ids`. Packs de donos diferentes convivem numa
única agregação — uma query, uma média.

**Desvio deliberado do roadmap: a assinatura foi PRESERVADA.** O plano previa remover
`p_user_id`. Não foi feito porque mudar a lista de parâmetros cria ambiguidade de
overload no PostgREST — exatamente a armadilha que a migration 095 teve de limpar.
`p_user_id` passou a significar o **ator** e segue validado contra `auth.uid()`. O
argumento do roadmap ("não há id para forjar") já era atendido por esse guard, então
a remoção custaria risco real por ganho cosmético.

#### O desenho ingênuo teria destruído o Manager

Medido com `EXPLAIN ANALYZE` sobre dados reais (90 dias):

| Variante | Tempo |
|---|---|
| Hoje: um dono, igualdade escalar | 67 ms |
| **`am.user_id = any(v_owners)`** — o que o roadmap sugeria | **4010 ms** (60x pior) |
| Dirigido pelos donos → map → metrics | **11 ms** (6x melhor que hoje) |
| Dois silos, 22.9k linhas | 197 ms |

`= ANY(array)` faz o planner perder `ad_metric_pack_map_user_pack_date_ad_idx` e cair
no PK varrendo todos os `user_id`. Invertendo a direção — dirigir a partir dos donos
resolvidos — o nested loop liga as 4 colunas do índice composto. **A mudança de
correção também acelera o caminho de dono único que já existia.**

O ramo legado (`p_pack_ids` nulo, sem map para dirigir) fica num `UNION ALL` cujo ramo
morto o planner poda por completo — verificado no plano.

#### Dedup cross-silo

`distinct on (ad_id, date)`, vencendo o silo do **dono do pack compartilhado**
(desempate por uuid). Custo zero: o Postgres já eliminava `user_id` da chave de
ordenação por ser constante. Testado com sobreposição sintética — soma ingênua daria
8822.85, o resultado é 3822.90.

#### Como foi validado

`v093` foi **mantida** e a troca do wrapper é de uma linha, então reverter é trivial.
Antes de trocar, diferencial `v104` vs `v093`: **idêntico em 7 combinações**
(ad_name/ad_id/adset_id/campaign_id, 30d e 90d, ramo legado sem packs, com
action_type). Depois da troca, o wrapper vivo também bate com a v093.

Capacidade nova verificada: pack sem grant → `Forbidden`; pack compartilhado legível;
dois silos numa agregação só; sem dupla contagem.


#### Achados de segurança e corretude desta rodada

**Revisão adversarial independente (2026-08-19, subagent):** varreu `ece89c1..HEAD`
atrás de fail-open de tenancy nos caminhos service-role — **nenhum encontrado**;
todos os pontos onde a costura falha, falham fechado. 5 achados médios e 6 baixos
corrigidos no commit `16b63e5` (destaques: DELETE de pack convertia 404/403 do
gate em 500; coluna MQLs do Manager ainda mostrava 0 com corte indefinido; poll
de convidado concluindo refresh do dono pulava a cadeia de planilha em silêncio
— agora pula explícito com rastro `sheet_chain_skipped` no payload). Adiados com
registro: circuit breaker de token compartilhado dono/convidado (auto-cura 60s),
guard 409 atrás da flag, re-attach/cancel de job para convidado (P3.3b/P3.7).


**Vazamento de dados (migration 106).** `fetch_ad_metrics_for_analytics` era
`SECURITY DEFINER`, recebia `p_user_id` e estava concedida a `authenticated`
**sem guard de `auth.uid()`**. Explorado antes de corrigir: um usuário leu 58.001
linhas de métricas de outro. Corrigido com guard **e** `REVOKE` (defesa em
profundidade), e a função depois dropada (migration 109) por ser código morto —
o único caller era um helper Python sem chamadores.

**Costura P2↔P3 quebrada (migration 108).** `resolve_pack_mql_leadscore_min`
filtrava `p.user_id = p_user_id`. Num pack **compartilhado**, `packs.user_id` é o
dono — então o convidado nunca encontrava o pack e caía no próprio default.
Verificado: pack com override 40, dono via 40, convidado via 80. Os dois julgavam
o mesmo pack por critérios diferentes, que é exatamente o que a P2 existia para
impedir. Regra corrigida: **override do pack, senão o default do DONO**. Se fosse
o default do ator, o furo apenas mudaria de lugar.

**Sinal de conflito olha o dono, não a duplicidade (migration 105).** Dois packs
do mesmo usuário podem compartilhar anúncios — existe no banco um par com 5.639
linhas em comum. Se o sinal fosse "linha duplicada → avisa", o alerta dispararia
para quem nunca compartilhou nada e nasceria como ruído.

**O que NÃO foi dropado:** `core_v2_base_v093` e `_v104` seguem no banco. São o
caminho de rollback de mudanças aplicadas nesta mesma rodada, e trocar o wrapper
de volta é uma linha. Limpeza depois da v105 rodar em produção.

#### Falta na P3.2

Os 8 endpoints de drill em `analytics.py`, que ainda filtram `user_id = me` no
Python. `series_v2` e `retention_v2` foram convertidas (migration 107, 11 casos
diferenciais idênticos). `fetch_ad_metrics_for_analytics` não foi convertida de
propósito — era código morto e saiu.

### Sub-fases

| # | Escopo | Status |
|---|---|---|
| P2.1 | Julgamento inerente ao pack (revoga a herança) | `Concluído` — 2026-08-18 (migration 110; DROPs na 111, pós-deploy) |
| P3.1 | Tabela de grants (`pack_shares`) + resolvedor de dono | `Concluído` — 2026-08-18 |
| P3.2 | Guard das RPCs derivando dono de `p_pack_ids` + dedup cross-silo | `Concluído` — 2026-08-18 (migrations 104–109) |
| P3.2b | Drill multi-dono: leitura de `ad_metrics` centralizada em `fetch_pack_metrics_rows` (supabase_repo) | `Concluído` — 2026-08-18. Os donos são derivados de `resolve_pack_access` DENTRO do helper (sem parâmetro injetável); dedup cross-silo com a mesma regra da RPC; fallback de `lpv` num lugar só. Um dos 8 endpoints (campaign-children) já delegava à RPC — o corpo Python morto (~240 linhas) foi removido. Restam atuais-silo-do-ator, por serem cosméticos e presos à P3.7: `/rankings/ad-id/{id}/creative` e `/packs/{id}/thumbnail-cache` |
| P3.2c | Bloqueio de conflito cross-silo — as 3 camadas | `Concluído` — 2026-08-19. **1 Prevenir:** `detect_pack_conflicts` (migration 112; só cross-silo, acesso via `resolve_pack_access`, EXISTS com dono amarrado — pior caso 41k×40k sem match ~218ms frio) + `GET /pack-shares/conflicts` + `usePackConflicts` (grafo cacheado 5min) + `PackFilter` desabilita com hint. **2 Sinal:** o `overlap` da migration 105 agora atravessa `_normalize_rankings_rpc_response` (a whitelist o engolia — o sinal nunca tinha chegado ao frontend). **3 Explicar:** `PackConflictGuard` embrulha Manager, Insights e Plano; par conflitante na seleção → bloqueio com "Desmarcar «X»" por pack; no Manager o sinal do servidor cobre grafo defasado. Mesmo dono NUNCA conflita (testado contra o par real de 5639 linhas) |
| P3.3a | Refresh de pack compartilhado fim-a-fim com credencial do DONO | `Concluído` — 2026-08-19. `get_facebook_token_for_silo` (service role + mesmo cache/circuit breaker). Gate: **qualquer membro** atualiza (decisão travada). **O job vive no silo do DONO** — o guard 409 filtrado pelo dono passa a cobrir cross-user de graça, e o polling resolve silo+token PELO JOB (ator pode nem ter Meta; a dependency `get_graph_api` do polling era morta e barrava convidado antes do corpo). Uso Meta atribuído ao dono; `actor_id` no payload. Token do dono expirado num disparo de convidado: loga, não marca (marcar exige o JWT do dono) |
| P3.3b-planilha | Sync de planilha em contexto de DONO para qualquer membro | `Concluído` — 2026-08-19. Convenção única no pipeline: **`user_jwt=None` ⇒ service role + silo explícito** (4 camadas: google_accounts_repo → google_token_service → ad_metrics_sheet_importer → google_sheet_sync_job; toda query já escopava por `user_id` explícito — o filtro fica, o guarda muda de lugar). O refresh de convidado NÃO pula mais o sync (o skip da P3.3a saiu); a cadeia server-side roda em contexto de dono independente de quem polou; `start_sync_job` avulso aceita qualquer membro (gate via pack da integração); polling de sync job resolve silo pelo job. **Provado ao vivo**: token Google do dono resolvido com jwt=None + planilha real lida (16 colunas, ad_id/leadscore presentes). Achado colateral: a conexão Google do dono `8363e117` está com refresh token REVOGADO — o sync dele falharia hoje por qualquer caminho; precisa reconectar |
| P3.3b-resto | `packs/status-sync`, `transcribe` (dono\|editor — custa AssemblyAI), writes de entidade (status/budget/batch — exigem resolução entidade→silo+grant), re-attach/cancel de job p/ convidado | `Não iniciado` |
| P3.4 | Usuário convidado: app utilizável sem Facebook conectado | `Concluído (núcleo)` — 2026-08-19. A investigação encolheu o item: a superfície de boot JÁ era tolerante (adaccounts/connections são Supabase-backed e voltam vazios; auto-sync engole erro de FB de propósito; nenhum gate de conexão no AppLayout). O único bloqueio duro era o **onboarding**: sem conexão não existia botão de continuar, e o gate devolvia o usuário para lá em loop — FacebookStep ganhou "Pular por enquanto" com microcopy explicando packs compartilhados. `/onboarding/complete` nunca exigiu FB no backend. **Restante (com a P3.7):** polir /upload sem conexão (CTA no lugar de seletores vazios) e revisar o widget de moeda com 0 contas |
| P3.5 | Log de ações (ator, alvo, ação) + retenção de 365 dias | `Não iniciado` |
| P3.6 | Cargos `dono`/`editor`/`viewer` aplicados: só o dono compartilha, `viewer` não escreve | `Concluído p/ escritas puras de banco` — 2026-08-19. Guard central em `app/services/pack_access.py` (`assert_pack_role` → `(role, owner_id)`; sem acesso → 404, papel insuficiente → 403). Gateados: judgment e auto-refresh (`dono\|editor`, write via service role); name e DELETE do pack (`dono` apenas — nome é IDENTIDADE, não conteúdo: renomear muda como o time inteiro encontra o pack, mesma classe de compartilhar/apagar). **Regra para o restante:** os endpoints presos a credencial externa (refresh-pack, packs/status-sync, transcribe, sync de planilha, status/budget de ad/adset/campanha, bulk) ganham o gate NA CONVERSÃO da P3.3 — gatear antes criaria endpoints que autorizam e falham no meio; hoje todos falham fechado (RLS não encontra pack/ad alheio) |
| P3.7 | UI: convite, badge de pack compartilhado, aviso de refresh em andamento | `Concluído (núcleo)` — 2026-08-19. **A chave virou**: `list_packs` inclui packs com grant (`shared_role` + `shared_owner_name` via `list_shared_packs`, service role escopado por `grantee_id`); `GET /packs/{id}` lê pack+ads no silo do dono para convidados — sem isso o `usePacksAds` voltava vazio e o /plano descartava os ads no filtro de membership. UI: badge "Compartilhado por X · papel" no PackCard; convidado perde renomear/apagar/integração/transcrever e ganha **"Sair do pack"**; viewer não edita julgamento nem auto-refresh; dono ganha **"Compartilhar"** → `PackShareDialog` (lookup por e-mail exato → papel → convidar; membros com troca de papel e revogação); PackFilter marca "· compartilhado". **Restam** (cosméticos): aviso de refresh em andamento disparado por outro membro (re-attach é P3.3b) e polimento do /upload sem conexão |
| P3.8 | *(pós-MVP)* Token do convidado quando ele tem acesso próprio à conta | `Não iniciado` |

### P3.1 — entregue (migration `103_pack_shares.sql`)

Fronteira desta fase, e a razão dela: **modelo de dados e primitivas de
autorização, sem tocar no read-path**. O pack compartilhado ainda NÃO aparece
para o convidado — isso depende da P3.2. Expor antes mostraria um pack cujo
analytics responderia `Forbidden`. O roadmap não dizia quando a visibilidade
entra; agora diz.

**O dono não é uma linha em `pack_shares`.** A propriedade vem de `packs.user_id`;
a tabela guarda só os acessos concedidos, e `role` aceita apenas `editor|viewer`.
Gravar o dono como linha abriria a porta para os dois discordarem.

#### Escalonamento de privilégio encontrado e fechado

A primeira versão protegia a criação de grants só com RLS
(`WITH CHECK (owner_id = auth.uid())`). Isso prova que o autor **diz** ser dono,
não que ele **é**: qualquer usuário autenticado conseguia conceder acesso a
qualquer pack cujo id conhecesse, declarando-se dono — e o resolvedor honrava o
grant forjado. Confirmado empiricamente antes de corrigir.

A correção não é uma policy melhor, é garantia de armazenamento: FK **composta**
`(pack_id, owner_id) → packs(id, user_id)` (com `UNIQUE (id, user_id)` em `packs`
como alvo). O par só existe se o pack for mesmo daquele dono. O resolvedor também
exige `s.owner_id = p.user_id`, redundante de propósito: se alguém dropar a
constraint, ele ainda recusa.

**Lição que vale para a P3.2 em diante:** política de RLS sobre coluna
denormalizada valida a *alegação*, não o *fato*. Onde a integridade importa,
a constraint é que tem de carregar a garantia.

#### Contrato do resolvedor

`resolve_pack_access(p_pack_ids, p_actor_id)` devolve **uma linha por pack
acessível**. Pack sem acesso simplesmente não volta, então o chamador compara a
contagem — se vier menos do que pediu, algum é inacessível → `Forbidden`. Isso
evita vazar a existência de pack alheio: não há diferença observável entre
"não existe" e "não é seu".

Verificado que packs de donos diferentes convivem numa mesma chamada (2 donos em
2 packs) — é o pré-requisito da agregação multi-silo da P3.2.

#### Endpoints (`/pack-shares`, router próprio)

`GET /lookup` (e-mail exato) · `GET|POST /{pack_id}` · `PATCH|DELETE /{pack_id}/{grantee_id}`
· `DELETE /{pack_id}/me` (sair). Rate limit: 30/min no lookup, 60/min nas escritas.

As RPCs `lookup_user_by_email` e `lookup_users_by_ids` são revogadas de
`anon`/`authenticated` de propósito: o backend chama com service role para que o
rate limit do middleware valha. Expostas ao PostgREST, o frontend as chamaria
direto e passaria por fora do limite.

#### Não verificado

Os handlers HTTP com JWT real não foram exercitados: a validação é por JWKS
(assimétrica) e não há segredo para forjar token. O que foi testado é a camada
de banco — onde mora toda a segurança —, o registro das rotas e o caminho real
de chamada das RPCs via supabase-py.

Correção de 2026-08-17: `viewer` **entra no MVP** (decisão travada), então os cargos
saíram do pós-MVP e viraram P3.6. Só o token do convidado ficou para depois.

---

## Decisões travadas

| Data | Decisão | Razão |
|---|---|---|
| 2026-08-17 | Dado **não é copiado** no compartilhamento; fica no silo do dono | É a dor original: duplicação e refreshes independentes |
| 2026-08-17 | Grant **pack a pack** | Mais simples; granularidade certa para o caso de uso |
| 2026-08-17 | RPC deriva dono de `p_pack_ids`, não recebe `p_user_id` | Uma média só; e elimina id forjável |
| 2026-08-17 | **Sem trava de tier** — compartilhar é livre | Decisão de produto; cobrança não é preocupação agora |
| 2026-08-17 | MVP **sem cargos**: membro faz tudo (ler, atualizar, pausar, budget) | Risco de editor é organizacional, não do app |
| 2026-08-17 | Coluna `role` criada **desde já** (default `editor`), sem uso na UI | Custo zero hoje; evita backfill ambíguo depois |
| 2026-08-17 | Credencial **sempre do dono** (Facebook e Google Sheets) | Permite convidar copywriter/editor sem conta Meta |
| 2026-08-17 | Registrar **ator** em toda escrita | Único rastro possível: na Meta o log mostra o dono |
| 2026-08-17 | ~~Critérios de julgamento: **herança com override** (user default → pack)~~ **REVOGADA em 2026-08-18** | Ver P2.1: a herança era o que tornava possível a pergunta "o default é de quem?" |
| 2026-08-18 | `mql_leadscore_min` e `target_cpr` vivem **só no pack**; `diagnostic_cost_metric` e `validation_criteria` **só no usuário** | Os dois primeiros descrevem o dado; os dois últimos, o gosto de quem olha |
| 2026-08-18 | Corte ausente ou divergente → MQL/CPMQL **indisponíveis**, nunca zero | Zero é uma afirmação falsa na direção que não se investiga |
| 2026-08-18 | Corte é **obrigatório** no último passo da integração de planilha | É o único momento em que a escala do leadscore está à vista |
| 2026-08-19 | Renomear pack é **só do dono**; editor calibra (julgamento, auto-refresh), não redefine identidade | Nome é como o time inteiro encontra o pack — mesma classe de compartilhar/apagar. Bônus: elimina a unicidade de nome cross-silo |
| 2026-08-18 | Backfill preserva o valor vigente, mas **default 0 vira NULL** | Zero nunca foi escolha; gravá-lo o transformaria em decisão |
| 2026-08-18 | `validation_criteria` **fica no usuário** — decisão fechada, não reabrir | É tolerância a risco do analista ("quanta evidência exijo antes de confiar"), não propriedade da campanha. Objeção registrada e vencida: ele também decide *quais* anúncios entram no julgamento, então dois membros com limiares diferentes podem ver vereditos diferentes. Se isso aparecer na prática, reabre-se com evidência — não por argumento |
| 2026-08-17 | Ordem P1 → P2 → P3 | P1 define o vocabulário; P2 é pré-requisito semântico de P3 |
| 2026-08-17 | Convidado enxerga **apenas o conteúdo do pack** — inclusive adsets e campanhas | Compartilhou o pack, não a conta |
| 2026-08-17 | MVP: convite **só para quem já tem conta** no Hookify | Projeto não tem nenhuma infraestrutura de e-mail hoje; convite a não-cadastrado é camada aditiva |
| 2026-08-17 | Busca de convidado por **e-mail exato**, com rate limit e payload mínimo | Evita que o app vire oráculo de "esse e-mail tem conta aqui?" |
| 2026-08-17 | P1: colunas de **vocabulário livre**, sem conjunto fixo de etapas | Cada nicho tem um funil |
| 2026-08-17 | P1: armazenamento **detalhe + rollup** (`ad_lead_events` + `custom_metrics jsonb`), `leadscore_values` intocado | Cada requisito servido pelo mecanismo mais barato que o serve |
| 2026-08-17 | P2: migram `mql_leadscore_min`, `target_cpr`, `diagnostic_cost_metric`; `validation_criteria` fica no usuário | Os três primeiros têm dependência estrutural do pack |
| 2026-08-17 | Dedup cross-silo: vence o silo do **dono do pack compartilhado**, desempate por uuid | Estável entre refreshes; "mais recente" faria o número oscilar |
| 2026-08-17 | Detectar duplicata e **oferecer limpeza** do pack próprio redundante | Dedup é rede de segurança; apagar a cópia é a resolução real |
| 2026-08-17 | Budget de campanha: **mostrar igual ao dono** | Descasamento budget-vs-spend já existe hoje em qualquer pack parcial; não é vazamento novo |
| 2026-08-17 | Cargos `dono` / `editor` / `viewer`; **só o dono compartilha** (sem repasse) | — |
| 2026-08-17 | Dono apaga → some para todos, com aviso de que há membros. Convidado tem "sair do pack" | "Sair" é o convidado se auto-remover, não pré-requisito de nada |
| 2026-08-17 | Retenção do log de ações: **365 dias** | Só um time usa o app hoje; reduz depois se virar problema |
| 2026-08-17 | P1: **só contagens**, sem detalhe por lead | Custo por reunião sai de contagem + spend; cobre ~90% dos casos |
| 2026-08-17 | `viewer` **vale de verdade no MVP** | ~6-8 endpoints checando cargo; barato o bastante |
| 2026-08-17 | P1: mapear coluna nova **reimporta o histórico**, com aviso | É o que o usuário espera |
| 2026-08-17 | Métricas de planilha **entram no julgamento** (validação, G.O.L.D., diagnóstico) | Senão P1 vira só relatório |
| 2026-08-17 | Membro **pode disparar o sync da planilha** do dono | Mesma lógica do refresh do Meta |
| 2026-08-17 | **Ordem revisada para P2 → P3 → P1** | P1 não era pré-requisito de P2; e sua pendência é semântica (atribuição de data), não técnica |

---

## Decisões em aberto

> Nenhuma decisão bloqueia P2 ou P3. As abertas são todas do P1, que está adiado.

1. **Atribuição de data (P1) — a que travou o projeto.** Ao filtrar um período, o
   usuário quer os eventos **daquele período** ou os eventos **dos leads capturados
   naquele período**? Provavelmente os dois, com a UI dizendo claramente qual está
   sendo mostrado. Decisão de produto; merece conversa própria.

2. **Onde a escolha de atribuição aparece na UI (P1).** Um seletor? Duas colunas
   distintas? Um rótulo fixo? Depende da nº 1.


---

## Armadilhas conhecidas

- **Não afrouxar a RLS com subquery de grants.** A regra é avaliada em toda leitura
  de todo usuário, inclusive dos que nunca compartilharam nada. Com a segunda
  condição o Postgres frequentemente abandona o índice. Duas pistas separadas
  (pack próprio = caminho atual intocado; pack compartilhado = caminho explícito)
  é o desenho correto.

- **~86 leituras diretas de tabela** fora das RPCs (`.eq("user_id", ...)`):
  24 em `routes/analytics.py`, 62 em `services/supabase_repo.py`. Esse é o grosso do
  trabalho de P3, e é proporcional a quantas telas devem suportar pack compartilhado.

- **Duplicata cross-silo conta spend em dobro** se o convidado já tinha carregado os
  mesmos anúncios — que é justamente o cenário atual. Dedup por `(ad_id, date)` na
  CTE base.

- **Rate limit concentra no dono.** `packs.refresh_lock_until` já existe e serializa
  o refresh; falta expor na UI. `meta_api_usage` precisa registrar ator **e** dono.

- **Conexão do dono degradada bloqueia o time inteiro.** Precisa de mensagem
  específica para o convidado ("o dono precisa reconectar"), não 403 genérico.

- **`get_graph_api` depende do usuário requisitante** (`routes/facebook.py:453`) e
  levanta 403 `facebook_connection_missing`. Precisa de variante que resolve
  credencial por dono do pack.

- **Onboarding assume conexão com o Facebook.** O backend é tolerante
  (`has_completed_onboarding` é a fonte da verdade; `facebook_connected` é só UX —
  `services/onboarding_service.py:44`), mas o fluxo de frontend tem passo de conexão
  e vários pontos assumem conta selecionada. **Provavelmente o maior item de P3.**

- **Nunca aceitar `owner_id` vindo do cliente.** Sempre derivar de `pack_id`.

- **`parent_entities` não tem vínculo com pack.** Como o convidado só enxerga o
  conteúdo do pack, campanhas e adsets em escopo precisam ser derivados dos anúncios
  do pack — join a mais em todo lugar que lê budget e status. `ad_metric_pack_map` e
  `ads.pack_ids` (índice GIN) resolvem bem o escopo no nível de anúncio; o nível
  pai é que não é de graça.

- **Não existe infraestrutura de e-mail no projeto** (nenhum SMTP, Resend, SendGrid
  ou `inviteUserByEmail`). O serviço embutido do Supabase é só para teste; produção
  exige SMTP externo configurado no painel — que **não fica no repositório**, então
  confira em Auth → SMTP Settings antes de assumir que não existe.

- **Ler `auth.users` já tem precedente**: `get_admin_users_list()` (`schema.sql:3929`)
  lê `auth.users` e `raw_user_meta_data->>'name'` de dentro de uma função
  `SECURITY DEFINER`. A busca de convidado por e-mail segue o mesmo padrão.

- **Não confundir com o share público existente** (`ad_shares` + `lib/ads/sharedAdDetail.ts`):
  aquilo é link read-only com snapshot em jsonb, outra feature. Os dois nomes precisam
  ser distintos na UI.

---

## Referências

- `documentation/decisoes-tecnicas.md` — decisões de arquitetura do projeto
- `supabase/schema_map.md` — colunas e tipos
- `supabase/schema.sql` — corpo das RPCs, RLS, índices

# Plano: economia do lead (teto de CPL e margem por anúncio)

Data: 2026-09-21. Estado (2026-09-24): **F0 E F1 IMPLEMENTADAS, REVISADAS E COMMITADAS ·
MIGRATION 179 APLICADA EM PRODUÇÃO · AGUARDANDO A PARADA P1** (o idealizador revisa a tela
com o pack real). **F2 implementada, revisada e commitada (2026-09-26) — aguardando a
P2**, feita em paralelo à P1 a pedido do idealizador. F3–F4 não iniciadas.
Seções 1–10: o design. Seções 11 em diante: o plano de execução, com status por tarefa.

> **Documento vivo.** Saiu de uma sessão de brainstorming com o idealizador. As decisões
> abaixo foram tomadas uma a uma, com as alternativas na mesa — o log (seção 9) guarda o
> "por que NÃO fizemos X" para ninguém reabrir sem motivo novo. Achados que contradizem o
> texto entram na seção "Achados durante a execução", no fim.

---

## 1. Por que

Hoje o app julga custo contra um **CPR alvo digitado à mão** (`packs.target_cpr`), um
número só para o pack inteiro. Ele não distingue o anúncio que traz lead nota 90 do que
traz lead nota 20: os dois são cobrados da mesma meta. Na vida real, o primeiro pode
custar o triplo e ainda ser o melhor negócio.

A feature responde **"quanto eu posso pagar por um lead DESTE anúncio?"** a partir da
economia do negócio — conversão por faixa de nota, ticket, quanto sobra da venda e a
margem de lucro desejada — ponderada pela mistura de notas que aquele anúncio entrega.
O anúncio que traz lead ruim ganha um teto baixo (só vale se for muito barato); o que
traz lead bom ganha um teto alto.

**Para quem:** usuário que já integrou a planilha de leadscore (sem leadscore a feature
não existe) e conhece os números do próprio negócio.

## 2. O que muda para quem usa

| Onde | Hoje | Depois |
|---|---|---|
| Configuração do pack | Corte de MQL + CPR alvo por conversão | + cadastro **Economia do lead**: produtos e faixas de nota |
| Manager | Leadscore médio, MQLs, % MQL, CPMQL | + colunas opcionais **Teto de CPL** e **Margem** |
| Topo do Manager | — | Resumo: "Teto do pack R$ X · N de M anúncios abaixo da meta" |
| Modal do anúncio | Histograma de leadscore | + **conta aberta**: leads por faixa, valor de cada faixa, teto, CPL, margem |
| Export CSV | — | As duas colunas novas |
| Link público de anúncios | — | **Nada.** Teto e margem revelam ticket e margem do negócio |
| G.O.L.D., /plano, cores de julgamento | CPR alvo | **Nada muda** no v0 |
| Quem não configura | — | Nada muda; colunas ficam indisponíveis |

## 3. Premissas

1. Faixas são definidas por **cortes contíguos**: a primeira faixa não tem piso, cada
   corte abre uma faixa nova. Não existe buraco nem sobreposição por construção, e
   funciona em qualquer escala de nota (0–100, 0–1000, decimais).
2. Nota exatamente no corte pertence à faixa de cima (`nota >= min`).
3. A conta roda **no cliente**, como a do CPMQL. O histograma de notas já vem no payload
   do Manager; nenhuma RPC muda.
4. Moeda é a da conta de anúncios, como o resto do app.
5. Em pack compartilhado, dono e editor configuram; leitor só vê (regra que o endpoint de
   julgamento já aplica).
6. O mesmo anúncio em dois packs pode ter tetos diferentes, e isso é correto: cada pack
   tem sua economia (a linha de métrica pertence ao pack desde a 145).
7. Sem cadastro, colunas **indisponíveis — nunca zero**. Zero diria "esse lead não vale
   nada".
8. O lead com nota é a amostra: os leads que não casaram com a planilha ficam fora tanto
   do teto quanto do CPL (ver decisão D13).

## 4. Dados

Coluna nova `packs.lead_economics jsonb`, nula = não configurado.

```json
{
  "products": [
    { "id": "p1", "name": "Mentoria", "ticket": 3000, "contribution_margin": 0.55, "target_margin": 0.40 },
    { "id": "p2", "name": "Ebook",    "ticket": 300,  "contribution_margin": 0.90, "target_margin": 0.40 }
  ],
  "bands": [
    { "min": null, "product": "p2", "conversion": 0.005 },
    { "min": 60,   "product": "p1", "conversion": 0.04 },
    { "min": 80,   "product": "p1", "conversion": 0.12 }
  ]
}
```

- `ticket`: faturamento por venda (bruto).
- `contribution_margin` ("quanto sobra"): fração do faturamento que sobra depois de
  produto, imposto, comissão e taxas — tudo, menos o anúncio.
- `target_margin`: margem de lucro desejada, **sobre o faturamento**.
- `product` referencia `products[].id` — id estável, para renomear não desligar faixas.
- A taxa **medida** (futuro) entra como campo novo por faixa, sem migration.

**Gravação:** pelo endpoint que já existe, `PATCH /packs/{id}/judgment` — ganha a chave
`lead_economics` no conjunto permitido de `supabase_repo.update_pack_judgment`. Herda de
graça o controle de papel (dono/editor; leitor 403) e o registro de autoria em
`pack_action_log`.

**Validação no endpoint:**
- 1 a 10 faixas; `min` da primeira é `null`, os demais estritamente crescentes.
- `conversion` em [0, 1] — zero é legítimo ("abaixo de 30 ninguém compra").
- `ticket > 0`; `contribution_margin` em (0, 1]; `target_margin` em [0, 1).
- `target_margin < contribution_margin` em cada produto — senão nenhum lead daquele
  produto se paga.
- Todo `band.product` existe em `products`; todo produto tem nome não vazio e único no pack.
- `null` limpa o cadastro (mesma semântica dos outros campos do endpoint).

**Armadilha conhecida:** o store de packs do navegador precisa sincronizar
`lead_economics` (`useLoadPacks`), senão o usuário salva e continua vendo o valor antigo.

## 5. A conta

Para cada linha do Manager, com `f_b` = leads com nota na faixa `b` ÷ leads com nota, e
`c, t, s, m` = conversão da faixa, ticket, sobra e margem desejada do produto dela:

| | Fórmula |
|---|---|
| Faturamento por lead `R` | `Σ f_b · c · t` |
| Contribuição por lead `K` | `Σ f_b · c · t · s` |
| **Teto de CPL** | `Σ f_b · c · t · (s − m)` |
| CPL real | gasto ÷ leads com nota |
| **Margem** | `(K − CPL) ÷ R` |
| Meta do anúncio | `Σ f_b · c · t · m ÷ R` (igual à margem desejada com um produto só) |

**Invariante:** `margem ≥ meta ⇔ CPL ≤ teto`, sempre. As duas colunas nunca discordam.

**Linha de média do Manager:** ~~a conta sobre o histograma somado~~ **(D27)** a média dos
resultados das linhas **ponderada pelos leads com nota** de cada uma (R, K, teto e meta
ponderados; margem = (K − CPL) ÷ R sobre os totais). Com um cadastro só, dá exatamente o
mesmo número do histograma somado; com cadastros diferentes por pack, continua correta.
Nunca a média simples dos tetos (um anúncio com 3 leads pesaria igual a um com 300).

**Exemplo trabalhado** (é o caso do teste unitário, calculado à mão): 42 leads com nota,
gasto R$ 1.310,40.

| Nota | Leads | Produto | Conversão | Teto da faixa |
|---|---|---|---|---|
| 80 ou mais | 9 (21%) | Mentoria | 12,0% | R$ 54,00 |
| 60 a 79 | 14 (33%) | Mentoria | 4,0% | R$ 18,00 |
| abaixo de 60 | 19 (45%) | Ebook | 0,5% | R$ 0,75 |

`R = 117,82` · `K = 65,04` · **Teto = R$ 17,91** · CPL = R$ 31,20 ·
**Margem = 29%** (meta 40%) → lucrando, abaixo do desejado. Conferência do invariante:
com CPL = 17,91, a margem dá exatamente 40%.

## 6. Cadastro (tela)

Uma tela só, salva de uma vez, dentro da configuração do pack. Ordem: o que você vende →
quem compra.

```
O que você vende
  Produto        Ticket     Sobra    Margem desejada
  Mentoria     R$ 3.000     55 %         40 %
  Ebook        R$   300     90 %         40 %
  + adicionar produto

Quem compra
  Nota do lead     Produto      Conversão    Teto por lead
  abaixo de 60     Ebook           0,5 %       R$  0,75
  60 a 79          Mentoria        4,0 %       R$ 18,00
  80 ou mais       Mentoria       12,0 %       R$ 54,00
  + adicionar faixa

  Seu corte de MQL é 70.
```

- **Um produto = modo simples:** a coluna "Produto" some e o nome é opcional. **Dois ou
  mais = a coluna aparece.** O modo não é gravado — é deduzido do número de produtos.
- **Rótulo sem jargão.** "Margem de contribuição" não aparece em lugar nenhum. O campo é
  *"De cada venda, quanto sobra?"*, com a explicação *"preço menos produto, imposto,
  comissão e taxas — tudo, menos o anúncio"*.
- **Teto por lead calculado ao vivo**, só com os números do formulário. Ensina a feature
  antes de ela aparecer no Manager e denuncia erro de digitação (30.000 no lugar de 3.000).
- Margem desejada ≥ sobra: erro no próprio campo, "nenhum lead deste produto se paga".
- Apagar produto em uso: pede para escolher outro para as faixas que o usam.
- O corte de MQL continua independente e aparece ao lado, para que a diferença entre ele e
  as faixas seja escolha visível, não acidente.

## 7. Exibição

**Manager — duas colunas opcionais**, na família de leadscore, desligadas por padrão, só
disponíveis com planilha integrada **e** economia configurada:

- **Teto de CPL** (R$).
- **Margem** (%), com a meta no tooltip. Cor em três estados: margem ≥ meta (sucesso),
  entre 0 e a meta (alerta — lucrando, abaixo do desejado), negativa (erro — prejuízo).
  Tooltip: *"R$ 31,20 por lead com nota · teto R$ 17,91 · meta 40% · 42 leads com nota"*.
  Ordenável e filtrável: `margem < 0` = "quem está dando prejuízo".
- **Menos de 20 leads com nota:** valores esmaecidos (`opacity-50`), tooltip "número
  instável".
- **Indisponível (—)** (D27: decidido por LINHA, pelos packs da linha), e o tooltip diz qual: pack sem economia; packs da linha com
  economias diferentes (mesma regra do corte de MQL em `resolve_pack_mql_leadscore_min`);
  linha sem lead com nota.
- Todos os leads em faixas de 0%: teto **R$ 0** (aqui zero é verdade) e margem —.

**Gate de planilha:** o `requiresSheetIntegration` está repetido em **5 lugares**
(`managerColumnPreferences.ts`, três pontos em `ManagerTable.tsx`,
`ManagerExportDialog.tsx`). As duas colunas novas entram nos cinco, com a condição
adicional de economia configurada.

**Modal do anúncio — conta aberta:** a tabela do exemplo da seção 5, mais teto, CPL,
margem e meta, e a linha *"Conta feita com os 42 leads que casaram com a planilha."*

**Resumo no topo do Manager:** teto do pack e quantos anúncios estão abaixo da meta, a
partir dos dados já carregados.

**Export CSV:** as duas colunas; margem entra no conjunto de razões (`RATIO_COLUMNS`).

**Link público:** `buildShareMetricsFromRow` usa lista fechada — as métricas novas
simplesmente não entram, com comentário e teste guardando isso.

## 8. Testes

- A conta é uma **função pura** em `frontend/lib/utils/` (família do `mqlMetrics.ts`),
  testada com o exemplo da seção 5.
- **Teste de propriedade:** entradas aleatórias, verificando o invariante
  `margem ≥ meta ⇔ CPL ≤ teto`.
- **Sabotagens obrigatórias:** trocar `>=` por `>` na busca da faixa (o teste da nota no
  corte precisa quebrar); trocar histograma somado por média dos tetos na linha de média
  (o teste da média precisa quebrar).
- Validações do endpoint: ordem dos cortes, limites de cada campo, referência a produto,
  `target_margin < contribution_margin`, `null` limpa.
- Link público não carrega `lead_economics`, teto nem margem.

## 9. Log de decisões

| # | Decisão | Alternativas consideradas | Por quê |
|---|---|---|---|
| D1 | Taxa de conversão **digitada** no v0; estrutura pronta para a **medida** depois | Só digitada; medida da planilha (coluna de venda) | Medida exige o CRM registrar o desfecho e sofre defasagem: o lead de hoje só vira venda em semanas, então anúncio recente sempre pareceria converter menos |
| D2 | Faixas livres por cortes contíguos | Duas faixas reusando o corte de MQL | A diferença entre nota 60 e nota 20 é o que separa anúncio ruim de péssimo; cortes eliminam buraco e sobreposição por construção |
| D3 | Ticket **bruto** + "quanto sobra" separados | Só ticket líquido; líquido com calculadora obrigatória; anúncio como único custo | O campo deve pedir número que o usuário sabe de cor. Bruto digitado num campo de líquido infla o teto (~67% no exemplo) sem nenhuma validação possível; separado, dá para validar. O idealizador cogitou líquido no v0 e voltou atrás |
| D4 | Rótulo "De cada venda, quanto sobra?" | "Margem de contribuição" | O termo trava quem não é de finanças; o problema era a palavra, não o campo |
| D5 | Teto é **número novo ao lado**, não régua de julgamento | Vira a régua onde houver cadastro; substitui o CPR alvo | Escopo fechado. G.O.L.D., /plano e Oportunidades assumem meta única por pack; o teto é por anúncio. Revisar isso é a fase 2, e conviver com duas réguas é o risco aceito até lá |
| D6 | Telas: Manager, modal, resumo no Manager, CSV | + cartão do pack | Cartão exigiria o backend calcular o histograma do pack **e** recalcular a cada sync de planilha; sem isso, cartão e Manager divergem — descompasso que já custou bug com dados da planilha |
| D7 | Menos de 20 leads com nota: mostra **esmaecido** | Esconder; completar com a distribuição do pack | Com poucos leads o teto ainda é a melhor estimativa, só instável. Esconder cega justo o anúncio novo; completar com o pack apaga a diferença que a feature existe para mostrar |
| D8 | Cadastro é **documento jsonb no pack** | Tabela com uma linha por faixa; catálogo reutilizável entre packs | Sempre lido e salvo inteiro, nunca consultado por faixa. Reusa endpoint, papel e autoria. Com cortes contíguos, a proteção que o banco daria é desnecessária |
| D9 | **Produtos** dentro do pack; cada faixa aponta para um produto | Sobrescrever ticket/sobra por faixa com modo avançado; catálogo do usuário; mistura de produtos por faixa | Casa com como o dono pensa ("lead ruim compra o ebook"). Catálogo do usuário recriaria a herança usuário → pack **revogada na migration 110** e complica pack compartilhado. Mistura por faixa é matriz pesada; a conta aceita depois sem mudar nada |
| D10 | Margem desejada **por produto** | Única do pack; por faixa | Por faixa seria botão escondido que mexe direto no teto. Por produto está presa a algo com nome, e querer margens diferentes por linha de produto é prática real |
| D11 | Modo simples/avançado **deduzido**, não gravado | Gravar o modo | Gravado, podia dizer "simples" com valores escondidos ainda mudando o teto |
| D12 | Produto com **id estável** | Referência pelo nome | Renomear não pode desligar faixas |
| D13 | CPL real = **gasto ÷ leads com nota** | Conversão escolhida no cadastro; CPR do seletor da página | Escolha do idealizador. O erro vai para o lado seguro: lead que não casou encarece o CPL e o usuário tende a segurar verba, não a queimar. O seletor da página comparava venda com lead quando trocado; dispensa um campo |
| D14 | Mostrar **Margem**, não "folga" | Folga (teto − CPL) | Proposta do idealizador. Margem tem três estados (acima da meta / lucrando abaixo / prejuízo); folga misturava "−1%" com prejuízo real |
| D15 | Margem **sobre o faturamento** | Sobre o que sobra da venda | É o que "margem de lucro" significa numa DRE. Sobre a sobra, "40%" eram 24–28% do faturamento e o teto saía quase o dobro. Achado ao tornar a margem visível: a primeira versão da conta usava a base errada |
| D16 | ~~Packs com economias diferentes na tela → indisponível~~ **Substituída pela D27 para a economia do lead** (o corte de MQL continua com esta regra) | Resolver por linha; escolher um | Mesma regra do corte de MQL, que o usuário já conhece |
| D17 | Linha de média = conta sobre o histograma somado | Média dos tetos | Média de tetos dá peso igual a 3 e a 300 leads |
| D18 | Link público **nunca** carrega teto nem margem | Incluir | Revelam ticket e margem do negócio a quem recebe o link |
| D19 | Corte de MQL continua independente, exibido no cadastro | Forçar o corte a coincidir com uma faixa; derivar | Respondem perguntas diferentes ("vale ligar?" × "quanto vale?"); mostrar lado a lado torna a diferença escolha, não acidente |
| D20 | Dois packs têm "a mesma economia" quando a CONTA dá o mesmo resultado: igualdade por `leadEconomicsSemanticKey` (cortes, conversões e os números do produto de cada faixa; produto de faixa com conversão 0 fica de fora) | JSON do documento inteiro | O id do produto é aleatório: dois packs cadastrados à mão com os mesmos números divergiriam por ele e teto/margem sumiriam ao selecionar os dois. Com packs iguais vale o documento do primeiro (é dele que saem os nomes) |
| D21 | O diálogo só envia `lead_economics` quando o cadastro MUDOU (chave ausente = não mexer) | Sempre no payload, como corte e CPR alvo | Salvar o corte de MQL não pode depender da coluna existir no banco (código publicado antes da migration derrubaria o save inteiro com 500 — incidente de 20/09), e o histórico do pack não pode ganhar "economia removida" a cada save de quem nunca configurou. Decidida por `decideLeadEconomicsPayload` (função pura, testada) |
| D22 | Escrita estrita, leitura tolerante: `validateLeadEconomics` (espelhado no backend) recusa nome ausente/longo/duplicado; `normalizeLeadEconomics` (leitura) ignora as regras de nome e exige só o que a conta usa | Mesma validação nas duas pontas | Regra cosmética não pode apagar cadastro gravado: a chave de nome duplicado depende da tabela Unicode do runtime (27 code points divergem entre Unicode 15 e 16), e endurecer uma regra de nome no futuro faria cadastros sumirem em silêncio |
| D23 | A tela arredonda na ENTRADA com a mesma precisão da exibição: nota de corte em 6 casas (a precisão com que as notas são importadas), dinheiro em centavos, porcentagem em 4 casas | Guardar precisão total e exibir arredondado | Ida e volta assimétrica regravava o documento a partir do texto arredondado ao mexer em qualquer outro campo: leads mudavam de faixa sem ninguém tocar no corte |
| D24 | A migration 179 é aplicada no banco ANTES da P1 (e antes de qualquer deploy que contenha a F1), seguida de `pg_dump` + `schema_map.md` | Aplicar só na F4 | A P1 salva no pack real, e o backend local escreve no Supabase de produção. A coluna é nula e aditiva: nenhum código em produção a lê |
| D25 | Remover a economia no diálogo não pede confirmação: vira o estado "removida — será apagada ao salvar" com **Desfazer**, que devolve exatamente o que estava na tela | Diálogo de confirmação | Nada é apagado antes do Salvar, e o confirm aninhado deixava o diálogo de fora aceso atrás (camadas iguais) |
| D26 | A moeda do cadastro é a da CONTA do pack (via `adaccount_id` na lista de contas da página de packs); sem a conta (pack compartilhado de outra pessoa), cai na preferência e a tela avisa. Dinheiro sempre no padrão brasileiro com o código da moeda ("US$ 1.500,00") | `settings.currency`; `formatCurrency` do app (en-US para USD) | O ticket é comparado com o gasto da Meta, na moeda da conta; e os campos leem vírgula decimal — mostrar "$1,500.00" ao lado ensinava a digitar 1,5 |
| D27 | A economia é resolvida **por linha**, não pela tela: cada linha do Manager usa o cadastro dos packs de onde vêm os anúncios dela (`pack_ids` da linha). Só a linha que junta packs com cadastros **diferentes** (pela D20) fica indisponível. A linha de média pondera o resultado de cada linha pelos leads com nota; se alguma linha ficou de fora, o cabeçalho avisa ("média sem N anúncios que misturam economias diferentes") | Tela inteira indisponível quando os packs selecionados discordam (D16) | Proposta do idealizador (2026-09-23). O teto de uma linha só depende do cadastro do pack dos leads dela; um anúncio individual pertence a um pack só (medido). A regra da tela apagava tudo por causa de uma diferença que só afeta as linhas mistas — que só existem na visão agrupada por nome, quando o mesmo criativo roda em dois packs |

## 10. Fora do v0

- Cartão do pack (D6).
- Sparkline de teto e margem — exigiria mexer na série diária em SQL
  (`fetch_manager_rankings_series_v2`).
- Taxa de conversão medida da planilha (D1).
- Catálogo de produtos compartilhado entre packs (D9).
- Mistura de produtos dentro de uma faixa (D9).
- Uso do teto no G.O.L.D., /plano, Oportunidades e cores de julgamento (D5).
- Mini-calculadora de "quanto sobra" como ajuda opcional ao lado do campo.

---

# Plano de implementação

Legenda de status: `[ ]` não iniciado · `[~]` em andamento · `[x]` concluído · `[-]` descartado (com motivo).

## 11. Como o trabalho está dividido

Cinco fases, em ordem de dependência, com **três pontos de parada** para revisão visual do
idealizador. A ordem não é a das telas — é a do risco: o que é mais barato de mudar se
estiver errado vem primeiro.

| Fase | O que entrega | Tamanho | Arquivos | Parada |
|---|---|---|---|---|
| F0 Fundação | Coluna no banco, validação no backend, a conta como função pura, resolução entre packs | M | ~9 | — |
| F1 Cadastro | A tela de produtos e faixas dentro da configuração do pack | M | ~4 | **P1** — cadastro com os números reais do pack do Hookify |
| F2 Manager | As duas colunas, média, filtro, cor, export, barra de resumo | **G** | ~17 | **P2** — Manager com as colunas ligadas |
| F3 Modal e link público | A conta aberta no modal; prova de que o link público não vaza | P | ~4 | **P3** — modal |
| F4 Fechamento | Migration em produção, docs, smoke com a planilha real, commit | P | ~5 | — |

Por que F1 vem antes de F2: sem cadastro nada aparece no Manager, e a parada P1 valida o
**modelo** (produtos, faixas, rótulos) com números reais antes de se investir nos ~17
arquivos da coluna. Se o modelo mudar em P1, custa um formulário; se mudasse em P2,
custaria o pipeline inteiro.

**Nomes que este plano cria** (primeira menção explica):
- `lead_economics` — a coluna nova em `packs` que guarda o cadastro.
- `computeLeadEconomics` — a função pura que faz a conta da seção 5 para uma linha.
- `LeadEconomicsEditor` — o componente do cadastro (produtos + faixas).
- `LeadEconomicsBreakdown` — a conta aberta que o modal mostra.
- `cpl_ceiling` e `lead_margin` — as chaves das duas métricas novas ("Teto de CPL" e
  "Margem"). Chave de métrica é **imutável depois de publicada** (regra do projeto: séries,
  regras salvas e preferências de coluna citam a chave), por isso o nome está decidido aqui.
- `hasLeadEconomics` — a flag que, junto com `hasSheetIntegration`, libera as colunas.

## 12. F0 — Fundação (dados, backend, conta)

Nada visual. Ao fim, o backend aceita e valida o cadastro, o pack carrega o campo no
navegador e a conta existe, testada — sem nenhuma tela usando.

### 12.1 Banco

| # | Tarefa | Arquivo | Status |
|---|---|---|---|
| 0.1 | Migration `179_economia_do_lead.sql` (+ `179_rollback.sql`): `ALTER TABLE packs ADD COLUMN lead_economics jsonb`, `COMMENT` explicando o formato da seção 4 e que a validação vive na aplicação (D8). Único CHECK: `lead_economics IS NULL OR jsonb_typeof(lead_economics) = 'object'` | `supabase/migrations/179_economia_do_lead.sql` | `[x]` |
| 0.2 | **Antes de aplicar:** confirmar no banco remoto qual é a última migration aplicada. Feito: a frente do chat (`feat/chat-analista`) já tinha a 174 e a **175** commitadas, inclusive um `175_rollback.sql` de mesmo nome que recria a view do chat — renumerada para 176; depois a frente do chat ocupou 176–178, e a economia virou **179** (2026-09-24). Conferido no banco antes de aplicar: a coluna não existia; a tabela `supabase_migrations.schema_migrations` parou na 127 (as seguintes foram aplicadas por `psql`), então quem manda são os arquivos das duas frentes | — | `[x]` |
| 0.3 | Sem teste SQL próprio: uma coluna nula e aditiva não tem comportamento a sabotar. O teste do cadastro é o do backend (0.6) | — | `[-]` motivo ao lado |

~~Aplicar em produção só em F4~~ — **mudou (D24):** aplicar antes da P1, seguido de
`pg_dump --schema-only` → `supabase/schema.sql` e `py supabase/generate_schema_map.py`, no
commit da F0. Enquanto não é aplicada, o `select("*")` de `list_packs` não traz a chave e o
frontend lê `undefined` como "não configurado"; salvar um cadastro NOVO daria 500 (salvar só
o corte de MQL continua funcionando, pela D21).

### 12.2 Backend

| # | Tarefa | Arquivo | Status |
|---|---|---|---|
| 0.4 | Modelos Pydantic `LeadEconomicsProduct` (`id` 1–40, `name` 1–60, `ticket > 0`, `contribution_margin` em (0,1], `target_margin` em [0,1), validador `target_margin < contribution_margin`), `LeadEconomicsBand` (`min` opcional, `product`, `conversion` em [0,1]) e `LeadEconomics` (1–10 produtos, 1–10 faixas; `bands[0].min` obrigatoriamente `null`; demais `min` obrigatórios e estritamente crescentes; ids de produto únicos; nomes únicos ignorando caixa e espaços; todo `band.product` existe). Mensagens de erro em português, uma por regra — a tela reaproveita | `backend/app/routes/analytics.py` (junto de `UpdatePackJudgmentRequest`) | `[x]` feito diferente: o validador mora em `backend/app/services/lead_economics.py` (`validate_lead_economics`, espelho exato do contrato TS), e o campo da requisição é `Optional[Any]` — um modelo Pydantic responderia 422 com mensagens em inglês fora do contrato. A rota responde 400 com a 1ª mensagem e grava o documento CANÔNICO (nunca o JSON cru). Limite de custo antes de validar (>10 produtos → 400 direto; faixas cortadas em 11) |
| 0.5 | `UpdatePackJudgmentRequest.lead_economics: Optional[LeadEconomics]`; a semântica "ausente = não mexe, `null` = limpa" já vem do `exclude_unset`. Adicionar `"lead_economics"` ao conjunto `allowed` de `update_pack_judgment` no repo. O `pack_action_log` já grava `detail=fields` — a autoria vem de graça | `analytics.py`, `backend/app/services/supabase_repo.py` | `[x]` |
| 0.6 | Teste `test_pack_lead_economics.py` (padrão de `test_list_packs_payload.py`: `TestClient` + `monkeypatch` no repo e em `assert_pack_role`): grava válido · cortes fora de ordem → 400 · primeira faixa com `min` → 400 · produto inexistente → 400 · `target_margin ≥ contribution_margin` → 400 · 11 faixas → 400 · `null` limpa · chave ausente não entra em `fields` · viewer → 403 | `backend/tests/test_pack_lead_economics.py` | `[x]` + paridade: fixture compartilhada `frontend/lib/utils/__tests__/fixtures/lead_economics_validation_cases.json` (gerada pelo validador TS, lida pelo pytest e pelo teste TS) |

**Sabotagem obrigatória (0.6):** remover o validador de ordem dos cortes → o teste de
"fora de ordem" tem de falhar. Remover `"lead_economics"` do `allowed` → o teste "grava
válido" tem de falhar (o repo devolve `{}`).

### 12.3 A conta (função pura)

| # | Tarefa | Arquivo | Status |
|---|---|---|---|
| 0.7 | Tipos `LeadEconomics`, `LeadEconomicsProduct`, `LeadEconomicsBand` e `normalizeLeadEconomics(raw): LeadEconomics | null` — mesma postura de `normalizeTargetCpr`: documento inválido vira `null` (não configurado), nunca lixo no julgamento. Constante `LEAD_ECONOMICS_MIN_SAMPLE = 20` | `frontend/lib/utils/leadEconomics.ts` | `[x]` (leitura tolerante às regras de nome — D22) |
| 0.8 | `computeLeadEconomics({ spend, leadscoreRaw, config })` → `null` quando não há config ou não há lead com nota; senão `{ leadsScored, bands: [{ min, max, productName, leads, share, conversion, ticket, revenuePerLead, ceilingPerLead }], revenuePerLead, contributionPerLead, cplCeiling, cplActual, margin, targetMargin, lowSample }`. `margin` é `null` quando `revenuePerLead = 0`. Reusa `normalizeLeadscoreValues` (aceita array e histograma). Busca da faixa: `nota >= min` (D2/premissa 2). Cache por referência do `leadscoreRaw` (WeakMap), como `computeMqlMetricsFromLeadscore` — a célula do Manager chama ~4× por linha | `leadEconomics.ts` | `[x]` feito diferente: contador próprio de notas (sem expandir o histograma), com paridade presa por teste contra `normalizeLeadscoreValues`; cada faixa traz `product` (o objeto) em vez de `productName`. **O gasto precisa chegar como `number`** (texto numérico vira CPL indisponível) — atenção na F2 |
| 0.9 | `computeLeadEconomicsForRows(rows, spendTotal, config)` para a linha de média: **soma os histogramas** (`mergeHistograms` de `customHistogram.ts`) e chama 0.8 uma vez — D17 | `leadEconomics.ts` | `[x]` feito diferente: assinatura `computeLeadEconomicsForRows(rows, config)`, cada linha traz `{ spend, leadscoreRaw }`; soma as contagens e o gasto e faz a conta uma vez (mesmo núcleo de 0.8) |
| 0.10 | Testes (`node:test`, como `mqlMetrics.test.ts`): (a) exemplo da seção 5 calculado à mão — teto 17,91, margem 0,29, meta 0,40, R 117,82, K 65,04; (b) propriedade com 500 casos gerados (LCG determinístico): `margin ≥ target ⇔ cplActual ≤ cplCeiling`, com tolerância 1e-9; (c) nota exatamente no corte cai na faixa de cima; (d) todos os leads em faixas de 0% → `cplCeiling = 0`, `margin = null`; (e) sem lead com nota → `null`; (f) config inválida → `normalize` devolve `null`; (g) `lowSample` abaixo de 20; (h) média: dois anúncios com 3 e 300 leads — resultado igual ao da conta sobre o histograma somado e **diferente** da média dos dois tetos; (i) dois produtos: meta ponderada pelo faturamento; um produto: meta igual à do produto | `frontend/lib/utils/__tests__/leadEconomics.test.ts` | `[x]` + (j) gasto ausente/zero, (k) cache, (l) leitura tolerante, (m) rótulos com 6 casas, (n) chave D20 |

**Sabotagens obrigatórias (0.10):** trocar `>=` por `>` na busca da faixa → (c) falha.
Trocar a soma de histogramas pela média dos tetos em 0.9 → (h) falha. Inverter o sinal
em `(s − m)` → (b) falha.

### 12.4 Resolução entre packs e carga no navegador

| # | Tarefa | Arquivo | Status |
|---|---|---|---|
| 0.11 | `PackJudgmentConfig.lead_economics`; `JudgmentField` ganha `"leadEconomics"`; `ResolvedJudgment.leadEconomics: LeadEconomics | null` com a **mesma regra** do corte de MQL (todos iguais → o valor; discordam → `null` + `divergent.leadEconomics`) — D16. Igualdade por JSON canônico do documento normalizado. `JUDGMENT_FIELD_LABELS.leadEconomics = "Economia do lead"` | `frontend/lib/judgment/resolveJudgment.ts` | `[x]` feito diferente: igualdade pela chave semântica (D20), não pelo JSON |
| 0.12 | Hook `useLeadEconomics()` — espelho de `useMqlLeadscore`: `{ leadEconomics, divergent, isLoading }` a partir de `usePackJudgment` | `frontend/lib/hooks/useLeadEconomics.ts` | `[x]` + `useMemo` pelo JSON do documento, para a referência não mudar a cada render (os comparadores de memo da F2 comparam por referência) |
| 0.13 | `AdsPack.lead_economics?: LeadEconomics | null`; `api.analytics.updatePackJudgment` aceita a chave | `frontend/lib/types/index.ts`, `frontend/lib/api/endpoints.ts` | `[x]` |
| 0.14 | `useLoadPacks`: copiar `lead_economics` na montagem do pack **e** no bloco de sincronização de campos mutáveis (comparação por `JSON.stringify`, como `target_cpr`). Sem isso o usuário salva e continua vendo o cadastro velho até recarregar (memória `useloadpacks_sync_mutable_fields`) | `frontend/lib/hooks/useLoadPacks.ts` | `[x]` a comparação dos 3 campos de julgamento virou função pura testada: `buildJudgmentSyncPatch` (`frontend/lib/utils/packJudgmentSync.ts`) |
| 0.15 | Teste em `resolveJudgment`: dois packs iguais → valor; um sem cadastro e outro com → `null` divergente; documento com chave a mais/ordem diferente mas mesmo conteúdo → iguais | `frontend/lib/judgment/__tests__/resolveJudgment.test.ts` (criar) | `[x]` + testes do MQL e do CPR alvo, que não existiam |

**F0 pronta quando:** `pytest tests/test_pack_lead_economics.py` e `npm test` verdes,
`tsc --noEmit` limpo, sabotagens provadas e desfeitas.

## 13. F1 — Cadastro

### 13.1 Componente

| # | Tarefa | Arquivo | Status |
|---|---|---|---|
| 1.1 | `LeadEconomicsEditor` — componente controlado (`value`, `onChange`, `mqlLeadscoreMin`, `currency`), estado local em strings (como o dialog faz hoje), exportando `validateLeadEconomicsDraft(draft): { value, errors }` que espelha as regras do backend (0.4), com as mesmas mensagens | `frontend/components/packs/LeadEconomicsEditor.tsx` | `[x]` feito diferente: as funções puras (rascunho, conversão texto↔número, validação, erros por campo, decisão do payload) moram em `frontend/lib/utils/leadEconomicsDraft.ts`, testáveis sem React; as mensagens de resumo vêm do contrato, e cada campo ganha uma mensagem curta de tela (`leadEconomicsDraftFieldIssues`) com `aria-invalid` + borda de erro |
| 1.2 | Bloco **O que você vende**: lista de produtos (nome, ticket, "De cada venda, quanto sobra?" em %, "Margem de lucro desejada" em %). Com **um** produto o nome fica opcional e o rótulo "Produto" some; a partir de dois aparece. Botão "+ adicionar produto" (`btn-tonal`). Texto de ajuda sob "quanto sobra": *"preço menos produto, imposto, comissão e taxas — tudo, menos o anúncio"*. Erro inline quando meta ≥ sobra: *"nenhum lead deste produto se paga"* | `LeadEconomicsEditor.tsx` | `[x]` placeholder do nome é "Nome do produto"; produto sem nome aparece como "Sem nome (produto N)"; com um produto o nome gravado é "Produto" |
| 1.3 | Bloco **Quem compra**: tabela de faixas. Primeira linha fixa "abaixo de {próximo corte}" sem campo de piso; demais com campo de corte. Coluna "Produto" só com ≥ 2 produtos (`<Select>` do shadcn). Coluna **Teto por lead** calculada ao vivo pela conta de uma faixa só (`share = 1`), formatada na moeda da conta. Botão "+ adicionar faixa" sugere o próximo corte. Remover faixa não deixa a lista vazia | `LeadEconomicsEditor.tsx` | `[x]` rótulos "abaixo de 60" / "60 a menos de 80" / "80 ou mais" (a nota exata do corte entra na faixa de cima — "60 a 79" mentiria para 79,5); teto ao vivo é `<output aria-live>` |
| 1.4 | Apagar produto em uso: em vez de apagar, abre escolha "as faixas X e Y usam este produto — mover para: [Select]"; só depois remove (D9/seção 6) | `LeadEconomicsEditor.tsx` | `[x]` com o foco indo para o "Mover para" |
| 1.5 | Linha discreta *"Seu corte de MQL é {n}."* ao lado das faixas (ou *"sem corte de MQL"*) — D19 | `LeadEconomicsEditor.tsx` | `[x]` |
| 1.6 | Botão "Limpar cadastro" com confirmação, que grava `lead_economics: null` | `LeadEconomicsEditor.tsx` / dialog | `[x]` feito diferente (D25): "Remover" sem confirmação, com Desfazer; cadastro gravado inválido ganha painel próprio com "Remover cadastro" |

### 13.2 Integração no diálogo

| # | Tarefa | Arquivo | Status |
|---|---|---|---|
| 1.7 | Nova seção **Economia do lead** em `PackJudgmentDialog`, abaixo das duas atuais, com o mesmo estado de "sem planilha integrada" que a seção de MQL usa. Reidratar no `useEffect` de abertura (o dialog é reaberto para packs diferentes). ~~`handleSave` envia `lead_economics` junto — sempre no payload~~ **(D21: só quando mudou; NÃO voltar a mandar sempre)**, `null` limpa. `updatePack` no store com o valor gravado | `frontend/components/packs/PackJudgmentDialog.tsx` | `[x]` + Esc/clique fora não fecham com alteração pendente; rascunho que ninguém tocou não bloqueia o save do MQL; moeda da conta do pack (D26) |
| 1.8 | Se o diálogo `size="lg"` ficar apertado com três seções, a saída é promover a seção a diálogo próprio aberto pelo `PackActionsMenu` — o editor é um componente isolado justamente para isso custar zero. Decidir em P1, não antes | — | `[~]` o diálogo passou para `2xl` (672px) e o corpo rola; decisão final na P1 |

**Design system (obrigatório, `authenticated-app-visual-standard.md`):** altura de
controle só via `size`; frase é `text-xs`, rótulo em maiúsculas pode ser `text-2xs`;
`rounded-md` em controle; tabela de faixas é leitura com ação — linha que é formulário
sobe um nível; foco `focus-inset`/`focus:border-primary`; `-N` só como tinta. O checker
roda no pre-commit.

**Ponto de parada P1 — revisão visual do cadastro.** O idealizador preenche o pack real do
Hookify com os números verdadeiros. O que se valida: os rótulos são entendidos sem
explicação? o teto por faixa ao vivo faz sentido? a transição 1 → 2 produtos é natural?
Só depois disso F2 começa.

## 14. F2 — Manager

A fase pesada. O checklist da memória `manager_metric_column_pipeline` é a espinha; o que
segue já está adaptado a uma métrica **derivada no cliente** (sem RPC, sem zod novo, sem
série).

### 14.0 Plano detalhado (2026-09-24, antes de codar)

Três achados da leitura do código mudam o texto original:

1. **Filhas já trazem `pack_ids`** (migration 134, `RankingsChildrenItem`). A 2.0e cai:
   cada variação se resolve pelos próprios packs, como qualquer linha.
2. **Os campos do motor de regras nascem de `MANAGER_METRIC_KEYS`** (`lib/rules/fields.ts`),
   e o Boards, o Critério e o /insights usam o mesmo motor sem o contexto do Manager. Se as
   métricas novas entrassem ali sem restrição, seriam campo oferecido que não responde
   (memória `rule_engine_offered_field_must_be_answerable`). Decisão: `availableIn`
   `["manager", "manager-children"]`, oferecidas só quando algum pack selecionado tem
   cadastro, e fora da ordenação dos Boards.
3. **O gate "só com planilha" está copiado à mão em três lugares** (`isManagerMetricColumnVisible`,
   `ManagerTable.isColumnEnabled`, `ManagerExportDialog`) com a mesma lista de quatro métricas —
   a armadilha "5 lugares" da memória. Vira uma regra só, `isManagerColumnAvailable`, lida das
   definições (`requiresSheetIntegration` / `requiresLeadEconomics`).

**Como a D27 entra no cálculo:** o contexto das métricas (`MetricValueContext`, o mesmo que já
leva `actionType` e `mqlLeadscoreMin`) ganha `leadEconomicsByPack` — o mapa `packId → cadastro`
dos packs SELECIONADOS (`null` = pack sem cadastro). `getMetricNumericValueOrNull` resolve a
linha pelos `pack_ids` dela. Assim célula, ordenação, filtro, regra, média e export ficam
certos pelo mesmo caminho, sem cada um reimplementar a resolução. Linha sem `pack_ids`
(payload antigo) = todos os packs selecionados. Sem o mapa no contexto, a métrica lê o campo
pré-calculado da linha (as filhas pré-calculam; ninguém mais tem esse campo).

**Célula própria (`LeadEconomicsCell`), não `MetricCell`:** o `MetricCell` é construído em volta
do sparkline, que estas métricas não têm (v0). A célula nova mostra o valor, a cor da Margem em
três estados (com tolerância 1e-9 no ponto de igualdade), o esmaecido de amostra pequena e o
motivo do vazio no `title` (sem pack com cadastro / packs com cadastros diferentes / sem lead
com nota) — `title` nativo, como o modo `lightweight` das outras células, para não montar um
Radix por célula.

**Fio:** `ManagerTable` e `ManagerChildrenTable` leem o mapa por hook
(`useLeadEconomicsByPack`), como a tabela já lê o corte de MQL — sem atravessar os três
componentes intermediários (e seus comparadores de memo) das variações. O mapa entra nos
parâmetros das colunas, no contexto das regras, nas três médias (pack, filtro, seleção), no
comparador do `TableContent` e no contexto do export.

| # | Tarefa | Status |
|---|---|---|
| 2.0a | `useLeadEconomicsByPack()`: `{ byPack, hasLeadEconomics }` com referência estável | `[x]` |
| 2.0b | `resolveRowLeadEconomics(packIds, byPack)` e `getRowLeadEconomics(row, byPack)` (resultado ou motivo), com cache; testes: pack único, mesmos números com ids diferentes (D20), cadastros diferentes, pack sem cadastro, linha sem `pack_ids`, pack fora do mapa | `[x]` |
| 2.0c | `aggregateRowsLeadEconomics(rows, byPack)`: média ponderada por leads, cada linha com o próprio cadastro; conta as linhas deixadas de fora e as abaixo da meta. Diferencial: com cadastro único bate com `computeLeadEconomicsForRows`. Sabotagem: média simples no lugar da ponderada | `[x]` |
| 2.0d | Aviso no cabeçalho quando a média deixou linhas de fora | `[x]` |
| 2.0e | ~~Filhas herdam `pack_ids`~~ — desnecessária (achado 1) | `[-]` |
| 2.0f | `isManagerColumnAvailable` substituindo as três listas copiadas; sabotagem: tirar a economia da regra e ver a coluna vazar | `[x]` |
| 2.0g | Motor de regras: `requiresLeadEconomics`, `availableIn` do Manager, fora da ordenação dos Boards; `RuleEvaluationContext.leadEconomicsByPack` | `[x]` |

### 14.0b Estado depois da implementação (2026-09-24)

As tarefas 2.1–2.17 abaixo estão feitas; as linhas da tabela original ficam como estavam
(o texto delas é anterior à D27). O que saiu diferente, e por quê:

- **2.3** — a média não usa `computeLeadEconomicsForRows` (um cadastro só): usa
  `aggregateRowsLeadEconomics`, com o cadastro de cada linha (D27). Com um cadastro só as
  duas dão o mesmo número — há teste diferencial de 300 casos provando.
- **2.5 / 2.17** — os testes ficaram em `lib/metrics/__tests__/leadEconomicsMetrics.test.ts`
  (leitura por linha, médias, colunas e regras juntos), `lib/utils/__tests__/leadEconomicsRows.test.ts`
  (a conta por linha) e `components/manager/__tests__/LeadEconomicsCell.test.ts`.
- **2.7** — virou `isManagerColumnAvailable` (regra única lida das definições); as três
  listas copiadas foram apagadas.
- **2.8 / 2.12 / 2.13** — o mapa vem por hook (`useLeadEconomicsByPack`) na `ManagerTable` e na
  `ManagerChildrenTable`, não por prop desde a página.
- **2.9–2.11** — célula própria (`LeadEconomicsCell`), motivo do vazio no `title`.
- **2.13** — nas variações o valor aparece em texto simples, **sem as cores da Margem** (as
  células das variações não têm cor em nenhuma métrica). Ordenação trata "sem valor" como 0.
- **2.14** — o filtro do Manager é o motor de regras (`getManagerFilterableColumns` não é
  mais chamado por ninguém); `Margem < 0` funciona por lá, só no Manager (D27, achado 2).
- **2.16** — a `TableSummaryBar` não é usada por ninguém: o resumo foi para a barra de
  filtros, ao lado do "Exibindo N de M" (`FilterBar.summarySlot`): *"7 de 23 abaixo da meta de
  margem"*. Aparece só com uma das duas colunas ligada. O "teto do pack" não foi repetido
  ali: é a média do cabeçalho da coluna.
- **Média sem cadastro nenhum** — com planilha mas nenhum pack da tela com economia, as três
  médias (pack, filtro, seleção) nem percorrem as linhas (revisão de 2026-09-26).
- **Seletor de colunas** — a dica de coluna indisponível passou a depender da métrica:
  "(requer economia do lead no pack)" em vez de "(requer planilha)".

Sabotagens provadas (cada uma quebrou o teste indicado e foi desfeita): média simples no
lugar da ponderada; ignorar a mistura de cadastros; tirar a folga do ponto flutuante; contar
o gasto das linhas excluídas; cache que devolve cadastro velho; `null` pré-calculado virando
0; campo oferecido sem cadastro; campo oferecido no Boards; métrica na ordenação dos Boards;
coluna sem o gate da economia; avaliador sem o mapa; filha formatando "R$ 0,00"; margem sem
a meta; sem esmaecido; motivo do vazio genérico; cor do Teto sem o toggle.

**Para olhar na P2 (decisões de tela):**
1. Cores da Margem (verde/amarelo/vermelho) — o sinal é lido certo? E as variações sem cor?
2. O aviso ⚠ no cabeçalho quando a média deixou anúncios de fora — claro?
3. "7 de 23 abaixo da meta de margem" na barra de filtros — ajuda ou polui?
4. Esmaecido de amostra pequena (< 20 leads com nota) — perceptível?
5. Motivos do vazio no `title` (passar o mouse) — suficiente, ou precisa de algo visível?
6. Regra salva sobre Margem com packs sem cadastro selecionados: não casa ninguém (mesmo
   comportamento das métricas de planilha sem planilha) — a condição continua visível na
   barra de filtros.

### 14.1 Registro da métrica

| # | Tarefa | Arquivo | Status |
|---|---|---|---|
| 2.1 | `MetricKey` ganha `cpl_ceiling` e `lead_margin`. Definições: `cpl_ceiling` — label "Teto de CPL", `formatKind: "currency"`, `polarity: "higher"`, `requiresSheetIntegration: true`, descrições didática/técnica. `lead_margin` — label "Margem", `formatKind: "ratioPercent"` (escala 0–1: o `FilterBar` divide o input por 100 para `ratioPercent`, então "filtrar margem < 0" e "< 40" funcionam sem código novo), `polarity: "higher"`, `requiresSheetIntegration: true`. Ambas com flag nova `requiresLeadEconomics: true` | `frontend/lib/metrics/definitions.ts` | `[ ]` |
| 2.2 | `MetricValueContext` ganha `leadEconomics?: LeadEconomics | null`. Cases em `getMetricNumericValueOrNull`: `cpl_ceiling` → `computeLeadEconomics(...)?.cplCeiling ?? null`; `lead_margin` → `.margin ?? null`. **Sem** case na série (`buildMetricSeriesFromSourceSeries`): não há sparkline no v0 | `frontend/lib/metrics/calculations.ts` | `[ ]` |
| 2.3 | `ManagerMetricKey`, `ManagerAverages` (dois campos + `leadMarginTarget` para o tooltip), `EMPTY_MANAGER_AVERAGES`, `computeManagerAverages` usando `computeLeadEconomicsForRows` (0.9) sobre as linhas — **não** entra em `MANAGER_SUM_FIELD_BY_METRIC` (não é soma) | `frontend/lib/metrics/manager.ts` | `[ ]` |
| 2.4 | `MetricSparklineKey`/`getMetricSeriesAvailability`: as duas chaves devolvem "sem série" pelo mesmo caminho das colunas vinculadas (140), que também não têm sparkline | `frontend/lib/metrics/timeSeries.ts` | `[ ]` |
| 2.5 | `registry.test.ts` continua verde (ele varre `METRIC_DEFINITIONS`); acrescentar caso: as duas métricas exigem planilha **e** economia | `frontend/lib/metrics/__tests__/registry.test.ts` | `[ ]` |

### 14.2 Coluna, gate e célula

| # | Tarefa | Arquivo | Status |
|---|---|---|---|
| 2.6 | `MANAGER_COLUMNS`: as duas colunas logo após `cpmql`, `defaultVisible: false`. `normalizeManagerColumnOrder` já anexa coluna nova ao fim de ordens salvas — sem migração de preferência | `frontend/components/manager/managerColumns.ts` | `[ ]` |
| 2.7 | **Gate em cinco lugares** (memória: não é DRY): `isManagerMetricColumnVisible` (ganha `hasLeadEconomics` nas opções) · `ManagerTable.isColumnEnabled` · o `isColumnDisabled` inline do filtro de colunas · o merge de `averages` no branch `averagesOverride` (as duas sempre de `computedAverages`, como as de leadscore) · `ManagerExportDialog.availableColumns`. Condição: `hasSheetIntegration && hasLeadEconomics` | `managerColumnPreferences.ts`, `ManagerTable.tsx` (3 pontos), `ManagerExportDialog.tsx` | `[ ]` |
| 2.8 | Fio da prop: `hasLeadEconomics` e `leadEconomics` entram em `ManagerTableProps` → `tableContentTypes.ts` → `TableContent` (**comparador do memo**, linha 104) → `managerTableMetricColumns` params → `MetricCell` (props **e comparador**, linha 62). Sem entrar no comparador a célula não re-renderiza quando o cadastro muda (memória `manager_table_memo_signal_prop_for_cell_rerender`) | `ManagerTable.tsx`, `tableContentTypes.ts`, `TableContent.tsx`, `managerTableMetricColumns.tsx`, `MetricCell.tsx` | `[ ]` |
| 2.9 | Blocos de coluna via `pushStandardMetricColumn` para as duas, com `MetricCell` em modo sem sparkline | `managerTableMetricColumns.tsx` | `[ ]` |
| 2.10 | Cor da **Margem** em três estados, pelo limiar e não pela média (é a semântica da métrica, D14): `≥ meta` → tom de sucesso, `[0, meta)` → alerta, `< 0` → destrutivo, via `getMetricValueTextClass`. Independe do toggle `colorMetricValue`. **Teto de CPL** segue o toggle normal. `lowSample` → `opacity-50` no valor | `MetricCell.tsx` | `[ ]` |
| 2.11 | Tooltip do valor: *"R$ 31,20 por lead com nota · teto R$ 17,91 · meta 40% · 42 leads com nota"*; com `lowSample`, prefixo *"número instável — "*. Célula vazia: `getManagerMetricEmptyKind` ganha os motivos `no-economics` (pack sem cadastro / packs divergem) e `no-scored-leads`, e o tooltip diz qual — a memória `rule_engine_offered_field_must_be_answerable` existe porque campo vazio sem motivo zera a tela em silêncio | `managerPresentation.ts`, `MetricCell.tsx` | `[ ]` |
| 2.12 | Página do Manager: `useLeadEconomics()` → `hasLeadEconomics={leadEconomics != null}` e `leadEconomics` para a tabela; contexto das métricas (`actionType`, `mqlLeadscoreMin`, …) ganha `leadEconomics` onde é montado | `frontend/app/manager/page.tsx` | `[ ]` |
| 2.13 | Tabela de filhos (`ManagerChildrenTable`, `ExpandedChildrenRow`, `CampaignChildrenRow`): as duas colunas passam pelo mesmo gate e recebem `leadEconomics` — os filhos têm `leadscore_histogram`, então a conta funciona por variação | `ManagerChildrenTable.tsx` e chamadores | `[ ]` |

### 14.3 Filtro, export, resumo

| # | Tarefa | Arquivo | Status |
|---|---|---|---|
| 2.14 | Filtro de coluna: `lead_margin` entra como `ratioPercent` (`isManagerRatioPercentMetric` já a inclui pela definição); `cpl_ceiling` numérico plain. Regra de exemplo a testar à mão: `Margem < 0` lista só quem dá prejuízo | `managerColumnPreferences.ts` (`getManagerFilterableColumns`) | `[ ]` |
| 2.15 | CSV: `lead_margin` em `RATIO_COLUMNS`; `cpl_ceiling` decimal padrão. O export delega visibilidade a `getVisibleManagerColumns`, então o gate de 2.7 já vale | `frontend/lib/utils/exportManagerCsv.ts` | `[ ]` |
| 2.16 | Barra de resumo: `TableSummaryBar` (a barra flutuante **abaixo** da tabela — é ela que existe; "topo" na D6 era o nome informal) ganha dois itens opcionais: *"Teto do pack R$ 17,91 · 7 de 23 abaixo da meta"*, calculados em `ManagerTable` sobre as linhas filtradas com `computeLeadEconomicsForRows` | `TableSummaryBar.tsx`, `ManagerTable.tsx` | `[ ]` |
| 2.17 | Teste de `managerColumnPreferences`: coluna nova invisível sem `hasLeadEconomics` mesmo com planilha; visível com os dois | `frontend/components/manager/__tests__/managerColumnPreferences.test.ts` | `[ ]` |

**Sabotagem obrigatória (2.7):** remover o gate de UM dos cinco lugares e conferir que a
coluna vaza (no export ou no seletor) — é assim que se prova que os cinco importam.

**Ponto de parada P2 — revisão visual do Manager.** Colunas ligadas no pack real: o
sinal da cor é lido certo? a média faz sentido? a barra de resumo ajuda ou polui? o
esmaecido de amostra pequena é perceptível sem ser feio?

## 15. F3 — Modal e link público

| # | Tarefa | Arquivo | Status |
|---|---|---|---|
| 3.1 | `LeadEconomicsBreakdown` — a tabela da seção 5 (Nota · Leads (fatia) · Produto · Conversão · Vale por lead), mais teto, CPL real, margem com a cor dos três estados e a meta, e a frase *"Conta feita com os {n} leads que casaram com a planilha."* Recebe o resultado de `computeLeadEconomics`, não recalcula | `frontend/components/ads/LeadEconomicsBreakdown.tsx` | `[ ]` |
| 3.2 | No `AdDetailsDialog`, junto do bloco MQL/CPMQL (linha ~557): `useLeadEconomics()` + `computeLeadEconomics` sobre `getLeadscoreRaw(effectiveAd) ?? getLeadscoreRaw(ad)`, respeitando o período sobrescrito como o MQL já faz; para linha agrupada, o histograma do detalhe (`resolvedDetailModel`). Sem cadastro: o bloco não aparece | `frontend/components/ads/AdDetailsDialog.tsx` | `[ ]` |
| 3.3 | Link público: comentário em `buildShareMetricsFromRow` dizendo por que `cpl_ceiling`/`lead_margin` **não** entram (D18) e teste que fixa o conjunto de chaves do snapshot — acrescentar qualquer uma das duas faz o teste falhar | `frontend/lib/share/buildShareItem.ts`, `frontend/lib/share/__tests__/buildShareItem.test.ts` (criar) | `[ ]` |
| 3.4 | Conferir que `ShareItemMetrics` (tipo) e o viewer público não ganharam os campos por engano; `grep` nos dois | `frontend/lib/share/types.ts`, página pública | `[ ]` |

**Ponto de parada P3 — modal.** A conta aberta explica o número da coluna? Se a resposta
for "não entendi de onde saiu", a tabela está errada, não o usuário.

## 16. F4 — Fechamento

| # | Tarefa | Arquivo | Status |
|---|---|---|---|
| 4.1 | ~~Aplicar a 175 em produção~~ **Movida para antes da P1 (D24).** Aplicar a 179 em produção (pelo session pooler — memória `db_connection`), depois `pg_dump --schema-only` → `supabase/schema.sql` e `py supabase/generate_schema_map.py` | `supabase/schema.sql`, `supabase/schema_map.md` | `[x]` 2026-09-24: coluna e CHECK conferidos no banco; 47 packs, nenhum com cadastro. O `schema.sql` regenerado trouxe junto as colunas de feedback de `chat_messages` (177 da frente do chat, já aplicada) |
| 4.2 | Deploy e smoke com a planilha real: cadastrar, ver coluna, filtrar `Margem < 0`, exportar, abrir modal, abrir link público e confirmar ausência | — | `[ ]` |
| 4.3 | Docs: `como-funciona-o-app.md` (seção "Métricas Enriquecidas (via Planilha)") ganha "Teto de CPL e Margem"; `app/docs/page.tsx` ganha a coluna `lead_economics` na tabela `packs` | `documentation/como-funciona-o-app.md`, `frontend/app/docs/page.tsx` | `[ ]` |
| 4.4 | Memória: aplicar o teste de três perguntas do `CLAUDE.md`. Candidata única até agora: **D15** (margem sobre faturamento × sobre a sobra) — só se a distinção puder voltar a custar num cálculo futuro (G.O.L.D./plano). Se passar, atualizar `decisoes-tecnicas.md` e a memória juntos | — | `[ ]` |
| 4.5 | Commits por fase (seção 18), cada um com testes verdes, `tsc` e `check:design-system` limpos | — | `[ ]` |

## 17. Armadilhas conhecidas (ler antes de cada fase)

Tudo aqui já custou bug neste projeto. Está na memória; repetido aqui para não depender dela.

- **Gate em cinco lugares** (2.7). Esquecer um deixa a coluna vazar no export ou no seletor.
- **Comparadores de memo** (`TableContent` e `MetricCell`): prop nova que não entra no
  comparador não re-renderiza a célula.
- **Store persistido rehidrata velho**: `useLoadPacks` precisa sincronizar o campo (0.14).
- **`null` nunca vira 0**: `Number(null)` é 0. Em toda leitura do cadastro, da margem e
  do teto, `null` atravessa como `null`.
- **Média de razões**: nunca média de tetos — sempre a conta sobre o histograma somado.
- **`ratioPercent` × `rawPercent`**: margem é 0–1 (`ratioPercent`); o filtro divide por 100.
- **Alturas de controle só por `size`**; `h-8`/`h-9` em className reprova no checker.
- **`-N` é tinta, não superfície**; esmaecido é `opacity-50`.
- **Chave de métrica é imutável**: `cpl_ceiling` e `lead_margin` não mudam depois do
  primeiro commit que as publica.
- **Número da migration**: a frente do chat já usa 175–178 (com arquivos `_rollback.sql` de mesmo número e efeito diferente) — por isso esta é a 179. A tabela de controle do Supabase não acompanha (parou na 127): conferir os arquivos das duas frentes e o objeto no banco.
- **Escrever arquivo por heredoc no Bash deste ambiente** já zerou dois arquivos (o Bash converte `\` e a escrita falha no meio). Editar com as ferramentas de edição; gerar por script só a partir de um arquivo de script.

## 18. Ordem de commits

1. `feat(packs): economia do lead — coluna, validação e a conta (F0)`
2. `feat(packs): cadastro de produtos e faixas na configuração do pack (F1)`
3. `feat(manager): colunas Teto de CPL e Margem (F2)`
4. `feat(manager): conta aberta no modal; link público não carrega economia (F3)`
5. `docs: economia do lead em produção (F4)` — junto de `schema.sql`/`schema_map.md`

Cada commit fecha com testes verdes. A migration vai no primeiro commit e é aplicada em
produção antes da P1 (D24), com `schema.sql`/`schema_map.md` regenerados no mesmo commit.

## Depois desta feature (pedido do idealizador — lembrá-lo)

- **Corte de MQL resolvido por linha, como a D27.** Hoje o corte de MQL segue a regra da
  tela (D16): packs selecionados com cortes diferentes apagam MQL, CPMQL e % de MQL da tela
  inteira. A mesma lógica da D27 vale para ele: cada linha usa o corte dos packs dela, a
  média pondera pelos leads e só a linha mista fica de fora. Deixado para depois para não
  misturar com esta feature. **Atenção:** o corte também é resolvido no SQL
  (`resolve_pack_mql_leadscore_min`) e no backend — mexer nele é trocar a regra nos três
  lugares que precisam concordar (ver comentário do topo de `resolveJudgment.ts`).

## Achados durante a execução

Revisão de 2026-09-22/23: 7 revisores por ângulo, 3 céticos por achado, sabotagem
independente. 34 achados confirmados e corrigidos; verificação final por achado.

**Corrigidos — o que vale lembrar:**
- **Validador do backend era O(n²)** (dedupe numa lista): um PATCH de 80 KB prendia um
  worker por 14 s. Dedupe com set nos dois lados + limite de custo na rota antes de validar.
- **Paridade TS × Python** presa por fixture compartilhada, com casos de bool (que no Python
  é int), inteiro acima de 2^53 (o navegador arredonda — o Python passa a gravar o float que
  o JS vai ler), comprimento em UTF-16, espaços Unicode do JS, NUL e surrogate solto (o
  Postgres recusa no jsonb → viram espaço/somem nos dois lados). O script gerador da fixture
  é versionado.
- **Precisão na ida e volta do rascunho** (D23), **rótulos de nota com 6 casas**, **chave D20**
  presa por teste em cada um dos 5 números, **linha de média** testada com notas em comum.
- A tela: erro no próprio campo, foco acompanhando as trocas de conteúdo, região viva
  sempre montada, moeda da conta (D26), cabeçalho que quebra em tela estreita.

**Para a F2 (não esquecer):**
- `computeLeadEconomics` aceita só gasto `number` — a linha do Manager precisa passar número.
- O invariante `margem ≥ meta ⇔ CPL ≤ teto` vale matematicamente, mas no ponto exato de
  igualdade o ponto flutuante pode separar as duas colunas (teto 8.399999999999999 × CPL
  8.4 com margem = meta). A cor dos três estados precisa de uma tolerância (ex.: 1e-9).
- `useLeadEconomics` devolve referência estável (memo pelo JSON) — entra nos comparadores
  de `TableContent`/`MetricCell` por referência sem redesenhar tudo.
- O editor mostra dinheiro em padrão brasileiro com código ("US$ 1.500,00"); o
  `formatCurrency` do app mostra USD em en-US. Na coluna do Manager o mesmo teto sairia nos
  dois formatos — decidir na F2.

**Conhecidos, fora do escopo, ainda abertos:**
- `usePackRefreshSync` (releitura ao voltar o foco para a janela) só copia campos de
  refresh; critérios de julgamento (inclusive o corte de MQL, já antes desta feature) só
  atualizam com F5. Em teste com duas contas/janelas, apertar F5.
- O histórico do pack diz "CPR alvo removido" a cada save de quem não tinha CPR alvo: o
  diálogo manda sempre `mql_leadscore_min` e `target_cpr` (comportamento anterior à feature).
- Pack compartilhado de conta de outra pessoa: a moeda cai na preferência de quem vê (a
  tela avisa). Resolver de verdade exige o backend mandar a moeda da conta do dono no pack.
- Leitor de pack compartilhado não vê o cadastro na F1 (o menu esconde os critérios para
  leitor); ele vê o resultado nas colunas da F2.
- Em celular (360px), a coluna "Teto por lead" fica fora da área visível da tabela de
  faixas, que rola na horizontal.
- O diálogo não tem teste de componente (o repositório não tem DOM de teste); toda regra
  dele foi extraída para funções puras testadas, mas a ligação em si é conferida lendo.

# Roadmap — Pastas de packs, seleção em massa e ações em lote

> **Documento vivo.** Atualize o status conforme os lotes forem concluídos.
>
> Criado em: 2026-09-04 · Lote 3 medido em 2026-09-05
> Status: **desenho aprovado, nada implementado em produção**
>
> Mockup navegável (leque, seleção em massa, barra atual × proposta, três
> densidades): https://claude.ai/code/artifact/45cb97c6-0ef1-461c-9780-1190a50b5cb3
>
> Capítulo irmão de [roadmap-pack-como-unidade.md](roadmap-pack-como-unidade.md).
> Aquele move a unidade de **configuração e colaboração** do usuário para o pack.
> Este resolve a **organização e a operação em lote** de muitos packs. São eixos
> diferentes: um é sobre o que o pack *é*, o outro é sobre como você *lida com 30 deles*.

---

## Tese

Usuários ativos passam de 30 packs. A tela `/packs` desenha um card alto por pack,
sem nenhuma noção de agrupamento — a tabela `packs` não tem coluna de pasta, e a
tabela `tags` existente está ligada a anúncios (`ad_tags`), não a packs.

O resultado é uma tela poluída e uma operação impossível: para agir sobre "os packs
do Cliente A" hoje é preciso lembrar o prefixo do nome, buscar, e então descobrir
que o botão "Selecionar todos" só aparece **depois** de selecionar um pack à mão.

Três frentes, nesta ordem:

```
Lote 1 — Seleção e ações em massa    (não depende de banco; ganho imediato)
      ▼
Lote 2 — Pastas                       (migration 141; resolve a poluição)
      ▼
Lote 3 — Densidade (cartão/compacto/lista)  (frente separada, sem dependência)
```

---

## Por que pasta, e não etiqueta

Decidido em 2026-09-04 pelo idealizador, contra a minha recomendação inicial de
etiquetas. **A decisão está certa, e o argumento é mecânico, não estético:**

- **Etiqueta classifica. Pasta colapsa.** A dor real não é "não acho meus packs" —
  é "tenho 30 cards altos na tela". Etiqueta não remove **nenhum** card da tela;
  ela só acrescenta mais um filtro. Pasta transforma 30 cards em ~8.
- **A exclusividade não é limitação da pasta — é o que faz o colapso existir.**
  Se um pack pudesse morar em duas pastas, seria desenhado duas vezes e a tela
  ficaria *mais* cheia. Dos três modelos avaliados (etiqueta múltipla, pasta
  exclusiva, grupo derivado de regra), **só a pasta resolve o problema que existe.**
- **O gesto é mais curto.** Com etiqueta: filtrar → selecionar → agir. Com pasta:
  os packs já estão juntos; abrir e agir.

**O que se perde:** o recorte transversal ("esse pack é do Cliente A *e* do Q4").
**Não vamos resolver isso agora.** Os eixos são separáveis e não competem:

| | Pasta | Etiqueta (futuro, se doer) |
|---|---|---|
| Semântica | onde o pack **mora** | como você o **encontra** |
| Cardinalidade | exclusiva | múltipla |
| Efeito na tela | colapsa | filtra |

Etiqueta de pack entra por cima, sem refazer nada, se e quando o recorte transversal
doer de verdade. **Não implementar preventivamente.**

### Rejeitado: grupo derivado de regra

"Todo pack cujo nome começa com CLI-A" — zero manutenção, e é literalmente o que o
usuário já fazia à mão. Rejeitado porque **não colapsa** (mesmo problema da etiqueta)
e porque depende de disciplina de nomenclatura: pack mal nomeado some do grupo em
silêncio. É a mesma família do pertencimento derivado dos Boards, mas lá o problema
era classificar criativos, não desentulhar uma tela.

---

## Lote 1 — Seleção e ações em massa

Não toca no banco. Entrega valor sozinho, antes de qualquer pasta existir.

### 1.1 Matar o ovo-e-galinha da seleção

O comportamento de seleção **já está correto**: `useMultiSelect(visiblePackIds)`
(`app/packs/page.tsx:284`) monta a seleção sobre os packs *visíveis pós-busca*, então
"buscar por prefixo → selecionar todos os que sobraram" já funciona. O problema é
puramente de descoberta:

- o botão "Selecionar todos" vive **dentro** da `BulkActionsBar`, que só renderiza
  com `selectedCount > 0` (`components/common/BulkActionsBar.tsx:62`);
- o checkbox do card é `opacity-0` até o hover (`app/packs/page.tsx:814`).

A única porta para "selecionar tudo" está atrás de "selecione um primeiro".

**Correção:** checkbox mestre **fixo no toolbar** do `/packs`, sempre visível quando
`showPacksToolbar`, com estado `indeterminate` (`someSelected` já existe no hook) e
rótulo que conta o universo real: `Selecionar todos (24)` — ou `(6 de 24)` quando há
busca ativa, porque o universo do "todos" é o pós-busca e isso precisa estar dito.

### 1.2 Repintar a `BulkActionsBar`

A barra usa `bg-card` — **a mesma cor do fundo dos cards de pack** — com altura de
controle padrão e `text-xs`. Ela não tem contraste com o que está atrás dela.

**Correção:** fundo invertido (`bg-foreground` / texto `bg-background`), altura maior,
ícones maiores, contador em destaque. É o componente compartilhado com o `/manager`,
então **a correção melhora as duas telas**.

Manter flutuante. A alternativa avaliada — toolbar virando "modo de seleção" estilo
Gmail/Linear — foi **rejeitada**: criaria uma segunda superfície de ação, já que no
`/manager` a barra flutuante foi escolhida de propósito (lá o toolbar já disputa
espaço com busca e filtros; ver memória `manager_filterbar_popover_pattern`).

### 1.3 Ações novas

| Ação | Custo | Desenho |
|---|---|---|
| **Compartilhar N packs** | Baixo | Laço sobre `POST /pack-shares/{id}`, que já existe e é um-a-um. Um destinatário, um papel, relatório de falhas no fim (mesmo padrão de `handleBulkRemoveSheetIntegration`). |
| **Transcrever N packs** | Médio | **Diálogo agregado**, não o `TranscriptionStatusDialog` atual. Ele carrega o status de **um** pack e pede escolha anúncio a anúncio (`TranscriptionStatusDialog.tsx:59`). Em massa: só o total — "312 anúncios sem transcrição em 6 packs" — e um botão. |
| **Mover para pasta** | Lote 2 | O gesto central da pasta: seleciono, clico, eles vão. |

**Por que transcrição em massa não pede escolha fina:** a transcrição custa por minuto
de áudio no AssemblyAI. Escolher 312 anúncios um a um não é uma tela, é uma punição —
mas disparar sem ver o volume é um cheque em branco. O total agregado **antes** do
botão é o que torna a ação honesta. A escolha fina continua existindo no modo de um
pack só, que é onde ela faz sentido.

---

## Lote 2 — Pastas

### 2.1 Modelo de dados (migration 141)

```
folders(id, user_id, name, color, parent_id NULL → folders.id, created_at, updated_at)
pack_folder_members(user_id, pack_id, folder_id, created_at)
  UNIQUE (user_id, pack_id)          ← a exclusividade mora aqui
```

**Decisão 1 — a pasta é de quem organiza, não do pack.** Tabela de vínculo com
`user_id`, **nunca** uma coluna `folder_id` em `packs`.

*Por quê:* pack compartilhado. Se o dono compartilha "Cliente A — Junho" comigo, eu
preciso guardá-lo na *minha* pasta sem tocar no *seu* pack — e a RLS de `packs`
(`user_id = auth.uid()`) nem me deixaria escrever lá. Uma coluna em `packs` quebra
isso, e a gente só descobre quando o primeiro convidado tentar organizar a tela dele.

**Isto NÃO contradiz a migration 139** (que moveu `ad_tags` para o silo do pack). A
assimetria é real e vale entender, porque a leitura apressada é "tag virou coletiva,
logo pasta também deveria":

- A **tag classifica o conteúdo compartilhado** (o anúncio). O anúncio é o mesmo para
  todo mundo, e dois vocabulários invisíveis um para o outro só produzem duplicata.
- A **pasta organiza uma lista que é diferente para cada pessoa**: meus packs + packs
  que N donos diferentes compartilharam comigo. Como a lista não é a mesma, a
  organização dela não pode ser coletiva — pastas de dois donos colidiriam de nome na
  tela do convidado, e ele não poderia reordenar a própria casa.

Regra geral que fica: **classificação de conteúdo é do silo; organização de workspace
é de quem olha.**

**Decisão 2 — `parent_id` no schema desde já, UI plana.** Pasta dentro de pasta ficou
para depois (decisão do idealizador, e concordo para a UI). Mas a coluna auto-referente
custa ~zero agora e custa migration + rework de toda a navegação depois. Schema pronto,
tela plana. Enquanto a UI for plana, `parent_id` é sempre `NULL`.

**Decisão 3 — a pasta é atalho de seleção, não sujeito de permissão.** "Compartilhar
pasta" compartilha os packs que estão nela **naquele momento**, e a tela diz isso com
todas as letras. Não existe `folder_shares`.

*Por quê:* se a pasta fosse dona da permissão, um pack movido para dentro dela depois
herdaria acesso em silêncio — alguém veria dado que o dono não decidiu mostrar. Este
projeto já reverteu uma herança invisível (o julgamento herdado; ver
`pack_owned_judgment_no_inheritance`); herança invisível de **acesso** é
categoricamente pior.

**Decisão 4 — conflito cross-owner é aceito na pasta, avisado na seleção.** Existe
trava real: dois packs de **donos diferentes** com o mesmo anúncio no mesmo dia não
podem ser analisados juntos, senão o total mente (`backend/app/routes/pack_shares.py:130`,
RPC `detect_pack_conflicts`). Uma pasta pode acabar contendo esse par.

A pasta **aceita** — ela é organização, não análise. Mas "selecionar a pasta" no
seletor global do topo marca o que dá e **diz o que ficou de fora e por quê**. Silêncio
aqui produziria um total errado sem nenhum sinal na tela.

### 2.2 Desenho visual

**O card de pasta é um maço de packs.** O vocabulário visual já existe no código: o
skeleton de `/packs` desenha dois cards rotacionados a ±1.5° atrás do card real
(`app/packs/page.tsx:62-64`). É literalmente "packs empilhados".

```
  [ Cliente A ]   [ Q4 2026 ]   [Pack solto]   [Pack solto]
   ╱╲ 12 packs     ╱╲ 4 packs
        │ clique
        ▼
  ‹ Cliente A · 12 packs                    [ações da pasta]
  [pack] [pack] [pack] [pack]
  [pack] [pack] [pack] [pack]
```

**Abrir expande no lugar**, com o leque se abrindo (decidido; a alternativa
`/packs?folder=x` foi preterida por ser menos fluida). O leque não é enfeite: ele
comunica *"aqui dentro tem mais de um"*, que é exatamente a informação que a pasta
carrega. E o CSS já existe.

*Custo aceito da escolha:* sem URL própria — recarregar a página volta para a raiz.
Aceitável porque a pasta é organização pessoal, não um link que se compartilha.

**Criar pasta** é o gesto de seleção: selecionar N packs → "Mover para pasta" →
pasta existente ou nova. Não há uma tela de "gerenciar pastas".

---

## Lote 3 — Densidade

Explorado no mockup em 2026-09-05, antes do previsto, porque a pasta cheia expõe o
problema e decidir isso lendo é pior do que decidir olhando. Continua **separado dos
lotes 1 e 2**: não depende de migration nenhuma e dá ganho antes de as pastas existirem.

### O que foi medido

Três modos no seletor do toolbar, com 30 packs, 4 colunas, viewport de 1100px:

| Modo | Altura por pack | 30 packs | Telas de rolagem |
|---|---:|---:|---:|
| Cartão (hoje) | 370 px | 3.213 px | 3,9 |
| Compacto | 206 px | 1.841 px | 2,2 |
| Lista | 50 px | 1.693 px | 2,0 |

### O achado é contra-intuitivo

**Compacto e Lista custam praticamente a mesma altura** (2,2 × 2,0 telas). A lista
gasta uma linha por pack; o compacto gasta uma linha a cada quatro. Em 4 colunas isso
quase empata — a intuição de que "lista é muito mais denso" está errada.

**A diferença real não é densidade, é comparabilidade.** Na lista os números de packs
diferentes caem na **mesma coordenada horizontal**: dá para varrer a coluna de
investimento de cima a baixo e achar o fora da curva. No cartão, cada número está numa
posição diferente da tela — dá para *ler* um pack, não para *comparar* dez.

**Consequência de produto:** os três modos coexistem em vez de um substituir o outro.
Cartão para reconhecer, lista para comparar, compacto quando já se sabe o que procurar.
Trocar o cartão por um cartão menor e parar por aí seria resolver metade do problema —
a metade menos interessante.

### Decisões que faltam

- **A densidade é lembrada?** Provável `user_preferences` (a tabela já existe), mas é
  preferência de tela, não de julgamento — confirmar antes de codar.
- **A pasta pode abrir num modo diferente da raiz?** Cartão na raiz (poucas pastas,
  reconhecimento) e lista dentro da pasta (muitos packs, comparação) é plausível, e
  seria a resposta mais direta para "pasta cheia volta a poluir".

---

## Fora de escopo

**Pasta dentro de pasta.** Schema pronto (`parent_id`), UI não. Revisitar com uso real.

**Etiqueta de pack.** Ver "O que se perde" acima. Só com evidência de que o recorte
transversal dói.

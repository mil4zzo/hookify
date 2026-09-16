# Padrao Visual Base do App Autenticado

## Objetivo

Garantir que as paginas autenticadas compartilhem o mesmo shell, header, acoes,
tabs e receitas de corpo. A feature muda; a estrutura visual permanece
previsivel.

## Estrutura canonica

Toda pagina autenticada deve seguir esta ordem:

1. `PageContainer` como shell raiz.
2. `variant="standard"` ou `variant="analytics"` explicito.
3. `PageActions` para acoes do header.
4. Uma receita de corpo em `components/common/layout`.
5. O conteudo especifico da feature dentro da receita.

Exemplo:

```tsx
<PageContainer
  variant="analytics"
  title="Titulo"
  description="Descricao"
  actions={<PageActions>{actions}</PageActions>}
>
  <AnalyticsWorkspace>
    <TabbedWorkspace tabs={tabs} value={tab} onValueChange={setTab}>
      {content}
    </TabbedWorkspace>
  </AnalyticsWorkspace>
</PageContainer>
```

## Componentes obrigatorios

- `PageContainer`: shell de paginas internas.
- `PageSectionHeader`: renderizado por `PageContainer`.
- `PageActions`: area de acoes do header.
- `TabbedWorkspace`: receita preferida para tabs de pagina.
- `WorkspaceState`: empty e error de corpo.
- `StatePanel`: estados internos de widget, tabela, painel ou dialog.
- `InlineNotice`: avisos inline de warning, erro, info ou sucesso.
- `StateSkeleton`: skeleton generico de pagina, widget, tabela ou media.

## Variantes de pagina

### `standard`

Use para paginas lineares, formularios e documentacao: `packs`, `docs`,
`upload`, `planos`, onboarding e settings-like pages.

Receitas comuns:

- `PageBodyStack`: fluxo vertical padrao.
- `FormStepWorkspace`: paginas com steps, breadcrumb e acoes de navegacao.
- `FormPageSection`: secoes de formulario, onboarding e settings com titulo,
  descricao, acoes e footer opcionais.
- `WorkspaceState`: estados de empty/error.
- `StateSkeleton`: loading estrutural de pagina/corpo.
- `StatePanel`: vazio/erro/loading dentro de um painel existente.
- `InlineNotice`: avisos de formulario, upload e validacao.

### `analytics`

Use para tabelas grandes, dashboards e workspaces com scroll interno:
`manager`, `insights`, `gold`, `explorer`, `admin` e `meta-usage`.

Receitas comuns:

- `AnalyticsWorkspace`: wrapper flexivel com `min-h-0`.
- `TabbedWorkspace`: tabs e controles padronizados.
- `TableWorkspace`: filtros/toolbar mais uma area principal de tabela.
- `KanbanWorkspace`: kanban horizontal ou vertical.
- `DashboardGrid`: grids responsivos de cards/widgets.
- `WidgetPanel`: paineis de widget com header, acoes, densidade e scroll.
- `WorkspaceState`: estados empty/error centralizados.
- `StatePanel`: estados de widget/tabela/modal quando o corpo ja existe.
- `StateSkeleton`: skeletons genericos; preserve skeleton local apenas para
  media, charts ou linhas de tabela com formato real.

## Estados canonicos

Use a menor camada que descreve o contexto:

- Loading de pagina inteira ou corpo de workspace: `StateSkeleton`.
- Empty/error de pagina inteira ou corpo de workspace: `WorkspaceState`.
- Estado dentro de card, widget, tabela ou modal: `StatePanel`.
- Aviso inline que nao substitui o conteudo: `InlineNotice`.
- Loading estrutural generico: `StateSkeleton`.
- Loading de video/media/chart/tabela com forma especifica: skeleton local
  documentado pelo checker.

Exemplos:

```tsx
<StateSkeleton variant="page" rows={4} />
<WorkspaceState kind="error" message="Nao foi possivel carregar os dados." fill />
<StatePanel kind="empty" message="Nenhum resultado com esses filtros." framed={false} />
<InlineNotice tone="destructive">Falha ao validar os dados.</InlineNotice>
<StateSkeleton variant="widget" rows={3} />
```

## Densidade

As receitas principais aceitam `density?: "compact" | "default" | "spacious"`
quando a densidade altera espacamento sem mudar a estrutura.

- `compact`: tabelas, filtros e paineis densos.
- `default`: paginas e widgets comuns.
- `spacious`: onboarding, upload, formularios longos e fluxos por etapa.

Prefira `density` antes de adicionar `gap-*`, `space-y-*`, `p-*` ou
`min-h-0` localmente. Use classes locais apenas quando o conteudo realmente
precisar de uma excecao.

## Sidebar

Sidebar de pagina e um recurso do `PageContainer`, nao um layout paralelo:

```tsx
<PageContainer
  variant="analytics"
  title="Explorer"
  fullWidth
  pageSidebar={sidebar}
  pageSidebarClassName="md:w-[360px]"
  contentClassName="min-w-0"
>
  <AnalyticsWorkspace>{workspace}</AnalyticsWorkspace>
</PageContainer>
```

Use `pageSidebar` quando o conteudo precisa de uma coluna lateral propria, como
Explorer. O header continua pertencendo ao `PageContainer`.

## Escape hatches

- `fullHeight`: compatibilidade legada; prefira `variant="analytics"`.
- `fullWidth`: apenas quando a pagina precisa sair do container padrao.
- `hideHeader`: uso restrito para estados internos que preservam o shell.
- `pageSidebar`: workspaces com coluna lateral propria.

## Primitivos preferidos

- `StandardCard` para cards e paineis autenticados.
- `AppDialog` para dialogs do app.
- `ToggleSwitch` para switches com label.
- `TabbedWorkspace` para tabs de pagina.

Direto `Card`, `Modal`, `Dialog` e `Switch` so devem aparecer em primitivas,
excecoes documentadas ou legado ainda nao migrado.

Regras rapidas:

- Card de app autenticado: `StandardCard`.
- Widget com titulo/acoes: `WidgetPanel`.
- Formulario/setting/onboarding: `FormPageSection`.
- Dialog: `AppDialog` com `title` acessivel.
- Switch com texto: `ToggleSwitch`.
- Switch cru: apenas em controles compactos de tabela/grafico.
- Filtro de lista em popover (multi ou single select, com busca/bulk/grupos):
  `FilterListPopover` — nunca reimplementar popover+lista+checkbox.
- Indicador de selecao em linha clicavel: `CheckSquare` (presentacional;
  para checkbox standalone com foco/teclado, `ui/checkbox`).
- Busca com lupa e botao de limpar: `SearchInputWithClear`.
- Chip de filtro com operador/valor embutidos: pecas de `manager/FilterChip`.

## Contrato de controles (sizing)

Controles interativos (Button, Input, SelectTrigger, Combobox,
FilterSelectButton) tem a altura definida DENTRO do componente, via variant
`size`. Call sites nunca definem altura.

### Regra binaria

- Altura de controle: SEMPRE via prop `size`, NUNCA via `className` com
  `h-*`/`w-*` de escala core (`h-8`, `h-9`, `h-10`...).
- Se o tamanho necessario nao existe, adicione uma variant em
  `components/ui/` — nao improvise classe no call site.
- `h-auto` e permitido quando o controle deve colapsar para a altura do
  conteudo (chips, links inline, botoes dentro de barras compactas).

### Vocabulario de tamanhos

| Variant | Token | Altura | Quando usar |
|---|---|---|---|
| `size="default"` | `h-control-default` | 40px | Toolbars, filtros, formularios — o padrao |
| `size="sm"` | `h-control-compact` | 32px | Contextos densos: linhas de tabela, builders, admin |
| `size="xs"` (SelectTrigger) | `h-control-chip` | 24px | Chip seletor de uma palavra (conector E/OU do construtor). Nao e campo de formulario |
| `size="lg"` (Button) | `h-control-large` | 48px | CTAs de marketing/waitlist |
| `size="icon"` (Button) | `control-default` quadrado | 40x40 | Botao so-icone |

Barras de ferramentas (busca + filtros + acoes em lote) alinham tudo em
`h-control-default`; itens internos compactos usam `size="sm"` ou `h-auto`.

### Por que existe (twMerge)

O `cn()` usa `extendTailwindMerge` com os tokens custom registrados
(`lib/utils/cn.ts`). Isso significa que um `h-8` passado em `className`
HOJE SOBRESCREVE o token do componente — antes era silenciosamente morto.
Por isso a regra e nao passar altura em call site: o override funciona,
mas quebra a padronizacao. O checker aponta violacoes.

Ao adicionar token novo em `tailwind.config.ts` (`theme.extend.spacing`),
registre-o tambem em `SPACING_TOKENS` de `lib/utils/cn.ts`.

### Documento vivo

Ao tomar uma decisao de design que diverge deste contrato (nova variant,
nova excecao, novo padrao de barra), atualize esta secao no mesmo commit.

## Contrato de tokens (superficie, estado, tipografia, elevacao, z-index)

### Tipografia

- Escala: `text-2xs` (10px, caption/overline) e a escala core (`text-xs` 12px
  para cima). `text-2xs` e o UNICO degrau abaixo de `text-xs` — nao criar
  `text-[10px]`/`text-[11px]`/`text-3xs`.
- `text-[Npx]` arbitrario e violacao (regra `arbitrary-font-size`). Tamanhos
  display em `rem` (titulos hero) e relativos em `em` (superscript) sao
  permitidos.

### Superficie (contrato de elevacao)

Toda superficie estrutural sai de UM destes cinco degraus. A escada anda sempre
**para longe do fundo da pagina**: no tema escuro clareia a cada degrau, no claro
escurece. Nunca o contrario, e nunca dependendo do tema.

| Degrau | Token | Onde | Regra |
|---|---|---|---|
| Pagina | `bg-background` | body, area de pagina | nao recebe sombra |
| Rebaixado | `bg-muted` | poco, faixa de secao, linha alternada | nao contem outro conteiner |
| Base | `bg-card` | cartao, modal, painel | o degrau padrao de conteudo |
| Elevado | `bg-surface-2` | grupo dentro de cartao, campo, celula em destaque | `shadow-elevation-raised` |
| Flutuante | `bg-surface-3` | popover, menu, tooltip | unico com `shadow-elevation-overlay` |

`bg-popover` e alias historico de `bg-card`; em codigo novo, use `bg-card`.

**Poco ou grupo? Pergunte se a pessoa le ou age.** Onde se LE — lista rolavel,
historico, previa de dados, resumo do que vai acontecer — e poco (`bg-muted`, mais
fundo que o cartao). Onde se AGE — opcoes de escolha, membros com papel, ajustes com
toggle, condicoes — e grupo elevado (`bg-surface-2`, mais alto que o cartao). Sem
fundo proprio, um conjunto de acoes dentro de dialogo se dissolve e parece
desabilitado.

**A regra que isso substitui:** superficie estrutural em repouso NAO pode vir da
escala alpha (`bg-card-20`, `bg-input-30`, `bg-muted-50`...). A escala gera
`color-mix(in oklab, var(--token) N%, var(--background))` — mistura com o fundo da
PAGINA, nao com a superficie que esta atras do elemento. Sobre um cartao mais claro
que a pagina, o resultado sempre afunda no tema escuro e sempre eleva no claro: a
hierarquia inverte de sinal ao trocar de tema, sem ninguem decidir. Regra
`structural-alpha-surface` no checker.

Continuam validos, e nao sao violacao:

- **Tinta semantica** sobre a pagina — `bg-primary-10`, `border-destructive-30`,
  `bg-success-10`. Ali a intencao e mesmo um veu da cor, e o mix com o fundo e o
  comportamento certo.
- **`bg-background-{n}`** — o mix e com a propria cor, entao e alpha de verdade
  (overlay de modal).
- **Variante de estado** — `hover:bg-*`, `data-[state=open]:bg-*`. Estado tem receita
  propria (ver abaixo), e o token de hover do app e `accent`.

**Aninhamento le mais forte, nunca mais fraco.** O nivel mais profundo (um subgrupo
dentro de um painel) e o que carrega a informacao mais importante; ele precisa ser o
elemento mais definido da tela, com superficie propria e borda solida. Borda tracejada
le como placeholder ou area de drop — nao use para agrupar conteudo real.

**`bg-border` e cor de linha.** Serve para divisor, trilho de progresso e bloco SEM
texto — placeholder de midia ausente e skeleton, onde o tom medio da escala e o unico
que aparece sobre qualquer superficie nos dois temas. Como fundo de texto nao: sob
`muted-foreground` o contraste cai para ~2,4:1. Caixa com texto dentro de dialogo e
poco (`bg-muted`).

**Nao use `bg-background` como caixa dentro de cartao ou dialogo.** No escuro vira o
buraco mais fundo possivel; no claro vira uma caixa MAIS CLARA que o cartao. Poco e
`bg-muted`.

**Lista de itens com acoes** (membros, conexoes): um grupo elevado so
(`bg-surface-2` + contorno), com as linhas divididas por filete (`divide-y
divide-border`) — nao uma caixa por item. Lista de pessoas leva identidade
(iniciais + nome + detalhe), senao le chapada.

**Nem tudo e cartao.** Borda, preenchimento, raio e sombra dizem "objeto separado".
Gaste por papel: um bloco que ja esta dentro de um cartao raramente precisa da propria
moldura, e uma linha cujas colunas ja sao controles com borda nao precisa de caixa em
volta — vira moldura dentro de moldura.

### Escala alpha (tinta semantica)

A escala `-N` existe em rampa regular: **10, 20, 30, 40, 50, 60, 70, 80, 90**. Ela
gera `color-mix(in oklab, var(--token) N%, var(--background))` — um veu da cor sobre
o fundo da pagina. Por isso serve para **tinta**, e nao para superficie (ver acima).

Papeis de referencia (nao obrigatorios, mas o que a maior parte do app ja usa):

| Passo | Papel |
|---|---|
| `-10` | fundo suave (chip, badge, linha destacada) |
| `-20` | fundo com enfase, parada de gradiente |
| `-30` | borda de estado |
| `-50` | borda forte, inicio de gradiente |
| `-80` / `-90` | quase solido, hover de solido |

**Por que de 10 em 10.** Medido em OKLab: dois passos a 5 pontos de distancia valem
dE 1,2 a 3,8 — no limiar de percepcao. Eram variantes que o olho nao separa e que
cada tela escolhia no chute (a escala antiga tinha 5, 45, 75, 82, 88 e 95). A 10
pontos a diferenca e visivel (dE 3 a 7), entao cada passo que sobrou significa algo.

Duas armadilhas que **nao dao erro — o estilo simplesmente some**:

- **Passo fora da rampa** (`bg-primary-5`, `bg-primary-15`) nao gera classe. Regra
  `alpha-step-out-of-scale`. `card` e `popover` nao tem escala nenhuma.
- **Barra de opacidade em token do tema** (`bg-destructive/5`) nao gera CSS no
  Tailwind 3: a cor e `var(--x)`, sem `<alpha-value>`, e o compilador descarta a
  classe. Use o hifen (`bg-destructive-10`). A barra continua valendo para a paleta
  padrao do Tailwind (`bg-black/60`). Regra `semantic-color-slash-opacity`.

Uma terceira, do mesmo tipo: `var(--x)` indefinida **sem fallback** dentro de um
valor nao estraga so aquela parte — invalida a declaracao inteira. Um gradiente que
cita uma parada inexistente vira `background-image: none`.

### Estado (hover, foco, selecao)

- **Abas e controles segmentados**: trilho rebaixado (`bg-muted` + `border-border`);
  a opcao ativa se destaca (aba em `primary` solido, segmento em `secondary`).

- **Hover de linha de tabela de dados**: `hover:bg-muted` — sutil, porque muda a cada
  linha que o mouse cruza. Linhas herdam o fundo do painel onde estao (sem `bg-*`
  proprio).
- **Hover de objeto clicavel, item de menu e lista de opcoes**: `hover:bg-accent`.
  Botao DENTRO de uma linha usa `accent`, para nao se confundir com o hover da linha.
  Nao invente mistura propria.
- **Foco**: anel via `focus-visible:ring-ring` — nunca so mudanca de cor de fundo.
- **Item selecionado** (linha de lista ou tabela): `bg-primary-10` + `border-primary-30`.
- **Opcao escolhida** (cartao de escolha, estilo radio): `bg-primary-10` + `border-primary`
  solido. A nao escolhida e grupo elevado: `bg-surface-2` + contorno + `hover:bg-accent`.
  Sem fundo ela parece desabilitada; desabilitada de verdade e sem fundo + `opacity-50`.
- **Desabilitado**: `disabled:opacity-50` das primitivas; nao rebaixar cor a mao.

### Elevacao

- Unica escala: `shadow-elevation-flat` (none), `shadow-elevation-raised`
  (chrome sutil: cards, controles outline) e `shadow-elevation-overlay`
  (flutuantes: popover, dropdown, tooltip, dialog, enfase de hover/selecao).
- `shadow-sm/md/lg` crus sao violacao (regra `raw-shadow`); os overrides
  antigos foram removidos do tailwind.config.

### Z-index

- Camadas de app SEMPRE por token: `z-sticky` (40, topbar/sidebar/nav fixo),
  `z-overlay` (50, overlays de captura e fullscreen), `z-modal` (60),
  `z-dropdown` (70, popover/combobox/select), `z-toast` (80), `z-tooltip` (90).
- Stacking LOCAL (dentro de um card, tabela ou container proprio) pode usar
  `z-10`/`z-20` core — nao e camada de app.
- `z-[N]` arbitrario >= 60 e violacao (regra `arbitrary-z-index`). Excecao
  documentada: modal-sobre-modal (`z-[70]`/`z-[80]` no date-range-picker).

### Registro de tokens novos

Todo token novo em `tailwind.config.ts` precisa tambem do registro no
`extendTailwindMerge` de `lib/utils/cn.ts` (spacing em `SPACING_TOKENS`;
boxShadow/zIndex/fontSize em `classGroups`), senao overrides via `cn()`
quebram silenciosamente para ele.

### Tailwind 3.4, nao 4

O projeto roda Tailwind **3.4**. O registro atual do shadcn ja emite sintaxe da v4,
e colar um componente de la produz classes que **nao geram CSS** — sem erro:

| v4 (morta aqui) | v3.4 |
|---|---|
| `aria-invalid:` | `aria-[invalid=true]:` |
| `has-focus:` | `has-[:focus]:` |
| `**:[seletor]:` | `[&_seletor]:` |
| `rounded-xs`, `shadow-xs` | nao existem (use `rounded-sm`, `shadow-elevation-raised`) |
| `outline-hidden`, `bg-linear-to-*` | `outline-none`, `bg-gradient-to-*` |

Regra `tailwind-v4-syntax`. Na duvida sobre uma classe, compile:
`npx tailwindcss -c tailwind.config.ts -i in.css --content arquivo.html -o out.css`
e procure o seletor no `out.css`.

### Enforcement

- `npm run check:design-system` roda automaticamente no pre-commit (husky,
  `frontend/.husky/pre-commit`) junto com `tsc --noEmit`.
- Excecao intencional: comentario `// design-system-exception: rule-id - razao`
  na linha imediatamente acima da violacao. Allowlist de arquivo inteiro em
  `scripts/check-design-system.ts` e reservada para diretorios/superficies
  (icons, charts, waitlist), nao para excecoes pontuais.

## Checklist para novas paginas autenticadas

- [ ] Usa `PageContainer` como wrapper raiz.
- [ ] Define explicitamente `variant="standard"` ou `variant="analytics"`.
- [ ] Coloca acoes do header dentro de `PageActions`.
- [ ] Escolhe uma receita de corpo: `PageBodyStack`, `AnalyticsWorkspace`,
      `TabbedWorkspace`, `TableWorkspace`, `KanbanWorkspace`,
      `DashboardGrid`, `FormStepWorkspace` ou `WorkspaceState`.
- [ ] Usa um unico scroll principal em workspaces de analise.
- [ ] Usa tokens semanticos de cor e radius aprovado.
- [ ] Altura de controles via prop `size`, nunca `h-*` em className.
- [ ] Todo fundo estrutural sai da escada (`background`/`muted`/`card`/
      `surface-2`/`surface-3`), nunca de `bg-<token>-<N>`.
- [ ] Hover de superficie usa `hover:bg-accent`; selecao usa
      `bg-primary-10` + `border-primary-30`.
- [ ] Micro-texto usa `text-2xs`, nunca `text-[10px]`/`text-[11px]`.
- [ ] Sombras via `shadow-elevation-*`; camadas de app via `z-<token>`.
- [ ] Icon-only buttons tem `aria-label` ou `title`.
- [ ] Roda `npm run check:design-system` antes de fechar.

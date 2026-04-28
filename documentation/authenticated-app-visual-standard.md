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

## Checklist para novas paginas autenticadas

- [ ] Usa `PageContainer` como wrapper raiz.
- [ ] Define explicitamente `variant="standard"` ou `variant="analytics"`.
- [ ] Coloca acoes do header dentro de `PageActions`.
- [ ] Escolhe uma receita de corpo: `PageBodyStack`, `AnalyticsWorkspace`,
      `TabbedWorkspace`, `TableWorkspace`, `KanbanWorkspace`,
      `DashboardGrid`, `FormStepWorkspace` ou `WorkspaceState`.
- [ ] Usa um unico scroll principal em workspaces de analise.
- [ ] Usa tokens semanticos de cor e radius aprovado.
- [ ] Icon-only buttons tem `aria-label` ou `title`.
- [ ] Roda `npm run check:design-system` antes de fechar.

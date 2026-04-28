# Design System Hookify

Este documento descreve tokens, componentes preferidos e receitas de layout do
frontend. O objetivo e manter o app SaaS denso, escaneavel, acessivel e facil
de refatorar.

## Tokens

As cores vivem em `frontend/lib/design-system/themeDefinitions.ts`, sao geradas
em `frontend/app/theme-generated.css` e mapeadas no Tailwind.

Use tokens semanticos em vez de cores diretas:

- `primary`: marca, CTA principal, serie principal de grafico.
- `success`: status positivo, ativo, confirmado.
- `destructive`: erro, perigo, metrica ruim, acao destrutiva.
- `warning`: aviso importante.
- `attention`: destaque menos urgente que warning.
- `background`, `card`, `surface`, `muted`, `border`: estrutura da UI.
- `foreground`, `muted-foreground`: texto principal e secundario.
- `overlay`: fundo de modal/dialog.
- `chart-1` a `chart-5`: series de grafico distintas.

```tsx
// Bom
<span className="text-destructive">Erro</span>
<div className="border border-border bg-card" />

// Evite
<span className="text-red-400">Erro</span>
<div className="border-gray-700 bg-white" />
```

Depois de alterar `themeDefinitions.ts`, rode `npm run generate:themes`.

## Paginas

Paginas autenticadas usam `PageContainer` com variante explicita:

- `variant="standard"`: paginas lineares como `packs`, `docs`, `upload`,
  `planos`, onboarding e settings-like pages.
- `variant="analytics"`: workspaces de analise como `manager`, `insights`,
  `gold`, `explorer`, `admin` e `meta-usage`.

Header actions ficam em `PageActions`. O corpo deve usar uma receita de
`components/common/layout`.

## Receitas de Layout

- `PageBodyStack`: corpo vertical padrao para paginas standard.
- `AnalyticsWorkspace`: corpo flexivel com `min-h-0` para workspaces.
- `TabbedWorkspace`: tabs de pagina, com controles e wrapping consistentes.
- `WorkspaceState`: empty e error centralizados.
- `TableWorkspace`: toolbar/filtros mais uma area primaria de tabela.
- `KanbanWorkspace`: kanban horizontal ou vertical com scroll previsivel.
- `DashboardGrid`: grid responsivo para metric cards e widgets.
- `FormStepWorkspace`: steps, breadcrumbs e acoes de fluxo.
- `FormPageSection`: secao de formulario/settings/onboarding com header,
  descricao, acoes e footer opcionais.
- `SettingsPanelLayout`: corpo settings-like com navegacao lateral ou painel
  principal.
- `WidgetPanel`: card de widget com titulo, acoes, densidade e scroll opcional.

Receitas que aceitam `density` usam `"compact"`, `"default"` ou `"spacious"`.
Use `compact` para controles densos/tabelas, `default` para a maioria das
paginas e `spacious` para onboarding, upload e formularios de leitura lenta.

Exemplo standard:

```tsx
<PageContainer variant="standard" title="Biblioteca">
  <PageBodyStack>{content}</PageBodyStack>
</PageContainer>
```

Exemplo analytics:

```tsx
<PageContainer variant="analytics" title="Otimize">
  <AnalyticsWorkspace>
    <TableWorkspace toolbar={filters}>{table}</TableWorkspace>
  </AnalyticsWorkspace>
</PageContainer>
```

Exemplo com sidebar:

```tsx
<PageContainer variant="analytics" title="Explorer" pageSidebar={sidebar}>
  <AnalyticsWorkspace>{detail}</AnalyticsWorkspace>
</PageContainer>
```

## Estados

Estados de loading, vazio, erro e aviso devem vir de
`components/common/States`.

| Contexto | Use | Observacao |
| --- | --- | --- |
| Loading de pagina/corpo | `StateSkeleton` | Mostre a silhueta do layout final. |
| Estado vazio/erro de pagina/corpo | `WorkspaceState` | Receita para empty/error de paginas autenticadas. |
| Estado em painel/widget/tabela | `StatePanel` | Use `framed={false}` quando ja estiver dentro de um card. |
| Aviso inline | `InlineNotice` | Para warning, erro, info ou sucesso dentro de um fluxo. |
| Skeleton generico | `StateSkeleton` | `page`, `widget`, `table` ou `media`. |
| Skeleton especializado | componente local | Apenas para media real, chart shape ou linhas densas de tabela. |

Exemplos:

```tsx
<StateSkeleton variant="page" rows={4} />
<StatePanel kind="empty" title="Sem resultados" message="Ajuste os filtros." />
<InlineNotice tone="warning">Revise os campos antes de continuar.</InlineNotice>
<StateSkeleton variant="table" rows={8} />
```

Mantenha `LoadingState`, `EmptyState` e `ErrorState` somente para compatibilidade
ou superficies simples fora das receitas novas.

## Primitivos Preferidos

- `StandardCard`: cards e paineis autenticados. Use `density` e `elevation`
  antes de classes locais de padding/shadow.
- `AppDialog`: dialogs do app. Mantem a API de `Modal` para sizing, padding,
  fechamento por overlay/ESC, close button e variante mobile.
- `ToggleSwitch`: switches com label.
- `TabbedWorkspace`: tabs de pagina.
- `WorkspaceState`: estados de corpo.

Uso direto de `Card`, `Modal`, `Dialog` e `Switch` deve ficar restrito a
primitivas, superficies publicas/dev, compact controls ou legado documentado no
checker.

| Necessidade | Use | Evite em app autenticado |
| --- | --- | --- |
| Card/painel | `StandardCard` | `Card` direto |
| Widget com titulo | `WidgetPanel` | header/body montado a mao |
| Dialog | `AppDialog` | `Modal`/Radix direto |
| Switch com label | `ToggleSwitch` | `Switch` cru |
| Pagina com tabs | `TabbedWorkspace` | `TabbedContent` solto |

## Densidade, Elevacao e Camadas

Use tokens Tailwind nomeados para padroes recorrentes:

- Controles: `h-control-compact`, `h-control-default`, `h-control-large`.
- Linhas de tabela: `h-row-compact`, `h-row-default`, `h-row-detailed`.
- Padding de widgets: `p-widget-compact`, `p-widget-default`,
  `p-widget-spacious`.
- Gaps: `gap-stack-*`, `gap-grid-*`, `gap-workspace`.
- Elevacao: `shadow-elevation-flat`, `shadow-elevation-raised`,
  `shadow-elevation-overlay`.
- Z-index: `z-sticky`, `z-overlay`, `z-modal`, `z-dropdown`, `z-toast`.

Exemplos:

```tsx
<StandardCard density="compact" elevation="raised">{content}</StandardCard>
<WidgetPanel title="Resumo" density="default" actions={actions}>{chart}</WidgetPanel>
<Button size="sm">Filtrar</Button> // usa h-control-compact
```

Use `AppDialog` com `title` mesmo quando o titulo visual ja existe no corpo;
esse titulo tambem alimenta leitores de tela.

## Radius

Use a escala pequena do produto:

- `rounded-sm`: detalhes pequenos.
- `rounded-md`: padrao para cards, paineis, tabelas e inputs.
- `rounded-lg`: superficies de destaque ou containers de media.
- `rounded-full`: avatars, pills, switches, status dots e botoes circulares.

Evite `rounded-xl`, `rounded-2xl`, `rounded-3xl` e `rounded-[...]` fora das
excecoes documentadas.

## Excecoes Aprovadas

- Icones de marca mantem cores oficiais.
- Containers de video e media podem usar preto.
- Previews Instagram/Facebook podem simular cores da plataforma.
- Badges TOP 3 ficam em `frontend/lib/utils/topBadgeStyles.ts`.
- OpenGraph e fallback global de erro podem usar inline values quando o Next
  exigir.
- Overlays de modal podem usar `rgba(...)` internamente.

## Checker

O checker e consultivo e nao reescreve arquivos:

```bash
npm run check:design-system
```

Ele reporta:

- familias de cor Tailwind hardcoded;
- radius grande ou arbitrario;
- hex/rgb/rgba raw;
- emoji usado como icone visivel;
- `PageContainer` sem `variant`;
- imports diretos de `Card`, `Modal`, `Dialog` ou `Switch` fora da allowlist;
- imports diretos de `Skeleton` fora de estados, media, charts ou linhas de
  tabela documentadas;
- banners inline de warning/info/error que deveriam usar `InlineNotice`;
- `WorkspaceState kind="loading"`; use `StateSkeleton` estrutural;
- icon-only buttons sem `aria-label` ou `title`.

Se uma excecao for rara e local, use um comentario na linha anterior ou na
mesma linha:

```tsx
// design-system-exception: inline-notice-pattern - Full-width app chrome banner.
<div className="w-full bg-warning-20 border-b border-warning-50 py-2" />
```

Use o id exato da regra e uma razao curta. Excecoes recorrentes devem ficar na
allowlist por regra em `frontend/scripts/check-design-system.ts`.

## Checklist

- [ ] Pagina usa `PageContainer variant="standard"` ou `variant="analytics"`.
- [ ] Header actions usam `PageActions`.
- [ ] Corpo usa uma receita de `components/common/layout`.
- [ ] Analytics workspace tem um scroll principal previsivel.
- [ ] Cores usam tokens semanticos.
- [ ] Radius usa `rounded-sm`, `rounded-md`, `rounded-lg` ou excecao aprovada.
- [ ] Icon-only buttons tem `aria-label` ou `title`.
- [ ] Graficos usam `chart-*`, `primary`, `success`, `warning`, `attention` ou
      `destructive`.
- [ ] `npm run check:design-system` passa.

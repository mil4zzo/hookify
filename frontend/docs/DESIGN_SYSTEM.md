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
- `WorkspaceState`: loading, empty e error centralizados.
- `TableWorkspace`: toolbar/filtros mais uma area primaria de tabela.
- `KanbanWorkspace`: kanban horizontal ou vertical com scroll previsivel.
- `DashboardGrid`: grid responsivo para metric cards e widgets.
- `FormStepWorkspace`: steps, breadcrumbs e acoes de fluxo.

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

## Primitivos Preferidos

- `StandardCard`: cards e paineis autenticados.
- `AppDialog`: novos dialogs.
- `ToggleSwitch`: switches com label.
- `TabbedWorkspace`: tabs de pagina.
- `WorkspaceState`: estados de corpo.

Uso direto de `Card`, `Modal`, `Dialog` e `Switch` deve ficar restrito a
primitivas, superficies publicas/dev, compact controls ou legado documentado no
checker.

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
- icon-only buttons sem `aria-label` ou `title`.

Se uma excecao for intencional, documente a razao na allowlist de
`frontend/scripts/check-design-system.ts`.

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

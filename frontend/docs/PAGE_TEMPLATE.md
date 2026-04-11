# Template para Novas Páginas

Guia para criar páginas novas. O objetivo é que você tome **o mínimo de decisões de layout**: o
`PageContainer` cuida do header, do spacing e do rhythm. Você só fornece título, descrição,
ações e conteúdo.

## Estrutura padrão

```tsx
"use client";

import { PageContainer } from "@/components/common/PageContainer";

export default function NewPage() {
  return (
    <PageContainer
      title="Título da Página"
      description="Descrição curta da página"
      actions={
        // Botões, filtros, toggles etc — opcional
      }
    >
      {/* Conteúdo da página */}
    </PageContainer>
  );
}
```

Isso é tudo que a maioria das páginas precisa. Não há prop de `variant`, `spacing` ou
customização de classes de header — todas as páginas compartilham o mesmo visual.

## Props aceitas

### Comuns (use sempre que aplicável)

| Prop          | Tipo        | Obrigatório | Descrição                                    |
|---------------|-------------|-------------|----------------------------------------------|
| `title`       | `string`    | ✅          | Título grande no topo da página              |
| `description` | `ReactNode` | —           | Texto curto abaixo do título                 |
| `actions`     | `ReactNode` | —           | Botões/filtros alinhados à direita do header |
| `icon`        | `ReactNode` | —           | Ícone ao lado do título (use `PageIcon`)     |
| `children`    | `ReactNode` | ✅          | Conteúdo da página                           |
| `className`   | `string`    | —           | Classe extra no wrapper raiz (use com cautela) |

### `fullHeight`

Use quando o conteúdo precisa ocupar toda a altura do viewport e ter scroll interno próprio.
Caso de uso real: tabelas grandes onde o header da tabela fica fixo enquanto as linhas
scrollam. Exemplo: `/manager`.

```tsx
<PageContainer title="Otimize" description="..." fullHeight={true}>
  <ManagerTable ... />
</PageContainer>
```

⚠️ `fullHeight={true}` altera o fluxo de layout — só use se a página precisa mesmo.

### Props de uso restrito (Explorer)

Existem props que **só o Explorer usa** e não devem aparecer em páginas novas:

- `hideHeader` — remove o header da página
- `fullWidth` — faz o shell ocupar largura total (sem `max-w-*`)
- `pageSidebar`, `pageSidebarClassName`, `pageSidebarMobileBehavior` — adiciona sidebar
  lateral grudada no conteúdo
- `contentClassName` — classe extra no wrapper do content (ex: `min-w-0`)

Se você sentir necessidade dessas props em uma página nova, antes verifique se o padrão
comum não resolve.

## Páginas com abas

Use `TabbedContent` + `TabbedContentItem` e **sempre** passe `separatorAfterTabs={true}` para
manter o mesmo respiro entre a barra de abas e o conteúdo em todas as páginas:

```tsx
import { TabbedContent, TabbedContentItem, type TabItem } from "@/components/common/TabbedContent";

const tabs: TabItem[] = [
  { value: "a", label: "Aba A" },
  { value: "b", label: "Aba B" },
];

<PageContainer title="Página com abas" description="...">
  <TabbedContent
    value={activeTab}
    onValueChange={setActiveTab}
    tabs={tabs}
    separatorAfterTabs={true}
  >
    <TabbedContentItem value="a">{/* ... */}</TabbedContentItem>
    <TabbedContentItem value="b">{/* ... */}</TabbedContentItem>
  </TabbedContent>
</PageContainer>
```

Se a página tiver controles que ficam ao lado das abas (ex: `StepIndicator`, toggles de
visualização), use também `variant="with-controls"` e passe `controls={<…/>}`:

```tsx
<TabbedContent
  value={mode}
  onValueChange={setMode}
  tabs={tabs}
  variant="with-controls"
  separatorAfterTabs={true}
  controls={<ViewModeToggle ... />}
  tabsContainerClassName="flex-col items-stretch gap-3 md:flex-row md:items-center md:gap-4"
  tabsListClassName="w-full overflow-x-auto md:w-fit"
>
  <TabbedContentItem value="a" variant="with-controls">{/* ... */}</TabbedContentItem>
</TabbedContent>
```

## O que mudou nesta padronização

Antes, `PageContainer` aceitava props como `variant="analytics" | "standard"`, `spacing`,
`titleClassName`, `descriptionClassName` etc. Isso permitia cada página ter um spacing
diferente — o que gerava inconsistência. Essas props foram **removidas**:

- `variant` — todas as páginas usam o mesmo look (o antigo `analytics`).
- `spacing` — o wrapper tem `space-y-5` hard-coded.
- `*ClassName` granulares (title, description, header, actions) — removidos.

Para alterar o visual, edite os componentes base:
- `frontend/components/common/PageContainer.tsx`
- `frontend/components/common/PageSectionHeader.tsx`

Mudar o spacing lá afeta todas as páginas automaticamente — é o ponto.

## Checklist para novas páginas

- [ ] Importou `PageContainer` de `@/components/common/PageContainer`
- [ ] Forneceu `title` descritivo e `description` curta
- [ ] Se a página tem abas, usou `TabbedContent` com `separatorAfterTabs={true}`
- [ ] Não passou `variant`, `spacing`, `titleClassName`, etc — essas props não existem mais
- [ ] Usou `fullHeight={true}` apenas se realmente precisa de scroll interno
- [ ] Testou em mobile e desktop

## Referências

- **Componente:** `frontend/components/common/PageContainer.tsx`
- **Header:** `frontend/components/common/PageSectionHeader.tsx`
- **Tabs:** `frontend/components/common/TabbedContent.tsx`
- **Exemplo de referência:** `frontend/app/manager/page.tsx` (é o modelo do padrão visual)

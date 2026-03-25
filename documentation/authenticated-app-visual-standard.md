# Padrao Visual Base do App Autenticado

## Objetivo
Garantir que as paginas autenticadas compartilhem a mesma composicao de shell, header, actions area, tabs e area de conteudo, variando apenas no conteudo da feature.

## Componentes obrigatorios
- `PageContainer`: wrapper obrigatorio das paginas internas.
- `PageSectionHeader`: usado indiretamente por `PageContainer` para titulo, descricao e actions.
- `PageActions`: wrapper obrigatorio para a area de acoes do header.
- `TabbedContent`: wrapper padrao para tabs e controles anexos.

## Variantes de pagina
### `standard`
Use para paginas lineares como `packs` e `docs`.

Regras:
- header simples com titulo, descricao e acoes opcionais
- conteudo em fluxo normal
- sem compensacoes locais de layout

### `analytics`
Use para paginas de analise como `manager`, `insights` e `gold`.

Regras:
- `PageContainer variant="analytics"`
- filtros globais sempre dentro de `PageActions`
- tabs e controles usando `TabbedContent`
- area principal com `min-h-0` quando houver workspace flexivel

## Recipes
### StandardPage
```tsx
<PageContainer
  title="Titulo"
  description="Descricao"
  variant="standard"
  actions={
    <PageActions>
      <Button>Acao</Button>
    </PageActions>
  }
>
  {children}
</PageContainer>
```

### AnalyticsPage
```tsx
<PageContainer
  title="Titulo"
  description="Descricao"
  variant="analytics"
  actions={
    <PageActions>
      <FiltersDropdown ... />
    </PageActions>
  }
>
  {children}
</PageContainer>
```

### DataWorkspace
Quando a feature precisa ocupar altura util com scroll previsivel:

```tsx
<PageContainer variant="analytics" fullHeight className="min-h-0">
  <div className="flex min-h-0 flex-1 flex-col">
    {workspace}
  </div>
</PageContainer>
```

Regras:
- prefira um scroll principal por workspace
- use `min-h-0` em todos os ancestrais flexiveis
- nao acople offsets a topbars ou headers externos

## Regras de responsividade
- `PageActions` organiza quebra e alinhamento de acoes; nao recriar wrappers locais sem necessidade.
- `TabbedContent` e o comportamento padrao para tabs com ou sem controles.
- scroll horizontal deve ficar concentrado em tabelas ou areas de dados, nao no header da pagina.
- larguras fixas so sao aceitaveis quando representam densidade intencional do componente, nao compensacao de layout.

## Checklist para novas paginas autenticadas
- Usa `PageContainer` como wrapper raiz da pagina.
- Escolhe explicitamente `variant="standard"` ou `variant="analytics"`.
- Coloca as acoes do header dentro de `PageActions`.
- Reaproveita `TabbedContent` para tabs e controles relacionados.
- Evita `sticky`, offsets e compensacoes locais sem necessidade estrutural.
- Valida desktop, tablet e mobile antes de fechar a implementacao.

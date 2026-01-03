# Template para Novas Páginas

Este documento descreve o padrão estabelecido para criação de novas páginas na aplicação, garantindo consistência visual e facilidade de manutenção.

## Estrutura Padrão

Todas as páginas devem seguir esta estrutura básica:

```tsx
"use client";

import { PageContainer } from "@/components/common/PageContainer";
import { PageIcon } from "@/lib/utils/pageIcon";
import { IconExample } from "@tabler/icons-react";

export default function NewPage() {
  return (
    <PageContainer
      title="Título da Página"
      description="Descrição opcional da página"
      icon={<PageIcon icon={IconExample} />}
      actions={
        // Botões, filtros, etc. opcionais
      }
    >
      {/* Conteúdo da página */}
    </PageContainer>
  );
}
```

## Padrões Obrigatórios

### 1. Ícones

**Sempre use o helper `PageIcon`:**

```tsx
// ✅ CORRETO
import { PageIcon } from "@/lib/utils/pageIcon";
import { IconCompass } from "@tabler/icons-react";

<PageContainer
  icon={<PageIcon icon={IconCompass} />}
  ...
/>

// ❌ ERRADO - Não use classes diretamente
<PageContainer
  icon={<IconCompass className="w-6 h-6 text-yellow-500" />}
  ...
/>
```

**Benefícios:**
- Garante tamanho e cor consistentes (`w-6 h-6 text-yellow-500`)
- Facilita manutenção (mudanças centralizadas)
- Type-safe com TypeScript

### 2. Espaçamento

**Use o padrão (`md`) a menos que necessário outro:**

```tsx
// ✅ Padrão (recomendado)
<PageContainer spacing="md" ... />

// ✅ Apenas quando necessário
<PageContainer spacing="sm" ... />  // Menos espaço
<PageContainer spacing="lg" ... />  // Mais espaço
```

**Espaçamentos disponíveis:**
- `sm`: `space-y-4` (16px)
- `md`: `space-y-6` (24px) - **padrão**
- `lg`: `space-y-8` (32px)

### 3. FullHeight

**Use apenas quando o conteúdo precisa ocupar toda a altura:**

```tsx
// ✅ Apenas quando necessário (ex: tabelas com scroll interno)
<PageContainer fullHeight={true} ... >
  <ManagerTable ... />
</PageContainer>

// ✅ Padrão (recomendado)
<PageContainer ... >
  <div>Conteúdo normal</div>
</PageContainer>
```

**⚠️ Atenção:** `fullHeight` remove o espaçamento padrão entre header e conteúdo. Use apenas quando realmente necessário.

### 4. Título e Descrição

**Sempre forneça um título descritivo:**

```tsx
<PageContainer
  title="Biblioteca"  // ✅ Sempre forneça
  description="Gerencie seus Packs de anúncios"  // ✅ Opcional mas recomendado
  ...
/>
```

## Exemplos Completos

### Página Simples

```tsx
"use client";

import { PageContainer } from "@/components/common/PageContainer";
import { PageIcon } from "@/lib/utils/pageIcon";
import { IconStack2Filled } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";

export default function PacksPage() {
  return (
    <PageContainer
      title="Biblioteca"
      description="Gerencie seus Packs de anúncios"
      icon={<PageIcon icon={IconStack2Filled} />}
      actions={
        <Button>Carregar Pack</Button>
      }
    >
      <div>Conteúdo da página</div>
    </PageContainer>
  );
}
```

### Página com FullHeight

```tsx
"use client";

import { PageContainer } from "@/components/common/PageContainer";
import { PageIcon } from "@/lib/utils/pageIcon";
import { IconCompass } from "@tabler/icons-react";
import { ManagerTable } from "@/components/manager/ManagerTable";

export default function ManagerPage() {
  return (
    <PageContainer
      title="Explore"
      description="Dados de performance dos seus anúncios"
      icon={<PageIcon icon={IconCompass} />}
      fullHeight={true}  // Necessário para tabela com scroll interno
    >
      <ManagerTable ... />
    </PageContainer>
  );
}
```

### Página com Filtros

```tsx
"use client";

import { PageContainer } from "@/components/common/PageContainer";
import { PageIcon } from "@/lib/utils/pageIcon";
import { IconTrophy } from "@tabler/icons-react";
import { FiltersDropdown } from "@/components/common/FiltersDropdown";

export default function GoldPage() {
  return (
    <PageContainer
      title="G.O.L.D."
      description="Classificação de anúncios por performance"
      icon={<PageIcon icon={IconTrophy} />}
      actions={
        <FiltersDropdown
          expanded={true}
          dateRange={dateRange}
          onDateRangeChange={handleDateRangeChange}
          ...
        />
      }
    >
      <GoldTable ... />
    </PageContainer>
  );
}
```

## Manutenção Centralizada

### Alterar Tamanho dos Ícones

Edite `frontend/lib/constants/pageLayout.ts`:

```typescript
export const PAGE_ICON_SIZE = "w-6 h-6";  // Altere aqui
```

### Alterar Cor dos Ícones

Edite `frontend/lib/constants/pageLayout.ts`:

```typescript
export const PAGE_ICON_COLOR = "text-yellow-500";  // Altere aqui
```

### Alterar Espaçamento Padrão

Edite `frontend/lib/constants/pageLayout.ts`:

```typescript
export const PAGE_SPACING_DEFAULT = "md" as const;  // Altere aqui
```

Todas as páginas que usam `PageIcon` e `PageContainer` serão atualizadas automaticamente!

## Checklist para Novas Páginas

- [ ] Importar `PageContainer` de `@/components/common/PageContainer`
- [ ] Importar `PageIcon` de `@/lib/utils/pageIcon`
- [ ] Usar `<PageIcon icon={IconComponent} />` para o ícone
- [ ] Fornecer título descritivo
- [ ] Usar espaçamento padrão (`md`) a menos que necessário outro
- [ ] Usar `fullHeight` apenas quando necessário
- [ ] Testar responsividade em diferentes tamanhos de tela

## Referências

- **Componente:** `frontend/components/common/PageContainer.tsx`
- **Helper:** `frontend/lib/utils/pageIcon.tsx`
- **Constantes:** `frontend/lib/constants/pageLayout.ts`
- **Header:** `frontend/components/common/PageSectionHeader.tsx`


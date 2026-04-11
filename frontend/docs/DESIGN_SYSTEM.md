# Design System Hookify

Este documento descreve os tokens, convenções e exceções do design system do aplicativo. O objetivo é manter consistência visual e facilitar a manutenção.

## 1. Tokens de cores

As cores são definidas em `frontend/lib/design-system/themeDefinitions.ts` usando OKLCH e geradas em `frontend/app/theme-generated.css`. O Tailwind mapeia essas variáveis em `frontend/tailwind.config.ts`.

### Semânticas principais

| Token                       | Uso                                                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `--primary` / `primary`     | Cor principal da marca (botões principais, links, destaques). Em botões/avatars primários, use `text-primary-foreground` para ícones e texto. |
| `--primary-foreground`      | Texto e ícones sobre fundo primary. Sempre use em vez de `text-white` quando o fundo for primary.                                             |
| `--secondary` / `secondary` | Elementos secundários (badges neutros, fundos alternativos).                                                                                  |
| `--muted` / `muted`         | Fundos sutis.                                                                                                                                 |
| `--muted-foreground`        | Texto secundário, rótulos, placeholders. Preferir em vez de `text-gray-500` / `text-gray-400`.                                                |
| `--foreground`              | Texto principal sobre fundo claro/escuro.                                                                                                     |

As famílias semânticas agora também expõem escalas completas para uso futuro:

- `primary-950`, `primary-800`, `primary-600`, `primary-400`, `primary-300`, `primary-label`
- `destructive-950`, `destructive-800`, `destructive-600`, `destructive-400`, `destructive-300`, `destructive-label`
- `success-950`, `success-800`, `success-600`, `success-400`, `success-300`, `success-label`
- `neutral-950`, `neutral-800`, `neutral-600`, `neutral-400`, `surface-fill`

### Feedback

| Token                           | Uso                                                                                                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--success` / `success`         | Sucesso, status positivo, ativo. Use `bg-success` / `text-success` e `text-success-foreground` em fundos success.                                                    |
| `--destructive` / `destructive` | Único token vermelho: ações destrutivas (excluir, cancelar) e indicadores de perigo (métricas ruins, alertas). Use `bg-destructive` e `text-destructive-foreground`. |
| `--warning` / `warning`         | Avisos, urgência média (laranja).                                                                                                                                    |
| `--attention` / `attention`     | Atenção menos urgente (amarelo). Ordem: attention &lt; warning &lt; destructive.                                                                                     |

### Componentes

| Token                         | Uso                                                                         |
| ----------------------------- | --------------------------------------------------------------------------- |
| `--background` / `background` | Fundo da página.                                                            |
| `--card` / `card`             | Fundo de cards e superfícies elevadas.                                      |
| `--popover` / `popover`       | Fundo de popovers e dropdowns. Use `text-popover-foreground` para conteúdo. |
| `--border`                    | Bordas.                                                                     |
| `--input`                     | Campos de input.                                                            |
| `--overlay`                   | Overlay de modais e dialogs. Use `bg-overlay` em vez de `bg-black/80`.      |

### Superfícies neutras

| Token                       | Uso                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `--surface` / `surface`     | Superfície elevada (cards, popover, modais). Um degrau acima do fundo.                                  |
| `--surface-fill` / `surface-fill` | Tom base claro da nova paleta neutra. Serve como referência para superfícies e preenchimentos claros.                         |
| `--secondary` / `secondary` | Alias de `surface`; use para botões secundários e chips.                                                |
| `--muted` / `muted`         | Área secundária (listas, tabelas, blocos menos importantes).                                            |
| `--accent` / `accent`       | Estado interativo (hover, item selecionado).                                                            |
| `--surface-2` / `surface-2` | Derivado de `surface` (mais escuro). Ex.: inputs dentro de popups que precisam contraste com `surface`. |
| `--surface-3` / `surface3`  | Derivado de `surface` (ainda mais escuro). Escolha por função, não como “cinza genérico”.               |

Os neutros explícitos (`neutral-950`, `neutral-800`, `neutral-600`, `neutral-400`) ficam disponíveis para casos em que a UI futura precise de um tom fixo da família neutra, sem depender apenas dos aliases semânticos de superfície.

### Brand

Cor principal da marca: `--primary` / `brand` (azul). Continuam disponíveis as escalas por transparência (`primary-10`, `primary-20`, `primary-90`) e agora também a escala tonal sólida (`primary-950`, `primary-800`, `primary-600`, `primary-400`, `primary-300`, `primary-label`).

### Gráficos e sparklines

| Token                                                   | Uso                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `--chart-1` a `--chart-5`                               | Séries de gráficos. Use em `MetricHistoryChart`, `RetentionChart` etc. |
| `--primary`                                             | Linhas/séries principais em gráficos.                                  |
| `--muted-foreground`                                    | Eixos, labels e linhas auxiliares.                                     |
| Sparklines: `--sparkline-red`, `--sparkline-green` etc. | Mapeados para `destructive`, `success` etc.                            |

---

## 2. Radius, overlay e espaçamento

### Border radius

- `--radius-sm`: 4px (0.25rem)
- `--radius-md`: 8px (0.5rem) — **padrão**
- `--radius-lg`: 10px (0.625rem)
- `--radius`: `var(--radius-md)` — token default

No Tailwind: `rounded-sm`, `rounded-md`, `rounded-lg` usam essas variáveis.

### Overlay

- `--overlay`: overlay para modais (`oklch(0 0 0 / 0.8)`). Use `bg-overlay` em `DialogOverlay` e modais fullscreen.

### Espaçamento

O projeto usa a escala padrão do Tailwind (4, 8, 12, 16, 24, 32...). Não há tokens CSS customizados para spacing.

### Tipografia

- **Fonte sans**: `var(--font-geist)` (Geist)
- **Fonte mono**: `var(--font-geist-mono)` (Geist Mono)

Configuradas em `tailwind.config.ts` em `fontFamily`.

---

## 3. Quando usar cada token

- **primary vs success**: Use `primary` para ações principais e elementos de marca. Use `success` para feedback de sucesso (ex.: confirmar, status ativo).
- **escalas sólidas**: Prefira `primary`, `success` e `destructive` como aliases principais do produto. Use `*-950...*-300` e `*-label` quando realmente precisar fixar um tom da família para novos componentes.
- **muted-foreground**: Para qualquer texto secundário (labels, hints, ícones inativos).
- **--overlay**: Sempre para overlay de modal/dialog; permite temas alterarem no futuro.
- **destructive**: único token vermelho; use para botões de excluir/cancelar destrutivo e para indicadores de perigo (métricas ruins, alertas).
- **chart-1..5**: Para paletas de categorias em gráficos; manter distinção visual entre séries.

---

## 4. Exceções

### Ícones de marca (Google, Meta)

Os ícones de Google e Meta/Facebook **mantêm as cores oficiais da marca** (azul, vermelho, amarelo etc.). Não substituir por tokens semânticos — documentado como exceção deliberada para reconhecimento de marca.

### Media containers

Containers de vídeo e preview de mídia podem usar `bg-black` ou `bg-black/40` para garantir reprodução correta e contraste com o conteúdo. Tratado como exceção para contexto de mídia.

### Badges TOP 3 (ouro, prata, bronze)

Os gradientes e cores de ouro, prata e bronze estão centralizados em `frontend/lib/utils/topBadgeStyles.ts`. Componentes como `TopBadge` e `GenericCard` usam `getTopBadgeStyleConfig`, `getTopBadgeStyles` e `getTopBadgeVariantFromRank`. Não definir gradientes duplicados em outros arquivos.

---

## 5. Checklist de aderência para novos componentes

- [ ] Usar tokens de cor em vez de cores hardcoded (`green-600`, `red-500`, `gray-500`, `white`, `black`).
- [ ] Em fundos primary: usar `text-primary-foreground` para texto/ícones.
- [ ] Em overlays de modal: usar `bg-overlay`.
- [ ] Botões de sucesso: `bg-success` + `text-success-foreground`.
- [ ] Botões destrutivos: `bg-destructive` + `text-destructive-foreground`.
- [ ] Texto secundário: `text-muted-foreground`.
- [ ] Gráficos: `var(--chart-1)` … `var(--chart-5)`, `var(--primary)`, `var(--muted-foreground)`.
- [ ] Paletas de categorias (Gems/Kanban): usar `gemsColorSchemes.ts` e tokens `--chart-*`.
- [ ] Badges ouro/prata/bronze: usar `topBadgeStyles.ts`.
- [ ] Border radius: `rounded-sm`, `rounded-md` ou `rounded-lg` (não valores fixos em px).

---

## 6. Referências

### Temas

Temas são aplicados via `data-theme` em `<html>`. No CSS, usar apenas o seletor `:root[data-theme="nome"]`. Temas oficiais: **light** (valores padrão de `:root`) e **dark** (`data-theme="dark"`).

A paleta enviada pelo produto foi adotada como referência obrigatória do tema `dark` para as famílias `primary`, `destructive`, `success` e neutros. O tema `light` pode derivar tons próprios quando necessário para contraste e legibilidade, preservando os mesmos nomes semânticos.

A **fonte única** de definição dos temas é `frontend/lib/design-system/themeDefinitions.ts` (objetos `lightTheme` e `darkTheme`). O arquivo `frontend/app/theme-generated.css` é gerado a partir desse módulo. **Após alterar** `themeDefinitions.ts`, rode `npm run generate:themes` no frontend e inclua `app/theme-generated.css` no commit. Para **adicionar um novo tema**: (1) criar um novo objeto no módulo (ex.: `highContrastTheme`) com as mesmas chaves de `THEME_VAR_NAMES`; (2) no script `scripts/generate-theme-css.ts`, gerar um bloco adicional `:root[data-theme="nome-do-tema"] { ... }` e concatenar ao CSS de saída.

### Arquivos

- **Página de design system (dev)**: `/design-system` — cores, tokens e componentes em uma única página (disponível apenas em development).
- **Tokens CSS**: `frontend/app/globals.css` (importa `app/theme-generated.css` para variáveis de tema)
- **Definições de temas**: `frontend/lib/design-system/themeDefinitions.ts`
- **Tailwind**: `frontend/tailwind.config.ts`
- **Paletas Gems/Kanban**: `frontend/lib/utils/gemsColorSchemes.ts`
- **Badges TOP 3**: `frontend/lib/utils/topBadgeStyles.ts`

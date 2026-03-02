# Design System Hookify

Este documento descreve os tokens, convenções e exceções do design system do aplicativo. O objetivo é manter consistência visual e facilitar a manutenção.

## 1. Tokens de cores

As cores são definidas em `frontend/app/globals.css` usando OKLCH. O Tailwind mapeia essas variáveis em `frontend/tailwind.config.ts`.

### Semânticas principais

| Token | Uso |
|-------|-----|
| `--primary` / `primary` | Cor principal da marca (botões principais, links, destaques). Em botões/avatars primários, use `text-primary-foreground` para ícones e texto. |
| `--primary-foreground` | Texto e ícones sobre fundo primary. Sempre use em vez de `text-white` quando o fundo for primary. |
| `--secondary` / `secondary` | Elementos secundários (badges neutros, fundos alternativos). |
| `--muted` / `muted` | Fundos sutis. |
| `--muted-foreground` | Texto secundário, rótulos, placeholders. Preferir em vez de `text-gray-500` / `text-gray-400`. |
| `--foreground` | Texto principal sobre fundo claro/escuro. |

### Feedback

| Token | Uso |
|-------|-----|
| `--success` / `success` | Sucesso, status positivo, ativo. Use `bg-success` / `text-success` e `text-success-foreground` em fundos success. |
| `--destructive` / `destructive` | Único token vermelho: ações destrutivas (excluir, cancelar) e indicadores de perigo (métricas ruins, alertas). Use `bg-destructive` e `text-destructive-foreground`. |
| `--warning` / `warning` | Avisos, urgência média (laranja). |
| `--attention` / `attention` | Atenção menos urgente (amarelo). Ordem: attention &lt; warning &lt; destructive. |

### Componentes

| Token | Uso |
|-------|-----|
| `--background` / `background` | Fundo da página. |
| `--card` / `card` | Fundo de cards e superfícies elevadas. |
| `--popover` / `popover` | Fundo de popovers e dropdowns. Use `text-popover-foreground` para conteúdo. |
| `--border` | Bordas. |
| `--input` | Campos de input. |
| `--overlay` | Overlay de modais e dialogs. Use `bg-overlay` em vez de `bg-black/80`. |

### Superfícies neutras

| Token | Uso |
|-------|-----|
| `--surface` / `surface` | Superfície elevada (cards, popover, modais). Um degrau acima do fundo. |
| `--secondary` / `secondary` | Alias de `surface`; use para botões secundários e chips. |
| `--muted` / `muted` | Área secundária (listas, tabelas, blocos menos importantes). |
| `--accent` / `accent` | Estado interativo (hover, item selecionado). |
| `--surface-2` / `surface-2` | Derivado de `surface` (mais escuro). Ex.: inputs dentro de popups que precisam contraste com `surface`. |
| `--surface-3` / `surface3` | Derivado de `surface` (ainda mais escuro). Escolha por função, não como “cinza genérico”. |

### Brand

Cor principal da marca: `--primary` / `brand` (azul). Escalas leves: `primary-10`, `primary-20`, `primary-90`.

### Gráficos e sparklines

| Token | Uso |
|-------|-----|
| `--chart-1` a `--chart-5` | Séries de gráficos. Use em `MetricHistoryChart`, `RetentionChart` etc. |
| `--primary` | Linhas/séries principais em gráficos. |
| `--muted-foreground` | Eixos, labels e linhas auxiliares. |
| Sparklines: `--sparkline-red`, `--sparkline-green` etc. | Mapeados para `destructive`, `success` etc. |

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

- **Página de design system (dev)**: `/design-system` — cores, tokens e componentes em uma única página (disponível apenas em development).
- **Tokens CSS**: `frontend/app/globals.css`
- **Tailwind**: `frontend/tailwind.config.ts`
- **Paletas Gems/Kanban**: `frontend/lib/utils/gemsColorSchemes.ts`
- **Badges TOP 3**: `frontend/lib/utils/topBadgeStyles.ts`

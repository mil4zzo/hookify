/**
 * Constantes padronizadas para layout de páginas
 * Centraliza valores de estilo para facilitar manutenção
 */

/** Tamanho padrão de ícones no header das páginas */
export const PAGE_ICON_SIZE = "w-6 h-6";

/** Cor padrão dos ícones no header */
export const PAGE_ICON_COLOR = "text-yellow-500";

/** Classes completas para ícones de página */
export const PAGE_ICON_CLASSES = `${PAGE_ICON_SIZE} ${PAGE_ICON_COLOR}`;

/** Espaçamento padrão entre header e conteúdo */
export const PAGE_SPACING_DEFAULT = "md" as const; // space-y-6

/** Espaçamentos disponíveis */
export const PAGE_SPACING_OPTIONS = {
  sm: "space-y-4",
  md: "space-y-6", 
  lg: "space-y-8",
} as const;


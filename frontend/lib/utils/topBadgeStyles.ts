import { CSSProperties } from "react";

export type TopBadgeVariant = "gold" | "silver" | "copper";

export interface TopBadgeStyleConfig {
  gradient: string;
  shadow: string;
  textColor: string;
  textShadow: string;
  emoji: string;
}

export const topBadgeVariantStyles: Record<TopBadgeVariant, TopBadgeStyleConfig> = {
  gold: {
    emoji: "🥇",
    gradient: "linear-gradient(135deg, #FFD700 0%, #FFED4E 50%, #FFA500 100%)",
    shadow: "rgba(255, 215, 0, 0.4)",
    textColor: "#1a1a1a",
    textShadow: "0 1px 1px rgba(255, 255, 255, 0.3)",
  },
  silver: {
    emoji: "🥈",
    gradient: "linear-gradient(135deg, #C0C0C0 0%, #E8E8E8 50%, #A8A8A8 100%)",
    shadow: "rgba(192, 192, 192, 0.4)",
    textColor: "#1a1a1a",
    textShadow: "0 1px 1px rgba(255, 255, 255, 0.3)",
  },
  copper: {
    emoji: "🥉",
    gradient: "linear-gradient(135deg, #CD7F32 0%, #E39A5C 50%, #B87333 100%)",
    shadow: "rgba(205, 127, 50, 0.4)",
    textColor: "#1a1a1a",
    textShadow: "0 1px 1px rgba(255, 255, 255, 0.3)",
  },
};

/**
 * Obtém a configuração de estilo para uma variante de badge TOP 3
 * @param variant - Variante do badge: "gold", "silver" ou "copper"
 * @returns Configuração de estilo ou null se variant for null
 */
export function getTopBadgeStyleConfig(variant: TopBadgeVariant | null): TopBadgeStyleConfig | null {
  if (!variant) return null;
  return topBadgeVariantStyles[variant];
}

/**
 * Obtém os estilos CSS para aplicar em elementos com badge TOP 3
 * @param variant - Variante do badge: "gold", "silver" ou "copper"
 * @param options - Opções adicionais para personalizar os estilos
 * @returns Objeto com estilos CSS ou null se variant for null
 */
export function getTopBadgeStyles(
  variant: TopBadgeVariant | null,
  options?: {
    borderRadius?: string;
    padding?: string;
    borderWidth?: string;
  }
): CSSProperties | null {
  const config = getTopBadgeStyleConfig(variant);
  if (!config) return null;

  return {
    background: config.gradient,
    boxShadow: `0 2px 8px ${config.shadow}, inset 0 1px 2px rgba(255, 255, 255, 0.3), inset 0 -1px 2px rgba(0, 0, 0, 0.1)`,
    border: `${options?.borderWidth || "1px"} solid rgba(255, 255, 255, 0.2)`,
    borderRadius: options?.borderRadius || "6px",
    padding: options?.padding || "4px 8px",
    color: config.textColor,
    textShadow: config.textShadow,
  };
}

/**
 * Obtém apenas background e color para aplicar em linhas que já têm estrutura CSS definida
 * Mantém a estrutura original (padding, border-radius, etc) e apenas troca background e color
 * @param variant - Variante do badge: "gold", "silver" ou "copper"
 * @returns Objeto com apenas background, boxShadow e color ou null se variant for null
 */
export function getTopBadgeRowStyles(variant: TopBadgeVariant | null): CSSProperties | null {
  const config = getTopBadgeStyleConfig(variant);
  if (!config) return null;

  return {
    background: config.gradient,
    boxShadow: `0 2px 8px ${config.shadow}, inset 0 1px 2px rgba(255, 255, 255, 0.3), inset 0 -1px 2px rgba(0, 0, 0, 0.1)`,
    color: config.textColor,
  };
}

/**
 * Obtém o emoji de medalha para uma variante
 * @param variant - Variante do badge: "gold", "silver" ou "copper"
 * @returns Emoji correspondente ou string vazia se variant for null
 */
export function getTopBadgeEmoji(variant: TopBadgeVariant | null): string {
  if (!variant) return "";
  return topBadgeVariantStyles[variant].emoji;
}

/**
 * Determina a variante do badge baseado no rank (1=gold, 2=silver, 3=copper, >3=null)
 * @param rank - Posição no ranking (1, 2, 3 ou maior)
 * @returns Variante do badge ou null se não estiver no TOP 3
 */
export function getTopBadgeVariantFromRank(rank: number | null): TopBadgeVariant | null {
  if (!rank || rank > 3) return null;
  if (rank === 1) return "gold";
  if (rank === 2) return "silver";
  return "copper";
}


"use client";

import React from "react";
import { cn } from "@/lib/utils/cn";
import Image from "next/image";
import { IconPhoto, IconPlayerPlayFilled, IconArrowUpRight, IconArrowDownRight } from "@tabler/icons-react";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useFormatCurrency } from "@/lib/utils/currency";
import { GenericColumnColorScheme } from "./GenericColumn";

export interface GenericCardProps {
  ad: {
    ad_id?: string | null;
    ad_name?: string | null;
    thumbnail?: string | null;
    metricValue: number;
    metricFormatted: string;
    [key: string]: any;
  };
  /** Rótulo legível da métrica */
  metricLabel: string;
  rank: number;
  averageValue?: number | null;
  colorScheme: GenericColumnColorScheme;
  onClick?: (openVideo?: boolean) => void;
  /** Se true, mostra apenas a métrica principal. Se false, mostra todas as métricas */
  isCompact?: boolean;
  /** Função customizada para renderizar métricas adicionais */
  renderAdditionalMetrics?: () => React.ReactNode;
  /** Tooltip content customizado */
  tooltipContent?: React.ReactNode;
}

/**
 * Componente genérico de card reutilizável, baseado na estrutura de GemCard.
 * Permite customização completa de cores, métricas e comportamento.
 */
export function GenericCard({ ad, metricLabel, rank, averageValue, colorScheme, onClick, isCompact = true, renderAdditionalMetrics, tooltipContent }: GenericCardProps) {
  const formatCurrency = useFormatCurrency();

  // Função helper para determinar variante do badge baseado no rank (1=gold, 2=silver, 3=copper, >3=null)
  const getBadgeVariant = (rank: number | null): "gold" | "silver" | "copper" | null => {
    if (!rank || rank > 3) return null;
    if (rank === 1) return "gold";
    if (rank === 2) return "silver";
    return "copper";
  };

  // Função helper para obter estilos do badge baseado no variant
  const getBadgeStyles = (variant: "gold" | "silver" | "copper" | null): React.CSSProperties | null => {
    if (!variant) return null;

    const variantStyles = {
      gold: {
        gradient: "linear-gradient(135deg, #FFD700 0%, #FFED4E 50%, #FFA500 100%)",
        shadow: "rgba(255, 215, 0, 0.4)",
        textColor: "#1a1a1a",
      },
      silver: {
        gradient: "linear-gradient(135deg, #C0C0C0 0%, #E8E8E8 50%, #A8A8A8 100%)",
        shadow: "rgba(192, 192, 192, 0.4)",
        textColor: "#1a1a1a",
      },
      copper: {
        gradient: "linear-gradient(135deg, #CD7F32 0%, #E39A5C 50%, #B87333 100%)",
        shadow: "rgba(205, 127, 50, 0.4)",
        textColor: "#1a1a1a",
      },
    };

    const styles = variantStyles[variant];
    return {
      background: styles.gradient,
      boxShadow: `0 2px 8px ${styles.shadow}, inset 0 1px 2px rgba(255, 255, 255, 0.3), inset 0 -1px 2px rgba(0, 0, 0, 0.1)`,
      border: "1px solid rgba(255, 255, 255, 0.2)",
      borderRadius: "6px",
      padding: "4px 8px",
    };
  };

  // Calcular se está acima da média
  const isAboveAverage = averageValue != null && ad.metricValue > averageValue;
  const diffFromAverage = averageValue != null && averageValue > 0 ? ((ad.metricValue - averageValue) / averageValue) * 100 : null;

  // Métricas básicas
  const impressions = Number(ad.impressions || 0);
  const spend = Number(ad.spend || 0);

  // Determinar opacidade: 35% se abaixo da média, 100% se acima da média
  const isBelowAverage = averageValue != null && ad.metricValue <= averageValue;

  // Determinar variant do badge para o rank (1=gold, 2=silver, 3=copper)
  const rankBadgeVariant = getBadgeVariant(rank);
  const rankBadgeStyles = getBadgeStyles(rankBadgeVariant);
  const rankTextColor = rankBadgeVariant ? "#1a1a1a" : undefined;

  // Tooltip padrão se não fornecido
  const defaultTooltipContent = (
    <div className="space-y-2">
      <div className="font-semibold text-sm mb-2">{ad.ad_name || ad.ad_id}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div>
          <span className="text-muted-foreground">Spend:</span>
          <span className="ml-2 font-medium">{formatCurrency(spend)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Impressões:</span>
          <span className="ml-2 font-medium">{impressions.toLocaleString()}</span>
        </div>
      </div>
      <div className="pt-2 mt-2 border-t border-border text-xs text-muted-foreground">Clique para ver detalhes completos e histórico</div>
    </div>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Card */}
          <div className={cn("p-4 relative cursor-pointer rounded-xl border border-border bg-card transition-all duration-420 hover:-translate-y-2 hover:shadow-[0_0_60px_rgba(250,204,21,0.35)]", isBelowAverage ? "opacity-15 hover:opacity-100" : "opacity-100")} onClick={() => onClick?.()}>
            <div className="relative flex items-center gap-3 sm:gap-4">
              {/* Rank */}
              <div className={cn("absolute top-0 right-0 flex items-center justify-center text-[11px] font-bold transition-all", rankBadgeVariant ? "px-2 py-1 rounded" : "text-muted-foreground")} style={rankBadgeStyles || undefined}>
                <span style={{ color: rankTextColor }}>#{rank}</span>
              </div>

              {/* Thumbnail com botão de play centralizado */}
              <div className="relative h-28 w-20 flex-shrink-0 overflow-hidden rounded-md bg-black/40">
                {(() => {
                  // Priorizar adcreatives_videos_thumbs[0] sobre thumbnail_url
                  const adcreativesThumbs = (ad as any)?.adcreatives_videos_thumbs;
                  const thumbnail = Array.isArray(adcreativesThumbs) && adcreativesThumbs.length > 0 && adcreativesThumbs[0] ? String(adcreativesThumbs[0]).trim() : getAdThumbnail(ad);
                  return thumbnail ? (
                    <Image src={thumbnail} alt={ad.ad_name || "Ad thumbnail"} fill className="object-cover" sizes="96px" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <IconPhoto className="h-8 w-8 text-muted-foreground opacity-50" />
                    </div>
                  );
                })()}
                {/* Overlay escuro suave */}
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-black/50 via-black/20 to-transparent" />
                {/* Botão de play */}
                <button
                  className="absolute inset-0 flex items-center justify-center z-10"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onClick) {
                      onClick(true);
                    }
                  }}
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-black/70 shadow-lg ring-2 ring-white/40">
                    <IconPlayerPlayFilled className="ml-[1px] h-4 w-4 text-white" />
                  </div>
                </button>
              </div>

              {/* Conteúdo textual */}
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {/* Nome do anúncio e resumo abaixo */}
                <div className="space-y-0.5 pt-1">
                  <p className="truncate text-[13px] font-medium text-white" title={ad.ad_name || undefined}>
                    {ad.ad_name || "Sem nome"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatCurrency(spend)} • {impressions.toLocaleString("pt-BR")} impressões
                  </p>
                </div>

                {/* Métrica destacada */}
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-muted-foreground">{metricLabel}</span>
                  <span className="text-xl sm:text-xl font-extrabold leading-none text-white">{ad.metricFormatted}</span>
                </div>

                {/* Métricas adicionais customizadas */}
                {!isCompact && renderAdditionalMetrics && <div className="space-y-1.5 mt-2">{renderAdditionalMetrics()}</div>}

                {/* Barra de comparação com a média - sempre mostrar quando houver diffFromAverage */}
                {diffFromAverage != null && (
                  <div className={cn("mt-2 ml-auto w-fit inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold", isAboveAverage ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400")}>
                    {isAboveAverage ? <IconArrowUpRight className="h-3 w-3" /> : <IconArrowDownRight className="h-3 w-3" />}
                    <span>{`${isAboveAverage ? "+" : ""}${diffFromAverage.toFixed(0)}%`}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{tooltipContent || defaultTooltipContent}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

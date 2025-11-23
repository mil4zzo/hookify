"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import Image from "next/image";
import { IconPhoto, IconPlayerPlayFilled, IconArrowUpRight, IconArrowDownRight } from "@tabler/icons-react";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useFormatCurrency } from "@/lib/utils/currency";

interface GemCardProps {
  ad: {
    ad_id?: string | null;
    ad_name?: string | null;
    thumbnail?: string | null;
    metricValue: number;
    metricFormatted: string;
    [key: string]: any;
  };
  /** Rótulo legível da métrica (Hooks, Website CTR, Page, CTR) */
  metricLabel: string;
  rank: number;
  /** Identificador da métrica – usado para ajustar badges/cores conforme o print */
  metricKey: "hook" | "website_ctr" | "ctr" | "page_conv" | "hold_rate" | "cpm" | "cpr";
  averageValue?: number | null;
  metricColor?: {
    border: string;
    bg: string;
    text: string;
    accent: string;
    badge: string;
  };
  onClick?: (openVideo?: boolean) => void;
  /** Informações sobre o rank deste anúncio em cada métrica (null se não estiver no top) */
  topMetrics?: {
    spendRank: number | null;
    hookRank: number | null;
    websiteCtrRank: number | null;
    ctrRank: number | null;
    pageConvRank: number | null;
  };
  /** ActionType para calcular CPR */
  actionType?: string;
  /** Se true, mostra apenas a métrica principal. Se false, mostra todas as métricas */
  isCompact?: boolean;
}

export function GemCard({ ad, metricLabel, rank, metricKey, averageValue, metricColor, onClick, topMetrics, actionType, isCompact = true }: GemCardProps) {
  const formatCurrency = useFormatCurrency();

  // Estilos padrão para gems (amarelo/dourado sutil)
  const defaultGemStyles = {
    border: "border-yellow-500/30",
    bg: "bg-yellow-500/5",
    text: "text-yellow-600 dark:text-yellow-400",
    accent: "border-yellow-500",
    badge: "bg-yellow-500 text-white",
  };

  const gemStyles = metricColor || defaultGemStyles;

  // Obter label da métrica baseado no metricKey
  const metricLabelText = (() => {
    switch (metricKey) {
      case "hook":
        return "Hook";
      case "website_ctr":
        return "Website CTR";
      case "page_conv":
        return "Page";
      case "hold_rate":
        return "Hold Rate";
      case "cpm":
        return "CPM";
      case "cpr":
        return "CPR";
      case "ctr":
      default:
        return "CTR";
    }
  })();

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

  // Determinar se a métrica é "lower is better" (CPM, CPR) ou "higher is better" (outras)
  const isLowerBetter = metricKey === "cpm" || metricKey === "cpr";

  // Calcular se está acima da média
  const isAboveAverage = averageValue != null && ad.metricValue > averageValue;

  // Para métricas onde menor é melhor, inverter a lógica: acima da média = ruim (vermelho)
  const isBetter = isLowerBetter ? averageValue != null && ad.metricValue < averageValue : isAboveAverage;

  // Calcular diff percentual (sempre positivo quando melhor)
  const diffFromAverage = averageValue != null && averageValue > 0 ? Math.abs(((ad.metricValue - averageValue) / averageValue) * 100) : null;

  // Métricas adicionais para o tooltip e exibição
  const impressions = Number(ad.impressions || 0);
  const spend = Number(ad.spend || 0);
  const clicks = Number(ad.clicks || 0);
  const inlineLinkClicks = Number(ad.inline_link_clicks || 0);
  const plays = Number(ad.plays || 0);
  const lpv = Number(ad.lpv || 0);
  const cpm = impressions > 0 ? (spend * 1000) / impressions : Number(ad.cpm || 0);
  // CTR: priorizar valor do backend, senão calcular
  const ctr = typeof ad.ctr === "number" && !Number.isNaN(ad.ctr) && isFinite(ad.ctr) ? ad.ctr : impressions > 0 ? clicks / impressions : 0;
  // Website CTR: priorizar valor do backend, senão calcular
  const websiteCtr = typeof (ad as any).website_ctr === "number" && !Number.isNaN((ad as any).website_ctr) && isFinite((ad as any).website_ctr) ? (ad as any).website_ctr : impressions > 0 ? inlineLinkClicks / impressions : 0;
  // Connect Rate: priorizar valor do backend, senão calcular
  const connectRate = typeof ad.connect_rate === "number" && !Number.isNaN(ad.connect_rate) && isFinite(ad.connect_rate) ? ad.connect_rate : inlineLinkClicks > 0 ? lpv / inlineLinkClicks : 0;
  // Hook: sempre do backend
  const hook = Number(ad.hook || 0);
  // Hold Rate: sempre do backend
  const holdRate = Number((ad as any).hold_rate || 0);

  // Calcular CPR
  const cpr = (() => {
    // Se o ad já tem CPR calculado (vem do ranking), usar esse valor
    if ("cpr" in ad && typeof (ad as any).cpr === "number" && (ad as any).cpr > 0) {
      return (ad as any).cpr;
    }
    // Caso contrário, calcular baseado no actionType
    if (!actionType) return 0;
    const results = Number((ad as any).conversions?.[actionType] || 0);
    if (!results) return 0;
    return spend / results;
  })();

  // Calcular Page Conv
  const pageConv = (() => {
    // Se o ad já tem page_conv calculado (vem do ranking), usar esse valor
    if ("page_conv" in ad && typeof (ad as any).page_conv === "number" && !Number.isNaN((ad as any).page_conv) && isFinite((ad as any).page_conv)) {
      return (ad as any).page_conv;
    }
    // Caso contrário, calcular baseado no actionType
    if (!lpv || !actionType) return 0;
    const results = Number((ad as any).conversions?.[actionType] || 0);
    return results / lpv;
  })();

  // Função helper para formatar métricas
  const formatPct = (value: number): string => {
    if (value == null || Number.isNaN(value) || !isFinite(value) || value <= 0) return "—";
    return `${(value * 100).toFixed(2)}%`;
  };

  // Função helper para obter o rank de uma métrica específica
  const getMetricRank = (label: string): number | null => {
    switch (label) {
      case "Hook":
        return topMetrics?.hookRank ?? null;
      case "CTR (website)":
        return topMetrics?.websiteCtrRank ?? null;
      case "CTR":
        return topMetrics?.ctrRank ?? null;
      case "Page":
        return topMetrics?.pageConvRank ?? null;
      case "Hold Rate":
        return (topMetrics as any)?.holdRateRank ?? null;
      default:
        return null;
    }
  };

  // Definir todas as métricas na ordem solicitada: CPR, Hook, Hold Rate, CTR (website), CTR, Connect, Page, CPM
  // Para a métrica destacada, usar o valor já formatado que vem do ranking
  const metricsList = [
    { label: "CPR", value: cpr, formatted: cpr > 0 ? formatCurrency(cpr) : "—", isHighlighted: false },
    {
      label: "Hook",
      value: hook,
      formatted: metricKey === "hook" ? ad.metricFormatted : formatPct(hook),
      isHighlighted: metricKey === "hook",
    },
    {
      label: "Hold Rate",
      value: holdRate,
      formatted: metricKey === "hold_rate" ? ad.metricFormatted : formatPct(holdRate),
      isHighlighted: metricKey === "hold_rate",
    },
    {
      label: "CTR (website)",
      value: websiteCtr,
      formatted: metricKey === "website_ctr" ? ad.metricFormatted : formatPct(websiteCtr),
      isHighlighted: metricKey === "website_ctr",
    },
    { label: "CTR", value: ctr, formatted: metricKey === "ctr" ? ad.metricFormatted : formatPct(ctr), isHighlighted: metricKey === "ctr" },
    { label: "Connect", value: connectRate, formatted: formatPct(connectRate), isHighlighted: false },
    {
      label: "Page",
      value: pageConv,
      formatted: metricKey === "page_conv" ? ad.metricFormatted : formatPct(pageConv),
      isHighlighted: metricKey === "page_conv",
    },
    {
      label: "CPM",
      value: cpm,
      formatted: metricKey === "cpm" ? ad.metricFormatted : formatCurrency(cpm),
      isHighlighted: metricKey === "cpm",
    },
    {
      label: "CPR",
      value: cpr,
      formatted: metricKey === "cpr" ? ad.metricFormatted : formatCurrency(cpr),
      isHighlighted: metricKey === "cpr",
    },
  ];

  // Métrica destacada (para exibir no topo)
  const highlightedMetric = metricsList.find((m) => m.isHighlighted);

  // No modo expandido, mostrar todas as métricas na ordem: CPR, Hook, CTR (website), CTR, Connect, Page
  // A métrica destacada aparece tanto no topo quanto na lista completa
  const allMetrics = metricsList;

  // Determinar opacidade: 35% se abaixo da média, 100% se acima da média
  const isBelowAverage = averageValue != null && ad.metricValue <= averageValue;

  // Determinar variant do badge para o rank (1=gold, 2=silver, 3=copper)
  const rankBadgeVariant = getBadgeVariant(rank);
  const rankBadgeStyles = getBadgeStyles(rankBadgeVariant);
  const rankTextColor = rankBadgeVariant ? "#1a1a1a" : undefined;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Card */}
          <div className={cn("p-4 relative cursor-pointer rounded-xl border border-border bg-card transition-all duration-420 hover:-translate-y-2 hover:shadow-[0_0_60px_rgba(250,204,21,0.35)] opacity-100")} onClick={() => onClick?.()}>
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
                {highlightedMetric && (
                  <div className="flex items-end justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-muted-foreground">{highlightedMetric.label}</span>
                      <span className="text-xl sm:text-xl font-extrabold leading-none text-white">{highlightedMetric.formatted}</span>
                    </div>
                    {/* Barra de comparação com a média - posicionada à direita e alinhada ao fundo */}
                    {diffFromAverage != null && (
                      <div className={cn("flex-shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold", isBetter ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400")}>
                        {isBetter ? <IconArrowUpRight className="h-3 w-3" /> : <IconArrowDownRight className="h-3 w-3" />}
                        <span>{`${diffFromAverage != null && diffFromAverage > 0 ? "+" : ""}${diffFromAverage != null ? diffFromAverage.toFixed(0) : "0"}%`}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Todas as métricas - apenas no modo expandido, na ordem: CPR, Hook, CTR (website), CTR, Connect, Page */}
                {!isCompact && allMetrics.length > 0 && (
                  <div className="space-y-1.5 mt-2">
                    {allMetrics.map((metric) => {
                      const metricRank = getMetricRank(metric.label);
                      const badgeVariant = getBadgeVariant(metricRank);
                      const badgeStyles = getBadgeStyles(badgeVariant);
                      const hasBadge = !!badgeVariant;
                      const textColor = hasBadge ? "#1a1a1a" : undefined;

                      return (
                        <div key={metric.label} className="flex items-baseline justify-between gap-2 px-2 py-1 rounded transition-all" style={badgeStyles || undefined}>
                          <span className="text-sm font-medium" style={{ color: textColor }}>
                            {metric.label}
                          </span>
                          <span className="text-sm font-medium" style={{ color: textColor }}>
                            {metric.formatted}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
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
              <div>
                <span className="text-muted-foreground">Cliques:</span>
                <span className="ml-2 font-medium">{clicks.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Plays:</span>
                <span className="ml-2 font-medium">{plays.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-muted-foreground">CPM:</span>
                <span className="ml-2 font-medium">{formatCurrency(cpm)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">CTR:</span>
                <span className="ml-2 font-medium">{(ctr * 100).toFixed(2)}%</span>
              </div>
              <div>
                <span className="text-muted-foreground">Website CTR:</span>
                <span className="ml-2 font-medium">{(websiteCtr * 100).toFixed(2)}%</span>
              </div>
              <div>
                <span className="text-muted-foreground">Connect Rate:</span>
                <span className="ml-2 font-medium">{(connectRate * 100).toFixed(2)}%</span>
              </div>
              {hook > 0 && (
                <div>
                  <span className="text-muted-foreground">Hook:</span>
                  <span className="ml-2 font-medium">{(hook * 100).toFixed(2)}%</span>
                </div>
              )}
              {holdRate > 0 && (
                <div>
                  <span className="text-muted-foreground">Hold Rate:</span>
                  <span className="ml-2 font-medium">{(holdRate * 100).toFixed(2)}%</span>
                </div>
              )}
              {lpv > 0 && (
                <div>
                  <span className="text-muted-foreground">LPV:</span>
                  <span className="ml-2 font-medium">{lpv.toLocaleString()}</span>
                </div>
              )}
            </div>
            <div className="pt-2 mt-2 border-t border-border text-xs text-muted-foreground">Clique para ver detalhes completos e histórico</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

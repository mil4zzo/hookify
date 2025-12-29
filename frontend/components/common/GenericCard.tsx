"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { IconArrowBigDownLinesFilled, IconArrowBigUpLinesFilled, IconEye } from "@tabler/icons-react";
import { AdStatusIcon } from "@/components/common/AdStatusIcon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useFormatCurrency } from "@/lib/utils/currency";
import { normalizeLeadscoreValues, computeLeadscoreAverage } from "@/lib/utils/mqlMetrics";
import { isLowerBetterMetric } from "@/lib/constants/metrics";
import { AdPlayArea } from "@/components/common/AdPlayArea";
import { StandardCard } from "@/components/common/StandardCard";

interface GenericCardProps {
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
  metricKey: "hook" | "website_ctr" | "ctr" | "page_conv" | "hold_rate" | "cpm" | "cpr" | "cpmql";
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
    holdRateRank: number | null;
    cprRank: number | null;
    cpmqlRank: number | null;
  };
  /** ActionType para calcular CPR */
  actionType?: string;
  /** Objeto com todas as médias para colorir o tooltip (opcional) */
  averages?: {
    hook?: number | null;
    hold_rate?: number | null;
    website_ctr?: number | null;
    connect_rate?: number | null;
    ctr?: number | null;
    cpm?: number | null;
    per_action_type?: {
      [actionType: string]: {
        cpr?: number | null;
        page_conv?: number | null;
      };
    };
  };
}

export function GenericCard({ ad, metricLabel, rank, metricKey, averageValue, metricColor, onClick, topMetrics, actionType, averages }: GenericCardProps) {
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
        return "Link CTR";
      case "page_conv":
        return "Page";
      case "hold_rate":
        return "Hold Rate";
      case "cpm":
        return "CPM";
      case "cpr":
        return "CPR";
      case "cpmql":
        return "CPMQL";
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
  const isLowerBetter = isLowerBetterMetric(metricKey);

  // Calcular se está acima da média
  const isAboveAverage = averageValue != null && ad.metricValue > averageValue;

  // Para métricas onde menor é melhor, inverter a lógica: acima da média = ruim (vermelho)
  const isBetter = isLowerBetter ? averageValue != null && ad.metricValue < averageValue : isAboveAverage;

  // Calcular diff percentual (sempre positivo quando melhor)
  const diffFromAverage = (() => {
    if (averageValue == null || averageValue <= 0) return null;
    if (ad.metricValue == null || !Number.isFinite(ad.metricValue)) return null;
    const diff = Math.abs(((ad.metricValue - averageValue) / averageValue) * 100);
    return Number.isFinite(diff) ? diff : null;
  })();

  // Função para determinar a cor baseada na relação atual/média (similar a OpportunityWidget.tsx)
  const getValueColor = (current: number, average: number | null | undefined, metricKeyForColor: "hook" | "website_ctr" | "ctr" | "page_conv" | "hold_rate" | "cpm" | "cpr" | "cpmql" | "connect_rate"): string => {
    if (average == null || average <= 0) return "text-foreground"; // Sem média válida

    const lowerIsBetter = isLowerBetterMetric(metricKeyForColor);

    if (lowerIsBetter) {
      // Para métricas onde menor é melhor (ex: CPR, CPM)
      // Se atual <= média, está abaixo/igual à média (melhor) = verde
      if (current <= average) return "text-green-600 dark:text-green-400";

      // Calcular ratio: atual/média (quanto maior que a média)
      const ratio = current / average;

      // Classificação baseada no ratio
      if (ratio > 1 && ratio <= 1.25) return "text-yellow-600 dark:text-yellow-400"; // 100%~125% = amarelo
      if (ratio > 1.25 && ratio <= 1.5) return "text-orange-600 dark:text-orange-400"; // 125%~150% = laranja
      if (ratio > 1.5) return "text-red-600 dark:text-red-400"; // 150%+ = vermelho
      return "text-foreground"; // Fallback
    } else {
      // Para métricas onde maior é melhor (ex: Hook, CTR, etc)
      const ratio = current / average;
      // Se atual >= média, está acima/igual à média (melhor) = verde
      if (current >= average) return "text-green-600 dark:text-green-400";

      // Classificação baseada no ratio
      if (ratio >= 0.75 && ratio < 1) return "text-yellow-600 dark:text-yellow-400"; // 75%~100% = amarelo
      if (ratio >= 0.5 && ratio < 0.75) return "text-orange-600 dark:text-orange-400"; // 50%~75% = laranja
      return "text-red-600 dark:text-red-400"; // 0%~50% = vermelho
    }
  };

  // Métricas adicionais para o tooltip e exibição
  const impressions = Number(ad.impressions || 0);
  const spend = Number(ad.spend || 0);
  const clicks = Number(ad.clicks || 0);
  const inlineLinkClicks = Number(ad.inline_link_clicks || 0);
  const plays = Number(ad.plays || 0);
  const lpv = Number(ad.lpv || 0);
  // CPM: priorizar valor do backend, senão calcular
  const cpm = typeof ad.cpm === "number" && !Number.isNaN(ad.cpm) && isFinite(ad.cpm) ? ad.cpm : impressions > 0 ? (spend * 1000) / impressions : 0;
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

  // Função helper para formatar percentuais com 1 casa decimal
  const formatPct1 = (value: number): string => {
    if (value == null || Number.isNaN(value) || !isFinite(value) || value <= 0) return "—";
    return `${(value * 100).toFixed(1)}%`;
  };

  // Função helper para formatar percentuais com 2 casas decimais
  const formatPct2 = (value: number): string => {
    if (value == null || Number.isNaN(value) || !isFinite(value) || value <= 0) return "—";
    return `${(value * 100).toFixed(2)}%`;
  };

  // Calcular conversões a partir de CPR e Spend
  const conversions = cpr > 0 && Number.isFinite(cpr) ? Math.round(spend / cpr) : 0;

  // Métricas extras para o tooltip
  const videoWatchedP50 = Number((ad as any).video_watched_p50 || 0);
  const videoTotalThruplays = Number((ad as any).video_total_thruplays || 0);
  const videoTotalPlays = Number((ad as any).video_total_plays || plays || 0);
  const thruplaysRate = videoTotalPlays > 0 ? videoTotalThruplays / videoTotalPlays : 0;
  const reach = Number((ad as any).reach || 0);
  const frequencyFromBackend = Number((ad as any).frequency || 0);
  const frequency = frequencyFromBackend > 0 ? frequencyFromBackend : reach > 0 ? impressions / reach : 0;

  // Leadscore e MQLs (valores normalizados e média centralizada)
  const leadscoreValues = normalizeLeadscoreValues((ad as any).leadscore_values);
  const leadscoreAvg = computeLeadscoreAverage(leadscoreValues);
  const mqlCount = Number((ad as any).mql_count || 0);
  const cpmql = mqlCount > 0 ? spend / mqlCount : Number((ad as any).cpmql || 0);

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
        return topMetrics?.holdRateRank ?? null;
      case "CPR":
        return topMetrics?.cprRank ?? null;
      case "CPMQL":
        return topMetrics?.cpmqlRank ?? null;
      default:
        return null;
    }
  };

  // Definir todas as métricas na ordem solicitada: CPR, Hook, Hold Rate, CTR (website), CTR, Connect, Page, CPM, CPMQL
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
      label: "Link CTR",
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
    {
      label: "CPMQL",
      value: cpmql,
      formatted: metricKey === "cpmql" ? ad.metricFormatted : formatCurrency(cpmql),
      isHighlighted: metricKey === "cpmql",
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

  const handleCardClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.();
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Card */}
          <StandardCard variant="default" padding="md" interactive={true} onClick={handleCardClick} className="group relative opacity-100">
            <div className="relative flex items-stretch gap-3 sm:gap-4">
              {/* Thumbnail com botão de play centralizado */}
              <AdPlayArea
                ad={ad}
                aspectRatio="3:4"
                size="h-28 w-20"
                onPlayClick={(e) => {
                  e.stopPropagation();
                  if (onClick) {
                    onClick(true);
                  }
                }}
              />

              {/* Conteúdo textual */}
              <div className="flex min-w-0 justify-between flex-1 flex-col">
                {/* Nome do anúncio e resumo abaixo */}
                <div className="space-y-0.5">
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <p className="truncate text-[13px] font-medium text-white flex-1 min-w-0" title={ad.ad_name || undefined}>
                      {ad.ad_name || "Sem nome"}
                    </p>
                    {/* Rank badge na mesma linha do título */}
                    <div className={cn("flex items-center justify-center text-[11px] font-bold transition-all flex-shrink-0 px-2 py-1 rounded text-muted-foreground")} style={rankBadgeStyles || undefined}>
                      <span style={{ color: rankTextColor }}>#{rank}</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-3">
                    <AdStatusIcon status={(ad as any).effective_status} />
                    <span className="leading-none">{formatCurrency(spend)}</span>
                    <span className="flex items-center gap-1">
                      <IconEye className="h-3 w-3" /> <span className="leading-none">{impressions.toLocaleString("pt-BR")}</span>
                    </span>
                  </p>
                </div>

                {/* Métrica destacada */}
                {highlightedMetric && (
                  <div className="flex flex-row items-end justify-between gap-1 mt-auto">
                    <div className="flex flex-col items-start">
                      <span className="text-sm font-medium text-muted-foreground">{highlightedMetric.label}</span>
                      <span className="text-xl sm:text-xl font-extrabold leading-none sm:leading-none text-white">{highlightedMetric.formatted}</span>
                    </div>
                    {/* Barra de comparação com a média - posicionada à direita e alinhada ao fundo */}
                    {diffFromAverage != null && (
                      <div className="flex flex-col items-end gap-1">
                        <div className={cn("flex-shrink-0 inline-flex items-center text-[12px] gap-1 font-semibold", isBetter ? "text-emerald-400" : "text-red-400")}>
                          {/* Para métricas onde menor é melhor (CPM, CPR): quando está ruim (acima da média), mostrar seta para cima */}
                          {/* Para métricas normais: quando está bom (acima da média), mostrar seta para cima */}
                          {isLowerBetter ? isBetter ? <IconArrowBigDownLinesFilled className="h-3 w-3" /> : <IconArrowBigUpLinesFilled className="h-3 w-3" /> : isBetter ? <IconArrowBigUpLinesFilled className="h-3 w-3" /> : <IconArrowBigDownLinesFilled className="h-3 w-3" />}
                          <span>{`${diffFromAverage != null ? diffFromAverage.toFixed(0) : "0"}%`}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </StandardCard>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs" side="right" sideOffset={12} align="start" alignOffset={-16}>
          <div className="space-y-4">
            <div className="font-semibold text-sm mb-2">{ad.ad_name || ad.ad_id}</div>

            {/* Resultados */}
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-foreground">Resultados{conversions > 0 ? `: ${conversions.toLocaleString("pt-BR")} conversões` : ""}</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div>
                  <span className="text-muted-foreground">CPR:</span>
                  <span className={cn("ml-2 font-medium", averages && actionType ? getValueColor(cpr, averages.per_action_type?.[actionType]?.cpr ?? null, "cpr") : "")}>{cpr > 0 ? formatCurrency(cpr) : "—"}</span>
                </div>
                {cpmql > 0 && (
                  <div>
                    <span className="text-muted-foreground">CPMQL:</span>
                    <span className="ml-2 font-medium">
                      {formatCurrency(cpmql)} {mqlCount > 0 && `(${mqlCount.toLocaleString("pt-BR")} MQLs)`}
                    </span>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Spend:</span>
                  <span className="ml-2 font-medium">{formatCurrency(spend)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">CPM:</span>
                  <span className={cn("ml-2 font-medium", averages ? getValueColor(cpm, averages.cpm ?? null, "cpm") : "")}>{formatCurrency(cpm)}</span>
                </div>
              </div>
            </div>

            {/* Funil */}
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-foreground">Funil</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div>
                  <span className="text-muted-foreground">CTR:</span>
                  <span className={cn("ml-2 font-medium", averages ? getValueColor(ctr, averages.ctr ?? null, "ctr") : "")}>{formatPct2(ctr)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Link CTR:</span>
                  <span className={cn("ml-2 font-medium", averages ? getValueColor(websiteCtr, averages.website_ctr ?? null, "website_ctr") : "")}>{formatPct2(websiteCtr)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Connect Rate:</span>
                  <span className={cn("ml-2 font-medium", averages ? getValueColor(connectRate, averages.connect_rate ?? null, "connect_rate") : "")}>{formatPct1(connectRate)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Conversão Página:</span>
                  <span className={cn("ml-2 font-medium", averages && actionType ? getValueColor(pageConv, averages.per_action_type?.[actionType]?.page_conv ?? null, "page_conv") : "")}>{formatPct1(pageConv)}</span>
                </div>
              </div>
            </div>

            {/* Performance */}
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-foreground">Performance</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div>
                  <span className="text-muted-foreground">Hook Rate:</span>
                  <span className={cn("ml-2 font-medium", averages ? getValueColor(hook, averages.hook ?? null, "hook") : "")}>{formatPct1(hook)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Hold Rate:</span>
                  <span className={cn("ml-2 font-medium", averages ? getValueColor(holdRate, averages.hold_rate ?? null, "hold_rate") : "")}>{formatPct1(holdRate)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">50% View Rate:</span>
                  <span className="ml-2 font-medium">{formatPct1(videoWatchedP50 / 100)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">ThruPlays Rate:</span>
                  <span className="ml-2 font-medium">{formatPct1(thruplaysRate)}</span>
                </div>
              </div>
            </div>

            {/* Extras */}
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-foreground">Extras</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {leadscoreAvg > 0 && (
                  <div>
                    <span className="text-muted-foreground">Leadscore médio:</span>
                    <span className="ml-2 font-medium">{leadscoreAvg.toFixed(1)}</span>
                  </div>
                )}
                {frequency > 0 && (
                  <div>
                    <span className="text-muted-foreground">Frequência:</span>
                    <span className="ml-2 font-medium">{frequency.toFixed(2)}</span>
                  </div>
                )}
                {impressions > 0 && (
                  <div>
                    <span className="text-muted-foreground">Impressões:</span>
                    <span className="ml-2 font-medium">{impressions.toLocaleString("pt-BR")}</span>
                  </div>
                )}
                {reach > 0 && (
                  <div>
                    <span className="text-muted-foreground">Alcance:</span>
                    <span className="ml-2 font-medium">{reach.toLocaleString("pt-BR")}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-2 mt-2 border-t border-border text-xs text-muted-foreground">Clique para ver detalhes completos e histórico</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

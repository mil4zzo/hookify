"use client";

import React from "react";
import { cn } from "@/lib/utils/cn";
import { IconArrowBigDownLinesFilled, IconArrowBigUpLinesFilled, IconEye } from "@tabler/icons-react";
import { AdStatusIcon } from "@/components/common/AdStatusIcon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useFormatCurrency } from "@/lib/utils/currency";
import { normalizeLeadscoreValues, computeLeadscoreAverage } from "@/lib/utils/mqlMetrics";
import { formatMetricValue, getMetricDisplayLabel, getMetricNumericValue, isLowerBetterMetric, type MetricKey } from "@/lib/metrics";
import { getTopBadgeStyleConfig, getTopBadgeStyles, getTopBadgeVariantFromRank } from "@/lib/utils/topBadgeStyles";
import { AdPlayArea } from "@/components/common/AdPlayArea";
import { StandardCard } from "@/components/common/StandardCard";

type GenericCardMetricKey = Extract<MetricKey, "score" | "spend" | "scroll_stop" | "hook" | "website_ctr" | "ctr" | "page_conv" | "hold_rate" | "video_watched_p50" | "cpm" | "cpc" | "cpr" | "cpmql" | "connect_rate">;

interface GenericCardProps {
  ad: {
    ad_id?: string | null;
    ad_name?: string | null;
    thumbnail?: string | null;
    metricValue: number | null;
    metricFormatted: string;
    [key: string]: any;
  };
  /** Rótulo legível da métrica (Hooks, Website CTR, Page, CTR) */
  metricLabel: string;
  rank: number;
  /** Identificador da métrica – usado para ajustar badges/cores conforme o print */
  metricKey: GenericCardMetricKey;
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
  selected?: boolean;
}

export function GenericCard({ ad, metricLabel, rank, metricKey, averageValue, metricColor, onClick, topMetrics, actionType, averages, selected = false }: GenericCardProps) {
  const formatCurrency = useFormatCurrency();

  // Estilos padrão para gems (amarelo/dourado sutil)
  const defaultGemStyles = {
    border: "border-warning-30",
    bg: "bg-warning-10",
    text: "text-warning",
    accent: "border-warning",
    badge: "bg-warning text-warning-foreground",
  };

  const gemStyles = metricColor || defaultGemStyles;

  // Obter label da métrica baseado no metricKey
  // Função helper para obter estilos do badge baseado no variant (fonte única: topBadgeStyles)
  const getBadgeStyles = (variant: "gold" | "silver" | "copper" | null): React.CSSProperties | null => {
    const config = getTopBadgeStyleConfig(variant);
    if (!config) return null;
    return getTopBadgeStyles(variant, { borderRadius: "6px", padding: "4px 8px" });
  };

  // Determinar se a métrica é "lower is better" (CPM, CPR) ou "higher is better" (outras)
  const isLowerBetter = isLowerBetterMetric(metricKey);
  const metricValue = ad.metricValue != null && Number.isFinite(ad.metricValue) ? ad.metricValue : null;
  const hasMetricValue = metricValue != null;

  // Calcular se está acima da média
  const isAboveAverage = averageValue != null && hasMetricValue ? metricValue > averageValue : false;

  // Para métricas onde menor é melhor, inverter a lógica: acima da média = ruim (vermelho)
  const isBetter = averageValue != null && hasMetricValue ? (isLowerBetter ? metricValue < averageValue : metricValue > averageValue) : false;

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
      if (current <= average) return "text-success";

      // Calcular ratio: atual/média (quanto maior que a média)
      const ratio = current / average;

      // Classificação baseada no ratio
      if (ratio > 1 && ratio <= 1.25) return "text-warning"; // 100%~125% = amarelo
      if (ratio > 1.25 && ratio <= 1.5) return "text-warning"; // 125%~150% = laranja
      if (ratio > 1.5) return "text-destructive"; // 150%+ = vermelho
      return "text-foreground"; // Fallback
    } else {
      // Para métricas onde maior é melhor (ex: Hook, CTR, etc)
      const ratio = current / average;
      // Se atual >= média, está acima/igual à média (melhor) = verde
      if (current >= average) return "text-success";

      // Classificação baseada no ratio
      if (ratio >= 0.75 && ratio < 1) return "text-warning"; // 75%~100% = amarelo
      if (ratio >= 0.5 && ratio < 0.75) return "text-warning"; // 50%~75% = laranja
      return "text-destructive"; // 0%~50% = vermelho
    }
  };

  // Métricas adicionais para o tooltip e exibição
  const impressions = Number(ad.impressions || 0);
  const spend = Number(ad.spend || 0);
  const plays = Number(ad.plays || 0);
  const cpm = getMetricNumericValue(ad as any, "cpm");
  const ctr = getMetricNumericValue(ad as any, "ctr");
  const websiteCtr = getMetricNumericValue(ad as any, "website_ctr");
  const connectRate = getMetricNumericValue(ad as any, "connect_rate");
  const hook = getMetricNumericValue(ad as any, "hook");
  const holdRate = getMetricNumericValue(ad as any, "hold_rate");
  const cpr = getMetricNumericValue(ad as any, "cpr", { actionType });
  const pageConv = getMetricNumericValue(ad as any, "page_conv", { actionType });

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
  const cpmql = getMetricNumericValue(ad as any, "cpmql");

  // Função helper para obter o rank de uma métrica específica
  // Definir todas as métricas na ordem solicitada: CPR, Hook, Hold Rate, CTR (website), CTR, Connect, Page, CPM, CPMQL
  // Para a métrica destacada, usar o valor já formatado que vem do ranking
  const metricsList = [
    ...(metricKey === "score"
      ? [
          {
            label: metricLabel,
            value: Number(ad.metricValue || 0),
            formatted: ad.metricFormatted,
            isHighlighted: true,
          },
        ]
      : []),
    { label: getMetricDisplayLabel("cpr"), value: cpr, formatted: cpr > 0 ? formatMetricValue("cpr", cpr, { currencyFormatter: formatCurrency }) : "—", isHighlighted: false },
    {
      label: getMetricDisplayLabel("hook"),
      value: hook,
      formatted: metricKey === "hook" ? ad.metricFormatted : formatPct(hook),
      isHighlighted: metricKey === "hook",
    },
    {
      label: getMetricDisplayLabel("hold_rate"),
      value: holdRate,
      formatted: metricKey === "hold_rate" ? ad.metricFormatted : formatPct(holdRate),
      isHighlighted: metricKey === "hold_rate",
    },
    {
      label: getMetricDisplayLabel("website_ctr"),
      value: websiteCtr,
      formatted: metricKey === "website_ctr" ? ad.metricFormatted : formatPct(websiteCtr),
      isHighlighted: metricKey === "website_ctr",
    },
    { label: getMetricDisplayLabel("ctr"), value: ctr, formatted: metricKey === "ctr" ? ad.metricFormatted : formatPct(ctr), isHighlighted: metricKey === "ctr" },
    { label: getMetricDisplayLabel("connect_rate"), value: connectRate, formatted: formatPct(connectRate), isHighlighted: false },
    {
      label: getMetricDisplayLabel("page_conv", { preferShortLabel: true }),
      value: pageConv,
      formatted: metricKey === "page_conv" ? ad.metricFormatted : formatPct(pageConv),
      isHighlighted: metricKey === "page_conv",
    },
    {
      label: getMetricDisplayLabel("cpm"),
      value: cpm,
      formatted: metricKey === "cpm" ? ad.metricFormatted : formatMetricValue("cpm", cpm, { currencyFormatter: formatCurrency }),
      isHighlighted: metricKey === "cpm",
    },
    {
      label: getMetricDisplayLabel("cpr"),
      value: cpr,
      formatted: metricKey === "cpr" ? ad.metricFormatted : formatMetricValue("cpr", cpr, { currencyFormatter: formatCurrency }),
      isHighlighted: metricKey === "cpr",
    },
    {
      label: getMetricDisplayLabel("cpmql"),
      value: cpmql,
      formatted: metricKey === "cpmql" ? ad.metricFormatted : formatMetricValue("cpmql", cpmql, { currencyFormatter: formatCurrency }),
      isHighlighted: metricKey === "cpmql",
    },
  ];

  // Métrica destacada (para exibir no topo)
  const highlightedMetric = {
    label: metricLabel,
    formatted: ad.metricFormatted,
  };

  // No modo expandido, mostrar todas as métricas na ordem: CPR, Hook, CTR (website), CTR, Connect, Page
  // A métrica destacada aparece tanto no topo quanto na lista completa
  const allMetrics = metricsList;

  // Determinar opacidade: 35% se abaixo da média, 100% se acima da média
  const isBelowAverage = averageValue != null && hasMetricValue ? metricValue <= averageValue : false;

  // Determinar variant do badge para o rank (1=gold, 2=silver, 3=copper)
  const rankBadgeVariant = getTopBadgeVariantFromRank(rank);
  const rankBadgeStyles = getBadgeStyles(rankBadgeVariant);
  const rankTextColor = rankBadgeVariant ? getTopBadgeStyleConfig(rankBadgeVariant)?.textColor : undefined;

  const handleCardClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.();
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Card */}
          <StandardCard variant="default" padding="md" interactive={true} onClick={handleCardClick} className={cn("group relative w-full min-w-0 max-w-full overflow-hidden opacity-100", selected && "border-primary bg-card-hover ring-2 ring-primary-20")}>
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
                        <div className={cn("flex-shrink-0 inline-flex items-center text-[12px] gap-1 font-semibold", isBetter ? "text-success" : "text-destructive")}>
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

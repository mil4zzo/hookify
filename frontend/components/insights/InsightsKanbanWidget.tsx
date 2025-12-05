"use client";

import { useState, useMemo } from "react";
import { RankingsItem, RankingsResponse } from "@/lib/api/schemas";
import { ValidationCondition } from "@/components/common/ValidationCriteriaBuilder";
import { evaluateValidationCriteria, AdMetricsData } from "@/lib/utils/validateAdCriteria";
import { GenericCard } from "@/components/common/GenericCard";
import { calculateGlobalMetricRanks } from "@/lib/utils/metricRankings";
import { useFormatCurrency } from "@/lib/utils/currency";
import { computeCpmImpact, computeLandingPageImpact } from "@/lib/utils/impact";
import { BaseKanbanWidget, KanbanColumnConfig } from "@/components/common/BaseKanbanWidget";
import { SortableColumn } from "@/components/common/SortableColumn";
import { GenericColumnColorScheme } from "@/components/common/GenericColumn";

const STORAGE_KEY_INSIGHTS_COLUMN_ORDER = "hookify-insights-column-order";
const DEFAULT_INSIGHTS_COLUMN_TITLES = ["Landing Page", "CPM", "Spend", "Coluna 4"] as const;
type InsightsColumnType = (typeof DEFAULT_INSIGHTS_COLUMN_TITLES)[number];
// Flag de debug temporário para entender por que anúncios não entram na coluna Landing Page
const DEBUG_PAGE_CONV = true;

interface InsightsKanbanWidgetProps {
  ads: RankingsItem[];
  averages?: RankingsResponse["averages"];
  actionType: string;
  validationCriteria: ValidationCondition[];
  dateStart?: string;
  dateStop?: string;
  availableConversionTypes?: string[];
}

/**
 * Função helper para mapear RankingsItem para AdMetricsData
 */
function mapRankingToMetrics(ad: RankingsItem, actionType: string): AdMetricsData {
  const impressions = Number((ad as any).impressions || 0);
  const spend = Number((ad as any).spend || 0);
  const cpm = impressions > 0 ? (spend * 1000) / impressions : Number((ad as any).cpm || 0);
  const website_ctr = Number((ad as any).website_ctr || 0);
  const connect_rate = Number((ad as any).connect_rate || 0);
  const lpv = Number((ad as any).lpv || 0);
  const results = actionType ? Number((ad as any).conversions?.[actionType] || 0) : 0;
  const page_conv = lpv > 0 ? results / lpv : 0;
  const overall_conversion = website_ctr * connect_rate * page_conv;

  return {
    ad_name: (ad as any).ad_name,
    ad_id: (ad as any).ad_id,
    account_id: (ad as any).account_id,
    impressions,
    spend,
    cpm,
    website_ctr,
    connect_rate,
    inline_link_clicks: Number((ad as any).inline_link_clicks || 0),
    clicks: Number((ad as any).clicks || 0),
    plays: Number((ad as any).plays || 0),
    hook: Number((ad as any).hook || 0),
    ctr: Number((ad as any).ctr || 0),
    page_conv,
    overall_conversion,
  };
}

/**
 * Função helper para obter valor de métrica
 */
function getMetricValue(ad: any, metric: "hook" | "website_ctr" | "ctr" | "page_conv" | "hold_rate", actionType: string): number {
  switch (metric) {
    case "hook":
      return Number(ad.hook || 0);
    case "website_ctr":
      return Number(ad.website_ctr || 0);
    case "ctr":
      return Number(ad.ctr || 0);
    case "hold_rate":
      return Number((ad as any).hold_rate || 0);
    case "page_conv": {
      const lpv = Number(ad.lpv || 0);
      const results = actionType ? Number(ad.conversions?.[actionType] || 0) : 0;
      return lpv > 0 ? results / lpv : 0;
    }
    default:
      return 0;
  }
}

/**
 * Função helper para formatar métrica
 */
function formatMetric(value: number, metric: "hook" | "website_ctr" | "ctr" | "page_conv" | "hold_rate"): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * Widget de Kanban para a seção Insights.
 * Usa a mesma estrutura e estilização de Gems.
 * Colunas são arrastáveis para reordenar.
 */
export function InsightsKanbanWidget({ ads, averages, actionType, validationCriteria, dateStart, dateStop, availableConversionTypes = [] }: InsightsKanbanWidgetProps) {
  const formatCurrency = useFormatCurrency();

  // Esquemas de cores baseados nos estilos de Gems
  const allColorSchemes: GenericColumnColorScheme[] = [
    {
      headerBg: "bg-orange-500/10 border-orange-500/30",
      title: "",
      card: {
        border: "border-orange-500/30",
        bg: "bg-orange-500/5",
        text: "text-orange-600 dark:text-orange-400",
        accent: "border-orange-500",
        badge: "bg-orange-500 text-white",
      },
    },
    {
      headerBg: "bg-purple-500/10 border-purple-500/30",
      title: "",
      card: {
        border: "border-purple-500/30",
        bg: "bg-purple-500/5",
        text: "text-purple-600 dark:text-purple-400",
        accent: "border-purple-500",
        badge: "bg-purple-500 text-white",
      },
    },
    {
      headerBg: "bg-green-500/10 border-green-500/30",
      title: "",
      card: {
        border: "border-green-500/30",
        bg: "bg-green-500/5",
        text: "text-green-600 dark:text-green-400",
        accent: "border-green-500",
        badge: "bg-green-500 text-white",
      },
    },
    {
      headerBg: "bg-blue-500/10 border-blue-500/30",
      title: "",
      card: {
        border: "border-blue-500/30",
        bg: "bg-blue-500/5",
        text: "text-blue-600 dark:text-blue-400",
        accent: "border-blue-500",
        badge: "bg-blue-500 text-white",
      },
    },
  ];

  // 1. Filtrar apenas anúncios validados
  const validatedAds = useMemo(() => {
    if (!validationCriteria || validationCriteria.length === 0) {
      return ads;
    }

    return ads.filter((ad) => {
      const metrics = mapRankingToMetrics(ad, actionType);
      return evaluateValidationCriteria(validationCriteria, metrics, "AND");
    });
  }, [ads, validationCriteria, actionType]);

  // 2. Calcular rankings globais
  const globalMetricRanks = useMemo(() => {
    if (!ads || ads.length === 0) {
      return {
        hookRank: new Map(),
        holdRateRank: new Map(),
        websiteCtrRank: new Map(),
        connectRateRank: new Map(),
        pageConvRank: new Map(),
        ctrRank: new Map(),
        spendRank: new Map(),
      };
    }
    const criteriaToUse = validationCriteria && validationCriteria.length > 0 ? validationCriteria : undefined;
    return calculateGlobalMetricRanks(ads, {
      validationCriteria: criteriaToUse,
      actionType,
      filterValidOnly: true,
    });
  }, [ads, validationCriteria, actionType]);

  // 3. Função helper para obter ranks de um anúncio
  const getTopMetrics = (adId: string | null | undefined) => {
    if (!adId) {
      return {
        spendRank: null,
        hookRank: null,
        websiteCtrRank: null,
        ctrRank: null,
        pageConvRank: null,
        holdRateRank: null,
      };
    }

    return {
      spendRank: globalMetricRanks.spendRank.get(adId) ?? null,
      hookRank: globalMetricRanks.hookRank.get(adId) ?? null,
      websiteCtrRank: globalMetricRanks.websiteCtrRank.get(adId) ?? null,
      ctrRank: globalMetricRanks.ctrRank.get(adId) ?? null,
      pageConvRank: globalMetricRanks.pageConvRank.get(adId) ?? null,
      holdRateRank: globalMetricRanks.holdRateRank.get(adId) ?? null,
    };
  };

  // 4. Obter valores médios
  const avgWebsiteCtr = averages?.website_ctr ?? null;
  const avgConnectRate = averages?.connect_rate ?? null;
  const avgPageConv = actionType && averages?.per_action_type?.[actionType] ? averages.per_action_type[actionType].page_conv ?? null : null;
  const avgCpm = averages?.cpm ?? null;

  // 5. Filtrar anúncios para a coluna "Landing Page"
  // Critérios: Website CTR > média, Connect Rate > média, Page Conv < média
  const pageConvColumnAds = useMemo(() => {
    if (!validatedAds || validatedAds.length === 0) return [];
    // Se alguma média não estiver disponível, não aplicamos o filtro
    if (avgWebsiteCtr == null || avgConnectRate == null || avgPageConv == null) return [];

    // 5.1 Mapear métricas com fallbacks (igual ao GenericCard)
    const mappedAds = validatedAds.map((ad) => {
      const impressions = Number((ad as any).impressions || 0);
      const inlineLinkClicks = Number((ad as any).inline_link_clicks || 0);
      const lpv = Number((ad as any).lpv || 0);
      const results = actionType ? Number((ad as any).conversions?.[actionType] || 0) : 0;

      // Website CTR: priorizar valor do backend, senão calcular
      const websiteCtr = typeof (ad as any).website_ctr === "number" && !Number.isNaN((ad as any).website_ctr) && isFinite((ad as any).website_ctr) ? (ad as any).website_ctr : impressions > 0 ? inlineLinkClicks / impressions : 0;

      // Connect Rate: priorizar valor do backend, senão calcular
      const connectRate = typeof (ad as any).connect_rate === "number" && !Number.isNaN((ad as any).connect_rate) && isFinite((ad as any).connect_rate) ? (ad as any).connect_rate : inlineLinkClicks > 0 ? lpv / inlineLinkClicks : 0;

      // Page Conv: calcular sempre
      const pageConv = lpv > 0 ? results / lpv : 0;

      return {
        ...ad,
        websiteCtr,
        connectRate,
        pageConv,
        metricValue: pageConv,
        metricFormatted: formatMetric(pageConv, "page_conv"),
      };
    });

    // 5.2 Aplicar filtro com base nas médias globais
    const filteredAds = mappedAds.filter((ad) => {
      // Website CTR > média
      const websiteCtrAboveAvg = avgWebsiteCtr > 0 ? ad.websiteCtr > avgWebsiteCtr : ad.websiteCtr > 0;
      // Connect Rate > média
      const connectRateAboveAvg = avgConnectRate > 0 ? ad.connectRate > avgConnectRate : ad.connectRate > 0;

      // Page Conv significativamente abaixo da média (pelo menos 20% abaixo)
      const pageConvBelowAvg = avgPageConv > 0 && ad.pageConv > 0 ? ad.pageConv <= avgPageConv * 0.8 : avgPageConv > 0 ? ad.pageConv < avgPageConv && ad.pageConv > 0 : ad.pageConv > 0;

      return websiteCtrAboveAvg && connectRateAboveAvg && pageConvBelowAvg;
    });

    // 5.4 Ordenar por impacto absoluto de conversões ao melhorar apenas Page Conv até a média
    const scoredAds = filteredAds.map((ad: any) => {
      const { impactAbsConversions, score } = computeLandingPageImpact(ad, {
        avgPageConv,
      });

      return {
        ...ad,
        impactAbsConversions,
        score,
      };
    });

    return scoredAds.sort((a, b) => b.score - a.score).slice(0, 10);
  }, [validatedAds, avgWebsiteCtr, avgConnectRate, avgPageConv, actionType]);

  // 6. Filtrar anúncios para a coluna "CPM"
  // Critérios: Website CTR > média, Connect Rate > média, Page Conv > média, CPM >= média * 1.2 (20% acima)
  const cpmColumnAds = useMemo(() => {
    if (!validatedAds || validatedAds.length === 0) return [];
    // Se alguma média não estiver disponível, não aplicamos o filtro
    if (avgWebsiteCtr == null || avgConnectRate == null || avgPageConv == null || avgCpm == null) return [];

    // 6.1 Mapear métricas com fallbacks (igual ao GenericCard)
    const mappedAds = validatedAds.map((ad) => {
      const impressions = Number((ad as any).impressions || 0);
      const spend = Number((ad as any).spend || 0);
      const inlineLinkClicks = Number((ad as any).inline_link_clicks || 0);
      const lpv = Number((ad as any).lpv || 0);
      const results = actionType ? Number((ad as any).conversions?.[actionType] || 0) : 0;

      // Website CTR: priorizar valor do backend, senão calcular
      const websiteCtr = typeof (ad as any).website_ctr === "number" && !Number.isNaN((ad as any).website_ctr) && isFinite((ad as any).website_ctr) ? (ad as any).website_ctr : impressions > 0 ? inlineLinkClicks / impressions : 0;

      // Connect Rate: priorizar valor do backend, senão calcular
      const connectRate = typeof (ad as any).connect_rate === "number" && !Number.isNaN((ad as any).connect_rate) && isFinite((ad as any).connect_rate) ? (ad as any).connect_rate : inlineLinkClicks > 0 ? lpv / inlineLinkClicks : 0;

      // Page Conv: calcular sempre
      const pageConv = lpv > 0 ? results / lpv : 0;

      // CPM: priorizar cálculo a partir de spend/impressions, senão usar do backend
      const cpm = impressions > 0 ? (spend * 1000) / impressions : Number((ad as any).cpm || 0);

      return {
        ...ad,
        websiteCtr,
        connectRate,
        pageConv,
        cpm,
        metricValue: cpm,
        metricFormatted: formatCurrency(cpm), // CPM formatado como moeda
      };
    });

    // 6.2 Aplicar filtro com base nas médias globais
    const filteredAds = mappedAds.filter((ad) => {
      // Website CTR > média
      const websiteCtrAboveAvg = avgWebsiteCtr > 0 ? ad.websiteCtr > avgWebsiteCtr : ad.websiteCtr > 0;
      // Connect Rate > média
      const connectRateAboveAvg = avgConnectRate > 0 ? ad.connectRate > avgConnectRate : ad.connectRate > 0;
      // Page Conv > média
      const pageConvAboveAvg = avgPageConv > 0 ? ad.pageConv > avgPageConv : ad.pageConv > 0;
      // CPM significativamente acima da média (pelo menos 20% acima)
      const cpmAboveAvg = avgCpm > 0 ? ad.cpm >= avgCpm * 1.2 : ad.cpm > 0;

      return websiteCtrAboveAvg && connectRateAboveAvg && pageConvAboveAvg && cpmAboveAvg;
    });

    // 6.3 Calcular impacto de reduzir CPM até a média e ordenar por impacto (economia potencial)
    const scoredAds = filteredAds.map((ad: any) => {
      const { impactAbsSavings, score } = computeCpmImpact(ad, {
        avgCpm,
      });

      return {
        ...ad,
        impactAbsSavings,
        score,
      };
    });

    // Ordenar por impacto (maior economia potencial primeiro) e limitar a 10
    return scoredAds.sort((a, b) => b.score - a.score).slice(0, 10);
  }, [validatedAds, avgWebsiteCtr, avgConnectRate, avgPageConv, avgCpm, actionType, formatCurrency]);

  // 7. Calcular total de spend dos ads validados
  const totalSpend = useMemo(() => {
    return validatedAds.reduce((sum, ad) => sum + Number((ad as any).spend || 0), 0);
  }, [validatedAds]);

  // 8. Filtrar anúncios para a coluna "Spend"
  // Critérios: Spend > 3% do total & CPR >= média * 1.1 (10% acima da média)
  const spendColumnAds = useMemo(() => {
    if (!validatedAds || validatedAds.length === 0) return [];
    if (totalSpend <= 0) return [];

    // Obter média de CPR
    const avgCpr = actionType && averages?.per_action_type?.[actionType]?.cpr != null ? averages.per_action_type[actionType].cpr : null;
    if (avgCpr == null || avgCpr <= 0) return [];

    // 8.1 Mapear métricas com fallbacks
    const mappedAds = validatedAds.map((ad) => {
      const impressions = Number((ad as any).impressions || 0);
      const spend = Number((ad as any).spend || 0);
      const results = actionType ? Number((ad as any).conversions?.[actionType] || 0) : 0;

      // Calcular CPR: priorizar valor do backend, senão calcular
      let cpr = 0;
      if ("cpr" in ad && typeof (ad as any).cpr === "number" && (ad as any).cpr > 0) {
        cpr = (ad as any).cpr;
      } else if (results > 0) {
        cpr = spend / results;
      }

      return {
        ...ad,
        spend,
        cpr,
        metricValue: cpr,
        metricFormatted: formatCurrency(cpr),
      };
    });

    // 8.2 Aplicar filtro
    const filteredAds = mappedAds.filter((ad) => {
      // Spend > 3% do total
      const spendThreshold = totalSpend * 0.03;
      const spendAboveThreshold = ad.spend > spendThreshold;

      // CPR significativamente acima da média (pelo menos 10% acima)
      const cprAboveAvg = avgCpr > 0 && ad.cpr > 0 ? ad.cpr >= avgCpr * 1.1 : false;

      return spendAboveThreshold && cprAboveAvg;
    });

    // 8.3 Calcular impacto e ordenar por impacto (maior economia potencial primeiro)
    const scoredAds = filteredAds.map((ad: any) => {
      // Impacto = economia potencial ao reduzir CPR até a média
      // Economia = (CPR atual - CPR médio) * conversões
      const results = actionType ? Number((ad as any).conversions?.[actionType] || 0) : 0;
      const cprReduction = Math.max(0, ad.cpr - avgCpr);
      const potentialSavings = cprReduction * results;

      return {
        ...ad,
        impactAbsSavings: potentialSavings,
        score: potentialSavings,
      };
    });

    // Ordenar por impacto (maior economia potencial primeiro) e limitar a 10
    return scoredAds.sort((a, b) => b.score - a.score).slice(0, 10);
  }, [validatedAds, totalSpend, averages, actionType, formatCurrency]);

  // Criar configurações de colunas para o BaseKanbanWidget
  const columnConfigs = useMemo<KanbanColumnConfig<InsightsColumnType>[]>(() => {
    const configs: KanbanColumnConfig<InsightsColumnType>[] = [];

    const addColumn = (id: InsightsColumnType, title: string, items: any[], averageValue: number | null, colorScheme: GenericColumnColorScheme, formatAverage?: (value: number | null | undefined) => string, tooltip?: { title: string }, metricKey: "cpm" | "cpr" | "page_conv" = "page_conv") => {
      configs.push({
        id,
        title,
        items,
        averageValue,
        emptyMessage: "Nenhum item encontrado",
        formatAverage,
        tooltip,
        renderColumn: (config) => (
          <SortableColumn
            id={config.id}
            title={config.title}
            items={config.items}
            colorScheme={colorScheme}
            averageValue={config.averageValue}
            emptyMessage={config.emptyMessage}
            formatAverage={config.formatAverage}
            tooltip={config.tooltip}
            enableDrag={true}
            renderCard={(item, cardIndex, cardColorScheme) => (
              <GenericCard
                key={`${item.ad_id}-${cardIndex}`}
                ad={item}
                metricLabel={config.title}
                metricKey={metricKey}
                rank={cardIndex + 1}
                averageValue={config.averageValue}
                metricColor={cardColorScheme.card}
                onClick={(openVideo) => {
                  // Usar o handler do BaseKanbanWidget se disponível
                  if (config.onAdClick) {
                    config.onAdClick(item, openVideo);
                  }
                }}
                topMetrics={getTopMetrics(item.ad_id)}
                actionType={actionType}
                isCompact={true}
              />
            )}
          />
        ),
      });
    };

    // Landing Page
    const landingPageIndex = DEFAULT_INSIGHTS_COLUMN_TITLES.indexOf("Landing Page");
    addColumn(
      "Landing Page",
      "Landing Page",
      pageConvColumnAds,
      avgPageConv,
      allColorSchemes[landingPageIndex] || allColorSchemes[0],
      undefined,
      {
        title: "Impacto = conversões adicionais estimadas ao melhorar apenas a conversão de página até a média, mantendo o mesmo spend.",
      },
      "page_conv"
    );

    // CPM
    const cpmIndex = DEFAULT_INSIGHTS_COLUMN_TITLES.indexOf("CPM");
    addColumn(
      "CPM",
      "CPM",
      cpmColumnAds,
      avgCpm,
      allColorSchemes[cpmIndex] || allColorSchemes[1],
      (value) => (value != null && Number.isFinite(value) && value > 0 ? formatCurrency(value) : "—"),
      {
        title: "Impacto = economia potencial estimada ao reduzir o CPM atual até a média, mantendo o mesmo volume de impressões.",
      },
      "cpm"
    );

    // Spend
    const spendIndex = DEFAULT_INSIGHTS_COLUMN_TITLES.indexOf("Spend");
    const avgCpr = actionType && averages?.per_action_type?.[actionType]?.cpr != null ? averages.per_action_type[actionType].cpr : null;
    addColumn(
      "Spend",
      "Spend",
      spendColumnAds,
      avgCpr,
      allColorSchemes[spendIndex] || allColorSchemes[2],
      (value) => (value != null && Number.isFinite(value) && value > 0 ? formatCurrency(value) : "—"),
      {
        title: "Impacto = economia potencial estimada ao reduzir o CPR atual até a média. Mostra anúncios com spend > 3% do total e CPR 10% acima da média.",
      },
      "cpr"
    );

    // Coluna 4 (vazia por enquanto)
    const col4Index = DEFAULT_INSIGHTS_COLUMN_TITLES.indexOf("Coluna 4");
    addColumn("Coluna 4", "Coluna 4", [], null, allColorSchemes[col4Index] || allColorSchemes[3], undefined, undefined, "page_conv");

    return configs;
  }, [pageConvColumnAds, cpmColumnAds, spendColumnAds, avgPageConv, avgCpm, averages, actionType, formatCurrency, getTopMetrics, allColorSchemes]);

  return (
    <BaseKanbanWidget
      storageKey={STORAGE_KEY_INSIGHTS_COLUMN_ORDER}
      defaultColumnOrder={DEFAULT_INSIGHTS_COLUMN_TITLES}
      columnConfigs={columnConfigs}
      enableDrag={true}
      modalProps={{
        dateStart,
        dateStop,
        actionType,
        availableConversionTypes,
        averages,
      }}
    />
  );
}

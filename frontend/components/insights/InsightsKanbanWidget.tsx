"use client";

import { useState, useMemo } from "react";
import type { ReactNode } from "react";
import { RankingsItem, RankingsResponse } from "@/lib/api/schemas";
import { ValidationCondition } from "@/components/common/ValidationCriteriaBuilder";
import { evaluateValidationCriteria, AdMetricsData } from "@/lib/utils/validateAdCriteria";
import { GenericCard } from "@/components/common/GenericCard";
import { calculateGlobalMetricRanks } from "@/lib/utils/metricRankings";
import { useFormatCurrency } from "@/lib/utils/currency";
import { BaseKanbanWidget, KanbanColumnConfig } from "@/components/common/BaseKanbanWidget";
import { SortableColumn } from "@/components/common/SortableColumn";
import { GenericColumnColorScheme } from "@/components/common/GenericColumn";
import { computeOpportunityScores, OpportunityRow } from "@/lib/utils/opportunity";
import { useMqlLeadscore } from "@/lib/hooks/useMqlLeadscore";

const STORAGE_KEY_INSIGHTS_COLUMN_ORDER = "hookify-insights-column-order";
const DEFAULT_INSIGHTS_COLUMN_TITLES = ["Page", "CPM", "Spend", "Hook"] as const;
type InsightsColumnType = (typeof DEFAULT_INSIGHTS_COLUMN_TITLES)[number];
// Flag de debug temporário para entender por que anúncios não entram na coluna Page
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
  // CPM: priorizar valor do backend, senão calcular
  const cpm = typeof (ad as any).cpm === "number" && !Number.isNaN((ad as any).cpm) && isFinite((ad as any).cpm) ? (ad as any).cpm : impressions > 0 ? (spend * 1000) / impressions : 0;
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
  const { mqlLeadscoreMin } = useMqlLeadscore();

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

  // 4. Obter valores médios (usando a mesma média global dos anúncios validados)
  const avgWebsiteCtr = averages?.website_ctr ?? null;
  const avgConnectRate = averages?.connect_rate ?? null;
  const avgPageConv = averages?.per_action_type?.[actionType]?.page_conv ?? null;
  const avgCpm = averages?.cpm ?? null;
  const avgHook = averages?.hook ?? null;

  // 4.1 Calcular total de spend dos ads validados (para calcular impact_relative)
  const totalSpend = useMemo(() => {
    return validatedAds.reduce((sum, ad) => sum + Number((ad as any).spend || 0), 0);
  }, [validatedAds]);

  // 4.2 Calcular OpportunityRow para todos os anúncios validados (para usar impact_relative e cpr_if_*)
  const opportunityRowsMap = useMemo(() => {
    if (!validatedAds || validatedAds.length === 0) return new Map<string, OpportunityRow>();
    if (totalSpend <= 0) return new Map<string, OpportunityRow>();

    const opportunityRows = computeOpportunityScores({
      ads: validatedAds,
      averages,
      actionType,
      spendTotal: totalSpend,
      mqlLeadscoreMin,
      limit: undefined, // Não limitar aqui, queremos todos
    });

    // Criar mapa por ad_id para acesso rápido
    const map = new Map<string, OpportunityRow>();
    opportunityRows.forEach((row) => {
      if (row.ad_id) {
        map.set(row.ad_id, row);
      }
    });

    return map;
  }, [validatedAds, averages, actionType, totalSpend, mqlLeadscoreMin]);

  // 5. Filtrar anúncios para a coluna "Page"
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

    // 5.3 Calcular impact_relative baseado em cpr_if_page_conv_only (mesma lógica do OpportunityWidget)
    const scoredAds = filteredAds.map((ad: any) => {
      const opportunityRow = opportunityRowsMap.get(ad.ad_id || "");

      if (!opportunityRow) {
        // Fallback: usar impacto absoluto se não tiver OpportunityRow
        return {
          ...ad,
          impactRelative: 0,
          score: 0,
        };
      }

      const cprActual = opportunityRow.cpr_actual;
      const cprIfPageConvOnly = opportunityRow.cpr_if_page_conv_only;
      const spend = opportunityRow.spend;

      // Calcular improvementPct apenas para Page Conv
      const improvementPct = Number.isFinite(cprActual) && cprActual > 0 && Number.isFinite(cprIfPageConvOnly) && cprIfPageConvOnly > 0 ? 1 - cprIfPageConvOnly / cprActual : 0;

      // Calcular impact_relative (mesma fórmula do OpportunityWidget)
      const impactRelative = improvementPct * (spend / totalSpend);

      return {
        ...ad,
        impactRelative,
        score: impactRelative, // Usar impact_relative como score para ordenação
      };
    });

    // Ordenar por impact_relative (descendente) e limitar a 10
    return scoredAds.sort((a, b) => b.score - a.score).slice(0, 10);
  }, [validatedAds, avgWebsiteCtr, avgConnectRate, avgPageConv, actionType, opportunityRowsMap, totalSpend]);

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

      // CPM: priorizar valor do backend, senão calcular
      const cpm = typeof (ad as any).cpm === "number" && !Number.isNaN((ad as any).cpm) && isFinite((ad as any).cpm) ? (ad as any).cpm : impressions > 0 ? (spend * 1000) / impressions : 0;

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

    // 6.3 Calcular impact_relative baseado na redução percentual de CPM (mesma lógica do OpportunityWidget)
    const scoredAds = filteredAds.map((ad: any) => {
      const spend = Number((ad as any).spend || 0);
      const cpm = Number((ad as any).cpm || 0);

      // Calcular redução percentual do CPM
      const cpmReductionPct = avgCpm != null && avgCpm > 0 && cpm > avgCpm ? (cpm - avgCpm) / cpm : 0;

      // Calcular impact_relative (mesma fórmula do OpportunityWidget)
      const impactRelative = cpmReductionPct * (spend / totalSpend);

      return {
        ...ad,
        impactRelative,
        score: impactRelative, // Usar impact_relative como score para ordenação
      };
    });

    // Ordenar por impact_relative (descendente) e limitar a 10
    return scoredAds.sort((a, b) => b.score - a.score).slice(0, 10);
  }, [validatedAds, avgWebsiteCtr, avgConnectRate, avgPageConv, avgCpm, actionType, formatCurrency, totalSpend]);

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

    // 8.3 Calcular impact_relative usando OpportunityRow (mesma lógica do OpportunityWidget)
    const scoredAds = filteredAds.map((ad: any) => {
      const opportunityRow = opportunityRowsMap.get(ad.ad_id || "");

      if (!opportunityRow) {
        // Fallback: usar impacto absoluto se não tiver OpportunityRow
        const results = actionType ? Number((ad as any).conversions?.[actionType] || 0) : 0;
        const cprReduction = Math.max(0, ad.cpr - avgCpr);
        const potentialSavings = cprReduction * results;
        const spend = Number((ad as any).spend || 0);
        const improvementPct = ad.cpr > 0 && avgCpr > 0 ? 1 - avgCpr / ad.cpr : 0;
        const impactRelative = improvementPct * (spend / totalSpend);

        return {
          ...ad,
          impactRelative,
          score: impactRelative,
        };
      }

      // Usar impact_relative direto do OpportunityRow (já considera melhoria de todas as métricas)
      const impactRelative = opportunityRow.impact_relative || 0;

      return {
        ...ad,
        impactRelative,
        score: impactRelative, // Usar impact_relative como score para ordenação
      };
    });

    // Ordenar por impact_relative (descendente) e limitar a 10
    return scoredAds.sort((a, b) => b.score - a.score).slice(0, 10);
  }, [validatedAds, totalSpend, averages, actionType, formatCurrency, opportunityRowsMap]);

  // 9. Filtrar anúncios para a coluna "Hook"
  // Critérios: Hook < média, Website CTR > média, Connect Rate > média, Page Conv > média
  const hookColumnAds = useMemo(() => {
    if (!validatedAds || validatedAds.length === 0) return [];
    // Se alguma média não estiver disponível, não aplicamos o filtro
    if (avgHook == null || avgWebsiteCtr == null || avgConnectRate == null || avgPageConv == null) return [];

    // 9.1 Mapear métricas com fallbacks (igual ao GenericCard)
    const mappedAds = validatedAds.map((ad) => {
      const impressions = Number((ad as any).impressions || 0);
      const inlineLinkClicks = Number((ad as any).inline_link_clicks || 0);
      const lpv = Number((ad as any).lpv || 0);
      const results = actionType ? Number((ad as any).conversions?.[actionType] || 0) : 0;

      // Hook: sempre do backend
      const hook = Number((ad as any).hook || 0);

      // Website CTR: priorizar valor do backend, senão calcular
      const websiteCtr = typeof (ad as any).website_ctr === "number" && !Number.isNaN((ad as any).website_ctr) && isFinite((ad as any).website_ctr) ? (ad as any).website_ctr : impressions > 0 ? inlineLinkClicks / impressions : 0;

      // Connect Rate: priorizar valor do backend, senão calcular
      const connectRate = typeof (ad as any).connect_rate === "number" && !Number.isNaN((ad as any).connect_rate) && isFinite((ad as any).connect_rate) ? (ad as any).connect_rate : inlineLinkClicks > 0 ? lpv / inlineLinkClicks : 0;

      // Page Conv: calcular sempre
      const pageConv = lpv > 0 ? results / lpv : 0;

      return {
        ...ad,
        hook,
        websiteCtr,
        connectRate,
        pageConv,
        metricValue: hook,
        metricFormatted: formatMetric(hook, "hook"),
      };
    });

    // 9.2 Aplicar filtro com base nas médias globais
    const filteredAds = mappedAds.filter((ad) => {
      // Hook < média
      const hookBelowAvg = avgHook > 0 ? ad.hook < avgHook && ad.hook > 0 : false;
      // Website CTR > média
      const websiteCtrAboveAvg = avgWebsiteCtr > 0 ? ad.websiteCtr > avgWebsiteCtr : ad.websiteCtr > 0;
      // Connect Rate > média
      const connectRateAboveAvg = avgConnectRate > 0 ? ad.connectRate > avgConnectRate : ad.connectRate > 0;
      // Page Conv > média
      const pageConvAboveAvg = avgPageConv > 0 ? ad.pageConv > avgPageConv : ad.pageConv > 0;

      return hookBelowAvg && websiteCtrAboveAvg && connectRateAboveAvg && pageConvAboveAvg;
    });

    // 9.3 Calcular impact_relative baseado em cpr_if_hook_only (mesma lógica do OpportunityWidget)
    const scoredAds = filteredAds.map((ad: any) => {
      const opportunityRow = opportunityRowsMap.get(ad.ad_id || "");

      if (!opportunityRow) {
        // Fallback: calcular CPR se melhorar apenas Hook
        const impressions = Number((ad as any).impressions || 0);
        const spend = Number((ad as any).spend || 0);
        const cpm = typeof (ad as any).cpm === "number" && !Number.isNaN((ad as any).cpm) && isFinite((ad as any).cpm) ? (ad as any).cpm : impressions > 0 ? (spend * 1000) / impressions : 0;

        const websiteCtr = Math.max(Number((ad as any).websiteCtr || 0), 0);
        const connectRate = Math.max(Number((ad as any).connectRate || 0), 0);
        const pageConv = Math.max(Number((ad as any).pageConv || 0), 0);
        const hook = Math.max(Number((ad as any).hook || 0), 0);

        // CPR atual
        const denomActual = websiteCtr * connectRate * pageConv;
        const cprActual = denomActual > 0 ? cpm / (1000 * denomActual) : Number.POSITIVE_INFINITY;

        // Estimar melhoria no Website CTR baseada na melhoria do Hook (mesma lógica de computeHookImpact)
        const hookImprovementRatio = avgHook && hook > 0 ? avgHook / hook : 1;
        const websiteCtrImprovementFactor = 1 + 0.7 * (hookImprovementRatio - 1);
        const websiteCtrPot = Math.min(websiteCtr * websiteCtrImprovementFactor, 1);

        // CPR se melhorarmos apenas o Hook
        const denomHookOnly = websiteCtrPot * connectRate * pageConv;
        const cprIfHookOnly = denomHookOnly > 0 ? cpm / (1000 * denomHookOnly) : Number.POSITIVE_INFINITY;

        // Calcular improvementPct apenas para Hook
        const improvementPct = Number.isFinite(cprActual) && cprActual > 0 && Number.isFinite(cprIfHookOnly) && cprIfHookOnly > 0 ? 1 - cprIfHookOnly / cprActual : 0;

        // Calcular impact_relative
        const impactRelative = improvementPct * (spend / totalSpend);

        return {
          ...ad,
          impactRelative,
          score: impactRelative,
        };
      }

      // Calcular CPR se melhorar apenas Hook (similar ao computeHookImpact)
      const impressions = Number((ad as any).impressions || 0);
      const spend = opportunityRow.spend;
      const cpm = opportunityRow.cpm;
      const websiteCtr = opportunityRow.website_ctr;
      const connectRate = opportunityRow.connect_rate;
      const pageConv = opportunityRow.page_conv;
      const hook = opportunityRow.hook;

      // CPR atual
      const denomActual = websiteCtr * connectRate * pageConv;
      const cprActual = denomActual > 0 ? cpm / (1000 * denomActual) : Number.POSITIVE_INFINITY;

      // Estimar melhoria no Website CTR baseada na melhoria do Hook
      const hookImprovementRatio = avgHook && hook > 0 ? avgHook / hook : 1;
      const websiteCtrImprovementFactor = 1 + 0.7 * (hookImprovementRatio - 1);
      const websiteCtrPot = Math.min(websiteCtr * websiteCtrImprovementFactor, 1);

      // CPR se melhorarmos apenas o Hook
      const denomHookOnly = websiteCtrPot * connectRate * pageConv;
      const cprIfHookOnly = denomHookOnly > 0 ? cpm / (1000 * denomHookOnly) : Number.POSITIVE_INFINITY;

      // Calcular improvementPct apenas para Hook
      const improvementPct = Number.isFinite(cprActual) && cprActual > 0 && Number.isFinite(cprIfHookOnly) && cprIfHookOnly > 0 ? 1 - cprIfHookOnly / cprActual : 0;

      // Calcular impact_relative (mesma fórmula do OpportunityWidget)
      const impactRelative = improvementPct * (spend / totalSpend);

      return {
        ...ad,
        impactRelative,
        score: impactRelative, // Usar impact_relative como score para ordenação
      };
    });

    // Ordenar por impact_relative (descendente) e limitar a 10
    return scoredAds.sort((a, b) => b.score - a.score).slice(0, 10);
  }, [validatedAds, avgHook, avgWebsiteCtr, avgConnectRate, avgPageConv, actionType, opportunityRowsMap, totalSpend]);

  // Criar configurações de colunas para o BaseKanbanWidget
  const columnConfigs = useMemo<KanbanColumnConfig<InsightsColumnType>[]>(() => {
    const configs: KanbanColumnConfig<InsightsColumnType>[] = [];

    const addColumn = (id: InsightsColumnType, title: string, items: any[], averageValue: number | null, colorScheme: GenericColumnColorScheme, formatAverage?: (value: number | null | undefined) => string, tooltip?: { title: string; content?: ReactNode }, metricKey: "cpm" | "cpr" | "page_conv" | "hook" = "page_conv") => {
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

    // Page
    const landingPageIndex = DEFAULT_INSIGHTS_COLUMN_TITLES.indexOf("Page");
    addColumn(
      "Page",
      "Page",
      pageConvColumnAds,
      avgPageConv,
      allColorSchemes[landingPageIndex] || allColorSchemes[0],
      undefined,
      {
        title: "Problema na Page",
        content: (
          <>
            <div className="font-semibold text-sm mb-2">Problema na Page</div>
            <div className="space-y-2 text-xs">
              <div>
                <div className="font-medium mb-1">Critérios:</div>
                <ul className="list-disc list-inside space-y-0.5 text-muted-foreground ml-1">
                  <li>Website CTR &gt; média</li>
                  <li>Connect Rate &gt; média</li>
                  <li>Page Conv &lt; média (20% abaixo)</li>
                </ul>
              </div>
              <div>
                <div className="font-medium mb-1">Diagnóstico:</div>
                <p className="text-muted-foreground">Anúncio gera tráfego e conecta bem, mas a página não converte.</p>
              </div>
              <div>
                <div className="font-medium mb-1">Ação:</div>
                <p className="text-muted-foreground">Otimizar landing page, melhorar copy, ajustar CTA.</p>
              </div>
            </div>
          </>
        ),
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
        title: "CPM Alto",
        content: (
          <>
            <div className="font-semibold text-sm mb-2">CPM Alto</div>
            <div className="space-y-2 text-xs">
              <div>
                <div className="font-medium mb-1">Critérios:</div>
                <ul className="list-disc list-inside space-y-0.5 text-muted-foreground ml-1">
                  <li>Website CTR &gt; média</li>
                  <li>Connect Rate &gt; média</li>
                  <li>Page Conv &gt; média</li>
                  <li>CPM ≥ média × 1.2 (20% acima)</li>
                </ul>
              </div>
              <div>
                <div className="font-medium mb-1">Diagnóstico:</div>
                <p className="text-muted-foreground">Anúncio converte bem, mas está pagando muito caro por impressão.</p>
              </div>
              <div>
                <div className="font-medium mb-1">Ação:</div>
                <p className="text-muted-foreground">Otimizar targeting, ajustar lances, melhorar relevância do anúncio.</p>
              </div>
            </div>
          </>
        ),
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
        title: "Alto Investimento com CPR Ruim",
        content: (
          <>
            <div className="font-semibold text-sm mb-2">Alto Investimento com CPR Ruim</div>
            <div className="space-y-2 text-xs">
              <div>
                <div className="font-medium mb-1">Critérios:</div>
                <ul className="list-disc list-inside space-y-0.5 text-muted-foreground ml-1">
                  <li>Spend &gt; 3% do total</li>
                  <li>CPR ≥ média × 1.1 (10% acima)</li>
                </ul>
              </div>
              <div>
                <div className="font-medium mb-1">Diagnóstico:</div>
                <p className="text-muted-foreground">Anúncio com alto investimento e CPR acima da média.</p>
              </div>
              <div>
                <div className="font-medium mb-1">Ação:</div>
                <p className="text-muted-foreground">Reduzir investimento ou otimizar para melhorar CPR.</p>
              </div>
            </div>
          </>
        ),
      },
      "cpr"
    );

    // Hook
    const hookIndex = DEFAULT_INSIGHTS_COLUMN_TITLES.indexOf("Hook");
    addColumn(
      "Hook",
      "Hook",
      hookColumnAds,
      avgHook,
      allColorSchemes[hookIndex] || allColorSchemes[3],
      undefined,
      {
        title: "Hook Baixo com Funil Bom",
        content: (
          <>
            <div className="font-semibold text-sm mb-2">Hook Baixo com Funil Bom</div>
            <div className="space-y-2 text-xs">
              <div>
                <div className="font-medium mb-1">Critérios:</div>
                <ul className="list-disc list-inside space-y-0.5 text-muted-foreground ml-1">
                  <li>Hook &lt; média</li>
                  <li>Website CTR &gt; média</li>
                  <li>Connect Rate &gt; média</li>
                  <li>Page Conv &gt; média</li>
                </ul>
              </div>
              <div>
                <div className="font-medium mb-1">Diagnóstico:</div>
                <p className="text-muted-foreground">Anúncio tem bom funil (CTR, Connect, Page), mas Hook baixo.</p>
              </div>
              <div>
                <div className="font-medium mb-1">Ação:</div>
                <p className="text-muted-foreground">Melhorar primeiros 3 segundos do vídeo, ajustar thumbnail, testar novos hooks.</p>
              </div>
            </div>
          </>
        ),
      },
      "hook"
    );

    return configs;
  }, [pageConvColumnAds, cpmColumnAds, spendColumnAds, hookColumnAds, avgPageConv, avgCpm, avgHook, averages, actionType, formatCurrency, getTopMetrics, allColorSchemes]);

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

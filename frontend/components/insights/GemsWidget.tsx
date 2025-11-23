"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RankingsItem, RankingsResponse } from "@/lib/api/schemas";
import { ValidationCondition } from "@/components/common/ValidationCriteriaBuilder";
import { evaluateValidationCriteria, AdMetricsData } from "@/lib/utils/validateAdCriteria";
import { GemsColumn } from "./GemsColumn";
import { IconSparkles } from "@tabler/icons-react";
import { Modal } from "@/components/common/Modal";
import { AdDetailsDialog } from "@/components/ads/AdDetailsDialog";
import { GemsColumnType } from "@/components/common/GemsColumnFilter";
import { calculateGlobalMetricRanks, getMetricRank } from "@/lib/utils/metricRankings";

interface GemsWidgetProps {
  ads: RankingsItem[];
  averages?: RankingsResponse["averages"];
  actionType: string;
  validationCriteria: ValidationCondition[];
  limit?: number; // Top N por métrica
  dateStart?: string;
  dateStop?: string;
  availableConversionTypes?: string[];
  isCompact?: boolean;
  activeColumns?: Set<GemsColumnType>; // Colunas ativas
}

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

function formatMetric(value: number, metric: "hook" | "website_ctr" | "ctr" | "page_conv" | "hold_rate"): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";

  // Todas as métricas são percentuais
  return `${(value * 100).toFixed(2)}%`;
}

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

export function GemsWidget({ ads, averages, actionType, validationCriteria, limit = 5, dateStart, dateStop, availableConversionTypes = [], isCompact = true, activeColumns }: GemsWidgetProps) {
  const [selectedAd, setSelectedAd] = useState<RankingsItem | null>(null);
  const [openInVideoTab, setOpenInVideoTab] = useState(false);
  // 1. Filtrar apenas anúncios validados
  const validatedAds = useMemo(() => {
    if (!validationCriteria || validationCriteria.length === 0) {
      // Se não há critérios, todos os anúncios são válidos
      return ads;
    }

    return ads.filter((ad) => {
      const metrics = mapRankingToMetrics(ad, actionType);
      return evaluateValidationCriteria(validationCriteria, metrics, "AND");
    });
  }, [ads, validationCriteria, actionType]);

  // 2. Calcular top por cada métrica
  const topHook = useMemo(() => {
    const valid = validatedAds
      .map((ad) => ({
        ...ad,
        metricValue: getMetricValue(ad, "hook", actionType),
      }))
      .filter((ad) => ad.metricValue > 0 && !isNaN(ad.metricValue))
      .sort((a, b) => b.metricValue - a.metricValue)
      .slice(0, limit)
      .map((ad) => ({
        ...ad,
        metricFormatted: formatMetric(ad.metricValue, "hook"),
      }));
    return valid;
  }, [validatedAds, actionType, limit]);

  const topWebsiteCtr = useMemo(() => {
    const valid = validatedAds
      .map((ad) => ({
        ...ad,
        metricValue: getMetricValue(ad, "website_ctr", actionType),
      }))
      .filter((ad) => ad.metricValue > 0 && !isNaN(ad.metricValue))
      .sort((a, b) => b.metricValue - a.metricValue)
      .slice(0, limit)
      .map((ad) => ({
        ...ad,
        metricFormatted: formatMetric(ad.metricValue, "website_ctr"),
      }));
    return valid;
  }, [validatedAds, actionType, limit]);

  const topCtr = useMemo(() => {
    const valid = validatedAds
      .map((ad) => ({
        ...ad,
        metricValue: getMetricValue(ad, "ctr", actionType),
      }))
      .filter((ad) => ad.metricValue > 0 && !isNaN(ad.metricValue))
      .sort((a, b) => b.metricValue - a.metricValue)
      .slice(0, limit)
      .map((ad) => ({
        ...ad,
        metricFormatted: formatMetric(ad.metricValue, "ctr"),
      }));
    return valid;
  }, [validatedAds, actionType, limit]);

  const topPageConv = useMemo(() => {
    const valid = validatedAds
      .map((ad) => ({
        ...ad,
        metricValue: getMetricValue(ad, "page_conv", actionType),
      }))
      .filter((ad) => ad.metricValue > 0 && !isNaN(ad.metricValue))
      .sort((a, b) => b.metricValue - a.metricValue)
      .slice(0, limit)
      .map((ad) => ({
        ...ad,
        metricFormatted: formatMetric(ad.metricValue, "page_conv"),
      }));
    return valid;
  }, [validatedAds, actionType, limit]);

  const topHoldRate = useMemo(() => {
    const valid = validatedAds
      .map((ad) => ({
        ...ad,
        metricValue: getMetricValue(ad, "hold_rate", actionType),
      }))
      .filter((ad) => ad.metricValue > 0 && !isNaN(ad.metricValue))
      .sort((a, b) => b.metricValue - a.metricValue)
      .slice(0, limit)
      .map((ad) => ({
        ...ad,
        metricFormatted: formatMetric(ad.metricValue, "hold_rate"),
      }));
    return valid;
  }, [validatedAds, actionType, limit]);

  // 3. Calcular rankings globais usando o utilitário centralizado
  // IMPORTANTE: Os rankings são calculados apenas com anúncios que passam pelos critérios de validação
  // Se não houver critérios definidos (array vazio ou undefined), todos os anúncios são considerados
  const globalMetricRanks = useMemo(() => {
    // Passar validationCriteria apenas se houver critérios definidos (array não vazio)
    // Array vazio ou undefined significa "sem critérios" (todos os anúncios são válidos)
    const criteriaToUse = validationCriteria && validationCriteria.length > 0 ? validationCriteria : undefined;
    return calculateGlobalMetricRanks(ads, {
      validationCriteria: criteriaToUse,
      actionType,
      filterValidOnly: true,
    });
  }, [ads, validationCriteria, actionType]);

  // 4. Função helper para obter ranks de um anúncio em todas as métricas
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

  // 6. Obter valores médios para comparação
  const avgHook = averages?.hook ?? null;
  const avgWebsiteCtr = averages?.website_ctr ?? null;
  const avgCtr = averages?.ctr ?? null;
  const avgPageConv = actionType && averages?.per_action_type?.[actionType] ? averages.per_action_type[actionType].page_conv ?? null : null;
  const avgHoldRate = (averages as any)?.hold_rate ?? null;

  // Preparar averages para o AdDetailsDialog
  const dialogAverages = averages
    ? {
        hook: averages.hook ?? null,
        scroll_stop: averages.scroll_stop ?? null,
        ctr: averages.ctr ?? null,
        website_ctr: averages.website_ctr ?? null,
        connect_rate: averages.connect_rate ?? null,
        cpm: averages.cpm ?? null,
        cpr: actionType && averages.per_action_type?.[actionType] && typeof averages.per_action_type[actionType].cpr === "number" ? averages.per_action_type[actionType].cpr : null,
        page_conv: actionType && averages.per_action_type?.[actionType] && typeof averages.per_action_type[actionType].page_conv === "number" ? averages.per_action_type[actionType].page_conv : null,
      }
    : undefined;

  // Se não há anúncios validados, não mostrar o widget
  if (validatedAds.length === 0) {
    return null;
  }

  // Definir colunas padrão se não fornecidas (todas ativas)
  const defaultActiveColumns = activeColumns || new Set<GemsColumnType>(["hook", "website_ctr", "ctr", "page_conv", "hold_rate"]);
  const columnsToShow = activeColumns || defaultActiveColumns;

  // Determinar número de colunas para o grid
  const columnCount = columnsToShow.size;
  let gridColsClass = "grid-cols-1";
  if (columnCount === 2) {
    gridColsClass = "md:grid-cols-2";
  } else if (columnCount === 3) {
    gridColsClass = "md:grid-cols-2 lg:grid-cols-3";
  } else if (columnCount === 4) {
    gridColsClass = "md:grid-cols-2 lg:grid-cols-4";
  } else if (columnCount >= 5) {
    gridColsClass = "md:grid-cols-2 lg:grid-cols-5";
  }

  return (
    <>
      {/* Container principal com visual de seção destacado, inspirado no print */}
      <div className={`grid grid-cols-1 gap-8 ${gridColsClass}`}>
        {columnsToShow.has("hook") && (
          <GemsColumn
            title="Hooks"
            items={topHook}
            metric="hook"
            averageValue={avgHook}
            onAdClick={(ad, openVideo) => {
              setSelectedAd(ad);
              setOpenInVideoTab(openVideo || false);
            }}
            getTopMetrics={getTopMetrics}
            actionType={actionType}
            isCompact={isCompact}
          />
        )}
        {columnsToShow.has("website_ctr") && (
          <GemsColumn
            title="Website CTR"
            items={topWebsiteCtr}
            metric="website_ctr"
            averageValue={avgWebsiteCtr}
            onAdClick={(ad, openVideo) => {
              setSelectedAd(ad);
              setOpenInVideoTab(openVideo || false);
            }}
            getTopMetrics={getTopMetrics}
            actionType={actionType}
            isCompact={isCompact}
          />
        )}
        {columnsToShow.has("page_conv") && (
          <GemsColumn
            title="Page"
            items={topPageConv}
            metric="page_conv"
            averageValue={avgPageConv}
            onAdClick={(ad, openVideo) => {
              setSelectedAd(ad);
              setOpenInVideoTab(openVideo || false);
            }}
            getTopMetrics={getTopMetrics}
            actionType={actionType}
            isCompact={isCompact}
          />
        )}
        {columnsToShow.has("ctr") && (
          <GemsColumn
            title="CTR"
            items={topCtr}
            metric="ctr"
            averageValue={avgCtr}
            onAdClick={(ad, openVideo) => {
              setSelectedAd(ad);
              setOpenInVideoTab(openVideo || false);
            }}
            getTopMetrics={getTopMetrics}
            actionType={actionType}
            isCompact={isCompact}
          />
        )}
        {columnsToShow.has("hold_rate") && (
          <GemsColumn
            title="Hold Rate"
            items={topHoldRate}
            metric="hold_rate"
            averageValue={avgHoldRate}
            onAdClick={(ad, openVideo) => {
              setSelectedAd(ad);
              setOpenInVideoTab(openVideo || false);
            }}
            getTopMetrics={getTopMetrics}
            actionType={actionType}
            isCompact={isCompact}
          />
        )}
      </div>

      {/* Modal com detalhes do anúncio */}
      <Modal
        isOpen={!!selectedAd}
        onClose={() => {
          setSelectedAd(null);
          setOpenInVideoTab(false);
        }}
        size="4xl"
        padding="md"
      >
        {selectedAd && <AdDetailsDialog ad={selectedAd} groupByAdName={false} dateStart={dateStart} dateStop={dateStop} actionType={actionType} availableConversionTypes={availableConversionTypes} initialTab={openInVideoTab ? "video" : "overview"} averages={dialogAverages} />}
      </Modal>
    </>
  );
}

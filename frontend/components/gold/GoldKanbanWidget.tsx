"use client";

import { useMemo } from "react";
import { RankingsItem, RankingsResponse } from "@/lib/api/schemas";
import { ValidationCondition } from "@/components/common/ValidationCriteriaBuilder";
import { evaluateValidationCriteria, AdMetricsData } from "@/lib/utils/validateAdCriteria";
import { BaseKanbanWidget, KanbanColumnConfig } from "@/components/common/BaseKanbanWidget";
import { SortableColumn } from "@/components/common/SortableColumn";
import { GenericColumnColorScheme } from "@/components/common/GenericColumn";
import { GenericCard } from "@/components/common/GenericCard";
import { splitAdsIntoGoldBuckets, GoldBucket } from "@/lib/utils/goldClassification";
import { useFormatCurrency } from "@/lib/utils/currency";

interface GoldKanbanWidgetProps {
  ads: RankingsItem[];
  averages?: RankingsResponse["averages"];
  actionType: string;
  validationCriteria: ValidationCondition[];
  dateStart?: string;
  dateStop?: string;
  availableConversionTypes?: string[];
}

const STORAGE_KEY_GOLD_COLUMN_ORDER = "hookify-gold-column-order";
const DEFAULT_GOLD_COLUMN_ORDER: readonly GoldBucket[] = ["golds", "oportunidades", "licoes", "descartes", "neutros"] as const;

/**
 * Mapeia um anúncio para AdMetricsData (usado para validação)
 */
function mapRankingToMetrics(ad: RankingsItem, actionType: string): AdMetricsData {
  const impressions = Number((ad as any).impressions || 0);
  const spend = Number((ad as any).spend || 0);
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
 * Widget de Kanban para a página G.O.L.D.
 * Classifica anúncios em 5 categorias baseadas em CPR e métricas vs médias.
 */
export function GoldKanbanWidget({ ads, averages, actionType, validationCriteria, dateStart, dateStop, availableConversionTypes = [] }: GoldKanbanWidgetProps) {
  const formatCurrency = useFormatCurrency();

  // Esquemas de cores para cada categoria
  const colorSchemes: Record<GoldBucket, GenericColumnColorScheme> = {
    golds: {
      headerBg: "bg-yellow-500/10 border-yellow-500/30",
      title: "",
      card: {
        border: "border-yellow-500/30",
        bg: "bg-yellow-500/5",
        text: "text-yellow-600 dark:text-yellow-400",
        accent: "border-yellow-500",
        badge: "bg-yellow-500 text-white",
      },
    },
    oportunidades: {
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
    licoes: {
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
    descartes: {
      headerBg: "bg-red-500/10 border-red-500/30",
      title: "",
      card: {
        border: "border-red-500/30",
        bg: "bg-red-500/5",
        text: "text-red-600 dark:text-red-400",
        accent: "border-red-500",
        badge: "bg-red-500 text-white",
      },
    },
    neutros: {
      headerBg: "bg-gray-500/10 border-gray-500/30",
      title: "",
      card: {
        border: "border-gray-500/30",
        bg: "bg-gray-500/5",
        text: "text-gray-600 dark:text-gray-400",
        accent: "border-gray-500",
        badge: "bg-gray-500 text-white",
      },
    },
  };

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

  // 2. Classificar anúncios nos buckets G.O.L.D.
  const buckets = useMemo(() => {
    if (!averages || validatedAds.length === 0) {
      return {
        golds: [],
        oportunidades: [],
        licoes: [],
        descartes: [],
        neutros: [],
      } as Record<GoldBucket, RankingsItem[]>;
    }
    return splitAdsIntoGoldBuckets(validatedAds, averages, actionType);
  }, [validatedAds, averages, actionType]);

  // 2.1 Mapear anúncios para adicionar metricValue e metricFormatted (CPR)
  const mappedBuckets = useMemo(() => {
    const mapped: Record<GoldBucket, any[]> = {
      golds: [],
      oportunidades: [],
      licoes: [],
      descartes: [],
      neutros: [],
    };

    Object.keys(buckets).forEach((bucketKey) => {
      const bucket = bucketKey as GoldBucket;
      mapped[bucket] = buckets[bucket].map((ad: RankingsItem) => {
        const spend = Number((ad as any).spend || 0);
        const results = actionType ? Number((ad as any).conversions?.[actionType] || 0) : 0;

        // Calcular CPR
        let cpr = 0;
        if (results > 0) {
          cpr = spend / results;
        } else if (spend > 0) {
          // Se há spend mas não há results, CPR é infinito (tratar como muito alto)
          cpr = Infinity;
        }

        return {
          ...ad,
          cpr: results > 0 ? cpr : undefined, // Não definir cpr se não há results
          metricValue: cpr,
          metricFormatted: !Number.isFinite(cpr) || cpr === 0 ? "—" : formatCurrency(cpr),
        };
      });
    });

    return mapped;
  }, [buckets, actionType, formatCurrency]);

  // 3. Obter valores médios para exibição
  const avgCpr = actionType && averages?.per_action_type?.[actionType] && typeof averages.per_action_type[actionType].cpr === "number" ? averages.per_action_type[actionType].cpr : null;
  const avgHook = averages?.hook ?? null;
  const avgWebsiteCtr = averages?.website_ctr ?? null;
  const avgPageConv = actionType && averages?.per_action_type?.[actionType] ? averages.per_action_type[actionType].page_conv ?? null : null;

  // 4. Função para formatar CPR
  const formatCpr = (value: number | null | undefined): string => {
    if (value == null || !Number.isFinite(value) || value <= 0) return "—";
    return formatCurrency(value);
  };

  // 5. Criar configurações de colunas para o BaseKanbanWidget
  const columnConfigs = useMemo<KanbanColumnConfig<GoldBucket>[]>(() => {
    const configs = [] as KanbanColumnConfig<GoldBucket>[];

    const addColumn = (id: GoldBucket, title: string, items: any[], tooltipTitle: string, tooltipDescription: string) => {
      configs.push({
        id,
        title,
        items,
        averageValue: avgCpr, // Mostrar média do CPR em todas as colunas
        formatAverage: formatCpr, // Formatar como moeda
        emptyMessage: "Tudo bem por aqui",
        renderColumn: (config) => (
          <SortableColumn
            id={config.id}
            title={config.title}
            items={config.items}
            colorScheme={colorSchemes[id]}
            averageValue={config.averageValue}
            formatAverage={config.formatAverage}
            emptyMessage={config.emptyMessage}
            enableDrag={false}
            tooltip={{
              title: tooltipTitle,
              content: (
                <>
                  <div className="font-semibold text-sm mb-1">{tooltipTitle}</div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{tooltipDescription}</p>
                </>
              ),
            }}
            renderCard={(item, cardIndex, cardColorScheme) => (
              <GenericCard
                key={`${item.ad_id}-${cardIndex}`}
                ad={item}
                metricLabel={title}
                metricKey="cpr"
                rank={cardIndex + 1}
                averageValue={avgCpr}
                metricColor={cardColorScheme.card}
                onClick={(openVideo) => {
                  if (config.onAdClick) {
                    config.onAdClick(item, openVideo);
                  }
                }}
                actionType={actionType}
                averages={averages}
              />
            )}
          />
        ),
      });
    };

    addColumn("golds", "Golds", mappedBuckets.golds, "Anúncios Gold", "Anúncios com CPR abaixo da média e todas as métricas (hook, link CTR e page conversion) acima da média. Estes são os seus melhores anúncios.");

    addColumn("oportunidades", "Oportunidades", mappedBuckets.oportunidades, "Oportunidades", "Anúncios com CPR abaixo da média e pelo menos uma métrica acima da média. Há potencial de melhoria nestes anúncios.");

    addColumn("licoes", "Lições", mappedBuckets.licoes, "Lições", "Anúncios com CPR acima da média, mas com pelo menos uma métrica acima da média. Aprenda com o que está funcionando nestes anúncios.");

    addColumn("descartes", "Descartes", mappedBuckets.descartes, "Descartes", "Anúncios com CPR acima da média e todas as métricas abaixo da média. Considere pausar ou otimizar estes anúncios.");

    addColumn("neutros", "Neutros", mappedBuckets.neutros, "Neutros", "Anúncios que não se encaixam nas outras categorias. Podem precisar de análise mais detalhada.");

    return configs;
  }, [mappedBuckets, colorSchemes, avgCpr, actionType, averages]);

  return (
    <BaseKanbanWidget
      storageKey={STORAGE_KEY_GOLD_COLUMN_ORDER}
      defaultColumnOrder={DEFAULT_GOLD_COLUMN_ORDER}
      columnConfigs={columnConfigs}
      enableDrag={false}
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

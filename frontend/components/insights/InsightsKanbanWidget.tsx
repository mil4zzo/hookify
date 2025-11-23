"use client";

import { useState, useMemo } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GenericColumn, GenericColumnColorScheme } from "@/components/common/GenericColumn";
import { IconGripVertical, IconInfoCircle } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";
import { RankingsItem, RankingsResponse } from "@/lib/api/schemas";
import { ValidationCondition } from "@/components/common/ValidationCriteriaBuilder";
import { evaluateValidationCriteria, AdMetricsData } from "@/lib/utils/validateAdCriteria";
import { GemCard } from "./GemCard";
import { Modal } from "@/components/common/Modal";
import { AdDetailsDialog } from "@/components/ads/AdDetailsDialog";
import { calculateGlobalMetricRanks } from "@/lib/utils/metricRankings";
import { useFormatCurrency } from "@/lib/utils/currency";
import { computeCpmImpact, computeLandingPageImpact } from "@/lib/utils/impact";

const STORAGE_KEY_INSIGHTS_COLUMN_ORDER = "hookify-insights-column-order";
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

interface SortableColumnWrapperProps {
  id: string;
  title: string;
  items: any[];
  colorScheme: GenericColumnColorScheme;
  emptyMessage: string;
  averageValue?: number | null;
  renderCard: (item: any, cardIndex: number, colorScheme: GenericColumnColorScheme) => React.ReactNode;
  getTopMetrics?: (adId: string | null | undefined) => {
    spendRank: number | null;
    hookRank: number | null;
    websiteCtrRank: number | null;
    ctrRank: number | null;
    pageConvRank: number | null;
    holdRateRank: number | null;
  };
  actionType?: string;
  formatAverage?: (value: number | null | undefined) => string;
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
 * Componente wrapper para tornar uma coluna arrastável
 */
function SortableColumnWrapper({ id, title, items, colorScheme, emptyMessage, averageValue, renderCard, getTopMetrics, actionType, formatAverage }: SortableColumnWrapperProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className={cn("relative group", isDragging && "z-50 opacity-50")}>
      <GenericColumn
        title={title}
        items={items}
        colorScheme={colorScheme}
        averageValue={averageValue}
        emptyMessage={emptyMessage}
        renderCard={renderCard}
        formatAverage={formatAverage}
        headerRight={
          <div className="flex items-center gap-1">
            {title === "Landing Page" && (
              <button type="button" className="flex items-center justify-center rounded-md p-1 opacity-60 hover:opacity-100 hover:bg-muted/50 transition-colors" title="Impacto = conversões adicionais estimadas ao melhorar apenas a conversão de página até a média, mantendo o mesmo spend.">
                <IconInfoCircle className="h-4 w-4 text-muted-foreground hover:text-foreground" />
              </button>
            )}
            {title === "CPM" && (
              <button type="button" className="flex items-center justify-center rounded-md p-1 opacity-60 hover:opacity-100 hover:bg-muted/50 transition-colors" title="Impacto = economia potencial estimada ao reduzir o CPM atual até a média, mantendo o mesmo volume de impressões.">
                <IconInfoCircle className="h-4 w-4 text-muted-foreground hover:text-foreground" />
              </button>
            )}
            {title === "Spend" && (
              <button type="button" className="flex items-center justify-center rounded-md p-1 opacity-60 hover:opacity-100 hover:bg-muted/50 transition-colors" title="Impacto = economia potencial estimada ao reduzir o CPR atual até a média. Mostra anúncios com spend > 3% do total e CPR 10% acima da média.">
                <IconInfoCircle className="h-4 w-4 text-muted-foreground hover:text-foreground" />
              </button>
            )}
            <div {...attributes} {...listeners} className="flex items-center justify-center cursor-grab active:cursor-grabbing opacity-60 hover:opacity-100 transition-opacity rounded-md hover:bg-muted/50 p-1" title="Arraste para reordenar">
              <IconGripVertical className="h-4 w-4 text-muted-foreground hover:text-foreground" />
            </div>
          </div>
        }
      />
    </div>
  );
}

/**
 * Widget de Kanban para a seção Insights.
 * Usa a mesma estrutura e estilização de Gems.
 * Colunas são arrastáveis para reordenar.
 */
export function InsightsKanbanWidget({ ads, averages, actionType, validationCriteria, dateStart, dateStop, availableConversionTypes = [] }: InsightsKanbanWidgetProps) {
  const [selectedAd, setSelectedAd] = useState<RankingsItem | null>(null);
  const [openInVideoTab, setOpenInVideoTab] = useState(false);
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

  const defaultColumnTitles = ["Landing Page", "CPM", "Spend", "Coluna 4"];

  // Carregar ordem salva do localStorage ou usar ordem padrão
  const loadColumnOrder = (): string[] => {
    if (typeof window === "undefined") return defaultColumnTitles;
    try {
      const saved = localStorage.getItem(STORAGE_KEY_INSIGHTS_COLUMN_ORDER);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length === defaultColumnTitles.length) {
          // Validar que todas as colunas padrão estão presentes
          const isValid = defaultColumnTitles.every((title) => parsed.includes(title));
          if (isValid) {
            return parsed;
          }
        }
      }
    } catch (e) {
      console.error("Erro ao carregar ordem das colunas:", e);
    }
    return defaultColumnTitles;
  };

  const [columnOrder, setColumnOrder] = useState<string[]>(() => loadColumnOrder());

  // Salvar ordem no localStorage
  const saveColumnOrder = (order: string[]) => {
    try {
      localStorage.setItem(STORAGE_KEY_INSIGHTS_COLUMN_ORDER, JSON.stringify(order));
    } catch (e) {
      console.error("Erro ao salvar ordem das colunas:", e);
    }
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

    // 5.1 Mapear métricas com fallbacks (igual ao GemCard)
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

    // 5.3 Debug opcional: logar métricas e motivos de exclusão
    if (DEBUG_PAGE_CONV) {
      // eslint-disable-next-line no-console
      console.groupCollapsed("[InsightsKanban] Landing Page - Debug", `actionType=${actionType}`);
      // eslint-disable-next-line no-console
      console.log("Médias usadas:", {
        avgWebsiteCtr,
        avgConnectRate,
        avgPageConv,
        avgWebsiteCtrPct: avgWebsiteCtr * 100,
        avgConnectRatePct: avgConnectRate * 100,
        avgPageConvPct: avgPageConv * 100,
      });
      mappedAds.forEach((ad: any) => {
        const websiteCtrAboveAvg = avgWebsiteCtr > 0 ? ad.websiteCtr > avgWebsiteCtr : ad.websiteCtr > 0;
        const connectRateAboveAvg = avgConnectRate > 0 ? ad.connectRate > avgConnectRate : ad.connectRate > 0;
        // Calcular gap para visualização no debug (equivalente a: ad.pageConv <= avgPageConv * 0.8)
        const pageConvGapDebug = avgPageConv > 0 && ad.pageConv > 0 ? (avgPageConv - ad.pageConv) / avgPageConv : 0;
        const pageConvBelowAvg = avgPageConv > 0 && ad.pageConv > 0 ? ad.pageConv <= avgPageConv * 0.8 : avgPageConv > 0 ? ad.pageConv < avgPageConv && ad.pageConv > 0 : ad.pageConv > 0;
        const included = websiteCtrAboveAvg && connectRateAboveAvg && pageConvBelowAvg && ad.pageConv > 0;

        // eslint-disable-next-line no-console
        console.log({
          ad_id: ad.ad_id,
          ad_name: ad.ad_name,
          websiteCtr: ad.websiteCtr,
          connectRate: ad.connectRate,
          pageConv: ad.pageConv,
          websiteCtrPct: ad.websiteCtr * 100,
          connectRatePct: ad.connectRate * 100,
          pageConvPct: ad.pageConv * 100,
          websiteCtrAboveAvg,
          connectRateAboveAvg,
          pageConvGap: pageConvGapDebug,
          pageConvBelowAvg,
          includedInPageConv: included,
        });
      });
      // eslint-disable-next-line no-console
      console.log("Total anúncios mapeados:", mappedAds.length);
      // eslint-disable-next-line no-console
      console.log("Total anúncios filtrados (Landing Page):", filteredAds.length);
      // eslint-disable-next-line no-console
      console.groupEnd();
    }

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

    // 6.1 Mapear métricas com fallbacks (igual ao GemCard)
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

  // Configurar sensores para drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Handler para quando o drag termina
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setColumnOrder((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        const newOrder = arrayMove(items, oldIndex, newIndex);
        saveColumnOrder(newOrder);
        return newOrder;
      });
    }
  };

  // Obter esquema de cores e título para cada coluna baseado na ordem
  const getColumnConfig = (title: string, index: number) => {
    const originalIndex = defaultColumnTitles.indexOf(title);
    return {
      title,
      colorScheme: allColorSchemes[originalIndex] || allColorSchemes[index],
    };
  };

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

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={columnOrder} strategy={horizontalListSortingStrategy}>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">
            {columnOrder.map((title, index) => {
              const config = getColumnConfig(title, index);
              // Determinar itens e média para cada coluna
              let columnItems: any[] = [];
              let columnAverage: number | null = null;

              if (title === "Landing Page") {
                columnItems = pageConvColumnAds;
                columnAverage = avgPageConv;
              } else if (title === "CPM") {
                columnItems = cpmColumnAds;
                columnAverage = avgCpm;
              } else if (title === "Spend") {
                columnItems = spendColumnAds;
                columnAverage = actionType && averages?.per_action_type?.[actionType]?.cpr != null ? averages.per_action_type[actionType].cpr : null;
              }

              return (
                <SortableColumnWrapper
                  key={title}
                  id={title}
                  title={config.title}
                  items={columnItems}
                  colorScheme={config.colorScheme}
                  averageValue={columnAverage}
                  emptyMessage="Nenhum item encontrado"
                  getTopMetrics={getTopMetrics}
                  actionType={actionType}
                  formatAverage={title === "CPM" || title === "Spend" ? (value) => (value != null && Number.isFinite(value) && value > 0 ? formatCurrency(value) : "—") : undefined}
                  renderCard={(item, cardIndex, colorScheme) => (
                    <GemCard
                      key={`${item.ad_id}-${cardIndex}`}
                      ad={item}
                      metricLabel={config.title}
                      metricKey={title === "CPM" ? "cpm" : title === "Spend" ? "cpr" : "page_conv"}
                      rank={cardIndex + 1}
                      averageValue={columnAverage}
                      metricColor={colorScheme.card}
                      onClick={(openVideo) => {
                        setSelectedAd(item);
                        setOpenInVideoTab(openVideo || false);
                      }}
                      topMetrics={getTopMetrics(item.ad_id)}
                      actionType={actionType}
                      isCompact={true}
                    />
                  )}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

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

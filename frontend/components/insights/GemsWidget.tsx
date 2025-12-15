"use client";

import { useMemo, useState } from "react";
import { RankingsItem, RankingsResponse } from "@/lib/api/schemas";
import { ValidationCondition } from "@/components/common/ValidationCriteriaBuilder";
import { evaluateValidationCriteria, AdMetricsData } from "@/lib/utils/validateAdCriteria";
import { GemsColumn } from "./GemsColumn";
import { GemsColumnType } from "@/components/common/GemsColumnFilter";
import { calculateGlobalMetricRanks } from "@/lib/utils/metricRankings";
import { computeTopMetric } from "@/lib/utils/gemsTopMetrics";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { IconGripVertical } from "@tabler/icons-react";
import { BaseKanbanWidget, KanbanColumnConfig } from "@/components/common/BaseKanbanWidget";

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

const STORAGE_KEY_GEMS_COLUMN_ORDER = "hookify-gems-column-order";
const DEFAULT_GEMS_COLUMN_ORDER: readonly GemsColumnType[] = ["hook", "website_ctr", "page_conv", "ctr", "hold_rate", "cpr"] as const;

/**
 * Componente wrapper para tornar uma coluna Gems arrastável
 */
function SortableGemsColumn({ id, ...columnProps }: { id: GemsColumnType } & React.ComponentProps<typeof GemsColumn>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const dragHandle = (
    <button type="button" {...attributes} {...listeners} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-grab active:cursor-grabbing transition-colors" title="Arraste para reordenar" aria-label="Arraste para reordenar">
      <IconGripVertical className="h-4 w-4" />
    </button>
  );

  return (
    <div ref={setNodeRef} style={style} className={`w-full h-full ${isDragging ? "z-50 opacity-60" : ""}`}>
      <GemsColumn {...columnProps} headerRight={dragHandle} />
    </div>
  );
}

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

export function GemsWidget({ ads, averages, actionType, validationCriteria, limit = 5, dateStart, dateStop, availableConversionTypes = [], isCompact = true, activeColumns }: GemsWidgetProps) {
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
  const topHook = useMemo(() => computeTopMetric(validatedAds as any, "hook", actionType, limit), [validatedAds, actionType, limit]);

  const topWebsiteCtr = useMemo(() => computeTopMetric(validatedAds as any, "website_ctr", actionType, limit), [validatedAds, actionType, limit]);

  const topCtr = useMemo(() => computeTopMetric(validatedAds as any, "ctr", actionType, limit), [validatedAds, actionType, limit]);

  const topPageConv = useMemo(() => computeTopMetric(validatedAds as any, "page_conv", actionType, limit), [validatedAds, actionType, limit]);

  const topHoldRate = useMemo(() => computeTopMetric(validatedAds as any, "hold_rate", actionType, limit), [validatedAds, actionType, limit]);

  const topCpr = useMemo(() => computeTopMetric(validatedAds as any, "cpr", actionType, limit), [validatedAds, actionType, limit]);

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
        cprRank: null,
      };
    }

    return {
      spendRank: globalMetricRanks.spendRank.get(adId) ?? null,
      hookRank: globalMetricRanks.hookRank.get(adId) ?? null,
      websiteCtrRank: globalMetricRanks.websiteCtrRank.get(adId) ?? null,
      ctrRank: globalMetricRanks.ctrRank.get(adId) ?? null,
      pageConvRank: globalMetricRanks.pageConvRank.get(adId) ?? null,
      holdRateRank: globalMetricRanks.holdRateRank.get(adId) ?? null,
      cprRank: globalMetricRanks.cprRank.get(adId) ?? null,
    };
  };

  // 6. Obter valores médios para comparação
  const avgHook = averages?.hook ?? null;
  const avgWebsiteCtr = averages?.website_ctr ?? null;
  const avgCtr = averages?.ctr ?? null;
  const avgPageConv = actionType && averages?.per_action_type?.[actionType] ? averages.per_action_type[actionType].page_conv ?? null : null;
  const avgHoldRate = (averages as any)?.hold_rate ?? null;
  const avgCpr = actionType && averages?.per_action_type?.[actionType] && typeof averages.per_action_type[actionType].cpr === "number" ? averages.per_action_type[actionType].cpr : null;

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

  // Criar configurações de colunas para o BaseKanbanWidget
  const columnConfigs = useMemo<KanbanColumnConfig<GemsColumnType>[]>(() => {
    const configs: KanbanColumnConfig<GemsColumnType>[] = [];

    const addColumn = (id: GemsColumnType, title: string, items: any[], averageValue: number | null, metric: "hook" | "website_ctr" | "ctr" | "page_conv" | "hold_rate" | "cpr", tooltipTitle: string, tooltipDescription: string) => {
      configs.push({
        id,
        title,
        items,
        averageValue,
        emptyMessage: "Nenhum anúncio válido encontrado",
        renderColumn: (config) => (
          <SortableGemsColumn
            id={config.id}
            title={config.title}
            items={config.items}
            metric={metric}
            averageValue={config.averageValue}
            onAdClick={config.onAdClick}
            getTopMetrics={getTopMetrics}
            actionType={actionType}
            isCompact={isCompact}
            averages={averages}
            tooltip={{
              title: tooltipTitle,
              content: (
                <>
                  <div className="font-semibold text-sm mb-1">{tooltipTitle}</div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{tooltipDescription}</p>
                </>
              ),
            }}
          />
        ),
      });
    };

    addColumn(
      "hook",
      "Hooks",
      topHook,
      avgHook,
      "hook",
      "Taxa de retenção inicial",
      "Percentual de pessoas que assistiram pelo menos 3 segundos do vídeo. Mede a capacidade do anúncio de prender atenção nos primeiros segundos."
    );
    addColumn(
      "website_ctr",
      "Link CTR",
      topWebsiteCtr,
      avgWebsiteCtr,
      "website_ctr",
      "Taxa de cliques no link",
      "Percentual de impressões que resultaram em cliques no link. Mede a efetividade do anúncio em gerar interesse e direcionar tráfego."
    );
    addColumn(
      "page_conv",
      "Page",
      topPageConv,
      avgPageConv,
      "page_conv",
      "Taxa de conversão na página",
      "Percentual de visitantes da landing page que converteram. Mede a qualidade da página, copy e público-alvo."
    );
    addColumn(
      "ctr",
      "CTR",
      topCtr,
      avgCtr,
      "ctr",
      "Taxa de cliques geral",
      "Percentual de impressões que resultaram em qualquer tipo de clique. Mede o engajamento geral e relevância do anúncio."
    );
    addColumn(
      "hold_rate",
      "Hold Rate",
      topHoldRate,
      avgHoldRate,
      "hold_rate",
      "Taxa de retenção geral",
      "Percentual de pessoas que assistiram o vídeo até o final. Mede a retenção e qualidade do conteúdo ao longo de toda a duração."
    );
    addColumn(
      "cpr",
      "CPR",
      topCpr,
      avgCpr,
      "cpr",
      "Custo por resultado",
      "Valor gasto para cada conversão obtida. Mede a eficiência do investimento em anúncios. Quanto menor, melhor."
    );

    return configs;
  }, [topHook, topWebsiteCtr, topPageConv, topCtr, topHoldRate, topCpr, avgHook, avgWebsiteCtr, avgPageConv, avgCtr, avgHoldRate, avgCpr, getTopMetrics, actionType, isCompact, averages]);

  return (
    <BaseKanbanWidget
      storageKey={STORAGE_KEY_GEMS_COLUMN_ORDER}
      defaultColumnOrder={DEFAULT_GEMS_COLUMN_ORDER}
      columnConfigs={columnConfigs}
      activeColumns={activeColumns}
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

"use client";

import { useMemo } from "react";
import { RankingsItem, RankingsResponse } from "@/lib/api/schemas";
import { rowMatchesRules, type RuleNameDictionary } from "@/lib/rules/evaluate";
import { isEmptyRuleTree, type RuleTree } from "@/lib/rules/types";
import { GemsColumn } from "./GemsColumn";
import { GemsColumnType } from "@/components/common/GemsColumnFilter";
import { calculateGlobalMetricRanks } from "@/lib/utils/metricRankings";
import { computeTopMetric } from "@/lib/utils/gemsTopMetrics";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { IconGripVertical } from "@tabler/icons-react";
import { BaseKanbanWidget, KanbanColumnConfig } from "@/components/common/BaseKanbanWidget";
import { useMqlLeadscore } from "@/lib/hooks/useMqlLeadscore";

interface GemsWidgetProps {
  ads: RankingsItem[];
  /** A média global ponderada (serverAverages, todos os ads = Meta) — única média do app. */
  averages?: RankingsResponse["averages"];
  actionType: string;
  validationCriteria: RuleTree;
  /** Dicionário id → nome (migration 136): resolve "Nome da campanha" no critério. */
  names?: RuleNameDictionary;
  limit?: number; // Top N por métrica
  dateStart?: string;
  dateStop?: string;
  availableConversionTypes?: string[];
  activeColumns?: Set<GemsColumnType>; // Colunas ativas
  /** Packs selecionados — propagado ao AdDetailsDialog para escopo correto */
  packIds?: string[];
}

const STORAGE_KEY_GEMS_COLUMN_ORDER = "hookify-gems-column-order";
const DEFAULT_GEMS_COLUMN_ORDER: readonly GemsColumnType[] = ["hook", "website_ctr", "page_conv", "ctr", "hold_rate", "cpr", "cpmql"] as const;

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
    <button type="button" {...attributes} {...listeners} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted-hover cursor-grab active:cursor-grabbing transition-colors" title="Arraste para reordenar" aria-label="Arraste para reordenar">
      <IconGripVertical className="h-4 w-4" />
    </button>
  );

  return (
    <div ref={setNodeRef} style={style} className={`w-full h-full ${isDragging ? "z-50 opacity-60" : ""}`}>
      <GemsColumn {...columnProps} headerRight={dragHandle} />
    </div>
  );
}


export function GemsWidget({ ads, averages, actionType, validationCriteria, names, limit = 5, dateStart, dateStop, availableConversionTypes = [], activeColumns, packIds = [] }: GemsWidgetProps) {
  const { mqlLeadscoreMin } = useMqlLeadscore();

  // 1. Filtrar apenas anúncios validados
  const validatedAds = useMemo(() => {
    if (isEmptyRuleTree(validationCriteria)) {
      return ads;
    }

    // Regra avaliada direto na linha da RPC — a mesma linha e o mesmo motor do
    // filtro do Manager e dos grupos do Boards.
    return ads.filter((ad) => rowMatchesRules(ad as any, validationCriteria, { actionType, mqlLeadscoreMin, names }));
  }, [ads, validationCriteria, actionType, mqlLeadscoreMin, names]);

  // 2. Calcular top por cada métrica
  const topHook = useMemo(() => computeTopMetric(validatedAds as any, "hook", actionType, limit, mqlLeadscoreMin), [validatedAds, actionType, limit, mqlLeadscoreMin]);

  const topWebsiteCtr = useMemo(() => computeTopMetric(validatedAds as any, "website_ctr", actionType, limit, mqlLeadscoreMin), [validatedAds, actionType, limit, mqlLeadscoreMin]);

  const topCtr = useMemo(() => computeTopMetric(validatedAds as any, "ctr", actionType, limit, mqlLeadscoreMin), [validatedAds, actionType, limit, mqlLeadscoreMin]);

  const topPageConv = useMemo(() => computeTopMetric(validatedAds as any, "page_conv", actionType, limit, mqlLeadscoreMin), [validatedAds, actionType, limit, mqlLeadscoreMin]);

  const topHoldRate = useMemo(() => computeTopMetric(validatedAds as any, "hold_rate", actionType, limit, mqlLeadscoreMin), [validatedAds, actionType, limit, mqlLeadscoreMin]);

  const topCpr = useMemo(() => computeTopMetric(validatedAds as any, "cpr", actionType, limit, mqlLeadscoreMin), [validatedAds, actionType, limit, mqlLeadscoreMin]);

  const topCpmql = useMemo(() => computeTopMetric(validatedAds as any, "cpmql", actionType, limit, mqlLeadscoreMin), [validatedAds, actionType, limit, mqlLeadscoreMin]);

  // 3. Calcular rankings globais usando o utilitário centralizado
  // IMPORTANTE: Os rankings são calculados apenas com anúncios que passam pelos critérios de validação
  // Se não houver critérios definidos (array vazio ou undefined), todos os anúncios são considerados
  const globalMetricRanks = useMemo(() => {
    // Passar validationCriteria apenas se houver critérios definidos (array não vazio)
    // Array vazio ou undefined significa "sem critérios" (todos os anúncios são válidos)
    const criteriaToUse = isEmptyRuleTree(validationCriteria) ? undefined : validationCriteria;
    return calculateGlobalMetricRanks(ads, {
      validationCriteria: criteriaToUse,
      actionType,
      filterValidOnly: true,
      mqlLeadscoreMin,
      names,
    });
  }, [ads, validationCriteria, actionType, mqlLeadscoreMin, names]);

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
        cpmqlRank: null,
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
      cpmqlRank: globalMetricRanks.cpmqlRank.get(adId) ?? null,
    };
  };

  // 6. Obter valores médios para comparação
  const avgHook = averages?.hook ?? null;
  const avgWebsiteCtr = averages?.website_ctr ?? null;
  const avgCtr = averages?.ctr ?? null;
  const avgPageConv = actionType && averages?.per_action_type?.[actionType] ? averages.per_action_type[actionType].page_conv ?? null : null;
  const avgHoldRate = (averages as any)?.hold_rate ?? null;
  const avgCpr = actionType && averages?.per_action_type?.[actionType] && typeof averages.per_action_type[actionType].cpr === "number" ? averages.per_action_type[actionType].cpr : null;
  const avgCpmql = (averages as any)?.cpmql ?? null;

  // Se não há anúncios validados, não mostrar o widget
  if (validatedAds.length === 0) {
    return null;
  }

  // Criar configurações de colunas para o BaseKanbanWidget
  const columnConfigs = useMemo<KanbanColumnConfig<GemsColumnType>[]>(() => {
    const configs: KanbanColumnConfig<GemsColumnType>[] = [];

    const addColumn = (id: GemsColumnType, title: string, items: any[], averageValue: number | null, metric: "hook" | "website_ctr" | "ctr" | "page_conv" | "hold_rate" | "cpr" | "cpmql", tooltipTitle: string, tooltipDescription: string) => {
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

    addColumn("hook", "Hooks", topHook, avgHook, "hook", "Taxa de retenção inicial", "Percentual de pessoas que assistiram pelo menos 3 segundos do vídeo. Mede a capacidade do anúncio de prender atenção nos primeiros segundos.");
    addColumn("website_ctr", "Link CTR", topWebsiteCtr, avgWebsiteCtr, "website_ctr", "Taxa de cliques no link", "Percentual de impressões que resultaram em cliques no link. Mede a efetividade do anúncio em gerar interesse e direcionar tráfego.");
    addColumn("page_conv", "Page", topPageConv, avgPageConv, "page_conv", "Taxa de conversão na página", "Percentual de visitantes da landing page que converteram. Mede a qualidade da página, copy e público-alvo.");
    addColumn("ctr", "CTR", topCtr, avgCtr, "ctr", "Taxa de cliques geral", "Percentual de impressões que resultaram em qualquer tipo de clique. Mede o engajamento geral e relevância do anúncio.");
    addColumn("hold_rate", "Hold Rate", topHoldRate, avgHoldRate, "hold_rate", "Taxa de retenção geral", "Percentual de pessoas que assistiram o vídeo até o final. Mede a retenção e qualidade do conteúdo ao longo de toda a duração.");
    addColumn("cpr", "CPR", topCpr, avgCpr, "cpr", "Custo por resultado", "Valor gasto para cada conversão obtida. Mede a eficiência do investimento em anúncios. Quanto menor, melhor.");
    addColumn("cpmql", "CPMQL", topCpmql, avgCpmql, "cpmql", "Custo por MQL", "Valor gasto para cada MQL (Marketing Qualified Lead) obtido. Mede a eficiência do investimento em gerar leads qualificados. Quanto menor, melhor.");

    return configs;
  }, [topHook, topWebsiteCtr, topPageConv, topCtr, topHoldRate, topCpr, topCpmql, avgHook, avgWebsiteCtr, avgPageConv, avgCtr, avgHoldRate, avgCpr, avgCpmql, getTopMetrics, actionType, averages]);

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
        packIds,
      }}
    />
  );
}

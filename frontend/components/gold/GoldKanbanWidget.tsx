"use client";

import { useMemo } from "react";
import { RankingsItem, RankingsResponse } from "@/lib/api/schemas";
import { rowMatchesRules } from "@/lib/rules/evaluate";
import { isEmptyRuleTree, type RuleTree } from "@/lib/rules/types";
import { BaseKanbanWidget, KanbanColumnConfig } from "@/components/common/BaseKanbanWidget";
import { SortableColumn } from "@/components/common/SortableColumn";
import { goldBucketColorSchemes } from "@/lib/utils/gemsColorSchemes";
import { GenericCard } from "@/components/common/GenericCard";
import { splitAdsIntoGoldBuckets, GoldBucket } from "@/lib/utils/goldClassification";
import { useFormatCurrency } from "@/lib/utils/currency";
import { useMqlLeadscore } from "@/lib/hooks/useMqlLeadscore";

interface GoldKanbanWidgetProps {
  ads: RankingsItem[];
  /** A média global ponderada (serverAverages, todos os ads = Meta) — única média do app.
   *  Usada como threshold de classificação, display de coluna/card e benchmark do dialog. */
  averages?: RankingsResponse["averages"];
  actionType: string;
  validationCriteria: RuleTree;
  dateStart?: string;
  dateStop?: string;
  availableConversionTypes?: string[];
  /** Packs selecionados — propagado ao AdDetailsDialog para escopo correto */
  packIds?: string[];
}

const STORAGE_KEY_GOLD_COLUMN_ORDER = "hookify-gold-column-order";
const DEFAULT_GOLD_COLUMN_ORDER: readonly GoldBucket[] = ["golds", "oportunidades", "licoes", "descartes", "neutros"] as const;


/**
 * Widget de Kanban para a página G.O.L.D.
 * Classifica anúncios em 5 categorias baseadas em CPR e métricas vs médias.
 */
export function GoldKanbanWidget({ ads, averages, actionType, validationCriteria, dateStart, dateStop, availableConversionTypes = [], packIds = [] }: GoldKanbanWidgetProps) {
  const formatCurrency = useFormatCurrency();
  // Só entra na conta se o critério citar uma métrica de MQL; o contexto é passado
  // sempre para que as três telas avaliem a MESMA regra do mesmo jeito.
  const { mqlLeadscoreMin } = useMqlLeadscore();

  const colorSchemes = goldBucketColorSchemes;

  // 1. Filtrar apenas anúncios validados
  const validatedAds = useMemo(() => {
    if (isEmptyRuleTree(validationCriteria)) {
      return ads;
    }

    // Regra avaliada direto na linha da RPC — a mesma linha e o mesmo motor do
    // filtro do Manager e dos grupos do Boards.
    return ads.filter((ad) => rowMatchesRules(ad as any, validationCriteria, { actionType, mqlLeadscoreMin }));
  }, [ads, validationCriteria, actionType, mqlLeadscoreMin]);

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
        packIds,
      }}
    />
  );
}

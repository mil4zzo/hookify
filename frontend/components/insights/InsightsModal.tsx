"use client";

import { useState, useEffect, useMemo } from "react";
import { OpportunityRow } from "@/lib/utils/opportunity";
import { Button } from "@/components/ui/button";
import { IconX, IconInfoCircle } from "@tabler/icons-react";
import { GemsTopItem } from "@/lib/utils/gemsTopMetrics";
import { BaseKanbanWidget, KanbanColumnConfig } from "@/components/common/BaseKanbanWidget";
import { GemsColumnType } from "@/components/common/GemsColumnFilter";
import { RankingsResponse } from "@/lib/api/schemas";
import { GenericColumn, GenericColumnColorScheme } from "@/components/common/GenericColumn";
import { GenericCard } from "@/components/common/GenericCard";
import { computeMqlMetricsFromLeadscore } from "@/lib/utils/mqlMetrics";
import { useMqlLeadscore } from "@/lib/hooks/useMqlLeadscore";
import { isMetricBelowAverage } from "@/lib/utils/metricsShared";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface InsightsModalProps {
  /** Dados da oportunidade */
  row: OpportunityRow;
  /** Se o modal está aberto */
  isOpen: boolean;
  /** Callback para fechar o modal */
  onClose: () => void;
  /** Função para formatar valores monetários */
  formatCurrency: (value: number) => string;
  /** Média de CPR */
  avgCpr: number;
  /** Componente do card a ser renderizado no modal (à esquerda) */
  cardComponent: React.ReactNode;
  /** Tipo de ação/conversão para calcular número de conversões */
  actionType?: string;
  /** Top 5 hooks da seção Gems */
  gemsTopHook?: GemsTopItem[];
  /** Top 5 Website CTR da seção Gems */
  gemsTopWebsiteCtr?: GemsTopItem[];
  /** Top 5 CTR da seção Gems */
  gemsTopCtr?: GemsTopItem[];
  /** Top 5 Page Conv da seção Gems */
  gemsTopPageConv?: GemsTopItem[];
  /** Top 5 Hold Rate da seção Gems */
  gemsTopHoldRate?: GemsTopItem[];
  /** Averages para calcular médias das colunas */
  averages?: RankingsResponse["averages"];
}

const STORAGE_KEY_INSIGHTS_MODAL_COLUMN_ORDER = "hookify-insights-modal-column-order";
const DEFAULT_INSIGHTS_MODAL_COLUMN_ORDER: readonly GemsColumnType[] = ["hook", "hold_rate", "website_ctr", "page_conv"] as const;

function formatPct(v: number): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function formatPct2(v: number): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

/**
 * Componente de coluna para o InsightsModal (sem drag and drop)
 */
function InsightsModalColumn({ title, items, metric, averageValue, colorScheme, actionType }: { title: string; items: GemsTopItem[]; metric: "hook" | "website_ctr" | "ctr" | "page_conv" | "hold_rate"; averageValue?: number | null; colorScheme: GenericColumnColorScheme; actionType?: string }) {
  return <GenericColumn title={title} items={items} colorScheme={colorScheme} averageValue={averageValue} showAverage={false} emptyMessage="Nenhum anúncio válido encontrado" maxHeight="60vh" renderCard={(item, index) => <GenericCard key={`${item.ad_id ?? item.ad_name ?? index}`} ad={item} metricLabel={title} metricKey={metric} rank={index + 1} averageValue={averageValue} metricColor={colorScheme.card} actionType={actionType} isCompact={true} />} />;
}

export function InsightsModal({ row, isOpen, onClose, formatCurrency, avgCpr, cardComponent, actionType, gemsTopHook, gemsTopWebsiteCtr, gemsTopCtr, gemsTopPageConv, gemsTopHoldRate, averages }: InsightsModalProps) {
  const impactRelative = row.impact_relative || 0;
  const [activeTab, setActiveTab] = useState<"insights" | "metrics">("insights");

  // Calcular número de conversões a partir de CPR e Spend
  const conversions = row.cpr_actual > 0 && Number.isFinite(row.cpr_actual) ? row.spend / row.cpr_actual : 0;

  // Usar a mesma lógica canônica de MQL/CPMQL usada em RankingsTable / OpportunityRow
  const { mqlLeadscoreMin } = useMqlLeadscore();
  const { mqlCount: canonicalMqlCount, cpmql: canonicalCpmql } = useMemo(() => {
    const spend = Number(row.spend || 0);
    return computeMqlMetricsFromLeadscore({
      spend,
      leadscoreRaw: (row as any).leadscore_values,
      mqlLeadscoreMin,
    });
  }, [row, mqlLeadscoreMin]);

  // Fallback para valores pré-existentes em OpportunityRow, se por algum motivo o cálculo canônico não retornar nada
  const effectiveMqlCount = canonicalMqlCount || row.mql_count || 0;
  const effectiveCpmql = canonicalCpmql || row.cpmql || 0;

  // Obter valores médios para comparação
  const avgHook = averages?.hook ?? null;
  const avgWebsiteCtr = averages?.website_ctr ?? null;
  const avgCtr = averages?.ctr ?? null;
  const avgPageConv = actionType && averages?.per_action_type?.[actionType] ? averages.per_action_type[actionType].page_conv ?? null : null;
  const avgHoldRate = (averages as any)?.hold_rate ?? null;

  // Esquemas de cores para cada métrica (mesmos do GemsColumn)
  const metricColorSchemes: Record<"hook" | "website_ctr" | "ctr" | "page_conv" | "hold_rate", GenericColumnColorScheme> = {
    hook: {
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
    website_ctr: {
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
    ctr: {
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
    page_conv: {
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
    hold_rate: {
      headerBg: "bg-pink-500/10 border-pink-500/30",
      title: "",
      card: {
        border: "border-pink-500/30",
        bg: "bg-pink-500/5",
        text: "text-pink-600 dark:text-pink-400",
        accent: "border-pink-500",
        badge: "bg-pink-500 text-white",
      },
    },
  };

  // Total de métricas que podem aparecer no kanban
  const TOTAL_METRICS = 4;

  // Calcular quantas métricas estão abaixo da média
  const metricsBelowAverage = useMemo(() => {
    const metrics = [
      { value: row.hook, average: avgHook },
      { value: row.hold_rate, average: avgHoldRate },
      { value: row.website_ctr, average: avgWebsiteCtr },
      { value: row.page_conv, average: avgPageConv },
    ];
    return metrics.filter((m) => isMetricBelowAverage(m.value, m.average)).length;
  }, [row.hook, row.hold_rate, row.website_ctr, row.page_conv, avgHook, avgHoldRate, avgWebsiteCtr, avgPageConv]);

  // Criar configurações de colunas para o BaseKanbanWidget
  // Filtrar apenas métricas que estão abaixo da média (precisam de insights)
  const columnConfigs = useMemo<KanbanColumnConfig<GemsColumnType>[]>(() => {
    const configs: KanbanColumnConfig<GemsColumnType>[] = [];

    const addColumn = (id: GemsColumnType, title: string, items: GemsTopItem[], averageValue: number | null, metric: "hook" | "website_ctr" | "ctr" | "page_conv" | "hold_rate", currentValue: number | null | undefined) => {
      // Usar a função utilitária para verificar se a métrica está abaixo da média
      if (isMetricBelowAverage(currentValue, averageValue)) {
        configs.push({
          id,
          title,
          items,
          averageValue,
          emptyMessage: "Nenhum anúncio válido encontrado",
          renderColumn: (config) => <InsightsModalColumn title={config.title} items={config.items} metric={metric} averageValue={config.averageValue} colorScheme={metricColorSchemes[metric]} actionType={actionType} />,
        });
      }
    };

    addColumn("hook", "Hooks", gemsTopHook || [], avgHook, "hook", row.hook);
    addColumn("hold_rate", "Hold Rate", gemsTopHoldRate || [], avgHoldRate, "hold_rate", row.hold_rate);
    addColumn("website_ctr", "Link CTR", gemsTopWebsiteCtr || [], avgWebsiteCtr, "website_ctr", row.website_ctr);
    addColumn("page_conv", "Page", gemsTopPageConv || [], avgPageConv, "page_conv", row.page_conv);

    return configs;
  }, [gemsTopHook, gemsTopWebsiteCtr, gemsTopPageConv, gemsTopHoldRate, avgHook, avgWebsiteCtr, avgPageConv, avgHoldRate, actionType, row.hook, row.hold_rate, row.website_ctr, row.page_conv]);

  // Desabilitar scroll da página quando o modal estiver aberto
  useEffect(() => {
    if (isOpen) {
      // Salvar o valor atual do overflow
      const originalOverflow = document.body.style.overflow;
      // Desabilitar scroll
      document.body.style.overflow = "hidden";
      // Cleanup: restaurar o scroll quando o modal fechar
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative flex items-start gap-10">
        {/* Botão fechar */}
        <Button variant="outline" size="icon" className="absolute -top-12 right-0 h-10 w-10 rounded-full shadow-lg bg-background/90 backdrop-blur-sm hover:bg-background" onClick={onClose} aria-label="Fechar">
          <IconX className="h-5 w-5" />
        </Button>

        {/* Card no overlay */}
        {cardComponent}

        {/* Container de informações */}
        <div className="max-w-[70vw] bg-transparent flex flex-col gap-8 overflow-hidden">
          <div className="flex flex-col gap-2">
            {/* Título */}
            <h1 className="text-2xl font-bold text-foreground">{row.ad_name || row.ad_id || "—"}</h1>

            {/* Impacto */}
            <div className="flex flex-col gap-1">
              <p className="text-sm text-foreground">
                Impacto de <span className="font-semibold">{formatPct(impactRelative)}</span> na campanha
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 border-b border-border text-sm">
            <button className={`px-3 py-2 flex items-center gap-2 ${activeTab === "insights" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"}`} onClick={() => setActiveTab("insights")}>
              Insights
              {metricsBelowAverage > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 text-xs font-semibold rounded-full bg-orange-500/20 text-orange-600 dark:text-orange-400 border border-orange-500/30">
                    {metricsBelowAverage} de {TOTAL_METRICS}
                  </span>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className="flex items-center justify-center rounded-md p-0.5 opacity-60 hover:opacity-100 hover:bg-muted/50 transition-colors cursor-help"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs" side="right" sideOffset={8}>
                        <div className="flex flex-col gap-1.5">
                          <p className="font-semibold text-sm">Métricas analisadas:</p>
                          <ul className="text-xs space-y-1 list-disc list-inside text-muted-foreground">
                            <li>Hooks</li>
                            <li>Hold Rate</li>
                            <li>Link CTR</li>
                            <li>Page Conv</li>
                          </ul>
                          <p className="text-xs text-muted-foreground mt-1">
                            Apenas métricas abaixo da média são exibidas nesta aba.
                          </p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              )}
            </button>
            <button className={`px-3 py-2 ${activeTab === "metrics" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"}`} onClick={() => setActiveTab("metrics")}>
              Métricas
            </button>
          </div>

          {/* Conteúdo das tabs */}
          {activeTab === "insights" && (
            <>
              {columnConfigs.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <p className="text-sm">Todas as métricas estão acima da média. Não há insights necessários.</p>
                </div>
              ) : (
                <BaseKanbanWidget
                  storageKey={STORAGE_KEY_INSIGHTS_MODAL_COLUMN_ORDER}
                  defaultColumnOrder={columnConfigs.map((c) => c.id)}
                  columnConfigs={columnConfigs}
                  activeColumns={new Set(columnConfigs.map((c) => c.id))}
                  enableDrag={false}
                />
              )}
            </>
          )}

          {activeTab === "metrics" && (
            <div className="flex flex-col gap-6">
              {/* Linha 1: Resultados */}
              <div className="flex flex-col gap-3">
                <h3 className="text-base font-semibold text-foreground">Resultados</h3>
                <div className="grid grid-cols-4 gap-4">
                  {/* CPR */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">CPR</span>
                    <div className="flex flex-col items-baseline">
                      <span className="text-lg font-semibold text-foreground">{formatCurrency(row.cpr_actual)}</span>
                      <span className="text-[11px] text-muted-foreground">({Math.round(conversions).toLocaleString("pt-BR")} conversões)</span>
                    </div>
                  </div>

                  {/* CPMQL */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">CPMQL</span>
                    <div className="flex flex-col items-baseline">
                      <span className="text-lg font-semibold text-foreground">
                        {effectiveCpmql > 0 ? formatCurrency(effectiveCpmql) : "—"}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        ({effectiveMqlCount.toLocaleString("pt-BR")} MQLs)
                      </span>
                    </div>
                  </div>

                  {/* Spend */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Spend</span>
                    <span className="text-lg font-semibold text-foreground">{formatCurrency(row.spend)}</span>
                  </div>

                  {/* CPM */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">CPM</span>
                    <span className="text-lg font-semibold text-foreground">{formatCurrency(row.cpm)}</span>
                  </div>
                </div>
              </div>

              {/* Linha 2: Funil */}
              <div className="flex flex-col gap-3">
                <h3 className="text-base font-semibold text-foreground">Funil</h3>
                <div className="grid grid-cols-4 gap-4">
                  {/* CTR */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">CTR %</span>
                    <span className="text-lg font-semibold text-foreground">{formatPct2(row.ctr)}</span>
                  </div>

                  {/* Link CTR */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Link CTR %</span>
                    <span className="text-lg font-semibold text-foreground">{formatPct2(row.website_ctr)}</span>
                  </div>

                  {/* Connect Rate */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Connect Rate %</span>
                    <span className="text-lg font-semibold text-foreground">{formatPct(row.connect_rate)}</span>
                  </div>

                  {/* Conversão Página */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Conversão Página %</span>
                    <span className="text-lg font-semibold text-foreground">{formatPct(row.page_conv)}</span>
                  </div>
                </div>
              </div>

              {/* Linha 3: Performance */}
              <div className="flex flex-col gap-3">
                <h3 className="text-base font-semibold text-foreground">Performance</h3>
                <div className="grid grid-cols-4 gap-4">
                  {/* Hook Rate */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Hook Rate %</span>
                    <span className="text-lg font-semibold text-foreground">{formatPct(row.hook)}</span>
                  </div>

                  {/* Hold Rate */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Hold Rate %</span>
                    <span className="text-lg font-semibold text-foreground">{formatPct(row.hold_rate)}</span>
                  </div>

                  {/* 50% View Rate */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">50% View Rate %</span>
                    <span className="text-lg font-semibold text-foreground">{formatPct((row.video_watched_p50 || 0) / 100)}</span>
                  </div>

                  {/* ThruPlays Rate */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">ThruPlays Rate %</span>
                    <span className="text-lg font-semibold text-foreground">{formatPct(row.thruplays_rate || 0)}</span>
                  </div>
                </div>
              </div>

              {/* Linha 4: Extras */}
              <div className="flex flex-col gap-3">
                <h3 className="text-base font-semibold text-foreground">Extras</h3>
                <div className="grid grid-cols-4 gap-4">
                  {/* Leadscore médio */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Leadscore médio</span>
                    <span className="text-lg font-semibold text-foreground">{row.leadscore_avg ? row.leadscore_avg.toFixed(1) : "—"}</span>
                  </div>

                  {/* Frequência */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Frequência</span>
                    <span className="text-lg font-semibold text-foreground">{row.frequency ? row.frequency.toFixed(2) : "—"}</span>
                  </div>

                  {/* Impressões */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Impressões</span>
                    <span className="text-lg font-semibold text-foreground">{row.impressions ? row.impressions.toLocaleString() : "—"}</span>
                  </div>

                  {/* Alcance */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Alcance</span>
                    <span className="text-lg font-semibold text-foreground">{row.reach ? row.reach.toLocaleString() : "—"}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

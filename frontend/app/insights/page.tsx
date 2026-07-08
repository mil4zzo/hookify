"use client";

import { useState, useMemo } from "react";
import { StatePanel, StateSkeleton } from "@/components/common/States";
import { OpportunityWidget } from "@/components/insights/OpportunityWidget";
import { calculateGlobalMetricRanks, createEmptyMetricRanks } from "@/lib/utils/metricRankings";
import { GemsWidget } from "@/components/insights/GemsWidget";
import { GemsColumnFilter, GemsColumnType } from "@/components/common/GemsColumnFilter";
import { InsightsKanbanWidget } from "@/components/insights/InsightsKanbanWidget";
import { RankingsItem } from "@/lib/api/schemas";
import { computeOpportunityScores, OpportunityRow } from "@/lib/utils/opportunity";
import { IconSparkles, IconDiamond, IconSunFilled, IconStarFilled, IconActivity } from "@tabler/icons-react";
import { AppDialog } from "@/components/common/AppDialog";
import { AdDetailsDialog } from "@/components/ads/AdDetailsDialog";
import { useMqlLeadscore } from "@/lib/hooks/useMqlLeadscore";
import { PageContainer } from "@/components/common/PageContainer";
import { PageActions } from "@/components/common/PageActions";
import { computeTopMetric, GemsTopItem } from "@/lib/utils/gemsTopMetrics";
import { useAppAuthReady } from "@/lib/hooks/useAppAuthReady";
import { TabbedContentItem } from "@/components/common/TabbedContent";
import { AnalyticsWorkspace, TabbedWorkspace } from "@/components/common/layout";
import { useAdPerformancePipeline } from "@/lib/hooks/useAdPerformancePipeline";
import { usePacksLoading } from "@/components/layout/PacksLoader";
import { usePackDiagnostic } from "@/lib/hooks/usePackDiagnostic";
import { useUserPreferences } from "@/lib/hooks/useUserPreferences";
import { DayComparisonBlock } from "@/components/plano/DayComparisonBlock";
import { PackDiagnosticPanel } from "@/components/plano/PackDiagnosticPanel";
import type { DiagnosticTarget } from "@/lib/metrics/diagnostics";

// Chaves específicas do Insights
const STORAGE_KEY_GEMS_COLUMNS = "hookify-insights-gems-columns";
// v2: aba "Diagnóstico" virou a primeira/ativa por padrão — bump reseta a preferência
// antiga uma vez para todos caírem no novo default (depois a escolha persiste normal).
const STORAGE_KEY_ACTIVE_TAB = "hookify-insights-active-tab-v2";

// Títulos das tabs para tooltips
const TAB_TITLES = {
  diagnostico: "O que mudou hoje no seu conjunto de anúncios",
  opportunities: "Melhorias para maximizar seus lucros",
  insights: "Melhorias pontuais por métrica",
  gems: "Os melhores de cada métrica",
} as const;

function InsightsPageSkeleton() {
  return (
    <PageContainer variant="analytics" title="Oportunidades" description="Melhorias para maximizar seus lucros, ordenada por maior impacto.">
      <AnalyticsWorkspace>
        <StateSkeleton variant="page" rows={4} className="rounded-md border border-border bg-card" />
      </AnalyticsWorkspace>
    </PageContainer>
  );
}

// Configuração do header para cada tab
const TAB_HEADER_CONFIG = {
  diagnostico: {
    icon: IconActivity,
    title: "Diagnóstico",
    description: "O que mudou hoje — o CPR do conjunto e o que puxou o resultado.",
  },
  opportunities: {
    icon: IconStarFilled,
    title: "Oportunidades",
    description: "Melhorias para maximizar seus lucros, ordenada por maior impacto.",
  },
  insights: {
    icon: IconSunFilled,
    title: "Insights",
    description: "Melhorias acionáveis por métrica.",
  },
  gems: {
    icon: IconDiamond,
    title: "Gems",
    description: "Os melhores de cada métrica.",
  },
} as const;

// Funções auxiliares para gerenciar colunas de Gems no localStorage
const saveGemsColumns = (columns: Set<GemsColumnType>) => {
  try {
    localStorage.setItem(STORAGE_KEY_GEMS_COLUMNS, JSON.stringify(Array.from(columns)));
  } catch (e) {
    console.error("Erro ao salvar colunas de Gems no localStorage:", e);
  }
};

const loadGemsColumns = (): Set<GemsColumnType> => {
  const defaultCols = new Set<GemsColumnType>(["hook", "website_ctr", "ctr", "page_conv", "hold_rate", "cpr"]);
  if (typeof window === "undefined") return defaultCols;
  try {
    const saved = localStorage.getItem(STORAGE_KEY_GEMS_COLUMNS);
    if (!saved) return defaultCols;
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((col) => ["hook", "website_ctr", "ctr", "page_conv", "hold_rate", "cpr"].includes(col));
      return valid.length > 0 ? new Set<GemsColumnType>(valid as GemsColumnType[]) : defaultCols;
    }
    return defaultCols;
  } catch (e) {
    console.error("Erro ao carregar colunas de Gems do localStorage:", e);
    return defaultCols;
  }
};

export default function InsightsPage() {
  const { isClient, authStatus, onboardingStatus, isAuthorized } = useAppAuthReady();
  const { isLoading: packsLoading } = usePacksLoading();

  // ── Pipeline compartilhado (fetch + validação + médias) ───────────────────
  // filterToSelectedPacks=false: Insights valida sobre todos os dados do servidor,
  // não filtra por pack client-side (usa pack_ids no request para escopo do servidor).
  const {
    serverData,
    serverAverages: averages,
    validatedAds,
    actionType,
    actionTypeOptions,
    selectedPackIds,
    dateRange,
    packsClient,
    validationCriteria,
    isLoading: loading,
  } = useAdPerformancePipeline({ filterToSelectedPacks: false });

  // ── Diagnóstico do dia (aba "Diagnóstico") ──────────────────────────────────
  // Mesmo motor do /plano: serverData (todos os ads = média global) + usePackDiagnostic.
  const { targetCprByActionType, diagnosticCostMetric, savePreferences } = useUserPreferences();
  const diagnostic = usePackDiagnostic({
    ads: (serverData ?? []) as RankingsItem[],
    actionType: actionType ?? "",
    selectedPackIds,
    dateRange: { start: dateRange.start ?? "", end: dateRange.end ?? "" },
    targetOverride: diagnosticCostMetric,
  });
  const [showFullDiagnostic, setShowFullDiagnostic] = useState(false);
  const currentTargetCpr = actionType ? targetCprByActionType?.[actionType] : undefined;
  const handleSelectDiagnosticMetric = (m: DiagnosticTarget) => {
    void savePreferences({ diagnosticCostMetric: m });
  };

  const [activeGemsColumns, setActiveGemsColumns] = useState<Set<GemsColumnType>>(() => loadGemsColumns());

  const [selectedAd, setSelectedAd] = useState<RankingsItem | null>(null);
  const [openInVideoTab, setOpenInVideoTab] = useState(false);

  const [activeTab, setActiveTab] = useState<string>(() => {
    if (typeof window === "undefined") return "diagnostico";
    try {
      return localStorage.getItem(STORAGE_KEY_ACTIVE_TAB) || "diagnostico";
    } catch (e) {
      return "diagnostico";
    }
  });

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleToggleGemsColumn = (columnId: GemsColumnType) => {
    const newColumns = new Set(activeGemsColumns);
    if (newColumns.has(columnId)) {
      newColumns.delete(columnId);
    } else {
      newColumns.add(columnId);
    }
    setActiveGemsColumns(newColumns);
    saveGemsColumns(newColumns);
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    try {
      localStorage.setItem(STORAGE_KEY_ACTIVE_TAB, value);
    } catch (e) {
      console.error("Erro ao salvar activeTab no localStorage:", e);
    }
  };

  // ── Gems top items ─────────────────────────────────────────────────────────
  const topHookFromGems: GemsTopItem[] = useMemo(() => {
    if (!validatedAds || validatedAds.length === 0 || !actionType) return [];
    return computeTopMetric(validatedAds as RankingsItem[], "hook", actionType, 5);
  }, [validatedAds, actionType]);

  const topWebsiteCtrFromGems: GemsTopItem[] = useMemo(() => {
    if (!validatedAds || validatedAds.length === 0 || !actionType) return [];
    return computeTopMetric(validatedAds as RankingsItem[], "website_ctr", actionType, 5);
  }, [validatedAds, actionType]);

  const topCtrFromGems: GemsTopItem[] = useMemo(() => {
    if (!validatedAds || validatedAds.length === 0 || !actionType) return [];
    return computeTopMetric(validatedAds as RankingsItem[], "ctr", actionType, 5);
  }, [validatedAds, actionType]);

  const topPageConvFromGems: GemsTopItem[] = useMemo(() => {
    if (!validatedAds || validatedAds.length === 0 || !actionType) return [];
    return computeTopMetric(validatedAds as RankingsItem[], "page_conv", actionType, 5);
  }, [validatedAds, actionType]);

  const topHoldRateFromGems: GemsTopItem[] = useMemo(() => {
    if (!validatedAds || validatedAds.length === 0 || !actionType) return [];
    return computeTopMetric(validatedAds as RankingsItem[], "hold_rate", actionType, 5);
  }, [validatedAds, actionType]);

  // ── Opportunity scores ─────────────────────────────────────────────────────
  const findAdFromOpportunityRow = useMemo(() => {
    return (row: OpportunityRow): RankingsItem | null => {
      if (!serverData || serverData.length === 0) return null;
      if (row.ad_id) {
        const found = serverData.find((ad: any) => String(ad.ad_id || "").trim() === String(row.ad_id || "").trim());
        if (found) return found as RankingsItem;
      }
      if (row.ad_name) {
        const found = serverData.find((ad: any) => String(ad.ad_name || "").trim() === String(row.ad_name || "").trim());
        if (found) return found as RankingsItem;
      }
      return null;
    };
  }, [serverData]);

  const handleOpportunityCardClick = (row: OpportunityRow, openVideo: boolean = false) => {
    const ad = findAdFromOpportunityRow(row);
    if (ad) {
      setSelectedAd(ad);
      setOpenInVideoTab(openVideo);
    }
  };

  const { mqlLeadscoreMin } = useMqlLeadscore();

  // Julgamento (oportunidades) roda SOBRE os validados, mas compara contra a média
  // GLOBAL ponderada (averages = serverAverages, todos os ads = Meta) — única média do app.
  const opportunityRows = useMemo(() => {
    if (!validatedAds || validatedAds.length === 0 || !averages) return [];
    if (loading) return [];
    const spendTotal = validatedAds.reduce((s: number, a: any) => s + Number(a.spend || 0), 0);
    return computeOpportunityScores({ ads: validatedAds, averages, actionType, spendTotal, mqlLeadscoreMin, limit: 10 });
  }, [validatedAds, averages, actionType, loading, mqlLeadscoreMin]);

  const globalMetricRanks = useMemo(() => {
    if (!serverData || serverData.length === 0) return createEmptyMetricRanks();
    const criteriaToUse = validationCriteria && validationCriteria.length > 0 ? validationCriteria : undefined;
    return calculateGlobalMetricRanks(serverData, { validationCriteria: criteriaToUse, actionType, filterValidOnly: true, mqlLeadscoreMin });
  }, [serverData, validationCriteria, actionType, mqlLeadscoreMin]);

  const headerConfig = useMemo(() => {
    return TAB_HEADER_CONFIG[activeTab as keyof typeof TAB_HEADER_CONFIG] ?? TAB_HEADER_CONFIG.opportunities;
  }, [activeTab]);

  // ── Loading states ─────────────────────────────────────────────────────────
  if (!isClient) {
    return <InsightsPageSkeleton />;
  }

  if (authStatus !== "authorized") {
    return <InsightsPageSkeleton />;
  }

  if (onboardingStatus === "requires_onboarding") {
    return <InsightsPageSkeleton />;
  }

  const hasData = serverData && serverData.length > 0;
  // Inclui a hidratação/carregamento dos packs no loading: sem isso, na janela em que
  // os packs ainda não chegaram, `loading` é false e `!hasData` renderia um empty state
  // prematuro (pisca "Sem dados" → skeleton → dados).
  const isLoadingData = loading || !packsClient || packsLoading;

  // ── Skeletons ──────────────────────────────────────────────────────────────
  const OpportunitiesSkeleton = () => <StateSkeleton variant="widget" rows={3} />;

  const InsightsSkeleton = () => <StateSkeleton variant="page" rows={4} />;

  const GemsSkeleton = () => <StateSkeleton variant="page" rows={6} />;

  return (
    <PageContainer
      variant="analytics"
      title={headerConfig.title}
      description={headerConfig.description}
      actions={
        activeTab === "gems" ? (
          <PageActions>
            <GemsColumnFilter activeColumns={activeGemsColumns} onToggleColumn={handleToggleGemsColumn} />
          </PageActions>
        ) : undefined
      }
    >
      <AnalyticsWorkspace>
        <TabbedWorkspace
          value={activeTab}
          onValueChange={handleTabChange}
          variant="with-icons"
          showTooltips={true}
          tabs={[
            { value: "diagnostico", label: "Diagnóstico", icon: IconActivity, tooltip: TAB_TITLES.diagnostico },
            { value: "opportunities", label: "Oportunidades", icon: IconStarFilled, tooltip: TAB_TITLES.opportunities },
            { value: "insights", label: "Insights", icon: IconSparkles, tooltip: TAB_TITLES.insights },
            { value: "gems", label: "Gems", icon: IconDiamond, tooltip: TAB_TITLES.gems },
          ]}
        >
        {/* Tab Diagnóstico — o que mudou hoje no conjunto (mesmo motor do /plano) */}
        <TabbedContentItem value="diagnostico" variant="with-icons">
          {isLoadingData ? (
            <StateSkeleton variant="page" rows={4} />
          ) : !hasData ? (
            <StatePanel kind="empty" message="Sem dados no período selecionado. Ajuste os filtros acima para buscar em outro período." framed={false} fill />
          ) : !actionType ? (
            <StatePanel kind="empty" message="Selecione um evento de conversão no topo para ver o diagnóstico do dia." framed={false} fill />
          ) : (
            <div className="flex flex-col gap-4 overflow-visible">
              <DayComparisonBlock
                diagnostic={diagnostic}
                actionType={actionType}
                onSelectMetric={handleSelectDiagnosticMetric}
                benchmarkAverages={averages}
                actionTypeOptions={actionTypeOptions}
                selectedPackIds={selectedPackIds}
                dateRange={{ start: dateRange.start ?? "", end: dateRange.end ?? "" }}
                targetCpr={currentTargetCpr}
              />
              {diagnostic.snaps.length > 0 && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowFullDiagnostic((v) => !v)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showFullDiagnostic ? "fechar diagnóstico completo ↑" : "ver diagnóstico completo ↓"}
                  </button>
                </div>
              )}
              {showFullDiagnostic && diagnostic.snaps.length > 0 && (
                <PackDiagnosticPanel
                  snaps={diagnostic.snaps}
                  decomposition={diagnostic.decomposition}
                  trendLines={diagnostic.trendLines}
                  budgetShareData={diagnostic.budgetShareData}
                  target={diagnostic.target}
                  adKeyToName={diagnostic.adKeyToName}
                  adMap={diagnostic.adMap}
                  comparisonLabel={diagnostic.comparisonLabel}
                  benchmarkAverages={averages}
                  actionType={actionType}
                  actionTypeOptions={actionTypeOptions}
                  selectedPackIds={selectedPackIds}
                  dateRange={{ start: dateRange.start ?? "", end: dateRange.end ?? "" }}
                />
              )}
            </div>
          )}
        </TabbedContentItem>

        {/* Tab Oportunidades */}
        <TabbedContentItem value="opportunities" variant="with-icons">
          {isLoadingData ? (
            <OpportunitiesSkeleton />
          ) : !hasData ? (
            <StatePanel kind="empty" message="Sem dados no período selecionado. Ajuste os filtros acima para buscar em outro período." framed={false} fill />
          ) : (
            <div>
              <OpportunityWidget rows={opportunityRows} averages={averages} actionType={actionType} onAdClick={handleOpportunityCardClick} globalMetricRanks={globalMetricRanks} gemsTopHook={topHookFromGems} gemsTopWebsiteCtr={topWebsiteCtrFromGems} gemsTopCtr={topCtrFromGems} gemsTopPageConv={topPageConvFromGems} gemsTopHoldRate={topHoldRateFromGems} />
            </div>
          )}
        </TabbedContentItem>

        {/* Tab Insights */}
        <TabbedContentItem value="insights" variant="with-icons">
          {isLoadingData ? (
            <InsightsSkeleton />
          ) : !hasData ? (
            <StatePanel kind="empty" message="Sem dados no período selecionado. Ajuste os filtros acima para buscar em outro período." framed={false} fill />
          ) : validationCriteria && validationCriteria.length > 0 && !loading && averages ? (
            <InsightsKanbanWidget ads={validatedAds} averages={averages} actionType={actionType} validationCriteria={validationCriteria} dateStart={dateRange.start} dateStop={dateRange.end} availableConversionTypes={actionTypeOptions} packIds={Array.from(selectedPackIds)} />
          ) : (
            <StatePanel kind="empty" message="Configure critérios de validação nas configurações para ver insights." framed={false} fill />
          )}
        </TabbedContentItem>

        {/* Tab Gems */}
        <TabbedContentItem value="gems" variant="with-icons">
          {isLoadingData ? (
            <GemsSkeleton />
          ) : !hasData ? (
            <StatePanel kind="empty" message="Sem dados no período selecionado. Ajuste os filtros acima para buscar em outro período." framed={false} fill />
          ) : validationCriteria && validationCriteria.length > 0 && !loading && averages ? (
            <GemsWidget ads={validatedAds} averages={averages} actionType={actionType} validationCriteria={validationCriteria} limit={5} dateStart={dateRange.start} dateStop={dateRange.end} availableConversionTypes={actionTypeOptions} activeColumns={activeGemsColumns} packIds={Array.from(selectedPackIds)} />
          ) : (
            <StatePanel kind="empty" message="Configure critérios de validação nas configurações para ver gems." framed={false} fill />
          )}
        </TabbedContentItem>
        </TabbedWorkspace>
      </AnalyticsWorkspace>

      {/* Modal com detalhes do anúncio */}
      <AppDialog
        isOpen={!!selectedAd}
        onClose={() => { setSelectedAd(null); setOpenInVideoTab(false); }}
        title="Detalhes do anúncio"
        size="5xl"
        padding="md"
        className="flex h-[90dvh] min-h-0 flex-col overflow-hidden"
        bodyClassName="flex min-h-0 flex-1 flex-col"
      >
        {selectedAd && (
          <AdDetailsDialog
            ad={selectedAd}
            groupByAdName={true}
            dateStart={dateRange.start}
            dateStop={dateRange.end}
            actionType={actionType}
            packIds={Array.from(selectedPackIds)}
            availableConversionTypes={actionTypeOptions}
            initialTab="video"
            averages={
              averages
                ? {
                    hook: averages.hook ?? null,
                    hold_rate: averages.hold_rate ?? null,
                    video_watched_p50: averages.video_watched_p50 ?? null,
                    scroll_stop: averages.scroll_stop ?? null,
                    ctr: averages.ctr ?? null,
                    website_ctr: averages.website_ctr ?? null,
                    connect_rate: averages.connect_rate ?? null,
                    cpm: averages.cpm ?? null,
                    cpr: actionType && averages.per_action_type?.[actionType] && typeof averages.per_action_type[actionType].cpr === "number" ? averages.per_action_type[actionType].cpr : null,
                    page_conv: actionType && averages.per_action_type?.[actionType] && typeof averages.per_action_type[actionType].page_conv === "number" ? averages.per_action_type[actionType].page_conv : null,
                  }
                : undefined
            }
          />
        )}
      </AppDialog>
    </PageContainer>
  );
}

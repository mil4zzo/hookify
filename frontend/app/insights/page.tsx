"use client";

import { useState, useEffect, useMemo } from "react";
import { LoadingState, EmptyState } from "@/components/common/States";
import { usePacksAds } from "@/lib/hooks/usePacksAds";
import { OpportunityWidget } from "@/components/insights/OpportunityWidget";
import { calculateGlobalMetricRanks, createEmptyMetricRanks } from "@/lib/utils/metricRankings";
import { GemsWidget } from "@/components/insights/GemsWidget";
import { GemsColumnFilter, GemsColumnType } from "@/components/common/GemsColumnFilter";
import { InsightsKanbanWidget } from "@/components/insights/InsightsKanbanWidget";
import { api } from "@/lib/api/endpoints";
import { AdPerformanceRequest, AdPerformanceResponse, RankingsItem } from "@/lib/api/schemas";
import { computeOpportunityScores, OpportunityRow } from "@/lib/utils/opportunity";
import { useValidationCriteria } from "@/lib/hooks/useValidationCriteria";
import { evaluateValidationCriteria, AdMetricsData } from "@/lib/utils/validateAdCriteria";
import { computeValidatedAveragesFromAdPerformance } from "@/lib/utils/validatedAverages";
import { ActionTypeFilter } from "@/components/common/ActionTypeFilter";
import { IconSparkles, IconDiamond, IconSunFilled, IconStarFilled } from "@tabler/icons-react";
import { Modal } from "@/components/common/Modal";
import { AdDetailsDialog } from "@/components/ads/AdDetailsDialog";
import { useMqlLeadscore } from "@/lib/hooks/useMqlLeadscore";
import { PageContainer } from "@/components/common/PageContainer";
import { PageActions } from "@/components/common/PageActions";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";
import { computeTopMetric, GemsTopItem } from "@/lib/utils/gemsTopMetrics";
import { useAppAuthReady } from "@/lib/hooks/useAppAuthReady";
import { Skeleton } from "@/components/ui/skeleton";
import { HookifyWidget } from "@/components/common/HookifyWidget";
import { TabbedContent, TabbedContentItem } from "@/components/common/TabbedContent";
import { useFilters } from "@/lib/hooks/useFilters";

// Chaves específicas do Insights
const STORAGE_KEY_GROUP_BY_PACKS = "hookify-insights-group-by-packs";
const STORAGE_KEY_PACK_ACTION_TYPES = "hookify-insights-pack-action-types";
const STORAGE_KEY_GEMS_COLUMNS = "hookify-insights-gems-columns";
const STORAGE_KEY_ACTIVE_TAB = "hookify-insights-active-tab";

// Classe padronizada para títulos das tabs
const TAB_TITLE_CLASS = "text-xl font-normal";

// Títulos das tabs para tooltips
const TAB_TITLES = {
  opportunities: "Melhorias para maximizar seus lucros",
  insights: "Melhorias pontuais por métrica",
  gems: "Os melhores de cada métrica",
} as const;

// Configuração do header para cada tab
const TAB_HEADER_CONFIG = {
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

  // ── Global filter state ────────────────────────────────────────────────────
  const {
    selectedPackIds,
    effectiveDateRange: dateRange,
    actionType,
    actionTypeOptions,
    setActionTypeOptions,
    packs,
    packsClient,
  } = useFilters();

  // ── Page-specific state ────────────────────────────────────────────────────
  const [serverData, setServerData] = useState<any[] | null>(null);
  const [averages, setAverages] = useState<any | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  const [groupByPacks, setGroupByPacks] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(STORAGE_KEY_GROUP_BY_PACKS) === "true";
    } catch (e) {
      return false;
    }
  });

  const [activeGemsColumns, setActiveGemsColumns] = useState<Set<GemsColumnType>>(() => loadGemsColumns());

  const [packActionTypes, setPackActionTypes] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = localStorage.getItem(STORAGE_KEY_PACK_ACTION_TYPES);
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });

  const [selectedAd, setSelectedAd] = useState<RankingsItem | null>(null);
  const [openInVideoTab, setOpenInVideoTab] = useState(false);

  const [activeTab, setActiveTab] = useState<string>(() => {
    if (typeof window === "undefined") return "opportunities";
    try {
      return localStorage.getItem(STORAGE_KEY_ACTIVE_TAB) || "opportunities";
    } catch (e) {
      return "opportunities";
    }
  });

  // ── Data fetch ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthorized) return;

    const start = dateRange.start;
    const end = dateRange.end;
    if (!start || !end) return;

    const req: AdPerformanceRequest = {
      date_start: start,
      date_stop: end,
      group_by: "ad_name",
      limit: 1000,
      filters: {},
      pack_ids: Array.from(selectedPackIds),
    };

    setLoading(true);
    api.analytics
      .getAdPerformance(req)
      .then((res: AdPerformanceResponse) => {
        setServerData(res.data || []);
        setActionTypeOptions(res.available_conversion_types || []);
        setAverages(res.averages);
      })
      .catch((err) => {
        console.error("Erro ao buscar insights:", err);
        setServerData([]);
      })
      .finally(() => setLoading(false));
  }, [isAuthorized, dateRange.start, dateRange.end, selectedPackIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pack ads (for pack-to-ad mapping) ─────────────────────────────────────
  const selectedPacks = packs.filter((p) => selectedPackIds.has(p.id));
  const { packsAdsMap } = usePacksAds(selectedPacks);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleToggleGroupByPacks = (checked: boolean) => {
    setGroupByPacks(checked);
    try {
      localStorage.setItem(STORAGE_KEY_GROUP_BY_PACKS, checked.toString());
    } catch (e) {
      console.error("Erro ao salvar groupByPacks no localStorage:", e);
    }
  };

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

  // ── Pack-to-ad lookup ──────────────────────────────────────────────────────
  const getAdPackId = useMemo(() => {
    return (ad: any): string | null => {
      if (selectedPackIds.size === 0) return null;
      if (selectedPacks.length === 0) return null;

      for (const pack of selectedPacks) {
        const packAds = packsAdsMap.get(pack.id) || [];
        if (packAds.length === 0) continue;

        const matches = packAds.some((packAd: any) => {
          const adId = ad.ad_id;
          const adName = ad.ad_name;
          const adAccountId = ad.account_id;
          const packAdId = packAd.ad_id;
          const packAdName = packAd.ad_name;
          const packAdAccountId = packAd.account_id;

          if (adAccountId && packAdAccountId) {
            if (String(adAccountId).trim() !== String(packAdAccountId).trim()) return false;
          }
          if (adId && packAdId && String(adId).trim() === String(packAdId).trim()) return true;
          if (adName && packAdName && String(adName).trim() === String(packAdName).trim()) return true;
          return false;
        });

        if (matches) return pack.id;
      }
      return null;
    };
  }, [selectedPackIds, selectedPacks, packsAdsMap]);

  // ── Validation ─────────────────────────────────────────────────────────────
  const { criteria: validationCriteria, isLoading: isLoadingCriteria } = useValidationCriteria();

  const [validatedAds, validatedAverages] = useMemo(() => {
    if (!serverData || serverData.length === 0) return [[], undefined] as [any[], any];

    if (!validationCriteria || validationCriteria.length === 0) {
      const avg = computeValidatedAveragesFromAdPerformance(serverData as any, actionType, actionTypeOptions);
      return [serverData, avg] as [any[], any];
    }

    const validated = serverData.filter((ad: any) => {
      const impressions = Number(ad.impressions || 0);
      const spend = Number(ad.spend || 0);
      const cpm = typeof ad.cpm === "number" && !Number.isNaN(ad.cpm) && isFinite(ad.cpm) ? ad.cpm : impressions > 0 ? (spend * 1000) / impressions : 0;
      const website_ctr = Number(ad.website_ctr || 0);
      const connect_rate = Number(ad.connect_rate || 0);
      const lpv = Number(ad.lpv || 0);
      const results = actionType ? Number(ad.conversions?.[actionType] || 0) : 0;
      const page_conv = lpv > 0 ? results / lpv : 0;
      const overall_conversion = website_ctr * connect_rate * page_conv;

      const metrics: AdMetricsData = {
        ad_name: ad.ad_name,
        ad_id: ad.ad_id,
        account_id: ad.account_id,
        impressions,
        spend,
        cpm,
        website_ctr,
        connect_rate,
        inline_link_clicks: Number(ad.inline_link_clicks || 0),
        clicks: Number(ad.clicks || 0),
        plays: Number(ad.plays || 0),
        hook: Number(ad.hook || 0),
        ctr: Number(ad.ctr || 0),
        page_conv,
        overall_conversion,
        conversions: ad.conversions || {},
      };
      return evaluateValidationCriteria(validationCriteria, metrics, "AND");
    });

    const avg = computeValidatedAveragesFromAdPerformance(validated as any, actionType, actionTypeOptions);
    return [validated, avg] as [any[], any];
  }, [serverData, validationCriteria, actionType, actionTypeOptions]);

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

  const opportunityRows = useMemo(() => {
    if (!validatedAds || validatedAds.length === 0 || !validatedAverages) return [];
    if (isLoadingCriteria) return [];
    const spendTotal = validatedAds.reduce((s: number, a: any) => s + Number(a.spend || 0), 0);
    return computeOpportunityScores({ ads: validatedAds, averages: validatedAverages, actionType, spendTotal, mqlLeadscoreMin, limit: 10 });
  }, [validatedAds, validatedAverages, actionType, isLoadingCriteria, mqlLeadscoreMin]);

  const globalMetricRanks = useMemo(() => {
    if (!serverData || serverData.length === 0) return createEmptyMetricRanks();
    const criteriaToUse = validationCriteria && validationCriteria.length > 0 ? validationCriteria : undefined;
    return calculateGlobalMetricRanks(serverData, { validationCriteria: criteriaToUse, actionType, filterValidOnly: true, mqlLeadscoreMin });
  }, [serverData, validationCriteria, actionType, mqlLeadscoreMin]);

  const opportunityRowsByPack = useMemo(() => {
    if (!groupByPacks || !validatedAds || validatedAds.length === 0 || !validatedAverages) return null;
    if (isLoadingCriteria) return null;

    const adsByPack = new Map<string, any[]>();
    validatedAds.forEach((ad: any) => {
      const packId = getAdPackId(ad);
      if (packId) {
        const packAds = adsByPack.get(packId) || [];
        packAds.push(ad);
        adsByPack.set(packId, packAds);
      }
    });

    const rowsByPack = new Map<string, any[]>();
    adsByPack.forEach((packAds, packId) => {
      if (packAds.length === 0) return;
      const spendTotal = packAds.reduce((s: number, a: any) => s + Number(a.spend || 0), 0);
      const packActionType = packActionTypes[packId] || actionType;
      const rows = computeOpportunityScores({ ads: packAds, averages: validatedAverages, actionType: packActionType, spendTotal, limit: 10 });
      if (rows.length > 0) rowsByPack.set(packId, rows);
    });

    return rowsByPack;
  }, [groupByPacks, serverData, averages, actionType, validationCriteria, isLoadingCriteria, getAdPackId, packActionTypes]);

  const headerConfig = useMemo(() => {
    return TAB_HEADER_CONFIG[activeTab as keyof typeof TAB_HEADER_CONFIG] ?? TAB_HEADER_CONFIG.opportunities;
  }, [activeTab]);

  // ── Loading states ─────────────────────────────────────────────────────────
  if (!isClient) {
    return <div><LoadingState label="Carregando..." /></div>;
  }

  if (authStatus !== "authorized") {
    return <div><LoadingState label="Redirecionando para login..." /></div>;
  }

  if (onboardingStatus === "requires_onboarding") {
    return <div><LoadingState label="Redirecionando para configuração inicial..." /></div>;
  }

  const hasData = serverData && serverData.length > 0;
  const isInitialLoad = serverData === null && loading;
  const isLoadingData = loading;

  // ── Skeletons ──────────────────────────────────────────────────────────────
  const OpportunitiesSkeleton = () => (
    <div className="space-y-6">
      <div className="relative">
        <div className="flex gap-4 overflow-hidden">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-80 w-80 flex-shrink-0 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );

  const InsightsSkeleton = () => (
    <div className="space-y-6">
      <div className="flex gap-4 overflow-x-auto">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex-shrink-0 w-80 space-y-4">
            <Skeleton className="h-12 w-full rounded-md" />
            <div className="space-y-2">
              {[1, 2, 3].map((j) => <Skeleton key={j} className="h-32 w-full rounded-md" />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const GemsSkeleton = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-4 mb-4">
        <Skeleton className="h-10 w-48 rounded-md" />
      </div>
      <div className="flex gap-4 overflow-x-auto">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex-shrink-0 w-80 space-y-4">
            <Skeleton className="h-12 w-full rounded-md" />
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((j) => <Skeleton key={j} className="h-32 w-full rounded-md" />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <PageContainer
      title={headerConfig.title}
      description={headerConfig.description}
      actions={
        activeTab === "opportunities" ? (
          <PageActions>
            <ToggleSwitch
              id="group-by-packs"
              checked={groupByPacks}
              onCheckedChange={handleToggleGroupByPacks}
              labelLeft="Global"
              labelRight="Por Pack"
              variant="minimal"
            />
          </PageActions>
        ) : undefined
      }
    >
      {/* Tabs */}
      <TabbedContent
        value={activeTab}
        onValueChange={handleTabChange}
        variant="with-icons"
        showTooltips={true}
        separatorAfterTabs={true}
        tabs={[
          { value: "opportunities", label: "Oportunidades", icon: IconStarFilled, tooltip: TAB_TITLES.opportunities },
          { value: "insights", label: "Insights", icon: IconSparkles, tooltip: TAB_TITLES.insights },
          { value: "gems", label: "Gems", icon: IconDiamond, tooltip: TAB_TITLES.gems },
        ]}
      >
        {/* Tab Oportunidades */}
        <TabbedContentItem value="opportunities" variant="with-icons">
          <HookifyWidget
            title={TAB_TITLES.opportunities}
            titleClassName={TAB_TITLE_CLASS}
            isLoading={isLoadingData || isInitialLoad}
            isEmpty={!hasData}
            emptyMessage="Sem dados no período selecionado. Ajuste os filtros acima para buscar em outro período."
            skeleton={<OpportunitiesSkeleton />}
            contentSpacing="space-y-6"
          >
            {groupByPacks && opportunityRowsByPack ? (
              Array.from(opportunityRowsByPack.entries()).length > 0 ? (
                Array.from(opportunityRowsByPack.entries())
                  .filter(([packId]) => packs.find((p) => p.id === packId))
                  .map(([packId, rows]) => {
                    const pack = packs.find((p) => p.id === packId);
                    if (!pack) return null;
                    const packActionType = packActionTypes[packId] || actionType;

                    const handlePackActionTypeChange = (value: string) => {
                      const newPackActionTypes = { ...packActionTypes, [packId]: value };
                      setPackActionTypes(newPackActionTypes);
                      try {
                        localStorage.setItem(STORAGE_KEY_PACK_ACTION_TYPES, JSON.stringify(newPackActionTypes));
                      } catch (e) {
                        console.error("Erro ao salvar packActionTypes no localStorage:", e);
                      }
                    };

                    const formatDate = (dateStr: string): string => {
                      if (!dateStr) return "";
                      const [year, month, day] = dateStr.split("-");
                      return `${day}/${month}/${year}`;
                    };

                    return (
                      <div key={packId} className="space-y-2">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex-1 flex flex-row gap-4">
                            <h2 className="text-xl font-semibold">{pack.name}</h2>
                            {pack.date_start && pack.date_stop && (
                              <p className="text-sm text-muted-foreground mt-1">
                                {formatDate(pack.date_start)} - {formatDate(pack.date_stop)}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <label className="text-sm font-medium text-foreground whitespace-nowrap">Evento de Conversão:</label>
                            <div style={{ width: "200px" }}>
                              <ActionTypeFilter label="" value={packActionType} onChange={handlePackActionTypeChange} options={actionTypeOptions} className="w-full" />
                            </div>
                          </div>
                        </div>
                        <OpportunityWidget rows={rows} averages={validatedAverages} actionType={packActionType} onAdClick={handleOpportunityCardClick} globalMetricRanks={globalMetricRanks} gemsTopHook={topHookFromGems} gemsTopWebsiteCtr={topWebsiteCtrFromGems} gemsTopCtr={topCtrFromGems} gemsTopPageConv={topPageConvFromGems} gemsTopHoldRate={topHoldRateFromGems} />
                      </div>
                    );
                  })
              ) : (
                <div>
                  <OpportunityWidget rows={[]} averages={validatedAverages} actionType={actionType} onAdClick={handleOpportunityCardClick} globalMetricRanks={globalMetricRanks} gemsTopHook={topHookFromGems} gemsTopWebsiteCtr={topWebsiteCtrFromGems} gemsTopCtr={topCtrFromGems} gemsTopPageConv={topPageConvFromGems} gemsTopHoldRate={topHoldRateFromGems} />
                </div>
              )
            ) : (
              <div>
                <OpportunityWidget rows={opportunityRows} averages={validatedAverages} actionType={actionType} onAdClick={handleOpportunityCardClick} globalMetricRanks={globalMetricRanks} gemsTopHook={topHookFromGems} gemsTopWebsiteCtr={topWebsiteCtrFromGems} gemsTopCtr={topCtrFromGems} gemsTopPageConv={topPageConvFromGems} gemsTopHoldRate={topHoldRateFromGems} />
              </div>
            )}
          </HookifyWidget>
        </TabbedContentItem>

        {/* Tab Insights */}
        <TabbedContentItem value="insights" variant="with-icons">
          <HookifyWidget
            title={TAB_TITLES.insights}
            titleClassName={TAB_TITLE_CLASS}
            isLoading={isLoadingData || isInitialLoad}
            isEmpty={!hasData}
            emptyMessage="Sem dados no período selecionado. Ajuste os filtros acima para buscar em outro período."
            skeleton={<InsightsSkeleton />}
            contentSpacing="space-y-6"
          >
            {validationCriteria && validationCriteria.length > 0 && !isLoadingCriteria && validatedAverages ? (
              <InsightsKanbanWidget ads={validatedAds} averages={validatedAverages} actionType={actionType} validationCriteria={validationCriteria} dateStart={dateRange.start} dateStop={dateRange.end} availableConversionTypes={actionTypeOptions} />
            ) : (
              <div className="py-12">
                <EmptyState message="Configure critérios de validação nas configurações para ver insights." />
              </div>
            )}
          </HookifyWidget>
        </TabbedContentItem>

        {/* Tab Gems */}
        <TabbedContentItem value="gems" variant="with-icons">
          <HookifyWidget
            title={TAB_TITLES.gems}
            titleClassName={TAB_TITLE_CLASS}
            isLoading={isLoadingData || isInitialLoad}
            isEmpty={!hasData}
            emptyMessage="Sem dados no período selecionado. Ajuste os filtros acima para buscar em outro período."
            skeleton={<GemsSkeleton />}
            headerActions={<GemsColumnFilter activeColumns={activeGemsColumns} onToggleColumn={handleToggleGemsColumn} />}
            contentSpacing="space-y-6"
          >
            {validationCriteria && validationCriteria.length > 0 && !isLoadingCriteria && validatedAverages ? (
              <GemsWidget ads={validatedAds} averages={validatedAverages} actionType={actionType} validationCriteria={validationCriteria} limit={5} dateStart={dateRange.start} dateStop={dateRange.end} availableConversionTypes={actionTypeOptions} activeColumns={activeGemsColumns} />
            ) : (
              <div className="py-12">
                <EmptyState message="Configure critérios de validação nas configurações para ver gems." />
              </div>
            )}
          </HookifyWidget>
        </TabbedContentItem>
      </TabbedContent>

      {/* Modal com detalhes do anúncio */}
      <Modal
        isOpen={!!selectedAd}
        onClose={() => { setSelectedAd(null); setOpenInVideoTab(false); }}
        size="5xl"
        padding="md"
        className="h-[90dvh] min-h-0"
      >
        {selectedAd && (
          <AdDetailsDialog
            ad={selectedAd}
            groupByAdName={true}
            dateStart={dateRange.start}
            dateStop={dateRange.end}
            actionType={actionType}
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
      </Modal>
    </PageContainer>
  );
}

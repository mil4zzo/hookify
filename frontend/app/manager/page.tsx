"use client";

import { useMemo, useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { usePacksAds } from "@/lib/hooks/usePacksAds";
import { ManagerTable } from "@/components/manager/ManagerTable";
import { ManagerTableSkeleton } from "@/components/manager/ManagerTableSkeleton";
import { RankingsItem, RankingsRequest } from "@/lib/api/schemas";
import { useAdPerformance, useAdPerformanceSeries } from "@/lib/api/hooks";
import { useAppAuthReady } from "@/lib/hooks/useAppAuthReady";
import { PageContainer } from "@/components/common/PageContainer";
import { AnalyticsWorkspace } from "@/components/common/layout";
import { logger } from "@/lib/utils/logger";
import { toast } from "sonner";
import { useFilters } from "@/lib/hooks/useFilters";
import { useStatusFocusSync } from "@/lib/hooks/useStatusFocusSync";
import { usePacksLoading } from "@/components/layout/PacksLoader";
import { mapRankingRow, resolveGroupKey, type ManagerTab } from "@/lib/utils/mapRankingRow";

type ManagerRow = RankingsItem & { series_loading?: boolean };

const GROUP_BY_BY_TAB: Record<ManagerTab, "ad_name" | "ad_id" | "adset_id" | "campaign_id"> = {
  "por-anuncio": "ad_name",
  individual:    "ad_id",
  "por-conjunto": "adset_id",
  "por-campanha": "campaign_id",
};

function ManagerPageFallback() {
  // Mesmos title/description/variant do render real para o cabeçalho não "piscar" ao
  // sair do fallback; ManagerTableSkeleton reproduz a cromo do ManagerTable em loading.
  return (
    <PageContainer
      title="Otimize"
      description="Dados de performance dos seus anúncios"
      variant="analytics"
      className="min-h-0"
    >
      <AnalyticsWorkspace>
        <ManagerTableSkeleton />
      </AnalyticsWorkspace>
    </PageContainer>
  );
}

function ManagerPageContent() {
  const searchParams = useSearchParams();
  const [activeManagerTab, setActiveManagerTab] = useState<ManagerTab>("por-anuncio");
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

  // Status fresco ao montar/voltar o foco: cobre mudanças feitas fora do Hookify.
  useStatusFocusSync();

  // Gate de readiness: só dispara as queries pesadas depois que os packs
  // estiverem carregados no store E o carregamento global ter terminado.
  // NÃO basta usar !packsLoading: useLoadPacks faz setIsLoading(false) na fase
  // pré-auth (não autenticado), então packsLoading já é false quando isAuthorized
  // flipa, abrindo o gate antes dos packs chegarem → dispara rankings com
  // packsLen=0 / hasSheetIntegration=false (leadscore=false), e re-dispara quando
  // os packs chegam (ver debug #3, run 3). Gatear em packs.length>0 garante que
  // hasSheetIntegration / effectiveDateRange já estão estáveis no 1º disparo.
  // !packsLoading cobre o caso de cache stale rehidratado (espera o fetch fresco).
  // Usuário sem packs: packsLen=0 → query não dispara; isLoading={loading||packsLoading}
  // já é false → mostra estado vazio (não skeleton infinito).
  const { isLoading: packsLoading } = usePacksLoading();
  const packsReady = packsClient && packs.length > 0 && !packsLoading;

  // ── Page-specific state ────────────────────────────────────────────────────
  const [showTrends, setShowTrends] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return localStorage.getItem("hookify-manager-show-trends") !== "false";
    } catch (e) {
      return true;
    }
  });

  // ── Search params → initial filters ───────────────────────────────────────
  const initialFilters = useMemo(() => {
    const filter = searchParams.get("filter");
    const value = searchParams.get("value");
    const tab = searchParams.get("tab");

    if (filter && value && tab) {
      const validTabMap: Record<string, ManagerTab> = {
        ad_id: "individual",
        ad_name: "por-anuncio",
        adset_name: "por-conjunto",
        campaign_name: "por-campanha",
      };
      const expectedTab = validTabMap[filter];
      if (expectedTab && expectedTab === tab) {
        return [{ id: filter, value }];
      }
    }
    return undefined;
  }, [searchParams]);

  // Sync active tab from URL deep-link — kept in useEffect so setState doesn't run during render
  useEffect(() => {
    const filter = searchParams.get("filter");
    const tab = searchParams.get("tab");
    if (!filter || !tab) return;
    const validTabMap: Record<string, ManagerTab> = {
      ad_id: "individual",
      ad_name: "por-anuncio",
      adset_name: "por-conjunto",
      campaign_name: "por-campanha",
    };
    const expectedTab = validTabMap[filter];
    if (expectedTab && expectedTab === tab) setActiveManagerTab(expectedTab);
  }, [searchParams]);

  // ── Derived from filters ───────────────────────────────────────────────────
  const endDate = useMemo(() => dateRange.end, [dateRange.end]);
  const activeGroupBy = GROUP_BY_BY_TAB[activeManagerTab];

  const hasSheetIntegration = useMemo(
    () => selectedPackIds.size > 0 && packs.some((p) => selectedPackIds.has(p.id) && !!p.sheet_integration),
    [packs, selectedPackIds],
  );

  // ── Series state ───────────────────────────────────────────────────────────
  const SERIES_WINDOW = 5;
  const MAX_SERIES_GROUP_KEYS = 100;

  const [visibleSeriesKeys, setVisibleSeriesKeys] = useState<Record<ManagerTab, string[]>>({
    individual: [],
    "por-anuncio": [],
    "por-conjunto": [],
    "por-campanha": [],
  });
  const visibleKeysDebounceRef = useRef<Partial<Record<ManagerTab, ReturnType<typeof setTimeout>>>>({});
  const [seriesCacheByTab, setSeriesCacheByTab] = useState<Record<ManagerTab, Record<string, any>>>({
    individual: {},
    "por-anuncio": {},
    "por-conjunto": {},
    "por-campanha": {},
  });

  const selectedPackIdsKey = useMemo(() => Array.from(selectedPackIds).sort().join("|"), [selectedPackIds]);

  const mergeSeriesCache = useCallback((tab: ManagerTab, incoming: any) => {
    if (!incoming || typeof incoming !== "object") return;
    const entries = Object.entries(incoming);
    if (entries.length === 0) return;
    setSeriesCacheByTab((prev) => {
      const current = prev[tab] || {};
      let changed = false;
      const nextTabMap: Record<string, any> = { ...current };
      for (const [k, v] of entries) {
        if (!k) continue;
        if (nextTabMap[k] !== v) {
          nextTabMap[k] = v;
          changed = true;
        }
      }
      if (!changed) return prev;
      return { ...prev, [tab]: nextTabMap };
    });
  }, []);

  const handleTabChange = useCallback((tab: ManagerTab) => {
    setActiveManagerTab(tab);
    window.scrollTo(0, 0);
  }, []);

  const handleVisibleGroupKeysChange = useCallback(
    (tab: ManagerTab, keys: string[]) => {
      const normalized = Array.from(new Set((keys || []).map(String).filter(Boolean))).slice(0, MAX_SERIES_GROUP_KEYS);
      const previousTimer = visibleKeysDebounceRef.current[tab];
      if (previousTimer) clearTimeout(previousTimer);
      visibleKeysDebounceRef.current[tab] = setTimeout(() => {
        setVisibleSeriesKeys((prev) => {
          const current = prev[tab] || [];
          if (current.length === normalized.length && current.every((k, i) => k === normalized[i])) return prev;
          return { ...prev, [tab]: normalized };
        });
      }, 120);
    },
    [],
  );

  // Cleanup debounce timers
  useEffect(() => {
    return () => {
      const timers = visibleKeysDebounceRef.current;
      (Object.keys(timers) as Array<ManagerTab>).forEach((tab) => {
        const timer = timers[tab];
        if (timer) clearTimeout(timer);
      });
    };
  }, []);

  // Clear series cache when filters change
  useEffect(() => {
    setSeriesCacheByTab({ individual: {}, "por-anuncio": {}, "por-conjunto": {}, "por-campanha": {} });
  }, [dateRange.start, dateRange.end, actionType, selectedPackIdsKey]);

  // Clear series cache when pack data is refreshed (ads changed, old series are stale)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleCacheUpdated = () => {
      setSeriesCacheByTab({ individual: {}, "por-anuncio": {}, "por-conjunto": {}, "por-campanha": {} });
    };
    window.addEventListener("hookify:pack-ads-cache-updated", handleCacheUpdated);
    return () => window.removeEventListener("hookify:pack-ads-cache-updated", handleCacheUpdated);
  }, []);

  // ── API request ────────────────────────────────────────────────────────────
  const managerRequest: RankingsRequest = useMemo(
    () => ({
      date_start: dateRange.start || "",
      date_stop: dateRange.end || "",
      group_by: activeGroupBy,
      action_type: actionType || undefined,
      limit: 10000,
      offset: 0,
      filters: {},
      pack_ids: Array.from(selectedPackIds),
      include_series: false,
      include_leadscore: hasSheetIntegration,
      series_window: SERIES_WINDOW,
      // available_conversion_types vem do metadado packs.conversion_types (union no refresh),
      // não do rankings — manter false pra não pagar o CTE extra que ~dobra o custo da query.
      include_available_conversion_types: false,
    }),
    [dateRange.start, dateRange.end, activeGroupBy, selectedPackIds, actionType, hasSheetIntegration],
  );

  const { data: managerData, isLoading: loading, error: managerError } = useAdPerformance(
    managerRequest,
    isAuthorized && packsReady && !!dateRange.start && !!dateRange.end,
  );

  // ── Derived from API data ──────────────────────────────────────────────────
  const serverData = managerData?.data || null;

  // Dropdown de conversion types = união dos packs selecionados (metadado materializado
  // packs.conversion_types, que já chega no payload de /packs carregado pelo PacksLoader).
  // Zero request, zero RPC no read-path — a lista é mantida via union incremental no
  // refresh (ver migration 081 / upsert_ad_metrics). Substitui o endpoint dedicado.
  const availableConversionTypes = useMemo(() => {
    if (selectedPackIds.size === 0 || packs.length === 0) return [] as string[];
    const set = new Set<string>();
    for (const p of packs) {
      if (!selectedPackIds.has(p.id)) continue;
      const types = (p as any).conversion_types;
      if (Array.isArray(types)) {
        for (const t of types) if (t) set.add(String(t));
      }
    }
    return Array.from(set).sort();
  }, [packs, selectedPackIds]);

  // Propagate available conversion types to global store.
  // Gatear em packsReady (não só selectedPackIds.size>0) é essencial: enquanto os packs
  // ainda carregam, availableConversionTypes é [] (mesmo com packPreferences rehidratado →
  // selectedPackIds.size>0). Chamar setActionTypeOptions([]) nessa janela apaga o actionType
  // persistido — que só é restaurado no reload — e o próximo fetch cai em options[0].
  // Com packsReady, a limpeza de actionType órfão só ocorre quando os packs de fato têm 0 tipos.
  useEffect(() => {
    if (packsReady && selectedPackIds.size > 0) {
      setActionTypeOptions(availableConversionTypes);
    }
  }, [packsReady, availableConversionTypes, selectedPackIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Series request ─────────────────────────────────────────────────────────
  const activeSeriesKeys = visibleSeriesKeys[activeManagerTab];

  const managerSeriesRequest = useMemo(
    () => ({
      date_start: dateRange.start || "",
      date_stop: dateRange.end || "",
      group_by: activeGroupBy,
      action_type: actionType || undefined,
      pack_ids: Array.from(selectedPackIds),
      filters: {},
      group_keys: activeSeriesKeys,
      window: SERIES_WINDOW,
    }),
    [dateRange.start, dateRange.end, activeGroupBy, actionType, selectedPackIds, activeSeriesKeys],
  );

  const shouldFetchSeries = showTrends && activeSeriesKeys.length > 0;
  const { data: managerSeriesData, isError: managerSeriesError } = useAdPerformanceSeries(managerSeriesRequest, shouldFetchSeries);

  useEffect(() => {
    mergeSeriesCache(activeManagerTab, (managerSeriesData as any)?.series_by_group);
  }, [managerSeriesData, mergeSeriesCache, activeManagerTab]);

  const activeSeriesCache = seriesCacheByTab[activeManagerTab];

  const pendingSeriesKeys = useMemo(() => {
    if (!showTrends || managerSeriesError) return new Set<string>();
    return new Set(activeSeriesKeys.filter((k) => !!k && !activeSeriesCache[k]));
  }, [activeSeriesKeys, activeSeriesCache, showTrends, managerSeriesError]);

  const seriesPriming = useMemo(
    () => showTrends && !managerSeriesError && activeSeriesKeys.length === 0,
    [showTrends, managerSeriesError, activeSeriesKeys],
  );

  // ── Data mapping ───────────────────────────────────────────────────────────
  const baseMapped = useMemo(() => {
    if (!serverData || serverData.length === 0) return [] as any[];
    return serverData.map((row: any): ManagerRow => mapRankingRow(row, actionType, activeManagerTab));
  }, [serverData, actionType, activeManagerTab]);

  const adsForTable = useMemo(() => {
    if (baseMapped.length === 0 || !showTrends) return baseMapped;
    let changed = false;
    const result = baseMapped.map((row) => {
      const groupKey = resolveGroupKey(row, activeManagerTab);
      const series = activeSeriesCache[groupKey] || null;
      const seriesLoading = !managerSeriesError && !series && (seriesPriming || pendingSeriesKeys.has(groupKey));
      if (row.series === series && row.series_loading === seriesLoading) return row;
      changed = true;
      return { ...row, series, series_loading: seriesLoading };
    });
    return changed ? result : baseMapped;
  }, [baseMapped, showTrends, activeSeriesCache, pendingSeriesKeys, seriesPriming, managerSeriesError, activeManagerTab]);

  // ── Averages ───────────────────────────────────────────────────────────────
  const activeServerAverages = (managerData as any)?.averages ?? null;

  useEffect(() => {
    const TOAST_ID = "manager-data-error";
    if (managerError) {
      logger.error("Erro ao buscar manager:", managerError);
      toast.error("Erro ao carregar dados. Tente reduzir o período ou selecionar menos packs.", {
        id: TOAST_ID,
        duration: Infinity,
      });
    } else {
      toast.dismiss(TOAST_ID);
    }
  }, [managerError]);

  // ── Pack ads for ManagerTable ──────────────────────────────────────────────
  const selectedPacks = packs.filter((p) => selectedPackIds.has(p.id));
  const { packsAdsMap } = usePacksAds(selectedPacks);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleShowTrendsChange = (checked: boolean) => {
    setShowTrends(checked);
    try {
      localStorage.setItem("hookify-manager-show-trends", checked.toString());
    } catch (e) {
      logger.error("Erro ao salvar showTrends no localStorage:", e);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!isClient) {
    return <ManagerPageFallback />;
  }

  if (authStatus !== "authorized") {
    return <ManagerPageFallback />;
  }

  if (onboardingStatus === "requires_onboarding") {
    return <ManagerPageFallback />;
  }

  return (
    <PageContainer
      title="Otimize"
      description="Dados de performance dos seus anúncios"
      variant="analytics"
      className="min-h-0"
    >
      <AnalyticsWorkspace>
        <ManagerTable
          ads={adsForTable}
          groupByAdName
          activeTab={activeManagerTab}
          onTabChange={handleTabChange}
          selectedPackIds={Array.from(selectedPackIds)}
          onVisibleGroupKeysChange={handleVisibleGroupKeysChange}
          actionType={actionType}
          endDate={endDate}
          dateStart={dateRange.start}
          dateStop={dateRange.end}
          availableConversionTypes={actionTypeOptions}
          showTrends={showTrends}
          onShowTrendsChange={handleShowTrendsChange}
          hasSheetIntegration={hasSheetIntegration}
          isLoading={loading || packsLoading}
          isError={!!managerError && !loading && packsReady}
          initialFilters={initialFilters}
          averagesOverride={(() => {
            // "Média do conjunto" (headers + dialog de detalhe) = média PONDERADA de TODOS
            // os ads do pack (backend `averages`) — a média real que bate com o Meta. Não usar
            // média dos validados: métrica é sempre sobre todos (princípio das métricas globais).
            const base = activeServerAverages || null;
            if (!base) return undefined;
            const per = (base as any).per_action_type || {};
            const perSel = actionType ? per[actionType] : undefined;
            const defaultPerSel = actionType && !perSel ? { cpr: 0, page_conv: 0, results: 0 } : perSel;
            return {
              hook: typeof base.hook === "number" ? base.hook : null,
              hold_rate: typeof base.hold_rate === "number" ? base.hold_rate : null,
              video_watched_p50: typeof base.video_watched_p50 === "number" ? base.video_watched_p50 : null,
              video_watched_p75: typeof base.video_watched_p75 === "number" ? base.video_watched_p75 : null,
              scroll_stop: typeof base.scroll_stop === "number" ? base.scroll_stop : null,
              ctr: typeof base.ctr === "number" ? base.ctr : null,
              website_ctr: typeof base.website_ctr === "number" ? base.website_ctr : null,
              connect_rate: typeof base.connect_rate === "number" ? base.connect_rate : null,
              cpm: typeof base.cpm === "number" ? base.cpm : null,
              cpr: defaultPerSel && typeof defaultPerSel.cpr === "number" ? defaultPerSel.cpr : null,
              page_conv: defaultPerSel && typeof defaultPerSel.page_conv === "number" ? defaultPerSel.page_conv : null,
            } as any;
          })()}
        />
      </AnalyticsWorkspace>
    </PageContainer>
  );
}

export default function ManagerPage() {
  return (
    <Suspense fallback={<ManagerPageFallback />}>
      <ManagerPageContent />
    </Suspense>
  );
}

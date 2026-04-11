"use client";

import { useMemo, useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { LoadingState, EmptyState } from "@/components/common/States";
import { usePacksAds } from "@/lib/hooks/usePacksAds";
import { ManagerTable } from "@/components/manager/ManagerTable";
import { Card, CardContent } from "@/components/ui/card";
import { RankingsItem, RankingsRequest } from "@/lib/api/schemas";
import { useAdPerformance, useAdPerformanceSeries } from "@/lib/api/hooks";
import { Skeleton } from "@/components/ui/skeleton";
import { useValidationCriteria } from "@/lib/hooks/useValidationCriteria";
import { useAppAuthReady } from "@/lib/hooks/useAppAuthReady";
import { evaluateValidationCriteria, AdMetricsData } from "@/lib/utils/validateAdCriteria";
import { computeValidatedAveragesFromAdPerformance } from "@/lib/utils/validatedAverages";
import { PageContainer } from "@/components/common/PageContainer";
import { PageActions } from "@/components/common/PageActions";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";
import { PageIcon } from "@/lib/utils/pageIcon";
import { logger } from "@/lib/utils/logger";
import { useFilters } from "@/lib/hooks/useFilters";

type ManagerRow = RankingsItem & { series_loading?: boolean };

function ManagerPageContent() {
  type ManagerTab = "individual" | "por-anuncio" | "por-conjunto" | "por-campanha";
  const searchParams = useSearchParams();
  const router = useRouter();
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

  // ── Page-specific state ────────────────────────────────────────────────────
  const [serverAverages, setServerAverages] = useState<any | null>(null);
  const { criteria: validationCriteria } = useValidationCriteria();
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
        if (activeManagerTab !== expectedTab) setActiveManagerTab(expectedTab);
        return [{ id: filter, value }];
      }
    }
    return undefined;
  }, [searchParams, activeManagerTab]);

  // ── Derived from filters ───────────────────────────────────────────────────
  const endDate = useMemo(() => dateRange.end, [dateRange.end]);

  const hasSheetIntegration = useMemo(
    () => selectedPackIds.size > 0 && packs.some((p) => selectedPackIds.has(p.id) && !!p.sheet_integration),
    [packs, selectedPackIds],
  );

  // ── Series state ───────────────────────────────────────────────────────────
  const SERIES_WINDOW = 5;
  const MAX_SERIES_GROUP_KEYS = 100;

  const [visibleSeriesKeys, setVisibleSeriesKeys] = useState<Record<"individual" | "por-anuncio" | "por-conjunto" | "por-campanha", string[]>>({
    individual: [],
    "por-anuncio": [],
    "por-conjunto": [],
    "por-campanha": [],
  });
  const visibleKeysDebounceRef = useRef<Partial<Record<"individual" | "por-anuncio" | "por-conjunto" | "por-campanha", ReturnType<typeof setTimeout>>>>({});
  const [seriesCacheByTab, setSeriesCacheByTab] = useState<Record<"individual" | "por-anuncio" | "por-conjunto" | "por-campanha", Record<string, any>>>({
    individual: {},
    "por-anuncio": {},
    "por-conjunto": {},
    "por-campanha": {},
  });

  const selectedPackIdsKey = useMemo(() => Array.from(selectedPackIds).sort().join("|"), [selectedPackIds]);

  const mergeSeriesCache = useCallback((tab: "individual" | "por-anuncio" | "por-conjunto" | "por-campanha", incoming: any) => {
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
    (tab: "individual" | "por-anuncio" | "por-conjunto" | "por-campanha", keys: string[]) => {
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
      (Object.keys(timers) as Array<"individual" | "por-anuncio" | "por-conjunto" | "por-campanha">).forEach((tab) => {
        const timer = timers[tab];
        if (timer) clearTimeout(timer);
      });
    };
  }, []);

  // Clear series cache when filters change
  useEffect(() => {
    setSeriesCacheByTab({ individual: {}, "por-anuncio": {}, "por-conjunto": {}, "por-campanha": {} });
  }, [dateRange.start, dateRange.end, actionType, selectedPackIdsKey]);

  // ── API requests ───────────────────────────────────────────────────────────
  const managerRequest: RankingsRequest = useMemo(
    () => ({
      date_start: dateRange.start || "",
      date_stop: dateRange.end || "",
      group_by: "ad_name",
      action_type: actionType || undefined,
      limit: 10000,
      offset: 0,
      filters: {},
      pack_ids: Array.from(selectedPackIds),
      include_series: false,
      include_leadscore: hasSheetIntegration,
      series_window: SERIES_WINDOW,
      include_available_conversion_types: true,
    }),
    [dateRange.start, dateRange.end, selectedPackIds, actionType, hasSheetIntegration],
  );

  const { data: managerData, isLoading: loading, error: managerError } = useAdPerformance(managerRequest, isAuthorized && !!dateRange.start && !!dateRange.end);

  const managerRequestIndividual: RankingsRequest = useMemo(
    () => ({
      date_start: dateRange.start || "",
      date_stop: dateRange.end || "",
      group_by: "ad_id",
      action_type: actionType || undefined,
      limit: 10000,
      offset: 0,
      filters: {},
      pack_ids: Array.from(selectedPackIds),
      include_series: false,
      include_leadscore: hasSheetIntegration,
      series_window: SERIES_WINDOW,
      include_available_conversion_types: false,
    }),
    [dateRange.start, dateRange.end, selectedPackIds, actionType, hasSheetIntegration],
  );

  const shouldFetchIndividual = isAuthorized && !!dateRange.start && !!dateRange.end && activeManagerTab === "individual";
  const { data: managerDataIndividual, isLoading: loadingIndividual } = useAdPerformance(managerRequestIndividual, shouldFetchIndividual);

  const managerRequestAdset: RankingsRequest = useMemo(
    () => ({
      date_start: dateRange.start || "",
      date_stop: dateRange.end || "",
      group_by: "adset_id",
      action_type: actionType || undefined,
      limit: 10000,
      offset: 0,
      filters: {},
      pack_ids: Array.from(selectedPackIds),
      include_series: false,
      include_leadscore: hasSheetIntegration,
      series_window: SERIES_WINDOW,
      include_available_conversion_types: false,
    }),
    [dateRange.start, dateRange.end, selectedPackIds, actionType, hasSheetIntegration],
  );

  const shouldFetchAdset = isAuthorized && !!dateRange.start && !!dateRange.end && activeManagerTab === "por-conjunto";
  const { data: managerDataAdset, isLoading: loadingAdset } = useAdPerformance(managerRequestAdset, shouldFetchAdset);

  const managerRequestCampaign: RankingsRequest = useMemo(
    () => ({
      date_start: dateRange.start || "",
      date_stop: dateRange.end || "",
      group_by: "campaign_id",
      action_type: actionType || undefined,
      limit: 10000,
      offset: 0,
      filters: {},
      pack_ids: Array.from(selectedPackIds),
      include_series: false,
      include_leadscore: hasSheetIntegration,
      series_window: SERIES_WINDOW,
      include_available_conversion_types: false,
    }),
    [dateRange.start, dateRange.end, selectedPackIds, actionType, hasSheetIntegration],
  );

  const shouldFetchCampaign = isAuthorized && !!dateRange.start && !!dateRange.end && activeManagerTab === "por-campanha";
  const { data: managerDataCampaign, isLoading: loadingCampaign } = useAdPerformance(managerRequestCampaign, shouldFetchCampaign);

  // Light request for available_conversion_types
  const managerConversionTypesRequest: RankingsRequest = useMemo(
    () => ({
      date_start: dateRange.start || "",
      date_stop: dateRange.end || "",
      group_by: "ad_name",
      action_type: actionType || undefined,
      limit: 1,
      offset: 0,
      filters: {},
      pack_ids: Array.from(selectedPackIds),
      include_series: false,
      include_leadscore: false,
      series_window: SERIES_WINDOW,
      include_available_conversion_types: true,
    }),
    [dateRange.start, dateRange.end, selectedPackIds, actionType],
  );
  const { data: convTypesData } = useAdPerformance(managerConversionTypesRequest, isAuthorized && !!dateRange.start && !!dateRange.end);

  // ── Derived from API data ──────────────────────────────────────────────────
  const serverData = managerData?.data || null;
  const serverDataIndividual = managerDataIndividual?.data || null;
  const serverDataAdset = managerDataAdset?.data || null;
  const serverDataCampaign = managerDataCampaign?.data || null;
  const availableConversionTypes = convTypesData?.available_conversion_types || managerData?.available_conversion_types || [];

  // Propagate available conversion types to global store
  useEffect(() => {
    if (availableConversionTypes.length > 0) {
      setActionTypeOptions(availableConversionTypes);
    }
  }, [availableConversionTypes]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Series requests ────────────────────────────────────────────────────────
  const seriesKeysAdName = useMemo(() => visibleSeriesKeys["por-anuncio"], [visibleSeriesKeys]);
  const seriesKeysIndividual = useMemo(() => visibleSeriesKeys.individual, [visibleSeriesKeys]);
  const seriesKeysAdset = useMemo(() => visibleSeriesKeys["por-conjunto"], [visibleSeriesKeys]);
  const seriesKeysCampaign = useMemo(() => visibleSeriesKeys["por-campanha"], [visibleSeriesKeys]);

  const managerSeriesRequest = useMemo(
    () => ({ date_start: dateRange.start || "", date_stop: dateRange.end || "", group_by: "ad_name" as const, action_type: actionType || undefined, pack_ids: Array.from(selectedPackIds), filters: {}, group_keys: seriesKeysAdName, window: SERIES_WINDOW }),
    [dateRange.start, dateRange.end, actionType, selectedPackIds, seriesKeysAdName],
  );
  const managerSeriesRequestIndividual = useMemo(
    () => ({ date_start: dateRange.start || "", date_stop: dateRange.end || "", group_by: "ad_id" as const, action_type: actionType || undefined, pack_ids: Array.from(selectedPackIds), filters: {}, group_keys: seriesKeysIndividual, window: SERIES_WINDOW }),
    [dateRange.start, dateRange.end, actionType, selectedPackIds, seriesKeysIndividual],
  );
  const managerSeriesRequestAdset = useMemo(
    () => ({ date_start: dateRange.start || "", date_stop: dateRange.end || "", group_by: "adset_id" as const, action_type: actionType || undefined, pack_ids: Array.from(selectedPackIds), filters: {}, group_keys: seriesKeysAdset, window: SERIES_WINDOW }),
    [dateRange.start, dateRange.end, actionType, selectedPackIds, seriesKeysAdset],
  );
  const managerSeriesRequestCampaign = useMemo(
    () => ({ date_start: dateRange.start || "", date_stop: dateRange.end || "", group_by: "campaign_id" as const, action_type: actionType || undefined, pack_ids: Array.from(selectedPackIds), filters: {}, group_keys: seriesKeysCampaign, window: SERIES_WINDOW }),
    [dateRange.start, dateRange.end, actionType, selectedPackIds, seriesKeysCampaign],
  );

  const shouldFetchSeriesAdName = showTrends && activeManagerTab === "por-anuncio" && seriesKeysAdName.length > 0;
  const shouldFetchSeriesIndividual = showTrends && activeManagerTab === "individual" && seriesKeysIndividual.length > 0;
  const shouldFetchSeriesAdset = showTrends && activeManagerTab === "por-conjunto" && seriesKeysAdset.length > 0;
  const shouldFetchSeriesCampaign = showTrends && activeManagerTab === "por-campanha" && seriesKeysCampaign.length > 0;

  const { data: managerSeriesData, isError: managerSeriesErrorAdName } = useAdPerformanceSeries(managerSeriesRequest, shouldFetchSeriesAdName);
  const { data: managerSeriesDataIndividual, isError: managerSeriesErrorIndividual } = useAdPerformanceSeries(managerSeriesRequestIndividual, shouldFetchSeriesIndividual);
  const { data: managerSeriesDataAdset, isError: managerSeriesErrorAdset } = useAdPerformanceSeries(managerSeriesRequestAdset, shouldFetchSeriesAdset);
  const { data: managerSeriesDataCampaign, isError: managerSeriesErrorCampaign } = useAdPerformanceSeries(managerSeriesRequestCampaign, shouldFetchSeriesCampaign);

  useEffect(() => { mergeSeriesCache("por-anuncio", (managerSeriesData as any)?.series_by_group); }, [managerSeriesData, mergeSeriesCache]);
  useEffect(() => { mergeSeriesCache("individual", (managerSeriesDataIndividual as any)?.series_by_group); }, [managerSeriesDataIndividual, mergeSeriesCache]);
  useEffect(() => { mergeSeriesCache("por-conjunto", (managerSeriesDataAdset as any)?.series_by_group); }, [managerSeriesDataAdset, mergeSeriesCache]);
  useEffect(() => { mergeSeriesCache("por-campanha", (managerSeriesDataCampaign as any)?.series_by_group); }, [managerSeriesDataCampaign, mergeSeriesCache]);

  const seriesByGroupAdName = seriesCacheByTab["por-anuncio"];
  const seriesByGroupIndividual = seriesCacheByTab.individual;
  const seriesByGroupAdset = seriesCacheByTab["por-conjunto"];
  const seriesByGroupCampaign = seriesCacheByTab["por-campanha"];

  const pendingSeriesKeysByTab = useMemo(() => {
    const buildPendingSet = (keys: string[], cache: Record<string, any>, shouldLoad: boolean): Set<string> => {
      if (!shouldLoad) return new Set<string>();
      return new Set(keys.filter((k) => !!k && !cache[k]));
    };
    return {
      "por-anuncio": buildPendingSet(seriesKeysAdName, seriesByGroupAdName, showTrends && activeManagerTab === "por-anuncio" && !managerSeriesErrorAdName),
      individual: buildPendingSet(seriesKeysIndividual, seriesByGroupIndividual, showTrends && activeManagerTab === "individual" && !managerSeriesErrorIndividual),
      "por-conjunto": buildPendingSet(seriesKeysAdset, seriesByGroupAdset, showTrends && activeManagerTab === "por-conjunto" && !managerSeriesErrorAdset),
      "por-campanha": buildPendingSet(seriesKeysCampaign, seriesByGroupCampaign, showTrends && activeManagerTab === "por-campanha" && !managerSeriesErrorCampaign),
    };
  }, [seriesKeysAdName, seriesKeysIndividual, seriesKeysAdset, seriesKeysCampaign, seriesByGroupAdName, seriesByGroupIndividual, seriesByGroupAdset, seriesByGroupCampaign, showTrends, activeManagerTab, managerSeriesErrorAdName, managerSeriesErrorIndividual, managerSeriesErrorAdset, managerSeriesErrorCampaign]);

  const seriesPrimingByTab = useMemo(() => {
    const isPriming = (tab: "individual" | "por-anuncio" | "por-conjunto" | "por-campanha", tabKeys: string[], tabError: boolean) =>
      showTrends && activeManagerTab === tab && !tabError && tabKeys.length === 0;
    return {
      "por-anuncio": isPriming("por-anuncio", seriesKeysAdName, managerSeriesErrorAdName),
      individual: isPriming("individual", seriesKeysIndividual, managerSeriesErrorIndividual),
      "por-conjunto": isPriming("por-conjunto", seriesKeysAdset, managerSeriesErrorAdset),
      "por-campanha": isPriming("por-campanha", seriesKeysCampaign, managerSeriesErrorCampaign),
    };
  }, [showTrends, activeManagerTab, seriesKeysAdName, seriesKeysIndividual, seriesKeysAdset, seriesKeysCampaign, managerSeriesErrorAdName, managerSeriesErrorIndividual, managerSeriesErrorAdset, managerSeriesErrorCampaign]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleShowTrendsChange = (checked: boolean) => {
    setShowTrends(checked);
    try {
      localStorage.setItem("hookify-manager-show-trends", checked.toString());
    } catch (e) {
      logger.error("Erro ao salvar showTrends no localStorage:", e);
    }
  };

  // ── Averages ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (managerData && (managerData as any).averages) {
      setServerAverages((managerData as any).averages);
    }
  }, [managerData]);

  useEffect(() => {
    if (managerError) logger.error("Erro ao buscar manager:", managerError);
  }, [managerError]);

  // ── Data mapping: Step 1 — base metrics ───────────────────────────────────
  const baseMappedAdName = useMemo(() => {
    if (activeManagerTab !== "por-anuncio") return [] as any[];
    if (!serverData || serverData.length === 0) return [] as any[];
    return serverData.map((row: any): ManagerRow => {
      const conversionsObj = row.conversions || {};
      const results = actionType ? Number(conversionsObj[actionType] || 0) : 0;
      const lpv = Number(row.lpv || 0);
      const spend = Number(row.spend || 0);
      const page_conv = lpv > 0 ? results / lpv : 0;
      const cpr = results > 0 ? spend / results : 0;
      const cpm = typeof row.cpm === "number" ? row.cpm : 0;
      const website_ctr = typeof row.website_ctr === "number" ? row.website_ctr : 0;
      const connect_rate = Number(row.connect_rate || 0);
      const overall_conversion = website_ctr * connect_rate * page_conv;
      return { ...row, lpv, spend, cpr, cpm, page_conv, overall_conversion, website_ctr, connect_rate, video_total_plays: Number(row.plays || 0), conversions: conversionsObj, series: null, series_loading: false, creative: {} };
    });
  }, [serverData, actionType, activeManagerTab]);

  const baseMappedIndividual = useMemo(() => {
    if (activeManagerTab !== "individual") return [] as any[];
    if (!serverDataIndividual || serverDataIndividual.length === 0) return [] as any[];
    return serverDataIndividual.map((row: any): ManagerRow => {
      const conversionsObj = row.conversions || {};
      const results = actionType ? Number(conversionsObj[actionType] || 0) : 0;
      const lpv = Number(row.lpv || 0);
      const spend = Number(row.spend || 0);
      const page_conv = lpv > 0 ? results / lpv : 0;
      const cpr = results > 0 ? spend / results : 0;
      const website_ctr = typeof row.website_ctr === "number" ? row.website_ctr : 0;
      const connect_rate = Number(row.connect_rate || 0);
      const overall_conversion = website_ctr * connect_rate * page_conv;
      return { ...row, lpv, spend, cpr, cpm: Number(row.cpm || 0), page_conv, overall_conversion, website_ctr, connect_rate, video_total_plays: Number(row.plays || 0), conversions: conversionsObj, series: null, series_loading: false, creative: {} };
    });
  }, [serverDataIndividual, actionType, activeManagerTab]);

  // ── Step 2: Attach series ──────────────────────────────────────────────────
  const adsForTable = useMemo(() => {
    if (baseMappedAdName.length === 0 || !showTrends) return baseMappedAdName;
    const pending = pendingSeriesKeysByTab["por-anuncio"];
    const priming = seriesPrimingByTab["por-anuncio"];
    let changed = false;
    const result = baseMappedAdName.map((row) => {
      const groupKey = String(row?.group_key || row?.ad_name || row?.ad_id || "");
      const series = seriesByGroupAdName[groupKey] || null;
      const seriesLoading = !managerSeriesErrorAdName && !series && (priming || pending.has(groupKey));
      if (row.series === series && row.series_loading === seriesLoading) return row;
      changed = true;
      return { ...row, series, series_loading: seriesLoading };
    });
    return changed ? result : baseMappedAdName;
  }, [baseMappedAdName, showTrends, seriesByGroupAdName, pendingSeriesKeysByTab, seriesPrimingByTab, managerSeriesErrorAdName]);

  const adsForIndividualTable = useMemo(() => {
    if (baseMappedIndividual.length === 0 || !showTrends) return baseMappedIndividual;
    const pending = pendingSeriesKeysByTab.individual;
    const priming = seriesPrimingByTab.individual;
    let changed = false;
    const result = baseMappedIndividual.map((row) => {
      const groupKey = String(row?.group_key || row?.ad_id || "");
      const series = seriesByGroupIndividual[groupKey] || null;
      const seriesLoading = !managerSeriesErrorIndividual && !series && (priming || pending.has(groupKey));
      if (row.series === series && row.series_loading === seriesLoading) return row;
      changed = true;
      return { ...row, series, series_loading: seriesLoading };
    });
    return changed ? result : baseMappedIndividual;
  }, [baseMappedIndividual, showTrends, seriesByGroupIndividual, pendingSeriesKeysByTab, seriesPrimingByTab, managerSeriesErrorIndividual]);

  const baseMappedAdset = useMemo(() => {
    if (activeManagerTab !== "por-conjunto") return [] as any[];
    if (!serverDataAdset || serverDataAdset.length === 0) return [] as any[];
    return serverDataAdset.map((row: any): ManagerRow => {
      const conversionsObj = row.conversions || {};
      const results = actionType ? Number(conversionsObj[actionType] || 0) : 0;
      const lpv = Number(row.lpv || 0);
      const spend = Number(row.spend || 0);
      const page_conv = lpv > 0 ? results / lpv : 0;
      const cpr = results > 0 ? spend / results : 0;
      const website_ctr = typeof row.website_ctr === "number" ? row.website_ctr : 0;
      const connect_rate = Number(row.connect_rate || 0);
      const overall_conversion = website_ctr * connect_rate * page_conv;
      return { ...row, ad_name: row.ad_name || row.adset_name || row.adset_id, lpv, spend, cpr, cpm: Number(row.cpm || 0), page_conv, overall_conversion, website_ctr, connect_rate, video_total_plays: Number(row.plays || 0), conversions: conversionsObj, series: null, series_loading: false, creative: {} };
    });
  }, [serverDataAdset, actionType, activeManagerTab]);

  const baseMappedCampaign = useMemo(() => {
    if (activeManagerTab !== "por-campanha") return [] as any[];
    if (!serverDataCampaign || serverDataCampaign.length === 0) return [] as any[];
    return serverDataCampaign.map((row: any): ManagerRow => {
      const conversionsObj = row.conversions || {};
      const results = actionType ? Number(conversionsObj[actionType] || 0) : 0;
      const lpv = Number(row.lpv || 0);
      const spend = Number(row.spend || 0);
      const page_conv = lpv > 0 ? results / lpv : 0;
      const cpr = results > 0 ? spend / results : 0;
      const website_ctr = typeof row.website_ctr === "number" ? row.website_ctr : 0;
      const connect_rate = Number(row.connect_rate || 0);
      const overall_conversion = website_ctr * connect_rate * page_conv;
      return { ...row, ad_name: row.ad_name || row.campaign_name || row.campaign_id, lpv, spend, cpr, cpm: Number(row.cpm || 0), page_conv, overall_conversion, website_ctr, connect_rate, video_total_plays: Number(row.plays || 0), conversions: conversionsObj, series: null, series_loading: false, creative: {} };
    });
  }, [serverDataCampaign, actionType, activeManagerTab]);

  const adsForAdsetTable = useMemo(() => {
    if (baseMappedAdset.length === 0 || !showTrends) return baseMappedAdset;
    const pending = pendingSeriesKeysByTab["por-conjunto"];
    const priming = seriesPrimingByTab["por-conjunto"];
    let changed = false;
    const result = baseMappedAdset.map((row) => {
      const groupKey = String(row?.group_key || row?.adset_id || "");
      const series = seriesByGroupAdset[groupKey] || null;
      const seriesLoading = !managerSeriesErrorAdset && !series && (priming || pending.has(groupKey));
      if (row.series === series && row.series_loading === seriesLoading) return row;
      changed = true;
      return { ...row, series, series_loading: seriesLoading };
    });
    return changed ? result : baseMappedAdset;
  }, [baseMappedAdset, showTrends, seriesByGroupAdset, pendingSeriesKeysByTab, seriesPrimingByTab, managerSeriesErrorAdset]);

  const adsForCampaignTable = useMemo(() => {
    if (baseMappedCampaign.length === 0 || !showTrends) return baseMappedCampaign;
    const pending = pendingSeriesKeysByTab["por-campanha"];
    const priming = seriesPrimingByTab["por-campanha"];
    let changed = false;
    const result = baseMappedCampaign.map((row) => {
      const groupKey = String(row?.group_key || row?.campaign_id || "");
      const series = seriesByGroupCampaign[groupKey] || null;
      const seriesLoading = !managerSeriesErrorCampaign && !series && (priming || pending.has(groupKey));
      if (row.series === series && row.series_loading === seriesLoading) return row;
      changed = true;
      return { ...row, series, series_loading: seriesLoading };
    });
    return changed ? result : baseMappedCampaign;
  }, [baseMappedCampaign, showTrends, seriesByGroupCampaign, pendingSeriesKeysByTab, seriesPrimingByTab, managerSeriesErrorCampaign]);

  // ── Validated averages (for por-anuncio tab only) ──────────────────────────
  const [validatedManagerForAverages, validatedAveragesForAverages] = useMemo(() => {
    if (activeManagerTab !== "por-anuncio") return [[], undefined] as [any[], any];
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
        ad_name: ad.ad_name, ad_id: ad.ad_id, account_id: ad.account_id, impressions, spend, cpm, website_ctr, connect_rate,
        inline_link_clicks: Number(ad.inline_link_clicks || 0), clicks: Number(ad.clicks || 0), plays: Number(ad.plays || 0),
        hook: Number(ad.hook || 0), ctr: Number(ad.ctr || 0), page_conv, overall_conversion, conversions: ad.conversions || {},
      };
      return evaluateValidationCriteria(validationCriteria, metrics, "AND");
    });

    const avg = computeValidatedAveragesFromAdPerformance(validated as any, actionType, actionTypeOptions);
    return [validated, avg] as [any[], any];
  }, [serverData, validationCriteria, actionType, actionTypeOptions, activeManagerTab]);

  // ── Pack ads for ManagerTable ──────────────────────────────────────────────
  const selectedPacks = packs.filter((p) => selectedPackIds.has(p.id));
  const { packsAdsMap } = usePacksAds(selectedPacks);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!isClient) {
    return <div><LoadingState label="Carregando..." /></div>;
  }

  if (authStatus !== "authorized") {
    return <div><LoadingState label="Redirecionando para login..." /></div>;
  }

  if (onboardingStatus === "requires_onboarding") {
    return <div><LoadingState label="Redirecionando para configuração inicial..." /></div>;
  }

  return (
    <PageContainer
      title="Otimize"
      description="Dados de performance dos seus anúncios"
      fullHeight={true}
      className="min-h-0"
      actions={
        <PageActions className="xl:flex-nowrap xl:items-center">
          <ToggleSwitch id="show-trends" checked={showTrends} onCheckedChange={handleShowTrendsChange} labelLeft="Médias" labelRight="Tendências" variant="minimal" />
        </PageActions>
      }
    >
      <ManagerTable
        ads={adsForTable}
        groupByAdName
        activeTab={activeManagerTab}
        onTabChange={handleTabChange}
        adsIndividual={adsForIndividualTable}
        isLoadingIndividual={loadingIndividual}
        adsAdset={adsForAdsetTable}
        isLoadingAdset={loadingAdset}
        adsCampaign={adsForCampaignTable}
        isLoadingCampaign={loadingCampaign}
        onVisibleGroupKeysChange={handleVisibleGroupKeysChange}
        actionType={actionType}
        endDate={endDate}
        dateStart={dateRange.start}
        dateStop={dateRange.end}
        availableConversionTypes={actionTypeOptions}
        showTrends={showTrends}
        hasSheetIntegration={hasSheetIntegration}
        isLoading={loading}
        initialFilters={initialFilters}
        averagesOverride={(() => {
          const base = validatedAveragesForAverages || serverAverages || null;
          if (!base) return undefined;
          const per = (base as any).per_action_type || {};
          const perSel = actionType ? per[actionType] : undefined;
          const defaultPerSel = actionType && !perSel ? { cpr: 0, page_conv: 0, results: 0 } : perSel;
          return {
            hook: typeof base.hook === "number" ? base.hook : null,
            hold_rate: typeof base.hold_rate === "number" ? base.hold_rate : null,
            video_watched_p50: typeof base.video_watched_p50 === "number" ? base.video_watched_p50 : null,
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
    </PageContainer>
  );
}

export default function ManagerPage() {
  return (
    <Suspense fallback={<LoadingState label="Carregando..." />}>
      <ManagerPageContent />
    </Suspense>
  );
}

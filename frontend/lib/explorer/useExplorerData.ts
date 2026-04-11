"use client";

import { useEffect, useMemo, useState } from "react";
import { useAdPerformance } from "@/lib/api/hooks";
import type { RankingsItem, RankingsRequest } from "@/lib/api/schemas";
import { useFilters } from "@/lib/hooks/useFilters";
import { useMqlLeadscore } from "@/lib/hooks/useMqlLeadscore";
import { useSharedAdNameDetail } from "@/lib/ads/sharedAdDetail";
import { computeValidatedAveragesFromAdPerformance } from "@/lib/utils/validatedAverages";
import { buildExplorerDetailViewModel, buildExplorerListItemViewModel, compareExplorerAdsByMetric, getExplorerGroupKey, getExplorerMetricAverage } from "./viewModels";
import type { ExplorerMetricAverages, ExplorerSortState } from "./types";

export type ExplorerDataStatus =
  | { kind: "loading" }
  | { kind: "needs-packs"; message: string }
  | { kind: "needs-range"; message: string }
  | { kind: "error"; message: string }
  | { kind: "success" };

export function useExplorerData(sortState: ExplorerSortState) {
  const { selectedPackIds, effectiveDateRange, actionType, packs, packsClient, setActionTypeOptions } = useFilters();
  const { mqlLeadscoreMin } = useMqlLeadscore();
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);

  const hasSelectedPacks = selectedPackIds.size > 0;
  const hasValidRange = !!effectiveDateRange.start && !!effectiveDateRange.end;
  const hasSheetIntegration = useMemo(
    () => packs.some((pack) => selectedPackIds.has(pack.id) && !!pack.sheet_integration),
    [packs, selectedPackIds],
  );

  const request = useMemo<RankingsRequest>(
    () => ({
      date_start: effectiveDateRange.start || "",
      date_stop: effectiveDateRange.end || "",
      group_by: "ad_name",
      action_type: actionType || undefined,
      limit: 1000,
      offset: 0,
      filters: {},
      pack_ids: Array.from(selectedPackIds),
      include_series: true,
      include_leadscore: hasSheetIntegration,
      include_available_conversion_types: true,
    }),
    [actionType, effectiveDateRange.end, effectiveDateRange.start, hasSheetIntegration, selectedPackIds],
  );

  const performanceQuery = useAdPerformance(request, packsClient && hasSelectedPacks && hasValidRange);

  const sortedAds = useMemo(() => {
    const rows = [...(performanceQuery.data?.data || [])];
    rows.sort((a, b) =>
      compareExplorerAdsByMetric(a, b, sortState, {
        actionType,
        mqlLeadscoreMin,
      }),
    );
    return rows;
  }, [actionType, mqlLeadscoreMin, performanceQuery.data?.data, sortState]);

  useEffect(() => {
    const availableConversionTypes = performanceQuery.data?.available_conversion_types || [];
    if (availableConversionTypes.length > 0) {
      setActionTypeOptions(availableConversionTypes);
    }
  }, [performanceQuery.data?.available_conversion_types, setActionTypeOptions]);

  useEffect(() => {
    if (sortedAds.length === 0) {
      if (selectedGroupKey != null) {
        setSelectedGroupKey(null);
      }
      return;
    }

    const stillExists = selectedGroupKey && sortedAds.some((ad) => getExplorerGroupKey(ad) === selectedGroupKey);
    if (!stillExists) {
      setSelectedGroupKey(getExplorerGroupKey(sortedAds[0]));
    }
  }, [selectedGroupKey, sortedAds]);

  const selectedAd = useMemo(
    () => sortedAds.find((ad) => getExplorerGroupKey(ad) === selectedGroupKey) || sortedAds[0] || null,
    [selectedGroupKey, sortedAds],
  );

  const sharedDetail = useSharedAdNameDetail({
    ad: selectedAd,
    dateStart: effectiveDateRange.start,
    dateStop: effectiveDateRange.end,
    actionType,
    enabled: packsClient && hasSelectedPacks && hasValidRange && !!selectedAd,
  });

  const listItems = useMemo(
    () =>
      sortedAds.map((ad) =>
        buildExplorerListItemViewModel(ad, sortState.metricKey, {
          actionType,
          mqlLeadscoreMin,
        }),
      ),
    [actionType, mqlLeadscoreMin, sortState.metricKey, sortedAds],
  );
  const selectedDetail = useMemo(
    () => (selectedAd && sharedDetail.model ? buildExplorerDetailViewModel(selectedAd, sharedDetail.model) : null),
    [selectedAd, sharedDetail.model],
  );

  const averagePrimaryMetric = useMemo(
    () =>
      getExplorerMetricAverage(performanceQuery.data, sortedAds, sortState.metricKey, {
        actionType,
        mqlLeadscoreMin,
      }),
    [actionType, mqlLeadscoreMin, performanceQuery.data, sortState.metricKey, sortedAds],
  );

  const metricAverages = useMemo<ExplorerMetricAverages | undefined>(() => {
    const responseAverages =
      performanceQuery.data?.averages ??
      computeValidatedAveragesFromAdPerformance(
        sortedAds,
        actionType,
        performanceQuery.data?.available_conversion_types,
      );

    if (!responseAverages) {
      return undefined;
    }

    return {
      hook: responseAverages.hook ?? null,
      hold_rate: responseAverages.hold_rate ?? null,
      video_watched_p50: responseAverages.video_watched_p50 ?? null,
      scroll_stop: responseAverages.scroll_stop ?? null,
      ctr: responseAverages.ctr ?? null,
      website_ctr: responseAverages.website_ctr ?? null,
      connect_rate: responseAverages.connect_rate ?? null,
      cpm: responseAverages.cpm ?? null,
      cpc: responseAverages.cpc ?? null,
      cpmql: null,
      cpr: actionType && responseAverages.per_action_type?.[actionType] ? responseAverages.per_action_type[actionType].cpr ?? null : null,
      page_conv: actionType && responseAverages.per_action_type?.[actionType] ? responseAverages.per_action_type[actionType].page_conv ?? null : null,
    };
  }, [actionType, performanceQuery.data?.available_conversion_types, performanceQuery.data?.averages, sortedAds]);

  const status: ExplorerDataStatus = useMemo(() => {
    if (!packsClient) {
      return { kind: "loading" };
    }

    if (!hasSelectedPacks) {
      return { kind: "needs-packs", message: "Selecione pelo menos um pack para abrir o Explorer." };
    }

    if (!hasValidRange) {
      return { kind: "needs-range", message: "Defina um periodo valido para carregar os criativos reais." };
    }

    if (performanceQuery.isLoading && sortedAds.length === 0) {
      return { kind: "loading" };
    }

    if (performanceQuery.error) {
      const message = performanceQuery.error instanceof Error ? performanceQuery.error.message : "Nao foi possivel carregar os dados do Explorer.";
      return { kind: "error", message };
    }

    return { kind: "success" };
  }, [hasSelectedPacks, hasValidRange, packsClient, performanceQuery.error, performanceQuery.isLoading, sortedAds.length]);

  return {
    status,
    actionType,
    dateStart: effectiveDateRange.start,
    dateStop: effectiveDateRange.end,
    listItems,
    selectedGroupKey,
    setSelectedGroupKey,
    selectedAd,
    selectedDetail,
    averagePrimaryMetric,
    metricAverages,
    isLoadingDetail: sharedDetail.isLoadingDetail,
    isLoadingMedia: sharedDetail.isLoadingMedia,
  };
}

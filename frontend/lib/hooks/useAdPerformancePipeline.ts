"use client";

import { useEffect, useMemo } from "react";
import { useAdPerformance } from "@/lib/api/hooks";
import { useFilters } from "@/lib/hooks/useFilters";
import { useAppAuthReady } from "@/lib/hooks/useAppAuthReady";
import { usePacksAds } from "@/lib/hooks/usePacksAds";
import { useValidationCriteria } from "@/lib/hooks/useValidationCriteria";
import { buildAdMetricsData, evaluateValidationCriteria } from "@/lib/utils/validateAdCriteria";
import { computeValidatedAveragesFromAdPerformance } from "@/lib/utils/validatedAverages";
import { showError } from "@/lib/utils/toast";
import type { RankingsItem, RankingsRequest } from "@/lib/api/schemas";

interface UseAdPerformancePipelineOptions {
  enabled?: boolean;
  groupBy?: "ad_id" | "ad_name" | "adset_id" | "campaign_id";
  limit?: number;
  // true (padrão): filtra serverData pelos ads dos packs selecionados (Plano/GOLD)
  // false: usa serverData inteiro (Insights — valida sobre tudo que o servidor devolveu)
  filterToSelectedPacks?: boolean;
}

export function useAdPerformancePipeline(options: UseAdPerformancePipelineOptions = {}) {
  const {
    enabled: enabledOpt = true,
    groupBy = "ad_name",
    limit = 1000,
    filterToSelectedPacks = true,
  } = options;

  const { isAuthorized } = useAppAuthReady();

  const {
    selectedPackIds,
    effectiveDateRange: dateRange,
    actionType,
    actionTypeOptions,
    setActionTypeOptions,
    packs,
    packsClient,
  } = useFilters();

  // ── Build request ────────────────────────────────────────────────────────────
  const request = useMemo((): RankingsRequest => ({
    date_start: dateRange.start ?? "",
    date_stop: dateRange.end ?? "",
    group_by: groupBy,
    // action_type é a chave prefixada (ex: "action:purchase"). Omitir → conversions={} → CPR=0.
    action_type: actionType || undefined,
    limit,
    filters: {},
    pack_ids: Array.from(selectedPackIds),
    include_available_conversion_types: true,
  }), [dateRange.start, dateRange.end, groupBy, actionType, limit, selectedPackIds]);

  const packsReady = !!packsClient && packs.length > 0;

  const fetchEnabled =
    enabledOpt &&
    isAuthorized &&
    packsReady &&
    selectedPackIds.size > 0 &&
    !!dateRange.start &&
    !!dateRange.end;

  // ── TanStack Query fetch ─────────────────────────────────────────────────────
  const { data: queryData, isLoading: queryLoading, error } = useAdPerformance(request, fetchEnabled);

  const serverData = useMemo(() => queryData?.data ?? null, [queryData]);
  const serverAverages = useMemo(() => queryData?.averages, [queryData]);
  const availableConversionTypes = useMemo(
    () => queryData?.available_conversion_types ?? [],
    [queryData]
  );

  // Sincroniza dropdown de evento de conversão SÓ depois que dados reais chegam.
  // Importante: chamar com [] é intencional — o store (setActionTypeOptions) limpa um
  // actionType órfão quando o período/packs atuais não têm nenhuma conversão. Gatear em
  // `length > 0` mataria essa limpeza e deixaria um actionType inexistente → CPR/results=0
  // em tudo, silenciosamente. Gateamos em `queryData` (fetch resolvido) para não limpar
  // durante o loading transiente.
  useEffect(() => {
    if (!queryData) return;
    setActionTypeOptions(availableConversionTypes);
  }, [queryData, availableConversionTypes, setActionTypeOptions]);

  // Restaura o diagnóstico de erro perdido na refatoração (as páginas antigas faziam
  // console.error + empty-state). Sem isso, falha de backend fica indistinguível de "sem dados".
  useEffect(() => {
    if (error) {
      console.error("Erro ao buscar ad-performance:", error);
      showError(error);
    }
  }, [error]);

  // ── Pack-ads lookup ──────────────────────────────────────────────────────────
  const selectedPacks = useMemo(
    () => packs.filter((p) => selectedPackIds.has(p.id)),
    [packs, selectedPackIds]
  );
  const { packsAdsMap, isLoading: packsAdsLoading } = usePacksAds(selectedPacks);

  // Retorna packId do primeiro pack que contém o ad, ou null
  const getPackId = useMemo(() => {
    return (ad: any): string | null => {
      if (selectedPackIds.size === 0) return null;
      if (selectedPacks.length === 0) return null;
      for (const pack of selectedPacks) {
        const packAds = packsAdsMap.get(pack.id) || [];
        if (packAds.length === 0) continue;
        const matches = packAds.some((packAd: any) => {
          if (ad.account_id && packAd.account_id) {
            if (String(ad.account_id).trim() !== String(packAd.account_id).trim()) return false;
          }
          if (ad.ad_id && packAd.ad_id && String(ad.ad_id).trim() === String(packAd.ad_id).trim()) return true;
          if (ad.ad_name && packAd.ad_name && String(ad.ad_name).trim() === String(packAd.ad_name).trim()) return true;
          return false;
        });
        if (matches) return pack.id;
      }
      return null;
    };
  }, [selectedPackIds, selectedPacks, packsAdsMap]);

  // ── Filter by packs (opcional) ───────────────────────────────────────────────
  const filteredRankings = useMemo(() => {
    if (!serverData) return [];
    if (!filterToSelectedPacks) return serverData;
    return serverData.filter((row: any) => getPackId(row) !== null);
  }, [serverData, filterToSelectedPacks, getPackId]);

  // ── Validation ───────────────────────────────────────────────────────────────
  const { criteria: validationCriteria, isLoading: criteriaLoading } = useValidationCriteria();

  const [validatedAds, notValidatedAds, validatedAverages] = useMemo(() => {
    if (!filteredRankings || filteredRankings.length === 0) {
      return [[], [], undefined] as [any[], any[], any];
    }

    if (!validationCriteria || validationCriteria.length === 0) {
      const avgs = computeValidatedAveragesFromAdPerformance(
        filteredRankings as RankingsItem[],
        actionType,
        actionTypeOptions
      );
      return [filteredRankings, [], avgs] as [any[], any[], any];
    }

    const validated: any[] = [];
    const notValidated: any[] = [];

    for (const ad of filteredRankings) {
      const metrics = buildAdMetricsData(ad, actionType);
      if (evaluateValidationCriteria(validationCriteria, metrics, "AND")) {
        validated.push(ad);
      } else {
        notValidated.push(ad);
      }
    }

    const avgs = computeValidatedAveragesFromAdPerformance(
      validated as RankingsItem[],
      actionType,
      actionTypeOptions
    );
    return [validated, notValidated, avgs] as [any[], any[], any];
  }, [filteredRankings, validationCriteria, actionType, actionTypeOptions]);

  // packsAdsLoading só bloqueia o render quando o pack-filter client-side é usado
  // (Plano/Gold com filterToSelectedPacks=true → getPackId filtra serverData). No Insights
  // (filterToSelectedPacks=false) o serverData já vem escopado pelo pack_ids do servidor;
  // o packsAdsMap só alimenta a quebra opcional "Por Pack", então não deve travar o Global.
  const isLoading =
    queryLoading || criteriaLoading || (filterToSelectedPacks && fetchEnabled && packsAdsLoading);

  return {
    // Dados em cada camada do pipeline
    serverData,
    filteredRankings,
    validatedAds,
    notValidatedAds,
    validatedAverages,
    serverAverages,
    // Estado de filtros (passados para components filhos)
    actionType,
    actionTypeOptions,
    selectedPackIds,
    // Estado de carregamento/erro
    isLoading,
    error,
    // Helper para mapear ad → packId (usado por Insights)
    getPackId,
    // Extras de contexto
    packs,
    packsClient,
    dateRange,
    validationCriteria,
  };
}

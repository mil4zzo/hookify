"use client";

import { useEffect, useMemo } from "react";
import { useAdPerformance } from "@/lib/api/hooks";
import { useFilters } from "@/lib/hooks/useFilters";
import { useAppAuthReady } from "@/lib/hooks/useAppAuthReady";
import { usePacksAds } from "@/lib/hooks/usePacksAds";
import { useValidationCriteria } from "@/lib/hooks/useValidationCriteria";
import { buildAdMetricsData, evaluateValidationCriteria } from "@/lib/utils/validateAdCriteria";
import { buildPackMembershipIndex, isAdInSelectedPacks } from "@/lib/utils/packMembership";
import { showError } from "@/lib/utils/toast";
import type { RankingsRequest } from "@/lib/api/schemas";

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
  // packsAdsMap só é usado quando filterToSelectedPacks=true (Plano/GOLD). Passar [] evita
  // o fetch de pack-ads inteiro quando ninguém vai consumi-lo (ex: Insights, que valida
  // sobre o serverData já escopado pelo pack_ids do servidor).
  const { packsAdsMap, isLoading: packsAdsLoading } = usePacksAds(
    filterToSelectedPacks ? selectedPacks : []
  );

  // Índice O(1) de pertencimento à união dos packAds selecionados (substitui a antiga
  // varredura O(rows × packs × packAds)). Só o booleano de pertencimento é preservado —
  // ver contrato de equivalência em packMembership.ts.
  const membershipIndex = useMemo(
    () => buildPackMembershipIndex(selectedPacks, packsAdsMap),
    [selectedPacks, packsAdsMap]
  );

  // ── Filter by packs (opcional) ───────────────────────────────────────────────
  const filteredRankings = useMemo(() => {
    if (!serverData) return [];
    if (!filterToSelectedPacks) return serverData;
    return serverData.filter((row: any) => isAdInSelectedPacks(membershipIndex, row));
  }, [serverData, filterToSelectedPacks, membershipIndex]);

  // ── Validation ───────────────────────────────────────────────────────────────
  const { criteria: validationCriteria, isLoading: criteriaLoading } = useValidationCriteria();

  // Split validado/não-validado: os critérios de validação servem APENAS para filtrar
  // QUAIS ads são elegíveis a julgamento (G.O.L.D., plano de ação, oportunidades).
  // Não existe "média dos validados" — a única média do app é a global ponderada
  // (serverAverages, todos os ads), que é o número real que bate com o Meta.
  const [validatedAds, notValidatedAds] = useMemo(() => {
    if (!filteredRankings || filteredRankings.length === 0) {
      return [[], []] as [any[], any[]];
    }

    if (!validationCriteria || validationCriteria.length === 0) {
      return [filteredRankings, []] as [any[], any[]];
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

    return [validated, notValidated] as [any[], any[]];
  }, [filteredRankings, validationCriteria, actionType]);

  // packsAdsLoading só bloqueia o render quando o pack-filter client-side é usado
  // (Plano/Gold com filterToSelectedPacks=true → membershipIndex filtra serverData). No
  // Insights (filterToSelectedPacks=false) o serverData já vem escopado pelo pack_ids do
  // servidor e ninguém consome packsAdsMap, então não deve travar o render.
  const isLoading =
    queryLoading || criteriaLoading || (filterToSelectedPacks && fetchEnabled && packsAdsLoading);

  return {
    // Dados em cada camada do pipeline
    serverData,
    filteredRankings,
    validatedAds,
    notValidatedAds,
    serverAverages,
    // Estado de filtros (passados para components filhos)
    actionType,
    actionTypeOptions,
    selectedPackIds,
    // Estado de carregamento/erro
    isLoading,
    error,
    // Extras de contexto
    packs,
    packsClient,
    dateRange,
    validationCriteria,
  };
}

"use client";

import { useEffect, useMemo } from "react";
import { useAdPerformance } from "@/lib/api/hooks";
import { useFilters } from "@/lib/hooks/useFilters";
import { useAppAuthReady } from "@/lib/hooks/useAppAuthReady";
import { usePacksAds } from "@/lib/hooks/usePacksAds";
import { useAvailableConversionTypes } from "@/lib/hooks/useAvailableConversionTypes";
import { useValidationCriteria } from "@/lib/hooks/useValidationCriteria";
import { rowMatchesRules, type RuleNameDictionary } from "@/lib/rules/evaluate";
import { getFilteredFieldIds } from "@/lib/rules/restrictive";
import { isEmptyRuleTree } from "@/lib/rules/types";
import { useMqlLeadscore } from "@/lib/hooks/useMqlLeadscore";
import { buildPackMembershipIndex, isAdInSelectedPacks } from "@/lib/utils/packMembership";
import { showError } from "@/lib/utils/toast";
import type { RankingsRequest } from "@/lib/api/schemas";

/** Campos cuja avaliação depende de `campaign_ids`/`adset_ids` + dicionário de nomes. */
const PARENT_RULE_FIELDS = ["campaign_ids", "adset_ids", "campaign_name", "adset_name"] as const;

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

  // Lido ANTES do request: é ele que decide se vale pagar pela procedência completa.
  const { criteria: validationCriteria, isLoading: criteriaLoading } = useValidationCriteria();
  const { mqlLeadscoreMin } = useMqlLeadscore();

  /**
   * A procedência completa (`campaign_ids`/`adset_ids` + dicionário de nomes) custa
   * +35% a +67% de payload nas abas de criativo — e estas telas quase nunca precisam
   * dela. Só é pedida quando o critério de validação REALMENTE cita campanha ou
   * conjunto; do contrário a condição existiria e seria ignorada em silêncio, que é
   * o bug de campo morto que a fase 4 acabou de matar.
   */
  const criterioCitaPais = useMemo(
    () => PARENT_RULE_FIELDS.some((field) => getFilteredFieldIds(validationCriteria).has(field)),
    [validationCriteria],
  );

  const {
    selectedPackIds,
    effectiveDateRange: dateRange,
    actionType,
    actionTypeOptions,
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
    // A lista vem do metadado materializado `packs.conversion_types` (ver
    // useAvailableConversionTypes). Pedir para a RPC calcular custa de 0,8 s a 9 s
    // conforme o tamanho da seleção — medido com EXPLAIN ANALYZE em 2026-08-25.
    include_available_conversion_types: false,
    include_parent_ids: criterioCitaPais,
  }), [dateRange.start, dateRange.end, groupBy, actionType, limit, selectedPackIds, criterioCitaPais]);

  // Une os conversion_types dos packs selecionados E sincroniza o dropdown com o
  // gate correto. Encapsulado porque o gate ja quebrou de tres jeitos diferentes.
  const { packsReady } = useAvailableConversionTypes();

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
  // Dicionario id -> nome de campanhas/conjuntos (migration 136). O criterio pode
  // citar "Nome da campanha"; sem o dicionario essa condicao e IGNORADA, e o
  // usuario veria mais ads validados do que pediu, sem nada na tela explicando.
  const names = useMemo(() => (queryData as any)?.names as RuleNameDictionary | undefined, [queryData]);
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

  // Split validado/não-validado: os critérios de validação servem APENAS para filtrar
  // QUAIS ads são elegíveis a julgamento (G.O.L.D., plano de ação, oportunidades).
  // Não existe "média dos validados" — a única média do app é a global ponderada
  // (serverAverages, todos os ads), que é o número real que bate com o Meta.
  const [validatedAds, notValidatedAds] = useMemo(() => {
    if (!filteredRankings || filteredRankings.length === 0) {
      return [[], []] as [any[], any[]];
    }

    if (isEmptyRuleTree(validationCriteria)) {
      return [filteredRankings, []] as [any[], any[]];
    }

    const validated: any[] = [];
    const notValidated: any[] = [];

    // A regra roda sobre a LINHA da RPC, sem mapper intermediário. O mapper antigo
    // (`buildAdMetricsData`) copiava 14 campos escolhidos a dedo, e era ele — não o
    // avaliador — que fazia 11 campos do critério rejeitarem todo anúncio: o que
    // ele não copiava chegava `undefined`, e campo ausente devolvia `false`.
    for (const ad of filteredRankings) {
      if (rowMatchesRules(ad, validationCriteria, { actionType, mqlLeadscoreMin, names })) {
        validated.push(ad);
      } else {
        notValidated.push(ad);
      }
    }

    return [validated, notValidated] as [any[], any[]];
  }, [filteredRankings, validationCriteria, actionType, mqlLeadscoreMin, names]);

  // packsAdsLoading só bloqueia o render quando o pack-filter client-side é usado
  // (Plano/Gold com filterToSelectedPacks=true → membershipIndex filtra serverData). No
  // Insights (filterToSelectedPacks=false) o serverData já vem escopado pelo pack_ids do
  // servidor e ninguém consome packsAdsMap, então não deve travar o render.
  const isLoading =
    queryLoading || criteriaLoading || (filterToSelectedPacks && fetchEnabled && packsAdsLoading);

  return {
    // Sinal de conflito cross-silo (camada 2): linhas dedupadas nesta resposta.
    serverOverlapRows: (queryData as any)?.overlap?.rows ?? null,
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
    names,
  };
}

"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { usePacksAds } from "@/lib/hooks/usePacksAds";
import { api } from "@/lib/api/endpoints";
import type { AdPerformanceRequest, AdPerformanceResponse, RankingsItem } from "@/lib/api/schemas";
import { useValidationCriteria } from "@/lib/hooks/useValidationCriteria";
import { evaluateValidationCriteria, type AdMetricsData } from "@/lib/utils/validateAdCriteria";
import { computeValidatedAveragesFromAdPerformance } from "@/lib/utils/validatedAverages";
import { splitAdsIntoGoldBuckets } from "@/lib/utils/goldClassification";
import { computeOpportunityScores } from "@/lib/utils/opportunity";
import { buildActionPlan } from "@/lib/utils/actionPlan";
import { PageContainer } from "@/components/common/PageContainer";
import { useAppAuthReady } from "@/lib/hooks/useAppAuthReady";
import { useFilters } from "@/lib/hooks/useFilters";
import { StateSkeleton } from "@/components/common/States";
import { AnalyticsWorkspace, WorkspaceState } from "@/components/common/layout";
import { ActionPlanList } from "@/components/plano/ActionPlanList";
import { useMqlLeadscore } from "@/lib/hooks/useMqlLeadscore";
import { useUserPreferences } from "@/lib/hooks/useUserPreferences";
import { useFormatCurrency } from "@/lib/utils/currency";
import { IconPencil, IconCheck, IconX, IconInfoCircle } from "@tabler/icons-react";
import { StandardCard } from "@/components/common/StandardCard";

function PlanPageSkeleton() {
  return (
    <PageContainer variant="analytics" title="Plano de Ação" description="To-do list de anúncios">
      <AnalyticsWorkspace>
        <StateSkeleton variant="page" rows={4} className="rounded-md border border-border bg-card" />
      </AnalyticsWorkspace>
    </PageContainer>
  );
}

export default function PlanoPage() {
  const { isClient, isAuthorized } = useAppAuthReady();

  const {
    selectedPackIds,
    effectiveDateRange: dateRange,
    actionType,
    actionTypeOptions,
    setActionTypeOptions,
    packs,
    packsClient,
  } = useFilters();

  const { mqlLeadscoreMin } = useMqlLeadscore();
  const { targetCprByActionType, savePreferences, isSaving } = useUserPreferences();
  const formatCurrency = useFormatCurrency();

  const [serverData, setServerData] = useState<any[] | null>(null);
  const [averages, setAverages] = useState<any | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  // Target CPR editing
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput, setTargetInput] = useState("");

  const currentTarget = actionType ? targetCprByActionType?.[actionType] : undefined;

  const handleSaveTarget = useCallback(async () => {
    const val = parseFloat(targetInput.replace(",", "."));
    if (!actionType) return;
    const next = { ...targetCprByActionType };
    if (!isNaN(val) && val > 0) {
      next[actionType] = val;
    } else {
      delete next[actionType];
    }
    await savePreferences({ targetCprByActionType: next });
    setEditingTarget(false);
  }, [actionType, targetCprByActionType, targetInput, savePreferences]);

  const handleClearTarget = useCallback(async () => {
    if (!actionType) return;
    const next = { ...targetCprByActionType };
    delete next[actionType];
    await savePreferences({ targetCprByActionType: next });
  }, [actionType, targetCprByActionType, savePreferences]);

  // Fetch data — same pattern as gold/page.tsx
  useEffect(() => {
    if (!isAuthorized) return;
    const start = dateRange.start;
    const end = dateRange.end;
    if (!start || !end) return;
    if (selectedPackIds.size === 0) return;

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
        console.error("Erro ao buscar dados do Plano de Ação:", err);
        setServerData([]);
      })
      .finally(() => setLoading(false));
  }, [isAuthorized, dateRange.start, dateRange.end, selectedPackIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedPacks = packs.filter((p) => selectedPackIds.has(p.id));
  const { packsAdsMap } = usePacksAds(selectedPacks);

  const isRankingInSelectedPacks = useMemo(() => {
    return (ranking: any): boolean => {
      if (selectedPackIds.size === 0) return false;
      if (selectedPacks.length === 0) return false;
      for (const pack of selectedPacks) {
        const packAds = packsAdsMap.get(pack.id) || [];
        if (packAds.length === 0) continue;
        const matches = packAds.some((ad: any) => {
          const rankingAccountId = ranking.account_id;
          const adAccountId = ad.account_id;
          if (rankingAccountId && adAccountId && String(rankingAccountId).trim() !== String(adAccountId).trim()) return false;
          if (ranking.ad_id && ad.ad_id && String(ranking.ad_id).trim() === String(ad.ad_id).trim()) return true;
          if (ranking.ad_name && ad.ad_name && String(ranking.ad_name).trim() === String(ad.ad_name).trim()) return true;
          return false;
        });
        if (matches) return true;
      }
      return false;
    };
  }, [selectedPackIds, selectedPacks, packsAdsMap]);

  const filteredRankings = useMemo(() => {
    if (!serverData) return [];
    return serverData.filter((row: any) => isRankingInSelectedPacks(row));
  }, [serverData, isRankingInSelectedPacks]);

  const { criteria: validationCriteria, isLoading: isLoadingCriteria } = useValidationCriteria();

  const [validatedAds, notValidatedAds, validatedAverages] = useMemo(() => {
    if (!filteredRankings || filteredRankings.length === 0) {
      return [[], [], undefined] as [any[], any[], any];
    }

    if (!validationCriteria || validationCriteria.length === 0) {
      const avgs = computeValidatedAveragesFromAdPerformance(filteredRankings as any, actionType, actionTypeOptions);
      return [filteredRankings, [], avgs] as [any[], any[], any];
    }

    const validated: any[] = [];
    const notValidated: any[] = [];

    for (const ad of filteredRankings) {
      const impressions = Number(ad.impressions || 0);
      const spend = Number(ad.spend || 0);
      const cpm = typeof ad.cpm === "number" && !isNaN(ad.cpm) && isFinite(ad.cpm) ? ad.cpm : impressions > 0 ? (spend * 1000) / impressions : 0;
      const website_ctr = Number(ad.website_ctr || 0);
      const connect_rate = Number(ad.connect_rate || 0);
      const lpv = Number(ad.lpv || 0);
      const results = actionType ? Number(ad.conversions?.[actionType] || 0) : 0;
      const page_conv = lpv > 0 ? results / lpv : 0;

      const metrics: AdMetricsData = {
        ad_name: ad.ad_name, ad_id: ad.ad_id, account_id: ad.account_id,
        impressions, spend, cpm, website_ctr, connect_rate,
        inline_link_clicks: Number(ad.inline_link_clicks || 0),
        clicks: Number(ad.clicks || 0),
        plays: Number(ad.plays || 0),
        hook: Number(ad.hook || 0),
        ctr: Number(ad.ctr || 0),
        page_conv,
        overall_conversion: website_ctr * connect_rate * page_conv,
        conversions: ad.conversions || {},
      };

      if (evaluateValidationCriteria(validationCriteria, metrics, "AND")) {
        validated.push(ad);
      } else {
        notValidated.push(ad);
      }
    }

    const avgs = computeValidatedAveragesFromAdPerformance(validated as any, actionType, actionTypeOptions);
    return [validated, notValidated, avgs] as [any[], any[], any];
  }, [filteredRankings, validationCriteria, actionType, actionTypeOptions]);

  const actionPlan = useMemo(() => {
    if (!validatedAds || validatedAds.length === 0 || !actionType || !validatedAverages) return null;

    const buckets = splitAdsIntoGoldBuckets(validatedAds as RankingsItem[], validatedAverages, actionType);

    const opportunityRows = computeOpportunityScores({
      ads: validatedAds as RankingsItem[],
      averages: validatedAverages,
      actionType,
      mqlLeadscoreMin: mqlLeadscoreMin || 0,
    });

    return buildActionPlan({
      buckets,
      opportunityRows,
      notValidated: notValidatedAds as RankingsItem[],
      targetCprByActionType,
      actionType,
      averages: validatedAverages,
    });
  }, [validatedAds, notValidatedAds, validatedAverages, actionType, mqlLeadscoreMin, targetCprByActionType]);

  if (!isClient || !isAuthorized) return <PlanPageSkeleton />;
  if (loading || isLoadingCriteria) return <PlanPageSkeleton />;

  if (selectedPackIds.size === 0 || !packsClient) {
    return (
      <PageContainer variant="analytics" title="Plano de Ação" description="To-do list de anúncios">
        <WorkspaceState kind="empty" message="Selecione ao menos um pack para gerar o plano." framed={false} fill />
      </PageContainer>
    );
  }

  if (!serverData || filteredRankings.length === 0) {
    return (
      <PageContainer variant="analytics" title="Plano de Ação" description="To-do list de anúncios">
        <WorkspaceState kind="empty" message="Nenhum anúncio encontrado para os filtros selecionados." framed={false} fill />
      </PageContainer>
    );
  }

  if (!actionType) {
    return (
      <PageContainer variant="analytics" title="Plano de Ação" description="To-do list de anúncios">
        <WorkspaceState kind="empty" message="Selecione um tipo de conversão para gerar o plano." framed={false} fill />
      </PageContainer>
    );
  }

  return (
    <PageContainer variant="analytics" title="Plano de Ação" description="To-do list de anúncios">
      <AnalyticsWorkspace className="gap-6 overflow-visible">

        {/* Target CPR configuration */}
        <StandardCard variant="default" padding="sm" className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <IconInfoCircle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="text-sm text-muted-foreground">
              Custo-alvo para{" "}
              <span className="font-medium text-foreground">{actionType}</span>
            </span>
            {currentTarget ? (
              <span className="text-sm font-bold text-foreground ml-1">
                {formatCurrency(currentTarget)}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground italic ml-1">(não definido — modo relativo)</span>
            )}
          </div>

          {editingTarget ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">R$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                autoFocus
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveTarget(); if (e.key === "Escape") setEditingTarget(false); }}
                placeholder="ex: 15,00"
                className="w-28 text-sm border border-border rounded-md px-2 py-1 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button onClick={handleSaveTarget} disabled={isSaving} className="p-1 rounded hover:bg-success-10 text-success">
                <IconCheck className="h-4 w-4" />
              </button>
              <button onClick={() => setEditingTarget(false)} className="p-1 rounded hover:bg-muted-30 text-muted-foreground">
                <IconX className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setTargetInput(currentTarget ? String(currentTarget) : ""); setEditingTarget(true); }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted-30"
              >
                <IconPencil className="h-3.5 w-3.5" />
                {currentTarget ? "Editar alvo" : "Definir alvo"}
              </button>
              {currentTarget && (
                <button onClick={handleClearTarget} disabled={isSaving} className="text-xs text-muted-foreground hover:text-destructive transition-colors px-2 py-1 rounded hover:bg-muted-30">
                  Remover
                </button>
              )}
            </div>
          )}
        </StandardCard>

        {/* Action plan list */}
        {actionPlan ? (
          <ActionPlanList
            plan={actionPlan}
            averages={validatedAverages}
            actionType={actionType}
            dateStart={dateRange.start}
            dateStop={dateRange.end}
            packIds={Array.from(selectedPackIds)}
            availableConversionTypes={actionTypeOptions}
          />
        ) : (
          <WorkspaceState
            kind="empty"
            message={
              validationCriteria && validationCriteria.length > 0
                ? "Nenhum anúncio passou nos critérios de validação. Ajuste os critérios ou selecione outro período."
                : "Nenhum dado disponível para gerar o plano."
            }
            framed={false}
            fill
          />
        )}

      </AnalyticsWorkspace>
    </PageContainer>
  );
}

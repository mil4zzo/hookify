"use client";

import { useState, useMemo, useCallback } from "react";
import { useAdPerformancePipeline } from "@/lib/hooks/useAdPerformancePipeline";
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
import type { RankingsItem } from "@/lib/api/schemas";

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
  const { actionType, actionTypeOptions, selectedPackIds, packsClient } = useFilters();

  const { mqlLeadscoreMin } = useMqlLeadscore();
  const { targetCprByActionType, savePreferences, isSaving } = useUserPreferences();
  const formatCurrency = useFormatCurrency();

  const {
    filteredRankings,
    validatedAds,
    notValidatedAds,
    validatedAverages,
    validationCriteria,
    dateRange,
    isLoading,
  } = useAdPerformancePipeline();

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
  if (isLoading) return <PlanPageSkeleton />;

  if (selectedPackIds.size === 0 || !packsClient) {
    return (
      <PageContainer variant="analytics" title="Plano de Ação" description="To-do list de anúncios">
        <WorkspaceState kind="empty" message="Selecione ao menos um pack para gerar o plano." framed={false} fill />
      </PageContainer>
    );
  }

  if (!validatedAds || validatedAds.length === 0) {
    // Distingue "período sem anúncio nenhum" de "anúncios existem mas nenhum passou na validação".
    // Sem a checagem de filteredRankings, um período vazio mostraria "ajuste os critérios"
    // (induzindo o usuário a mexer nos critérios sem motivo).
    const hadAds = filteredRankings.length > 0;
    return (
      <PageContainer variant="analytics" title="Plano de Ação" description="To-do list de anúncios">
        <WorkspaceState
          kind="empty"
          message={
            hadAds && validationCriteria && validationCriteria.length > 0
              ? "Nenhum anúncio passou nos critérios de validação. Ajuste os critérios ou selecione outro período."
              : "Nenhum anúncio encontrado para os filtros selecionados."
          }
          framed={false}
          fill
        />
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
            message="Nenhum dado disponível para gerar o plano."
            framed={false}
            fill
          />
        )}

      </AnalyticsWorkspace>
    </PageContainer>
  );
}

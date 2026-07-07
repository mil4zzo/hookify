"use client";

import { useState, useMemo, useCallback } from "react";
import { useAdPerformancePipeline } from "@/lib/hooks/useAdPerformancePipeline";
import { usePackDiagnostic } from "@/lib/hooks/usePackDiagnostic";
import { splitAdsIntoGoldBuckets } from "@/lib/utils/goldClassification";
import { computeOpportunityScores } from "@/lib/utils/opportunity";
import { buildActionPlan } from "@/lib/utils/actionPlan";
import { PageContainer } from "@/components/common/PageContainer";
import { useAppAuthReady } from "@/lib/hooks/useAppAuthReady";
import { useFilters } from "@/lib/hooks/useFilters";
import { usePacksLoading } from "@/components/layout/PacksLoader";
import { StateSkeleton } from "@/components/common/States";
import { AnalyticsWorkspace, WorkspaceState } from "@/components/common/layout";
import { ActionPlanList } from "@/components/plano/ActionPlanList";
import { PlanHero } from "@/components/plano/PlanHero";
import { PackDiagnosticPanel } from "@/components/plano/PackDiagnosticPanel";
import { DayComparisonBlock } from "@/components/plano/DayComparisonBlock";
import { useMqlLeadscore } from "@/lib/hooks/useMqlLeadscore";
import { useUserPreferences } from "@/lib/hooks/useUserPreferences";
import type { RankingsItem } from "@/lib/api/schemas";
import type { Verdict } from "@/lib/utils/actionPlan";
import type { DiagnosticTarget } from "@/lib/metrics/diagnostics";

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
  const { isLoading: packsLoading } = usePacksLoading();

  const { mqlLeadscoreMin } = useMqlLeadscore();
  const { targetCprByActionType, diagnosticCostMetric, savePreferences, isSaving } = useUserPreferences();

  const {
    filteredRankings,
    validatedAds,
    notValidatedAds,
    serverAverages,
    validationCriteria,
    dateRange,
    isLoading,
  } = useAdPerformancePipeline();

  // ─── Diagnostic hook (single series fetch for both hero + panel) ───────────
  // Descriptive surface → feed it ALL ads (filteredRankings), not just validatedAds:
  // spend/CPR/CPM must match the Meta Ads Manager. Validation stays on the action
  // plan below (judgment). See the "métricas globais" principle.
  const diagnostic = usePackDiagnostic({
    ads: (filteredRankings ?? []) as RankingsItem[],
    actionType: actionType ?? "",
    selectedPackIds,
    dateRange: { start: dateRange.start ?? "", end: dateRange.end ?? "" },
    targetOverride: diagnosticCostMetric,
  });

  // ─── Panel visibility + chip expand state ─────────────────────────────────
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [expandedVerdicts, setExpandedVerdicts] = useState<Verdict[]>([]);

  const handleChipClick = useCallback((verdict: Verdict) => {
    setExpandedVerdicts((prev) =>
      prev.includes(verdict) ? prev : [...prev, verdict]
    );
  }, []);

  // ─── Target CPR handler ───────────────────────────────────────────────────
  const handleSaveTarget = useCallback(async (val?: number) => {
    if (!actionType) return;
    const next = { ...targetCprByActionType };
    if (val !== undefined && val > 0) {
      next[actionType] = val;
    } else {
      delete next[actionType];
    }
    await savePreferences({ targetCprByActionType: next });
  }, [actionType, targetCprByActionType, savePreferences]);

  const currentTarget = actionType ? targetCprByActionType?.[actionType] : undefined;

  // Persisted CPMQL/CPR choice for the day-comparison block (drives all 3 widgets).
  const handleSelectMetric = useCallback((m: DiagnosticTarget) => {
    void savePreferences({ diagnosticCostMetric: m });
  }, [savePreferences]);

  // ─── Action plan ──────────────────────────────────────────────────────────
  // Só existe UMA média: a global ponderada (serverAverages, todos os ads = Meta).
  // `validatedAds` filtra QUEM pode ser julgado; o julgamento em si compara contra
  // a média global — nunca contra uma "média dos validados".
  const actionPlan = useMemo(() => {
    if (!validatedAds || validatedAds.length === 0 || !actionType || !serverAverages) return null;

    const buckets = splitAdsIntoGoldBuckets(validatedAds as RankingsItem[], serverAverages, actionType);

    const opportunityRows = computeOpportunityScores({
      ads: validatedAds as RankingsItem[],
      averages: serverAverages,
      actionType,
      mqlLeadscoreMin: mqlLeadscoreMin || 0,
    });

    return buildActionPlan({
      buckets,
      opportunityRows,
      notValidated: notValidatedAds as RankingsItem[],
      targetCprByActionType,
      actionType,
      averages: serverAverages,
    });
  }, [validatedAds, notValidatedAds, serverAverages, actionType, mqlLeadscoreMin, targetCprByActionType]);

  // ─── Guards ───────────────────────────────────────────────────────────────
  // Ordem importa: TODO estado de "ainda carregando" vem ANTES de qualquer empty state,
  // senão a página pisca um empty prematuro durante o load (packs hidratando → "Selecione
  // um pack" → skeleton → dados). `!packsClient || packsLoading` cobre a janela de
  // hidratação/carregamento dos packs (aí fetchEnabled é false → o isLoading do pipeline
  // ainda não subiu); `isLoading` cobre o fetch de ad-performance em si.
  if (!isClient || !isAuthorized) return <PlanPageSkeleton />;
  if (!packsClient || packsLoading) return <PlanPageSkeleton />;
  if (isLoading) return <PlanPageSkeleton />;

  // A partir daqui os packs estão carregados e o pipeline estabilizou — empties genuínos.
  if (selectedPackIds.size === 0) {
    return (
      <PageContainer variant="analytics" title="Plano de Ação" description="To-do list de anúncios">
        <WorkspaceState kind="empty" message="Selecione ao menos um pack para gerar o plano." framed={false} fill />
      </PageContainer>
    );
  }

  // Sem NENHUM ad no período não há o que diagnosticar nem julgar. Zero VALIDADOS não
  // bloqueia a página: o diagnóstico é descritivo (roda sobre todos os ads) e renderiza
  // mesmo assim — só o plano de ação (juízo) exige validados (empty state no lugar da lista).
  if (filteredRankings.length === 0) {
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

        {/* Day-comparison block (last day vs previous): headline metric + driver cards + top-impact ads */}
        <DayComparisonBlock
          diagnostic={diagnostic}
          actionType={actionType}
          onSelectMetric={handleSelectMetric}
          benchmarkAverages={serverAverages}
          actionTypeOptions={actionTypeOptions}
          selectedPackIds={selectedPackIds}
          dateRange={{ start: dateRange.start ?? "", end: dateRange.end ?? "" }}
          targetCpr={currentTarget}
        />

        {/* Hero: value statement + chips + target CPR + momentum */}
        {actionPlan && (
          <PlanHero
            actionPlan={actionPlan}
            actionType={actionType}
            currentTarget={currentTarget}
            isSaving={isSaving}
            onSaveTarget={handleSaveTarget}
            summary={diagnostic.summary}
            minVolumeOk={diagnostic.minVolumeOk}
            showDiagnostic={showDiagnostic}
            onToggleDiagnostic={() => setShowDiagnostic((v) => !v)}
            onChipClick={handleChipClick}
          />
        )}

        {/* Collapsible diagnostic panel (default closed) */}
        {showDiagnostic && diagnostic.snaps.length > 0 && (
          <PackDiagnosticPanel
            snaps={diagnostic.snaps}
            decomposition={diagnostic.decomposition}
            trendLines={diagnostic.trendLines}
            budgetShareData={diagnostic.budgetShareData}
            target={diagnostic.target}
            adKeyToName={diagnostic.adKeyToName}
            adMap={diagnostic.adMap}
            comparisonLabel={diagnostic.comparisonLabel}
            benchmarkAverages={serverAverages}
            actionType={actionType}
            actionTypeOptions={actionTypeOptions}
            selectedPackIds={selectedPackIds}
            dateRange={{ start: dateRange.start ?? "", end: dateRange.end ?? "" }}
          />
        )}

        {/* Action plan list */}
        {actionPlan ? (
          <ActionPlanList
            plan={actionPlan}
            averages={serverAverages}
            actionType={actionType}
            dateStart={dateRange.start}
            dateStop={dateRange.end}
            packIds={Array.from(selectedPackIds)}
            availableConversionTypes={actionTypeOptions}
            expandedVerdicts={expandedVerdicts}
          />
        ) : (
          <WorkspaceState
            kind="empty"
            message={
              validationCriteria && validationCriteria.length > 0 && (!validatedAds || validatedAds.length === 0)
                ? "Nenhum anúncio passou nos critérios de validação para entrar no plano de ação — o diagnóstico acima considera todos os anúncios. Ajuste os critérios ou selecione outro período."
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

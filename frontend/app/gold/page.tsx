"use client";

import { useAdPerformancePipeline } from "@/lib/hooks/useAdPerformancePipeline";
import { PageContainer } from "@/components/common/PageContainer";
import { useAppAuthReady } from "@/lib/hooks/useAppAuthReady";
import { GoldKanbanWidget } from "@/components/gold/GoldKanbanWidget";
import { GoldTable } from "@/components/gold/GoldTable";
import { StateSkeleton } from "@/components/common/States";
import { AnalyticsWorkspace, DashboardGrid, WorkspaceState } from "@/components/common/layout";
import type { RankingsItem } from "@/lib/api/schemas";

function GoldPageSkeleton() {
  return (
    <PageContainer variant="analytics" title="G.O.L.D." description="Classificação de anúncios por performance">
      <AnalyticsWorkspace>
        <StateSkeleton variant="page" rows={4} className="rounded-md border border-border bg-card" />
      </AnalyticsWorkspace>
    </PageContainer>
  );
}

export default function GoldPage() {
  const { isClient, isAuthorized } = useAppAuthReady();

  const {
    validatedAds: validatedRankings,
    validatedAverages,
    validationCriteria,
    actionType,
    actionTypeOptions,
    selectedPackIds,
    dateRange,
    isLoading,
  } = useAdPerformancePipeline();

  if (!isClient || !isAuthorized) {
    return <GoldPageSkeleton />;
  }

  if (isLoading) {
    return <GoldPageSkeleton />;
  }

  if (!validatedRankings || validatedRankings.length === 0) {
    return (
      <PageContainer variant="analytics" title="G.O.L.D." description="Classificação de anúncios por performance">
        <WorkspaceState kind="empty" message="Nenhum anúncio encontrado para os filtros selecionados." framed={false} fill />
      </PageContainer>
    );
  }

  return (
    <PageContainer variant="analytics" title="G.O.L.D." description="Classificação de anúncios por performance">
      {actionType && validatedAverages && (
        <AnalyticsWorkspace className="gap-8 overflow-visible">
          <GoldKanbanWidget ads={validatedRankings as RankingsItem[]} averages={validatedAverages} actionType={actionType} validationCriteria={validationCriteria || []} dateStart={dateRange.start} dateStop={dateRange.end} availableConversionTypes={actionTypeOptions} packIds={Array.from(selectedPackIds)} />

          <div>
            <h2 className="text-xl font-semibold mb-4">Lista de Anúncios</h2>
            <DashboardGrid className="grid-cols-1 sm:grid-cols-1 xl:grid-cols-1">
              <GoldTable ads={validatedRankings as RankingsItem[]} averages={validatedAverages} actionType={actionType} />
            </DashboardGrid>
          </div>
        </AnalyticsWorkspace>
      )}
    </PageContainer>
  );
}

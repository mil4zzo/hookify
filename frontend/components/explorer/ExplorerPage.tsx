"use client";

import { useMemo, useState } from "react";
import { IconBrandParsinta, IconBulb, IconChartFunnel, IconCircleCheckFilled, IconCurrencyDollar, IconSparkles, IconWorld } from "@tabler/icons-react";
import { PageContainer } from "@/components/common/PageContainer";
import { RetentionVideoPlayer, RetentionVideoPlayerSkeleton } from "@/components/common/RetentionVideoPlayer";
import { VideoMetricCell } from "@/components/common/VideoMetricCell";
import { AnalyticsWorkspace, PageBodyStack, WorkspaceState } from "@/components/common/layout";
import { cn } from "@/lib/utils/cn";
import { explorerPlaceholderPresentation } from "@/lib/explorer/placeholders";
import { buildExplorerFlowSections } from "@/lib/explorer/flowSections";
import type { ExplorerMetricCard, ExplorerSignalItem } from "@/lib/explorer/types";
import { useExplorerData } from "@/lib/explorer/useExplorerData";
import { DEFAULT_EXPLORER_SORT_STATE } from "@/lib/explorer/viewModels";
import { useFormatCurrency } from "@/lib/utils/currency";
import { ExplorerAdsKanbanList } from "./ExplorerAdsKanbanList";

function getToneStyles(tone: "neutral" | "positive" | "warning" | "critical") {
  switch (tone) {
    case "positive":
      return "border-border bg-secondary text-success";
    case "warning":
      return "border-border bg-secondary text-attention";
    case "critical":
      return "border-border bg-secondary text-destructive";
    case "neutral":
      return "border-border bg-secondary text-secondary-foreground";
  }
}

function SignalList({ title, icon: Icon, items }: { title: string; icon: typeof IconSparkles; items: ExplorerSignalItem[] }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-primary shadow-sm">
          <Icon className="h-4 w-4" />
        </div>
        <div className="space-y-1">
          <p className="text-lg font-semibold text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">{title === "Insights" ? "Pontos que merecem atenção." : "Lista de ações práticas para tomar agora."}</p>
        </div>
      </div>

      <div className="space-y-3">
        {items.map((item) => (
          <div key={`${title}-${item.title}`} className={cn("rounded-md border p-5 shadow-sm transition-colors", getToneStyles(item.tone))}>
            <div className="flex items-start gap-2">
              <span className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-background-70">
                <IconCircleCheckFilled className="h-3.5 w-3.5" />
              </span>
              <div className="space-y-1">
                <p className="text-sm font-semibold leading-tight text-foreground">{item.title}</p>
                <p className="text-sm leading-snug text-muted-foreground">{item.detail}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FlowMetricCard({ chip }: { chip: ExplorerMetricCard }) {
  return <VideoMetricCell {...chip} valueClassName="text-sm" />;
}

function FlowColumnLabel({ title, icon: Icon, tone }: { title: string; icon: typeof IconCurrencyDollar; tone: "success" | "attention" | "destructive" | "primary" }) {
  const toneClassName =
    tone === "success"
      ? "border-success-30 bg-success-10 text-success"
      : tone === "attention"
        ? "border-warning-30 bg-warning-20 text-attention"
        : tone === "destructive"
          ? "border-destructive-20 bg-destructive-10 text-destructive"
          : "border-primary-20 bg-primary-10 text-primary";

  return (
    <div className={cn("flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold", toneClassName)}>
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span>{title}</span>
    </div>
  );
}

function ExplorerDetailSkeleton() {
  return <WorkspaceState kind="loading" label="Carregando detalhe do criativo..." fill />;
}

export function ExplorerPage() {
  const [sortState, setSortState] = useState(DEFAULT_EXPLORER_SORT_STATE);
  const { status, actionType, listItems, selectedGroupKey, setSelectedGroupKey, selectedAd, selectedDetail, averagePrimaryMetric, metricAverages, isLoadingDetail, isLoadingMedia } = useExplorerData(sortState);
  const formatCurrency = useFormatCurrency();
  const explorerSidebar = useMemo(
    () => <ExplorerAdsKanbanList ads={listItems} selectedGroupKey={selectedGroupKey} onSelectAd={setSelectedGroupKey} averagePrimaryMetric={averagePrimaryMetric} actionType={actionType} sortState={sortState} onSortChange={setSortState} />,
    [actionType, averagePrimaryMetric, listItems, selectedGroupKey, setSelectedGroupKey, sortState],
  );

  if (status.kind === "loading") {
    return (
      <PageContainer variant="analytics" title="Breakdown" description="Veja onde melhorar e o que fazer." fullWidth hideHeader contentClassName="min-w-0">
        <WorkspaceState kind="loading" label="Montando Explorer..." fill />
      </PageContainer>
    );
  }

  if (status.kind === "needs-packs" || status.kind === "needs-range") {
    return (
      <PageContainer variant="analytics" title="Breakdown" description="Veja onde melhorar e o que fazer." fullWidth hideHeader contentClassName="min-w-0">
        <WorkspaceState kind="empty" message={status.message} fill />
      </PageContainer>
    );
  }

  if (status.kind === "error") {
    return (
      <PageContainer variant="analytics" title="Breakdown" description="Veja onde melhorar e o que fazer." fullWidth hideHeader contentClassName="min-w-0">
        <WorkspaceState kind="error" message={status.message} fill />
      </PageContainer>
    );
  }

  if (listItems.length === 0) {
    return (
      <PageContainer variant="analytics" title="Breakdown" description="Veja onde melhorar e o que fazer." fullWidth hideHeader contentClassName="min-w-0">
        <WorkspaceState kind="empty" message="Nenhum criativo de video foi encontrado para os filtros atuais." fill />
      </PageContainer>
    );
  }

  const flowSections = selectedDetail ? buildExplorerFlowSections(selectedDetail.detail, metricAverages, formatCurrency) : null;
  const placeholder = explorerPlaceholderPresentation;
  const statusSource = selectedDetail?.rawAd ?? selectedAd;
  const totalVariations = statusSource ? Number(statusSource.ad_count ?? 0) : 0;
  const activeVariations = statusSource ? Number(statusSource.active_count ?? totalVariations) : 0;
  const statusDotClass = activeVariations > 0 ? "bg-success" : "bg-destructive";
  const explorerPageTitle = selectedAd ? String(selectedAd.ad_name || "Criativo sem nome") : "Explorer";
  const explorerPageDescription =
    selectedAd != null ? (
      <div className="flex items-center gap-1.5">
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDotClass)} aria-hidden />
        <span>{`Status: ${activeVariations} / ${totalVariations} ativos`}</span>
      </div>
    ) : undefined;

  return (
    <PageContainer variant="analytics" title={explorerPageTitle} description={explorerPageDescription} fullWidth contentClassName="min-w-0" pageSidebar={explorerSidebar} pageSidebarClassName="md:w-[360px]" pageSidebarMobileBehavior="stack">
      <AnalyticsWorkspace className="overflow-visible">
        {!selectedDetail || isLoadingDetail ? (
          <ExplorerDetailSkeleton />
        ) : (
        <PageBodyStack className="space-y-10">
          <div className="grid gap-8 xl:grid-cols-[260px_minmax(0,1fr)] xl:items-start">
            <div className="w-full max-w-[260px] shadow-md">
              <div className="relative rounded-lg border-8 border-surface bg-black/60" style={{ aspectRatio: "9 / 16" }}>
                {isLoadingMedia ? <RetentionVideoPlayerSkeleton /> : selectedDetail.detail.videoSourceUrl ? <RetentionVideoPlayer src={selectedDetail.detail.videoSourceUrl} retentionCurve={selectedDetail.detail.retentionSeries} showRetentionYAxisLabels={false} /> : <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">Video nao disponivel para este criativo.</div>}
              </div>
            </div>

            <div className="min-w-0">
              <div className="grid gap-6 xl:grid-cols-2 xl:gap-8">
                <SignalList title="Insights" icon={IconSparkles} items={placeholder.insights} />
                <SignalList title="Acoes" icon={IconBulb} items={placeholder.actions} />
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <p className="text-xl font-semibold text-foreground">Diagnostico do fluxo</p>

            <div className="grid gap-1 xl:grid-cols-9 xl:items-start">
              <div className="min-w-0 space-y-3 xl:col-span-1">
                <FlowColumnLabel title="Leilao" icon={IconCurrencyDollar} tone="success" />
                <div className="grid min-w-0 grid-cols-1 gap-3">
                  {flowSections?.auction.map((chip) => (
                    <FlowMetricCard key={chip.label} chip={chip} />
                  ))}
                </div>
              </div>

              <div className="min-w-0 space-y-3 xl:col-span-4">
                <FlowColumnLabel title="Retencao" icon={IconBrandParsinta} tone="attention" />
                <div className="grid min-w-0 gap-1 sm:grid-cols-2 xl:grid-cols-4">
                  {flowSections?.retention.map((chip) => (
                    <FlowMetricCard key={chip.label} chip={chip} />
                  ))}
                </div>
              </div>

              <div className="min-w-0 space-y-3 xl:col-span-3">
                <FlowColumnLabel title="Funil" icon={IconChartFunnel} tone="destructive" />
                <div className="grid min-w-0 gap-1 sm:grid-cols-2 xl:grid-cols-3">
                  {flowSections?.funnel.map((chip) => (
                    <FlowMetricCard key={chip.label} chip={chip} />
                  ))}
                </div>
              </div>

              <div className="min-w-0 space-y-3 xl:col-span-1">
                <FlowColumnLabel title="Resultados" icon={IconWorld} tone="primary" />
                <div className="grid min-w-0 grid-cols-1 gap-3">
                  {flowSections?.results.map((chip) => (
                    <FlowMetricCard key={chip.label} chip={chip} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </PageBodyStack>
        )}
      </AnalyticsWorkspace>
    </PageContainer>
  );
}

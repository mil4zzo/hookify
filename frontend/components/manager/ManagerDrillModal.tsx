"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { ColumnFiltersState } from "@tanstack/react-table";
import { AppDialog } from "@/components/common/AppDialog";
import { ExpandedChildrenRow } from "@/components/manager/ExpandedChildrenRow";
import { CampaignChildrenRow } from "@/components/manager/CampaignChildrenRow";
import { ManagerDrillBreadcrumb } from "@/components/manager/ManagerDrillBreadcrumb";
import { useDrillState } from "@/lib/manager/useDrillState";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import type { RankingsItem, RankingsChildrenItem } from "@/lib/api/schemas";

interface ManagerDrillModalProps {
  dateStart?: string;
  dateStop?: string;
  selectedPackIds?: string[];
  actionType?: string;
  formatCurrency: (n: number) => string;
  formatPct: (v: number) => string;
  activeColumns: Set<ManagerColumnType>;
  hasSheetIntegration?: boolean;
  mqlLeadscoreMin?: number;
  /** Acionado ao clicar em uma linha terminal (ad). O parent abre o AdDetailsDialog existente. */
  onSelectAd: (ad: RankingsItem) => void;
}

const KIND_TITLE: Record<"campaign" | "adset" | "adname", string> = {
  campaign: "Conjuntos da campanha",
  adset: "Anúncios do conjunto",
  adname: "Variações do anúncio",
};

export function ManagerDrillModal({
  dateStart,
  dateStop,
  selectedPackIds = [],
  actionType = "",
  formatCurrency,
  formatPct,
  activeColumns,
  hasSheetIntegration = false,
  mqlLeadscoreMin = 0,
  onSelectAd,
}: ManagerDrillModalProps) {
  const { stack, isOpen, current, push, popTo, close } = useDrillState();

  // Filtros locais de coluna por nível atual — resetam ao trocar de step (chave de currentKey).
  const currentKey = current ? `${current.kind}:${current.id}` : null;
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  useEffect(() => {
    setColumnFilters([]);
  }, [currentKey]);

  const title = useMemo(() => {
    if (!current) return "Drill";
    return KIND_TITLE[current.kind];
  }, [current]);

  if (!isOpen || !current) return null;

  const handleAdsetRowClick = (adset: RankingsItem) => {
    const adsetId = String((adset as any).adset_id || "").trim();
    if (!adsetId) return;
    const adsetName = String((adset as any).adset_name || "") || null;
    push({ kind: "adset", id: adsetId, name: adsetName });
  };

  const handleAdRowClick = (ad: RankingsChildrenItem) => {
    onSelectAd(ad as unknown as RankingsItem);
  };

  let body: React.ReactNode = null;
  if (current.kind === "campaign") {
    body = (
      <CampaignChildrenRow
        campaignId={current.id}
        dateStart={dateStart || ""}
        dateStop={dateStop || ""}
        packIds={selectedPackIds}
        actionType={actionType}
        formatCurrency={formatCurrency}
        formatPct={formatPct}
        activeColumns={activeColumns}
        hasSheetIntegration={hasSheetIntegration}
        mqlLeadscoreMin={mqlLeadscoreMin}
        columnFilters={columnFilters}
        setColumnFilters={setColumnFilters}
        asContent
        onRowClick={handleAdsetRowClick}
      />
    );
  } else if (current.kind === "adset") {
    body = (
      <ExpandedChildrenRow
        adsetId={current.id}
        dateStart={dateStart || ""}
        dateStop={dateStop || ""}
        actionType={actionType}
        packIds={selectedPackIds}
        formatCurrency={formatCurrency}
        formatPct={formatPct}
        activeColumns={activeColumns}
        hasSheetIntegration={hasSheetIntegration}
        mqlLeadscoreMin={mqlLeadscoreMin}
        columnFilters={columnFilters}
        setColumnFilters={setColumnFilters}
        asContent
        onRowClick={handleAdRowClick}
      />
    );
  } else {
    body = (
      <ExpandedChildrenRow
        adName={current.id}
        dateStart={dateStart || ""}
        dateStop={dateStop || ""}
        actionType={actionType}
        packIds={selectedPackIds}
        formatCurrency={formatCurrency}
        formatPct={formatPct}
        activeColumns={activeColumns}
        hasSheetIntegration={hasSheetIntegration}
        mqlLeadscoreMin={mqlLeadscoreMin}
        columnFilters={columnFilters}
        setColumnFilters={setColumnFilters}
        asContent
        onRowClick={handleAdRowClick}
      />
    );
  }

  return (
    <AppDialog
      isOpen={isOpen}
      onClose={close}
      title={title}
      size="5xl"
      padding="none"
      mobileVariant="bottom-sheet"
      className="flex h-[90dvh] min-h-0 flex-col overflow-hidden"
      bodyClassName="flex min-h-0 flex-1 flex-col"
    >
      <header className="flex items-start border-b border-border px-6 py-4 pr-12">
        <ManagerDrillBreadcrumb stack={stack} onNavigate={popTo} />
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
        {body}
      </div>
    </AppDialog>
  );
}

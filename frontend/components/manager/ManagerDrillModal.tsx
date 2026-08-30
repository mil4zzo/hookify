"use client";

import { EMPTY_RULE_TREE, type RuleTree } from "@/lib/rules/types";

import React, { useEffect, useMemo, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { ExpandedChildrenRow } from "@/components/manager/ExpandedChildrenRow";
import { CampaignChildrenRow } from "@/components/manager/CampaignChildrenRow";
import { ManagerDrillBreadcrumb, KIND_LABEL, type DrillCrumb } from "@/components/manager/ManagerDrillBreadcrumb";
import { useDrillState } from "@/lib/manager/useDrillState";
import { useAdVariations, useAdsetChildren } from "@/lib/api/hooks";
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
  /** Ordem das colunas de métrica escolhida no Manager — o drill espelha a tabela de origem. */
  columnOrder?: readonly ManagerColumnType[];
  hasSheetIntegration?: boolean;
  mqlLeadscoreMin?: number | null;
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
  columnOrder,
  hasSheetIntegration = false,
  mqlLeadscoreMin = null,
  onSelectAd,
}: ManagerDrillModalProps) {
  const { stack, isOpen, current, push, popTo, close } = useDrillState();

  // Filtros locais de coluna por nível atual — resetam ao trocar de step (chave de currentKey).
  const currentKey = current ? `${current.kind}:${current.id}` : null;
  const [rules, setRules] = useState<RuleTree>(EMPTY_RULE_TREE);
  useEffect(() => {
    setRules(EMPTY_RULE_TREE);
  }, [currentKey]);

  const title = useMemo(() => {
    if (!current) return "Drill";
    return KIND_TITLE[current.kind];
  }, [current]);

  // Nomes dos ancestrais vêm das linhas-filhas já carregadas pelo corpo do modal (mesma
  // queryKey → cache do TanStack, sem request extra). É a única fonte que sabe se o nível
  // atual tem UM pai: um ad_name pode viver em vários conjuntos/campanhas.
  const adNameLevel = current?.kind === "adname" ? current.id : "";
  const adsetLevel = current?.kind === "adset" ? current.id : "";
  const variationsQuery = useAdVariations(adNameLevel, dateStart || "", dateStop || "", selectedPackIds, !!adNameLevel);
  const adsetChildrenQuery = useAdsetChildren(adsetLevel, dateStart || "", dateStop || "", selectedPackIds, !!adsetLevel);
  const childrenRows = adNameLevel ? variationsQuery.data : adsetLevel ? adsetChildrenQuery.data : undefined;

  const parentNames = useMemo(() => {
    if (!childrenRows || childrenRows.length === 0) return null;
    const campaigns = new Set<string>();
    const adsets = new Set<string>();
    for (const row of childrenRows) {
      const campaign = String(row.campaign_name || "").trim();
      if (campaign) campaigns.add(campaign);
      const adset = String(row.adset_name || "").trim();
      if (adset) adsets.add(adset);
    }
    return { campaign: [...campaigns], adset: [...adsets] };
  }, [childrenRows]);

  const currentNoun = current ? KIND_LABEL[current.kind].toLowerCase() : "item";

  const crumbs = useMemo<DrillCrumb[]>(
    () =>
      stack.map((step, index) => {
        const isLast = index === stack.length - 1;
        // Só os ancestrais são reconciliados: no último crumb, adset/campaign do filho
        // descrevem o próprio nível, não o pai.
        const observed = !isLast && step.kind !== "adname" ? parentNames?.[step.kind] : undefined;
        if (observed && observed.length > 1) {
          const noun = step.kind === "campaign" ? "campanhas" : "conjuntos";
          return {
            kind: step.kind,
            label: `Vários (${observed.length})`,
            interactive: false,
            hint: `Este ${currentNoun} existe em ${observed.length} ${noun}`,
          };
        }
        const cached = step.name?.trim() || "";
        const label = cached || (observed?.length === 1 ? observed[0] : "") || `${KIND_LABEL[step.kind]} #${step.id}`;
        return { kind: step.kind, label };
      }),
    [stack, parentNames, currentNoun],
  );

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
        columnOrder={columnOrder}
        hasSheetIntegration={hasSheetIntegration}
        mqlLeadscoreMin={mqlLeadscoreMin}
        rules={rules}
        setRules={setRules}
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
        columnOrder={columnOrder}
        hasSheetIntegration={hasSheetIntegration}
        mqlLeadscoreMin={mqlLeadscoreMin}
        rules={rules}
        setRules={setRules}
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
        columnOrder={columnOrder}
        hasSheetIntegration={hasSheetIntegration}
        mqlLeadscoreMin={mqlLeadscoreMin}
        rules={rules}
        setRules={setRules}
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
        <ManagerDrillBreadcrumb crumbs={crumbs} onNavigate={popTo} />
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
        {body}
      </div>
    </AppDialog>
  );
}

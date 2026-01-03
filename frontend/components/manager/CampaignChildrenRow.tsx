"use client";

import React, { useMemo, useState } from "react";
import { useCampaignChildren } from "@/lib/api/hooks";
import type { RankingsItem } from "@/lib/api/schemas";

type SortColumn = "adset" | "hook" | "cpr" | "spend" | "ctr" | "page_conv";

interface CampaignChildrenRowProps {
  row: { getVisibleCells: () => any[] };
  campaignId: string;
  dateStart: string;
  dateStop: string;
  actionType?: string;
  formatCurrency: (n: number) => string;
  formatPct: (v: number) => string;
}

// Função de comparação customizada para React.memo
function areCampaignChildrenRowPropsEqual(prev: CampaignChildrenRowProps, next: CampaignChildrenRowProps): boolean {
  return (
    prev.campaignId === next.campaignId &&
    prev.dateStart === next.dateStart &&
    prev.dateStop === next.dateStop &&
    prev.actionType === next.actionType &&
    prev.formatCurrency === next.formatCurrency &&
    prev.formatPct === next.formatPct &&
    prev.row === next.row
  );
}

export const CampaignChildrenRow = React.memo(function CampaignChildrenRow({
  row,
  campaignId,
  dateStart,
  dateStop,
  actionType,
  formatCurrency,
  formatPct,
}: CampaignChildrenRowProps) {
  const { data: childrenData, isLoading, isError } = useCampaignChildren(campaignId, dateStart, dateStop, true);
  const [sortConfig, setSortConfig] = useState<{ column: SortColumn | null; direction: "asc" | "desc" }>({ column: null, direction: "asc" });

  const sortedData = useMemo(() => {
    if (!childrenData || childrenData.length === 0) return [];

    const rows = (childrenData as RankingsItem[]).map((child) => {
      const conversions = (child as any)?.conversions || {};
      const results = actionType && actionType.trim() ? Number(conversions[actionType] || 0) : 0;
      const lpv = Number((child as any)?.lpv || 0);
      const spend = Number((child as any)?.spend || 0);
      const page_conv = lpv > 0 ? results / lpv : 0;
      const cpr = results > 0 ? spend / results : 0;

      return {
        child,
        metrics: {
          adsetLabel: String((child as any)?.adset_name || (child as any)?.ad_name || (child as any)?.adset_id || "—"),
          hook: Number((child as any)?.hook || 0),
          spend,
          ctr: Number((child as any)?.ctr || 0),
          page_conv,
          cpr,
        },
      };
    });

    if (!sortConfig.column) return rows;

    const sorted = [...rows].sort((a, b) => {
      const dir = sortConfig.direction === "asc" ? 1 : -1;
      switch (sortConfig.column) {
        case "adset":
          return dir * a.metrics.adsetLabel.localeCompare(b.metrics.adsetLabel);
        case "hook":
          return dir * (a.metrics.hook - b.metrics.hook);
        case "cpr":
          return dir * ((a.metrics.cpr || 0) - (b.metrics.cpr || 0));
        case "spend":
          return dir * ((a.metrics.spend || 0) - (b.metrics.spend || 0));
        case "ctr":
          return dir * (a.metrics.ctr - b.metrics.ctr);
        case "page_conv":
          return dir * ((a.metrics.page_conv || 0) - (b.metrics.page_conv || 0));
        default:
          return 0;
      }
    });

    return sorted;
  }, [childrenData, sortConfig, actionType]);

  const handleSort = (column: SortColumn) => {
    setSortConfig((prev) => {
      if (prev.column === column) {
        return { column, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { column, direction: column === "adset" ? "asc" : "desc" };
    });
  };

  if (isLoading) {
    return (
      <tr className="bg-border">
        <td className="p-0" colSpan={row.getVisibleCells().length}>
          <div className="p-2 pl-8">
            <div className="text-sm text-muted-foreground">Carregando conjuntos...</div>
          </div>
        </td>
      </tr>
    );
  }

  if (isError) {
    return (
      <tr className="bg-border">
        <td className="p-0" colSpan={row.getVisibleCells().length}>
          <div className="p-2 pl-8">
            <div className="text-sm text-destructive">Erro ao carregar conjuntos.</div>
          </div>
        </td>
      </tr>
    );
  }

  if (!childrenData || childrenData.length === 0) {
    return (
      <tr className="bg-border">
        <td className="p-0" colSpan={row.getVisibleCells().length}>
          <div className="p-2 pl-8">
            <div className="text-sm text-muted-foreground">Sem conjuntos no período.</div>
          </div>
        </td>
      </tr>
    );
  }

  const thClass = "px-4 py-3 text-left text-xs uppercase tracking-wide text-muted-foreground cursor-pointer select-none hover:text-brand";
  const tdClass = "px-4 py-3 text-sm text-muted-foreground";

  return (
    <tr className="bg-border">
      <td className="p-0" colSpan={row.getVisibleCells().length}>
        <div className="p-3 pl-8">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={thClass} onClick={() => handleSort("adset")}>
                    Conjunto
                  </th>
                  <th className={thClass} onClick={() => handleSort("hook")}>
                    Hook
                  </th>
                  <th className={thClass} onClick={() => handleSort("cpr")}>
                    CPR
                  </th>
                  <th className={thClass} onClick={() => handleSort("spend")}>
                    Spend
                  </th>
                  <th className={thClass} onClick={() => handleSort("ctr")}>
                    CTR
                  </th>
                  <th className={thClass} onClick={() => handleSort("page_conv")}>
                    Page
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedData.map(({ child, metrics }, idx) => (
                  <tr key={String((child as any)?.adset_id || (child as any)?.ad_name || idx)} className="border-t border-border/60">
                    <td className={tdClass}>{metrics.adsetLabel}</td>
                    <td className={tdClass}>{formatPct(metrics.hook * 100)}</td>
                    <td className={tdClass}>{metrics.cpr ? formatCurrency(metrics.cpr) : "—"}</td>
                    <td className={tdClass}>{metrics.spend ? formatCurrency(metrics.spend) : "—"}</td>
                    <td className={tdClass}>{formatPct(metrics.ctr * 100)}</td>
                    <td className={tdClass}>{metrics.page_conv ? formatPct(metrics.page_conv * 100) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </td>
    </tr>
  );
}, areCampaignChildrenRowPropsEqual);



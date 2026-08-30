"use client";

import { useMemo, useState } from "react";
import { IconChevronDown, IconChevronRight, IconChevronUp, IconPencil, IconTrash } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { StandardCard } from "@/components/common/StandardCard";
import { BoardCreativeCard } from "@/components/boards/BoardCreativeCard";
import { summarizeBoardGroup, sortBoardRows } from "@/lib/boards/aggregate";
import { countRuleConditions, filterRowsByRules } from "@/lib/rules/evaluate";
import { getManagerMetricLabel } from "@/lib/metrics";
import { isEmptyRuleTree, normalizeRuleTree } from "@/lib/rules/types";
import type { BoardGroup } from "@/lib/boards/types";
import { tagDotClasses } from "@/lib/tags/colors";
import { formatLocaleInteger, useFormatCurrency } from "@/lib/utils/currency";
import { cn } from "@/lib/utils/cn";

/** Quantos cards a faixa mostra antes do "Carregar mais". */
const PAGE_SIZE = 12;

export interface BoardGroupBandProps {
  group: BoardGroup;
  /** Linhas do recorte inteiro. O filtro da regra acontece aqui, no cliente. */
  rows: readonly Record<string, any>[];
  /** Spend de todo o recorte — denominador da fatia mostrada no cabeçalho. */
  totalSpend: number;
  actionType?: string;
  hasSheetIntegration?: boolean;
  mqlLeadscoreMin?: number | null;
  isFirst?: boolean;
  isLast?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
  onOpenAd: (row: Record<string, any>) => void;
}

export function BoardGroupBand({
  group,
  rows,
  totalSpend,
  actionType,
  hasSheetIntegration = false,
  mqlLeadscoreMin = null,
  isFirst = false,
  isLast = false,
  onEdit,
  onDelete,
  onMove,
  onOpenAd,
}: BoardGroupBandProps) {
  const formatCurrency = useFormatCurrency();
  const [collapsed, setCollapsed] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const rules = useMemo(() => normalizeRuleTree(group.rules), [group.rules]);

  const matched = useMemo(
    () =>
      sortBoardRows(
        filterRowsByRules(rows, rules, { actionType, mqlLeadscoreMin }),
        group.sort_metric,
        group.sort_direction,
        { actionType, mqlLeadscoreMin },
      ),
    [rows, rules, group.sort_metric, group.sort_direction, actionType, mqlLeadscoreMin],
  );

  const summary = useMemo(
    () => summarizeBoardGroup(matched, { actionType, hasSheetIntegration, mqlLeadscoreMin, totalSpend }),
    [matched, actionType, hasSheetIntegration, mqlLeadscoreMin, totalSpend],
  );

  const conditionCount = countRuleConditions(rules);
  const visible = matched.slice(0, visibleCount);
  const remaining = matched.length - visible.length;

  return (
    <StandardCard padding="none" className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={() => setCollapsed((previous) => !previous)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <IconChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          ) : (
            <IconChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          )}
          <span className={cn("h-2.5 w-2.5 flex-shrink-0 rounded-full", tagDotClasses(group.color))} />
          <span className="truncate font-medium text-foreground">{group.name}</span>
          <span className="flex-shrink-0 text-2xs text-muted-foreground">
            {isEmptyRuleTree(rules)
              ? "sem condição"
              : `${conditionCount} ${conditionCount === 1 ? "condição" : "condições"}`}
          </span>
        </button>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Aggregate label="Criativos" value={formatLocaleInteger(summary.count)} />
          <Aggregate
            label="Spend"
            value={formatCurrency(summary.spend)}
            hint={summary.spendShare != null ? `${(summary.spendShare * 100).toFixed(0)}% do recorte` : undefined}
          />
          <Aggregate label="Resultados" value={formatLocaleInteger(summary.results)} />
          {/* CPR do grupo = soma(spend)/soma(resultados), nunca a média dos CPRs. */}
          <Aggregate label="CPR" value={summary.cpr != null ? formatCurrency(summary.cpr) : "—"} />
        </div>

        <div className="flex flex-shrink-0 items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => onMove(-1)} disabled={isFirst} aria-label="Mover para cima">
            <IconChevronUp className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onMove(1)} disabled={isLast} aria-label="Mover para baixo">
            <IconChevronDown className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onEdit} aria-label="Editar grupo">
            <IconPencil className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onDelete} aria-label="Apagar grupo">
            <IconTrash className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-3">
          {matched.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {isEmptyRuleTree(rules)
                ? "Nenhum criativo no recorte atual."
                : "Nenhum criativo do recorte atual atende às condições deste grupo."}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-grid-compact sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {visible.map((row, index) => (
                  <BoardCreativeCard
                    key={String(row.group_key || row.ad_name || row.ad_id || index)}
                    row={row}
                    highlightMetric={group.sort_metric}
                    actionType={actionType}
                    mqlLeadscoreMin={mqlLeadscoreMin}
                    onOpen={() => onOpenAd(row)}
                  />
                ))}
              </div>

              {remaining > 0 && (
                <div className="mt-3 flex justify-center">
                  <Button type="button" variant="outline" size="sm" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
                    Carregar mais ({remaining})
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {collapsed && matched.length > 0 && (
        <p className="px-3 py-2 text-2xs text-muted-foreground">
          Ordenado por {getManagerMetricLabel(group.sort_metric)} ({group.sort_direction === "asc" ? "menor primeiro" : "maior primeiro"}).
        </p>
      )}
    </StandardCard>
  );
}

function Aggregate({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="whitespace-nowrap text-sm font-medium text-foreground">
        {value}
        {hint && <span className="ml-1 text-2xs font-normal text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}

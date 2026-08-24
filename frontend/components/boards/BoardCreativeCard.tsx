"use client";

import { useMemo } from "react";

import { AdPlayArea } from "@/components/common/AdPlayArea";
import { StandardCard } from "@/components/common/StandardCard";
import { formatManagerMetricValue, getManagerMetricLabel, getMetricNumericValueOrNull } from "@/lib/metrics";
import { tagChipClasses } from "@/lib/tags/colors";
import { formatLocaleInteger, useFormatCurrency } from "@/lib/utils/currency";
import type { RankingsRowTag } from "@/lib/api/schemas";
import { cn } from "@/lib/utils/cn";

/** Métricas que a régua do rodapé já mostra — não vale repetir no destaque. */
const FOOTER_METRICS = new Set(["spend", "results", "cpr"]);

const MAX_VISIBLE_TAGS = 3;

export interface BoardCreativeCardProps {
  row: Record<string, any>;
  /** Métrica de ordenação do grupo — vira o destaque quando não está no rodapé. */
  highlightMetric?: string;
  actionType?: string;
  mqlLeadscoreMin?: number | null;
  onOpen?: () => void;
}

export function BoardCreativeCard({ row, highlightMetric, actionType, mqlLeadscoreMin = null, onOpen }: BoardCreativeCardProps) {
  const formatCurrency = useFormatCurrency();

  const name = String(row.ad_name || row.group_key || "—");
  const tags: RankingsRowTag[] = Array.isArray(row.tags) ? row.tags : [];
  const visibleTags = tags.slice(0, MAX_VISIBLE_TAGS);
  const hiddenTagCount = tags.length - visibleTags.length;

  const context = useMemo(() => ({ actionType, mqlLeadscoreMin }), [actionType, mqlLeadscoreMin]);

  const spend = getMetricNumericValueOrNull(row, "spend", context) ?? 0;
  const results = getMetricNumericValueOrNull(row, "results", context) ?? 0;
  const cpr = getMetricNumericValueOrNull(row, "cpr", context);

  const highlight = useMemo(() => {
    if (!highlightMetric || FOOTER_METRICS.has(highlightMetric)) return null;
    const value = getMetricNumericValueOrNull(row, highlightMetric, context);
    if (value == null || !Number.isFinite(value)) return null;
    return {
      label: getManagerMetricLabel(highlightMetric),
      value: formatManagerMetricValue(highlightMetric, value, { currencyFormatter: formatCurrency }),
    };
  }, [highlightMetric, row, context, formatCurrency]);

  return (
    <StandardCard
      padding="none"
      className={cn(
        "group flex w-full flex-col overflow-hidden transition-shadow",
        onOpen && "cursor-pointer hover:shadow-elevation-raised",
      )}
      onClick={onOpen}
    >
      <div className="relative">
        <AdPlayArea ad={row} alt={name} aspectRatio="3:4" className="w-full" onPlayClick={onOpen} />
        {highlight && (
          <div className="absolute right-1.5 top-1.5 rounded bg-background-80 px-1.5 py-0.5 text-right backdrop-blur-sm">
            <div className="text-2xs uppercase tracking-wide text-muted-foreground">{highlight.label}</div>
            <div className="text-sm font-medium text-foreground">{highlight.value}</div>
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2">
        <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground" title={name}>
          {name}
        </p>

        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {visibleTags.map((tag) => (
              <span key={tag.id} className={cn("truncate rounded border px-1 py-px text-2xs", tagChipClasses(tag.color))}>
                {tag.name}
              </span>
            ))}
            {hiddenTagCount > 0 && <span className="text-2xs text-muted-foreground">+{hiddenTagCount}</span>}
          </div>
        )}

        <div className="mt-auto grid grid-cols-3 gap-1 border-t border-border pt-1.5">
          <Stat label="Spend" value={formatCurrency(spend)} />
          <Stat label="Result." value={formatLocaleInteger(results)} />
          {/* Sem resultado não existe CPR — mostrar 0 diria "custo zero". */}
          <Stat label="CPR" value={cpr != null && Number.isFinite(cpr) ? formatCurrency(cpr) : "—"} />
        </div>
      </div>
    </StandardCard>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-2xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate text-2xs font-medium text-foreground" title={value}>
        {value}
      </div>
    </div>
  );
}

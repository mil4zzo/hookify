"use client";

import React from "react";
import type { RankingsItem } from "@/lib/api/schemas";
import { cn } from "@/lib/utils/cn";
import { formatMetricValue } from "@/lib/metrics";
import { getMetricQualityToneByAverage, getMetricValueTextClass } from "@/lib/utils/metricQuality";
import {
  getRowLeadEconomics,
  leadMarginTone,
  type LeadEconomicsByPack,
  type LeadEconomicsResult,
  type LeadEconomicsUnavailableReason,
} from "@/lib/utils/leadEconomics";

export type LeadEconomicsMetric = "cpl_ceiling" | "lead_margin";

/** Por que a célula está vazia — no `title`, como as outras células leves da tabela. */
export const LEAD_ECONOMICS_UNAVAILABLE_TEXT: Record<LeadEconomicsUnavailableReason, string> = {
  "no-economics": "Sem economia do lead cadastrada no pack deste anúncio.",
  "mixed-economics": "Os packs deste anúncio têm economias do lead diferentes: não há um teto só para ele.",
  "no-scored-leads": "Nenhum lead com nota no período.",
};

/**
 * Texto do `title` de uma célula com valor. Exportado para o teste prender o que o
 * usuário lê ao passar o mouse.
 */
export function describeLeadEconomicsValue(result: LeadEconomicsResult, formatCurrency: (n: number) => string): string {
  const parts: string[] = [];
  parts.push(result.cplActual === null ? "sem gasto no período" : `${formatCurrency(result.cplActual)} por lead com nota`);
  parts.push(`teto ${formatCurrency(result.cplCeiling)}`);
  if (result.targetMargin !== null) parts.push(`meta ${formatMetricValue("lead_margin", result.targetMargin)}`);
  parts.push(`${result.leadsScored} ${result.leadsScored === 1 ? "lead" : "leads"} com nota`);
  const text = parts.join(" · ");
  return result.lowSample ? `Número instável — ${text}` : text;
}

/** Margem sem número apesar de haver conta: nenhum faturamento esperado, ou nenhum gasto. */
function describeMissingMargin(result: LeadEconomicsResult): string {
  if (result.revenuePerLead <= 0) return "Nenhum lead deste anúncio está numa faixa que compra: não há faturamento para dividir.";
  return "Sem gasto no período: não há custo por lead para comparar.";
}

interface LeadEconomicsCellProps {
  row: RankingsItem;
  metric: LeadEconomicsMetric;
  byPack: LeadEconomicsByPack;
  formatCurrency: (n: number) => string;
  minimal?: boolean;
  /** Toggle "Comparar com a média": só o Teto segue; a Margem tem cor própria (três estados). */
  colorMetricValue?: boolean;
  /** Média do conjunto para a cor do Teto. */
  average?: number | null;
}

/**
 * Célula de Teto de CPL e Margem.
 *
 * Não é o `MetricCell`: ele é construído em volta do sparkline, e estas métricas
 * não têm série (v0). A Margem tem cor pelo LIMIAR, não pela média (D14): na meta
 * ou acima (sucesso), lucrando abaixo da meta (alerta), prejuízo (erro) — com a
 * mesma folga de ponto flutuante do invariante (`leadMarginTone`). Amostra com menos
 * de 20 leads com nota sai esmaecida (D7).
 */
export const LeadEconomicsCell = React.memo(function LeadEconomicsCell({
  row,
  metric,
  byPack,
  formatCurrency,
  minimal = false,
  colorMetricValue = false,
  average = null,
}: LeadEconomicsCellProps) {
  const outcome = getRowLeadEconomics(row, byPack);
  const textSize = minimal ? "text-xs" : "text-base";

  const empty = (title: string) => (
    <div className="flex flex-col items-center">
      <span className={cn(textSize, "font-medium leading-none text-muted-foreground")} title={title}>
        —
      </span>
    </div>
  );

  if (!outcome.result) return empty(LEAD_ECONOMICS_UNAVAILABLE_TEXT[outcome.unavailable]);

  const result = outcome.result;
  const value = metric === "cpl_ceiling" ? result.cplCeiling : result.margin;
  if (value === null) return empty(describeMissingMargin(result));

  let toneClass = "";
  if (metric === "lead_margin") {
    const tone = leadMarginTone(value, result.targetMargin);
    if (tone) toneClass = getMetricValueTextClass(tone);
  } else if (colorMetricValue && average != null && Number.isFinite(average)) {
    toneClass = getMetricValueTextClass(getMetricQualityToneByAverage(value, average, false));
  }

  return (
    <div className="flex flex-col items-center">
      <span
        className={cn(textSize, "font-medium leading-none", toneClass, result.lowSample && "opacity-50")}
        title={describeLeadEconomicsValue(result, formatCurrency)}
      >
        {formatMetricValue(metric, value, { currencyFormatter: formatCurrency })}
      </span>
    </div>
  );
});

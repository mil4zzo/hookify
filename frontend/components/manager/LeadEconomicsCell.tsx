"use client";

import React from "react";
import { IconAlertTriangle, IconArrowsSplit, IconCalculatorOff, type Icon } from "@tabler/icons-react";
import type { RankingsItem } from "@/lib/api/schemas";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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

/** Por que a célula está vazia — no tooltip (e, com ícone, no rótulo dele). */
export const LEAD_ECONOMICS_UNAVAILABLE_TEXT: Record<LeadEconomicsUnavailableReason, string> = {
  "no-economics": "Sem economia do lead cadastrada no pack deste anúncio.",
  "mixed-economics": "Os packs deste anúncio têm economias do lead diferentes: não há um teto só para ele.",
  "no-scored-leads": "Nenhum lead com nota no período.",
};

/**
 * Vazio ESTRUTURAL ganha ícone; vazio do PERÍODO fica no travessão — a mesma divisão
 * de `MetricNotApplicable` (hook em anúncio de imagem). Pack sem cadastro e packs com
 * cadastros diferentes não viram número amanhã: é o cadastro que falta ou diverge, e
 * nada mais na linha revela isso. Sem lead com nota, sem gasto ou sem faixa que compre
 * é o período (como CPR sem conversão), e o travessão com o motivo no tooltip basta.
 */
const STRUCTURAL_ICON: Partial<Record<LeadEconomicsUnavailableReason, Icon>> = {
  "no-economics": IconCalculatorOff,
  "mixed-economics": IconArrowsSplit,
};

const LOW_SAMPLE_PREFIX = "Número instável";

/**
 * Texto do tooltip de uma célula com valor. Exportado para o teste prender o que o
 * usuário lê ao passar o mouse.
 */
export function describeLeadEconomicsValue(result: LeadEconomicsResult, formatCurrency: (n: number) => string): string {
  const parts: string[] = [];
  parts.push(result.cplActual === null ? "sem gasto no período" : `${formatCurrency(result.cplActual)} por lead com nota`);
  parts.push(`teto ${formatCurrency(result.cplCeiling)}`);
  if (result.targetMargin !== null) parts.push(`meta ${formatMetricValue("lead_margin", result.targetMargin)}`);
  parts.push(`${result.leadsScored} ${result.leadsScored === 1 ? "lead" : "leads"} com nota`);
  const text = parts.join(" · ");
  return result.lowSample ? `${LOW_SAMPLE_PREFIX}: poucos leads com nota — ${text}` : text;
}

/** Margem sem número apesar de haver conta: nenhum faturamento esperado, ou nenhum gasto. */
function describeMissingMargin(result: LeadEconomicsResult): string {
  if (result.revenuePerLead <= 0) return "Nenhum lead deste anúncio está numa faixa que compra: não há faturamento para dividir.";
  return "Sem gasto no período: não há custo por lead para comparar.";
}

/** O que a célula mostra — pura, para o teste ler o tooltip que o HTML fechado não traz. */
export type LeadEconomicsCellView =
  | { kind: "structural"; reason: LeadEconomicsUnavailableReason; tooltip: string }
  | { kind: "dash"; tooltip: string }
  | { kind: "value"; text: string; tooltip: string; toneClass: string; lowSample: boolean };

export function leadEconomicsCellView(params: {
  row: RankingsItem;
  metric: LeadEconomicsMetric;
  byPack: LeadEconomicsByPack;
  formatCurrency: (n: number) => string;
  colorMetricValue?: boolean;
  average?: number | null;
}): LeadEconomicsCellView {
  const { row, metric, byPack, formatCurrency, colorMetricValue = false, average = null } = params;
  const outcome = getRowLeadEconomics(row, byPack);
  if (!outcome.result) {
    const tooltip = LEAD_ECONOMICS_UNAVAILABLE_TEXT[outcome.unavailable];
    return STRUCTURAL_ICON[outcome.unavailable] ? { kind: "structural", reason: outcome.unavailable, tooltip } : { kind: "dash", tooltip };
  }

  const result = outcome.result;
  const value = metric === "cpl_ceiling" ? result.cplCeiling : result.margin;
  if (value === null) return { kind: "dash", tooltip: describeMissingMargin(result) };

  let toneClass = "";
  if (metric === "lead_margin") {
    const tone = leadMarginTone(value, result.targetMargin);
    if (tone) toneClass = getMetricValueTextClass(tone);
  } else if (colorMetricValue && average != null && Number.isFinite(average)) {
    toneClass = getMetricValueTextClass(getMetricQualityToneByAverage(value, average, false));
  }
  return {
    kind: "value",
    text: formatMetricValue(metric, value, { currencyFormatter: formatCurrency }),
    tooltip: describeLeadEconomicsValue(result, formatCurrency),
    toneClass,
    lowSample: result.lowSample,
  };
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

/** O tooltip do app (Radix), como no BudgetCell — nunca o `title` nativo (revisão P2). */
function WithTooltip({ text, children }: { text: string; children: React.ReactElement }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <p className="text-xs">{text}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Célula de Teto de CPL e Margem.
 *
 * Não é o `MetricCell`: ele é construído em volta do sparkline, e estas métricas
 * não têm série (v0). A Margem tem cor pelo LIMIAR, não pela média (D14): na meta
 * ou acima (sucesso), lucrando abaixo da meta (alerta), prejuízo (erro) — com a
 * mesma folga de ponto flutuante do invariante (`leadMarginTone`). Amostra com menos
 * de 20 leads com nota sai esmaecida e com triângulo de alerta (D7; o esmaecido sozinho não se lia
 * como aviso — revisão P2).
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
  const view = leadEconomicsCellView({ row, metric, byPack, formatCurrency, colorMetricValue, average });
  const textSize = minimal ? "text-xs" : "text-base";

  if (view.kind === "structural") {
    const StructuralIcon = STRUCTURAL_ICON[view.reason]!;
    return (
      <div className="flex flex-col items-center">
        <WithTooltip text={view.tooltip}>
          <span className="grid cursor-help place-items-center text-muted-foreground opacity-50" role="img" aria-label={view.tooltip}>
            <StructuralIcon className={minimal ? "h-3.5 w-3.5" : "h-5 w-5"} stroke={1.7} aria-hidden />
          </span>
        </WithTooltip>
      </div>
    );
  }

  if (view.kind === "dash") {
    return (
      <div className="flex flex-col items-center">
        <WithTooltip text={view.tooltip}>
          <span className={cn(textSize, "cursor-help font-medium leading-none text-muted-foreground")}>—</span>
        </WithTooltip>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <WithTooltip text={view.tooltip}>
        <span className={cn("inline-flex cursor-help items-center gap-1", textSize, "font-medium leading-none")}>
          <span className={cn(view.toneClass, view.lowSample && "opacity-50")}>{view.text}</span>
          {view.lowSample && (
            // Cinza, não amarelo: a Margem já usa o amarelo para "abaixo da meta".
            <IconAlertTriangle className={cn("shrink-0 text-muted-foreground", minimal ? "h-3 w-3" : "h-3.5 w-3.5")} aria-label={LOW_SAMPLE_PREFIX} role="img" />
          )}
        </span>
      </WithTooltip>
    </div>
  );
});

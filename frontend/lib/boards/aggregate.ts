/**
 * Agregado e ordenação de um grupo do Board.
 *
 * O agregado por grupo é o que separa o Board de um filtro salvo: o Manager
 * compara ANÚNCIOS, o Board compara GRUPOS. Sem o número no cabeçalho, um grupo
 * é só uma pasta com fotos.
 *
 * A conta é delegada a `computeManagerAverages` de propósito — é a mesma função
 * que alimenta as médias do Manager. Refazer as somas aqui abriria a porta para
 * a divergência clássica: CPR do grupo como MÉDIA DOS CPRs das linhas, em vez de
 * soma(spend)/soma(resultados). São números diferentes, e o segundo é o certo.
 */

import { computeManagerAverages, getMetricNumericValueOrNull, type ManagerAverages } from "@/lib/metrics";
import type { RuleRow } from "@/lib/rules/evaluate";

export interface BoardGroupSummary {
  /** Quantos criativos caíram no grupo. */
  count: number;
  averages: ManagerAverages;
  spend: number;
  results: number;
  /** CPR = soma(spend) / soma(resultados). null quando não houve resultado. */
  cpr: number | null;
  /** Fatia do spend do grupo sobre o spend do recorte inteiro (0-1). */
  spendShare: number | null;
}

export interface BoardAggregateOptions {
  actionType?: string;
  hasSheetIntegration?: boolean;
  mqlLeadscoreMin?: number | null;
  /** Spend de TODAS as linhas do recorte — denominador do `spendShare`. */
  totalSpend?: number;
}

export function summarizeBoardGroup(rows: readonly RuleRow[], options: BoardAggregateOptions = {}): BoardGroupSummary {
  const { actionType, hasSheetIntegration = false, mqlLeadscoreMin = null, totalSpend } = options;

  const averages = computeManagerAverages(rows as any[], {
    actionType,
    hasSheetIntegration,
    mqlLeadscoreMin,
  });

  const spend = averages.sumSpend;
  const results = averages.sumResults;

  return {
    count: rows.length,
    averages,
    spend,
    results,
    cpr: averages.cpr,
    spendShare: totalSpend && totalSpend > 0 ? spend / totalSpend : null,
  };
}

/**
 * Ordena dentro do grupo. Linha sem valor para a métrica vai SEMPRE para o fim,
 * nas duas direções — em `asc`, tratar ausente como zero jogaria o que não tem
 * dado para o topo, que é o oposto do que "menor primeiro" quer dizer.
 */
export function sortBoardRows<T extends RuleRow>(
  rows: readonly T[],
  metricKey: string,
  direction: "asc" | "desc",
  context: { actionType?: string; mqlLeadscoreMin?: number | null } = {},
): T[] {
  const valueOf = (row: T): number | null => {
    const value = getMetricNumericValueOrNull(row, metricKey, {
      actionType: context.actionType,
      mqlLeadscoreMin: context.mqlLeadscoreMin ?? null,
    });
    return value != null && Number.isFinite(value) ? value : null;
  };

  return [...rows].sort((a, b) => {
    const left = valueOf(a);
    const right = valueOf(b);
    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    if (left === right) return 0;
    return direction === "asc" ? left - right : right - left;
  });
}

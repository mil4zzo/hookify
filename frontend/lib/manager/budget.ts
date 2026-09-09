import type { RankingsItem } from "@/lib/api/schemas";

// Moedas que a Meta trata SEM subunidade (offset 1) — nas demais o budget vem em
// centésimos (offset 100). Fonte: doc oficial de currencies da Marketing API.
const META_OFFSET_ONE = new Set([
  "CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "MWK", "PYG", "TWD", "VND",
]);

/** Converte budget em subunidade da Meta para o valor de exibição na moeda da conta. */
export function budgetMinorToValue(minor: number, currency?: string | null): number {
  const code = String(currency || "").toUpperCase();
  return META_OFFSET_ONE.has(code) ? minor : minor / 100;
}

/** Converte valor de exibição (unidade da moeda) para a subunidade que a Meta espera. */
export function budgetValueToMinor(value: number, currency?: string | null): number {
  const code = String(currency || "").toUpperCase();
  return Math.round(META_OFFSET_ONE.has(code) ? value : value * 100);
}

/** Budget efetivo da linha para ordenação: daily ?? lifetime (subunidade; null = sem budget próprio). */
export function getRowBudgetMinor(row: RankingsItem): number | null {
  return row.budget_daily ?? row.budget_lifetime ?? null;
}

/** Soma de uma única moeda. `currency` null = linha sem moeda gravada (cai na moeda das configurações). */
export type BudgetCurrencyTotal = {
  currency: string | null;
  /** Já na unidade da moeda (não em subunidade). */
  daily: number;
  dailyCount: number;
  lifetime: number;
  lifetimeCount: number;
};

export type BudgetTotals = {
  /** Uma entrada por moeda encontrada, maior soma primeiro. Vazio = nenhuma linha com budget próprio. */
  byCurrency: BudgetCurrencyTotal[];
  /** Linhas somadas (com budget próprio). */
  withBudget: number;
  /** Linhas cujo orçamento vive no outro nível (CBO/ABO) ou ainda não sincronizado — ficam FORA da soma. */
  withoutBudget: number;
};

/**
 * Soma os orçamentos das linhas de uma aba de entidade (por-conjunto / por-campanha).
 *
 * Três cuidados que o número precisa respeitar para não mentir:
 * - **Diário e lifetime não se somam**: um é por dia, o outro é o período inteiro. Ficam
 *   em campos separados e a UI mostra os dois.
 * - **Moedas não se somam**: pack com contas em moedas diferentes gera uma soma por moeda.
 * - **Linha sem budget próprio não é zero**: campanha ABO (orçamento nos conjuntos) ou
 *   conjunto CBO (orçamento na campanha) fica fora da conta e é contada em `withoutBudget`,
 *   para a UI poder avisar que a soma não cobre tudo que está na tela.
 *
 * A precedência daily ?? lifetime é a MESMA da célula (`BudgetCell`): o que a linha mostra
 * é o que entra na soma.
 */
export function computeBudgetTotals(rows: readonly RankingsItem[]): BudgetTotals {
  const groups = new Map<string, BudgetCurrencyTotal>();
  let withBudget = 0;
  let withoutBudget = 0;

  for (const row of rows) {
    const daily = row.budget_daily ?? null;
    const lifetime = row.budget_lifetime ?? null;
    if (daily === null && lifetime === null) {
      withoutBudget += 1;
      continue;
    }

    const currency = row.budget_currency ?? null;
    const key = String(currency || "").toUpperCase();
    let group = groups.get(key);
    if (!group) {
      group = { currency, daily: 0, dailyCount: 0, lifetime: 0, lifetimeCount: 0 };
      groups.set(key, group);
    }

    withBudget += 1;
    if (daily !== null) {
      group.daily += budgetMinorToValue(daily, currency);
      group.dailyCount += 1;
    } else if (lifetime !== null) {
      group.lifetime += budgetMinorToValue(lifetime, currency);
      group.lifetimeCount += 1;
    }
  }

  const byCurrency = Array.from(groups.values()).sort((a, b) => b.daily + b.lifetime - (a.daily + a.lifetime));
  return { byCurrency, withBudget, withoutBudget };
}

/** Recorte ativo do header (mesma semântica das médias: seleção ganha do filtro). */
export type BudgetSubsetTotals = {
  kind: "selection" | "filter";
  count: number;
  totals: BudgetTotals;
};

/** O que o header da coluna Orçamento lê a cada render. */
export type ManagerBudgetTotals = {
  base: BudgetTotals | null;
  subset: BudgetSubsetTotals | null;
};

export const EMPTY_MANAGER_BUDGET_TOTALS: ManagerBudgetTotals = { base: null, subset: null };

/**
 * Linha curta do header: "R$ 1.298,27/dia" — com "+ R$ 4.000,00 total" quando a tela mistura
 * diário e lifetime, e um bloco por moeda separado por "·" quando mistura moedas.
 * String vazia quando nenhuma linha tem orçamento próprio (nada a mostrar).
 */
export function formatBudgetTotals(totals: BudgetTotals, formatCurrency: (value: number, currency?: string) => string): string {
  const groups = totals.byCurrency.map((group) => {
    const parts: string[] = [];
    if (group.dailyCount > 0) parts.push(`${formatCurrency(group.daily, group.currency || undefined)}/dia`);
    if (group.lifetimeCount > 0) parts.push(`${formatCurrency(group.lifetime, group.currency || undefined)} total`);
    return parts.join(" + ");
  });
  return groups.filter(Boolean).join(" · ");
}

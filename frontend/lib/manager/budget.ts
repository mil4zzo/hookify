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

// ── Ajuste em massa ─────────────────────────────────────────────────────────

export type BulkBudgetEntityType = "adset" | "campaign";
/** percent: sobe/desce N% sobre o próprio valor · delta: soma um valor a cada um · fixed: todos ficam com o valor. */
export type BulkBudgetMode = "percent" | "delta" | "fixed";
export type BudgetKind = "daily" | "lifetime";

/**
 * Acima disto a edição avisa (sem bloquear): mudança grande pode devolver a entrega à fase de
 * aprendizado. Um valor só para a célula (edição individual) e para o ajuste em massa.
 */
export const BUDGET_BIG_CHANGE = 0.25;

/** Teto por pedido — o mesmo do backend (BatchBudgetRequest). */
export const BULK_BUDGET_MAX = 300;

export type BulkBudgetRow = {
  id: string;
  name: string;
  currency: string | null;
  kind: BudgetKind;
  /** Subunidade da moeda (o que a tela sabe — o backend recalcula sobre o valor vivo). */
  currentMinor: number;
};

export type BulkBudgetSelection = {
  /** Com orçamento próprio: entram no ajuste. */
  eligible: BulkBudgetRow[];
  /** Orçamento no outro nível (campanha ABO / conjunto sob CBO): pulados, com aviso antes. */
  elsewhere: { id: string; name: string }[];
  /** Ainda sem orçamento sincronizado: pulados, com aviso antes. */
  unknown: { id: string; name: string }[];
  /**
   * Por que soma e valor fixo não podem ser usados (null = podem). Dinheiro só tem um
   * significado quando todos são do mesmo tipo (R$ 50/dia ≠ R$ 50 no total) e da mesma moeda.
   */
  moneyBlockedReason: "mixed-kind" | "mixed-currency" | null;
  /** Tipo e moeda comuns — definidos só quando os modos em dinheiro estão liberados. */
  kind: BudgetKind | null;
  currency: string | null;
};

/** Lê a seleção da aba por-conjunto/por-campanha. Precedência daily ?? lifetime, a mesma da célula. */
export function analyzeBulkBudgetSelection(rows: readonly RankingsItem[], entityType: BulkBudgetEntityType): BulkBudgetSelection {
  const eligible: BulkBudgetRow[] = [];
  const elsewhere: { id: string; name: string }[] = [];
  const unknown: { id: string; name: string }[] = [];

  for (const row of rows) {
    const id = String((entityType === "adset" ? row.adset_id : row.campaign_id) ?? "").trim();
    if (!id) continue;
    const name = String((entityType === "adset" ? row.adset_name : row.campaign_name) ?? "").trim() || id;
    const daily = row.budget_daily ?? null;
    const lifetime = row.budget_lifetime ?? null;
    if (daily !== null || lifetime !== null) {
      eligible.push({
        id,
        name,
        currency: row.budget_currency ?? null,
        kind: daily !== null ? "daily" : "lifetime",
        currentMinor: (daily ?? lifetime) as number,
      });
    } else if (row.budget_mode) {
      elsewhere.push({ id, name });
    } else {
      unknown.push({ id, name });
    }
  }

  const kinds = new Set(eligible.map((r) => r.kind));
  const currencies = new Set(eligible.map((r) => String(r.currency || "").toUpperCase()));
  const moneyBlockedReason = kinds.size > 1 ? "mixed-kind" : currencies.size > 1 ? "mixed-currency" : null;
  return {
    eligible,
    elsewhere,
    unknown,
    moneyBlockedReason,
    kind: moneyBlockedReason || eligible.length === 0 ? null : eligible[0].kind,
    currency: moneyBlockedReason || eligible.length === 0 ? null : eligible[0].currency,
  };
}

/**
 * Aceita "-20", "+15", "10,5", "1.500,50", "150.50". Com vírgula, pontos são milhar; sem
 * vírgula, um ponto é decimal. null = não é número.
 */
export function parseSignedDecimal(raw: string): number | null {
  let normalized = raw.trim().replace(/\s/g, "");
  if (!normalized || normalized === "-" || normalized === "+") return null;
  if (normalized.includes(",")) normalized = normalized.replace(/\./g, "").replace(",", ".");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * current × (1 + percent/100), arredondado ao centavo com meio para cima — a mesma conta do
 * backend (`compute_budget_target`). Em inteiros escalados: em ponto flutuante 10000 × 1,101
 * dá 11009,999… e a prévia mostraria um centavo a menos do que a Meta vai receber.
 */
export function applyBudgetPercent(currentMinor: number, percent: number): number {
  const den = 1_000_000;
  const num = currentMinor * (den + Math.round(percent * 10_000));
  return num >= 0 ? Math.floor((2 * num + den) / (2 * den)) : -Math.floor((-2 * num + den) / (2 * den));
}

export type BulkBudgetAdjustment =
  | { mode: "percent"; percent: number }
  | { mode: "delta" | "fixed"; amountMinor: number; kind: BudgetKind };

export type BulkBudgetPreviewRow = BulkBudgetRow & {
  newMinor: number;
  status: "change" | "unchanged" | "invalid";
  /** Variação relativa (0,5 = +50%). */
  change: number;
  big: boolean;
};

/** Prévia de cada linha. Estimativa sobre o valor da tela; quem decide é a releitura no backend. */
export function previewBulkBudget(rows: readonly BulkBudgetRow[], adjustment: BulkBudgetAdjustment): BulkBudgetPreviewRow[] {
  return rows.map((row) => {
    const newMinor =
      adjustment.mode === "percent"
        ? applyBudgetPercent(row.currentMinor, adjustment.percent)
        : adjustment.mode === "delta"
          ? row.currentMinor + adjustment.amountMinor
          : adjustment.amountMinor;
    const change = row.currentMinor > 0 ? (newMinor - row.currentMinor) / row.currentMinor : 0;
    const status = newMinor <= 0 ? "invalid" : newMinor === row.currentMinor ? "unchanged" : "change";
    return { ...row, newMinor, status, change, big: status === "change" && Math.abs(change) > BUDGET_BIG_CHANGE };
  });
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

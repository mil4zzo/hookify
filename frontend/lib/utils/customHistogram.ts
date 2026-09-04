/**
 * Histogramas das colunas vinculadas da planilha (migration 140).
 *
 * A RPC devolve, por linha, `custom_histograms: { [mappingId]: { [valor]: quantidade } }`.
 * Tudo que o app mostra (média, mínimo, máximo, mediana, distribuição, MQLs de um
 * segundo leadscore) sai daqui, no cliente — nunca uma média pronta do servidor,
 * pelo mesmo motivo do leadscore V1 (ver lib/utils/mqlMetrics.ts).
 *
 * O leadscore V2 usa as MESMAS funções do V1 (`computeMqlMetricsFromLeadscore`):
 * é o que garante que a mesma coluna mapeada dos dois jeitos dá o mesmo número
 * (diferencial no teste customHistogram.test.ts).
 */
import { computeMqlMetricsFromLeadscore, normalizeLeadscoreValues } from "@/lib/utils/mqlMetrics";

export type Histogram = Record<string, number>;
export type CustomHistograms = Record<string, Histogram>;

function qtyOf(raw: unknown): number {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Soma `from` dentro de `into` (muta e devolve `into`). */
export function mergeHistograms(into: Histogram, from: Histogram | null | undefined): Histogram {
  if (!from || typeof from !== "object") return into;
  for (const [value, raw] of Object.entries(from)) {
    const qty = qtyOf(raw);
    if (qty <= 0) continue;
    into[value] = (into[value] ?? 0) + qty;
  }
  return into;
}

/** Soma os histogramas de várias linhas, por vínculo. */
export function mergeCustomHistograms(rows: ReadonlyArray<CustomHistograms | null | undefined>): CustomHistograms {
  const out: CustomHistograms = {};
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const [mappingId, hist] of Object.entries(row)) {
      out[mappingId] = mergeHistograms(out[mappingId] ?? {}, hist);
    }
  }
  return out;
}

export function histogramCount(hist: Histogram | null | undefined): number {
  if (!hist) return 0;
  let n = 0;
  for (const raw of Object.values(hist)) n += qtyOf(raw);
  return n;
}

export interface HistogramStats {
  n: number;
  avg: number;
  min: number;
  max: number;
  median: number;
}

/**
 * Estatísticas de um histograma NUMÉRICO. `null` quando não há valor nenhum
 * (não é zero: "sem dado" e "média zero" são afirmações diferentes).
 * Chaves que não são número são ignoradas (não deveriam existir num vínculo numérico).
 */
export function histogramStats(hist: Histogram | null | undefined): HistogramStats | null {
  if (!hist) return null;
  const pairs: Array<[number, number]> = [];
  for (const [value, raw] of Object.entries(hist)) {
    const v = Number(value);
    const qty = qtyOf(raw);
    if (!Number.isFinite(v) || qty <= 0) continue;
    pairs.push([v, qty]);
  }
  if (pairs.length === 0) return null;
  pairs.sort((a, b) => a[0] - b[0]);
  let n = 0;
  let sum = 0;
  for (const [v, qty] of pairs) {
    n += qty;
    sum += v * qty;
  }
  // mediana pelo acumulado: com n par, média dos dois centrais
  const lo = Math.floor((n - 1) / 2);
  const hi = Math.floor(n / 2);
  let acc = 0;
  let vLo: number | null = null;
  let vHi: number | null = null;
  for (const [v, qty] of pairs) {
    const before = acc;
    acc += qty;
    if (vLo === null && lo < acc && lo >= before) vLo = v;
    if (vHi === null && hi < acc && hi >= before) vHi = v;
    if (vLo !== null && vHi !== null) break;
  }
  const median = ((vLo ?? pairs[0][0]) + (vHi ?? pairs[pairs.length - 1][0])) / 2;
  return { n, avg: sum / n, min: pairs[0][0], max: pairs[pairs.length - 1][0], median };
}

export interface HistogramTop {
  value: string;
  qty: number;
  /** fatia 0-1 do total */
  share: number;
}

/**
 * Resposta majoritária de um histograma de CATEGORIA. Empate: a menor em ordem
 * alfabética, para a célula não trocar de resposta entre renders.
 */
export function histogramTop(hist: Histogram | null | undefined): HistogramTop | null {
  if (!hist) return null;
  let total = 0;
  let best: { value: string; qty: number } | null = null;
  for (const [value, raw] of Object.entries(hist)) {
    const qty = qtyOf(raw);
    if (qty <= 0) continue;
    total += qty;
    if (!best || qty > best.qty || (qty === best.qty && value.localeCompare(best.value) < 0)) {
      best = { value, qty };
    }
  }
  if (!best || total <= 0) return null;
  return { value: best.value, qty: best.qty, share: best.qty / total };
}

/** Pares (valor, qtd) ordenados: numérico por valor, categoria por quantidade desc. */
export function histogramEntries(hist: Histogram | null | undefined, numeric: boolean): Array<[string, number]> {
  if (!hist) return [];
  const entries = Object.entries(hist)
    .map(([value, raw]) => [value, qtyOf(raw)] as [string, number])
    .filter(([, qty]) => qty > 0);
  if (numeric) {
    entries.sort((a, b) => Number(a[0]) - Number(b[0]));
  } else {
    entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }
  return entries;
}

export interface LeadscoreFacets {
  /** total de leads com valor */
  n: number;
  /** média; null sem leads */
  avg: number | null;
  /** null = corte não definido */
  mqls: number | null;
  /** MQLs / total de leads; null sem corte ou sem leads */
  mql_rate: number | null;
  /** null sem corte; 0 sem MQL ou sem gasto (mesma regra do V1) */
  cpmql: number | null;
}

/**
 * As quatro facetas de uma coluna do tipo leadscore, calculadas EXATAMENTE como o
 * leadscore V1 (mesmas funções de mqlMetrics.ts, mesmo tratamento de corte nulo).
 */
export function computeLeadscoreFacets(
  hist: Histogram | null | undefined,
  spend: number,
  mqlMin: number | null | undefined,
): LeadscoreFacets {
  const values = normalizeLeadscoreValues(hist ?? null);
  const cut = mqlMin === undefined ? null : mqlMin;
  const { leadscoreAvg, mqlCount, cpmql } = computeMqlMetricsFromLeadscore({
    spend: Number.isFinite(spend) ? spend : 0,
    leadscoreRaw: hist ?? null,
    mqlLeadscoreMin: cut,
  });
  const n = values.length;
  return {
    n,
    avg: n > 0 ? leadscoreAvg : null,
    mqls: mqlCount,
    mql_rate: mqlCount === null || n === 0 ? null : mqlCount / n,
    cpmql: mqlCount === null ? null : cpmql,
  };
}

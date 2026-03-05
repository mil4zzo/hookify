// Utilitários centralizados para métricas de MQL / CPMQL
//
// Objetivo:
// - Padronizar a forma como leadscore_values são tratados
// - Garantir que o cálculo de MQL e CPMQL seja consistente entre páginas (Rankings, Insights, Gems, etc.)
// - Manter funções puras e reutilizáveis (sem hooks aqui)

export function normalizeLeadscoreValues(raw: any): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => Number(v || 0))
    .filter((v) => Number.isFinite(v));
}

export function computeLeadscoreAverage(values: number[]): number {
  if (!values || values.length === 0) return 0;
  const sum = values.reduce((acc, v) => acc + v, 0);
  const avg = sum / values.length;
  return Number.isFinite(avg) && avg > 0 ? avg : 0;
}

export function computeMqlCount(leadscoreValues: number[], mqlLeadscoreMin: number): number {
  if (!leadscoreValues || leadscoreValues.length === 0) return 0;
  return leadscoreValues.filter((ls) => ls >= mqlLeadscoreMin).length;
}

export function computeCpmqlFromMqlCount(spend: number, mqlCount: number): number {
  const s = Number(spend || 0);
  if (!Number.isFinite(s) || s <= 0 || !mqlCount || mqlCount <= 0) return 0;
  const value = s / mqlCount;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

type MqlResult = { leadscoreValues: number[]; leadscoreAvg: number; mqlCount: number; cpmql: number };

/**
 * Cache por referência do array leadscoreRaw (WeakMap → GC automático quando dados mudam).
 * Dentro de um render, o mesmo ad passa por accessor → filterFn → cell → MetricCell,
 * sempre com a mesma referência de leadscoreRaw. O cache evita recalcular ~4x por row.
 */
const _mqlCache = new WeakMap<object, Map<string, MqlResult>>();

function _computeMqlUncached(spend: number, leadscoreRaw: any, mqlLeadscoreMin: number): MqlResult {
  const leadscoreValues = normalizeLeadscoreValues(leadscoreRaw);
  const leadscoreAvg = computeLeadscoreAverage(leadscoreValues);
  const mqlCount = computeMqlCount(leadscoreValues, mqlLeadscoreMin);
  const cpmql = computeCpmqlFromMqlCount(spend, mqlCount);
  return { leadscoreValues, leadscoreAvg, mqlCount, cpmql };
}

export function computeMqlMetricsFromLeadscore(params: {
  spend: number;
  leadscoreRaw: any;
  mqlLeadscoreMin: number;
}): MqlResult {
  const { spend, leadscoreRaw, mqlLeadscoreMin } = params;

  // Cache lookup quando leadscoreRaw é um objeto (array) — hot path
  if (leadscoreRaw && typeof leadscoreRaw === "object") {
    const subKey = `${spend}:${mqlLeadscoreMin}`;
    let subMap = _mqlCache.get(leadscoreRaw);
    if (subMap) {
      const cached = subMap.get(subKey);
      if (cached) return cached;
    } else {
      subMap = new Map();
      _mqlCache.set(leadscoreRaw, subMap);
    }
    const result = _computeMqlUncached(spend, leadscoreRaw, mqlLeadscoreMin);
    subMap.set(subKey, result);
    return result;
  }

  return _computeMqlUncached(spend, leadscoreRaw, mqlLeadscoreMin);
}






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

export function computeMqlMetricsFromLeadscore(params: {
  spend: number;
  leadscoreRaw: any;
  mqlLeadscoreMin: number;
}) {
  const { spend, leadscoreRaw, mqlLeadscoreMin } = params;
  const leadscoreValues = normalizeLeadscoreValues(leadscoreRaw);
  const leadscoreAvg = computeLeadscoreAverage(leadscoreValues);
  const mqlCount = computeMqlCount(leadscoreValues, mqlLeadscoreMin);
  const cpmql = computeCpmqlFromMqlCount(spend, mqlCount);

  return {
    leadscoreValues,
    leadscoreAvg,
    mqlCount,
    cpmql,
  };
}






// Utilitários centralizados para métricas de MQL / CPMQL
//
// Objetivo:
// - Padronizar a forma como leadscore_values são tratados
// - Garantir que o cálculo de MQL e CPMQL seja consistente entre páginas (Rankings, Insights, Gems, etc.)
// - Manter funções puras e reutilizáveis (sem hooks aqui)

/**
 * Duas formas do dado bruto convivem:
 * - array de scores (`leadscore_values`): telas de detalhe/série leem ad_metrics cru;
 * - histograma `{ "80": 2, "90": 1 }` (`leadscore_histogram`): a RPC do Manager
 *   (migration 130) agrega por grupo e manda quantidade por score — era 52% do
 *   payload como array; como histograma, ~1%.
 * O histograma é EXPANDIDO para array aqui, uma vez por referência (cache abaixo),
 * e todo o resto (média, corte de MQL ajustável na tela, CPMQL) continua somável e
 * calculado no cliente — nunca uma média pronta vinda do servidor.
 */
export function normalizeLeadscoreValues(raw: any): number[] {
  if (Array.isArray(raw)) {
    return raw
      .map((v) => Number(v || 0))
      .filter((v) => Number.isFinite(v));
  }
  if (raw && typeof raw === "object") {
    const out: number[] = [];
    const entries = Object.entries(raw as Record<string, unknown>)
      .map(([score, qty]) => [Number(score), Math.trunc(Number(qty))] as const)
      .filter(([score, qty]) => Number.isFinite(score) && Number.isFinite(qty) && qty > 0)
      .sort((a, b) => a[0] - b[0]);
    for (const [score, qty] of entries) {
      for (let i = 0; i < qty; i++) out.push(score);
    }
    return out;
  }
  return [];
}

/** O dado bruto de leadscore de uma linha, seja qual for a forma em que veio. */
export function getLeadscoreRaw(row: any): unknown {
  if (!row || typeof row !== "object") return undefined;
  return row.leadscore_histogram ?? row.leadscore_values;
}

/** A linha carrega dado de leadscore (planilha integrada)? Independe de estar vazio. */
export function hasLeadscoreData(row: any): boolean {
  if (!row || typeof row !== "object") return false;
  return row.leadscore_histogram != null || row.leadscore_values != null;
}

export function computeLeadscoreAverage(values: number[]): number {
  if (!values || values.length === 0) return 0;
  const sum = values.reduce((acc, v) => acc + v, 0);
  const avg = sum / values.length;
  return Number.isFinite(avg) && avg > 0 ? avg : 0;
}

/**
 * Conta leads acima do corte. Sem corte definido retorna `null` (indisponível).
 *
 * `null` e `0` são afirmações diferentes: 0 é "nenhum lead atingiu o corte";
 * null é "não dá para dizer". Tratar null como 0 contaria todo lead como MQL no
 * caminho oposto (filtro `>= 0`), derrubando o CPMQL.
 */
export function computeMqlCount(
  leadscoreValues: number[],
  mqlLeadscoreMin: number | null
): number | null {
  if (mqlLeadscoreMin === null || mqlLeadscoreMin === undefined) return null;
  if (!leadscoreValues || leadscoreValues.length === 0) return 0;
  return leadscoreValues.filter((ls) => ls >= mqlLeadscoreMin).length;
}

export function computeCpmqlFromMqlCount(spend: number, mqlCount: number | null): number | null {
  if (mqlCount === null || mqlCount === undefined) return null;
  const s = Number(spend || 0);
  if (!Number.isFinite(s) || s <= 0 || !mqlCount || mqlCount <= 0) return 0;
  const value = s / mqlCount;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

type MqlResult = {
  leadscoreValues: number[];
  /** Média dos leadscores — independe do corte, então nunca fica indisponível. */
  leadscoreAvg: number;
  /** null = corte não definido. */
  mqlCount: number | null;
  /** null = corte não definido. */
  cpmql: number | null;
};

/**
 * Cache por referência do array leadscoreRaw (WeakMap → GC automático quando dados mudam).
 * Dentro de um render, o mesmo ad passa por accessor → filterFn → cell → MetricCell,
 * sempre com a mesma referência de leadscoreRaw. O cache evita recalcular ~4x por row.
 */
const _mqlCache = new WeakMap<object, Map<string, MqlResult>>();

function _computeMqlUncached(spend: number, leadscoreRaw: any, mqlLeadscoreMin: number | null): MqlResult {
  const leadscoreValues = normalizeLeadscoreValues(leadscoreRaw);
  const leadscoreAvg = computeLeadscoreAverage(leadscoreValues);
  const mqlCount = computeMqlCount(leadscoreValues, mqlLeadscoreMin);
  const cpmql = computeCpmqlFromMqlCount(spend, mqlCount);
  return { leadscoreValues, leadscoreAvg, mqlCount, cpmql };
}

export function computeMqlMetricsFromLeadscore(params: {
  spend: number;
  leadscoreRaw: any;
  mqlLeadscoreMin: number | null;
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






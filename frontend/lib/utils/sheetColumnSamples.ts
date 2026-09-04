/**
 * Sugestão de tipo de uma coluna da planilha pela amostra (linhas 2-10 que a leitura
 * de colunas já traz). Espelha `classify_samples` do backend
 * (services/sheet_column_mappings.py): número se toda célula preenchida é número;
 * categoria se há até CATEGORY_MAX_DISTINCT respostas distintas; senão texto livre,
 * que o v1 recusa. O guarda real é o importer, no conjunto inteiro.
 */

export const CATEGORY_MAX_DISTINCT = 20;

/** Mesma leitura tolerante do leadscore: "1.000,50" e "1,000.50" viram número. */
export function parseSheetNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  let text = String(raw).trim().replace(/\s+/g, "");
  if (!text) return null;
  text = text.replace(/^[$€£]|^R\$/, "");
  const lastComma = text.lastIndexOf(",");
  const lastPeriod = text.lastIndexOf(".");
  if (lastComma >= 0 && lastPeriod >= 0) {
    text = lastComma > lastPeriod ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const parts = text.split(",");
    text = parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3 ? text.replace(",", "") : text.replace(",", ".");
  } else if (lastPeriod >= 0) {
    const parts = text.split(".");
    if (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3) text = text.replace(".", "");
  }
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function normalizeSheetCategory(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).replace(/\s+/g, " ").trim();
  return text ? text : null;
}

export interface SampleClassification {
  suggested: "number" | "category" | "text" | null;
  nonEmpty: number;
  numeric: number;
  distinct: number;
}

export function classifySampleValues(values: ReadonlyArray<unknown>): SampleClassification {
  const nonEmpty = values.filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
  if (nonEmpty.length === 0) return { suggested: null, nonEmpty: 0, numeric: 0, distinct: 0 };
  const numeric = nonEmpty.filter((v) => parseSheetNumber(v) !== null).length;
  const distinct = new Set(nonEmpty.map((v) => normalizeSheetCategory(v)).filter((v): v is string => v !== null)).size;
  const suggested = numeric === nonEmpty.length ? "number" : distinct <= CATEGORY_MAX_DISTINCT ? "category" : "text";
  return { suggested, nonEmpty: nonEmpty.length, numeric, distinct };
}

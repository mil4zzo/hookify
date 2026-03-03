/**
 * Sugere mapeamento de colunas da planilha para AD ID, Data e Leadscore
 * com base em prioridade de termos. Nunca sobrescreve valores já definidos
 * (a aplicação do guess é feita no dialog com setState(prev => prev || guessed)).
 */

function normalize(col: string): string {
  return col.trim().toLowerCase().replace(/_/g, " ");
}

export interface GuessColumnMappingsResult {
  adIdColumn: string | null;
  dateColumn: string | null;
  leadscoreColumn: string | null;
}

/** Termos para AD ID, em ordem de prioridade (primeira coincidência vence). */
const AD_ID_TERMS: ((n: string) => boolean)[] = [
  (n) => n.includes("ad id"),
  (n) => n === "adid" || /\badid\b/.test(n),
];

/** Termos para Leadscore, em ordem de prioridade. */
const LEADSCORE_TERMS: ((n: string) => boolean)[] = [
  (n) => n.includes("leadscore"),
  (n) => n.includes("lead score"),
  (n) => n.includes("score"),
];

/** Termos para Data, em ordem de prioridade. */
const DATE_TERMS: ((n: string) => boolean)[] = [
  (n) => n.includes("data de captura"),
  (n) => n.includes("data") || n.includes("date"),
  (n) => n.includes("captura"),
];

function findFirstMatching(
  columns: string[],
  exclude: Set<string>,
  matchers: ((n: string) => boolean)[]
): string | null {
  for (const col of columns) {
    if (exclude.has(col)) continue;
    const n = normalize(col);
    for (const match of matchers) {
      if (match(n)) return col;
    }
  }
  return null;
}

/**
 * Retorna sugestões de colunas para AD ID, Data e Leadscore.
 * Cada coluna é atribuída no máximo a um tipo (evita duplicata).
 */
export function guessColumnMappings(columns: string[]): GuessColumnMappingsResult {
  const used = new Set<string>();

  const adIdColumn = findFirstMatching(columns, used, AD_ID_TERMS);
  if (adIdColumn) used.add(adIdColumn);

  const leadscoreColumn = findFirstMatching(columns, used, LEADSCORE_TERMS);
  if (leadscoreColumn) used.add(leadscoreColumn);

  const dateColumn = findFirstMatching(columns, used, DATE_TERMS);
  if (dateColumn) used.add(dateColumn);

  return {
    adIdColumn: adIdColumn ?? null,
    dateColumn: dateColumn ?? null,
    leadscoreColumn: leadscoreColumn ?? null,
  };
}

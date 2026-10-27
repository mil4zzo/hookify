/**
 * CPR alvo como LINHAS (evento + meta), no lugar da lista com um campo por evento.
 *
 * O pack pode ter dezenas de eventos de conversão e quase sempre só um ou dois têm
 * meta: a lista inteira empurrava o resto do diálogo para baixo. Aqui a tela mostra
 * só as linhas com meta (uma linha em branco quando não há nenhuma) e acrescenta
 * linhas sob demanda, como nos filtros.
 *
 * As linhas são só a forma de EDITAR. O resto do diálogo continua falando o mapa
 * `{evento: texto}` com TODOS os eventos (`targetsFromRows`): evento sem linha vale
 * "" (sem meta), então dirty, payload do pack e payload em massa não mudam. Remover
 * a linha de um evento é o mesmo que apagar o campo dele na lista antiga.
 */

export interface TargetCprRow {
  /** Chave só da tela (React). */
  key: string;
  /** Evento de conversão ("conversion:lead"); "" = ainda não escolhido. */
  event: string;
  /** Meta digitada, como texto (o campo guarda o que a pessoa digitou). */
  value: string;
}

let sequence = 0;
function newRowKey(): string {
  sequence += 1;
  return `cpr-${sequence}`;
}

export function blankTargetCprRow(): TargetCprRow {
  return { key: newRowKey(), event: "", value: "" };
}

/** Mapa do formulário → linhas: uma por evento com meta, na ordem dos eventos. Nenhuma → uma em branco. */
export function rowsFromTargets(targets: Readonly<Record<string, string>>, conversionTypes: readonly string[]): TargetCprRow[] {
  const rows = conversionTypes
    .filter((type) => (targets[type] ?? "").trim() !== "")
    .map((type) => ({ key: newRowKey(), event: type, value: targets[type] }));
  return rows.length > 0 ? rows : [blankTargetCprRow()];
}

/**
 * Linhas → mapa do formulário com TODOS os eventos: o da linha leva o valor dela, o
 * resto vale "". Linha sem evento não conta; evento fora da lista é ignorado.
 */
export function targetsFromRows(rows: readonly TargetCprRow[], conversionTypes: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const type of conversionTypes) out[type] = "";
  for (const row of rows) {
    if (row.event && row.event in out) out[row.event] = row.value;
  }
  return out;
}

/** Eventos que o seletor desta linha oferece: os que nenhuma OUTRA linha usa. */
export function eventsForRow(rows: readonly TargetCprRow[], conversionTypes: readonly string[], rowKey: string): string[] {
  const used = new Set(rows.filter((row) => row.key !== rowKey && row.event).map((row) => row.event));
  return conversionTypes.filter((type) => !used.has(type));
}

/** Dá para acrescentar: nenhuma linha está sem evento e ainda sobra evento livre. */
export function canAddTargetCprRow(rows: readonly TargetCprRow[], conversionTypes: readonly string[]): boolean {
  if (rows.some((row) => !row.event)) return false;
  const used = new Set(rows.map((row) => row.event));
  return conversionTypes.some((type) => !used.has(type));
}

export function addTargetCprRow(rows: readonly TargetCprRow[]): TargetCprRow[] {
  return [...rows, blankTargetCprRow()];
}

export function updateTargetCprRow(rows: readonly TargetCprRow[], key: string, patch: Partial<Omit<TargetCprRow, "key">>): TargetCprRow[] {
  return rows.map((row) => (row.key === key ? { ...row, ...patch } : row));
}

/** Remove a linha. A última vira uma linha em branco: sempre há onde começar. */
export function removeTargetCprRow(rows: readonly TargetCprRow[], key: string): TargetCprRow[] {
  const next = rows.filter((row) => row.key !== key);
  return next.length > 0 ? next : [blankTargetCprRow()];
}

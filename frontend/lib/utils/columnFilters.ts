/**
 * Extrai o id da coluna a partir do id do filtro.
 * Filtros podem ter id único por instância (ex: "spend__1730123456789") ou id legado (ex: "spend").
 */
export function getColumnId(filterId: string): string {
  const idx = filterId.indexOf("__");
  return idx >= 0 ? filterId.slice(0, idx) : filterId;
}

/**
 * Extrai o id da coluna a partir do id do filtro.
 * Filtros podem ter id único por instância (ex: "spend__1730123456789") ou id legado (ex: "spend").
 */
export function getColumnId(filterId: string): string {
  const idx = filterId.indexOf("__");
  return idx >= 0 ? filterId.slice(0, idx) : filterId;
}

// Total de opções do filtro de status (ACTIVE/PAUSED/ADSET_PAUSED/CAMPAIGN_PAUSED).
// Com todas selecionadas (ou nenhuma — applyStatusFilter trata vazio como "todos"),
// o filtro não restringe nada.
const STATUS_OPTION_COUNT = 4;

/**
 * True se o valor de filtro RESTRINGE linhas de fato — usado para o badge do botão "Filtros"
 * e para o indicador de funil no header das colunas. Filtros recém-criados (value null) ou
 * status com todas as opções marcadas não contam.
 */
export function isRestrictiveFilterValue(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if ("selectedStatuses" in value) {
    const selected = (value as { selectedStatuses?: string[] }).selectedStatuses;
    return Array.isArray(selected) && selected.length > 0 && selected.length < STATUS_OPTION_COUNT;
  }
  if ("operator" in value) {
    const inner = (value as { value?: unknown }).value;
    return inner !== null && inner !== undefined && inner !== "";
  }
  return false;
}

/**
 * Ids de coluna (sem o sufixo de instância) que têm ao menos um filtro efetivo.
 */
export function getFilteredColumnIds(columnFilters: readonly { id: string; value: unknown }[]): Set<string> {
  const ids = new Set<string>();
  for (const filter of columnFilters) {
    if (isRestrictiveFilterValue(filter.value)) {
      ids.add(getColumnId(filter.id));
    }
  }
  return ids;
}

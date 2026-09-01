/**
 * Reordena as linhas colocando as selecionadas primeiro, preservando a ordem
 * relativa dentro de cada grupo (a ordenação da coluna continua valendo).
 *
 * Devolve o MESMO array quando já está ordenado assim (nenhuma selecionada, todas
 * selecionadas, ou as selecionadas já no topo): o consumidor é um `useMemo` que
 * alimenta o virtualizador, e um array novo a cada render remontaria linhas à toa.
 */
export function orderSelectedFirst<T>(rows: readonly T[], isSelected: (row: T) => boolean): readonly T[] {
  let sawUnselected = false;
  let needsReorder = false;

  for (const row of rows) {
    if (isSelected(row)) {
      if (sawUnselected) {
        needsReorder = true;
        break;
      }
    } else {
      sawUnselected = true;
    }
  }

  if (!needsReorder) return rows;

  const selected: T[] = [];
  const rest: T[] = [];
  for (const row of rows) {
    if (isSelected(row)) selected.push(row);
    else rest.push(row);
  }
  return [...selected, ...rest];
}

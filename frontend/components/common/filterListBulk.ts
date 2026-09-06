/**
 * Semântica dos atalhos bulk ("Selecionar todos" / "Limpar") do `FilterListPopover`.
 *
 * A regra é UNIÃO/SUBTRAÇÃO sobre os ids VISÍVEIS, nunca substituição da seleção inteira.
 * Com a busca vazia, "visível" é a lista toda e o resultado é o histórico ("todos" / "nenhum");
 * com busca ativa, o clique só mexe no que está na tela. Substituir contradiz o que o usuário
 * vê: buscar "EI.31", ver 7 packs e clicar em "Selecionar todos" marcava os 37.
 *
 * Regras que valem para os dois lados:
 * - o que está FORA da busca preserva seu estado (marcado continua marcado);
 * - quando nada muda, a coleção ORIGINAL é devolvida por identidade — vários chamadores
 *   (ex: `updateColumnPreferences`) comparam por `===` para pular a gravação/re-render.
 *
 * O que NÃO é decidido aqui: quais ids podem ser marcados. Opção desabilitada (coluna que
 * exige planilha, pack em conflito) é regra de domínio — o chamador filtra `visibleIds`
 * antes de chamar.
 */

/** Acrescenta os visíveis à seleção (Set). Não remove nada. */
export function selectVisible<T extends string>(selected: Set<T>, visibleIds: readonly T[]): Set<T> {
  if (visibleIds.every((id) => selected.has(id))) return selected;
  const next = new Set(selected);
  visibleIds.forEach((id) => next.add(id));
  return next;
}

/** Remove os visíveis da seleção (Set). Não acrescenta nada. */
export function deselectVisible<T extends string>(selected: Set<T>, visibleIds: readonly T[]): Set<T> {
  if (!visibleIds.some((id) => selected.has(id))) return selected;
  const next = new Set(selected);
  visibleIds.forEach((id) => next.delete(id));
  return next;
}

/**
 * Versão para seleção ORDENADA (array), onde a ordem é a de escolha e aparece na tela —
 * ex: os chips do `MultiSelectChipsField`. Os novos entram no fim, na ordem da lista visível.
 */
export function selectVisibleOrdered<T extends string>(selected: readonly T[], visibleIds: readonly T[]): T[] {
  const current = new Set(selected);
  const added = visibleIds.filter((id) => !current.has(id));
  return added.length === 0 ? (selected as T[]) : [...selected, ...added];
}

/** Remove os visíveis preservando a ordem dos que ficam. */
export function deselectVisibleOrdered<T extends string>(selected: readonly T[], visibleIds: readonly T[]): T[] {
  const visible = new Set(visibleIds);
  const next = selected.filter((id) => !visible.has(id));
  return next.length === selected.length ? (selected as T[]) : next;
}

/**
 * Variante para listas com EXCLUSÃO MÚTUA entre opções — hoje, os packs em conflito
 * cross-silo (mesmo anúncio em contas de donos diferentes; ver `usePackConflicts`).
 *
 * Por que não basta filtrar as opções desabilitadas: o veto do popover é calculado contra a
 * seleção do MOMENTO. Com nada selecionado, nenhum pack aparece desabilitado — então um
 * "Selecionar todos" ingênuo marcaria packs que conflitam ENTRE SI, criando exatamente o
 * estado que o bloqueio existe para impedir. Aqui a checagem é feita a cada passo, contra o
 * que já foi acumulado.
 *
 * Critério de desempate: primeiro da lista visível vence — a ordem que o usuário está vendo
 * (a mesma ordenação da página /packs). Determinístico e explicável: "ficou o de cima".
 *
 * Devolve também os `skipped`, porque pular em silêncio se lê como bug — quem clicou precisa
 * saber por que 3 dos 7 não marcaram.
 */
export function selectVisibleRespectingConflicts<T extends string>(
  selected: Set<T>,
  visibleIds: readonly T[],
  conflicts: ReadonlyMap<string, ReadonlySet<string>>,
): { next: Set<T>; skipped: T[] } {
  const next = new Set(selected);
  const skipped: T[] = [];

  for (const id of visibleIds) {
    if (next.has(id)) continue;
    const enemies = conflicts.get(id);
    if (enemies && [...enemies].some((enemy) => next.has(enemy as T))) {
      skipped.push(id);
      continue;
    }
    next.add(id);
  }

  return { next: next.size === selected.size ? selected : next, skipped };
}

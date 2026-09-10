/**
 * A regra de quem pode entrar na seleção de packs — num lugar só.
 *
 * POR QUE ISTO EXISTE COMO FUNÇÃO PURA
 * ------------------------------------
 * A mesma decisão é tomada em três lugares: o veto visual de cada item
 * (`PackFilter`), o atalho "Selecionar todos" (`selectVisibleRespectingConflicts`,
 * chamado pela `TopbarFilters`) e o bloqueio da área (`PackConflictGuard`).
 * Escrita três vezes, ela divergiria — e já divergiu: o veto por item é calculado
 * contra a seleção do MOMENTO, então com nada marcado nenhum pack aparecia
 * desabilitado e um "Selecionar todos" ingênuo montava exatamente o estado
 * proibido. Uma função, um teste.
 *
 * O QUE ESTÁ SENDO PROTEGIDO
 * --------------------------
 * Dois packs que contêm o mesmo anúncio no mesmo dia não podem ser somados: desde
 * a migration 145 cada linha pertence a UM pack, então o mesmo anúncio-dia em dois
 * packs são duas linhas e o total conta o dia duas vezes.
 *
 * E o read-path NÃO deduplica — de propósito. A 145 tirou o `GROUP BY` do ramo por
 * pack da RPC do Manager justamente porque bloquear passou a ser o mecanismo (ver
 * "Por que bloquear e não deduplicar" em `documentation/decisoes-tecnicas.md`; foi
 * de lá que veio o −12% do Manager). Decisão de produto: analisar recortes que se
 * cruzam não é o uso esperado do app — compara-se separado, ou num pack que junte
 * os dois.
 *
 * A consequência que obriga o `graphUnavailable`: **não existe rede atrás deste
 * bloqueio**. Se o grafo não pôde ser obtido, o mapa vem vazio — e mapa vazio por
 * falha não significa "não há conflito", significa "não sei". Liberar no "não sei"
 * abriria a única porta que este módulo fecha.
 */

/** Por que um pack não pode ser marcado agora. */
export type PackVeto =
  /** Conflita com um pack já selecionado (o grafo aponta o par). */
  | { kind: "conflict"; withPackId: string }
  /** O grafo não pôde ser obtido; somar mais de um pack é indefensável. */
  | { kind: "unknown" };

export interface PackVetoInput {
  packId: string;
  /** Seleção do momento — inclui o que o usuário acabou de marcar no popover. */
  selected: ReadonlySet<string>;
  /** packId -> packs com que ele conflita (`usePackConflicts().conflictMap`). */
  conflicts: ReadonlyMap<string, ReadonlySet<string>>;
  /** `usePackConflicts().isUnavailable` — a busca do grafo falhou. */
  graphUnavailable?: boolean;
}

/**
 * Veto para MARCAR `packId`, ou `null` se pode entrar.
 *
 * Quem já está selecionado nunca é vetado: desmarcar tem de continuar possível,
 * senão o usuário fica preso no estado ruim sem saída.
 *
 * O conflito nomeado vem ANTES do "não sei": quando as duas regras se aplicam, a
 * mensagem que nomeia o par é mais útil que a genérica.
 */
export function vetoForPack({
  packId,
  selected,
  conflicts,
  graphUnavailable = false,
}: PackVetoInput): PackVeto | null {
  if (selected.has(packId)) return null;

  const enemies = conflicts.get(packId);
  if (enemies) {
    for (const selectedId of selected) {
      if (enemies.has(selectedId)) return { kind: "conflict", withPackId: selectedId };
    }
  }

  // O corte é no SEGUNDO pack: um pack sozinho não soma em duplicidade com nada,
  // e travar a seleção inteira puniria quem só quer trocar de pack.
  if (graphUnavailable && selected.size >= 1) return { kind: "unknown" };

  return null;
}

/**
 * A seleção ATUAL pode ser somada com segurança?
 *
 * Usada pelo bloqueio da área, que roda depois do clique: a seleção é persistida e
 * rehidrata, então ela pode chegar montada de um estado que hoje é proibido (um
 * refresh criou o conflito, um grant novo chegou, ou o grafo ficou indisponível).
 */
export function selectionIsUnverifiable(
  selected: readonly string[],
  graphUnavailable: boolean,
): boolean {
  return graphUnavailable && selected.length >= 2;
}

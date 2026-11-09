/**
 * Dono único do critério de julgamento (migration 186): se uma pasta (ou ancestral)
 * define critério, nada abaixo dela o edita. Estas funções dizem QUEM manda, a partir
 * de `has_judgment` das pastas — o espelho, para a tela, da regra que o backend impõe.
 */
import type { PackFolder } from "@/lib/types";

/** O que a pasta define para um pack (migrations 186/187): só esses campos ficam travados nele. */
export interface JudgmentGovernor {
  /** null = pasta de outra pessoa, que você não enxerga. */
  folder_name: string | null;
  judgment: {
    mql_leadscore_min?: number;
    target_cpr?: Record<string, number>;
    lead_economics?: unknown;
  };
}

const MAX_DEPTH = 50;

/**
 * A pasta que define o critério para `folderId`: ela mesma ou o ancestral mais próximo
 * que defina. Com `strict`, só ancestral (usado para saber se a própria pasta pode
 * definir um critério).
 */
export function judgmentGovernor(
  folders: ReadonlyArray<PackFolder>,
  folderId: string | null | undefined,
  options: { strict?: boolean } = {},
): PackFolder | null {
  if (!folderId) return null;
  const byId = new Map(folders.map((f) => [f.id, f]));
  let current = byId.get(folderId) ?? null;
  if (options.strict) current = current?.parent_id ? byId.get(current.parent_id) ?? null : null;
  for (let depth = 0; current && depth < MAX_DEPTH; depth++) {
    if (current.has_judgment) return current;
    current = current.parent_id ? byId.get(current.parent_id) ?? null : null;
  }
  return null;
}

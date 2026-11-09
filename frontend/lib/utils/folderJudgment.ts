/**
 * Dono único do critério de julgamento (migration 186): se uma pasta (ou ancestral)
 * define critério, nada abaixo dela o edita. Estas funções dizem QUEM manda, a partir
 * de `has_judgment` das pastas — o espelho, para a tela, da regra que o backend impõe.
 */
import { normalizeMqlLeadscoreMin } from "@/lib/judgment/resolveJudgment";
import type { AdsPack, PackFolder } from "@/lib/types";
import { normalizeLeadEconomics } from "./leadEconomics";

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

/**
 * Mover a pasta para dentro de `newParentId` apaga o critério próprio dela (e o das
 * subpastas) se o destino já manda — devolve as pastas que PERDEM o critério, para a tela
 * pedir confirmação. Vazio = nada a perder (o arrasto segue sem aviso).
 */
export function foldersLosingJudgment(
  folders: ReadonlyArray<PackFolder>,
  folderId: string,
  newParentId: string | null,
): PackFolder[] {
  if (!judgmentGovernor(folders, newParentId)) return [];
  const losing: PackFolder[] = [];
  const queue = [folderId];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const folder = folders.find((x) => x.id === id);
    if (folder?.has_judgment) losing.push(folder);
    folders.forEach((x) => x.parent_id === id && queue.push(x.id));
  }
  return losing;
}

/**
 * Packs que entram numa pasta que manda e TÊM valor próprio diferente do dela: o valor da
 * pasta sobrescreve o deles. Pack sem valor (ou já igual) não perde nada, então não entra.
 */
export function packsLosingJudgment(packs: ReadonlyArray<AdsPack>, folderJudgment: JudgmentGovernor["judgment"] | null | undefined): AdsPack[] {
  if (!folderJudgment) return [];
  const events = folderJudgment.target_cpr ?? {};
  return packs.filter((pack) => {
    if (folderJudgment.mql_leadscore_min !== undefined) {
      const own = normalizeMqlLeadscoreMin(pack.mql_leadscore_min);
      if (own !== null && own !== folderJudgment.mql_leadscore_min) return true;
    }
    for (const [event, value] of Object.entries(events)) {
      const own = pack.target_cpr?.[event];
      if (own !== undefined && own !== null && Number(own) !== value) return true;
    }
    if (folderJudgment.lead_economics !== undefined && pack.lead_economics) {
      const wanted = normalizeLeadEconomics(folderJudgment.lead_economics);
      if (JSON.stringify(wanted) !== JSON.stringify(pack.lead_economics)) return true;
    }
    return false;
  });
}

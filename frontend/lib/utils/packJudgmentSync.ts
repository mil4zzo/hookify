/**
 * Sincronização dos critérios de julgamento do pack entre o servidor e o store.
 *
 * O store de packs é PERSISTIDO: todo reload cai no ramo "pack já existe" de
 * `useLoadPacks`, e campo que não entra no patch fica com o valor reidratado do
 * localStorage para sempre. Para critério de julgamento isso é silencioso e caro: a
 * tela julga por um corte de MQL, meta de CPR ou economia do lead que já mudou (em
 * outra aba, outro aparelho ou por outro membro de um pack compartilhado).
 *
 * Função pura para o teste prender a lista de campos — tirar um daqui não quebra
 * nada visível até alguém recarregar a página.
 */

import type { AdsPack } from "@/lib/types";

type JudgmentFields = Pick<AdsPack, "mql_leadscore_min" | "target_cpr" | "lead_economics">;

/**
 * Patch dos campos de julgamento que mudaram no servidor. `null` e ausente são o
 * mesmo "não definido" (o backend antigo nem manda a chave); objeto compara pelo
 * JSON. Campo igual não entra — patch vazio não dispara re-render.
 */
export function buildJudgmentSyncPatch(existing: Partial<JudgmentFields>, incoming: Partial<JudgmentFields>): Partial<JudgmentFields> {
  const patch: Partial<JudgmentFields> = {};
  if ((incoming.mql_leadscore_min ?? null) !== (existing.mql_leadscore_min ?? null)) {
    patch.mql_leadscore_min = incoming.mql_leadscore_min ?? null;
  }
  if (JSON.stringify(incoming.target_cpr ?? null) !== JSON.stringify(existing.target_cpr ?? null)) {
    patch.target_cpr = incoming.target_cpr ?? null;
  }
  // Economia do lead: documento inteiro (migration 179). Cru, como veio do banco —
  // quem lê normaliza (`normalizeLeadEconomics`).
  if (JSON.stringify(incoming.lead_economics ?? null) !== JSON.stringify(existing.lead_economics ?? null)) {
    patch.lead_economics = incoming.lead_economics ?? null;
  }
  return patch;
}

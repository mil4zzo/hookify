import test from "node:test";
import assert from "node:assert/strict";
import type { LeadEconomics } from "../leadEconomics";
import { buildJudgmentSyncPatch } from "../packJudgmentSync";

/**
 * O store de packs é persistido: o que `useLoadPacks` não sincroniza fica com o
 * valor reidratado do localStorage. Estes testes prendem a lista de critérios de
 * julgamento que precisam atravessar o reload.
 */

const ECONOMICS: LeadEconomics = {
  products: [{ id: "p1", name: "Mentoria", ticket: 3000, contribution_margin: 0.55, target_margin: 0.4 }],
  bands: [{ min: null, product: "p1", conversion: 0.04 }],
};

test("nada mudou: patch vazio (não re-renderiza)", () => {
  const same = { mql_leadscore_min: 70, target_cpr: { "conversion:lead": 12 }, lead_economics: ECONOMICS };
  assert.deepEqual(buildJudgmentSyncPatch(same, structuredClone(same)), {});
  assert.deepEqual(buildJudgmentSyncPatch({}, { mql_leadscore_min: null, target_cpr: null, lead_economics: null }), {}, "ausente = null");
});

test("economia do lead alterada fora desta aba entra no patch (o store não reidrata a velha)", () => {
  const changed: LeadEconomics = { ...ECONOMICS, bands: [{ min: null, product: "p1", conversion: 0.05 }] };
  assert.deepEqual(buildJudgmentSyncPatch({ lead_economics: ECONOMICS }, { lead_economics: changed }), { lead_economics: changed });
  // Configurada por outro membro / removida por outro membro.
  assert.deepEqual(buildJudgmentSyncPatch({ lead_economics: null }, { lead_economics: ECONOMICS }), { lead_economics: ECONOMICS });
  assert.deepEqual(buildJudgmentSyncPatch({ lead_economics: ECONOMICS }, { lead_economics: null }), { lead_economics: null });
  // Backend antes da migration 179 nem manda a chave: o que estava no store é limpo.
  assert.deepEqual(buildJudgmentSyncPatch({ lead_economics: ECONOMICS }, {}), { lead_economics: null });
});

test("corte de MQL e CPR alvo continuam sincronizando como antes", () => {
  assert.deepEqual(buildJudgmentSyncPatch({ mql_leadscore_min: 70 }, { mql_leadscore_min: 80 }), { mql_leadscore_min: 80 });
  assert.deepEqual(buildJudgmentSyncPatch({ mql_leadscore_min: 70 }, { mql_leadscore_min: null }), { mql_leadscore_min: null });
  // 0 é um corte legítimo, diferente de "não definido".
  assert.deepEqual(buildJudgmentSyncPatch({ mql_leadscore_min: null }, { mql_leadscore_min: 0 }), { mql_leadscore_min: 0 });
  assert.deepEqual(buildJudgmentSyncPatch({ target_cpr: { a: 1 } }, { target_cpr: { a: 2 } }), { target_cpr: { a: 2 } });
  assert.deepEqual(buildJudgmentSyncPatch({ target_cpr: { a: 1 } }, { target_cpr: null }), { target_cpr: null });
});

test("os três juntos: cada um entra só se mudou", () => {
  const patch = buildJudgmentSyncPatch(
    { mql_leadscore_min: 70, target_cpr: { a: 1 }, lead_economics: null },
    { mql_leadscore_min: 70, target_cpr: { a: 2 }, lead_economics: ECONOMICS },
  );
  assert.deepEqual(patch, { target_cpr: { a: 2 }, lead_economics: ECONOMICS });
});

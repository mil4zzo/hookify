import test from "node:test";
import assert from "node:assert/strict";
import { buildSharedAdDetailModel, modalLeadEconomicsOutcome } from "../sharedAdDetail";
import type { LeadEconomics } from "@/lib/utils/leadEconomics";
import { getLeadscoreRaw } from "@/lib/utils/mqlMetrics";

/**
 * Modal do criativo agrupado com o período trocado lá dentro: a linha do Manager traz o
 * leadscore do período DO MANAGER em `leadscore_histogram`; o detalhe traz o do período
 * do modal em `leadscore_values`. `getLeadscoreRaw` dá precedência ao histograma — sem
 * cuidado, gasto do período novo dividia MQLs do período antigo (CPMQL, teto, margem).
 */

const baseAd = { ad_name: "Criativo", spend: 100, leadscore_histogram: { "80": 10 } } as any;
const detailAd = { spend: 50, leadscore_values: [90, 90] };

test("com o detalhe carregado, o leadscore é o do período do detalhe, não o da linha do Manager", () => {
  const model = buildSharedAdDetailModel({ baseAd, detailAd, mqlLeadscoreMin: 70 });
  assert.deepEqual(getLeadscoreRaw(model.source), [90, 90]);
  assert.equal(model.mqlCount, 2);
  assert.equal(model.cpmql, 25, "R$ 50 do período do modal ÷ 2 MQLs do mesmo período");
});

test("sem detalhe (ainda carregando), vale a linha do Manager", () => {
  const model = buildSharedAdDetailModel({ baseAd, detailAd: null, mqlLeadscoreMin: 70 });
  assert.deepEqual(getLeadscoreRaw(model.source), { "80": 10 });
  assert.equal(model.cpmql, 10);
});

test("detalhe sem leadscore na resposta (planilha fora): a linha do Manager continua valendo", () => {
  const model = buildSharedAdDetailModel({ baseAd, detailAd: { spend: 100 }, mqlLeadscoreMin: 70 });
  assert.deepEqual(getLeadscoreRaw(model.source), { "80": 10 });
});

test("vigências (D33): os trechos são do mesmo período do leadscore — os do Manager não servem ao do modal", () => {
  const managerSplit = { cuts: ["2026-10-13"], histograms: { "0": { "80": 10 } } };
  const base = { ...baseAd, leadscore_by_period: managerSplit };
  // Detalhe sem os trechos: nada de misturar o período do Manager com os leads do modal.
  assert.equal(buildSharedAdDetailModel({ baseAd: base, detailAd }).source.leadscore_by_period, undefined);
  const detailSplit = { cuts: ["2026-10-13"], histograms: { "1": { "90": 2 } } };
  assert.equal(buildSharedAdDetailModel({ baseAd: base, detailAd: { ...detailAd, leadscore_by_period: detailSplit } }).source.leadscore_by_period, detailSplit);
  // Sem detalhe ainda, vale o par da linha do Manager.
  assert.equal(buildSharedAdDetailModel({ baseAd: base, detailAd: null }).source.leadscore_by_period, managerSplit);
});

test("modal aberto fora do Manager (D33): linha sem os trechos usa o detalhe, que os pede; carregando não é falha", () => {
  const config: LeadEconomics = {
    products: [{ id: "p", name: "P", ticket: 1000, contribution_margin: 0.5, target_margin: 0.2 }],
    bands: [{ min: null, product: "p", conversion: 0.1 }],
    periods: [{ start: "2026-10-13", bands: [{ min: null, product: "p", conversion: 0.2 }] }],
  };
  const byPack = { a: config };
  const boardsRow = { pack_ids: ["a"], spend: 100, leadscore_histogram: { "70": 20 } };
  const detail = { leadscore_values: Array(20).fill(70), leadscore_by_period: { cuts: ["2026-10-13"], histograms: { "1": { "70": 20 } } } };

  const ok = modalLeadEconomicsOutcome({ ad: boardsRow, source: null, detail: { data: detail, loading: false }, spend: 100, byPack });
  assert.ok(ok.result, JSON.stringify(ok));
  assert.ok(Math.abs(ok.result.cplCeiling - 0.2 * 1000 * 0.3) < 1e-9, "todos depois de 13/10: a taxa da vigência nova");
  assert.equal(modalLeadEconomicsOutcome({ ad: boardsRow, source: null, detail: { data: undefined, loading: true }, spend: 100, byPack }).unavailable, "period-split-stale");
  // Detalhe falhou: a falha honesta, nunca a taxa da primeira vigência.
  assert.equal(modalLeadEconomicsOutcome({ ad: boardsRow, source: null, detail: { data: undefined, loading: false }, spend: 100, byPack }).unavailable, "no-period-split");
  // Linha do Manager (com os trechos) não precisa do detalhe.
  const managerRow = { ...boardsRow, leadscore_by_period: detail.leadscore_by_period };
  assert.ok(modalLeadEconomicsOutcome({ ad: managerRow, source: null, detail: null, spend: 100, byPack }).result);
});

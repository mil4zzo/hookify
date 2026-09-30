import test from "node:test";
import assert from "node:assert/strict";
import { buildSharedAdDetailModel } from "../sharedAdDetail";
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

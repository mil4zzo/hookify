import test from "node:test";
import assert from "node:assert/strict";
import {
  computeMqlMetricsFromLeadscore,
  getLeadscoreRaw,
  hasLeadscoreData,
  normalizeLeadscoreValues,
} from "../mqlMetrics";

// Gerador determinístico (LCG): 100 casos reproduzíveis sem dependência externa.
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function toHistogram(values: number[]): Record<string, number> {
  const h: Record<string, number> = {};
  for (const v of values) h[String(v)] = (h[String(v)] ?? 0) + 1;
  return h;
}

test("histograma expande para o mesmo multiconjunto do array (100 casos gerados)", () => {
  const rng = makeRng(128);
  for (let caso = 0; caso < 100; caso++) {
    const n = Math.floor(rng() * 40);
    const values = Array.from({ length: n }, () => Math.floor(rng() * 30) * 10);
    const fromArray = [...normalizeLeadscoreValues(values)].sort((a, b) => a - b);
    const fromHist = normalizeLeadscoreValues(toHistogram(values));
    assert.deepEqual(fromHist, fromArray, `caso ${caso}`);
  }
});

test("métricas derivadas são idênticas nas duas formas (média, MQL, CPMQL), com qualquer corte", () => {
  const rng = makeRng(130);
  for (let caso = 0; caso < 100; caso++) {
    const n = 1 + Math.floor(rng() * 60);
    const values = Array.from({ length: n }, () => Math.floor(rng() * 101));
    const spend = Math.round(rng() * 100000) / 100;
    for (const cut of [null, 0, 50, 80, 100]) {
      const a = computeMqlMetricsFromLeadscore({ spend, leadscoreRaw: values, mqlLeadscoreMin: cut });
      const h = computeMqlMetricsFromLeadscore({ spend, leadscoreRaw: toHistogram(values), mqlLeadscoreMin: cut });
      assert.equal(h.leadscoreValues.length, a.leadscoreValues.length, `caso ${caso} n`);
      assert.ok(Math.abs(h.leadscoreAvg - a.leadscoreAvg) < 1e-9, `caso ${caso} avg`);
      assert.equal(h.mqlCount, a.mqlCount, `caso ${caso} mql corte=${cut}`);
      assert.equal(h.cpmql, a.cpmql, `caso ${caso} cpmql corte=${cut}`);
    }
  }
});

test("chaves do histograma em qualquer grafia numérica; lixo é ignorado", () => {
  assert.deepEqual(normalizeLeadscoreValues({ "80": 2, "90.0": 1, "7.5": 1 }), [7.5, 80, 80, 90]);
  assert.deepEqual(normalizeLeadscoreValues({ abc: 3, "80": 1, "90": 0, "70": -2 }), [80]);
  assert.deepEqual(normalizeLeadscoreValues({}), []);
  assert.deepEqual(normalizeLeadscoreValues(null), []);
  assert.deepEqual(normalizeLeadscoreValues(undefined), []);
  assert.deepEqual(normalizeLeadscoreValues("80"), []);
});

test("array continua aceito exatamente como antes (telas de detalhe leem ad_metrics cru)", () => {
  assert.deepEqual(normalizeLeadscoreValues([80, "90", null, "x"]), [80, 90, 0]);
});

test("getLeadscoreRaw prefere o histograma e cai para o array; hasLeadscoreData enxerga os dois", () => {
  const hist = { "80": 1 };
  assert.equal(getLeadscoreRaw({ leadscore_histogram: hist, leadscore_values: [1] }), hist);
  assert.deepEqual(getLeadscoreRaw({ leadscore_values: [1] }), [1]);
  assert.equal(getLeadscoreRaw({}), undefined);
  assert.equal(getLeadscoreRaw(null), undefined);
  assert.equal(hasLeadscoreData({ leadscore_histogram: {} }), true);
  assert.equal(hasLeadscoreData({ leadscore_values: [] }), true);
  assert.equal(hasLeadscoreData({ leadscore_values: null }), false);
  assert.equal(hasLeadscoreData({}), false);
  assert.equal(hasLeadscoreData(undefined), false);
});

test("cache por referência funciona para o histograma (mesma referência → mesmo resultado)", () => {
  const hist = { "80": 3, "20": 1 };
  const a = computeMqlMetricsFromLeadscore({ spend: 100, leadscoreRaw: hist, mqlLeadscoreMin: 50 });
  const b = computeMqlMetricsFromLeadscore({ spend: 100, leadscoreRaw: hist, mqlLeadscoreMin: 50 });
  assert.equal(a, b);
  assert.equal(a.mqlCount, 3);
  assert.equal(a.cpmql, 100 / 3);
  assert.equal(a.leadscoreAvg, (80 * 3 + 20) / 4);
});

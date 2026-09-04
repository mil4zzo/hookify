/**
 * Histogramas das colunas vinculadas (migration 140): estatísticas, maioria e o
 * DIFERENCIAL V1 = V2 — a mesma coluna de leadscore, lida pelo caminho do leadscore
 * V1 (`leadscore_histogram`) e pelo caminho genérico (`custom:`), dá números idênticos.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { computeMqlMetricsFromLeadscore, normalizeLeadscoreValues } from "../mqlMetrics";
import {
  computeLeadscoreFacets,
  histogramCount,
  histogramEntries,
  histogramStats,
  histogramTop,
  mergeCustomHistograms,
  mergeHistograms,
} from "../customHistogram";

test("mergeHistograms soma quantidades e ignora lixo", () => {
  const into = mergeHistograms({ "25": 2 }, { "25": 1, "31": 3, "x": -4, "y": Number.NaN as unknown as number });
  assert.deepEqual(into, { "25": 3, "31": 3 });
});

test("mergeCustomHistograms soma por vínculo", () => {
  const merged = mergeCustomHistograms([
    { a: { "1": 1 }, b: { A: 2 } },
    null,
    { a: { "1": 2, "2": 1 } },
  ]);
  assert.deepEqual(merged, { a: { "1": 3, "2": 1 }, b: { A: 2 } });
});

test("histogramStats: n, média, mínimo, máximo, mediana (par e ímpar)", () => {
  // valores: 20, 30, 30, 40 → n=4, avg=30, mediana=(30+30)/2=30
  assert.deepEqual(histogramStats({ "20": 1, "30": 2, "40": 1 }), { n: 4, avg: 30, min: 20, max: 40, median: 30 });
  // valores: 10, 20, 40 → mediana 20
  assert.deepEqual(histogramStats({ "40": 1, "10": 1, "20": 1 }), { n: 3, avg: 70 / 3, min: 10, max: 40, median: 20 });
  // valores: 10, 40 → mediana 25
  assert.equal(histogramStats({ "10": 1, "40": 1 })?.median, 25);
  assert.equal(histogramStats({}), null);
  assert.equal(histogramStats(null), null);
  assert.equal(histogramCount({ "1": 2, "2": 3 }), 5);
});

test("histogramTop: maioria, fatia e empate determinístico", () => {
  assert.deepEqual(histogramTop({ A: 3, B: 5, C: 2 }), { value: "B", qty: 5, share: 0.5 });
  assert.deepEqual(histogramTop({ Z: 2, A: 2 }), { value: "A", qty: 2, share: 0.5 });
  assert.equal(histogramTop({}), null);
});

test("histogramEntries ordena numérico por valor e categoria por quantidade", () => {
  assert.deepEqual(histogramEntries({ "10": 1, "9": 2, "100": 1 }, true), [["9", 2], ["10", 1], ["100", 1]]);
  assert.deepEqual(histogramEntries({ B: 1, A: 3, C: 3 }, false), [["A", 3], ["C", 3], ["B", 1]]);
});

test("computeLeadscoreFacets: corte nulo devolve MQLs indisponíveis, média continua", () => {
  const facets = computeLeadscoreFacets({ "60": 1, "80": 2, "90": 1 }, 100, null);
  assert.equal(facets.n, 4);
  assert.equal(facets.avg, 77.5);
  assert.equal(facets.mqls, null);
  assert.equal(facets.mql_rate, null);
  assert.equal(facets.cpmql, null);
});

test("DIFERENCIAL V1 = V2: mesmo histograma, mesmas quatro métricas", () => {
  const hist = { "60": 3, "70": 1, "80": 2, "95": 4, "100": 1 };
  const spend = 1234.56;
  for (const cut of [null, 0, 70, 80, 95, 101]) {
    const v1 = computeMqlMetricsFromLeadscore({ spend, leadscoreRaw: hist, mqlLeadscoreMin: cut });
    const v1Values = normalizeLeadscoreValues(hist);
    const v2 = computeLeadscoreFacets(hist, spend, cut);
    assert.equal(v2.n, v1Values.length, `n (corte ${cut})`);
    assert.equal(v2.avg, v1.leadscoreAvg, `média (corte ${cut})`);
    assert.equal(v2.mqls, v1.mqlCount, `MQLs (corte ${cut})`);
    assert.equal(v2.cpmql, v1.cpmql, `CPMQL (corte ${cut})`);
    const v1Rate = v1.mqlCount === null || v1Values.length === 0 ? null : v1.mqlCount / v1Values.length;
    assert.equal(v2.mql_rate, v1Rate, `% MQL (corte ${cut})`);
  }
});

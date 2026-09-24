import test from "node:test";
import assert from "node:assert/strict";
import {
  LEAD_ECONOMICS_MESSAGES as M,
  computeLeadEconomics,
  computeLeadEconomicsForRows,
  countLeadscores,
  formatBandLabel,
  formatLeadScore,
  leadEconomicsSemanticKey,
  normalizeLeadEconomics,
  validateLeadEconomics,
  type LeadEconomics,
  type LeadEconomicsResult,
} from "../leadEconomics";
import { normalizeLeadscoreValues } from "../mqlMetrics";

// Gerador determinístico (LCG): casos reproduzíveis sem dependência externa.
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function near(actual: number | null | undefined, expected: number, message?: string, tol = 1e-9) {
  assert.ok(
    typeof actual === "number" && Math.abs(actual - expected) <= tol,
    `${message ?? "valor"}: esperado ${expected}, veio ${actual}`,
  );
}

function repeat(score: number, n: number): number[] {
  return Array.from({ length: n }, () => score);
}

function toHistogram(values: number[]): Record<string, number> {
  const h: Record<string, number> = {};
  for (const v of values) h[String(v)] = (h[String(v)] ?? 0) + 1;
  return h;
}

/** Cadastro válido pelo contrato, ou o teste para aqui (nunca testa a conta sobre lixo). */
function mustConfig(raw: unknown): LeadEconomics {
  const { value, errors } = validateLeadEconomics(raw);
  assert.deepEqual(errors, []);
  assert.ok(value);
  return value;
}

function nonNull(result: LeadEconomicsResult | null, message = "resultado"): LeadEconomicsResult {
  assert.ok(result, `${message}: esperado resultado, veio null`);
  return result;
}

// Exemplo da seção 5 do plano (documentation/plano-economia-do-lead.md).
const EXAMPLE_CONFIG = mustConfig({
  products: [
    { id: "p1", name: "Mentoria", ticket: 3000, contribution_margin: 0.55, target_margin: 0.4 },
    { id: "p2", name: "Ebook", ticket: 300, contribution_margin: 0.9, target_margin: 0.4 },
  ],
  bands: [
    { min: null, product: "p2", conversion: 0.005 },
    { min: 60, product: "p1", conversion: 0.04 },
    { min: 80, product: "p1", conversion: 0.12 },
  ],
});

function exampleArray(): number[] {
  // Embaralhado de propósito: a ordem dos leads não pode importar.
  const values = [...repeat(85, 9), ...repeat(70, 14), ...repeat(30, 19)];
  const rng = makeRng(5);
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

const EXAMPLE_HISTOGRAM = { "85": 9, "70": 14, "30": 19 };
const EXAMPLE_SPEND = 1310.4;

// Conta à mão (seção 5), por faixa [abaixo de 60 · Ebook, 60–80 · Mentoria, 80+ · Mentoria]:
//   faturamento por lead  0,005×300 = 1,5   · 0,04×3000 = 120  · 0,12×3000 = 360
//   contribuição por lead 1,5×0,90 = 1,35   · 120×0,55 = 66    · 360×0,55 = 198
//   teto por lead         1,5×0,50 = 0,75   · 120×0,15 = 18    · 360×0,15 = 54
//   leads                 19                · 14               · 9          (42)
const R = (19 * 1.5 + 14 * 120 + 9 * 360) / 42; // 4948,5 / 42 ≈ 117,82
const K = (19 * 1.35 + 14 * 66 + 9 * 198) / 42; // 2731,65 / 42 ≈ 65,04
const CEILING = (19 * 0.75 + 14 * 18 + 9 * 54) / 42; // 752,25 / 42 ≈ 17,91

test("(a) exemplo da seção 5, calculado à mão — array e histograma dão o mesmo resultado", () => {
  near(R, 4948.5 / 42, "conferência da conta à mão R", 1e-12);
  near(K, 2731.65 / 42, "conferência da conta à mão K", 1e-12);
  near(CEILING, 752.25 / 42, "conferência da conta à mão teto", 1e-12);

  const fromArray = nonNull(
    computeLeadEconomics({ spend: EXAMPLE_SPEND, leadscoreRaw: exampleArray(), config: EXAMPLE_CONFIG }),
  );
  const fromHistogram = nonNull(
    computeLeadEconomics({ spend: EXAMPLE_SPEND, leadscoreRaw: EXAMPLE_HISTOGRAM, config: EXAMPLE_CONFIG }),
  );
  assert.deepEqual(fromHistogram, fromArray);

  const r = fromArray;
  assert.equal(r.leadsScored, 42);
  near(r.revenuePerLead, 4948.5 / 42, "R");
  near(r.contributionPerLead, 2731.65 / 42, "K");
  near(r.cplCeiling, 752.25 / 42, "teto");
  near(r.cplActual, 31.2, "CPL");
  near(r.margin, (2731.65 / 42 - 31.2) / (4948.5 / 42), "margem");
  near(r.targetMargin, 0.4, "meta");
  assert.equal(r.lowSample, false);

  // Os números como a tela mostra (seção 5): R 117,82 · K 65,04 · teto 17,91 · margem 29%.
  assert.equal(r.revenuePerLead.toFixed(2), "117.82");
  assert.equal(r.contributionPerLead.toFixed(2), "65.04");
  assert.equal(r.cplCeiling.toFixed(2), "17.91");
  assert.equal(r.margin?.toFixed(4), "0.2872");

  assert.deepEqual(
    r.bands.map((b) => [b.index, b.min, b.max, b.label, b.product.name, b.conversion, b.leads]),
    [
      [0, null, 60, "abaixo de 60", "Ebook", 0.005, 19],
      [1, 60, 80, "60 a menos de 80", "Mentoria", 0.04, 14],
      [2, 80, null, "80 ou mais", "Mentoria", 0.12, 9],
    ],
  );
  const expectedShare = [19 / 42, 14 / 42, 9 / 42];
  const expectedRevenue = [1.5, 120, 360];
  const expectedContribution = [1.35, 66, 198];
  const expectedCeiling = [0.75, 18, 54];
  r.bands.forEach((b, i) => {
    near(b.share, expectedShare[i], `fatia faixa ${i}`);
    near(b.revenuePerLead, expectedRevenue[i], `faturamento faixa ${i}`);
    near(b.contributionPerLead, expectedContribution[i], `contribuição faixa ${i}`);
    near(b.ceilingPerLead, expectedCeiling[i], `teto faixa ${i}`);
  });

  // Invariante no ponto exato: pagando o teto por lead, a margem é exatamente a meta.
  const atCeiling = nonNull(
    computeLeadEconomics({ spend: 752.25, leadscoreRaw: EXAMPLE_HISTOGRAM, config: EXAMPLE_CONFIG }),
  );
  near(atCeiling.cplActual, 752.25 / 42, "CPL no teto");
  near(atCeiling.margin, 0.4, "margem no teto");
});

function randomConfig(rng: () => number): LeadEconomics {
  const nProducts = 1 + Math.floor(rng() * 3);
  const products = Array.from({ length: nProducts }, (_, i) => {
    const contribution = 0.05 + rng() * 0.95;
    const target = rng() < 0.2 ? 0 : rng() * contribution * 0.999;
    return {
      id: `p${i}`,
      name: `Produto ${i}`,
      ticket: Math.round((1 + rng() * 5000) * 100) / 100,
      contribution_margin: contribution,
      target_margin: target,
    };
  });
  const nBands = 1 + Math.floor(rng() * 5);
  let cut = Math.floor(rng() * 40);
  const bands = Array.from({ length: nBands }, (_, i) => {
    if (i > 0) cut += 1 + Math.floor(rng() * 25);
    return {
      min: i === 0 ? null : cut,
      product: `p${Math.floor(rng() * nProducts)}`,
      conversion: rng() < 0.15 ? 0 : rng() * 0.3,
    };
  });
  return mustConfig({ products, bands });
}

function randomScores(rng: () => number, config: LeadEconomics, n: number): number[] {
  const cuts = config.bands.map((b) => b.min).filter((m): m is number => m !== null);
  return Array.from({ length: n }, () => {
    if (cuts.length > 0 && rng() < 0.2) return cuts[Math.floor(rng() * cuts.length)];
    return Math.floor(rng() * 1300) / 10 - 10;
  });
}

test("(b) propriedade: margem ≥ meta ⇔ CPL ≤ teto (500 casos gerados)", () => {
  const rng = makeRng(175);
  let checked = 0;
  let above = 0;
  let below = 0;
  for (let caso = 0; caso < 500; caso++) {
    const config = randomConfig(rng);
    const n = 1 + Math.floor(rng() * 80);
    const scores = randomScores(rng, config, n);
    const raw = rng() < 0.5 ? scores : toHistogram(scores);
    const maxRevenue = Math.max(1, ...config.bands.map((b) => {
      const product = config.products.find((p) => p.id === b.product);
      return b.conversion * (product?.ticket ?? 0);
    }));
    const spend = Math.round(n * rng() * maxRevenue * 0.8 * 100) / 100;

    const r = nonNull(computeLeadEconomics({ spend, leadscoreRaw: raw, config }), `caso ${caso}`);
    assert.equal(r.leadsScored, n, `caso ${caso} leads`);
    assert.equal(r.bands.reduce((acc, b) => acc + b.leads, 0), n, `caso ${caso} soma das faixas`);
    if (r.margin === null) continue;
    assert.ok(r.targetMargin !== null && r.cplActual !== null, `caso ${caso}: margem sem meta/CPL`);
    // Perto da fronteira o arredondamento decide o lado; o invariante vale na conta exata.
    if (Math.abs(r.cplActual - r.cplCeiling) < 1e-9 || Math.abs(r.margin - r.targetMargin) < 1e-9) continue;

    const marginOk = r.margin >= r.targetMargin;
    const cplOk = r.cplActual <= r.cplCeiling;
    assert.equal(
      marginOk,
      cplOk,
      `caso ${caso}: margem ${r.margin} meta ${r.targetMargin} · CPL ${r.cplActual} teto ${r.cplCeiling}`,
    );
    checked++;
    if (cplOk) above++;
    else below++;
  }
  // Um teste de propriedade que só visita um lado da fronteira não provou nada.
  assert.ok(checked >= 400, `só ${checked} casos checados`);
  assert.ok(above >= 50 && below >= 50, `lados pouco visitados: ${above} na meta, ${below} abaixo`);
});

test("(c) nota exatamente no corte cai na faixa de cima; abaixo, negativa e acima de tudo", () => {
  const config = mustConfig({
    products: [{ id: "p", name: "Curso", ticket: 1000, contribution_margin: 0.5, target_margin: 0.2 }],
    bands: [
      { min: null, product: "p", conversion: 0.01 },
      { min: 60, product: "p", conversion: 0.05 },
      { min: 80, product: "p", conversion: 0.1 },
    ],
  });
  const cases: Array<[number, number]> = [
    [60, 1],
    [59.5, 0],
    [59.999, 0],
    [80, 2],
    [79.99, 1],
    [0, 0],
    [-5, 0],
    [150, 2],
  ];
  for (const [score, expectedBand] of cases) {
    const r = nonNull(computeLeadEconomics({ spend: 10, leadscoreRaw: [score], config }), `nota ${score}`);
    assert.deepEqual(
      r.bands.map((b) => b.leads),
      [0, 1, 2].map((i) => (i === expectedBand ? 1 : 0)),
      `nota ${score} deveria cair na faixa ${expectedBand}`,
    );
    near(r.cplCeiling, r.bands[expectedBand].ceilingPerLead, `teto da nota ${score}`);
  }
  // Nota no corte, via histograma: mesma regra.
  const h = nonNull(computeLeadEconomics({ spend: 10, leadscoreRaw: { "60": 2, "80": 1 }, config }));
  assert.deepEqual(h.bands.map((b) => b.leads), [0, 2, 1]);
});

test("(d) todos os leads em faixas de conversão zero: teto R$ 0 (verdade), margem e meta indisponíveis", () => {
  const config = mustConfig({
    products: [{ id: "p", name: "Curso", ticket: 1000, contribution_margin: 0.5, target_margin: 0.2 }],
    bands: [
      { min: null, product: "p", conversion: 0 },
      { min: 50, product: "p", conversion: 0.1 },
    ],
  });
  const r = nonNull(computeLeadEconomics({ spend: 30, leadscoreRaw: [10, 20, 49.9], config }));
  assert.equal(r.leadsScored, 3);
  assert.equal(r.cplCeiling, 0);
  assert.equal(r.revenuePerLead, 0);
  assert.equal(r.margin, null);
  assert.equal(r.targetMargin, null);
  assert.equal(r.cplActual, 10);
  assert.deepEqual(r.bands.map((b) => b.leads), [3, 0]);
});

test("(e) sem lead com nota ou sem cadastro → null", () => {
  for (const raw of [[], {}, undefined, null, "80", 80, { "80": 0, "90": -2, abc: 3 }]) {
    assert.equal(
      computeLeadEconomics({ spend: 100, leadscoreRaw: raw, config: EXAMPLE_CONFIG }),
      null,
      `dado bruto ${JSON.stringify(raw)}`,
    );
  }
  assert.equal(computeLeadEconomics({ spend: 100, leadscoreRaw: EXAMPLE_HISTOGRAM, config: null }), null);
  assert.equal(computeLeadEconomicsForRows([{ spend: 100, leadscoreRaw: EXAMPLE_HISTOGRAM }], null), null);
  assert.equal(computeLeadEconomicsForRows([], EXAMPLE_CONFIG), null);
  assert.equal(
    computeLeadEconomicsForRows(
      [
        { spend: 100, leadscoreRaw: {} },
        { spend: 50, leadscoreRaw: undefined },
      ],
      EXAMPLE_CONFIG,
    ),
    null,
  );
  // Documento fora do contrato (faixa apontando para produto inexistente): indisponível, não zero.
  const broken = { ...EXAMPLE_CONFIG, bands: [{ min: null, product: "nao-existe", conversion: 0.1 }] };
  assert.equal(computeLeadEconomics({ spend: 100, leadscoreRaw: [50], config: broken }), null);
  assert.equal(normalizeLeadEconomics(broken), null);
});

function naiveBandIndex(config: LeadEconomics, score: number): number {
  // Implementação independente da busca: conta quantos cortes a nota atingiu.
  return config.bands.filter((b) => b.min === null || score >= b.min).length - 1;
}

test("(f) paridade de contagem com normalizeLeadscoreValues (200 dados brutos gerados)", () => {
  const rng = makeRng(130);
  const arrayPool: unknown[] = [null, undefined, "", "80", "x", "7.5", " 90 ", NaN, Infinity, -Infinity, 0, true, false, -12];
  const keyPool = ["80", "90.0", "7.5", "abc", "", "-5", "1e2", " 60 ", "Infinity", "NaN", "0"];
  const qtyPool: unknown[] = [2, 1.7, -3, 0, 0.4, "3", "x", null, 2.9, 10, -0.5, Infinity, NaN];
  let nonEmpty = 0;

  for (let caso = 0; caso < 200; caso++) {
    let raw: unknown;
    if (rng() < 0.5) {
      const n = Math.floor(rng() * 40);
      raw = Array.from({ length: n }, () =>
        rng() < 0.4 ? arrayPool[Math.floor(rng() * arrayPool.length)] : Math.floor(rng() * 1100) / 10,
      );
    } else {
      const hist: Record<string, unknown> = {};
      const n = Math.floor(rng() * 12);
      for (let i = 0; i < n; i++) {
        const key = rng() < 0.4 ? keyPool[Math.floor(rng() * keyPool.length)] : String(Math.floor(rng() * 110));
        hist[key] = rng() < 0.5 ? qtyPool[Math.floor(rng() * qtyPool.length)] : Math.floor(rng() * 8);
      }
      raw = hist;
    }

    const expanded = normalizeLeadscoreValues(raw);
    const counts = countLeadscores(raw);
    const total = [...counts.values()].reduce((acc, q) => acc + q, 0);
    assert.equal(total, expanded.length, `caso ${caso} total`);

    const expectedCounts = new Map<number, number>();
    for (const s of expanded) expectedCounts.set(s, (expectedCounts.get(s) ?? 0) + 1);
    const sorted = (m: Map<number, number>) => [...m.entries()].sort((a, b) => a[0] - b[0]);
    assert.deepEqual(sorted(counts), sorted(expectedCounts), `caso ${caso} contagem por nota`);

    const r = computeLeadEconomics({ spend: 100, leadscoreRaw: raw, config: EXAMPLE_CONFIG });
    if (expanded.length === 0) {
      assert.equal(r, null, `caso ${caso}: sem lead deveria ser null`);
      continue;
    }
    nonEmpty++;
    const result = nonNull(r, `caso ${caso}`);
    assert.equal(result.leadsScored, expanded.length, `caso ${caso} leadsScored`);

    const expectedBands = EXAMPLE_CONFIG.bands.map(() => 0);
    for (const s of expanded) expectedBands[naiveBandIndex(EXAMPLE_CONFIG, s)]++;
    assert.deepEqual(result.bands.map((b) => b.leads), expectedBands, `caso ${caso} distribuição por faixa`);

    const fromExpanded = computeLeadEconomics({ spend: 100, leadscoreRaw: expanded, config: EXAMPLE_CONFIG });
    assert.deepEqual(result, fromExpanded, `caso ${caso}: expandido dá outro resultado`);
  }
  assert.ok(nonEmpty >= 100, `só ${nonEmpty} casos com lead`);
});

test("(g) amostra pequena: 19 leads esmaecem, 20 não", () => {
  const at19 = nonNull(computeLeadEconomics({ spend: 100, leadscoreRaw: { "70": 19 }, config: EXAMPLE_CONFIG }));
  const at20 = nonNull(computeLeadEconomics({ spend: 100, leadscoreRaw: { "70": 20 }, config: EXAMPLE_CONFIG }));
  assert.equal(at19.lowSample, true);
  assert.equal(at20.lowSample, false);
  const arr19 = nonNull(computeLeadEconomics({ spend: 100, leadscoreRaw: repeat(70, 19), config: EXAMPLE_CONFIG }));
  assert.equal(arr19.lowSample, true);
});

test("(h) linha de média: conta sobre as contagens somadas, nunca a média dos tetos", () => {
  // A nota 65 aparece nas DUAS linhas: uma junção que sobrescrevesse a contagem em
  // vez de somar ficaria com 40 (ou 2) leads nela, e não 42.
  const rowA = { spend: 50, leadscoreRaw: { "90": 3, "65": 2 } };
  const rowB = { spend: 900, leadscoreRaw: { "20": 250, "65": 40, "85": 10 } };

  const a = nonNull(computeLeadEconomics({ ...rowA, config: EXAMPLE_CONFIG }));
  const b = nonNull(computeLeadEconomics({ ...rowB, config: EXAMPLE_CONFIG }));
  near(a.cplCeiling, (3 * 54 + 2 * 18) / 5, "teto A (5 leads)"); // 39,6
  near(b.cplCeiling, (250 * 0.75 + 40 * 18 + 10 * 54) / 300, "teto B (300 leads)"); // 4,825

  const merged = nonNull(computeLeadEconomicsForRows([rowA, rowB], EXAMPLE_CONFIG));
  // À mão: 20 → 250 · 65 → 2 + 40 = 42 · 85 → 10 · 90 → 3; total 305.
  assert.equal(merged.leadsScored, 305);
  assert.deepEqual(merged.bands.map((band) => band.leads), [250, 42, 13]);
  near(merged.cplCeiling, (250 * 0.75 + 42 * 18 + 13 * 54) / 305, "teto da média"); // 1645,5 / 305 ≈ 5,40
  near(merged.cplActual, 950 / 305, "CPL da média");
  const overSummed = computeLeadEconomics({
    spend: 950,
    leadscoreRaw: { "90": 3, "20": 250, "65": 42, "85": 10 },
    config: EXAMPLE_CONFIG,
  });
  assert.deepEqual(merged, overSummed);

  const meanOfCeilings = (a.cplCeiling + b.cplCeiling) / 2; // ≈ 22,21: 5 leads pesando como 300
  assert.ok(
    Math.abs(merged.cplCeiling - meanOfCeilings) > 1,
    `teto da média ${merged.cplCeiling} não pode ser a média dos tetos ${meanOfCeilings}`,
  );

  // Duas linhas idênticas: as contagens por faixa dobram; fatia, teto e CPL não mudam.
  const twice = nonNull(computeLeadEconomicsForRows([rowB, rowB], EXAMPLE_CONFIG));
  assert.equal(twice.leadsScored, 600);
  assert.deepEqual(twice.bands.map((band) => band.leads), [500, 80, 20]);
  near(twice.cplCeiling, b.cplCeiling, "teto de duas linhas iguais");
  near(twice.cplActual, 1800 / 600, "CPL de duas linhas iguais");

  // Formas misturadas (array + histograma) somam igual.
  const mixed = nonNull(
    computeLeadEconomicsForRows([{ spend: 50, leadscoreRaw: [...repeat(90, 3), ...repeat(65, 2)] }, rowB], EXAMPLE_CONFIG),
  );
  assert.deepEqual(mixed, merged);

  // Gasto: só os finitos somam — inclusive de linha sem lead com nota (o gasto dela
  // não trouxe lead com nota, e encarece o CPL: D13). Nenhum finito → CPL indisponível.
  const withExtra = nonNull(
    computeLeadEconomicsForRows(
      [rowA, rowB, { spend: 100, leadscoreRaw: undefined }, { spend: NaN, leadscoreRaw: { "85": 0 } }, { spend: null, leadscoreRaw: [] }],
      EXAMPLE_CONFIG,
    ),
  );
  near(withExtra.cplActual, 1050 / 305, "CPL com linha sem lead");
  const noSpend = nonNull(
    computeLeadEconomicsForRows(
      [
        { spend: null, leadscoreRaw: rowA.leadscoreRaw },
        { spend: undefined, leadscoreRaw: rowB.leadscoreRaw },
      ],
      EXAMPLE_CONFIG,
    ),
  );
  assert.equal(noSpend.cplActual, null);
  assert.equal(noSpend.margin, null);
  near(noSpend.cplCeiling, merged.cplCeiling, "teto sem gasto");
});

test("(i) meta do anúncio: igual à do produto com um só; ponderada pelo faturamento com dois", () => {
  const rng = makeRng(10);
  const single = mustConfig({
    products: [{ id: "p", name: "Curso", ticket: 800, contribution_margin: 0.7, target_margin: 0.33 }],
    bands: [
      { min: null, product: "p", conversion: 0.01 },
      { min: 40, product: "p", conversion: 0.03 },
      { min: 75, product: "p", conversion: 0.09 },
    ],
  });
  for (let caso = 0; caso < 20; caso++) {
    const scores = Array.from({ length: 1 + Math.floor(rng() * 50) }, () => Math.floor(rng() * 100));
    const r = nonNull(computeLeadEconomics({ spend: 100, leadscoreRaw: scores, config: single }));
    near(r.targetMargin, 0.33, `caso ${caso} meta com um produto`);
  }

  // À mão: faixa baixa → B (ticket 100, conversão 10% → R$ 10 por lead, meta 50%);
  // faixa alta → A (ticket 1000, conversão 5% → R$ 50 por lead, meta 20%).
  // Um lead em cada: meta = (10×0,5 + 50×0,2) ÷ (10 + 50) = 15 ÷ 60 = 0,25
  // — não a média simples das metas (0,35).
  const two = mustConfig({
    products: [
      { id: "a", name: "A", ticket: 1000, contribution_margin: 0.6, target_margin: 0.2 },
      { id: "b", name: "B", ticket: 100, contribution_margin: 0.8, target_margin: 0.5 },
    ],
    bands: [
      { min: null, product: "b", conversion: 0.1 },
      { min: 50, product: "a", conversion: 0.05 },
    ],
  });
  const r = nonNull(computeLeadEconomics({ spend: 20, leadscoreRaw: [10, 90], config: two }));
  near(r.revenuePerLead, 30, "R com dois produtos");
  near(r.targetMargin, 0.25, "meta ponderada pelo faturamento");
  // Invariante no caso pequeno: teto = K − meta×R = (8 + 30)/2 − 7,5 = 11,5.
  near(r.cplCeiling, 11.5, "teto com dois produtos");
});

test("(j) gasto não numérico: CPL e margem indisponíveis, teto continua; gasto 0 é CPL 0", () => {
  for (const spend of [null, undefined, NaN, Infinity]) {
    const r = nonNull(computeLeadEconomics({ spend, leadscoreRaw: EXAMPLE_HISTOGRAM, config: EXAMPLE_CONFIG }));
    assert.equal(r.cplActual, null, `gasto ${spend}`);
    assert.equal(r.margin, null, `gasto ${spend}`);
    near(r.cplCeiling, 752.25 / 42, `teto com gasto ${spend}`);
    near(r.targetMargin, 0.4, `meta com gasto ${spend}`);
  }
  const free = nonNull(computeLeadEconomics({ spend: 0, leadscoreRaw: EXAMPLE_HISTOGRAM, config: EXAMPLE_CONFIG }));
  assert.equal(free.cplActual, 0);
  near(free.margin, 2731.65 / 4948.5, "margem com gasto zero = K ÷ R");
});

test("(k) cache por referência: mesma entrada → mesmo objeto; cadastro ou gasto novos recalculam", () => {
  const raw = { "70": 25, "90": 5 };
  const a = computeLeadEconomics({ spend: 100, leadscoreRaw: raw, config: EXAMPLE_CONFIG });
  const b = computeLeadEconomics({ spend: 100, leadscoreRaw: raw, config: EXAMPLE_CONFIG });
  assert.ok(a);
  assert.equal(b, a);

  const clone = JSON.parse(JSON.stringify(EXAMPLE_CONFIG)) as LeadEconomics;
  const c = computeLeadEconomics({ spend: 100, leadscoreRaw: raw, config: clone });
  assert.notEqual(c, a);
  assert.deepEqual(c, a);

  const otherSpend = nonNull(computeLeadEconomics({ spend: 200, leadscoreRaw: raw, config: EXAMPLE_CONFIG }));
  assert.notEqual(otherSpend, a);
  near(otherSpend.cplActual, 200 / 30, "CPL com gasto novo");
  assert.equal(computeLeadEconomics({ spend: 100, leadscoreRaw: raw, config: EXAMPLE_CONFIG }), a);

  // Cadastro editado (nova referência, conversão diferente) nunca devolve a conta velha.
  const edited = mustConfig({
    ...EXAMPLE_CONFIG,
    bands: EXAMPLE_CONFIG.bands.map((band, i) => (i === 2 ? { ...band, conversion: 0.2 } : band)),
  });
  const d = nonNull(computeLeadEconomics({ spend: 100, leadscoreRaw: raw, config: edited }));
  assert.ok(d.cplCeiling > (a?.cplCeiling ?? Infinity), "cadastro editado deveria subir o teto");
});

/** Cópia profunda do exemplo, para variar um campo só. */
function exampleCopy(): LeadEconomics {
  return JSON.parse(JSON.stringify(EXAMPLE_CONFIG)) as LeadEconomics;
}

test("(l) leitura tolerante: regra de nome não apaga cadastro gravado; a escrita continua cobrando", () => {
  // Cada documento só quebra uma regra de NOME: a conta sai igual à do exemplo.
  const duplicated = exampleCopy();
  duplicated.products[1].name = "  mentoria ";
  const empty = exampleCopy();
  empty.products[1].name = "";
  const long = exampleCopy();
  long.products[0].name = "M".repeat(80);

  const cases: Array<[string, LeadEconomics, string]> = [
    ["nome duplicado", duplicated, M.productNameDuplicate("mentoria")],
    ["nome vazio", empty, M.productNameMissing],
    ["nome de 80 caracteres", long, M.productNameTooLong],
  ];
  for (const [label, doc, message] of cases) {
    assert.deepEqual(validateLeadEconomics(doc).errors, [message], `${label}: a escrita recusa`);
    const read = normalizeLeadEconomics(doc);
    assert.ok(read, `${label}: a leitura devolve o documento`);
    assert.deepEqual(
      read.products.map((p) => p.id),
      ["p1", "p2"],
      `${label}: produtos preservados`,
    );
    const r = nonNull(computeLeadEconomics({ spend: EXAMPLE_SPEND, leadscoreRaw: EXAMPLE_HISTOGRAM, config: read }));
    near(r.cplCeiling, 752.25 / 42, `${label}: teto`);
  }
  // A leitura também apara e colapsa o nome, como a escrita.
  assert.equal(normalizeLeadEconomics(duplicated)?.products[1].name, "mentoria");

  // O que a CONTA precisa continua cobrado na leitura.
  const duplicatedId = exampleCopy();
  duplicatedId.products[1].id = "p1";
  const notIncreasing = exampleCopy();
  notIncreasing.bands[2].min = 60;
  const badNumber = exampleCopy();
  badNumber.products[0].target_margin = 0.6; // ≥ sobra: nenhum lead se paga
  const badConversion = exampleCopy();
  badConversion.bands[0].conversion = 1.5;
  for (const [label, doc] of [
    ["id duplicado", duplicatedId],
    ["cortes fora de ordem", notIncreasing],
    ["margem desejada ≥ sobra", badNumber],
    ["conversão acima de 100%", badConversion],
    ["forma", { products: "x", bands: [] }],
  ] as Array<[string, unknown]>) {
    assert.equal(normalizeLeadEconomics(doc), null, `${label}: a leitura recusa`);
  }
});

test("(m) rótulos: a nota aparece com a resolução das notas gravadas (6 casas)", () => {
  assert.equal(formatLeadScore(0.125), "0,125");
  assert.equal(formatLeadScore(0.123456), "0,123456");
  assert.equal(formatLeadScore(1234.5), "1.234,5");
  assert.equal(formatLeadScore(80), "80");

  assert.equal(formatBandLabel([{ min: null }, { min: 0.125 }], 0), "abaixo de 0,125");
  assert.equal(formatBandLabel([{ min: null }, { min: 0.125 }], 1), "0,125 ou mais");

  const cuts = [{ min: null }, { min: 0.121 }, { min: 0.124 }, { min: 0.875 }];
  assert.deepEqual(
    cuts.map((_, i) => formatBandLabel(cuts, i)),
    ["abaixo de 0,121", "0,121 a menos de 0,124", "0,124 a menos de 0,875", "0,875 ou mais"],
  );

  // O rótulo que sai do resultado da conta é o mesmo.
  const config = mustConfig({
    products: [{ id: "p", name: "Curso", ticket: 1000, contribution_margin: 0.5, target_margin: 0.2 }],
    bands: cuts.map((cut, i) => ({ min: cut.min, product: "p", conversion: 0.01 * (i + 1) })),
  });
  const r = nonNull(computeLeadEconomics({ spend: 10, leadscoreRaw: [0.1215], config }));
  assert.deepEqual(
    r.bands.map((band) => [band.label, band.leads]),
    [
      ["abaixo de 0,121", 0],
      ["0,121 a menos de 0,124", 1],
      ["0,124 a menos de 0,875", 0],
      ["0,875 ou mais", 0],
    ],
  );
});

test("(n) chave semântica (D20): muda com cada número da conta, não com id, nome, ordem ou produto sem uso", () => {
  const base = leadEconomicsSemanticKey(EXAMPLE_CONFIG);
  assert.equal(leadEconomicsSemanticKey(exampleCopy()), base, "cópia igual → mesma chave");

  // Cada um dos 5 números entra na chave (mexendo só nele, numa faixa usada).
  const changes: Array<[string, (doc: LeadEconomics) => void]> = [
    ["corte", (doc) => (doc.bands[1].min = 61)],
    ["conversão", (doc) => (doc.bands[2].conversion = 0.13)],
    ["ticket", (doc) => (doc.products[0].ticket = 3001)],
    ["sobra", (doc) => (doc.products[0].contribution_margin = 0.56)],
    ["margem desejada", (doc) => (doc.products[0].target_margin = 0.41)],
  ];
  for (const [label, change] of changes) {
    const doc = exampleCopy();
    change(doc);
    assert.notEqual(leadEconomicsSemanticKey(doc), base, `${label} diferente → chave diferente`);
  }

  // Nada disto muda número nenhum da conta.
  const cosmetic = exampleCopy();
  cosmetic.products = [
    { id: "zz", name: "Outro produto sem uso", ticket: 99999, contribution_margin: 0.3, target_margin: 0.1 },
    { ...cosmetic.products[1], id: "novo-ebook", name: "E-book renomeado" },
    { ...cosmetic.products[0], id: "nova-mentoria", name: "Mentoria renomeada" },
  ];
  cosmetic.bands = cosmetic.bands.map((band) => ({
    ...band,
    product: band.product === "p1" ? "nova-mentoria" : "novo-ebook",
  }));
  assert.equal(leadEconomicsSemanticKey(cosmetic), base, "id, nome, ordem e produto sem uso não entram");

  // Faixa de conversão 0: o produto dela não muda número nenhum (receita, teto e
  // meta da faixa dão 0) — trocar o produto não muda a chave; trocar a conversão muda.
  const zero = exampleCopy();
  zero.bands[0].conversion = 0;
  const zeroOtherProduct = exampleCopy();
  zeroOtherProduct.bands[0].conversion = 0;
  zeroOtherProduct.bands[0].product = "p1";
  assert.equal(leadEconomicsSemanticKey(zeroOtherProduct), leadEconomicsSemanticKey(zero));
  assert.notEqual(leadEconomicsSemanticKey(zero), base);
  // Pré-condição do caso: a conta dá mesmo o mesmo resultado nos dois.
  assert.deepEqual(
    computeLeadEconomics({ spend: EXAMPLE_SPEND, leadscoreRaw: EXAMPLE_HISTOGRAM, config: zero })?.cplCeiling,
    computeLeadEconomics({ spend: EXAMPLE_SPEND, leadscoreRaw: EXAMPLE_HISTOGRAM, config: zeroOtherProduct })?.cplCeiling,
  );
});

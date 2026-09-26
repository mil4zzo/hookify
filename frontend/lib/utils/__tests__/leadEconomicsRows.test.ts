import test from "node:test";
import assert from "node:assert/strict";
import {
  LEAD_ECONOMICS_TOLERANCE,
  aggregateRowsLeadEconomics,
  computeLeadEconomics,
  computeLeadEconomicsForRows,
  getRowLeadEconomics,
  leadMarginTone,
  resolveRowLeadEconomics,
  type LeadEconomics,
  type LeadEconomicsByPack,
  type LeadEconomicsRowSource,
} from "../leadEconomics";

/**
 * Economia do lead resolvida POR LINHA (D27): cada linha do Manager usa o cadastro
 * dos packs dela, e a média do conjunto pondera cada linha pelos leads com nota.
 */

/** Um produto, uma faixa: teto por lead = conversão × ticket × (sobra − meta). */
function simpleEconomics(opts: { id?: string; name?: string; ticket: number; contribution: number; target: number; conversion: number }): LeadEconomics {
  const id = opts.id ?? "p1";
  return {
    products: [{ id, name: opts.name ?? "Produto", ticket: opts.ticket, contribution_margin: opts.contribution, target_margin: opts.target }],
    bands: [{ min: null, product: id, conversion: opts.conversion }],
  };
}

// Pack A: R = 0,1 × 1000 = 100 · K = 50 · teto = 0,1 × 1000 × (0,5 − 0,2) = 30 · meta 0,2
const A = simpleEconomics({ ticket: 1000, contribution: 0.5, target: 0.2, conversion: 0.1 });
// Pack B: R = 0,1 × 2000 = 200 · K = 120 · teto = 0,1 × 2000 × (0,6 − 0,3) = 60 · meta 0,3
const B = simpleEconomics({ ticket: 2000, contribution: 0.6, target: 0.3, conversion: 0.1 });
// Mesmos números de A, id e nome diferentes (D20: é a MESMA economia).
const A_OTHER_ID = simpleEconomics({ id: "x9", name: "Outro nome", ticket: 1000, contribution: 0.5, target: 0.2, conversion: 0.1 });

function leads(score: number, qty: number): Record<string, number> {
  return { [String(score)]: qty };
}

// ── Resolução por linha ──────────────────────────────────────────────────────

test("(o) resolução: a linha usa o cadastro dos packs DELA, não da tela", () => {
  const byPack: LeadEconomicsByPack = { a: A, b: B, semCadastro: null, a2: A_OTHER_ID };

  assert.equal(resolveRowLeadEconomics(["a"], byPack).config, A, "pack único");
  assert.equal(resolveRowLeadEconomics(["b"], byPack).config, B, "o outro pack, na mesma tela");
  // D20: mesmos números com id e nome diferentes são a mesma economia.
  assert.equal(resolveRowLeadEconomics(["a", "a2"], byPack).config, A);
  assert.deepEqual(resolveRowLeadEconomics(["a", "b"], byPack), { unavailable: "mixed-economics" });
  assert.deepEqual(resolveRowLeadEconomics(["a", "semCadastro"], byPack), { unavailable: "no-economics" });
  assert.deepEqual(resolveRowLeadEconomics(["semCadastro"], byPack), { unavailable: "no-economics" });
  // Pack fora da seleção: não há cadastro conhecido para ele.
  assert.deepEqual(resolveRowLeadEconomics(["desconhecido"], byPack), { unavailable: "no-economics" });
});

test("(o) resolução: linha sem pack_ids (payload antigo) vale por todos os packs da tela", () => {
  assert.equal(resolveRowLeadEconomics(undefined, { a: A, a2: A_OTHER_ID }).config, A);
  assert.equal(resolveRowLeadEconomics([], { a: A }).config, A);
  assert.deepEqual(resolveRowLeadEconomics(null, { a: A, b: B }), { unavailable: "mixed-economics" });
  assert.deepEqual(resolveRowLeadEconomics(undefined, {}), { unavailable: "no-economics" });
});

test("(o) resolução: mesma lista de packs e mesmo mapa devolvem o mesmo objeto (cache por referência)", () => {
  const byPack: LeadEconomicsByPack = { a: A, b: B };
  const packIds = ["a"];
  assert.equal(resolveRowLeadEconomics(packIds, byPack), resolveRowLeadEconomics(packIds, byPack));
  // Mapa novo (cadastro mudou) = resolução nova: o cache não pode devolver o cadastro velho.
  const changed: LeadEconomicsByPack = { a: B, b: B };
  assert.equal(resolveRowLeadEconomics(packIds, changed).config, B);
});

// ── Resultado de uma linha ───────────────────────────────────────────────────

test("(p) linha: o resultado é a conta com o cadastro dos packs dela; o motivo quando não há", () => {
  const byPack: LeadEconomicsByPack = { a: A, b: B, semCadastro: null };
  const row: LeadEconomicsRowSource = { pack_ids: ["b"], spend: 1500, leadscore_histogram: leads(70, 30) };
  const outcome = getRowLeadEconomics(row, byPack);
  assert.ok(outcome.result);
  assert.deepEqual(outcome.result, computeLeadEconomics({ spend: 1500, leadscoreRaw: row.leadscore_histogram, config: B }));
  assert.equal(outcome.result.cplCeiling, 60);

  assert.equal(getRowLeadEconomics({ ...row, pack_ids: ["a", "b"] }, byPack).unavailable, "mixed-economics");
  assert.equal(getRowLeadEconomics({ ...row, pack_ids: ["semCadastro"] }, byPack).unavailable, "no-economics");
  assert.equal(getRowLeadEconomics({ pack_ids: ["b"], spend: 100, leadscore_histogram: {} }, byPack).unavailable, "no-scored-leads");
  // O array cru de notas (telas de detalhe) vale como o histograma.
  assert.equal(getRowLeadEconomics({ pack_ids: ["b"], spend: 100, leadscore_values: [70, 80] }, byPack).result?.leadsScored, 2);
});

test("(p) linha: gasto em texto numérico (payload antigo) vira número na borda", () => {
  const outcome = getRowLeadEconomics({ pack_ids: ["a"], spend: "300", leadscore_histogram: leads(70, 10) }, { a: A });
  assert.equal(outcome.result?.cplActual, 30);
  const noSpend = getRowLeadEconomics({ pack_ids: ["a"], spend: "", leadscore_histogram: leads(70, 10) }, { a: A });
  assert.equal(noSpend.result?.cplActual, null, "texto vazio não é gasto zero");
});

// ── Média do conjunto ────────────────────────────────────────────────────────

test("(q) média com cadastros diferentes por pack: cada linha com o seu, ponderada pelos leads (à mão)", () => {
  const byPack: LeadEconomicsByPack = { a: A, b: B };
  const rows: LeadEconomicsRowSource[] = [
    { pack_ids: ["a"], spend: 200, leadscore_histogram: leads(70, 10) },
    { pack_ids: ["b"], spend: 1500, leadscore_histogram: leads(70, 30) },
  ];
  const { aggregate } = aggregateRowsLeadEconomics(rows, byPack);
  assert.ok(aggregate);
  // leads 40 · R = (10×100 + 30×200)/40 · K = (10×50 + 30×120)/40 · teto = (10×30 + 30×60)/40
  assert.equal(aggregate.leadsScored, 40);
  assert.ok(Math.abs(aggregate.revenuePerLead - 7000 / 40) < 1e-9);
  assert.ok(Math.abs(aggregate.contributionPerLead - 4100 / 40) < 1e-9);
  assert.ok(Math.abs(aggregate.cplCeiling - 2100 / 40) < 1e-9, `teto ${aggregate.cplCeiling}`);
  // CPL = 1700 / 40 · margem = (K − CPL) ÷ R · meta = Σ leads·R·meta ÷ Σ leads·R
  assert.ok(Math.abs((aggregate.cplActual ?? NaN) - 1700 / 40) < 1e-9);
  assert.ok(Math.abs((aggregate.margin ?? NaN) - (4100 / 40 - 1700 / 40) / (7000 / 40)) < 1e-9);
  assert.ok(Math.abs((aggregate.targetMargin ?? NaN) - (10 * 100 * 0.2 + 30 * 200 * 0.3) / 7000) < 1e-9);
  // A média simples dos tetos seria 45: um anúncio de 10 leads pesaria igual a um de 30.
  assert.notEqual(Math.round(aggregate.cplCeiling * 100), 4500);
});

test("(q) média com um cadastro só = a conta sobre as contagens somadas (diferencial, 300 casos)", () => {
  let seed = 7;
  const rng = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const config: LeadEconomics = {
    products: [
      { id: "m", name: "Mentoria", ticket: 3000, contribution_margin: 0.55, target_margin: 0.4 },
      { id: "e", name: "Ebook", ticket: 300, contribution_margin: 0.9, target_margin: 0.4 },
    ],
    bands: [
      { min: null, product: "e", conversion: 0.005 },
      { min: 60, product: "m", conversion: 0.04 },
      { min: 80, product: "m", conversion: 0.12 },
    ],
  };
  const same = { ...config, products: config.products.map((p) => ({ ...p, id: `${p.id}2` })), bands: config.bands.map((b) => ({ ...b, product: `${b.product}2` })) };
  const byPack: LeadEconomicsByPack = { p1: config, p2: same };

  for (let c = 0; c < 300; c++) {
    const rows: LeadEconomicsRowSource[] = [];
    const n = 1 + Math.floor(rng() * 8);
    for (let i = 0; i < n; i++) {
      const histogram: Record<string, number> = {};
      const distinct = Math.floor(rng() * 4); // 0 = linha sem lead com nota
      for (let k = 0; k < distinct; k++) histogram[String(Math.round(rng() * 100))] = 1 + Math.floor(rng() * 40);
      const packChoice = rng();
      rows.push({
        pack_ids: packChoice < 0.3 ? ["p1"] : packChoice < 0.6 ? ["p2"] : packChoice < 0.8 ? ["p1", "p2"] : undefined,
        spend: rng() < 0.15 ? null : Math.round(rng() * 500000) / 100,
        leadscore_histogram: histogram,
      });
    }
    const aggregate = aggregateRowsLeadEconomics(rows, byPack).aggregate;
    const reference = computeLeadEconomicsForRows(
      rows.map((row) => ({ spend: row.spend as number | null, leadscoreRaw: row.leadscore_histogram })),
      config,
    );
    if (!reference) {
      assert.equal(aggregate, null, `caso ${c}: sem lead com nota`);
      continue;
    }
    assert.ok(aggregate, `caso ${c}`);
    const close = (a: number | null, b: number | null, label: string) => {
      if (a === null || b === null) return assert.equal(a, b, `caso ${c} ${label}`);
      assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `caso ${c} ${label}: ${a} × ${b}`);
    };
    assert.equal(aggregate.leadsScored, reference.leadsScored, `caso ${c} leads`);
    close(aggregate.revenuePerLead, reference.revenuePerLead, "R");
    close(aggregate.contributionPerLead, reference.contributionPerLead, "K");
    close(aggregate.cplCeiling, reference.cplCeiling, "teto");
    close(aggregate.cplActual, reference.cplActual, "CPL");
    close(aggregate.margin, reference.margin, "margem");
    close(aggregate.targetMargin, reference.targetMargin, "meta");
    assert.equal(aggregate.lowSample, reference.lowSample, `caso ${c} amostra`);
  }
});

test("(q) média: linhas deixadas de fora são contadas por motivo; quem não tem lead nem gasto não conta", () => {
  const byPack: LeadEconomicsByPack = { a: A, b: B, semCadastro: null };
  const summary = aggregateRowsLeadEconomics(
    [
      { pack_ids: ["a"], spend: 200, leadscore_histogram: leads(70, 10) },
      { pack_ids: ["a", "b"], spend: 50, leadscore_histogram: leads(70, 5) }, // mista, com lead
      { pack_ids: ["a", "b"], spend: 80, leadscore_histogram: {} }, // mista, só gasto
      { pack_ids: ["semCadastro"], spend: 0, leadscore_histogram: leads(40, 3) }, // sem cadastro, com lead
      { pack_ids: ["a", "b"], spend: 0, leadscore_histogram: {} }, // mista, nada a perder
    ],
    byPack,
  );
  assert.equal(summary.excludedMixed, 2);
  assert.equal(summary.excludedNoEconomics, 1);
  // O gasto das excluídas não entra: CPL = 200 / 10, não (200 + 50 + 80) / 15.
  assert.equal(summary.aggregate?.cplActual, 20);
});

test("(q) média: quantas linhas estão abaixo da PRÓPRIA meta", () => {
  const byPack: LeadEconomicsByPack = { a: A, b: B };
  // A: K 50, R 100, meta 0,2 → abaixo da meta com CPL > 30. B: K 120, R 200, meta 0,3 → abaixo com CPL > 60.
  const summary = aggregateRowsLeadEconomics(
    [
      { pack_ids: ["a"], spend: 10 * 25, leadscore_histogram: leads(70, 10) }, // CPL 25 ≤ 30: na meta
      { pack_ids: ["a"], spend: 10 * 40, leadscore_histogram: leads(70, 10) }, // CPL 40 > 30: abaixo
      { pack_ids: ["b"], spend: 10 * 40, leadscore_histogram: leads(70, 10) }, // CPL 40 ≤ 60: na meta de B
      { pack_ids: ["b"], spend: null, leadscore_histogram: leads(70, 10) }, // sem gasto: sem margem
    ],
    byPack,
  );
  assert.equal(summary.rowsWithMargin, 3);
  assert.equal(summary.rowsBelowTarget, 1);
});

// ── Tom da Margem ────────────────────────────────────────────────────────────

test("(r) tom da margem: na meta (com folga do ponto flutuante), lucrando abaixo, prejuízo", () => {
  // O caso medido na revisão: CPL exatamente no teto dá margem = meta com ruído de 1e-17.
  const config = simpleEconomics({ ticket: 100, contribution: 0.9, target: 0.2, conversion: 0.12 });
  const exact = computeLeadEconomics({ spend: 168, leadscoreRaw: leads(50, 20), config });
  assert.ok(exact && exact.margin !== null && exact.targetMargin !== null);
  assert.equal(leadMarginTone(exact.margin, exact.targetMargin), "success", `margem ${exact.margin} × meta ${exact.targetMargin}`);

  assert.equal(leadMarginTone(0.4, 0.4 + LEAD_ECONOMICS_TOLERANCE / 2), "success");
  assert.equal(leadMarginTone(0.39, 0.4), "warning");
  assert.equal(leadMarginTone(0, 0.4), "warning", "margem zero é empate, não prejuízo");
  assert.equal(leadMarginTone(-0.01, 0.4), "destructive");
  assert.equal(leadMarginTone(null, 0.4), null);
  assert.equal(leadMarginTone(0.1, null), "warning", "sem meta conhecida, margem positiva não é 'na meta'");
});

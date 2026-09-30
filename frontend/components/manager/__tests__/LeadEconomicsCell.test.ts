import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LEAD_ECONOMICS_UNAVAILABLE_TEXT, LeadEconomicsCell, describeLeadEconomicsValue, leadEconomicsCellView, type LeadEconomicsMetric } from "../LeadEconomicsCell";
import { computeLeadEconomics, type LeadEconomics, type LeadEconomicsByPack } from "@/lib/utils/leadEconomics";

/**
 * Célula de Teto de CPL e Margem: o que o olho e o mouse leem — a cor da Margem nos
 * três estados (pelo limiar, não pela média), o esmaecido + triângulo de alerta de amostra pequena e o
 * motivo do vazio (ícone quando é do cadastro, travessão quando é do período). A conta é testada em lib/utils/__tests__/leadEconomicsRows.test.ts.
 */

// O tsx compila o JSX do componente no modo clássico (React.createElement).
(globalThis as { React?: typeof React }).React = React;

const brl = (n: number) => `R$ ${n.toFixed(2)}`;
// Teto por lead 30 · R 100 · K 50 · meta 20%.
const A: LeadEconomics = {
  products: [{ id: "p", name: "Produto", ticket: 1000, contribution_margin: 0.5, target_margin: 0.2 }],
  bands: [{ min: null, product: "p", conversion: 0.1 }],
};
const BY_PACK: LeadEconomicsByPack = { a: A, sem: null };

function renderWith(
  byPack: LeadEconomicsByPack,
  metric: LeadEconomicsMetric,
  row: Record<string, unknown>,
  extra: { colorMetricValue?: boolean; average?: number | null } = {},
): string {
  return renderToStaticMarkup(React.createElement(LeadEconomicsCell, { row: row as any, metric, byPack, formatCurrency: brl, ...extra }));
}

function render(metric: LeadEconomicsMetric, row: Record<string, unknown>, extra: { colorMetricValue?: boolean; average?: number | null } = {}): string {
  return renderWith(BY_PACK, metric, row, extra);
}

/** O que a célula mostra, com o texto do tooltip (o HTML de um tooltip fechado não o traz). */
function view(metric: LeadEconomicsMetric, row: Record<string, unknown>) {
  return leadEconomicsCellView({ row: row as any, metric, byPack: BY_PACK, formatCurrency: brl });
}

// Com 20 leads: CPL = gasto / 20. Margem = (50 − CPL) / 100.
const row = (spend: number | null, qty = 20) => ({ pack_ids: ["a"], spend, leadscore_histogram: { "70": qty } });

test("margem: três estados pela meta (20%) — sucesso, alerta, erro", () => {
  assert.match(render("lead_margin", row(20 * 25)), /text-success/, "CPL 25 → margem 25% ≥ meta");
  assert.match(render("lead_margin", row(20 * 30)), /text-success/, "CPL no teto → margem = meta: na meta");
  assert.match(render("lead_margin", row(20 * 40)), /text-warning/, "CPL 40 → margem 10%: lucrando abaixo");
  assert.match(render("lead_margin", row(20 * 60)), /text-destructive/, "CPL 60 → margem −10%: prejuízo");
});

test("teto: cor só com 'Comparar com a média'; a margem ignora o toggle", () => {
  // Com média disponível e o toggle DESLIGADO: sem cor (é o toggle que decide, não a média).
  assert.doesNotMatch(render("cpl_ceiling", row(400), { colorMetricValue: false, average: 10 }), /text-(success|warning|destructive|attention|primary)/);
  // Teto 30 contra média 10, "maior é melhor": ganha tom (não basta casar `text-base`, que toda célula tem).
  assert.match(render("cpl_ceiling", row(400), { colorMetricValue: true, average: 10 }), /text-(success|warning|destructive|attention|primary|muted-foreground)/);
  assert.match(render("lead_margin", row(20 * 40), { colorMetricValue: false }), /text-warning/);
});

test("amostra pequena (< 20 leads com nota): esmaecida E com triângulo de alerta — o esmaecido sozinho não se lia (revisão P2)", () => {
  const small = render("cpl_ceiling", row(100, 19));
  assert.match(small, /opacity-50/);
  assert.match(small, /aria-label="Número instável"/);
  assert.match(view("cpl_ceiling", row(100, 19)).tooltip, /^Número instável: poucos leads com nota — /);
  const enough = render("cpl_ceiling", row(100, 20));
  assert.doesNotMatch(enough, /opacity-50/);
  assert.doesNotMatch(enough, /Número instável/);
});

test("tooltip do app, nunca o title nativo (revisão P2)", () => {
  const rows = [row(400), row(100, 19), row(null), { pack_ids: ["sem"], spend: 10, leadscore_histogram: { "70": 3 } }, { pack_ids: ["a"], spend: 10, leadscore_histogram: {} }];
  for (const r of rows) {
    for (const metric of ["cpl_ceiling", "lead_margin"] as const) assert.doesNotMatch(render(metric, r), /\stitle=/, `${metric} ${JSON.stringify(r)}`);
  }
});

test("vazio estrutural ganha ícone com o motivo; vazio do período fica no travessão", () => {
  // Pack sem cadastro e packs com cadastros diferentes: não viram número amanhã.
  const noEconomics = { pack_ids: ["sem"], spend: 10, leadscore_histogram: { "70": 3 } };
  const mixed = { pack_ids: ["a", "b"], spend: 10, leadscore_histogram: { "70": 3 } };
  const byPackMixed: LeadEconomicsByPack = { ...BY_PACK, b: { ...A, bands: [{ min: null, product: "p", conversion: 0.2 }] } };
  for (const [r, reason, byPack] of [
    [noEconomics, "no-economics", BY_PACK],
    [mixed, "mixed-economics", byPackMixed],
  ] as const) {
    const html = renderWith(byPack, "cpl_ceiling", r);
    assert.match(html, new RegExp(`role="img" aria-label="${LEAD_ECONOMICS_UNAVAILABLE_TEXT[reason]}"`), reason);
    assert.doesNotMatch(html, /—/, `${reason}: ícone, não travessão`);
  }
  // Sem lead com nota; margem sem gasto: o período — travessão, motivo no tooltip.
  const noLeads = { pack_ids: ["a"], spend: 10, leadscore_histogram: {} };
  assert.match(render("cpl_ceiling", noLeads), />—</);
  assert.doesNotMatch(render("cpl_ceiling", noLeads), /role="img"/);
  assert.deepEqual(view("cpl_ceiling", noLeads), { kind: "dash", tooltip: LEAD_ECONOMICS_UNAVAILABLE_TEXT["no-scored-leads"] });
  // Teto existe sem gasto; a margem, não — e diz por quê, em vez de "—" mudo.
  assert.match(render("cpl_ceiling", row(null)), /R\$ 30\.00/);
  assert.match(view("lead_margin", row(null)).tooltip, /Sem gasto no período/);
  for (const reason of Object.values(LEAD_ECONOMICS_UNAVAILABLE_TEXT)) assert.ok(reason.length > 10);
});

test("tooltip com valor: custo real, teto, meta e quantos leads", () => {
  const result = computeLeadEconomics({ spend: 800, leadscoreRaw: { "70": 20 }, config: A });
  assert.ok(result);
  const text = describeLeadEconomicsValue(result, brl);
  assert.match(text, /^R\$ 40\.00 por lead com nota · teto R\$ 30\.00 · meta .+ · 20 leads com nota$/);
});

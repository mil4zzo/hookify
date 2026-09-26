import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LEAD_ECONOMICS_UNAVAILABLE_TEXT, LeadEconomicsCell, describeLeadEconomicsValue, type LeadEconomicsMetric } from "../LeadEconomicsCell";
import { computeLeadEconomics, type LeadEconomics, type LeadEconomicsByPack } from "@/lib/utils/leadEconomics";

/**
 * Célula de Teto de CPL e Margem: o que o olho e o mouse leem — a cor da Margem nos
 * três estados (pelo limiar, não pela média), o esmaecido de amostra pequena e o
 * motivo do vazio. A conta é testada em lib/utils/__tests__/leadEconomicsRows.test.ts.
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

function render(metric: LeadEconomicsMetric, row: Record<string, unknown>, extra: { colorMetricValue?: boolean; average?: number | null } = {}): string {
  return renderToStaticMarkup(
    React.createElement(LeadEconomicsCell, { row: row as any, metric, byPack: BY_PACK, formatCurrency: brl, ...extra }),
  );
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

test("amostra pequena (< 20 leads com nota) sai esmaecida e avisa no title", () => {
  const small = render("cpl_ceiling", row(100, 19));
  assert.match(small, /opacity-50/);
  assert.match(small, /title="Número instável — /);
  assert.doesNotMatch(render("cpl_ceiling", row(100, 20)), /opacity-50/);
});

test("vazio diz o porquê: pack sem cadastro, packs misturados, sem lead com nota, sem gasto", () => {
  const html = (r: Record<string, unknown>, metric: LeadEconomicsMetric = "cpl_ceiling") => render(metric, r);
  assert.match(html({ pack_ids: ["sem"], spend: 10, leadscore_histogram: { "70": 3 } }), new RegExp(LEAD_ECONOMICS_UNAVAILABLE_TEXT["no-economics"]));
  assert.match(html({ pack_ids: ["a"], spend: 10, leadscore_histogram: {} }), new RegExp(LEAD_ECONOMICS_UNAVAILABLE_TEXT["no-scored-leads"]));
  // Teto existe sem gasto; a margem, não — e diz por quê, em vez de "—" mudo.
  assert.match(html(row(null)), /R\$ 30\.00/);
  assert.match(html(row(null), "lead_margin"), /Sem gasto no período/);
  for (const reason of Object.values(LEAD_ECONOMICS_UNAVAILABLE_TEXT)) assert.ok(reason.length > 10);
});

test("title com valor: custo real, teto, meta e quantos leads", () => {
  const result = computeLeadEconomics({ spend: 800, leadscoreRaw: { "70": 20 }, config: A });
  assert.ok(result);
  const text = describeLeadEconomicsValue(result, brl);
  assert.match(text, /^R\$ 40\.00 por lead com nota · teto R\$ 30\.00 · meta .+ · 20 leads com nota$/);
});

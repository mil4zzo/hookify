import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LeadEconomicsBreakdown } from "../LeadEconomicsBreakdown";
import { LEAD_ECONOMICS_UNAVAILABLE_TEXT } from "@/components/manager/LeadEconomicsCell";
import { getMetricNumericValueOrNull } from "@/lib/metrics";
import { getRowLeadEconomics, type LeadEconomics, type LeadEconomicsByPack } from "@/lib/utils/leadEconomics";

/**
 * A conta aberta no modal do anúncio (F3): tem de explicar o número da COLUNA — mesmo
 * teto, mesma margem, e as parcelas "Entra no teto" somando o teto. O exemplo é o da
 * seção 5 do plano (calculado à mão).
 */

// O tsx compila o JSX do componente no modo clássico (React.createElement).
(globalThis as { React?: typeof React }).React = React;

const brl = (n: number) => `R$ ${n.toFixed(2)}`;

const EXAMPLE: LeadEconomics = {
  products: [
    { id: "p1", name: "Mentoria", ticket: 3000, contribution_margin: 0.55, target_margin: 0.4 },
    { id: "p2", name: "Ebook", ticket: 300, contribution_margin: 0.9, target_margin: 0.4 },
  ],
  bands: [
    { min: null, product: "p2", conversion: 0.005 },
    { min: 60, product: "p1", conversion: 0.04 },
    { min: 80, product: "p1", conversion: 0.12 },
  ],
};
const BY_PACK: LeadEconomicsByPack = { a: EXAMPLE, b: { ...EXAMPLE, bands: EXAMPLE.bands.map((band) => ({ ...band, conversion: band.conversion * 2 })) }, sem: null };

// 42 leads com nota: 19 abaixo de 60, 14 de 60 a 80, 9 com 80 ou mais; gasto R$ 1.310,40.
const ROW = { pack_ids: ["a"], spend: 1310.4, leadscore_histogram: { "30": 19, "70": 14, "85": 9 } };

function render(row: Record<string, unknown>, defaultExpanded = true): string {
  return renderToStaticMarkup(
    React.createElement(LeadEconomicsBreakdown, { outcome: getRowLeadEconomics(row as any, BY_PACK), formatCurrency: brl, defaultExpanded }),
  );
}

test("o exemplo da seção 5: teto R$ 17,91, CPL R$ 31,20, margem 28,72% com meta 40%", () => {
  const html = render(ROW);
  assert.ok(html.includes("R$ 17.91"), "teto");
  assert.ok(html.includes("R$ 31.20"), "CPL real");
  assert.ok(html.includes(">28,72%<"), "margem (o plano arredonda para 29%)");
  assert.ok(html.includes("meta 40,00%"), "meta");
  // Lucrando, abaixo da meta: amarelo — pela META, como a coluna (não pela média).
  assert.match(html, /text-md[^"]*text-warning[^"]*">28,72%/);
  assert.ok(html.includes("Conta feita com os 42 leads com nota que casaram com a planilha."));
});

test("o modal explica a coluna: mesmo teto e mesma margem, e as parcelas somam o teto", () => {
  const outcome = getRowLeadEconomics(ROW, BY_PACK);
  assert.ok(outcome.result);
  const column = getMetricNumericValueOrNull(ROW, "cpl_ceiling", { leadEconomicsByPack: BY_PACK });
  assert.equal(outcome.result.cplCeiling, column);
  assert.equal(outcome.result.margin, getMetricNumericValueOrNull(ROW, "lead_margin", { leadEconomicsByPack: BY_PACK }));
  const parcels = outcome.result.bands.map((band) => band.share * band.ceilingPerLead);
  assert.ok(Math.abs(parcels.reduce((sum, value) => sum + value, 0) - outcome.result.cplCeiling) < 1e-9);

  const html = render(ROW);
  // Cada parcela na tabela, e o total no rodapé.
  for (const value of parcels) assert.ok(html.includes(`>${brl(value)}</td>`), brl(value));
  assert.match(html, /<tfoot>.*Teto de CPL.*R\$ 17\.91.*<\/tfoot>/);
  // Linha por faixa, na ordem do cadastro, com o produto de cada uma.
  const labels = [...html.matchAll(/<th scope="row" class="[^"]*">([^<]+)<\/th>/g)].map((match) => match[1]);
  assert.deepEqual(labels.slice(0, 3), ["abaixo de 60", "60 a menos de 80", "80 ou mais"]);
  assert.ok(html.includes(">Ebook</td>") && html.includes(">Mentoria</td>"));
});

test("a tabela abre no botão: fechada por padrão, sem ocupar a aba Geral", () => {
  const closed = render(ROW, false);
  assert.ok(!closed.includes("<table"), "fechada");
  assert.match(closed, /aria-expanded="false"[^>]*>.*Ver a conta por faixa/);
  assert.match(render(ROW, true), /aria-expanded="true"/);
});

test("sem conta, o bloco diz por quê — o mesmo texto da célula da coluna", () => {
  assert.ok(render({ ...ROW, pack_ids: ["sem"] }).includes(LEAD_ECONOMICS_UNAVAILABLE_TEXT["no-economics"]));
  assert.ok(render({ ...ROW, pack_ids: ["a", "b"] }).includes(LEAD_ECONOMICS_UNAVAILABLE_TEXT["mixed-economics"]));
  assert.ok(render({ ...ROW, leadscore_histogram: {} }).includes(LEAD_ECONOMICS_UNAVAILABLE_TEXT["no-scored-leads"]));
});

test("amostra pequena avisa; sem gasto, CPL e margem ficam em branco (nunca R$ 0)", () => {
  const small = render({ ...ROW, leadscore_histogram: { "85": 5 } });
  assert.ok(small.includes("Menos de 20 leads com nota"));
  assert.ok(!render(ROW).includes("Menos de 20 leads com nota"));

  const noSpend = render({ ...ROW, spend: null });
  assert.ok(noSpend.includes("R$ 17.91"), "o teto existe sem gasto");
  assert.ok(!noSpend.includes("R$ 0.00"), "CPL sem gasto não é R$ 0");
});

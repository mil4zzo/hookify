import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { availableShareHighlightOptions, buildShareAverages, buildShareMetricsFromRow } from "../buildShareItem";
import { METRIC_LABELS, SHARE_METRIC_SECTIONS, formatShareMetric } from "../metricsDisplay";
import { SHARE_METRIC_KEYS } from "../types";
import { computeManagerAverages } from "@/lib/metrics";
import type { LeadEconomics, LeadEconomicsByPack } from "@/lib/utils/leadEconomics";

/**
 * O snapshot do link público: o que o navegador monta, o que o backend aceita
 * (`ALLOWED_METRIC_KEYS`) e o que a página pública mostra têm de ser a MESMA lista —
 * chave que o backend não conhece é descartada calada, e a métrica some do link sem
 * erro nenhum. Teto e Margem entram como qualquer outra métrica (D18 revista, 2026-09-30).
 */

const A: LeadEconomics = {
  products: [{ id: "p", name: "Mentoria", ticket: 1000, contribution_margin: 0.5, target_margin: 0.2 }],
  bands: [{ min: null, product: "p", conversion: 0.1 }],
};
const B: LeadEconomics = { ...A, bands: [{ min: null, product: "p", conversion: 0.2 }] };
const BY_PACK: LeadEconomicsByPack = { a: A, b: B, sem: null };
const CONTEXT = { actionType: "", mqlLeadscoreMin: null, leadEconomicsByPack: BY_PACK };

// Teto 30 por lead; 20 leads com nota, gasto 800 → CPL 40 → margem (50 − 40) ÷ 100 = 10%.
const rowA = { ad_name: "A", pack_ids: ["a"], spend: 800, leadscore_histogram: { "70": 20 } } as any;

test("snapshot, backend e página pública com a MESMA lista de métricas", () => {
  const built = Object.keys(buildShareMetricsFromRow(rowA, CONTEXT)).sort();
  assert.deepEqual(built, [...SHARE_METRIC_KEYS].sort(), "o snapshot monta exatamente as chaves do contrato");

  // A allowlist do backend, lida do fonte: sem ela, a chave nova é descartada calada.
  const source = readFileSync(join(process.cwd(), "..", "backend", "app", "routes", "shares.py"), "utf8");
  const block = /ALLOWED_METRIC_KEYS[^=]*=\s*frozenset\(\{([\s\S]*?)\}\)/.exec(source);
  assert.ok(block, "ALLOWED_METRIC_KEYS não encontrada em shares.py");
  const backend = [...block[1].matchAll(/"([a-z0-9_]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(backend, [...SHARE_METRIC_KEYS].sort(), "backend aceita as mesmas chaves");

  // Toda chave com rótulo, e as de métrica (não as contagens de subtítulo) numa seção.
  for (const key of SHARE_METRIC_KEYS) assert.ok(METRIC_LABELS[key], key);
  const inSections = new Set(SHARE_METRIC_SECTIONS.flatMap((section) => section.cards.flatMap((card) => [card.key, card.subtitleOf].filter(Boolean))));
  for (const key of SHARE_METRIC_KEYS) assert.ok(inSections.has(key), `${key} não aparece na página pública`);
});

test("teto e margem de cada criativo com o cadastro do pack dele; sem cadastro, ausentes (nunca 0)", () => {
  const metrics = buildShareMetricsFromRow(rowA, CONTEXT);
  assert.equal(metrics.cpl_ceiling, 30);
  assert.ok(Math.abs((metrics.lead_margin ?? NaN) - 0.1) < 1e-12);

  const noEconomics = buildShareMetricsFromRow({ ...rowA, pack_ids: ["sem"] }, CONTEXT);
  assert.equal(noEconomics.cpl_ceiling, null);
  assert.equal(noEconomics.lead_margin, null);
  const mixed = buildShareMetricsFromRow({ ...rowA, pack_ids: ["a", "b"] }, CONTEXT);
  assert.equal(mixed.cpl_ceiling, null, "packs com cadastros diferentes: sem teto (D27)");
  const noMap = buildShareMetricsFromRow(rowA, { actionType: "", mqlLeadscoreMin: null });
  assert.equal(noMap.cpl_ceiling, null);
});

test("médias do link: as do cabeçalho, ponderadas pelos leads", () => {
  const rowB = { ad_name: "B", pack_ids: ["b"], spend: 400, leadscore_histogram: { "70": 20 } };
  const averages = computeManagerAverages([rowA, rowB], { hasSheetIntegration: true, leadEconomicsByPack: BY_PACK });
  const shared = buildShareAverages(averages);
  assert.equal(shared.cpl_ceiling, averages.cpl_ceiling);
  assert.equal(shared.lead_margin, averages.lead_margin);
  assert.equal(shared.cpl_ceiling, 45, "teto 30 e 60, 20 leads cada");
});

test("destaques: Teto e Margem oferecidos só quando algum criativo do link tem o valor", () => {
  const keys = (metrics: Parameters<typeof availableShareHighlightOptions>[0]) => availableShareHighlightOptions(metrics).map((option) => option.key);
  const withEconomics = buildShareMetricsFromRow(rowA, CONTEXT);
  const without = buildShareMetricsFromRow({ ...rowA, pack_ids: ["sem"] }, CONTEXT);

  assert.ok(keys([without, withEconomics]).includes("cpl_ceiling"));
  assert.ok(keys([without, withEconomics]).includes("lead_margin"));
  const none = keys([without]);
  assert.ok(!none.includes("cpl_ceiling") && !none.includes("lead_margin"));
  // As outras continuam oferecidas sempre, como antes.
  assert.ok(none.includes("spend") && none.includes("cpmql"));
  // Teto sem margem (criativo sem gasto): só o que existe.
  const noSpend = keys([buildShareMetricsFromRow({ ...rowA, spend: null }, CONTEXT)]);
  assert.ok(noSpend.includes("cpl_ceiling") && !noSpend.includes("lead_margin"));
});

test("página pública: teto em dinheiro, margem em porcentagem", () => {
  assert.equal(formatShareMetric("cpl_ceiling", 30, "BRL"), "R$ 30,00");
  assert.equal(formatShareMetric("lead_margin", 0.1, "BRL"), "10.00%");
  assert.equal(formatShareMetric("lead_margin", -0.25, "BRL"), "-25.00%");
});

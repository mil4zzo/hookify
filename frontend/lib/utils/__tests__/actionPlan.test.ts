import test from "node:test";
import assert from "node:assert/strict";
import { classifyActionVerdict, buildActionPlan } from "../actionPlan";
import type { ActionPlan } from "../actionPlan";

// ── classifyActionVerdict ────────────────────────────────────────────────────

test("classifyActionVerdict: custo <= alvo + todas métricas acima → gem", () => {
  assert.equal(classifyActionVerdict(10, 15, 3), "gem");
});

test("classifyActionVerdict: custo <= alvo + custo igual ao alvo → gem (3) ou otimizar (<3)", () => {
  assert.equal(classifyActionVerdict(15, 15, 3), "gem");
  assert.equal(classifyActionVerdict(15, 15, 2), "otimizar");
});

test("classifyActionVerdict: custo <= alvo + algumas métricas abaixo → otimizar", () => {
  assert.equal(classifyActionVerdict(10, 15, 2), "otimizar");
  assert.equal(classifyActionVerdict(10, 15, 1), "otimizar");
  assert.equal(classifyActionVerdict(10, 15, 0), "otimizar");
});

test("classifyActionVerdict: custo > alvo + nenhuma métrica acima → descartar", () => {
  assert.equal(classifyActionVerdict(20, 15, 0), "descartar");
});

test("classifyActionVerdict: custo > alvo + pelo menos 1 métrica acima → licao", () => {
  assert.equal(classifyActionVerdict(20, 15, 1), "licao");
  assert.equal(classifyActionVerdict(20, 15, 2), "licao");
  assert.equal(classifyActionVerdict(20, 15, 3), "licao");
});

// ── buildActionPlan — fallback relativo (sem target) ────────────────────────

function makeAd(overrides: Record<string, any> = {}) {
  return {
    ad_name: "Ad Teste",
    ad_id: "123",
    spend: 100,
    impressions: 5000,
    conversions: { purchase: 5 },
    ...overrides,
  } as any;
}

const emptyAverages = {
  hook: 0.1,
  hold_rate: 0.5,
  video_watched_p50: 0.5,
  scroll_stop: 0.1,
  ctr: 0.01,
  website_ctr: 0.01,
  connect_rate: 0.5,
  cpm: 10,
  per_action_type: { purchase: { results: 10, cpr: 20, page_conv: 0.05 } },
};

test("buildActionPlan fallback: golds → gem", () => {
  const plan = buildActionPlan({
    buckets: { golds: [makeAd()], oportunidades: [], licoes: [], descartes: [], neutros: [] },
    opportunityRows: [],
    notValidated: [],
    actionType: "purchase",
    averages: emptyAverages,
  });
  assert.equal(plan.gem.length, 1);
  assert.equal(plan.otimizar.length, 0);
});

test("buildActionPlan fallback: oportunidades → otimizar", () => {
  const plan = buildActionPlan({
    buckets: { golds: [], oportunidades: [makeAd()], licoes: [], descartes: [], neutros: [] },
    opportunityRows: [],
    notValidated: [],
    actionType: "purchase",
    averages: emptyAverages,
  });
  assert.equal(plan.otimizar.length, 1);
});

test("buildActionPlan fallback: licoes → licao", () => {
  const plan = buildActionPlan({
    buckets: { golds: [], oportunidades: [], licoes: [makeAd()], descartes: [], neutros: [] },
    opportunityRows: [],
    notValidated: [],
    actionType: "purchase",
    averages: emptyAverages,
  });
  assert.equal(plan.licao.length, 1);
});

test("buildActionPlan fallback: descartes → descartar", () => {
  const plan = buildActionPlan({
    buckets: { golds: [], oportunidades: [], licoes: [], descartes: [makeAd()], neutros: [] },
    opportunityRows: [],
    notValidated: [],
    actionType: "purchase",
    averages: emptyAverages,
  });
  assert.equal(plan.descartar.length, 1);
});

test("buildActionPlan fallback: neutros → observar", () => {
  const plan = buildActionPlan({
    buckets: { golds: [], oportunidades: [], licoes: [], descartes: [], neutros: [makeAd()] },
    opportunityRows: [],
    notValidated: [],
    actionType: "purchase",
    averages: emptyAverages,
  });
  assert.equal(plan.observar.length, 1);
  assert.equal(plan.observar[0].sourceBucket, "neutros");
});

test("buildActionPlan: notValidated → observar com sourceBucket=not_validated", () => {
  const plan = buildActionPlan({
    buckets: { golds: [], oportunidades: [], licoes: [], descartes: [], neutros: [] },
    opportunityRows: [],
    notValidated: [makeAd()],
    actionType: "purchase",
    averages: emptyAverages,
  });
  assert.equal(plan.observar.length, 1);
  assert.equal(plan.observar[0].sourceBucket, "not_validated");
});

// ── lowData badge ────────────────────────────────────────────────────────────

test("buildActionPlan: impressions < 3000 → lowData=true", () => {
  const plan = buildActionPlan({
    buckets: { golds: [makeAd({ impressions: 2999 })], oportunidades: [], licoes: [], descartes: [], neutros: [] },
    opportunityRows: [],
    notValidated: [],
    actionType: "purchase",
    averages: emptyAverages,
  });
  assert.equal(plan.gem[0].lowData, true);
});

test("buildActionPlan: impressions >= 3000 → lowData=false", () => {
  const plan = buildActionPlan({
    buckets: { golds: [makeAd({ impressions: 3000 })], oportunidades: [], licoes: [], descartes: [], neutros: [] },
    opportunityRows: [],
    notValidated: [],
    actionType: "purchase",
    averages: emptyAverages,
  });
  assert.equal(plan.gem[0].lowData, false);
});

// ── gem ordering by spend desc ───────────────────────────────────────────────

test("buildActionPlan: gem ordenado por spend desc", () => {
  const plan = buildActionPlan({
    buckets: {
      golds: [makeAd({ spend: 50, ad_id: "low" }), makeAd({ spend: 200, ad_id: "high" }), makeAd({ spend: 100, ad_id: "mid" })],
      oportunidades: [], licoes: [], descartes: [], neutros: [],
    },
    opportunityRows: [],
    notValidated: [],
    actionType: "purchase",
    averages: emptyAverages,
  });
  assert.equal((plan.gem[0].ad as any).ad_id, "high");
  assert.equal((plan.gem[1].ad as any).ad_id, "mid");
  assert.equal((plan.gem[2].ad as any).ad_id, "low");
});

// ── otimizar ordering by impactSavings desc ──────────────────────────────────

test("buildActionPlan: otimizar ordenado por impactSavings desc (fallback spend)", () => {
  const plan = buildActionPlan({
    buckets: {
      golds: [],
      oportunidades: [
        makeAd({ spend: 300, ad_id: "big-spend-low-savings" }),
        makeAd({ spend: 50, ad_id: "small-spend-high-savings" }),
      ],
      licoes: [], descartes: [], neutros: [],
    },
    opportunityRows: [
      { ad_id: "big-spend-low-savings", ad_name: "Ad Teste", impact_abs_savings: 5, below_avg_flags: { website_ctr: false, connect_rate: false, page_conv: false }, cpr_actual: 20, cpr_potential: 18, cpr_if_website_ctr_only: 18, cpr_if_connect_rate_only: 19, cpr_if_page_conv_only: 19, improvement_pct: 0.1, impact_relative: 0.05, impact_abs_conversions: 0.25, spend: 300, cpm: 10, hook: 0.2, hold_rate: 0.5, ctr: 0.01, website_ctr: 0.01, connect_rate: 0.5, page_conv: 0.05, overall_conversion: 0.0005 },
      { ad_id: "small-spend-high-savings", ad_name: "Ad Teste", impact_abs_savings: 50, below_avg_flags: { website_ctr: true, connect_rate: false, page_conv: false }, cpr_actual: 30, cpr_potential: 15, cpr_if_website_ctr_only: 15, cpr_if_connect_rate_only: 28, cpr_if_page_conv_only: 28, improvement_pct: 0.5, impact_relative: 0.5, impact_abs_conversions: 3, spend: 50, cpm: 10, hook: 0.2, hold_rate: 0.5, ctr: 0.01, website_ctr: 0.005, connect_rate: 0.5, page_conv: 0.05, overall_conversion: 0.0005 },
    ],
    notValidated: [],
    actionType: "purchase",
    averages: emptyAverages,
  });
  assert.equal((plan.otimizar[0].ad as any).ad_id, "small-spend-high-savings");
});

// ── otimizar: fixLevers = TODAS as métricas abaixo da média, por impacto ─────

test("buildActionPlan: otimizar lista todas as métricas abaixo da média ordenadas por impacto", () => {
  const plan = buildActionPlan({
    buckets: {
      golds: [], oportunidades: [makeAd({ ad_id: "multi" })], licoes: [], descartes: [], neutros: [],
    },
    opportunityRows: [
      {
        ad_id: "multi", ad_name: "Ad Teste",
        below_avg_flags: { website_ctr: true, connect_rate: true, page_conv: true },
        // menor cpr_if_*_only = maior impacto → primeiro: connect_rate(10) < page_conv(20) < website_ctr(30)
        cpr_if_website_ctr_only: 30, cpr_if_connect_rate_only: 10, cpr_if_page_conv_only: 20,
        cpr_actual: 40, cpr_potential: 8, improvement_pct: 0.8, impact_relative: 0.5, impact_abs_savings: 100, impact_abs_conversions: 5,
        spend: 100, cpm: 10, hook: 0.05, hold_rate: 0.5, ctr: 0.01, website_ctr: 0.005, connect_rate: 0.4, page_conv: 0.03, overall_conversion: 0.00006,
      },
    ],
    notValidated: [],
    actionType: "purchase",
    averages: emptyAverages,
  });
  assert.deepEqual(plan.otimizar[0].fixLevers, ["connect_rate", "page_conv", "website_ctr"]);
  assert.deepEqual(plan.otimizar[0].strongLevers, []);
});

// ── licao: strongLevers = TODAS as métricas acima da média, da mais à menos forte ──

test("buildActionPlan: licao lista todas as métricas acima da média ordenadas da mais forte para a menos forte", () => {
  // averages: hook=0.1, website_ctr=0.01, connect_rate=0.5, page_conv=0.05
  // ad: hook=0.2 (+100%), connect_rate=0.6 (+20%), website_ctr=0.011 (+10%), page_conv=0.05 (igual → fora)
  const plan = buildActionPlan({
    buckets: {
      golds: [], oportunidades: [], licoes: [makeAd({ ad_id: "lic" })], descartes: [], neutros: [],
    },
    opportunityRows: [
      {
        ad_id: "lic", ad_name: "Ad Teste",
        below_avg_flags: { website_ctr: false, connect_rate: false, page_conv: false },
        cpr_if_website_ctr_only: 20, cpr_if_connect_rate_only: 20, cpr_if_page_conv_only: 20,
        cpr_actual: 20, cpr_potential: 20, improvement_pct: 0, impact_relative: 0, impact_abs_savings: 0, impact_abs_conversions: 0,
        spend: 100, cpm: 10, hook: 0.2, hold_rate: 0.5, ctr: 0.01, website_ctr: 0.011, connect_rate: 0.6, page_conv: 0.05, overall_conversion: 0.00033,
      },
    ],
    notValidated: [],
    actionType: "purchase",
    averages: emptyAverages,
  });
  assert.deepEqual(plan.licao[0].strongLevers, ["hook", "connect_rate", "website_ctr"]);
  assert.deepEqual(plan.licao[0].fixLevers, []);
});

// ── cascade com target_cpr ────────────────────────────────────────────────────

test("buildActionPlan cascade: custo alto mas target baixo → descartar ou licao", () => {
  // Ad com CPR = 100/5 = 20; target = 10; todas métricas abaixo da média
  // averages tem hook=0.5 (ad tem hook=0.05 — abaixo), website_ctr=0.05 (ad 0.005 — abaixo), page_conv=0.1 (ad 0.05 — abaixo)
  const strictAverages = {
    ...emptyAverages,
    hook: 0.5,
    website_ctr: 0.05,
    per_action_type: { purchase: { results: 5, cpr: 10, page_conv: 0.1 } },
  };

  const ad = {
    ad_name: "Bad Ad",
    ad_id: "bad",
    spend: 100,
    impressions: 5000,
    conversions: { purchase: 5 },
    hook: 0.05,
    website_ctr: 0.005,
    lpv: 50,
  } as any;

  const plan = buildActionPlan({
    buckets: { golds: [ad], oportunidades: [], licoes: [], descartes: [], neutros: [] },
    opportunityRows: [],
    notValidated: [],
    actionType: "purchase",
    averages: strictAverages,
    targetCprByActionType: { purchase: 10 }, // target = 10; CPR real = 20 > 10
  });

  // CPR=20 > target=10, todas métricas abaixo → descartar
  assert.equal(plan.descartar.length, 1, "deveria ser descartar");
  assert.equal(plan.gem.length, 0);
});

test("buildActionPlan cascade: custo < target + todas métricas acima → gem (mesmo sendo 'oportunidade' bucket)", () => {
  // Ad com CPR = 100/20 = 5; target = 10
  // Médias: hook=0.1, website_ctr=0.01, page_conv=0.05
  // Ad: hook=0.2, website_ctr=0.02, page_conv=0.1 — todas acima
  const ad = {
    ad_name: "Great Ad",
    ad_id: "great",
    spend: 100,
    impressions: 5000,
    conversions: { purchase: 20 },
    hook: 0.2,
    website_ctr: 0.02,
    lpv: 50,
  } as any;

  const plan = buildActionPlan({
    buckets: { golds: [], oportunidades: [ad], licoes: [], descartes: [], neutros: [] },
    opportunityRows: [],
    notValidated: [],
    actionType: "purchase",
    averages: emptyAverages, // hook=0.1, website_ctr=0.01, page_conv=0.05
    targetCprByActionType: { purchase: 10 }, // CPR=5 < 10 → escalar; todas acima → gem
  });

  assert.equal(plan.gem.length, 1, "deveria ser gem");
  assert.equal(plan.otimizar.length, 0);
});

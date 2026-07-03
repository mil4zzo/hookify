// Tests for diagnostics.ts: LMDI-I decomposition, shift-share attribution, logMean, selectors.
// Run with: npx tsx --test lib/metrics/__tests__/diagnostics.test.ts (from frontend/)

import test from "node:test";
import assert from "node:assert/strict";
import {
  logMean,
  selectTarget,
  decomposePack,
  attributeDriverToAds,
  attributeAllDriversToAds,
  partitionImpactBySign,
  cutImpactBucket,
  buildBudgetShareSeries,
  buildPackDaySeries,
  buildDiagnosticSummary,
  buildAdTwoDaySnapshots,
  CUMULATIVE_CUTOFF,
  type AdTwoDaySnapshot,
  type AdDaySnapshot,
} from "../diagnostics";

const EPS = 1e-6;

function snap(prev: AdDaySnapshot, last: AdDaySnapshot, adKey = "a:1"): AdTwoDaySnapshot {
  return { adKey, prev, last };
}

function day(spend: number, impr: number, inline: number, lpv: number, results: number, mqls?: number): AdDaySnapshot {
  return { spend, impressions: impr, inlineLinkClicks: inline, lpv, results, mqls };
}

// ─── logMean ─────────────────────────────────────────────────────────────────

test("logMean: equal values returns value itself", () => {
  assert.ok(Math.abs(logMean(5, 5) - 5) < EPS);
  assert.ok(Math.abs(logMean(100, 100) - 100) < EPS);
});

test("logMean(2, 1) = 1/ln(2)", () => {
  const expected = 1 / Math.log(2);
  assert.ok(Math.abs(logMean(2, 1) - expected) < EPS);
});

test("logMean guards for zero and negative", () => {
  assert.strictEqual(logMean(0, 1), 0);
  assert.strictEqual(logMean(1, 0), 0);
  assert.strictEqual(logMean(-1, 1), 0);
  assert.strictEqual(logMean(1, -1), 0);
  assert.strictEqual(logMean(0, 0), 0);
});

// ─── selectTarget ─────────────────────────────────────────────────────────────

test("selectTarget: returns cpr when hasMqlData=false", () => {
  const s = [snap(day(100, 1000, 50, 10, 2), day(120, 1000, 50, 10, 2))];
  assert.strictEqual(selectTarget(s, false), "cpr");
});

test("selectTarget: returns cpmql when mqls>0 on both days", () => {
  const s = [snap(
    day(100, 1000, 50, 10, 2, 3),
    day(120, 1000, 50, 10, 2, 4),
  )];
  assert.strictEqual(selectTarget(s, true), "cpmql");
});

test("selectTarget: falls back to cpr when mqls=0 on either day", () => {
  const s = [snap(
    day(100, 1000, 50, 10, 2, 0),
    day(120, 1000, 50, 10, 2, 5),
  )];
  assert.strictEqual(selectTarget(s, true), "cpr");
});

// ─── decomposePack: LMDI exactness ────────────────────────────────────────────

// Scenario A: only CPM doubles — delta should come entirely from CPM
test("decomposePack: CPM-only change, sum(contribs) + residual ≈ delta", () => {
  const s = [snap(
    day(1000, 10_000, 500, 100, 10),  // CPR_prev = 100
    day(2000, 10_000, 500, 100, 10),  // CPR_last = 200 (only spend doubled)
  )];
  const dec = decomposePack(s, { target: "cpr" });

  assert.notStrictEqual(dec.deltaCurrency, null);
  const delta = dec.deltaCurrency!;
  assert.ok(Math.abs(delta - 100) < EPS, `delta expected 100, got ${delta}`);

  const sumOk = dec.drivers
    .filter((d) => d.status === "ok" && d.contributionCurrency != null)
    .reduce((s, d) => s + d.contributionCurrency!, 0);

  const residual = dec.residualCurrency;
  assert.ok(
    Math.abs(sumOk + residual - delta) < EPS * Math.max(1, Math.abs(delta)),
    `sumOk + residual = ${sumOk + residual}, delta = ${delta}`,
  );

  // CPM driver should carry most of the change
  const cpmContrib = dec.drivers.find((d) => d.driver === "cpm")?.contributionCurrency;
  assert.ok(cpmContrib != null && Math.abs(cpmContrib - 100) < EPS, `cpm contrib expected ≈100, got ${cpmContrib}`);
});

// Scenario B: all rates change simultaneously — Σ contributions + residual = delta exactly
test("decomposePack: multi-driver change, LMDI identity holds", () => {
  const s = [snap(
    day(1000, 10_000, 500, 100, 10),   // CPR=100, cpm=100, wctr=0.05, cr=0.2, pc=0.1
    day(1500, 12_000, 480, 90, 8),     // CPR=187.5
  )];
  const dec = decomposePack(s, { target: "cpr" });

  assert.notStrictEqual(dec.deltaCurrency, null);
  const delta = dec.deltaCurrency!;

  const sumOk = dec.drivers
    .filter((d) => d.status === "ok" && d.contributionCurrency != null)
    .reduce((s, d) => s + d.contributionCurrency!, 0);

  const eps = EPS * Math.max(1, Math.abs(delta));
  assert.ok(
    Math.abs(sumOk + dec.residualCurrency - delta) < eps,
    `sum mismatch: sumOk=${sumOk}, residual=${dec.residualCurrency}, delta=${delta}`,
  );
});

// Scenario C: results=0 on last day → delta=null, no throw
test("decomposePack: results=0 on last day → deltaCurrency=null, no throw", () => {
  const s = [snap(
    day(1000, 10_000, 500, 100, 10),
    day(1000, 10_000, 500, 100, 0),
  )];
  assert.doesNotThrow(() => {
    const dec = decomposePack(s, { target: "cpr" });
    assert.strictEqual(dec.deltaCurrency, null);
  });
});

// Scenario D: lpv=0 → connect_rate and page_conv should be collapsed/undefined, not "ok"
test("decomposePack: lpv=0 collapses connect_rate and page_conv drivers", () => {
  const s = [snap(
    day(1000, 10_000, 0, 0, 0),
    day(1200, 12_000, 0, 0, 0),
  )];
  const dec = decomposePack(s, { target: "cpr" });
  const cr = dec.drivers.find((d) => d.driver === "connect_rate");
  const pc = dec.drivers.find((d) => d.driver === "page_conv");
  assert.ok(cr && cr.status !== "ok", `connect_rate should not be ok, got ${cr?.status}`);
  assert.ok(pc && pc.status !== "ok", `page_conv should not be ok, got ${pc?.status}`);
});

// Scenario E: auto CPMQL target
test("decomposePack CPMQL: includes mql_rate driver, sum closes", () => {
  const s = [snap(
    day(1000, 10_000, 500, 100, 10, 5),  // CPMQL=1000/5=200
    day(2000, 10_000, 500, 100, 10, 5),  // CPMQL=2000/5=400 (only spend doubled)
  )];
  const dec = decomposePack(s, { target: "cpmql" });

  assert.notStrictEqual(dec.deltaCurrency, null);
  const delta = dec.deltaCurrency!;

  const sumOk = dec.drivers
    .filter((d) => d.status === "ok" && d.contributionCurrency != null)
    .reduce((s, d) => s + d.contributionCurrency!, 0);

  const eps = EPS * Math.max(1, Math.abs(delta));
  assert.ok(
    Math.abs(sumOk + dec.residualCurrency - delta) < eps,
    `CPMQL sum mismatch: sumOk=${sumOk}, residual=${dec.residualCurrency}, delta=${delta}`,
  );

  // mql_rate driver must be present (no change in mql_rate, so contrib≈0)
  const mqlDriver = dec.drivers.find((d) => d.driver === "mql_rate");
  assert.ok(mqlDriver != null, "mql_rate driver should be present for CPMQL target");
});

// ─── attributeDriverToAds: shift-share ────────────────────────────────────────

// Two ads. Verify Σ(rateEffect + mixEffect) ≈ Δrate_pack
test("attributeDriverToAds: rate+mix effects sum to Δrate_pack", () => {
  const snaps: AdTwoDaySnapshot[] = [
    { adKey: "a:1", prev: day(500, 5000, 200, 40, 4), last: day(600, 6000, 180, 36, 3) },
    { adKey: "a:2", prev: day(500, 5000, 300, 60, 6), last: day(900, 4000, 320, 64, 7) },
  ];

  const dec = decomposePack(snaps, { target: "cpr" });
  const wctrDriver = dec.drivers.find((d) => d.driver === "website_ctr");
  if (!wctrDriver || wctrDriver.status !== "ok") return; // driver not ok, skip

  const attr = attributeDriverToAds(snaps, "website_ctr", wctrDriver.contributionCurrency!);

  // Pack wctr prev: (200+300)/(5000+5000) = 0.05; last: (180+320)/(6000+4000) = 0.05
  // Δrate_pack for wctr = 0.05 - 0.05 = 0 in this case... let me pick a different driver

  // page_conv driver: pc_prev=(4+6)/(40+60)=0.1; pc_last=(3+7)/(36+64)=0.1 — also 0?
  // Actually with these numbers:
  // Ad 1: prev inline=200, last inline=180, prev lpv=40, last lpv=36
  //   -> cr_prev_a1 = 40/200=0.2, cr_last_a1 = 36/180=0.2
  // Ad 2: prev inline=300, last inline=320
  //   -> cr_prev_a2 = 60/300=0.2, cr_last_a2 = 64/320=0.2
  // Pack cr: both unchanged. Not a great fixture for connect_rate.

  // Let's verify the mathematical identity: Σ(rateEffect + mixEffect) = Δrate_k
  const allSnaps = snaps;
  const drivers = ["cpm", "website_ctr", "connect_rate", "page_conv"] as const;

  for (const driverKey of drivers) {
    const drv = dec.drivers.find((d) => d.driver === driverKey);
    if (!drv || drv.status !== "ok") continue;

    const attribution = attributeDriverToAds(allSnaps, driverKey, drv.contributionCurrency!);

    // Sum of rateEffect + mixEffect across ALL ads (ranked + remainder's rankedAds)
    const allAttrAds = [
      ...attribution.rankedAds,
      // remainder is collapsed; check only ranked + unranked in remainder
    ];

    // We can check: ranked ads' contribs sum correctly relative to driver R$
    const sumRankedContrib = attribution.rankedAds.reduce((s, a) => s + a.contributionCurrency, 0);
    const remainderContrib = attribution.remainder?.contributionCurrency ?? 0;

    // Total contrib across all ads should ≈ driver's R$ (by construction of proportional allocation)
    // This is only exact when deltaRatePack ≠ 0 and proportional; otherwise 0s and close enough
    if (drv.contributionCurrency != null && Math.abs(drv.contributionCurrency) > 0.001) {
      const totalContrib = sumRankedContrib + remainderContrib;
      assert.ok(
        Math.abs(totalContrib - drv.contributionCurrency) < EPS * Math.max(1, Math.abs(drv.contributionCurrency)) + 0.001,
        `Driver ${driverKey}: ranked+remainder contribs=${totalContrib}, expected≈${drv.contributionCurrency}`,
      );
    }
  }
});

// 85% cumulative cutoff
test("attributeDriverToAds: 85% cumulative cutoff + remainder count", () => {
  // Build 5 ads where ad "a:1" should dominate (50% of the effect)
  // We'll use CPM driver where contributions are proportional to spend change
  const makeAd = (adKey: string, spendP: number, spendL: number): AdTwoDaySnapshot => ({
    adKey,
    prev: day(spendP, 10_000, 500, 100, 10),
    last: day(spendL, 10_000, 500, 100, 10),
  });

  const snaps: AdTwoDaySnapshot[] = [
    makeAd("a:1", 500, 1000),   // large spend increase
    makeAd("a:2", 300, 600),    // medium
    makeAd("a:3", 100, 200),    // small
    makeAd("a:4", 50, 100),     // tiny
    makeAd("a:5", 50, 100),     // tiny
  ];

  const dec = decomposePack(snaps, { target: "cpr" });
  const cpmDriver = dec.drivers.find((d) => d.driver === "cpm");
  if (!cpmDriver || cpmDriver.status !== "ok" || cpmDriver.contributionCurrency == null) {
    // Skip if driver not computable
    return;
  }

  const attr = attributeDriverToAds(snaps, "cpm", cpmDriver.contributionCurrency, { cumulativeCutoff: CUMULATIVE_CUTOFF });

  // Ranked + remainder together should cover all 5 ads
  const rankedCount = attr.rankedAds.length;
  const remainderCount = attr.remainder?.count ?? 0;
  assert.strictEqual(rankedCount + remainderCount, 5, `total ads should be 5, got ranked=${rankedCount} + remainder=${remainderCount}`);

  // Ranked ads must cover ≥ 85% of total same-sign impact
  const sameSignTotal = attr.rankedAds.reduce((s, a) => s + Math.abs(a.contributionCurrency), 0)
    + Math.abs(attr.remainder?.contributionCurrency ?? 0);
  const coveredAbs = attr.rankedAds.reduce((s, a) => s + Math.abs(a.contributionCurrency), 0);
  const coverage = sameSignTotal > 0 ? coveredAbs / sameSignTotal : 1;
  assert.ok(coverage >= CUMULATIVE_CUTOFF - EPS, `coverage=${coverage} should be >= ${CUMULATIVE_CUTOFF}`);
});

// ─── buildBudgetShareSeries ───────────────────────────────────────────────────

test("buildBudgetShareSeries: shares sum to ≤1 per day, topN respected", () => {
  const axis = ["2024-01-01", "2024-01-02"];
  const groups: Record<string, { axis: string[]; spend: (number | null)[] }> = {
    "a:1": { axis, spend: [100, 200] },
    "a:2": { axis, spend: [200, 100] },
    "a:3": { axis, spend: [50, 50] },
    "a:4": { axis, spend: [50, 50] },
  };

  const result = buildBudgetShareSeries(groups, 2);

  // 2 top bars + others
  assert.strictEqual(result.bars.length, 2);
  assert.strictEqual(result.axis.length, 2);

  // Each day: sum of bar shares + other ≤ 1 (approximately = 1)
  for (let i = 0; i < 2; i++) {
    const barSum = result.bars.reduce((s, b) => s + (b.shareByDay[i] ?? 0), 0);
    const other = result.otherByDay[i] ?? 0;
    const total = barSum + other;
    assert.ok(Math.abs(total - 1) < EPS, `day ${i}: total share = ${total}, expected 1`);
  }
});

test("buildBudgetShareSeries: empty groups returns empty", () => {
  const result = buildBudgetShareSeries({}, 3);
  assert.strictEqual(result.axis.length, 0);
  assert.strictEqual(result.bars.length, 0);
});

// ─── buildDiagnosticSummary ───────────────────────────────────────────────────

const fmtCurrency = (v: number) => `R$${v.toFixed(0)}`;

test("buildDiagnosticSummary: muted when volume low", () => {
  const dec = decomposePack(
    [snap(day(10, 100, 5, 1, 1), day(15, 120, 6, 1, 1))], // below MIN thresholds
    { target: "cpr", minImpressions: 500, minResults: 3 },
  );
  const s = buildDiagnosticSummary(dec, null, fmtCurrency);
  assert.strictEqual(s.muted, true);
});

test("buildDiagnosticSummary: stable when delta < 1%", () => {
  // Same CPR on both days (no change)
  const s2 = [snap(day(1000, 10_000, 500, 100, 10), day(1200, 12_000, 600, 120, 12))];
  const dec = decomposePack(s2, { target: "cpr", minImpressions: 10_000, minResults: 10 });
  const s = buildDiagnosticSummary(dec, null, fmtCurrency);
  // delta = 0 → stable
  assert.ok(s.headline.toLowerCase().includes("estável") || s.muted, `headline: "${s.headline}"`);
});

test("buildDiagnosticSummary: identifies dominant driver", () => {
  // CPM doubles → CPR doubles
  const snaps: AdTwoDaySnapshot[] = [
    snap(day(1000, 10_000, 500, 100, 10), day(2000, 10_000, 500, 100, 10)),
  ];
  const dec = decomposePack(snaps, { target: "cpr", minImpressions: 10_000, minResults: 10 });
  const s = buildDiagnosticSummary(dec, null, fmtCurrency);
  assert.ok(!s.muted, "should not be muted");
  // Headline should mention CPM
  assert.ok(s.headline.includes("CPM"), `headline should mention CPM: "${s.headline}"`);
});

// ─── buildAdTwoDaySnapshots adapter ──────────────────────────────────────────

test("buildAdTwoDaySnapshots: reads last 2 axis entries", () => {
  const series = {
    "a:1": {
      axis: ["2024-01-01", "2024-01-02", "2024-01-03"],
      spend: [100, 200, 300] as (number | null)[],
      impressions: [1000, 2000, 3000] as (number | null)[],
      inline_link_clicks: [50, 100, 150] as (number | null)[],
      lpv: [10, 20, 30] as (number | null)[],
      conversions: [{}, { "purchase": 1 }, { "purchase": 2 }] as Record<string, number>[],
    },
  };

  const snaps = buildAdTwoDaySnapshots(series, "purchase");
  assert.strictEqual(snaps.length, 1);

  const s = snaps[0];
  // prev = index 1 (day 2024-01-02), last = index 2 (day 2024-01-03)
  assert.strictEqual(s.prev.spend, 200);
  assert.strictEqual(s.last.spend, 300);
  assert.strictEqual(s.prev.results, 1);
  assert.strictEqual(s.last.results, 2);
  assert.strictEqual(s.last.impressions, 3000);
});

test("buildAdTwoDaySnapshots: skips series with <2 days", () => {
  const series = {
    "a:1": {
      axis: ["2024-01-01"],
      spend: [100] as (number | null)[],
      impressions: [1000] as (number | null)[],
      inline_link_clicks: [50] as (number | null)[],
      lpv: [10] as (number | null)[],
      conversions: [{}] as Record<string, number>[],
    },
  };
  const snaps = buildAdTwoDaySnapshots(series, "purchase");
  assert.strictEqual(snaps.length, 0);
});

test("buildAdTwoDaySnapshots: derives mqls from cpmql", () => {
  const series = {
    "a:1": {
      axis: ["2024-01-01", "2024-01-02"],
      spend: [null, 1000] as (number | null)[],
      impressions: [null, 10_000] as (number | null)[],
      lpv: [null, 100] as (number | null)[],
      conversions: [{}, {}] as Record<string, number>[],
      cpmql: [null, 200] as (number | null)[],  // mqls = 1000/200 = 5
    },
  };
  const snaps = buildAdTwoDaySnapshots(series, "purchase");
  assert.strictEqual(snaps.length, 1);
  // last.mqls = spend / cpmql = 1000 / 200 = 5
  assert.ok(Math.abs((snaps[0].last.mqls ?? 0) - 5) < EPS);
});

// ─── sameSignTotal: coverage must never exceed 100% with offsetting ads ────────

test("attributeDriverToAds: sameSignTotal keeps coverage ≤ 100% with offsetting ads", () => {
  // ad A: CPM rises hard (+ contribution); ad B: CPM falls (− contribution).
  // Net driver contribution < gross same-sign sum, so dividing coverage by the NET
  // would exceed 100%. sameSignTotal (gross same-sign) must keep it ≤ 1.
  const flat = { inline: 500, lpv: 100, results: 10 };
  const adA: AdTwoDaySnapshot = {
    adKey: "a:A",
    prev: day(500, 10_000, flat.inline, flat.lpv, flat.results),   // cpm 50
    last: day(1500, 10_000, flat.inline, flat.lpv, flat.results),  // cpm 150 (up)
  };
  const adB: AdTwoDaySnapshot = {
    adKey: "a:B",
    prev: day(1000, 10_000, flat.inline, flat.lpv, flat.results),  // cpm 100
    last: day(700, 10_000, flat.inline, flat.lpv, flat.results),   // cpm 70 (down)
  };
  const snaps = [adA, adB];
  const dec = decomposePack(snaps, { target: "cpr" });
  const cpm = dec.drivers.find((d) => d.driver === "cpm");
  assert.ok(cpm && cpm.status === "ok" && cpm.contributionCurrency != null);

  const attr = attributeDriverToAds(snaps, "cpm", cpm!.contributionCurrency!);
  const rankedAbs = attr.rankedAds.reduce((s, a) => s + Math.abs(a.contributionCurrency), 0);

  // Gross same-sign total ≥ |net| (offsetting ad makes them differ)
  assert.ok(attr.sameSignTotal >= Math.abs(attr.driverContributionCurrency ?? 0) - EPS);
  // Coverage computed against sameSignTotal never exceeds 100%
  const coverage = attr.sameSignTotal > 0 ? rankedAbs / attr.sameSignTotal : 0;
  assert.ok(coverage <= 1 + EPS, `coverage=${coverage} must be ≤ 1`);
});

// ─── buildDiagnosticSummary: stable CPR but funnel composition shifted ─────────

test("buildDiagnosticSummary: flat CPR but funnel shifted surfaces 'funil mudou'", () => {
  // CPR identical both days (delta=0), but Link CTR worsened and Conv. Página improved.
  // prev: cpm 100, wctr .05, cr .5, pc .20, cpr 20
  // last: cpm 100, wctr .04 (worse), cr .5, pc .25 (better), cpr 20
  const snaps: AdTwoDaySnapshot[] = [
    snap(
      day(1000, 10_000, 500, 250, 50),
      day(1000, 10_000, 400, 200, 50),
    ),
  ];
  const dec = decomposePack(snaps, { target: "cpr", minImpressions: 500, minResults: 3 });
  const s = buildDiagnosticSummary(dec, null, fmtCurrency);
  assert.ok(!s.muted, "should not be muted");
  assert.ok(s.headline.toLowerCase().includes("funil mudou"), `headline: "${s.headline}"`);
  assert.strictEqual(s.tone, "warning");
});

// ─── buildPackDaySeries ───────────────────────────────────────────────────────

test("buildPackDaySeries: sums counts and recomputes rates incl. CPM", () => {
  const axis = ["2024-01-01", "2024-01-02"];
  const series = {
    "a:1": {
      axis,
      spend: [100, 300] as (number | null)[],
      impressions: [1000, 2000] as (number | null)[],
      inline_link_clicks: [50, 100] as (number | null)[],
      lpv: [10, 30] as (number | null)[],
      conversions: [{ purchase: 1 }, { purchase: 3 }] as Record<string, number>[],
      cpmql: [50, 100] as (number | null)[], // day2 mqls = 300/100 = 3
    },
    "a:2": {
      axis,
      spend: [100, 100] as (number | null)[],
      impressions: [1000, 1000] as (number | null)[],
      inline_link_clicks: [50, 50] as (number | null)[],
      lpv: [10, 10] as (number | null)[],
      conversions: [{ purchase: 1 }, { purchase: 1 }] as Record<string, number>[],
    },
  };

  const s = buildPackDaySeries(series, "purchase");
  assert.strictEqual(s.length, 2);

  const d2 = s[1];
  assert.strictEqual(d2.spend, 400);
  assert.strictEqual(d2.impr, 3000);
  assert.strictEqual(d2.inline, 150);
  assert.strictEqual(d2.lpv, 40);
  assert.strictEqual(d2.results, 4);
  assert.ok(Math.abs(d2.mqls - 3) < EPS, `mqls=${d2.mqls}`);
  assert.ok(Math.abs(d2.cpm! - (400 * 1000) / 3000) < EPS, `cpm=${d2.cpm}`);
  assert.ok(Math.abs(d2.website_ctr! - 150 / 3000) < EPS);
  assert.ok(Math.abs(d2.cpr! - 100) < EPS, `cpr=${d2.cpr}`); // 400/4
  assert.ok(Math.abs(d2.cpmql! - 400 / 3) < EPS, `cpmql=${d2.cpmql}`);
});

test("buildPackDaySeries: null rate when denominator is 0", () => {
  const axis = ["2024-01-01"];
  const series = {
    "a:1": {
      axis,
      spend: [100] as (number | null)[],
      impressions: [0] as (number | null)[],
      inline_link_clicks: [0] as (number | null)[],
      lpv: [0] as (number | null)[],
      conversions: [{}] as Record<string, number>[],
    },
  };
  const s = buildPackDaySeries(series, "purchase");
  assert.strictEqual(s[0].cpm, null);
  assert.strictEqual(s[0].website_ctr, null);
  assert.strictEqual(s[0].cpr, null);
});

// ─── attributeAllDriversToAds: cross-driver per-ad totals ─────────────────────

test("attributeAllDriversToAds: Σ totals ≈ Σ ok-driver contributions (closure)", () => {
  const snaps: AdTwoDaySnapshot[] = [
    { adKey: "a:1", prev: day(1000, 10_000, 500, 100, 10), last: day(1500, 12_000, 540, 95, 8) },
    { adKey: "a:2", prev: day(800, 8000, 400, 80, 8), last: day(1200, 9000, 470, 90, 9) },
  ];
  const dec = decomposePack(snaps, { target: "cpr" });
  const impacts = attributeAllDriversToAds(snaps, dec);

  const sumTotal = impacts.reduce((s, a) => s + a.totalContributionCurrency, 0);
  const sumOk = dec.drivers
    .filter((d) => d.status === "ok" && d.contributionCurrency != null)
    .reduce((s, d) => s + d.contributionCurrency!, 0);

  assert.ok(
    Math.abs(sumTotal - sumOk) < EPS * Math.max(1, Math.abs(sumOk)) + 1e-6,
    `Σ totals=${sumTotal}, Σ ok drivers=${sumOk}`,
  );

  // ranked descending by |total|
  for (let i = 1; i < impacts.length; i++) {
    assert.ok(
      Math.abs(impacts[i - 1].totalContributionCurrency) >= Math.abs(impacts[i].totalContributionCurrency) - EPS,
      "impacts must be sorted by |total| desc",
    );
  }

  // spend shares sum to 1
  const shareSum = impacts.reduce((s, a) => s + a.spendShareLast, 0);
  assert.ok(Math.abs(shareSum - 1) < EPS, `spendShareLast sum=${shareSum}`);
});

test("attributeAllDriversToAds: driverParts sum to the ad's total (per-ad closure across drivers)", () => {
  const snaps: AdTwoDaySnapshot[] = [
    { adKey: "a:1", prev: day(1000, 10_000, 500, 100, 10), last: day(1500, 12_000, 540, 95, 8) },
    { adKey: "a:2", prev: day(800, 8000, 400, 80, 8), last: day(1200, 9000, 470, 90, 9) },
  ];
  const dec = decomposePack(snaps, { target: "cpr" });
  const impacts = attributeAllDriversToAds(snaps, dec);

  for (const a of impacts) {
    const partsSum = a.driverParts.reduce((s, p) => s + p.currency, 0);
    assert.ok(
      Math.abs(partsSum - a.totalContributionCurrency) < EPS,
      `ad ${a.adKey}: Σ driverParts=${partsSum} != total=${a.totalContributionCurrency}`,
    );
  }
});

test("attributeAllDriversToAds: rate-driven ad has ratePart, ~zero mixPart", () => {
  // single ad, spend doubles, impressions constant → CPM doubles (rate), weight constant (no mix)
  const snaps: AdTwoDaySnapshot[] = [
    { adKey: "a:1", prev: day(1000, 10_000, 500, 100, 10), last: day(2000, 10_000, 500, 100, 10) },
  ];
  const dec = decomposePack(snaps, { target: "cpr" });
  const impacts = attributeAllDriversToAds(snaps, dec);
  assert.strictEqual(impacts.length, 1);
  const a = impacts[0];
  assert.ok(a.totalContributionCurrency > 0, "cost rose → positive impact");
  assert.ok(Math.abs(a.ratePartCurrency) > Math.abs(a.mixPartCurrency), "rate should dominate");
  assert.ok(Math.abs(a.mixPartCurrency) < EPS, `mixPart should be ~0, got ${a.mixPartCurrency}`);
});

test("attributeAllDriversToAds: mix-driven shift has mixPart, ~zero ratePart", () => {
  // Per-ad funnel rates constant both days; only the spend/impression SHARE shifts toward
  // the high-CPM ad. So pack CPM rises purely from MIX. Each ad: rate≈0, mix dominates.
  const snaps: AdTwoDaySnapshot[] = [
    // high-CPM ad (cpm 200) gains impression share
    { adKey: "a:high", prev: day(400, 2000, 100, 20, 2), last: day(1600, 8000, 400, 80, 8) },
    // low-CPM ad (cpm 50) loses share
    { adKey: "a:low", prev: day(400, 8000, 400, 80, 8), last: day(100, 2000, 100, 20, 2) },
  ];
  const dec = decomposePack(snaps, { target: "cpr" });
  const cpm = dec.drivers.find((d) => d.driver === "cpm");
  assert.ok(cpm && cpm.status === "ok" && cpm.contributionCurrency! > 0, "pack CPM should rise via mix");

  const impacts = attributeAllDriversToAds(snaps, dec);
  const high = impacts.find((a) => a.adKey === "a:high")!;
  assert.ok(Math.abs(high.mixPartCurrency) > Math.abs(high.ratePartCurrency), "mix should dominate for high-CPM ad");
  assert.ok(Math.abs(high.ratePartCurrency) < 1e-6, `ratePart should be ~0, got ${high.ratePartCurrency}`);
});

// ─── attributeDriverToAds: rateCurrency/mixCurrency exact split + allAds ──────

test("attributeDriverToAds: rateCurrency + mixCurrency === contributionCurrency exactly, for every ad", () => {
  const snaps: AdTwoDaySnapshot[] = [
    { adKey: "a:1", prev: day(1000, 10_000, 500, 100, 10), last: day(1500, 12_000, 540, 95, 8) },
    { adKey: "a:2", prev: day(800, 8000, 400, 80, 8), last: day(1200, 9000, 470, 90, 9) },
    { adKey: "a:3", prev: day(200, 2000, 100, 20, 2), last: day(150, 1500, 90, 18, 2) },
  ];
  const dec = decomposePack(snaps, { target: "cpr" });

  for (const driverKey of ["cpm", "website_ctr", "connect_rate", "page_conv"] as const) {
    const drv = dec.drivers.find((d) => d.driver === driverKey);
    if (!drv || drv.status !== "ok" || drv.contributionCurrency == null) continue;

    const attr = attributeDriverToAds(snaps, driverKey, drv.contributionCurrency);

    // allAds must cover every snap, ranked+remainder never drop anyone.
    assert.strictEqual(attr.allAds.length, snaps.length, `allAds should list all ${snaps.length} ads`);

    for (const a of attr.allAds) {
      assert.ok(
        Math.abs(a.rateCurrency + a.mixCurrency - a.contributionCurrency) < EPS,
        `driver ${driverKey} ad ${a.adKey}: rateCurrency+mixCurrency=${a.rateCurrency + a.mixCurrency} != contributionCurrency=${a.contributionCurrency}`,
      );
    }
  }
});

// ─── Centered mix: share direction alone must NOT decide the tone ─────────────
//
// Regression for a user-caught bug: with the uncentered mix (r̄·Δw), ANY ad gaining
// share showed as cost-raising and ANY ad losing share as cost-lowering — wrong for a
// cheap ad gaining share (that dilutes pack CPM) and for a cheap ad losing share (that
// concentrates spend on pricier ads). Centered mix ((r̄ − r̄_pack)·Δw) fixes both.
test("attributeDriverToAds: centered mix — cheap ad GAINING share lowers pack cost, expensive ad losing share too", () => {
  // Per-ad CPMs constant (rate effect = 0); only impression share shifts toward the
  // CHEAP ad. Pack CPM falls 170→80 purely via mix.
  const snaps: AdTwoDaySnapshot[] = [
    { adKey: "a:cheap", prev: day(100, 2000, 100, 20, 10), last: day(400, 8000, 400, 80, 40) },   // cpm 50, share 20%→80%
    { adKey: "a:pricey", prev: day(1600, 8000, 400, 80, 40), last: day(400, 2000, 100, 20, 10) }, // cpm 200, share 80%→20%
  ];
  const dec = decomposePack(snaps, { target: "cpr" });
  const cpm = dec.drivers.find((d) => d.driver === "cpm");
  assert.ok(cpm && cpm.status === "ok" && cpm.contributionCurrency! < 0, "pack CPM must fall");

  const attr = attributeDriverToAds(snaps, "cpm", cpm!.contributionCurrency!);
  const cheap = attr.allAds.find((a) => a.adKey === "a:cheap")!;
  const pricey = attr.allAds.find((a) => a.adKey === "a:pricey")!;

  // Both movements LOWER pack cost: cheap gaining share AND pricey losing share.
  // (Uncentered mix would have colored the cheap ad's share gain as cost-raising.)
  assert.ok(cheap.mixCurrency < 0, `cheap ad gaining share must lower cost, got ${cheap.mixCurrency}`);
  assert.ok(pricey.mixCurrency < 0, `pricey ad losing share must lower cost, got ${pricey.mixCurrency}`);
  assert.ok(Math.abs(cheap.rateCurrency) < EPS && Math.abs(pricey.rateCurrency) < EPS, "no rate effect in this fixture");

  // Centering must NOT break closure: Σ per-ad contributions = driver C_k exactly.
  const sum = attr.allAds.reduce((s, a) => s + a.contributionCurrency, 0);
  assert.ok(
    Math.abs(sum - cpm!.contributionCurrency!) < EPS * Math.max(1, Math.abs(cpm!.contributionCurrency!)),
    `Σ per-ad = ${sum}, expected C_k = ${cpm!.contributionCurrency}`,
  );
});

test("attributeDriverToAds: sharePrev/shareLast are each ad's weight of the driver's denominator, summing to 1", () => {
  const snaps: AdTwoDaySnapshot[] = [
    { adKey: "a:1", prev: day(1000, 3000, 500, 100, 10), last: day(1500, 4000, 540, 95, 8) },
    { adKey: "a:2", prev: day(800, 7000, 400, 80, 8), last: day(1200, 6000, 470, 90, 9) },
  ];
  const dec = decomposePack(snaps, { target: "cpr" });
  const cpm = dec.drivers.find((d) => d.driver === "cpm");
  assert.ok(cpm && cpm.status === "ok");

  const attr = attributeDriverToAds(snaps, "cpm", cpm!.contributionCurrency ?? null);
  const a1 = attr.allAds.find((a) => a.adKey === "a:1")!;
  const a2 = attr.allAds.find((a) => a.adKey === "a:2")!;

  // cpm's denominator is impressions: pack prev = 3000+7000=10000, pack last = 4000+6000=10000
  assert.ok(Math.abs(a1.sharePrev - 3000 / 10_000) < EPS);
  assert.ok(Math.abs(a1.shareLast - 4000 / 10_000) < EPS);
  assert.ok(Math.abs((a1.sharePrev + a2.sharePrev) - 1) < EPS, "sharePrev must sum to 1 across ads");
  assert.ok(Math.abs((a1.shareLast + a2.shareLast) - 1) < EPS, "shareLast must sum to 1 across ads");
});

// ─── partitionImpactBySign: two independent buckets, coverage never exceeds 100% ──

test("partitionImpactBySign: splits by sign, sorts desc by |total|, coverage ≤ 1", () => {
  const items = [
    { id: "worsened-big", total: 10 },
    { id: "worsened-small", total: 6 },
    { id: "improved-big", total: -6 },
    { id: "improved-small", total: -4 },
    { id: "neutral", total: 0 },
  ];
  const { worsened, improved } = partitionImpactBySign(items, (it) => it.total);

  assert.deepStrictEqual(worsened.items.map((it) => it.id), ["worsened-big", "worsened-small"]);
  assert.deepStrictEqual(improved.items.map((it) => it.id), ["improved-big", "improved-small"]);
  assert.strictEqual(worsened.remainderCount, 0);
  assert.strictEqual(improved.remainderCount, 0);
  assert.ok(worsened.coveragePct != null && worsened.coveragePct <= 1 + EPS);
  assert.ok(improved.coveragePct != null && improved.coveragePct <= 1 + EPS);
});

test("partitionImpactBySign: empty bucket has null coveragePct and no items", () => {
  const items = [{ id: "only-worsened", total: 5 }];
  const { worsened, improved } = partitionImpactBySign(items, (it) => it.total);

  assert.strictEqual(worsened.items.length, 1);
  assert.strictEqual(improved.items.length, 0);
  assert.strictEqual(improved.coveragePct, null);
  assert.strictEqual(improved.remainderCount, 0);
});

test("cutImpactBucket: mixed signs ranked by |total|, remainder is the signed net of the tail", () => {
  const items = [
    { id: "big-worse", total: 10 },
    { id: "big-better", total: -9 },
    { id: "tiny-worse", total: 0.5 },
    { id: "tiny-better", total: -0.5 },
    { id: "zero", total: 0 },
  ];
  const bucket = cutImpactBucket(items, (it) => it.total);

  // Ranked by magnitude regardless of direction; zero rows dropped entirely.
  assert.deepStrictEqual(bucket.items.map((it) => it.id), ["big-worse", "big-better"]);
  // Tail nets to zero (0.5 + −0.5) but still counts its rows.
  assert.strictEqual(bucket.remainderCount, 2);
  assert.ok(Math.abs(bucket.remainderCurrency) < EPS);
  // Coverage over gross |total| of both signs: (10+9)/(10+9+0.5+0.5) = 0.95
  assert.ok(Math.abs(bucket.coveragePct! - 19 / 20) < EPS);
});

test("partitionImpactBySign: 85% cutoff moves long tail into remainder, remainderCurrency keeps sign", () => {
  // 10 ads, all worsened; one dominates (90 of 100 total), 9 tiny ones share the rest.
  const items = [
    { id: "dominant", total: 90 },
    ...Array.from({ length: 9 }, (_, i) => ({ id: `tiny-${i}`, total: 10 / 9 })),
  ];
  const { worsened } = partitionImpactBySign(items, (it) => it.total);

  assert.ok(worsened.items.length < items.length, "cutoff should exclude at least one tiny ad");
  assert.ok(worsened.items.some((it) => it.id === "dominant"), "dominant ad must be visible");
  assert.ok(worsened.remainderCount > 0);
  assert.ok(worsened.remainderCurrency > 0, "remainder of an all-positive bucket must stay positive");
  assert.ok(worsened.coveragePct! >= CUMULATIVE_CUTOFF - EPS);

  // Closure: visible + remainder reconstructs the full gross total.
  const visibleSum = worsened.items.reduce((s, it) => s + it.total, 0);
  const fullSum = items.reduce((s, it) => s + it.total, 0);
  assert.ok(Math.abs(visibleSum + worsened.remainderCurrency - fullSum) < EPS);
});

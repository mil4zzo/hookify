// Pure math module: diagnostic decomposition for "what changed in this pack?"
// No React imports. No API imports. Only pure functions + types.
//
// Level 2: LMDI-I (Logarithmic Mean Divisia Index) — driver contributions sum EXACTLY to ΔCPR/ΔCPMQL
// Level 3: Symmetric shift-share — rate/mix split, ad contributions sum exactly to Δrate (driver)
//
// Key identity: CPR = (CPM/1000) / (website_ctr × connect_rate × page_conv)
// CPMQL = CPR / mql_rate,  where mql_rate = mqls/results

import { getResultsForActionType } from "./calculations";
import type { MetricQualityTone } from "@/lib/utils/metricQuality";
import { getMetricTrendTone } from "@/lib/utils/metricQuality";

// ─── Constants ───────────────────────────────────────────────────────────────

// Day-vs-previous-day comparison (future: user-selectable)
export const COMPARISON_WINDOW = 1;
// Cumulative cutoff for showing ads in Level 3 list
export const CUMULATIVE_CUTOFF = 0.85;
// Min volume guards — suppress conclusions below these thresholds
export const MIN_IMPRESSIONS = 500;
export const MIN_RESULTS = 3;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AdDaySnapshot {
  spend: number;
  impressions: number;
  inlineLinkClicks: number;
  lpv: number;
  results: number;
  mqls?: number | null;
}

export interface AdTwoDaySnapshot {
  adKey: string;
  adName?: string;
  prev: AdDaySnapshot;
  last: AdDaySnapshot;
}

export type DiagnosticTarget = "cpr" | "cpmql";

export type DriverKey = "cpm" | "website_ctr" | "connect_rate" | "page_conv" | "mql_rate";

export interface DriverContribution {
  driver: DriverKey;
  contributionCurrency: number | null;
  status: "ok" | "undefined" | "collapsed";
  ratePrev: number | null;
  rateLast: number | null;
}

export interface PackDecomposition {
  target: DiagnosticTarget;
  targetPrev: number | null;
  targetLast: number | null;
  deltaCurrency: number | null;
  drivers: DriverContribution[];
  residualCurrency: number;
  minVolumeOk: boolean;
}

export interface AdAttribution {
  adKey: string;
  adName?: string;
  contributionCurrency: number;
  // Exact split of contributionCurrency into its rate (ad's own metric moved) and
  // mix (ad's budget share moved) parts — rateCurrency + mixCurrency === contributionCurrency.
  rateCurrency: number;
  mixCurrency: number;
  spendSharePrev: number;
  spendShareLast: number;
  rateEffect: number;
  mixEffect: number;
  tag: "rate" | "mix";
  ratePrev: number | null;
  rateLast: number | null;
  // Ad's share of the DRIVER's own denominator (impressions for cpm/website_ctr, inline
  // clicks for connect_rate, lpv for page_conv, results for mql_rate) — the raw weight
  // shift-share splits into a "mix" effect. Distinct from spendShareLast (always spend-based).
  sharePrev: number;
  shareLast: number;
}

export interface DriverAttribution {
  driver: DriverKey;
  driverContributionCurrency: number | null;
  rankedAds: AdAttribution[];
  cutoffIndex: number;
  remainder: { count: number; contributionCurrency: number; spendShare: number } | null;
  // Gross sum of |contribution| across all same-sign ads (the ads pushing this
  // driver in the driver's net direction). Coverage % must divide by THIS, not by
  // the net driverContributionCurrency — otherwise offsetting ads inflate it past 100%.
  sameSignTotal: number;
  // Full unfiltered per-ad list (no cutoff, both signs) — for consumers that need to
  // partition by sign themselves rather than take the single-sign ranked+remainder view.
  allAds: AdAttribution[];
}

export interface BudgetShareData {
  axis: string[];
  bars: { adKey: string; adName?: string; shareByDay: number[] }[];
  otherByDay: number[];
}

export interface DiagnosticSummaryResult {
  headline: string;
  tone: MetricQualityTone;
  muted: boolean;
  mqlFallbackNote?: string;
}

// Per-day aggregated pack series — raw counts + recomputed rates (incl. CPM, which
// trendLines does NOT carry). Feeds the day-comparison block (Widget 1 line + Widget 2
// sparklines). Rates are null on days without a valid denominator.
export interface PackDayPoint {
  date: string;
  spend: number;
  impr: number;
  inline: number;
  lpv: number;
  results: number;
  mqls: number;
  cpm: number | null;
  website_ctr: number | null;
  connect_rate: number | null;
  page_conv: number | null;
  mql_rate: number | null;
  cpr: number | null;
  cpmql: number | null;
}

export type PackDaySeries = PackDayPoint[];

// Per-ad TOTAL impact on the target cost, summed across ALL drivers (rate worsening +
// mix/budget-share shift), in currency. Σ over ads ≈ deltaCurrency − residual.
export interface AdTotalImpact {
  adKey: string;
  adName?: string;
  totalContributionCurrency: number;
  ratePartCurrency: number;
  mixPartCurrency: number;
  spendSharePrev: number;
  spendShareLast: number;
  // Net contribution per driver (rate + mix of that driver) — Σ currencies equals
  // totalContributionCurrency. Ordered like decomposition.drivers; only "ok" drivers.
  driverParts: { driver: DriverKey; currency: number }[];
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

// Logarithmic mean: L(a,b) = (a-b)/(ln a - ln b); L(a,a) = a; L(≤0,_) = 0
export function logMean(a: number, b: number): number {
  if (a <= 0 || b <= 0 || !Number.isFinite(a) || !Number.isFinite(b)) return 0;
  if (Math.abs(a - b) < 1e-12) return a;
  return (a - b) / (Math.log(a) - Math.log(b));
}

// ─── Target selection ─────────────────────────────────────────────────────────

export function selectTarget(snaps: AdTwoDaySnapshot[], hasMqlData: boolean): DiagnosticTarget {
  if (!hasMqlData) return "cpr";
  let mqlsPrev = 0;
  let mqlsLast = 0;
  for (const s of snaps) {
    mqlsPrev += s.prev.mqls ?? 0;
    mqlsLast += s.last.mqls ?? 0;
  }
  return mqlsPrev > 0 && mqlsLast > 0 ? "cpmql" : "cpr";
}

// ─── Pack-level aggregation ───────────────────────────────────────────────────

interface PackCounts {
  spend: number;
  impressions: number;
  inline: number;
  lpv: number;
  results: number;
  mqls: number;
}

function sumCounts(snaps: AdTwoDaySnapshot[], day: "prev" | "last"): PackCounts {
  const acc: PackCounts = { spend: 0, impressions: 0, inline: 0, lpv: 0, results: 0, mqls: 0 };
  for (const s of snaps) {
    const d = s[day];
    acc.spend += d.spend;
    acc.impressions += d.impressions;
    acc.inline += d.inlineLinkClicks;
    acc.lpv += d.lpv;
    acc.results += d.results;
    acc.mqls += d.mqls ?? 0;
  }
  return acc;
}

interface PackRates {
  cpm: number | null;
  wctr: number | null;
  cr: number | null;
  pc: number | null;
  mqlr: number | null;
  cpr: number | null;
  cpmql: number | null;
}

function computePackRates(c: PackCounts): PackRates {
  return {
    cpm:   c.impressions > 0 ? (c.spend * 1000) / c.impressions : null,
    wctr:  c.impressions > 0 ? c.inline / c.impressions : null,
    cr:    c.inline > 0     ? c.lpv / c.inline : null,
    pc:    c.lpv > 0        ? c.results / c.lpv : null,
    mqlr:  c.results > 0    ? c.mqls / c.results : null,
    cpr:   c.results > 0    ? c.spend / c.results : null,
    cpmql: c.mqls > 0       ? c.spend / c.mqls : null,
  };
}

// ─── LMDI-I decomposition (Level 2) ──────────────────────────────────────────

export function decomposePack(
  snaps: AdTwoDaySnapshot[],
  opts: { target: DiagnosticTarget; minImpressions?: number; minResults?: number },
): PackDecomposition {
  const { target, minImpressions = MIN_IMPRESSIONS, minResults = MIN_RESULTS } = opts;

  const cPrev = sumCounts(snaps, "prev");
  const cLast = sumCounts(snaps, "last");
  const rPrev = computePackRates(cPrev);
  const rLast = computePackRates(cLast);

  const targetPrev = target === "cpmql" ? rPrev.cpmql : rPrev.cpr;
  const targetLast = target === "cpmql" ? rLast.cpmql : rLast.cpr;

  const minVolumeOk =
    cLast.impressions >= minImpressions &&
    cLast.results >= minResults &&
    cPrev.impressions >= minImpressions &&
    cPrev.results >= minResults;

  if (
    targetPrev == null || targetLast == null ||
    !Number.isFinite(targetPrev) || !Number.isFinite(targetLast)
  ) {
    return {
      target, targetPrev, targetLast,
      deltaCurrency: null,
      drivers: collapsedDrivers(target),
      residualCurrency: 0,
      minVolumeOk,
    };
  }

  const delta = targetLast - targetPrev;
  const lmdWeight = logMean(targetLast, targetPrev);

  // spec: sign = +1 for CPM (cost factor), -1 for funnel rates (better rate = lower cost)
  type DriverSpec = { driver: DriverKey; rp: number | null; rl: number | null; sign: number };
  const specs: DriverSpec[] = [
    { driver: "cpm",          rp: rPrev.cpm,   rl: rLast.cpm,   sign: 1  },
    { driver: "website_ctr",  rp: rPrev.wctr,  rl: rLast.wctr,  sign: -1 },
    { driver: "connect_rate", rp: rPrev.cr,    rl: rLast.cr,    sign: -1 },
    { driver: "page_conv",    rp: rPrev.pc,    rl: rLast.pc,    sign: -1 },
  ];
  if (target === "cpmql") {
    specs.push({ driver: "mql_rate", rp: rPrev.mqlr, rl: rLast.mqlr, sign: -1 });
  }

  const drivers: DriverContribution[] = [];
  let sumOk = 0;

  for (const { driver, rp, rl, sign } of specs) {
    const missing = rp == null || rl == null || rp <= 0 || rl <= 0 || !Number.isFinite(rp) || !Number.isFinite(rl);
    if (missing) {
      const status = rp == null && rl == null ? "collapsed" : "undefined";
      drivers.push({ driver, contributionCurrency: null, status, ratePrev: rp, rateLast: rl });
      continue;
    }
    const contrib = lmdWeight * sign * Math.log(rl / rp);
    drivers.push({ driver, contributionCurrency: contrib, status: "ok", ratePrev: rp, rateLast: rl });
    sumOk += contrib;
  }

  return {
    target, targetPrev, targetLast,
    deltaCurrency: delta,
    drivers,
    residualCurrency: delta - sumOk,
    minVolumeOk,
  };
}

function collapsedDrivers(target: DiagnosticTarget): DriverContribution[] {
  const keys: DriverKey[] = ["cpm", "website_ctr", "connect_rate", "page_conv"];
  if (target === "cpmql") keys.push("mql_rate");
  return keys.map((driver) => ({ driver, contributionCurrency: null, status: "collapsed" as const, ratePrev: null, rateLast: null }));
}

// ─── Per-ad rate helpers ──────────────────────────────────────────────────────

function getAdRate(snap: AdDaySnapshot, driver: DriverKey): number | null {
  switch (driver) {
    case "cpm":          return snap.impressions > 0 ? (snap.spend * 1000) / snap.impressions : null;
    case "website_ctr":  return snap.impressions > 0 ? snap.inlineLinkClicks / snap.impressions : null;
    case "connect_rate": return snap.inlineLinkClicks > 0 ? snap.lpv / snap.inlineLinkClicks : null;
    case "page_conv":    return snap.lpv > 0 ? snap.results / snap.lpv : null;
    case "mql_rate":     return (snap.results > 0 && snap.mqls != null) ? snap.mqls / snap.results : null;
  }
}

function getAdDenomCount(snap: AdDaySnapshot, driver: DriverKey): number {
  switch (driver) {
    case "cpm":
    case "website_ctr":  return snap.impressions;
    case "connect_rate": return snap.inlineLinkClicks;
    case "page_conv":    return snap.lpv;
    case "mql_rate":     return snap.results;
  }
}

// ─── Shift-share attribution (Level 3) ───────────────────────────────────────
//
// Decomposes Δrate_pack into per-ad RATE effects (the ad got worse at this stage)
// and MIX effects (the ad's share of stage volume shifted).
// Symmetric form: RATE_a = w̄·Δr, MIX_a = (r̄ − r̄_pack)·Δw — the mix term is CENTERED
// on the pack-average rate. Uncentered (r̄·Δw) misattributes per ad: any ad gaining
// share gets a cost-raising mix regardless of whether it's cheaper or pricier than the
// pack (a cheap ad gaining share actually LOWERS pack CPM). Centering fixes the per-ad
// story; the pack sum is unchanged because Σ_a Δw_a = 0, so Σ MIX is identical and the
// identity Σ(RATE+MIX) = Δrate_pack still holds EXACTLY.
// R$ allocation is proportional (approximate) but reconciles exactly at the driver level.
//
export function attributeDriverToAds(
  snaps: AdTwoDaySnapshot[],
  driver: DriverKey,
  driverContribCurrency: number | null,
  opts: { cumulativeCutoff?: number } = {},
): DriverAttribution {
  const cutoff = opts.cumulativeCutoff ?? CUMULATIVE_CUTOFF;

  // Pack-level denominator totals per day (for computing weights)
  const packDenomPrev = snaps.reduce((s, snap) => s + getAdDenomCount(snap.prev, driver), 0);
  const packDenomLast = snaps.reduce((s, snap) => s + getAdDenomCount(snap.last, driver), 0);

  // Pack-level rate change (used to allocate R$ proportionally)
  const packRatePrev = packDenomPrev > 0
    ? snaps.reduce((s, snap) => s + getAdDenomCount(snap.prev, driver) * (getAdRate(snap.prev, driver) ?? 0), 0) / packDenomPrev
    : null;
  const packRateLast = packDenomLast > 0
    ? snaps.reduce((s, snap) => s + getAdDenomCount(snap.last, driver) * (getAdRate(snap.last, driver) ?? 0), 0) / packDenomLast
    : null;
  const deltaRatePack = packRatePrev != null && packRateLast != null ? packRateLast - packRatePrev : null;

  // Reference level for the centered mix term (see header comment). When one day has
  // no volume the currency path is already short-circuited (deltaRatePack null), so the
  // fallback only affects the raw-effect tag.
  const packRateBar =
    packRatePrev != null && packRateLast != null
      ? (packRatePrev + packRateLast) / 2
      : (packRateLast ?? packRatePrev ?? 0);

  const totalSpendPrev = snaps.reduce((s, snap) => s + snap.prev.spend, 0);
  const totalSpendLast = snaps.reduce((s, snap) => s + snap.last.spend, 0);

  const attrs: AdAttribution[] = snaps.map((snap) => {
    const rp = getAdRate(snap.prev, driver);
    const rl = getAdRate(snap.last, driver);
    const dp = getAdDenomCount(snap.prev, driver);
    const dl = getAdDenomCount(snap.last, driver);

    const wp = packDenomPrev > 0 ? dp / packDenomPrev : 0;
    const wl = packDenomLast > 0 ? dl / packDenomLast : 0;
    const wBar = (wp + wl) / 2;

    const actualRp = rp ?? 0;
    const actualRl = rl ?? 0;
    const rBar = (actualRp + actualRl) / 2;

    const rateEffect = wBar * (actualRl - actualRp);
    // Centered: gaining share only raises the pack rate if this ad runs ABOVE the pack
    // average (and symmetrically, a below-average ad losing share also raises it).
    const mixEffect  = (rBar - packRateBar) * (wl - wp);

    // Distribute driver R$ proportionally to each ad's share of Δrate — split exactly
    // into rate/mix parts (rateCurrency + mixCurrency === contribCurrency) so consumers
    // can show "por desempenho" vs "por verba" without losing either alavanca.
    let rateCurrency = 0;
    let mixCurrency = 0;
    if (driverContribCurrency != null && deltaRatePack != null && Math.abs(deltaRatePack) > 1e-10) {
      rateCurrency = driverContribCurrency * (rateEffect / deltaRatePack);
      mixCurrency  = driverContribCurrency * (mixEffect / deltaRatePack);
    }
    const contribCurrency = rateCurrency + mixCurrency;

    const spendSharePrev = totalSpendPrev > 0 ? snap.prev.spend / totalSpendPrev : 0;
    const spendShareLast = totalSpendLast > 0 ? snap.last.spend / totalSpendLast : 0;
    const tag: "rate" | "mix" = Math.abs(rateEffect) >= Math.abs(mixEffect) ? "rate" : "mix";

    return {
      adKey: snap.adKey,
      adName: snap.adName,
      contributionCurrency: contribCurrency,
      rateCurrency,
      mixCurrency,
      spendSharePrev,
      spendShareLast,
      rateEffect,
      mixEffect,
      tag,
      ratePrev: rp,
      rateLast: rl,
      sharePrev: wp,
      shareLast: wl,
    };
  });

  // Rank same-sign contributions (those that worsen the target)
  const driverSign = driverContribCurrency != null ? Math.sign(driverContribCurrency) || 1 : 1;
  const sameSign = attrs
    .filter((a) => a.contributionCurrency !== 0 && Math.sign(a.contributionCurrency) === driverSign)
    .sort((a, b) => Math.abs(b.contributionCurrency) - Math.abs(a.contributionCurrency));
  const offsetting = attrs.filter((a) => a.contributionCurrency !== 0 && Math.sign(a.contributionCurrency) !== driverSign);
  const neutral = attrs.filter((a) => a.contributionCurrency === 0);

  // Cumulative 85% cutoff
  const sameSignTotal = sameSign.reduce((s, a) => s + Math.abs(a.contributionCurrency), 0);
  let cumulative = 0;
  let cutoffIndex = sameSign.length;
  for (let i = 0; i < sameSign.length; i++) {
    cumulative += Math.abs(sameSign[i].contributionCurrency);
    if (sameSignTotal > 0 && cumulative / sameSignTotal >= cutoff) {
      cutoffIndex = i + 1;
      break;
    }
  }

  const visibleAds = sameSign.slice(0, cutoffIndex);
  const remainderAds = [...sameSign.slice(cutoffIndex), ...offsetting, ...neutral];

  const remainder =
    remainderAds.length > 0
      ? {
          count: remainderAds.length,
          contributionCurrency: remainderAds.reduce((s, a) => s + a.contributionCurrency, 0),
          spendShare: remainderAds.reduce((s, a) => s + a.spendShareLast, 0),
        }
      : null;

  return {
    driver,
    driverContributionCurrency: driverContribCurrency,
    rankedAds: visibleAds,
    cutoffIndex,
    remainder,
    sameSignTotal,
    allAds: attrs,
  };
}

// ─── Cross-driver per-ad attribution (Widget 3 — top impact list) ────────────
//
// attributeDriverToAds is per-driver and collapses the tail into `remainder`, so it
// can't give a precise per-ad TOTAL. Here we run the same symmetric shift-share for
// every "ok" driver and accumulate per ad, keeping rate vs mix split, WITHOUT cutoff.
// Σ_a totalEffect_a,k = Δrate_pack_k exactly, so Σ_a total_a = Σ_k C_k = Δtarget − residual.
export function attributeAllDriversToAds(
  snaps: AdTwoDaySnapshot[],
  decomposition: PackDecomposition,
): AdTotalImpact[] {
  const totalSpendPrev = snaps.reduce((s, snap) => s + snap.prev.spend, 0);
  const totalSpendLast = snaps.reduce((s, snap) => s + snap.last.spend, 0);

  const acc = new Map<string, { adName?: string; rate: number; mix: number; perDriver: Map<DriverKey, number> }>();
  for (const snap of snaps) acc.set(snap.adKey, { adName: snap.adName, rate: 0, mix: 0, perDriver: new Map() });

  for (const d of decomposition.drivers) {
    if (d.status !== "ok" || d.contributionCurrency == null) continue;
    const driver = d.driver;
    const C_k = d.contributionCurrency;

    const packDenomPrev = snaps.reduce((s, snap) => s + getAdDenomCount(snap.prev, driver), 0);
    const packDenomLast = snaps.reduce((s, snap) => s + getAdDenomCount(snap.last, driver), 0);
    const packRatePrev = packDenomPrev > 0
      ? snaps.reduce((s, snap) => s + getAdDenomCount(snap.prev, driver) * (getAdRate(snap.prev, driver) ?? 0), 0) / packDenomPrev
      : null;
    const packRateLast = packDenomLast > 0
      ? snaps.reduce((s, snap) => s + getAdDenomCount(snap.last, driver) * (getAdRate(snap.last, driver) ?? 0), 0) / packDenomLast
      : null;
    const deltaRatePack = packRatePrev != null && packRateLast != null ? packRateLast - packRatePrev : null;
    if (deltaRatePack == null || Math.abs(deltaRatePack) <= 1e-10) continue;

    // Same centered mix as attributeDriverToAds (see its header comment) — keeps the
    // per-driver and cross-driver views telling the same per-ad story.
    const packRateBar = (packRatePrev! + packRateLast!) / 2;

    for (const snap of snaps) {
      const rp = getAdRate(snap.prev, driver) ?? 0;
      const rl = getAdRate(snap.last, driver) ?? 0;
      const dp = getAdDenomCount(snap.prev, driver);
      const dl = getAdDenomCount(snap.last, driver);
      const wp = packDenomPrev > 0 ? dp / packDenomPrev : 0;
      const wl = packDenomLast > 0 ? dl / packDenomLast : 0;
      const wBar = (wp + wl) / 2;
      const rBar = (rp + rl) / 2;
      const rateEffect = wBar * (rl - rp);
      const mixEffect  = (rBar - packRateBar) * (wl - wp);
      const entry = acc.get(snap.adKey)!;
      const rateCur = C_k * (rateEffect / deltaRatePack);
      const mixCur  = C_k * (mixEffect / deltaRatePack);
      entry.rate += rateCur;
      entry.mix  += mixCur;
      entry.perDriver.set(driver, (entry.perDriver.get(driver) ?? 0) + rateCur + mixCur);
    }
  }

  const out: AdTotalImpact[] = snaps.map((snap) => {
    const e = acc.get(snap.adKey)!;
    return {
      adKey: snap.adKey,
      adName: e.adName,
      totalContributionCurrency: e.rate + e.mix,
      ratePartCurrency: e.rate,
      mixPartCurrency: e.mix,
      spendSharePrev: totalSpendPrev > 0 ? snap.prev.spend / totalSpendPrev : 0,
      spendShareLast: totalSpendLast > 0 ? snap.last.spend / totalSpendLast : 0,
      driverParts: decomposition.drivers
        .filter((d) => e.perDriver.has(d.driver))
        .map((d) => ({ driver: d.driver, currency: e.perDriver.get(d.driver)! })),
    };
  });

  out.sort((a, b) => Math.abs(b.totalContributionCurrency) - Math.abs(a.totalContributionCurrency));
  return out;
}

// ─── Sign partition (day-comparison "melhoraram / pioraram" tables) ──────────
//
// Splits a list of per-ad impacts (per-driver AdAttribution.allAds, or cross-driver
// AdTotalImpact[]) into two independently-cut buckets by the sign of their total: ads
// that WORSENED the cost (total > 0) vs ads that IMPROVED it (total < 0). Each bucket
// gets its own 85% cumulative-cutoff + remainder — a bucket's coverage never mixes with
// the opposite sign's, so "these N ads explain ~X% of what worsened" is always exact.
export interface ImpactBucket<T> {
  items: T[];
  remainderCount: number;
  remainderCurrency: number;
  // Share of this bucket's gross |total| explained by `items`. null when the bucket is empty.
  coveragePct: number | null;
}

const IMPACT_SIGN_EPSILON = 1e-9;

// Sorts by |total| desc and applies the cumulative cutoff. Works on any sign mix:
// per-sign buckets (partitionImpactBySign) or a single "top movers" list (mixed signs,
// ranked by magnitude regardless of direction). remainderCurrency is the SIGNED sum of
// the tail — in a mixed list it may net toward zero while still containing churn.
export function cutImpactBucket<T>(
  items: T[],
  getTotal: (item: T) => number,
  cutoff: number = CUMULATIVE_CUTOFF,
): ImpactBucket<T> {
  const sorted = [...items]
    .filter((it) => Math.abs(getTotal(it)) > IMPACT_SIGN_EPSILON)
    .sort((a, b) => Math.abs(getTotal(b)) - Math.abs(getTotal(a)));

  const grossTotal = sorted.reduce((s, it) => s + Math.abs(getTotal(it)), 0);
  let cumulative = 0;
  let cutoffIndex = sorted.length;
  for (let i = 0; i < sorted.length; i++) {
    cumulative += Math.abs(getTotal(sorted[i]));
    if (grossTotal > 0 && cumulative / grossTotal >= cutoff) {
      cutoffIndex = i + 1;
      break;
    }
  }
  const visible = sorted.slice(0, cutoffIndex);
  const remainderItems = sorted.slice(cutoffIndex);
  const visibleAbsTotal = visible.reduce((s, it) => s + Math.abs(getTotal(it)), 0);
  return {
    items: visible,
    remainderCount: remainderItems.length,
    remainderCurrency: remainderItems.reduce((s, it) => s + getTotal(it), 0),
    coveragePct: grossTotal > 0 ? visibleAbsTotal / grossTotal : null,
  };
}

export function partitionImpactBySign<T>(
  items: T[],
  getTotal: (item: T) => number,
  cutoff: number = CUMULATIVE_CUTOFF,
): { worsened: ImpactBucket<T>; improved: ImpactBucket<T> } {
  const worsenedItems = items.filter((it) => getTotal(it) > IMPACT_SIGN_EPSILON);
  const improvedItems = items.filter((it) => getTotal(it) < -IMPACT_SIGN_EPSILON);
  return {
    worsened: cutImpactBucket(worsenedItems, getTotal, cutoff),
    improved: cutImpactBucket(improvedItems, getTotal, cutoff),
  };
}

// ─── Per-day pack series (Widget 1 line + Widget 2 sparklines) ───────────────
// Same aggregation rule as decomposePack: sum raw counts, then recompute rates.
// Mirrors the inline packByDay in usePackDiagnostic but adds CPM and the cost metrics.

export function buildPackDaySeries(
  seriesByGroup: Record<
    string,
    {
      axis: string[];
      spend: (number | null)[];
      impressions: (number | null)[];
      inline_link_clicks?: (number | null)[];
      lpv: (number | null)[];
      conversions: Record<string, number>[];
      cpmql?: (number | null)[];
    }
  >,
  actionType: string,
): PackDaySeries {
  const adKeys = Object.keys(seriesByGroup);
  if (adKeys.length === 0) return [];

  const axis = seriesByGroup[adKeys[0]].axis;
  const numDays = axis.length;

  return Array.from({ length: numDays }, (_, i) => {
    let spend = 0, impr = 0, inline = 0, lpv = 0, results = 0, mqls = 0;
    for (const k of adKeys) {
      const s = seriesByGroup[k];
      spend  += s.spend[i] ?? 0;
      impr   += s.impressions[i] ?? 0;
      inline += s.inline_link_clicks?.[i] ?? 0;
      lpv    += s.lpv[i] ?? 0;
      results += getResultsForActionType({ conversions: s.conversions?.[i] ?? {} }, actionType) ?? 0;
      const cpmqlVal = s.cpmql?.[i];
      const sp = s.spend[i] ?? 0;
      if (cpmqlVal != null && cpmqlVal > 0 && sp > 0) mqls += sp / cpmqlVal;
    }
    return {
      date: axis[i],
      spend, impr, inline, lpv, results, mqls,
      cpm:          impr > 0 ? (spend * 1000) / impr : null,
      website_ctr:  impr > 0 ? inline / impr : null,
      connect_rate: inline > 0 ? lpv / inline : null,
      page_conv:    lpv > 0 ? results / lpv : null,
      mql_rate:     results > 0 ? mqls / results : null,
      cpr:          results > 0 ? spend / results : null,
      cpmql:        mqls > 0 ? spend / mqls : null,
    };
  });
}

// Read a single driver's per-day value out of a PackDayPoint (for sparklines).
export function packDayDriverValue(p: PackDayPoint, driver: DriverKey): number | null {
  switch (driver) {
    case "cpm":          return p.cpm;
    case "website_ctr":  return p.website_ctr;
    case "connect_rate": return p.connect_rate;
    case "page_conv":    return p.page_conv;
    case "mql_rate":     return p.mql_rate;
  }
}

// ─── Budget share series (for stacked bars, Level 1) ─────────────────────────

export function buildBudgetShareSeries(
  seriesByGroup: Record<string, { axis: string[]; spend: (number | null)[] }>,
  topN: number = 3,
): BudgetShareData {
  const adKeys = Object.keys(seriesByGroup);
  if (adKeys.length === 0) return { axis: [], bars: [], otherByDay: [] };

  const axis = seriesByGroup[adKeys[0]].axis;
  const numDays = axis.length;

  const totalSpendByDay = Array.from({ length: numDays }, (_, i) =>
    adKeys.reduce((sum, k) => sum + (seriesByGroup[k].spend[i] ?? 0), 0),
  );

  // Rank by spend on last available day
  const ranked = adKeys
    .map((k) => {
      const arr = seriesByGroup[k].spend;
      const last = [...arr].reverse().find((v) => v != null) ?? 0;
      return { k, last };
    })
    .sort((a, b) => b.last - a.last);

  const topAds = ranked.slice(0, topN);

  const bars = topAds.map(({ k }) => ({
    adKey: k,
    shareByDay: Array.from({ length: numDays }, (_, i) => {
      const total = totalSpendByDay[i];
      return total > 0 ? (seriesByGroup[k].spend[i] ?? 0) / total : 0;
    }),
  }));

  const otherByDay = Array.from({ length: numDays }, (_, i) => {
    const total = totalSpendByDay[i];
    if (total <= 0) return 0;
    const topSum = topAds.reduce((s, { k }) => s + (seriesByGroup[k].spend[i] ?? 0), 0);
    return Math.max(0, (total - topSum) / total);
  });

  return { axis, bars, otherByDay };
}

// ─── Diagnostic summary sentence ──────────────────────────────────────────────

export function buildDiagnosticSummary(
  dec: PackDecomposition,
  topDriverAttr: DriverAttribution | null,
  formatCurrency: (v: number) => string,
): DiagnosticSummaryResult {
  if (!dec.minVolumeOk) {
    return { headline: "Volume baixo nos últimos dias — sem conclusão confiável.", tone: "muted-foreground", muted: true };
  }
  if (dec.deltaCurrency == null || dec.targetPrev == null || dec.targetLast == null) {
    return { headline: "Dados insuficientes para análise.", tone: "muted-foreground", muted: true };
  }

  const { deltaCurrency, targetPrev, target } = dec;
  const pct = targetPrev > 0 ? deltaCurrency / targetPrev : 0;
  const targetLabel = target === "cpmql" ? "CPMQL" : "CPR";
  const tone = getMetricTrendTone(pct, true);

  if (Math.abs(pct) < 0.01) {
    // CPR/CPMQL flat — but the funnel underneath may have shifted (one stage worsened
    // while another improved, netting ~zero). Surface that instead of "nothing changed".
    const okDriversStable = dec.drivers.filter(
      (d) => d.status === "ok" && d.contributionCurrency != null,
    );
    const worsened = [...okDriversStable]
      .filter((d) => d.contributionCurrency! > 0)
      .sort((a, b) => b.contributionCurrency! - a.contributionCurrency!)[0];
    const improved = [...okDriversStable]
      .filter((d) => d.contributionCurrency! < 0)
      .sort((a, b) => a.contributionCurrency! - b.contributionCurrency!)[0];
    const SHIFT_THRESHOLD = targetPrev * 0.03; // ≥3% of CPR moved on a single stage
    if (
      worsened && improved &&
      Math.abs(worsened.contributionCurrency!) >= SHIFT_THRESHOLD
    ) {
      return {
        headline: `${targetLabel} estável (${formatCurrency(dec.targetLast)}), mas o funil mudou: ${DRIVER_LABELS[worsened.driver]} piorou e ${DRIVER_LABELS[improved.driver]} compensou.`,
        tone: "warning",
        muted: false,
      };
    }
    return {
      headline: `Estável: ${targetLabel} praticamente sem mudança (${formatCurrency(dec.targetLast)}).`,
      tone: "accent",
      muted: false,
    };
  }

  const direction = deltaCurrency > 0 ? "subiu" : "caiu";
  const pctStr = `${Math.abs(pct * 100).toFixed(0)}%`;
  const absDelta = Math.abs(deltaCurrency);

  const okDrivers = dec.drivers.filter((d) => d.status === "ok" && d.contributionCurrency != null);
  if (okDrivers.length === 0) {
    return {
      headline: `${targetLabel} ${direction} ${formatCurrency(absDelta)} (${pctStr}) — causa não identificável.`,
      tone,
      muted: false,
    };
  }

  const dominant = okDrivers
    .filter((d) => Math.sign(d.contributionCurrency!) === Math.sign(deltaCurrency))
    .sort((a, b) => Math.abs(b.contributionCurrency!) - Math.abs(a.contributionCurrency!))[0];

  if (!dominant) {
    return { headline: `${targetLabel} ${direction} ${formatCurrency(absDelta)} (${pctStr}).`, tone, muted: false };
  }

  const driverLabel = DRIVER_LABELS[dominant.driver];
  const ratePrev = dominant.ratePrev;
  const rateLast = dominant.rateLast;
  const driverPctStr =
    ratePrev != null && ratePrev > 0 && rateLast != null
      ? ` (${Math.abs(((rateLast - ratePrev) / ratePrev) * 100).toFixed(0)}%)`
      : "";

  let adPart = "";
  if (topDriverAttr?.rankedAds[0]) {
    const topAd = topDriverAttr.rankedAds[0];
    const label = topAd.adName || topAd.adKey;
    const contribPct =
      dominant.contributionCurrency && Math.abs(dominant.contributionCurrency) > 0
        ? (Math.abs(topAd.contributionCurrency) / Math.abs(dominant.contributionCurrency)) * 100
        : null;
    adPart = contribPct != null
      ? `; "${label}" respondeu por ~${contribPct.toFixed(0)}% dessa variação`
      : `; "${label}" foi o principal ad envolvido`;
  }

  return {
    headline: `${targetLabel} ${direction} ${formatCurrency(absDelta)} (${pctStr}), puxado pelo(a) ${driverLabel}${driverPctStr}${adPart}.`,
    tone,
    muted: false,
  };
}

// ─── Adapter: RankingsSeriesResponse → AdTwoDaySnapshot[] ────────────────────
// This is the ONLY place that knows the API series shape.
// Reads the last 2 axis entries (COMPARISON_WINDOW=1 → compare [n-2] vs [n-1]).

export function buildAdTwoDaySnapshots(
  seriesByGroup: Record<
    string,
    {
      axis: string[];
      spend: (number | null)[];
      impressions: (number | null)[];
      inline_link_clicks?: (number | null)[];
      lpv: (number | null)[];
      conversions: Record<string, number>[];
      cpmql?: (number | null)[];
    }
  >,
  actionType: string,
  adKeyToName?: Map<string, string>,
): AdTwoDaySnapshot[] {
  const result: AdTwoDaySnapshot[] = [];

  for (const [adKey, series] of Object.entries(seriesByGroup)) {
    const n = series.axis.length;
    if (n < 2) continue;

    const li = n - 1; // last day index
    const pi = n - 2; // previous day index

    result.push({
      adKey,
      adName: adKeyToName?.get(adKey),
      prev: daySnapshot(series, pi, actionType),
      last: daySnapshot(series, li, actionType),
    });
  }

  return result;
}

function daySnapshot(
  series: {
    spend: (number | null)[];
    impressions: (number | null)[];
    inline_link_clicks?: (number | null)[];
    lpv: (number | null)[];
    conversions: Record<string, number>[];
    cpmql?: (number | null)[];
  },
  idx: number,
  actionType: string,
): AdDaySnapshot {
  const convRecord = series.conversions[idx] ?? {};
  const results = getResultsForActionType({ conversions: convRecord }, actionType) ?? 0;

  // Derive mqls from cpmql: mqls = spend / cpmql (since CPMQL = spend/mqls)
  let mqls: number | null = null;
  const cpmqlVal = series.cpmql?.[idx];
  const spendVal = series.spend[idx] ?? 0;
  if (cpmqlVal != null && cpmqlVal > 0 && spendVal > 0) {
    mqls = spendVal / cpmqlVal;
  }

  return {
    spend: spendVal,
    impressions: series.impressions[idx] ?? 0,
    inlineLinkClicks: series.inline_link_clicks?.[idx] ?? 0,
    lpv: series.lpv[idx] ?? 0,
    results,
    mqls,
  };
}

// ─── Labels ───────────────────────────────────────────────────────────────────

export const DRIVER_LABELS: Record<DriverKey, string> = {
  cpm:          "CPM",
  website_ctr:  "Link CTR",
  connect_rate: "Connect Rate",
  page_conv:    "Conv. de Página",
  mql_rate:     "Taxa MQL",
};

export function getDriverLabel(driver: DriverKey): string {
  return DRIVER_LABELS[driver] ?? driver;
}

"use client";

import { useMemo } from "react";
import {
  buildPackDaySeries,
  packDayDriverValue,
  attributeAllDriversToAds,
  attributeDriverToAds,
  cutImpactBucket,
  getDriverLabel,
  MIN_RESULTS,
  type DiagnosticTarget,
  type DriverKey,
} from "@/lib/metrics/diagnostics";
import { getMetricTrendTone } from "@/lib/utils/metricQuality";
import type { MetricQualityTone } from "@/lib/utils/metricQuality";
import type { RankingsItem } from "@/lib/api/schemas";
import type { UsePackDiagnosticResult } from "@/lib/hooks/usePackDiagnostic";

// Last 7 days for the line + sparklines (the comparison itself is last-vs-prev day).
const DISPLAY_WINDOW = 7;

// A day-over-day swing at or above this is flagged as a possibly-unfair comparison
// (delivery changed too much for "melhorou/piorou" to read as apples-to-apples).
const FAIRNESS_SWING_THRESHOLD = 0.25;

export interface DayComparisonBigMetric {
  target: DiagnosticTarget;
  label: string; // "CPR" | "CPMQL"
  current: number | null;
  prev: number | null;
  deltaPct: number | null; // (last - prev) / prev — today vs yesterday
  deltaPct7d: number | null; // last window value vs first window value — slow-cook signal
  tone: MetricQualityTone;
  tone7d: MetricQualityTone;
  series7d: { date: string; value: number | null }[];
  // Daily spend over the same window — rendered as a muted "shadow" layer under the
  // cost line (volume-pane style) so cost swings can be read against delivery size.
  spendSeries7d: { date: string; value: number | null }[];
  lastTwoDates: [string, string] | null; // [prevDate, lastDate]
}

// Alert (not a verdict) that today's delivery moved too much for the day-over-day
// comparison to be read at face value — spend/results swung hard, or results are thin.
export interface DayComparisonFairness {
  changed: boolean;
  spendDeltaPct: number | null;
  resultsDeltaPct: number | null;
}

export interface DayComparisonImpactAd {
  adKey: string;
  adName: string;
  ad: RankingsItem | null;
  total: number;
  // "por desempenho" — the ad's own rate at this stage moved (actionable: criativo/página)
  desempenhoCurrency: number;
  // "por verba" — the ad's share of stage volume moved (actionable: orçamento)
  verbaCurrency: number;
  // Both levers pulled in opposite directions — total's sign alone would hide the other.
  opposingLevers: boolean;
  // Metric delta: relative % for cpm and for the cross-driver ad cost (currency-scale),
  // percentage-points for the 4 funnel rates (relative % of a near-zero proportion
  // baseline reads as absurd, e.g. "+7000%"). Tone for the Spend/Métrica cells always
  // comes from verbaCurrency/desempenhoCurrency's sign — with the CENTERED mix this
  // encodes "share moved toward/away from a worse-than-average ad", so caret (raw
  // direction) and color (cost impact) legitimately diverge, e.g. spend ↑ on a cheap
  // ad = up-caret + green. Never re-derive the tone from the raw delta.
  metricDeltaPct: number | null;
  // Spend share (0–1 of pack spend) — the familiar "verba" quantity, shown in BOTH
  // modes. Delta is always percentage-points. NOTE: display-only; the mix math runs on
  // the driver's own denominator share internally.
  spendSharePrev: number | null;
  spendShareLast: number | null;
  spendShareDeltaPp: number | null;
  // Metric absolutes. Driver mode: the driver's rate; cross-driver "Resultado" mode:
  // the ad's own target cost (CPR/CPMQL). metricLast doubles as the level value,
  // colored against the pack's value today.
  metricPrev: number | null;
  metricLast: number | null;
  // R$ composition of `total`, for the diverging composition bar. Cross-driver mode:
  // one part per "ok" driver (Σ = total). Driver mode: the two levers (verba +
  // desempenho, Σ = total). Signed — negative lowered the pack cost.
  parts: { key: string; label: string; currency: number }[];
}

export interface DayComparisonImpactBucket {
  items: DayComparisonImpactAd[];
  remainderCount: number;
  remainderCurrency: number;
  coveragePct: number | null;
}

// Q3 view: "quais anúncios mexeram no [métrica]" for the currently selected filter.
// driver=null → cross-driver "Resultado" (attributeAllDriversToAds). driver set →
// attributeDriverToAds(driver), the per-metric drill-down. Single "top movers" list
// ranked by |total| (both directions mixed) — direction is carried by each row's
// signed/colored Impacto. packMetricToday is the pack-level value of the selected
// metric TODAY (driver rate, or CPR/CPMQL for Resultado) — the reference the level
// column colors against ("este anúncio segue acima/abaixo da média").
export interface DayComparisonImpactView {
  driver: DriverKey | null;
  label: string;
  movers: DayComparisonImpactBucket;
  packMetricToday: number | null;
}

export interface DayComparisonDriverCard {
  key: DriverKey;
  label: string;
  isCurrency: boolean; // cpm → currency, rates → percent
  current: number | null;
  prev: number | null;
  // Raw signed delta: relative fraction when isCurrency (cpm), percentage-POINTS
  // (rateLast-ratePrev) otherwise — relative % of a proportion near-zero baseline
  // blows up (0.1%→7% reads as "+7000%"); pp doesn't. Format via MetricDeltaBadge.
  deltaPct: number | null;
  contributionCurrency: number | null;
  tone: MetricQualityTone; // by SIGN of contribution (impact on cost)
  series7d: { date: string; value: number | null }[];
}

export interface DayComparisonTopAdMetrics {
  cpm: number | null;
  website_ctr: number | null;
  connect_rate: number | null;
  page_conv: number | null;
  cpr: number | null;
  cpmql: number | null;
}

export interface DayComparisonTopAd {
  adKey: string;
  adName: string;
  ad: RankingsItem | null;
  totalContributionCurrency: number;
  spendShareLast: number;
  // "verba realocada" (not "ganhou verba"): with the centered mix, a mix-dominated
  // cost increase can come from LOSING share on a cheap ad, not only from gaining it.
  tag: "piorou" | "verba realocada" | "melhorou";
  tone: MetricQualityTone;
  lastMetrics: DayComparisonTopAdMetrics;
}

export interface UsePackDayComparisonResult {
  ready: boolean;
  hasComparison: boolean;
  minVolumeOk: boolean;
  bigMetric: DayComparisonBigMetric | null;
  fairness: DayComparisonFairness;
  driverCards: DayComparisonDriverCard[];
  topAds: DayComparisonTopAd[];
  impactView: DayComparisonImpactView | null;
}

// Tone by impact on the cost result: contribution < 0 lowered cost (good → success),
// > 0 raised cost (bad → destructive), ~0 neutral. Single source for delta/sparkline/card.
function contribTone(c: number | null): MetricQualityTone {
  if (c == null || Math.abs(c) < 1e-9) return "muted-foreground";
  return c > 0 ? "destructive" : "success";
}

function adTag(
  total: number,
  ratePart: number,
  mixPart: number,
): "piorou" | "verba realocada" | "melhorou" {
  if (total < 0) return "melhorou";
  return Math.abs(ratePart) >= Math.abs(mixPart) ? "piorou" : "verba realocada";
}

export function usePackDayComparison(
  diagnostic: UsePackDiagnosticResult,
  actionType: string,
  selectedDriver: DriverKey | null = null,
): UsePackDayComparisonResult {
  const { seriesData, snaps, decomposition, target, adMap, minVolumeOk } = diagnostic;

  // Per-day pack series (all days), then sliced to the last DISPLAY_WINDOW for the UI.
  const daySeries = useMemo(() => {
    const groups = seriesData?.series_by_group;
    if (!groups) return [];
    return buildPackDaySeries(groups, actionType);
  }, [seriesData, actionType]);

  const window = useMemo(
    () => daySeries.slice(Math.max(0, daySeries.length - DISPLAY_WINDOW)),
    [daySeries],
  );

  const bigMetric = useMemo((): DayComparisonBigMetric | null => {
    if (!decomposition) return null;
    const field = target === "cpmql" ? "cpmql" : "cpr";
    const series7d = window.map((p) => ({ date: p.date, value: p[field] }));
    const spendSeries7d = window.map((p) => ({ date: p.date, value: p.spend }));
    const lastTwoDates: [string, string] | null =
      window.length >= 2
        ? [window[window.length - 2].date, window[window.length - 1].date]
        : null;
    const deltaPct =
      decomposition.targetPrev && decomposition.targetPrev > 0 && decomposition.deltaCurrency != null
        ? decomposition.deltaCurrency / decomposition.targetPrev
        : null;

    // Net movement across the whole display window (first valid value → last valid value).
    // Catches the "slow cook" a 1-day delta hides: small daily moves in the same direction
    // that compound into a large net change no single day looked alarming enough to flag.
    const windowValues = series7d.map((p) => p.value).filter((v): v is number => v != null);
    const deltaPct7d =
      windowValues.length >= 2 && windowValues[0] > 0
        ? (windowValues[windowValues.length - 1] - windowValues[0]) / windowValues[0]
        : null;

    return {
      target,
      label: target === "cpmql" ? "CPMQL" : "CPR",
      current: decomposition.targetLast,
      prev: decomposition.targetPrev,
      deltaPct,
      deltaPct7d,
      tone: deltaPct != null ? getMetricTrendTone(deltaPct, true) : "muted-foreground",
      tone7d: deltaPct7d != null ? getMetricTrendTone(deltaPct7d, true) : "muted-foreground",
      series7d,
      spendSeries7d,
      lastTwoDates,
    };
  }, [decomposition, target, window]);

  // Alert (not a verdict): flags when today's delivery swung too hard for the
  // day-over-day comparison to be read at face value. Fires on large spend/results
  // swings or thin results — never on the cost metric itself.
  const fairness = useMemo((): DayComparisonFairness => {
    if (window.length < 2) return { changed: false, spendDeltaPct: null, resultsDeltaPct: null };
    const prev = window[window.length - 2];
    const last = window[window.length - 1];
    const spendDeltaPct = prev.spend > 0 ? (last.spend - prev.spend) / prev.spend : null;
    const resultsDeltaPct = prev.results > 0 ? (last.results - prev.results) / prev.results : null;
    const thinResults = last.results < MIN_RESULTS || prev.results < MIN_RESULTS;
    const changed =
      thinResults ||
      (spendDeltaPct != null && Math.abs(spendDeltaPct) >= FAIRNESS_SWING_THRESHOLD) ||
      (resultsDeltaPct != null && Math.abs(resultsDeltaPct) >= FAIRNESS_SWING_THRESHOLD);
    return { changed, spendDeltaPct, resultsDeltaPct };
  }, [window]);

  const driverCards = useMemo((): DayComparisonDriverCard[] => {
    if (!decomposition) return [];
    return decomposition.drivers.map((d) => {
      const isCurrency = d.driver === "cpm";
      // CPM is a currency-scale rate (unbounded) → relative % is the right frame.
      // The 4 funnel rates are proportions (0–1) → relative % of a near-zero base can
      // explode (e.g. 0.1%→7% reads as "+7000%"); percentage-points (simple diff) don't.
      const deltaPct =
        d.ratePrev == null || d.rateLast == null
          ? null
          : isCurrency
            ? (d.ratePrev > 0 ? (d.rateLast - d.ratePrev) / d.ratePrev : null)
            : d.rateLast - d.ratePrev;
      return {
        key: d.driver,
        label: getDriverLabel(d.driver),
        isCurrency,
        current: d.rateLast,
        prev: d.ratePrev,
        deltaPct,
        contributionCurrency: d.contributionCurrency,
        tone: contribTone(d.contributionCurrency),
        series7d: window.map((p) => ({ date: p.date, value: packDayDriverValue(p, d.driver) })),
      };
    });
  }, [decomposition, window]);

  const topAds = useMemo((): DayComparisonTopAd[] => {
    if (!decomposition || snaps.length === 0) return [];
    const impacts = attributeAllDriversToAds(snaps, decomposition);
    const snapByAdKey = new Map(snaps.map((s) => [s.adKey, s]));
    return impacts.slice(0, 10).map((it) => {
      const ad = adMap.get(it.adKey) ?? null;
      const tag = adTag(it.totalContributionCurrency, it.ratePartCurrency, it.mixPartCurrency);
      const snap = snapByAdKey.get(it.adKey);
      const last = snap?.last;
      const lastMetrics: DayComparisonTopAdMetrics = {
        cpm:          last && last.impressions > 0        ? (last.spend * 1000) / last.impressions  : null,
        website_ctr:  last && last.impressions > 0        ? last.inlineLinkClicks / last.impressions : null,
        connect_rate: last && last.inlineLinkClicks > 0   ? last.lpv / last.inlineLinkClicks         : null,
        page_conv:    last && last.lpv > 0                ? last.results / last.lpv                  : null,
        cpr:          last && last.results > 0            ? last.spend / last.results                : null,
        cpmql:        last && (last.mqls ?? 0) > 0        ? last.spend / (last.mqls ?? 0)            : null,
      };
      return {
        adKey: it.adKey,
        adName: it.adName ?? ad?.ad_name ?? it.adKey,
        ad,
        totalContributionCurrency: it.totalContributionCurrency,
        spendShareLast: it.spendShareLast,
        tag,
        tone: contribTone(it.totalContributionCurrency),
        lastMetrics,
      };
    });
  }, [decomposition, snaps, adMap]);

  // Q3 drill-down: "quais anúncios moveram [métrica]" for the selected filter.
  // driver=null → cross-driver "Resultado" (attributeAllDriversToAds, already the full
  // unfiltered list). driver set → attributeDriverToAds(driver).allAds — the same
  // shift-share math PackDiagnosticPanel already uses, just not cut to one sign.
  // Opção A: never collapses to the dominant lever — every ad carries BOTH its
  // "por desempenho" (rate) and "por verba" (mix) parts; membership is by the net total.
  const impactView = useMemo((): DayComparisonImpactView | null => {
    if (!decomposition || snaps.length === 0) return null;

    const resolveAd = (adKey: string, adName?: string) => {
      const ad = adMap.get(adKey) ?? null;
      return { ad, adName: adName ?? ad?.ad_name ?? adKey };
    };

    const toImpactAd = (
      adKey: string,
      adName: string | undefined,
      total: number,
      desempenhoCurrency: number,
      verbaCurrency: number,
      raw: {
        metricDeltaPct: number | null;
        metricPrev: number | null;
        metricLast: number | null;
        spendSharePrev: number | null;
        spendShareLast: number | null;
        parts: { key: string; label: string; currency: number }[];
      },
    ): DayComparisonImpactAd => {
      const { ad, adName: resolvedName } = resolveAd(adKey, adName);
      const oppositeSigns =
        Math.abs(desempenhoCurrency) > 1e-9 &&
        Math.abs(verbaCurrency) > 1e-9 &&
        Math.sign(desempenhoCurrency) !== Math.sign(verbaCurrency);
      return {
        adKey,
        adName: resolvedName,
        ad,
        total,
        desempenhoCurrency,
        verbaCurrency,
        opposingLevers: oppositeSigns,
        metricDeltaPct: raw.metricDeltaPct,
        metricPrev: raw.metricPrev,
        metricLast: raw.metricLast,
        spendSharePrev: raw.spendSharePrev,
        spendShareLast: raw.spendShareLast,
        spendShareDeltaPp:
          raw.spendShareLast != null && raw.spendSharePrev != null
            ? raw.spendShareLast - raw.spendSharePrev
            : null,
        parts: raw.parts,
      };
    };

    let driver: DriverKey | null = null;
    let label: string;
    let mapped: DayComparisonImpactAd[];
    let packMetricToday: number | null;

    const lastDay = window.length > 0 ? window[window.length - 1] : null;
    const snapByAdKey = new Map(snaps.map((s) => [s.adKey, s]));

    if (selectedDriver == null) {
      // Cross-driver "Resultado": Métrica carries the ad's own target cost (CPR/CPMQL,
      // relative-% delta since it's currency-scale) and Spend the ad's share of pack
      // spend — same display shape as driver mode, no special fallback.
      driver = null;
      label = target === "cpmql" ? "CPMQL" : "CPR";
      packMetricToday = lastDay ? (target === "cpmql" ? lastDay.cpmql : lastDay.cpr) : null;
      const adCost = (d: { spend: number; results: number; mqls?: number | null } | undefined) => {
        if (!d) return null;
        const denom = target === "cpmql" ? (d.mqls ?? 0) : d.results;
        return denom > 0 ? d.spend / denom : null;
      };
      mapped = attributeAllDriversToAds(snaps, decomposition).map((it) => {
        const snap = snapByAdKey.get(it.adKey);
        const metricPrev = adCost(snap?.prev);
        const metricLast = adCost(snap?.last);
        return toImpactAd(it.adKey, it.adName, it.totalContributionCurrency, it.ratePartCurrency, it.mixPartCurrency, {
          metricDeltaPct:
            metricPrev != null && metricPrev > 0 && metricLast != null ? (metricLast - metricPrev) / metricPrev : null,
          metricPrev,
          metricLast,
          spendSharePrev: it.spendSharePrev,
          spendShareLast: it.spendShareLast,
          parts: it.driverParts.map((p) => ({ key: p.driver, label: getDriverLabel(p.driver), currency: p.currency })),
        });
      });
    } else {
      const drv = decomposition.drivers.find((d) => d.driver === selectedDriver);
      if (!drv) return null;
      driver = selectedDriver;
      label = getDriverLabel(selectedDriver);
      packMetricToday = lastDay ? packDayDriverValue(lastDay, selectedDriver) : null;
      const attribution = attributeDriverToAds(snaps, selectedDriver, drv.contributionCurrency ?? null);
      // Per-ad share/rate are far more exposed to the near-zero-baseline blowup than
      // pack-level driverCards — a single ad going from ~0% to a few % of pack volume
      // (a completely normal "we scaled it" event) is common, and relative % of that
      // reads as "+7000%". CPM stays relative (currency-scale, not a proportion);
      // share and the 4 funnel rates use percentage-points (simple diff) instead.
      mapped = attribution.allAds.map((a) => {
        const metricDeltaPct =
          a.ratePrev == null || a.rateLast == null
            ? null
            : selectedDriver === "cpm"
              ? (a.ratePrev > 0 ? (a.rateLast - a.ratePrev) / a.ratePrev : null)
              : a.rateLast - a.ratePrev;
        return toImpactAd(a.adKey, a.adName, a.contributionCurrency, a.rateCurrency, a.mixCurrency, {
          metricDeltaPct,
          metricPrev: a.ratePrev,
          metricLast: a.rateLast,
          spendSharePrev: a.spendSharePrev,
          spendShareLast: a.spendShareLast,
          parts: [
            { key: "desempenho", label: "Desempenho", currency: a.rateCurrency },
            { key: "verba", label: "Verba", currency: a.mixCurrency },
          ],
        });
      });
    }

    // Single "top movers" list: both directions mixed, ranked by |total| — the biggest
    // consequences first, whichever way they pushed. Direction lives in the signed,
    // colored Impacto of each row.
    const movers = cutImpactBucket(mapped, (it) => it.total);
    return { driver, label, movers, packMetricToday };
  }, [decomposition, snaps, adMap, selectedDriver, target, window]);

  const ready = snaps.length > 0 && decomposition != null;
  const hasComparison =
    decomposition?.targetPrev != null && decomposition?.targetLast != null;

  return {
    ready,
    hasComparison,
    minVolumeOk,
    bigMetric,
    fairness,
    driverCards,
    topAds,
    impactView,
  };
}

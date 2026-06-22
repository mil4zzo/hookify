import test from "node:test";
import assert from "node:assert/strict";
import { mapRankingRow, resolveAdName, resolveGroupKey } from "../mapRankingRow";

// ── resolveAdName ────────────────────────────────────────────────────────────

test("resolveAdName: por-anuncio returns row.ad_name unchanged", () => {
  const row = { ad_name: "Meu anúncio", adset_name: "Conjunto A" };
  assert.equal(resolveAdName(row, "por-anuncio"), "Meu anúncio");
});

test("resolveAdName: individual returns row.ad_name unchanged", () => {
  const row = { ad_name: "Anúncio X", adset_name: "Conjunto A" };
  assert.equal(resolveAdName(row, "individual"), "Anúncio X");
});

test("resolveAdName: por-conjunto prefers ad_name, falls back to adset_name, then adset_id", () => {
  assert.equal(resolveAdName({ ad_name: "A", adset_name: "B", adset_id: "C" }, "por-conjunto"), "A");
  assert.equal(resolveAdName({ ad_name: "", adset_name: "B", adset_id: "C" }, "por-conjunto"), "B");
  assert.equal(resolveAdName({ ad_name: null, adset_name: null, adset_id: "C" }, "por-conjunto"), "C");
});

test("resolveAdName: por-campanha prefers ad_name, falls back to campaign_name, then campaign_id", () => {
  assert.equal(resolveAdName({ ad_name: "A", campaign_name: "Camp", campaign_id: "cid" }, "por-campanha"), "A");
  assert.equal(resolveAdName({ ad_name: "", campaign_name: "Camp", campaign_id: "cid" }, "por-campanha"), "Camp");
  assert.equal(resolveAdName({ ad_name: null, campaign_name: null, campaign_id: "cid" }, "por-campanha"), "cid");
});

// ── resolveGroupKey ──────────────────────────────────────────────────────────

test("resolveGroupKey: por-anuncio prefers group_key, then ad_name, then ad_id", () => {
  assert.equal(resolveGroupKey({ group_key: "gk", ad_name: "n", ad_id: "id" }, "por-anuncio"), "gk");
  assert.equal(resolveGroupKey({ group_key: null, ad_name: "n", ad_id: "id" }, "por-anuncio"), "n");
  assert.equal(resolveGroupKey({ group_key: null, ad_name: null, ad_id: "id" }, "por-anuncio"), "id");
});

test("resolveGroupKey: individual prefers group_key, then ad_id", () => {
  assert.equal(resolveGroupKey({ group_key: "gk", ad_id: "id" }, "individual"), "gk");
  assert.equal(resolveGroupKey({ group_key: null, ad_id: "id" }, "individual"), "id");
  assert.equal(resolveGroupKey({}, "individual"), "");
});

test("resolveGroupKey: por-conjunto prefers group_key, then adset_id", () => {
  assert.equal(resolveGroupKey({ group_key: "gk", adset_id: "asid" }, "por-conjunto"), "gk");
  assert.equal(resolveGroupKey({ group_key: null, adset_id: "asid" }, "por-conjunto"), "asid");
});

test("resolveGroupKey: por-campanha prefers group_key, then campaign_id", () => {
  assert.equal(resolveGroupKey({ group_key: "gk", campaign_id: "cid" }, "por-campanha"), "gk");
  assert.equal(resolveGroupKey({ group_key: null, campaign_id: "cid" }, "por-campanha"), "cid");
});

// ── mapRankingRow — cpm ───────────────────────────────────────────────────────

test("mapRankingRow: finite cpm is preserved", () => {
  const row = mapRankingRow({ cpm: 12.5 }, "", "por-anuncio");
  assert.equal(row.cpm, 12.5);
});

test("mapRankingRow: NaN cpm becomes 0 (fixes NaN-passthrough bug on Criativos)", () => {
  const row = mapRankingRow({ cpm: NaN }, "", "por-anuncio");
  assert.equal(row.cpm, 0);
});

test("mapRankingRow: Infinity cpm becomes 0", () => {
  const row = mapRankingRow({ cpm: Infinity }, "", "por-anuncio");
  assert.equal(row.cpm, 0);
});

test("mapRankingRow: undefined/null cpm becomes 0", () => {
  assert.equal(mapRankingRow({ cpm: undefined }, "", "por-anuncio").cpm, 0);
  assert.equal(mapRankingRow({ cpm: null }, "", "por-anuncio").cpm, 0);
  assert.equal(mapRankingRow({}, "", "por-anuncio").cpm, 0);
});

// ── mapRankingRow — divisor-zero safety ─────────────────────────────────────

test("mapRankingRow: page_conv is 0 when lpv is 0", () => {
  const row = mapRankingRow({ lpv: 0, conversions: { purchase: 5 } }, "purchase", "por-anuncio");
  assert.equal(row.page_conv, 0);
});

test("mapRankingRow: cpr is 0 when results is 0", () => {
  const row = mapRankingRow({ spend: 100, lpv: 10, conversions: { purchase: 0 } }, "purchase", "por-anuncio");
  assert.equal(row.cpr, 0);
});

test("mapRankingRow: overall_conversion is product of website_ctr * connect_rate * page_conv", () => {
  const row = mapRankingRow(
    { website_ctr: 0.5, connect_rate: 0.4, lpv: 10, conversions: { purchase: 5 }, spend: 50, cpm: 10 },
    "purchase",
    "por-anuncio",
  );
  assert.ok(Math.abs(row.overall_conversion - 0.5 * 0.4 * 0.5) < 1e-10);
});

// ── mapRankingRow — ad_name override ────────────────────────────────────────

test("mapRankingRow: por-conjunto overrides ad_name with adset_name fallback", () => {
  const row = mapRankingRow({ ad_name: null, adset_name: "Conjunto A", adset_id: "asid" }, "", "por-conjunto");
  assert.equal(row.ad_name, "Conjunto A");
});

test("mapRankingRow: por-campanha overrides ad_name with campaign_name fallback", () => {
  const row = mapRankingRow({ ad_name: null, campaign_name: "Campanha X", campaign_id: "cid" }, "", "por-campanha");
  assert.equal(row.ad_name, "Campanha X");
});

test("mapRankingRow: por-anuncio does not override ad_name", () => {
  const row = mapRankingRow({ ad_name: "Anúncio", adset_name: "Conjunto" }, "", "por-anuncio");
  assert.equal(row.ad_name, "Anúncio");
});

// ── mapRankingRow — base fields ──────────────────────────────────────────────

test("mapRankingRow: series and series_loading default to null and false", () => {
  const row = mapRankingRow({}, "", "por-anuncio");
  assert.equal(row.series, null);
  assert.equal(row.series_loading, false);
});

test("mapRankingRow: video_total_plays comes from row.plays", () => {
  const row = mapRankingRow({ plays: 42 }, "", "individual");
  assert.equal(row.video_total_plays, 42);
});

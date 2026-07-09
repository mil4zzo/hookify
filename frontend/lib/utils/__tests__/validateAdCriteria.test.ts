import test from "node:test";
import assert from "node:assert/strict";
import { buildAdMetricsData } from "../validateAdCriteria";

// ── buildAdMetricsData ───────────────────────────────────────────────────────

test("buildAdMetricsData: extrai campos e deriva page_conv/overall_conversion", () => {
  const ad = {
    ad_name: "A",
    ad_id: "1",
    account_id: "act_1",
    impressions: 1000,
    spend: 50,
    website_ctr: 0.02,
    connect_rate: 0.8,
    lpv: 100,
    inline_link_clicks: 20,
    clicks: 30,
    plays: 500,
    hook: 0.4,
    ctr: 0.03,
    conversions: { "action:purchase": 10 },
  };

  const m = buildAdMetricsData(ad, "action:purchase");

  assert.equal(m.ad_name, "A");
  assert.equal(m.ad_id, "1");
  assert.equal(m.account_id, "act_1");
  assert.equal(m.impressions, 1000);
  assert.equal(m.spend, 50);
  assert.equal(m.website_ctr, 0.02);
  assert.equal(m.connect_rate, 0.8);
  assert.equal(m.inline_link_clicks, 20);
  assert.equal(m.clicks, 30);
  assert.equal(m.plays, 500);
  assert.equal(m.hook, 0.4);
  assert.equal(m.ctr, 0.03);
  // results=10, lpv=100 → page_conv = 0.1
  assert.equal(m.page_conv, 0.1);
  // overall = website_ctr * connect_rate * page_conv
  assert.equal(m.overall_conversion, 0.02 * 0.8 * (10 / 100));
  assert.deepEqual(m.conversions, { "action:purchase": 10 });
});

test("buildAdMetricsData: cpm ausente/não-finito → 0 (RPC sempre garante cpm finito; não recalculamos)", () => {
  const m = buildAdMetricsData({ impressions: 1000, spend: 50 }, undefined);
  assert.equal(m.cpm, 0);
});

test("buildAdMetricsData: cpm NaN/Infinity → 0", () => {
  assert.equal(buildAdMetricsData({ cpm: NaN }, undefined).cpm, 0);
  assert.equal(buildAdMetricsData({ cpm: Infinity }, undefined).cpm, 0);
});

test("buildAdMetricsData: cpm usa valor do backend quando presente", () => {
  const m = buildAdMetricsData({ impressions: 1000, spend: 50, cpm: 42 }, undefined);
  assert.equal(m.cpm, 42);
});

test("buildAdMetricsData: cpm=0 quando impressions=0 (sem divisão por zero)", () => {
  const m = buildAdMetricsData({ impressions: 0, spend: 50 }, undefined);
  assert.equal(m.cpm, 0);
});

test("buildAdMetricsData: actionType ausente → results=0 → page_conv/overall=0", () => {
  const ad = { lpv: 100, website_ctr: 0.02, connect_rate: 0.8, conversions: { "action:purchase": 10 } };
  const m = buildAdMetricsData(ad, undefined);
  assert.equal(m.page_conv, 0);
  assert.equal(m.overall_conversion, 0);
});

test("buildAdMetricsData: chave de conversão inexistente → results=0", () => {
  const ad = { lpv: 100, conversions: { "action:purchase": 10 } };
  // pede um action_type que não existe no objeto conversions
  const m = buildAdMetricsData(ad, "conversion:lead");
  assert.equal(m.page_conv, 0);
});

test("buildAdMetricsData: lpv=0 → page_conv=0 (sem divisão por zero)", () => {
  const ad = { lpv: 0, conversions: { "action:purchase": 10 } };
  const m = buildAdMetricsData(ad, "action:purchase");
  assert.equal(m.page_conv, 0);
});

test("buildAdMetricsData: campos ausentes caem para 0 / conversions vazio", () => {
  const m = buildAdMetricsData({}, undefined);
  assert.equal(m.impressions, 0);
  assert.equal(m.spend, 0);
  assert.equal(m.cpm, 0);
  assert.equal(m.website_ctr, 0);
  assert.equal(m.connect_rate, 0);
  assert.equal(m.hook, 0);
  assert.equal(m.page_conv, 0);
  assert.equal(m.overall_conversion, 0);
  assert.deepEqual(m.conversions, {});
});

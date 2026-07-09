import test from "node:test";
import assert from "node:assert/strict";
import { computeConversionMetrics } from "../conversionMetrics";

test("computeConversionMetrics: page_conv = results/lpv, overall = website_ctr*connect_rate*page_conv", () => {
  const { page_conv, overall_conversion } = computeConversionMetrics(0.02, 0.8, 10, 100);
  assert.equal(page_conv, 0.1);
  assert.equal(overall_conversion, 0.02 * 0.8 * 0.1);
});

test("computeConversionMetrics: lpv=0 → page_conv=0 e overall_conversion=0 (sem divisão por zero)", () => {
  const { page_conv, overall_conversion } = computeConversionMetrics(0.02, 0.8, 10, 0);
  assert.equal(page_conv, 0);
  assert.equal(overall_conversion, 0);
});

test("computeConversionMetrics: results=0 → page_conv=0", () => {
  const { page_conv } = computeConversionMetrics(0.02, 0.8, 0, 100);
  assert.equal(page_conv, 0);
});

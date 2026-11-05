import test from "node:test";
import assert from "node:assert/strict";

import { apiClient } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";

/**
 * Vigências (D33, migration 184): o ponto único que MANDA as datas de corte e junta a
 * resposta (`{trecho: histograma}`) com elas. Esquecer um dos dois numa rota deixa todo
 * pack com vigência indisponível naquela tela — sem nenhum outro teste acusar.
 */

const CUTS = ["2026-10-13", "2026-10-20"];
const SPLIT = { "0": { "50": 2 }, "2": { "70": 1 } };

function stub<K extends "get" | "post">(method: K, reply: unknown): { urls: string[]; bodies: unknown[]; restore: () => void } {
  const original = apiClient[method];
  const urls: string[] = [];
  const bodies: unknown[] = [];
  (apiClient as any)[method] = async (url: string, body?: unknown) => {
    urls.push(url);
    bodies.push(body);
    return reply;
  };
  return { urls, bodies, restore: () => ((apiClient as any)[method] = original) };
}

test("Manager: manda as datas no corpo e a linha volta com {cuts, histograms}", async () => {
  const s = stub("post", { data: [{ ad_id: "1", leadscore_by_period: SPLIT }], pagination: {} });
  try {
    const out = await api.analytics.getAdPerformance({ date_start: "2026-10-01", date_stop: "2026-10-31", group_by: "ad_id", lead_period_starts: CUTS } as any);
    assert.deepEqual((s.bodies[0] as any).lead_period_starts, CUTS);
    assert.deepEqual(out.data[0].leadscore_by_period, { cuts: CUTS, histograms: SPLIT });
  } finally {
    s.restore();
  }
});

test("filhos e detalhes: as datas vão na URL e a resposta volta embrulhada", async () => {
  const calls: Array<[string, () => Promise<any>, (r: any) => unknown]> = [
    ["children", () => api.analytics.getRankingsChildren("A", { date_start: "d0", date_stop: "d1", lead_period_starts: CUTS }), (r) => r.data[0]],
    ["adset", () => api.analytics.getAdsetChildren("S", { date_start: "d0", date_stop: "d1", lead_period_starts: CUTS }), (r) => r.data[0]],
    ["campaign", () => api.analytics.getCampaignChildren("C", { date_start: "d0", date_stop: "d1", lead_period_starts: CUTS }), (r) => r.data[0]],
    ["ad", () => api.analytics.getAdDetails("1", { date_start: "d0", date_stop: "d1", lead_period_starts: CUTS }), (r) => r],
    ["ad-name", () => api.analytics.getAdNameDetails("A", { date_start: "d0", date_stop: "d1", lead_period_starts: CUTS }), (r) => r],
  ];
  for (const [name, call, row] of calls) {
    const listReply = { data: [{ leadscore_by_period: { ...SPLIT } }] };
    const itemReply = { leadscore_by_period: { ...SPLIT } };
    const s = stub("get", name === "ad" || name === "ad-name" ? itemReply : listReply);
    try {
      const out = await call();
      const qs = new URLSearchParams(s.urls[0].split("?")[1]);
      assert.deepEqual(qs.getAll("lead_period_starts"), CUTS, name);
      assert.deepEqual((row(out) as any).leadscore_by_period, { cuts: CUTS, histograms: SPLIT }, name);
    } finally {
      s.restore();
    }
  }
});

test("sem vigências: nada na URL, e a linha fica como veio", async () => {
  const s = stub("get", { data: [{ leadscore_by_period: { ...SPLIT } }] });
  try {
    const out = await api.analytics.getRankingsChildren("A", { date_start: "d0", date_stop: "d1" });
    assert.equal(s.urls[0].includes("lead_period_starts"), false);
    assert.deepEqual(out.data[0].leadscore_by_period, SPLIT);
  } finally {
    s.restore();
  }
});

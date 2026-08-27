import test from "node:test";
import assert from "node:assert/strict";
import type { AsyncStorage } from "@tanstack/query-persist-client-core";
import {
  ANALYTICS_PERSIST_MAX_AGE_MS,
  __resetAnalyticsPersisters,
  busterFor,
  getAnalyticsPersister,
  isPersistedAnalyticsKey,
} from "../analyticsPersister";

function fakeStorage(): AsyncStorage<string> & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => { map.set(k, v); },
    removeItem: async (k) => { map.delete(k); },
    entries: async () => Array.from(map.entries()),
  };
}

// Um "Query" mínimo, no formato que persistQuery/retrieveQuery leem.
function fakeQuery(queryKey: unknown[], data: unknown, dataUpdatedAt = Date.now()) {
  const q: any = {
    queryKey,
    queryHash: JSON.stringify(queryKey),
    state: { data, dataUpdatedAt, errorUpdatedAt: 0, status: "success" },
    fetchCalls: 0,
    setState(patch: Record<string, unknown>) { q.state = { ...q.state, ...patch }; },
    isStale: () => false,
    fetch() { q.fetchCalls++; },
  };
  return q;
}

const RANKINGS_KEY = ["analytics", "rankings", "2026-06-01", "2026-07-27", "ad_name", "action:purchase", {}, ["p1"], false, true, 5, 0, 500, false, "n=3|r=x|s=y"];

test("isPersistedAnalyticsKey: só ad-performance e série; drill (children) fica de fora", () => {
  assert.equal(isPersistedAnalyticsKey(RANKINGS_KEY), true);
  assert.equal(isPersistedAnalyticsKey(["analytics", "rankings-series", "2026-06-01", "2026-07-27", "ad_name", null, ["p1"], 5, "h", "n=3"]), true);
  assert.equal(isPersistedAnalyticsKey(["analytics", "rankings", "campaign-children", "c1", "2026-06-01", "2026-07-27", "", ""]), false);
  assert.equal(isPersistedAnalyticsKey(["analytics", "rankings", "adset-children", "a1", "2026-06-01", "2026-07-27", ""]), false);
  assert.equal(isPersistedAnalyticsKey(["analytics", "rankings-retention", "2026-06-01"]), false);
  assert.equal(isPersistedAnalyticsKey(["facebook", "connections"]), false);
});

test("roundtrip: o que foi persistido volta do storage sem tocar no queryFn", async () => {
  __resetAnalyticsPersisters();
  const storage = fakeStorage();
  const p = getAnalyticsPersister("user-a", storage)!;
  const q = fakeQuery(RANKINGS_KEY, { data: [{ group_key: "x", spend: 1 }], pagination: { total: 1 } });
  await p.persistQuery(q);
  assert.equal(storage.map.size, 1);
  const restored = await p.retrieveQuery<any>(q.queryHash);
  assert.deepEqual(restored, q.state.data);
});

test("persisterFn: com entrada em disco não chama o queryFn; sem entrada chama e grava", async () => {
  __resetAnalyticsPersisters();
  const storage = fakeStorage();
  const p = getAnalyticsPersister("user-a", storage)!;
  const q = fakeQuery(RANKINGS_KEY, undefined);
  let calls = 0;
  // como o Query real: o resultado do queryFn vira state.data antes do persister gravar
  const queryFn = async () => { calls++; const r = { data: [], pagination: { total: 0 } }; q.state.data = r; return r; };
  const ctx = { queryKey: RANKINGS_KEY, signal: new AbortController().signal, meta: undefined, client: {} as any } as any;

  const first = await p.persisterFn(queryFn, ctx, q);
  assert.equal(calls, 1, "sem cache: busca");
  assert.deepEqual(first, { data: [], pagination: { total: 0 } });
  // o persister grava num macrotask agendado
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(storage.map.size, 1, "gravou após buscar");

  // "recarga": um Query novo, sem dado em memória, mesma chave
  const q2 = fakeQuery(RANKINGS_KEY, undefined);
  const second = await p.persisterFn(queryFn, ctx, q2);
  assert.equal(calls, 1, "com cache: NÃO busca");
  assert.deepEqual(second, { data: [], pagination: { total: 0 } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(q2.fetchCalls, 0, "refetchOnRestore=false: restaurar não dispara fetch");
});

test("isolamento por usuário: entrada do usuário A não serve para B (buster) e é removida", async () => {
  __resetAnalyticsPersisters();
  const storage = fakeStorage();
  const pa = getAnalyticsPersister("user-a", storage)!;
  const q = fakeQuery(RANKINGS_KEY, { data: [1] });
  await pa.persistQuery(q);
  assert.notEqual(busterFor("user-a"), busterFor("user-b"));
  const pb = getAnalyticsPersister("user-b", storage)!;
  const restored = await pb.retrieveQuery<any>(q.queryHash);
  assert.equal(restored, undefined);
  assert.equal(storage.map.size, 0, "entrada de outro usuário é descartada na leitura");
});

test("GC remove entradas vencidas e mantém as vivas", async () => {
  __resetAnalyticsPersisters();
  const storage = fakeStorage();
  const p = getAnalyticsPersister("user-a", storage)!;
  await p.persistQuery(fakeQuery([...RANKINGS_KEY, "viva"], { data: [1] }));
  await p.persistQuery(fakeQuery([...RANKINGS_KEY, "velha"], { data: [2] }, Date.now() - ANALYTICS_PERSIST_MAX_AGE_MS - 1000));
  assert.equal(storage.map.size, 2);
  await p.persisterGc();
  assert.equal(storage.map.size, 1);
  assert.ok([...storage.map.keys()][0].includes("viva"));
});

test("uma instância por usuário; sem usuário não há persister", () => {
  __resetAnalyticsPersisters();
  const storage = fakeStorage();
  assert.equal(getAnalyticsPersister(null, storage), undefined);
  assert.equal(getAnalyticsPersister(undefined, storage), undefined);
  const a1 = getAnalyticsPersister("user-a", storage);
  const a2 = getAnalyticsPersister("user-a", storage);
  assert.equal(a1, a2);
});

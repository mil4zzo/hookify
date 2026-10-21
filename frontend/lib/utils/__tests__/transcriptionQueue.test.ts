import test from "node:test";
import assert from "node:assert/strict";
import { mergeQueuedTranscription, waitForTranscriptionJobEnd } from "../transcriptionQueue";

// ── mergeQueuedTranscription ─────────────────────────────────────────────────

test("merge: duas listas viram a união, sem repetir", () => {
  const merged = mergeQueuedTranscription({ adNames: ["a", "b"], forceNoAudio: false }, { adNames: ["b", "c"] });
  assert.deepEqual(merged.adNames, ["a", "b", "c"]);
});

test("merge: pedido do pack inteiro (sem lista) vence a lista, nos dois sentidos", () => {
  assert.equal(mergeQueuedTranscription({ adNames: ["a"], forceNoAudio: false }, {}).adNames, undefined);
  assert.equal(mergeQueuedTranscription({ forceNoAudio: false }, { adNames: ["a"] }).adNames, undefined);
});

test("merge: forceNoAudio é alto se qualquer um dos pedidos pediu", () => {
  assert.equal(mergeQueuedTranscription({ adNames: ["a"], forceNoAudio: false }, { forceNoAudio: true }).forceNoAudio, true);
  assert.equal(mergeQueuedTranscription({ adNames: ["a"], forceNoAudio: true }, {}).forceNoAudio, true);
  assert.equal(mergeQueuedTranscription({ adNames: ["a"], forceNoAudio: false }, {}).forceNoAudio, false);
});

// ── waitForTranscriptionJobEnd ───────────────────────────────────────────────

const FAST = { intervalMs: 1 };

test("wait: só retorna quando o job chega a estado final", async () => {
  const statuses = ["processing", "processing", "completed"];
  let calls = 0;
  await waitForTranscriptionJobEnd({ ...FAST, isCancelled: () => false, fetchStatus: async () => ({ status: statuses[calls++] }) });
  assert.equal(calls, 3);
});

test("wait: cancelled e failed também liberam a fila", async () => {
  for (const status of ["cancelled", "failed"]) {
    let calls = 0;
    await waitForTranscriptionJobEnd({ ...FAST, isCancelled: () => false, fetchStatus: async () => (calls++, { status }) });
    assert.equal(calls, 1, status);
  }
});

test("wait: cancelamento da fila interrompe sem consultar o backend de novo", async () => {
  let cancelled = false;
  let calls = 0;
  await waitForTranscriptionJobEnd({
    ...FAST,
    isCancelled: () => cancelled,
    fetchStatus: async () => {
      calls++;
      cancelled = true;
      return { status: "processing" };
    },
  });
  assert.equal(calls, 1);
});

test("wait: erros de rede seguidos liberam a fila; um erro isolado não", async () => {
  let calls = 0;
  await waitForTranscriptionJobEnd({
    ...FAST,
    maxConsecutiveErrors: 3,
    isCancelled: () => false,
    fetchStatus: async () => {
      calls++;
      throw new Error("rede");
    },
  });
  assert.equal(calls, 3);

  // erro, ok, erro, ok, completed: o contador zera a cada sucesso — não chega a 2 seguidos
  const script: Array<"err" | string> = ["err", "processing", "err", "processing", "completed"];
  let i = 0;
  await waitForTranscriptionJobEnd({
    ...FAST,
    maxConsecutiveErrors: 2,
    isCancelled: () => false,
    fetchStatus: async () => {
      const step = script[i++];
      if (step === "err") throw new Error("rede");
      return { status: step };
    },
  });
  assert.equal(i, 5);
});

test("wait: job morto (assinatura de progresso parada) libera a fila antes do teto", async () => {
  let calls = 0;
  const startedAt = Date.now();
  await waitForTranscriptionJobEnd({
    intervalMs: 5,
    stallMs: 30,
    maxWaitMs: 5_000,
    isCancelled: () => false,
    fetchStatus: async () => (calls++, { status: "processing", details: { done: 8, total: 53, keepalive_at: "t0" } }),
  });
  assert.ok(Date.now() - startedAt < 1_000, "deveria sair pelo stall, não pelo teto de 5 s");
  assert.ok(calls >= 2);
});

test("wait: job lento mas vivo (keepalive muda) NÃO é dado como morto", async () => {
  let calls = 0;
  await waitForTranscriptionJobEnd({
    intervalMs: 5,
    stallMs: 30,
    maxWaitMs: 5_000,
    isCancelled: () => false,
    // mesmo done/total (vídeo grande), mas o keepalive anda; termina na 15ª consulta
    fetchStatus: async () => {
      calls++;
      return calls >= 15
        ? { status: "completed" }
        : { status: "processing", details: { done: 8, total: 53, keepalive_at: `t${calls}` } };
    },
  });
  assert.equal(calls, 15);
});

test("wait: teto de tempo libera a fila com job que nunca termina", async () => {
  let calls = 0;
  await waitForTranscriptionJobEnd({
    intervalMs: 5,
    maxWaitMs: 30,
    isCancelled: () => false,
    // assinatura sempre nova: o stall não dispara, só o teto
    fetchStatus: async () => (calls++, { status: "processing", details: { keepalive_at: `t${calls}` } }),
  });
  assert.ok(calls >= 1 && calls < 20);
});

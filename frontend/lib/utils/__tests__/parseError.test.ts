import test from "node:test";
import assert from "node:assert/strict";
import { parseError } from "../errors";

// O interceptor do apiClient já rejeita com AppError (objeto simples, não Error).
// Quem chama parseError de novo sobre ele não pode perder status/code/details:
// o 409 REFRESH_ALREADY_RUNNING do refresh de pack depende do status para re-anexar.
const axios409 = {
  response: {
    status: 409,
    data: {
      detail: {
        code: "REFRESH_ALREADY_RUNNING",
        message: "Este pack já está sendo atualizado.",
        details: { job_id: "job-1", pack_id: "pack-1" },
      },
    },
  },
};

test("parseError é idempotente: AppError passa intacto pela segunda vez", () => {
  const first = parseError(axios409);
  const second = parseError(first);

  assert.equal(second.status, 409);
  assert.equal(second.code, "REFRESH_ALREADY_RUNNING");
  assert.equal(second.message, "Este pack já está sendo atualizado.");
  assert.deepEqual(second.details, { job_id: "job-1", pack_id: "pack-1" });
});

test("500 com detail em texto chega como mensagem, não 'Erro desconhecido'", () => {
  const appError = parseError({
    response: { status: 500, data: { detail: "Could not find the function public.pack_acquire_refresh_lock" } },
  });
  const again = parseError(appError);

  assert.equal(again.status, 500);
  assert.match(again.message, /pack_acquire_refresh_lock/);
});

test("Error comum continua com a própria mensagem e sem status", () => {
  const parsed = parseError(new Error("falhou"));
  assert.equal(parsed.message, "falhou");
  assert.equal(parsed.status, undefined);
});

test("valor sem mensagem cai no fallback", () => {
  assert.equal(parseError(undefined).message, "Erro desconhecido");
  assert.equal(parseError({}).message, "Erro desconhecido");
});

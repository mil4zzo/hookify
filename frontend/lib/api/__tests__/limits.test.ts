/**
 * A ordem dos tempos de espera (migrations 159 e 164): banco < backend < navegador.
 * Se o navegador desistir antes do backend, o usuário vê erro enquanto o banco ainda
 * trabalha — e um novo clique empilha outra consulta pesada.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ANALYTICS_REQUEST_TIMEOUT_MS } from "../limits";

// Espelho de backend/app/core/config.py (MIN_MANAGER_READ_TIMEOUT_SECONDS = 40 + 5).
const BACKEND_MANAGER_TIMEOUT_MS = 45_000;

test("o navegador espera mais que o backend do Manager", () => {
  assert.ok(ANALYTICS_REQUEST_TIMEOUT_MS > BACKEND_MANAGER_TIMEOUT_MS);
});

test("e não fica nos 2 minutos genéricos", () => {
  assert.ok(ANALYTICS_REQUEST_TIMEOUT_MS < 120_000);
});

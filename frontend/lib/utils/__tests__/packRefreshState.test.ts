import test from "node:test";
import assert from "node:assert/strict";
import { isPackRefreshingOnServer } from "../packRefreshState";

const emMinutos = (m: number) => new Date(Date.now() + m * 60_000);
/** Como o PostgREST devolve uma coluna `timestamp` SEM timezone: UTC, sem offset. */
const comoOBancoDevolve = (d: Date) => d.toISOString().slice(0, 19);

test("running com lock no futuro = atualizando", () => {
  assert.equal(
    isPackRefreshingOnServer({ refresh_status: "running", refresh_lock_until: comoOBancoDevolve(emMinutos(10)) }),
    true,
  );
});

test("running com lock VENCIDO = parado (job que morreu sem escrever o status final)", () => {
  // Sem este corte, mark_failed no processor ou um cancelamento em lote deixariam
  // o pack 'running' para sempre e todo membro veria selo de atualização eterno.
  assert.equal(
    isPackRefreshingOnServer({ refresh_status: "running", refresh_lock_until: comoOBancoDevolve(emMinutos(-1)) }),
    false,
  );
});

test("timestamp sem offset é lido como UTC — nos dois sentidos", () => {
  // A armadilha: `new Date("2026-09-04T18:30:00")` é hora LOCAL. Ler assim desloca
  // o prazo pelo offset da máquina — a oeste (BRT, UTC-3) um lock vencido revive;
  // a leste (UTC+3) um lock vivo morre. O par ±1 min pega os dois casos: qualquer
  // fuso != UTC quebra pelo menos uma das duas asserções.
  assert.equal(
    isPackRefreshingOnServer({ refresh_status: "running", refresh_lock_until: comoOBancoDevolve(emMinutos(1)) }),
    true,
  );
  assert.equal(
    isPackRefreshingOnServer({ refresh_status: "running", refresh_lock_until: comoOBancoDevolve(emMinutos(-1)) }),
    false,
  );
});

test("aceita também a forma com offset explícito", () => {
  assert.equal(
    isPackRefreshingOnServer({ refresh_status: "running", refresh_lock_until: emMinutos(5).toISOString() }),
    true,
  );
});

test("status terminal nunca acende o selo, mesmo com lock vivo", () => {
  for (const status of ["success", "failed", "canceled", "idle"] as const) {
    assert.equal(
      isPackRefreshingOnServer({ refresh_status: status, refresh_lock_until: comoOBancoDevolve(emMinutos(10)) }),
      false,
      `status ${status} não deveria acender`,
    );
  }
});

test("running sem lock = parado (linha legada, anterior ao carimbo)", () => {
  assert.equal(isPackRefreshingOnServer({ refresh_status: "running", refresh_lock_until: null }), false);
});

test("pack sem os campos e pack nulo não quebram", () => {
  assert.equal(isPackRefreshingOnServer({}), false);
  assert.equal(isPackRefreshingOnServer(null), false);
  assert.equal(isPackRefreshingOnServer({ refresh_status: "running", refresh_lock_until: "lixo" }), false);
});

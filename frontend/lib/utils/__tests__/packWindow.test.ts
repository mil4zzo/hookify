import test from "node:test";
import assert from "node:assert/strict";
import { planWindowEdit } from "../packWindow";

// Espelho de backend/app/services/pack_window.plan_window_edit — os MESMOS casos
// de backend/tests/test_pack_window_edit.py, com os mesmos números. Se um lado
// mudar sem o outro, o diálogo promete uma fatia e o job pede outra.
//
// Sabotagem: trocar `n - 1` por `n + 1` na emenda → "começar antes" falha.

const HOJE = "2026-09-17";
const PACK = {
  date_start: "2026-07-01",
  date_stop: "2026-08-31",
  last_refreshed_at: "2026-08-31",
  auto_refresh: false,
  attribution_window_days: 7,
};

test("começar antes: busca do novo início até a emenda de 7 dias", () => {
  const r = planWindowEdit(PACK, "2026-06-01", "2026-08-31", HOJE);
  assert.deepEqual(r.plan?.fetch, ["2026-06-01", "2026-07-07"]);
  assert.equal(r.plan?.reduces, false);
  assert.equal(r.plan?.autoRefreshOff, true);
});

test("terminar depois: recua 7 dias antes do primeiro dia novo", () => {
  const r = planWindowEdit(PACK, "2026-07-01", "2026-09-15", HOJE);
  assert.deepEqual(r.plan?.fetch, ["2026-08-25", "2026-09-15"]);
});

test("terminar hoje não desliga o toggle", () => {
  const r = planWindowEdit(PACK, "2026-07-01", HOJE, HOJE);
  assert.equal(r.plan?.autoRefreshOff, false);
});

test("as duas pontas ampliam: uma busca só", () => {
  const r = planWindowEdit(PACK, "2026-06-01", "2026-09-15", HOJE);
  assert.deepEqual(r.plan?.fetch, ["2026-06-01", "2026-09-15"]);
});

test("pack curto: o recuo nunca passa do início novo", () => {
  const curto = { ...PACK, date_start: "2026-08-29", date_stop: "2026-08-31" };
  assert.deepEqual(planWindowEdit(curto, "2026-08-29", "2026-09-05", HOJE).plan?.fetch, ["2026-08-29", "2026-09-05"]);
  assert.deepEqual(planWindowEdit(curto, "2026-08-20", "2026-08-31", HOJE).plan?.fetch, ["2026-08-20", "2026-08-31"]);
});

test("pack calibrado em 1 dia recua 1", () => {
  const r = planWindowEdit({ ...PACK, attribution_window_days: 1 }, "2026-07-01", "2026-09-15", HOJE);
  assert.deepEqual(r.plan?.fetch, ["2026-08-31", "2026-09-15"]);
});

test("começar depois (Etapa 2): cabeça de 7 dias e apaga antes", () => {
  const r = planWindowEdit(PACK, "2026-07-15", "2026-08-31", HOJE);
  assert.equal(r.plan?.reduces, true);
  assert.equal(r.plan?.deleteBefore, "2026-07-15");
  assert.deepEqual(r.plan?.head, ["2026-07-15", "2026-07-21"]);
  assert.deepEqual(r.plan?.fetch, ["2026-07-15", "2026-07-21"]);
});

test("terminar antes (Etapa 2): só apaga, sem busca", () => {
  const r = planWindowEdit(PACK, "2026-07-01", "2026-08-15", HOJE);
  assert.equal(r.plan?.deleteAfter, "2026-08-15");
  assert.equal(r.plan?.fetch, null);
  assert.equal(r.plan?.autoRefreshOff, true);
});

test("erros com motivo", () => {
  assert.equal(planWindowEdit(PACK, "2026-07-01", "2026-08-31", HOJE).error, "mesmo_periodo");
  assert.equal(planWindowEdit(PACK, "2026-09-01", "2026-08-31", HOJE).error, "inicio_depois_do_fim");
  assert.equal(planWindowEdit(PACK, "2026-07-01", "2026-09-18", HOJE).error, "fim_no_futuro");
  assert.equal(planWindowEdit(PACK, "", "2026-08-31", HOJE).error, "datas_invalidas");
  assert.equal(planWindowEdit({}, "2026-07-01", "2026-08-31", HOJE).error, "pack_sem_periodo");
});

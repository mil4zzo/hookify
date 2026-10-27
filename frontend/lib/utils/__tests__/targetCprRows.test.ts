import test from "node:test";
import assert from "node:assert/strict";
import {
  addTargetCprRow,
  canAddTargetCprRow,
  eventsForRow,
  removeTargetCprRow,
  rowsFromTargets,
  targetsFromRows,
  updateTargetCprRow,
} from "../targetCprRows";
import { buildPackJudgmentPayload, isPackJudgmentFormDirty } from "../packJudgmentForm";

/**
 * CPR alvo em linhas: a tela mostra só os eventos com meta, mas o diálogo continua
 * recebendo o mapa com TODOS os eventos — é o que mantém dirty e payload intactos.
 */

const TYPES = ["conversion:lead", "conversion:purchase", "conversion:register"];

test("abre com uma linha por evento com meta; sem meta, uma linha em branco", () => {
  const rows = rowsFromTargets({ "conversion:lead": "", "conversion:purchase": "50", "conversion:register": "8" }, TYPES);
  assert.deepEqual(rows.map((r) => [r.event, r.value]), [["conversion:purchase", "50"], ["conversion:register", "8"]]);

  const blank = rowsFromTargets({ "conversion:lead": " " }, TYPES);
  assert.deepEqual(blank.map((r) => [r.event, r.value]), [["", ""]]);
});

test("ida e volta: abrir e não mexer devolve o mesmo mapa (não há alteração a salvar)", () => {
  const initial = { "conversion:lead": "", "conversion:purchase": "50", "conversion:register": "" };
  const back = targetsFromRows(rowsFromTargets(initial, TYPES), TYPES);
  assert.deepEqual(back, initial);
  assert.equal(isPackJudgmentFormDirty({ mql: "", targets: initial }, { mql: "", targets: back }), false);
});

test("remover a linha é apagar a meta; trocar o evento move a meta", () => {
  const rows = rowsFromTargets({ "conversion:purchase": "50" }, TYPES);
  const removed = targetsFromRows(removeTargetCprRow(rows, rows[0].key), TYPES);
  assert.equal(removed["conversion:purchase"], "", "sem linha = sem meta");

  const moved = targetsFromRows(updateTargetCprRow(rows, rows[0].key, { event: "conversion:lead" }), TYPES);
  assert.deepEqual(moved, { "conversion:lead": "50", "conversion:purchase": "", "conversion:register": "" });

  const built = buildPackJudgmentPayload({ mql: "", targets: removed }, { kind: "omit" });
  assert.deepEqual(built, { kind: "ok", payload: { mql_leadscore_min: null, target_cpr: null } });
});

test("remover a última linha deixa uma em branco", () => {
  const rows = rowsFromTargets({ "conversion:lead": "5" }, TYPES);
  const next = removeTargetCprRow(rows, rows[0].key);
  assert.equal(next.length, 1);
  assert.equal(next[0].event, "");
});

test("linha sem evento não conta, e o seletor só oferece eventos livres", () => {
  let rows = rowsFromTargets({ "conversion:lead": "5" }, TYPES);
  rows = addTargetCprRow(rows);
  rows = updateTargetCprRow(rows, rows[1].key, { value: "99" });
  assert.equal(targetsFromRows(rows, TYPES)["conversion:purchase"], "", "valor sem evento não vira meta de ninguém");
  assert.deepEqual(eventsForRow(rows, TYPES, rows[1].key), ["conversion:purchase", "conversion:register"]);
  assert.deepEqual(eventsForRow(rows, TYPES, rows[0].key), TYPES, "a própria linha mantém o seu evento na lista");
});

test("acrescentar: só com todas as linhas com evento e sobrando evento livre", () => {
  let rows = rowsFromTargets({ "conversion:lead": "5" }, TYPES);
  assert.equal(canAddTargetCprRow(rows, TYPES), true);
  rows = addTargetCprRow(rows);
  assert.equal(canAddTargetCprRow(rows, TYPES), false, "já há uma linha esperando um evento");
  const all = rowsFromTargets({ "conversion:lead": "1", "conversion:purchase": "2", "conversion:register": "3" }, TYPES);
  assert.equal(canAddTargetCprRow(all, TYPES), false, "todos os eventos já têm linha");
  assert.equal(canAddTargetCprRow(rowsFromTargets({}, []), []), false, "pack sem eventos");
});

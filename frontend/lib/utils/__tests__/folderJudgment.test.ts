/** Dono único do critério (migration 186): quem manda numa pasta e num pack. */
import test from "node:test";
import assert from "node:assert/strict";
import type { PackFolder } from "@/lib/types";
import { foldersLosingJudgment, judgmentGovernor, packsLosingJudgment } from "../folderJudgment";
import type { AdsPack } from "@/lib/types";

const f = (id: string, parent_id: string | null, has_judgment = false): PackFolder => ({ id, name: id, parent_id, position: 0, has_judgment });
const tree = [f("raiz", null), f("pai", "raiz", true), f("filha", "pai"), f("neta", "filha"), f("irma", "raiz")];

test("pack/pasta sob pasta com critério: manda o ancestral mais próximo que define", () => {
  assert.equal(judgmentGovernor(tree, "neta")?.id, "pai");
  assert.equal(judgmentGovernor(tree, "pai")?.id, "pai");
});

test("galho sem critério acima: ninguém manda", () => {
  assert.equal(judgmentGovernor(tree, "irma"), null);
  assert.equal(judgmentGovernor(tree, null), null);
});

test("estrito ignora a própria pasta: ela pode definir se nenhum ancestral define", () => {
  assert.equal(judgmentGovernor(tree, "pai", { strict: true }), null);
  assert.equal(judgmentGovernor(tree, "filha", { strict: true })?.id, "pai");
});

test("pasta compartilhada (parent_id nulo na raiz vista) não quebra", () => {
  assert.equal(judgmentGovernor([f("a", null), f("b", "a")], "b"), null);
});

// ── Confirmação antes de perder critério ──
// Sabotagem: foldersLosingJudgment sem o `judgmentGovernor(newParent)` -> o 1º teste falha;
// packsLosingJudgment tratando null como diferente -> o 3º falha.

test("arrastar pasta com critério para quem manda: ela (e as subpastas com critério) perdem o seu", () => {
  const folders = [f("a", null, true), f("a1", "a"), f("a2", "a1", true), f("alvo", null, true), f("livre", null)];
  assert.deepEqual(foldersLosingJudgment(folders, "a", "alvo").map((x) => x.id), ["a", "a2"]);
});

test("destino sem critério, ou pasta sem critério: nada a perder", () => {
  const folders = [f("a", null, true), f("alvo", null, true), f("livre", null), f("b", null)];
  assert.deepEqual(foldersLosingJudgment(folders, "a", "livre"), []);
  assert.deepEqual(foldersLosingJudgment(folders, "a", null), []);
  assert.deepEqual(foldersLosingJudgment(folders, "b", "alvo"), []);
});

const pack = (extra: Partial<AdsPack>) => ({ id: "p", name: "p", ...extra }) as AdsPack;

test("pack perde valor só se tem valor próprio diferente do da pasta", () => {
  const doc = { mql_leadscore_min: 60, target_cpr: { lead: 10 } };
  assert.equal(packsLosingJudgment([pack({ mql_leadscore_min: 70 })], doc).length, 1);
  assert.equal(packsLosingJudgment([pack({ target_cpr: { lead: 12 } })], doc).length, 1);
  assert.equal(packsLosingJudgment([pack({ mql_leadscore_min: 60, target_cpr: { lead: 10, compra: 5 } })], doc).length, 0);
  assert.equal(packsLosingJudgment([pack({ mql_leadscore_min: null, target_cpr: null })], doc).length, 0);
  assert.equal(packsLosingJudgment([pack({ mql_leadscore_min: 70 })], null).length, 0);
});

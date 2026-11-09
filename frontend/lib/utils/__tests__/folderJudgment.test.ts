/** Dono único do critério (migration 186): quem manda numa pasta e num pack. */
import test from "node:test";
import assert from "node:assert/strict";
import type { PackFolder } from "@/lib/types";
import { judgmentGovernor } from "../folderJudgment";

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

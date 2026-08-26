import test from "node:test";
import assert from "node:assert/strict";
import { computePacksFreshnessStamp } from "../packsFreshness";

const packs = [
  { id: "a", updated_at: "2026-08-20T10:00:00Z" },
  { id: "b", updated_at: "2026-08-25T18:30:00Z", sheet_integration: { last_successful_sync_at: "2026-08-24T08:00:00Z" } },
  { id: "c", updated_at: "2026-08-01T00:00:00Z", sheet_integration: { last_successful_sync_at: null } },
];

test("refresh de um pack muda o carimbo (o ponto do mecanismo)", () => {
  const antes = computePacksFreshnessStamp(packs, ["a", "b"]);
  const depois = computePacksFreshnessStamp(
    packs.map((p) => (p.id === "a" ? { ...p, updated_at: "2026-08-26T09:00:00Z" } : p)),
    ["a", "b"],
  );
  assert.notEqual(antes, depois);
});

test("sync de leadscore muda o carimbo mesmo sem tocar em updated_at", () => {
  // O sync da planilha altera ad_metrics SEM passar por packs.updated_at.
  const antes = computePacksFreshnessStamp(packs, ["b"]);
  const depois = computePacksFreshnessStamp(
    packs.map((p) => (p.id === "b" ? { ...p, sheet_integration: { last_successful_sync_at: "2026-08-26T07:00:00Z" } } : p)),
    ["b"],
  );
  assert.notEqual(antes, depois);
});

test("independe da ordem dos ids selecionados", () => {
  assert.equal(computePacksFreshnessStamp(packs, ["a", "b", "c"]), computePacksFreshnessStamp(packs, ["c", "a", "b"]));
});

test("pack de fora da selecao nao influencia", () => {
  const so_a = computePacksFreshnessStamp(packs, ["a"]);
  const com_b_mudado = computePacksFreshnessStamp(
    packs.map((p) => (p.id === "b" ? { ...p, updated_at: "2030-01-01T00:00:00Z" } : p)),
    ["a"],
  );
  assert.equal(so_a, com_b_mudado);
});

test("pack selecionado que ainda nao chegou ao store muda o carimbo quando chega", () => {
  // Rehidratacao: selectedPackIds ja tem "z", mas a lista de packs ainda nao.
  const antes = computePacksFreshnessStamp(packs, ["a", "z"]);
  const depois = computePacksFreshnessStamp([...packs, { id: "z", updated_at: "2026-08-10T00:00:00Z" }], ["a", "z"]);
  assert.notEqual(antes, depois);
  assert.match(antes, /^n=1\|/);
  assert.match(depois, /^n=2\|/);
});

test("sem selecao ou sem packs devolve vazio; selecao sem correspondencia devolve n=0", () => {
  assert.equal(computePacksFreshnessStamp(packs, []), "");
  assert.equal(computePacksFreshnessStamp([], ["a"]), "");
  assert.equal(computePacksFreshnessStamp(null, ["a"]), "");
  assert.equal(computePacksFreshnessStamp(packs, ["nao-existe"]), "n=0");
});

test("updated_at ausente ou nulo nao quebra nem contamina", () => {
  const stamp = computePacksFreshnessStamp([{ id: "x", updated_at: null }, { id: "y" }], ["x", "y"]);
  assert.equal(stamp, "n=2|r=|s=");
});

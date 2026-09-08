import test from "node:test";
import assert from "node:assert/strict";
import { computePacksContentStamp, computePacksFreshnessStamp } from "../packsFreshness";

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

// ── computePacksContentStamp (carimbo do grafo de conflito) ─────────────────

test("refresh de QUALQUER pack acessivel muda o carimbo de conteudo", () => {
  // O ponto do mecanismo: o refresh do outro membro num pack compartilhado
  // move updated_at -> chave nova -> grafo recalculado sem timer.
  const antes = computePacksContentStamp(packs);
  const depois = computePacksContentStamp(
    packs.map((p) => (p.id === "c" ? { ...p, updated_at: "2026-08-26T09:00:00Z" } : p)),
  );
  assert.notEqual(antes, depois);
});

test("sync de leadscore NAO muda o carimbo de conteudo", () => {
  // Planilha mexe em ad_metrics.leadscore_values, nunca em quem esta no pack.
  // Se entrasse, o grafo recalcularia a cada sync sem poder ter mudado.
  const antes = computePacksContentStamp(packs);
  const depois = computePacksContentStamp(
    packs.map((p) => (p.id === "b" ? { ...p, sheet_integration: { last_successful_sync_at: "2030-01-01T00:00:00Z" } } : p)),
  );
  assert.equal(antes, depois);
});

test("share revogado muda o carimbo mesmo sem mexer no maximo", () => {
  // "c" e o MAIS ANTIGO: tirar ele nao mexe no max(updated_at). Sem o `n=`,
  // a lista encolheria e o carimbo continuaria identico.
  const comTodos = computePacksContentStamp(packs);
  const semC = computePacksContentStamp(packs.filter((p) => p.id !== "c"));
  assert.notEqual(comTodos, semC);
});

test("carimbo de conteudo independe da ordem da lista", () => {
  assert.equal(computePacksContentStamp(packs), computePacksContentStamp([...packs].reverse()));
});

test("lista vazia/nula devolve vazio; updated_at ausente nao quebra", () => {
  assert.equal(computePacksContentStamp([]), "");
  assert.equal(computePacksContentStamp(null), "");
  assert.equal(computePacksContentStamp([{ id: "x", updated_at: null }, { id: "y" }]), "n=2|r=");
});

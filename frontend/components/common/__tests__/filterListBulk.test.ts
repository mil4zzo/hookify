import assert from "node:assert/strict";
import test from "node:test";

import { deselectVisible, deselectVisibleOrdered, selectVisible, selectVisibleOrdered, selectVisibleRespectingConflicts } from "../filterListBulk";

// O caso reportado: 37 packs, busca "EI.31" deixa 7 na tela, nenhum marcado ainda.
const TODOS = ["a1", "a2", "b1", "b2", "b3"] as const;
const VISIVEIS_NA_BUSCA = ["b1", "b2", "b3"] as const;

test("selecionar todos marca só os visíveis, não o universo", () => {
  const resultado = selectVisible(new Set<string>(), [...VISIVEIS_NA_BUSCA]);
  assert.deepEqual([...resultado].sort(), ["b1", "b2", "b3"]);
});

test("selecionar todos preserva o que está marcado fora da busca", () => {
  const resultado = selectVisible(new Set(["a1"]), [...VISIVEIS_NA_BUSCA]);
  assert.deepEqual([...resultado].sort(), ["a1", "b1", "b2", "b3"]);
});

test("limpar remove só os visíveis e mantém o resto marcado", () => {
  const resultado = deselectVisible(new Set(["a1", "a2", "b1", "b3"]), [...VISIVEIS_NA_BUSCA]);
  assert.deepEqual([...resultado].sort(), ["a1", "a2"]);
});

test("sem busca o comportamento histórico continua: todos e nenhum", () => {
  assert.deepEqual([...selectVisible(new Set<string>(), [...TODOS])].sort(), [...TODOS].sort());
  assert.equal(deselectVisible(new Set([...TODOS]), [...TODOS]).size, 0);
});

test("devolve a coleção original por identidade quando nada muda", () => {
  const jaMarcados = new Set(["b1", "b2", "b3"]);
  assert.equal(selectVisible(jaMarcados, [...VISIVEIS_NA_BUSCA]), jaMarcados, "select sem novidade deve preservar a referência");

  const nenhumVisivelMarcado = new Set(["a1"]);
  assert.equal(deselectVisible(nenhumVisivelMarcado, [...VISIVEIS_NA_BUSCA]), nenhumVisivelMarcado, "deselect sem alvo deve preservar a referência");
});

test("lista vazia (busca sem resultado) não mexe na seleção", () => {
  const selecao = new Set(["a1", "b1"]);
  assert.equal(selectVisible(selecao, []), selecao);
  assert.equal(deselectVisible(selecao, []), selecao);
});

test("versão ordenada: novos entram no fim, ordem de escolha preservada", () => {
  assert.deepEqual(selectVisibleOrdered(["b3", "a1"], ["b1", "b2", "b3"]), ["b3", "a1", "b1", "b2"]);
  assert.deepEqual(deselectVisibleOrdered(["b3", "a1", "b1"], ["b1", "b2", "b3"]), ["a1"]);
  const semNovidade = ["b1", "b2"];
  assert.equal(selectVisibleOrdered(semNovidade, ["b1"]), semNovidade);
});

// ── Conflito cross-silo (packs) ─────────────────────────────────────────────
// b1 ↔ b2 conflitam (mesmos anúncios, donos diferentes); b3 é livre.
const CONFLITOS = new Map<string, ReadonlySet<string>>([
  ["b1", new Set(["b2"])],
  ["b2", new Set(["b1"])],
]);

test("conflito: pula quem briga com um pack JÁ selecionado", () => {
  const { next, skipped } = selectVisibleRespectingConflicts(new Set(["b1"]), ["b2", "b3"], CONFLITOS);
  assert.deepEqual([...next].sort(), ["b1", "b3"]);
  assert.deepEqual(skipped, ["b2"]);
});

test("conflito: seleção vazia — pula quem briga com os RECÉM-marcados", () => {
  // O caso que o veto visual do popover não pega: sem nada selecionado, nenhum pack
  // aparece desabilitado, e um select-all ingênuo marcaria b1 E b2 juntos.
  const { next, skipped } = selectVisibleRespectingConflicts(new Set<string>(), ["b1", "b2", "b3"], CONFLITOS);
  assert.deepEqual([...next].sort(), ["b1", "b3"]);
  assert.deepEqual(skipped, ["b2"], "o primeiro da lista visível vence o desempate");
});

test("conflito: desempate segue a ordem da lista visível", () => {
  const { next } = selectVisibleRespectingConflicts(new Set<string>(), ["b2", "b1", "b3"], CONFLITOS);
  assert.deepEqual([...next].sort(), ["b2", "b3"], "invertida a ordem, quem fica é o outro");
});

test("conflito: sem grafo de conflito o resultado é o select-all comum", () => {
  const { next, skipped } = selectVisibleRespectingConflicts(new Set(["a1"]), ["b1", "b2", "b3"], new Map());
  assert.deepEqual([...next].sort(), ["a1", "b1", "b2", "b3"]);
  assert.deepEqual(skipped, []);
});

test("conflito: já marcado não é reportado como pulado nem perde a marcação", () => {
  const jaTem = new Set(["b1", "b2"]); // estado herdado (ex: preferência antiga) — não regredimos
  const { next, skipped } = selectVisibleRespectingConflicts(jaTem, ["b1", "b2"], CONFLITOS);
  assert.equal(next, jaTem, "nada a acrescentar deve preservar a referência");
  assert.deepEqual(skipped, []);
});

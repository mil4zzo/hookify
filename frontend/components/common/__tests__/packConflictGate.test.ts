import assert from "node:assert/strict";
import test from "node:test";

import { selectionIsUnverifiable, vetoForPack } from "../packConflictGate";
import { selectVisibleRespectingConflicts } from "../filterListBulk";

/**
 * O bloqueio de packs sobrepostos FALHA FECHADO (2026-09-09).
 *
 * Contexto que dá sentido a estes testes: desde a migration 145 cada linha de
 * `ad_metrics` pertence a UM pack, então o mesmo anúncio-dia em dois packs são duas
 * linhas e somá-las conta o dia duas vezes. O read-path NÃO deduplica — por decisão
 * ("Por que bloquear e não deduplicar"), e foi de lá que veio o −12% do Manager.
 *
 * Logo o bloqueio é a única proteção, e mapa de conflito vazio POR FALHA não pode
 * ser lido como "não há conflito".
 *
 * SABOTAGENS QUE TÊM DE FAZER ISTO FALHAR (as quatro foram rodadas):
 *   1. `graphUnavailable` ignorado em `vetoForPack`      -> falha em "sem grafo, o segundo pack é vetado"
 *   2. Veto aplicado também a quem já está selecionado   -> falha em "desmarcar continua possível"
 *   3. Corte no primeiro pack em vez de no segundo       -> falha em "sem grafo, o primeiro pack entra"
 *   4. `graphUnavailable` não repassado ao bulk          -> falha em "selecionar todos não passa por cima do grafo indisponível"
 */

const SEM_CONFLITO: ReadonlyMap<string, ReadonlySet<string>> = new Map();
const A_CONFLITA_COM_B: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["a", new Set(["b"])],
  ["b", new Set(["a"])],
]);

// ---------------------------------------------------------------------------
// Comportamento com grafo disponível — o que já existia, e não pode regredir
// ---------------------------------------------------------------------------

test("com grafo, pack sem conflito entra", () => {
  assert.equal(
    vetoForPack({ packId: "x", selected: new Set(["y"]), conflicts: SEM_CONFLITO }),
    null,
  );
});

test("com grafo, pack que conflita com um selecionado é vetado e NOMEIA o par", () => {
  const veto = vetoForPack({ packId: "a", selected: new Set(["b"]), conflicts: A_CONFLITA_COM_B });
  assert.deepEqual(veto, { kind: "conflict", withPackId: "b" });
});

test("desmarcar continua possível: quem já está selecionado nunca é vetado", () => {
  // Vale nas duas situações — com conflito conhecido e com grafo indisponível.
  assert.equal(
    vetoForPack({ packId: "a", selected: new Set(["a", "b"]), conflicts: A_CONFLITA_COM_B }),
    null,
  );
  assert.equal(
    vetoForPack({
      packId: "a",
      selected: new Set(["a", "b"]),
      conflicts: SEM_CONFLITO,
      graphUnavailable: true,
    }),
    null,
  );
});

// ---------------------------------------------------------------------------
// Falha fechada
// ---------------------------------------------------------------------------

test("sem grafo, o primeiro pack entra (um pack sozinho não soma em duplicidade)", () => {
  assert.equal(
    vetoForPack({
      packId: "x",
      selected: new Set<string>(),
      conflicts: SEM_CONFLITO,
      graphUnavailable: true,
    }),
    null,
  );
});

test("sem grafo, o segundo pack é vetado", () => {
  assert.deepEqual(
    vetoForPack({
      packId: "y",
      selected: new Set(["x"]),
      conflicts: SEM_CONFLITO,
      graphUnavailable: true,
    }),
    { kind: "unknown" },
  );
});

test("conflito nomeado tem precedência sobre o 'não sei' — a mensagem útil ganha", () => {
  const veto = vetoForPack({
    packId: "a",
    selected: new Set(["b"]),
    conflicts: A_CONFLITA_COM_B,
    graphUnavailable: true,
  });
  assert.deepEqual(veto, { kind: "conflict", withPackId: "b" });
});

test("com grafo disponível, dois packs sem conflito continuam somáveis", () => {
  // Guarda contra o excesso de zelo: falhar fechado não pode virar "só um pack, sempre".
  assert.equal(
    vetoForPack({ packId: "y", selected: new Set(["x"]), conflicts: SEM_CONFLITO }),
    null,
  );
  assert.equal(selectionIsUnverifiable(["x", "y"], false), false);
});

test("seleção já montada com 2+ packs e sem grafo é inverificável (bloqueia a área)", () => {
  assert.equal(selectionIsUnverifiable(["x", "y"], true), true);
  // Um pack só nunca é inverificável, mesmo sem grafo.
  assert.equal(selectionIsUnverifiable(["x"], true), false);
  assert.equal(selectionIsUnverifiable([], true), false);
});

// ---------------------------------------------------------------------------
// A porta larga: "Selecionar todos" não passa pelo veto visual de item nenhum
// ---------------------------------------------------------------------------

test("selecionar todos não passa por cima do grafo indisponível", () => {
  const { next, skipped } = selectVisibleRespectingConflicts(
    new Set<string>(["x"]),
    ["x", "y", "z"],
    SEM_CONFLITO,
    { graphUnavailable: true },
  );
  assert.deepEqual([...next], ["x"], "nada além do que já estava marcado");
  assert.deepEqual(skipped.sort(), ["y", "z"]);
});

test("selecionar todos com grafo disponível segue marcando tudo que não conflita", () => {
  const { next, skipped } = selectVisibleRespectingConflicts(
    new Set<string>(),
    ["x", "y", "z"],
    SEM_CONFLITO,
  );
  assert.deepEqual([...next].sort(), ["x", "y", "z"]);
  assert.deepEqual(skipped, []);
});

test("selecionar todos com grafo: packs que conflitam ENTRE SI — o de cima vence", () => {
  // O caso que o veto visual não pega: nada selecionado, então nenhum aparece
  // desabilitado; a regra é aplicada contra o acumulado, passo a passo.
  const { next, skipped } = selectVisibleRespectingConflicts(
    new Set<string>(),
    ["a", "b"],
    A_CONFLITA_COM_B,
  );
  assert.deepEqual([...next], ["a"]);
  assert.deepEqual(skipped, ["b"]);
});

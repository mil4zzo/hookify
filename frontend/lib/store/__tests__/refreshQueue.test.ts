import test from "node:test";
import assert from "node:assert/strict";

import { useRefreshQueueStore, selectQueuedCount } from "../refreshQueue";

/**
 * O que estes testes trancam: com a pilha de toasts fechada (expand={false}), quem espera
 * na fila NÃO tem mais card próprio — este store é o único lugar da interface onde esses
 * packs existem. Se ele contar errado, o usuário perde de vista atualizações que estão
 * mesmo rodando, ou vê um "3 na fila" fantasma que nunca sai da tela.
 */

function reset() {
  useRefreshQueueStore.getState().reset();
}

const store = () => useRefreshQueueStore.getState();

test("enqueue → start → finish: item sai da lista e vira contagem", () => {
  reset();
  store().enqueue("p1", "Pack 1");
  store().enqueue("p2", "Pack 2");

  // Dois disparados, nenhum começou: os dois esperam.
  assert.equal(selectQueuedCount(useRefreshQueueStore.getState()), 2);

  store().start("p1");
  // O que roda não é fila — senão o placar prometeria espera que não existe.
  assert.equal(selectQueuedCount(useRefreshQueueStore.getState()), 1);
  assert.equal(store().items.length, 2);

  store().finish("p1", true);
  assert.equal(store().items.length, 1);
  assert.equal(store().doneCount, 1);
  assert.equal(store().failedCount, 0);
});

test("falha conta separado do sucesso", () => {
  reset();
  store().enqueue("p1", "Pack 1");
  store().enqueue("p2", "Pack 2");
  store().enqueue("p3", "Pack 3");

  store().start("p1");
  store().finish("p1", false);
  assert.equal(store().failedCount, 1);
  assert.equal(store().doneCount, 0);

  store().start("p2");
  store().finish("p2", true);
  assert.equal(store().failedCount, 1);
  assert.equal(store().doneCount, 1);
});

test("lote encerrado zera o placar — o próximo lote não herda contagem", () => {
  reset();
  store().enqueue("p1", "Pack 1");
  store().enqueue("p2", "Pack 2");
  store().start("p1");
  store().finish("p1", true);
  store().start("p2");
  store().finish("p2", false);

  assert.equal(store().items.length, 0);
  assert.equal(store().doneCount, 0);
  assert.equal(store().failedCount, 0);
});

test("dropQueued devolve só quem ainda espera e nunca mata o que está rodando", () => {
  reset();
  store().enqueue("p1", "Pack 1");
  store().enqueue("p2", "Pack 2");
  store().enqueue("p3", "Pack 3");
  store().start("p1");

  const dropped = store().dropQueued();

  assert.deepEqual(
    dropped.map((i) => i.packId),
    ["p2", "p3"],
  );
  // p1 continua: "Cancelar fila" não cancela a atualização em andamento.
  assert.deepEqual(
    store().items.map((i) => i.packId),
    ["p1"],
  );
  assert.equal(selectQueuedCount(useRefreshQueueStore.getState()), 0);
});

test("finish de pack já removido não conta duas vezes", () => {
  reset();
  store().enqueue("p1", "Pack 1");
  store().enqueue("p2", "Pack 2");
  store().start("p1");
  store().dropQueued(); // p2 cancelado na fila

  // A task de p2 ainda drena e cai no finally: não pode virar "+1 ok".
  store().finish("p2", true);
  assert.equal(store().doneCount, 0);
  assert.deepEqual(
    store().items.map((i) => i.packId),
    ["p1"],
  );
});

test("enqueue duplicado do mesmo pack não infla a fila", () => {
  reset();
  store().enqueue("p1", "Pack 1");
  store().enqueue("p1", "Pack 1");
  assert.equal(store().items.length, 1);
});

test("cancelar a fila inteira com nada rodando limpa o placar", () => {
  reset();
  store().enqueue("p1", "Pack 1");
  store().enqueue("p2", "Pack 2");
  store().finish("p1", true); // some sozinho antes de começar (caminho defensivo)
  store().dropQueued();

  assert.equal(store().items.length, 0);
  assert.equal(store().doneCount, 0);
});

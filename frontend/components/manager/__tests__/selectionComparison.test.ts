import assert from "node:assert/strict";
import test from "node:test";

import { orderSelectedFirst } from "@/lib/manager/selectionComparison";

const isSelected = (row: string) => row.startsWith("*");

test("orderSelectedFirst leva os selecionados ao topo preservando a ordem de cada grupo", () => {
  // A tabela está ordenada por gasto; o pin não pode reordenar DENTRO do grupo, senão o
  // usuário perde a ordenação que escolheu.
  const rows = ["a", "*b", "c", "*d", "e"];

  assert.deepEqual(orderSelectedFirst(rows, isSelected), ["*b", "*d", "a", "c", "e"]);
});

test("orderSelectedFirst devolve o MESMO array quando já está ordenado assim", () => {
  // Identidade referencial não é detalhe: o consumidor é um useMemo que alimenta o
  // virtualizador. Array novo a cada render = linhas remontadas à toa.
  const nenhumSelecionado = ["a", "b", "c"];
  const todosSelecionados = ["*a", "*b", "*c"];
  const jaNoTopo = ["*a", "*b", "c", "d"];
  const vazio: string[] = [];

  assert.equal(orderSelectedFirst(nenhumSelecionado, isSelected), nenhumSelecionado);
  assert.equal(orderSelectedFirst(todosSelecionados, isSelected), todosSelecionados);
  assert.equal(orderSelectedFirst(jaNoTopo, isSelected), jaNoTopo);
  assert.equal(orderSelectedFirst(vazio, isSelected), vazio);
});

test("orderSelectedFirst reordena quando um selecionado aparece depois de um não-selecionado", () => {
  const rows = ["a", "*b"];
  const out = orderSelectedFirst(rows, isSelected);

  assert.notEqual(out, rows);
  assert.deepEqual(out, ["*b", "a"]);
});

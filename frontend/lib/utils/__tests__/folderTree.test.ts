/**
 * Árvore de pastas (migration 174): contagem com subpastas, busca que mantém as
 * pastas de cima, e o plano de movimento que nunca manda uma pasta para dentro
 * de si mesma.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AdsPack, PackFolder } from "@/lib/types";
import { buildFolderTree, filterFolderTree, flattenTree, folderPath, planFolderMove } from "../folderTree";

const folder = (id: string, parent: string | null, position: number): PackFolder => ({ id, name: id, parent_id: parent, position });
const pack = (id: string, spend = 0) => ({ id, name: id, stats: { totalSpend: spend } }) as unknown as AdsPack;

// A[ A1[ A1a ], A2 ]  B
const FOLDERS = [folder("A", null, 0), folder("B", null, 1), folder("A1", "A", 0), folder("A2", "A", 1), folder("A1a", "A1", 0)];
const PACKS = [pack("p-A", 10), pack("p-A1a", 5), pack("p-B", 1), pack("solto", 2)];
const MEMBERS = { "p-A": "A", "p-A1a": "A1a", "p-B": "B" };

test("contagem e gasto da pasta incluem as subpastas", () => {
  const { byId, loose } = buildFolderTree(FOLDERS, PACKS, MEMBERS);
  const a = byId.get("A")!;
  assert.deepEqual(a.packs.map((p) => p.id), ["p-A"]);
  assert.deepEqual(a.allPacks.map((p) => p.id).sort(), ["p-A", "p-A1a"]);
  assert.equal(a.totalSpend, 15);
  assert.deepEqual(loose.map((p) => p.id), ["solto"]);
});

test("ordem desenhada: pai, depois filhos, na posição de cada grupo", () => {
  const { roots } = buildFolderTree(FOLDERS, PACKS, MEMBERS);
  assert.deepEqual(flattenTree(roots).map((n) => n.folder.id), ["A", "A1", "A1a", "A2", "B"]);
  assert.equal(flattenTree(roots).find((n) => n.folder.id === "A1a")!.depth, 2);
});

test("pai que não veio (apagado em outra aba) sobe para a raiz, não some", () => {
  const { roots } = buildFolderTree([folder("X", "fantasma", 0)], [], {});
  assert.deepEqual(roots.map((n) => n.folder.id), ["X"]);
});

test("ciclo vindo do servidor não trava a montagem", () => {
  const { roots } = buildFolderTree([folder("X", "Y", 0), folder("Y", "X", 1)], [], {});
  assert.deepEqual(flattenTree(roots).map((n) => n.folder.id).sort(), ["X", "Y"]);
});

test("busca: resultado fundo mantém as pastas acima, com a contagem dos resultados", () => {
  const { roots } = buildFolderTree(FOLDERS, PACKS, MEMBERS);
  const filtered = filterFolderTree(roots, (p) => p.id === "p-A1a", () => false);
  assert.deepEqual(flattenTree(filtered).map((n) => n.folder.id), ["A", "A1", "A1a"]);
  assert.equal(filtered[0].allPacks.length, 1);
  assert.equal(filtered[0].packs.length, 0);
});

test("busca: pasta que casa pelo nome vem com o conteúdo inteiro", () => {
  const { roots } = buildFolderTree(FOLDERS, PACKS, MEMBERS);
  const filtered = filterFolderTree(roots, () => false, (f) => f.id === "A1");
  assert.deepEqual(flattenTree(filtered).map((n) => n.folder.id), ["A", "A1", "A1a"]);
  assert.equal(flattenTree(filtered).find((n) => n.folder.id === "A1")!.allPacks.length, 1);
});

test("caminho da raiz até a pasta", () => {
  const { byId } = buildFolderTree(FOLDERS, PACKS, MEMBERS);
  assert.deepEqual(folderPath(byId, "A1a").map((n) => n.folder.id), ["A", "A1", "A1a"]);
  assert.deepEqual(folderPath(byId, null), []);
});

test("mover para dentro de si mesma ou de uma descendente é recusado", () => {
  assert.equal(planFolderMove(FOLDERS, "A", "A1a", "inside"), null);
  assert.equal(planFolderMove(FOLDERS, "A", "A1", "before"), null);
  assert.equal(planFolderMove(FOLDERS, "A", "A", "inside"), null);
});

test("soltar dentro põe no fim dos filhos do alvo", () => {
  assert.deepEqual(planFolderMove(FOLDERS, "B", "A", "inside"), { parentId: "A", siblingIds: ["A1", "A2", "B"] });
});

test("soltar antes de uma subpasta muda de nível", () => {
  assert.deepEqual(planFolderMove(FOLDERS, "B", "A2", "before"), { parentId: "A", siblingIds: ["A1", "B", "A2"] });
});

test("subir para a raiz, depois da pasta de cima", () => {
  assert.deepEqual(planFolderMove(FOLDERS, "A1a", "A", "after"), { parentId: null, siblingIds: ["A", "A1a", "B"] });
});

test("soltar onde já estava não é movimento", () => {
  assert.equal(planFolderMove(FOLDERS, "A2", "A1", "after"), null);
  assert.equal(planFolderMove(FOLDERS, "A2", "A", "inside"), null);
});

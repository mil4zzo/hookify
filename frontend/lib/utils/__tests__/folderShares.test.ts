/**
 * Pasta compartilhada (migration 181) — o aviso da tela antes do gesto. Espelha a
 * regra do banco: por pessoa, vale a pasta compartilhada mais próxima do pack.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { FolderShareEntry, PackFolder } from "@/lib/types";
import {
  absorbedDirect,
  canEditFolder,
  canMovePack,
  canPlaceFolder,
  canRedefinePack,
  canRestructureFolder,
  describePeople,
  diffGrantees,
  effectiveGrantees,
  folderDissolveImpact,
  folderMoveImpact,
  isEmptyDelta,
  packMoveDelta,
  returningPacks,
} from "../folderShares";

const folder = (id: string, parent: string | null): PackFolder => ({ id, name: id, parent_id: parent, position: 0 });
const share = (folder_id: string, grantee_id: string, role: "editor" | "viewer", display_name: string | null = grantee_id): FolderShareEntry => ({
  folder_id,
  grantee_id,
  role,
  display_name,
});

// R[ S[ T ] ]   X (raiz, sem compartilhamento)
const FOLDERS = [folder("R", null), folder("S", "R"), folder("T", "S"), folder("X", null)];
const SHARES = [share("R", "ana", "editor", "Ana")];

test("quem mora numa subpasta herda a pasta de cima; a raiz e a pasta solta não têm ninguém", () => {
  assert.deepEqual([...effectiveGrantees(FOLDERS, SHARES, "T").keys()], ["ana"]);
  assert.deepEqual([...effectiveGrantees(FOLDERS, SHARES, "R").keys()], ["ana"]);
  assert.equal(effectiveGrantees(FOLDERS, SHARES, "X").size, 0);
  assert.equal(effectiveGrantees(FOLDERS, SHARES, null).size, 0);
});

test("a pasta mais próxima vale: a subpasta aperta o papel da pasta de cima", () => {
  const shares = [share("R", "ana", "editor"), share("S", "ana", "viewer")];
  assert.equal(effectiveGrantees(FOLDERS, shares, "T").get("ana")!.role, "viewer");
  assert.equal(effectiveGrantees(FOLDERS, shares, "T").get("ana")!.source_folder_id, "S");
  assert.equal(effectiveGrantees(FOLDERS, shares, "R").get("ana")!.role, "editor");
});

test("pessoas diferentes em níveis diferentes se somam", () => {
  const shares = [share("R", "ana", "editor"), share("S", "bia", "viewer")];
  assert.deepEqual([...effectiveGrantees(FOLDERS, shares, "T").keys()].sort(), ["ana", "bia"]);
  assert.deepEqual([...effectiveGrantees(FOLDERS, shares, "R").keys()], ["ana"]);
});

test("ciclo corrompido não trava a subida", () => {
  const cyclic = [folder("A", "B"), folder("B", "A")];
  assert.equal(effectiveGrantees(cyclic, [share("B", "ana", "editor")], "A").size, 1);
});

test("mover pack: entrar numa pasta compartilhada concede, sair retira, trocar de papel muda", () => {
  const entering = packMoveDelta(FOLDERS, SHARES, null, "S");
  assert.deepEqual(entering.granted.map((g) => g.grantee_id), ["ana"]);
  assert.equal(entering.revoked.length, 0);

  const leaving = packMoveDelta(FOLDERS, SHARES, "T", "X");
  assert.deepEqual(leaving.revoked.map((g) => g.grantee_id), ["ana"]);

  const shares = [share("R", "ana", "editor"), share("X", "ana", "viewer")];
  const switching = packMoveDelta(FOLDERS, shares, "S", "X");
  assert.deepEqual(switching.changed.map((g) => [g.grantee_id, g.role]), [["ana", "viewer"]]);
});

test("mover dentro da mesma cadeia compartilhada, ou entre pastas sem compartilhamento, não muda nada", () => {
  assert.ok(isEmptyDelta(packMoveDelta(FOLDERS, SHARES, "S", "T")));
  assert.ok(isEmptyDelta(packMoveDelta(FOLDERS, SHARES, null, "X")));
  assert.ok(isEmptyDelta(packMoveDelta(FOLDERS, SHARES, "T", "T")));
});

test("diffGrantees separa concedido, retirado e papel trocado", () => {
  const a = effectiveGrantees(FOLDERS, [share("R", "ana", "editor"), share("R", "bia", "viewer")], "R");
  const b = effectiveGrantees(FOLDERS, [share("X", "ana", "viewer"), share("X", "caio", "editor")], "X");
  const delta = diffGrantees(a, b);
  assert.deepEqual(delta.granted.map((g) => g.grantee_id), ["caio"]);
  assert.deepEqual(delta.revoked.map((g) => g.grantee_id), ["bia"]);
  assert.deepEqual(delta.changed.map((g) => g.grantee_id), ["ana"]);
});

test("mover pasta com packs para dentro de uma compartilhada concede a todos os packs dela", () => {
  const owned = (id: string) => (id === "X" ? 3 : 0);
  const impact = folderMoveImpact(FOLDERS, SHARES, "X", "S", owned);
  assert.deepEqual(impact.delta.granted.map((g) => g.grantee_id), ["ana"]);
  assert.equal(impact.packCount, 3);
});

test("mover pasta compartilhada para fora retira; pasta sem pack próprio não conta", () => {
  const owned = (id: string) => (id === "T" ? 2 : 0);
  const out = folderMoveImpact(FOLDERS, SHARES, "S", null, owned);
  assert.deepEqual(out.delta.revoked.map((g) => g.grantee_id), ["ana"]);
  assert.equal(out.packCount, 2);
  assert.equal(folderMoveImpact(FOLDERS, SHARES, "S", null, () => 0).packCount, 0);
});

test("mover pasta sem nenhum compartilhamento no caminho não avisa", () => {
  assert.ok(isEmptyDelta(folderMoveImpact(FOLDERS, [], "S", null, () => 5).delta));
  assert.ok(isEmptyDelta(folderMoveImpact(FOLDERS, SHARES, "X", null, () => 5).delta));
});

test("desfazer a pasta compartilhada tira o acesso dos packs dela e das subpastas", () => {
  // R é a compartilhada e está na raiz: ao desfazer, p(R) fica solto e S sobe para a raiz.
  const owned = (id: string) => (id === "R" ? 1 : id === "T" ? 2 : 0);
  const impact = folderDissolveImpact(FOLDERS, SHARES, "R", owned);
  assert.deepEqual(impact.delta.revoked.map((g) => g.grantee_id), ["ana"]);
  assert.equal(impact.packCount, 3);
});

test("desfazer uma subpasta de uma compartilhada não tira ninguém: os packs sobem para dentro dela", () => {
  const impact = folderDissolveImpact(FOLDERS, SHARES, "S", (id) => (id === "S" || id === "T" ? 2 : 0));
  assert.ok(isEmptyDelta(impact.delta));
  assert.equal(impact.packCount, 0);
});

test("desfazer pasta sem compartilhamento não avisa", () => {
  assert.ok(isEmptyDelta(folderDissolveImpact(FOLDERS, [], "R", () => 5).delta));
  assert.ok(isEmptyDelta(folderDissolveImpact(FOLDERS, SHARES, "X", () => 5).delta));
});

test("absorção: o convite direto de quem a pasta passa a cobrir, com aviso de papel trocado", () => {
  const direct = [
    { pack_id: "p1", grantee_id: "ana", role: "editor" as const },
    { pack_id: "p2", grantee_id: "ana", role: "viewer" as const },
    { pack_id: "p9", grantee_id: "ana", role: "editor" as const }, // fora do gesto
    { pack_id: "p1", grantee_id: "bia", role: "viewer" as const }, // bia não é coberta
  ];
  const covering = [{ grantee_id: "ana", display_name: "Ana", role: "viewer" as const, source_folder_id: "R" }];
  const out = absorbedDirect(direct, ["p1", "p2"], covering);
  assert.equal(out.length, 1);
  assert.equal(out[0].packCount, 2);
  assert.equal(out[0].roleChanges, true);
  assert.deepEqual(absorbedDirect(direct, ["p2"], covering).map((a) => a.roleChanges), [false]);
  assert.deepEqual(absorbedDirect([], ["p1"], covering), []);
});

// Árvore do DONO (o) compartilhada com o usuário: R (editor) > S (editor) > V (viewer, subpasta apertada).
// Árvore do próprio usuário: M.
const shared = (id: string, parent: string | null, access: "editor" | "viewer", root = false): PackFolder => ({
  id, name: id, parent_id: parent, position: 0, access, owner_id: "o", shared_root: root,
});
const TREE: PackFolder[] = [
  shared("R", null, "editor", true),
  shared("S", "R", "editor"),
  shared("V", "S", "viewer"),
  { id: "M", name: "M", parent_id: null, position: 0, access: "dono", owner_id: "eu" },
];
const at = (id: string | null) => (id ? TREE.find((f) => f.id === id)! : null);

test("editar pasta: dono e editor sim, leitura não", () => {
  assert.equal(canEditFolder(at("R")), true);
  assert.equal(canEditFolder(at("M")), true);
  assert.equal(canEditFolder(at("V")), false);
  // Pasta de antes da 181, sem `access`: é do usuário.
  assert.equal(canEditFolder(folder("X", null)), true);
});

test("mover ou desfazer: a raiz compartilhada só o dono; dentro dela, quem edita a de cima", () => {
  assert.equal(canRestructureFolder(TREE, at("R")!), false);
  assert.equal(canRestructureFolder(TREE, at("S")!), true);
  assert.equal(canRestructureFolder(TREE, at("V")!), true); // editor em S, a de cima
  assert.equal(canRestructureFolder(TREE, at("M")!), true);
});

test("pôr pasta: editor só dentro do que edita, na mesma árvore; dono só na dele", () => {
  assert.equal(canPlaceFolder(TREE, "V", "R"), true);
  assert.equal(canPlaceFolder(TREE, "V", null), false); // raiz do usuário: fora da árvore do dono
  assert.equal(canPlaceFolder(TREE, "S", "M"), false); // para a árvore do usuário
  assert.equal(canPlaceFolder(TREE, "S", "V"), false); // V é só leitura
  assert.equal(canPlaceFolder(TREE, "M", "R"), false); // pasta do usuário para a árvore do dono
  assert.equal(canPlaceFolder(TREE, "M", null), true);
  assert.equal(canPlaceFolder(TREE, "R", "S"), false); // a raiz compartilhada não se move
});

test("mover pack: espelho da RPC", () => {
  // Pack do dono, dentro da pasta compartilhada: circula por onde o usuário edita.
  assert.equal(canMovePack(false, at("R"), at("S")), true);
  assert.equal(canMovePack(false, at("R"), at("V")), false); // destino só leitura
  assert.equal(canMovePack(false, at("V"), at("S")), false); // origem só leitura
  assert.equal(canMovePack(false, at("R"), at("M")), false); // não sai para a árvore do usuário
  assert.equal(canMovePack(false, at("R"), null), true); // editor tira da pasta
  assert.equal(canMovePack(false, at("V"), null), false); // leitura não tira
  // Pack do próprio usuário: entra na pasta compartilhada e sai dela quando quiser.
  assert.equal(canMovePack(true, null, at("S")), true);
  assert.equal(canMovePack(true, at("M"), at("R")), true);
  assert.equal(canMovePack(true, at("V"), at("M")), true);
  assert.equal(canMovePack(true, at("V"), null), true);
  // Pack de terceiro (compartilhado com o usuário direto): só na árvore dele.
  assert.equal(canMovePack(false, null, at("M")), true);
  assert.equal(canMovePack(false, at("M"), at("R")), false);
  assert.equal(canMovePack(false, null, at("R")), false);
});

test("redefinir o pack (nome, período, excluir): dono ou editor da pasta, nunca editor por convite direto", () => {
  assert.equal(canRedefinePack({ shared_role: null }), true);
  assert.equal(canRedefinePack({ shared_role: "editor", shared_via_folder: true }), true);
  assert.equal(canRedefinePack({ shared_role: "editor", shared_via_folder: false }), false);
  assert.equal(canRedefinePack({ shared_role: "viewer", shared_via_folder: true }), false);
});

test("pack posto pelo editor volta para ele quando o lugar novo sai do alcance dele", () => {
  // Ana edita R. O pack dela está em S (dentro de R).
  const shares = [share("R", "ana", "editor")];
  const placement = [{ packId: "pa", ownerId: "ana", folderId: "S" }];
  assert.deepEqual(returningPacks(FOLDERS, shares, placement), []);
  // S levada para a raiz: Ana não a vê mais.
  const moved = FOLDERS.map((f) => (f.id === "S" ? { ...f, parent_id: null } : f));
  assert.deepEqual(returningPacks(moved, shares, placement), ["pa"]);
  // Tirado de qualquer pasta (sem lugar), ou levado para X: volta.
  assert.deepEqual(returningPacks(FOLDERS, shares, [{ ...placement[0], folderId: null }]), ["pa"]);
  assert.deepEqual(returningPacks(FOLDERS, shares, [{ ...placement[0], folderId: "X" }]), ["pa"]);
  // Leitura também é enxergar: fica.
  assert.deepEqual(returningPacks(FOLDERS, [share("R", "ana", "viewer")], placement), []);
});

test("nomes das pessoas", () => {
  const p = (display_name: string | null) => ({ display_name });
  assert.equal(describePeople([]), "");
  assert.equal(describePeople([p("Ana")]), "Ana");
  assert.equal(describePeople([p("Ana"), p("Bia")]), "Ana e Bia");
  assert.equal(describePeople([p("Ana"), p("Bia"), p("Caio"), p("Duda")]), "Ana, Bia e mais 2");
  assert.equal(describePeople([p("Ana"), p(null)]), "2 pessoas");
});

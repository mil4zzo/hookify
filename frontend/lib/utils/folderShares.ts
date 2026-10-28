import type { AdsPack, DirectShareEntry, FolderShareEntry, PackFolder } from "@/lib/types";

/**
 * Pasta compartilhada (migration 181) — o lado da tela.
 *
 * Quem concede e retira o acesso é o banco. Esta é a MESMA regra espelhada para a tela
 * poder avisar ANTES do gesto ("este pack vai ficar visível para Ana") sem uma ida ao
 * servidor: por pessoa, vale a pasta compartilhada MAIS PRÓXIMA do pack (a própria pasta
 * onde ele mora, depois a de cima, e assim por diante).
 *
 * É só aviso. Se divergir do banco, o dono vê um texto impreciso, nunca acesso errado.
 */

export interface EffectiveGrantee {
  grantee_id: string;
  display_name: string | null;
  role: "editor" | "viewer";
  /** Pasta compartilhada que dá este acesso (a mais próxima). */
  source_folder_id: string;
}

export type GranteeMap = Map<string, EffectiveGrantee>;

export interface AccessDelta {
  /** Passam a ter acesso. */
  granted: EffectiveGrantee[];
  /** Deixam de ter acesso. */
  revoked: EffectiveGrantee[];
  /** Continuam com acesso, em outro papel (mostra o papel NOVO). */
  changed: EffectiveGrantee[];
}

export const EMPTY_DELTA: AccessDelta = { granted: [], revoked: [], changed: [] };

export const isEmptyDelta = (delta: AccessDelta) => delta.granted.length + delta.revoked.length + delta.changed.length === 0;

/** Quem tem acesso a um pack que mora em `folderId`. Raiz (`null`) ou pasta sem compartilhamento: ninguém. */
export function effectiveGrantees(folders: PackFolder[], shares: FolderShareEntry[], folderId: string | null): GranteeMap {
  const result: GranteeMap = new Map();
  if (!folderId || shares.length === 0) return result;

  const parentOf = new Map(folders.map((f) => [f.id, f.parent_id ?? null]));
  const byFolder = new Map<string, FolderShareEntry[]>();
  shares.forEach((s) => byFolder.set(s.folder_id, [...(byFolder.get(s.folder_id) || []), s]));

  const seen = new Set<string>();
  let current: string | null = folderId;
  while (current && !seen.has(current)) {
    seen.add(current);
    (byFolder.get(current) || []).forEach((s) => {
      // A mais próxima chega primeiro: quem já está no mapa não é sobrescrito.
      if (!result.has(s.grantee_id)) {
        result.set(s.grantee_id, { grantee_id: s.grantee_id, display_name: s.display_name ?? null, role: s.role, source_folder_id: current as string });
      }
    });
    current = parentOf.get(current) ?? null;
  }
  return result;
}

/** Diferença entre dois mapas de acesso, por pessoa. */
export function diffGrantees(before: GranteeMap, after: GranteeMap): AccessDelta {
  const delta: AccessDelta = { granted: [], revoked: [], changed: [] };
  after.forEach((now, id) => {
    const prev = before.get(id);
    if (!prev) delta.granted.push(now);
    else if (prev.role !== now.role) delta.changed.push(now);
  });
  before.forEach((prev, id) => {
    if (!after.has(id)) delta.revoked.push(prev);
  });
  return delta;
}

/** Mover packs de `from` para `to`: o que muda de acesso. Mesma pasta ou nenhuma das duas compartilhada: nada. */
export function packMoveDelta(folders: PackFolder[], shares: FolderShareEntry[], fromFolderId: string | null, toFolderId: string | null): AccessDelta {
  if (fromFolderId === toFolderId) return EMPTY_DELTA;
  return diffGrantees(effectiveGrantees(folders, shares, fromFolderId), effectiveGrantees(folders, shares, toFolderId));
}

export interface FolderMoveImpact {
  delta: AccessDelta;
  /** Packs (do ator) cujo acesso muda. */
  packCount: number;
}

function subtreeOf(folders: PackFolder[], folderId: string): string[] {
  const children = new Map<string, string[]>();
  folders.forEach((f) => {
    if (f.parent_id) children.set(f.parent_id, [...(children.get(f.parent_id) || []), f.id]);
  });
  const out: string[] = [];
  const visit = (id: string) => {
    if (out.includes(id)) return;
    out.push(id);
    (children.get(id) || []).forEach(visit);
  };
  visit(folderId);
  return out;
}

/**
 * Soma o efeito pasta a pasta: cada pasta com pack próprio é comparada antes e depois, e
 * as pessoas são unidas (a mesma pessoa pode ganhar num pack e perder noutro).
 * `ownedPackCount(folderId)` = packs DIRETOS da pasta que são do ator: pack alheio não
 * entra em compartilhamento de pasta, então não conta.
 */
function aggregateImpact(
  folderIds: string[],
  ownedPackCount: (folderId: string) => number,
  deltaFor: (folderId: string) => AccessDelta,
): FolderMoveImpact {
  const merged: AccessDelta = { granted: [], revoked: [], changed: [] };
  const add = (list: EffectiveGrantee[], item: EffectiveGrantee) => {
    if (!list.some((x) => x.grantee_id === item.grantee_id)) list.push(item);
  };
  let packCount = 0;
  folderIds.forEach((id) => {
    const owned = ownedPackCount(id);
    if (owned === 0) return;
    const delta = deltaFor(id);
    if (isEmptyDelta(delta)) return;
    packCount += owned;
    delta.granted.forEach((g) => add(merged.granted, g));
    delta.revoked.forEach((g) => add(merged.revoked, g));
    delta.changed.forEach((g) => add(merged.changed, g));
  });
  return { delta: merged, packCount };
}

/**
 * Mover uma pasta para outro pai arrasta a subárvore inteira para dentro/fora de uma
 * cadeia de pastas compartilhadas.
 */
export function folderMoveImpact(
  folders: PackFolder[],
  shares: FolderShareEntry[],
  folderId: string,
  newParentId: string | null,
  ownedPackCount: (folderId: string) => number,
): FolderMoveImpact {
  if (shares.length === 0) return { delta: EMPTY_DELTA, packCount: 0 };
  const after = folders.map((f) => (f.id === folderId ? { ...f, parent_id: newParentId } : f));
  return aggregateImpact(subtreeOf(folders, folderId), ownedPackCount, (id) =>
    diffGrantees(effectiveGrantees(folders, shares, id), effectiveGrantees(after, shares, id)),
  );
}

/**
 * Desfazer a pasta: os packs dela e as subpastas sobem um nível. O compartilhamento DELA
 * termina (a pasta deixa de existir); o das pastas de cima continua valendo.
 */
export function folderDissolveImpact(
  folders: PackFolder[],
  shares: FolderShareEntry[],
  folderId: string,
  ownedPackCount: (folderId: string) => number,
): FolderMoveImpact {
  const target = folders.find((f) => f.id === folderId);
  if (!target || shares.length === 0) return { delta: EMPTY_DELTA, packCount: 0 };
  const parent = target.parent_id ?? null;
  const afterFolders = folders.filter((f) => f.id !== folderId).map((f) => (f.parent_id === folderId ? { ...f, parent_id: parent } : f));
  const afterShares = shares.filter((s) => s.folder_id !== folderId);
  return aggregateImpact(subtreeOf(folders, folderId), ownedPackCount, (id) =>
    // Os packs da própria pasta passam a morar na de cima; os das subpastas continuam onde estão.
    diffGrantees(effectiveGrantees(folders, shares, id), effectiveGrantees(afterFolders, afterShares, id === folderId ? parent : id)),
  );
}

/** "Ana", "Ana e Bruno", "Ana, Bruno e mais 2". Sem nome: "N pessoas". */
export function describePeople(people: Pick<EffectiveGrantee, "display_name">[]): string {
  if (people.length === 0) return "";
  const names = people.map((p) => p.display_name?.trim()).filter((n): n is string => !!n);
  if (names.length !== people.length) return `${people.length} ${people.length === 1 ? "pessoa" : "pessoas"}`;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names[0]}, ${names[1]} e mais ${names.length - 2}`;
}

/** Quantas pessoas têm acesso por esta pasta (a própria + as de cima), para o selo na árvore. */
export function folderGranteeCount(folders: PackFolder[], shares: FolderShareEntry[], folderId: string): number {
  return effectiveGrantees(folders, shares, folderId).size;
}

/**
 * Acesso direto que a pasta ABSORVE ao cobrir a pessoa: "dentro da pasta, tudo segue a
 * pasta" (181). Para cada pessoa que passa a ter acesso pela pasta, quantos destes packs
 * ela já via por convite direto — e o papel desse convite, que dá lugar ao da pasta.
 */
export interface AbsorbedDirect {
  grantee: EffectiveGrantee;
  packCount: number;
  /** Algum convite direto tinha papel diferente do da pasta. */
  roleChanges: boolean;
}

export function absorbedDirect(directShares: DirectShareEntry[], packIds: string[], covering: EffectiveGrantee[]): AbsorbedDirect[] {
  if (directShares.length === 0 || covering.length === 0) return [];
  const wanted = new Set(packIds);
  return covering
    .map((grantee) => {
      const hits = directShares.filter((d) => d.grantee_id === grantee.grantee_id && wanted.has(d.pack_id));
      return { grantee, packCount: hits.length, roleChanges: hits.some((d) => d.role !== grantee.role) };
    })
    .filter((a) => a.packCount > 0);
}

// ── O que cada um pode fazer na árvore (espelho das RPCs da 181) ─────────────
//
// Mesma ideia do aviso acima: o banco decide e recusa; a tela só evita oferecer o
// gesto que seria recusado (arrasto que não cai, item de menu que não existe). Se
// divergir, o pior caso é um toast de erro, nunca acesso errado.

/** A pasta é da árvore do próprio usuário (ou veio de antes da 181, sem `access`). */
export const isOwnFolder = (folder: Pick<PackFolder, "access"> | null | undefined) => !!folder && (!folder.access || folder.access === "dono");

/** Renomear, criar subpasta, receber packs: dono ou editor. */
export const canEditFolder = (folder: Pick<PackFolder, "access"> | null | undefined) => !!folder && folder.access !== "viewer";

/**
 * Mover ou desfazer a pasta: o dono, ou o editor da pasta DE CIMA. A pasta compartilhada
 * com a pessoa (a raiz do que ela vê) só o dono move ou desfaz.
 */
export function canRestructureFolder(folders: PackFolder[], folder: PackFolder): boolean {
  if (isOwnFolder(folder)) return true;
  if (folder.shared_root || !folder.parent_id) return false;
  const parent = folders.find((f) => f.id === folder.parent_id);
  return parent?.access === "editor";
}

const sameTree = (a: PackFolder, b: PackFolder) => (a.owner_id ?? null) === (b.owner_id ?? null);

/**
 * A pasta `movingId` pode ir para `parentId` (null = raiz)? Do dono: para qualquer lugar
 * da árvore dele. Do editor: só para dentro de outra pasta que ele edita, na mesma árvore.
 */
export function canPlaceFolder(folders: PackFolder[], movingId: string, parentId: string | null): boolean {
  const moving = folders.find((f) => f.id === movingId);
  if (!moving || !canRestructureFolder(folders, moving)) return false;
  const parent = parentId ? folders.find((f) => f.id === parentId) : null;
  if (isOwnFolder(moving)) return parent === null || isOwnFolder(parent);
  return !!parent && parent.access === "editor" && sameTree(moving, parent);
}

/**
 * Redefinir o pack (renomear, mudar o período, excluir): o dono, ou o editor que o
 * recebeu por uma pasta compartilhada — na pasta, ele age como o dono (181). Editor
 * por convite direto só calibra.
 */
export const canRedefinePack = (pack: Pick<AdsPack, "shared_role" | "shared_via_folder">) =>
  !pack.shared_role || (!!pack.shared_via_folder && pack.shared_role === "editor");

/** Onde um pack posto por OUTRA pessoa mora na árvore do usuário (pasta compartilhada). */
export interface ForeignPlacement {
  packId: string;
  ownerId: string;
  folderId: string | null;
}

/**
 * Pack que o editor pôs na pasta só fica onde ELE enxerga (181): os que, no estado
 * `after`, caem numa pasta que quem os criou não vê voltam para ele. Para o aviso
 * antes de mover/desfazer uma pasta.
 */
export function returningPacks(after: PackFolder[], afterShares: FolderShareEntry[], placements: ForeignPlacement[]): string[] {
  return placements.filter((p) => !p.folderId || !effectiveGrantees(after, afterShares, p.folderId).has(p.ownerId)).map((p) => p.packId);
}

/**
 * O pack pode ir de `current` para `target` (null = tirar da pasta)? Espelho de
 * `move_packs_to_folder`:
 *   - dentro da mesma pasta compartilhada: editor na origem (ou o pack é do usuário);
 *   - para dentro de uma pasta compartilhada vindo de fora: só pack do usuário;
 *   - na árvore do próprio usuário: qualquer pack que ele vê.
 */
export function canMovePack(isOwnPack: boolean, current: PackFolder | null, target: PackFolder | null): boolean {
  const currentShared = !!current && !isOwnFolder(current);
  if (target === null) return !currentShared || current!.access === "editor" || isOwnPack;
  if (!canEditFolder(target)) return false;
  if (currentShared && sameTree(current!, target)) return current!.access === "editor" || isOwnPack;
  if (isOwnPack) return true;
  return !currentShared && isOwnFolder(target);
}

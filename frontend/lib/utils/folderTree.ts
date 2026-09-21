import type { AdsPack, PackFolder, PackFolderMembers } from "@/lib/types";

/**
 * Uma pasta com o que está nela. `packs` são os DIRETOS; `allPacks` inclui os de
 * todas as subpastas — é o que a contagem, o gasto e o "Atualizar todos" usam
 * (decisão de produto: a pasta de cima responde pelo conteúdo inteiro).
 */
export interface FolderBucket {
  folder: PackFolder;
  packs: AdsPack[];
  children: FolderBucket[];
  allPacks: AdsPack[];
  totalSpend: number;
  hasSheet: boolean;
  hasShared: boolean;
  depth: number;
}

export type FolderDropEdge = "before" | "after" | "inside";

const byOrder = (a: PackFolder, b: PackFolder) => a.position - b.position || a.name.localeCompare(b.name, "pt-BR");

function summarize(folder: PackFolder, packs: AdsPack[], children: FolderBucket[], depth: number): FolderBucket {
  const allPacks = [...children.flatMap((c) => c.allPacks), ...packs];
  return {
    folder,
    packs,
    children,
    allPacks,
    totalSpend: allPacks.reduce((sum, p) => sum + (p.stats?.totalSpend || 0), 0),
    hasSheet: allPacks.some((p) => !!p.sheet_integration?.id),
    hasShared: allPacks.some((p) => !!p.shared_role),
    depth,
  };
}

/**
 * Monta a árvore. Pasta cujo pai não veio (apagado em outra aba) sobe para a raiz
 * em vez de sumir; um ciclo — que o banco barra, mas o cliente não assume — também
 * é cortado na raiz, senão a recursão não terminaria.
 */
export function buildFolderTree(folders: PackFolder[], packs: AdsPack[], members: PackFolderMembers) {
  const ids = new Set(folders.map((f) => f.id));
  const direct = new Map<string, AdsPack[]>();
  folders.forEach((f) => direct.set(f.id, []));
  const loose: AdsPack[] = [];
  packs.forEach((pack) => {
    const folderId = members[pack.id];
    const list = folderId ? direct.get(folderId) : undefined;
    if (list) list.push(pack);
    else loose.push(pack);
  });

  const childrenOf = new Map<string | null, PackFolder[]>();
  folders.forEach((f) => {
    const parent = f.parent_id && ids.has(f.parent_id) ? f.parent_id : null;
    const list = childrenOf.get(parent) || [];
    list.push(f);
    childrenOf.set(parent, list);
  });

  const byId = new Map<string, FolderBucket>();
  const visited = new Set<string>();
  const build = (folder: PackFolder, depth: number): FolderBucket => {
    visited.add(folder.id);
    const kids = (childrenOf.get(folder.id) || []).filter((c) => !visited.has(c.id)).sort(byOrder).map((c) => build(c, depth + 1));
    const bucket = summarize(folder, direct.get(folder.id) || [], kids, depth);
    byId.set(folder.id, bucket);
    return bucket;
  };

  const roots = (childrenOf.get(null) || []).sort(byOrder).map((f) => build(f, 0));
  // Sobrou alguém sem caminho até a raiz: ciclo. Vai para a raiz.
  // `visited` é conferido a cada volta: montar um órfão já monta os filhos dele.
  [...folders].sort(byOrder).forEach((f) => {
    if (!visited.has(f.id)) roots.push(build(f, 0));
  });

  return { roots, byId, loose };
}

/** A árvore em profundidade, na ordem em que é desenhada. */
export function flattenTree(roots: FolderBucket[]): FolderBucket[] {
  return roots.flatMap((node) => [node, ...flattenTree(node.children)]);
}

/** Da raiz até a pasta, inclusive. Vazio se ela não existe. */
export function folderPath(byId: Map<string, FolderBucket>, folderId: string | null): FolderBucket[] {
  const path: FolderBucket[] = [];
  const seen = new Set<string>();
  let current = folderId ? byId.get(folderId) : undefined;
  while (current && !seen.has(current.folder.id)) {
    seen.add(current.folder.id);
    path.unshift(current);
    current = current.folder.parent_id ? byId.get(current.folder.parent_id) : undefined;
  }
  return path;
}

/** A pasta e tudo abaixo dela — alvos proibidos ao arrastá-la. */
export function subtreeIds(node: FolderBucket): Set<string> {
  const out = new Set<string>();
  const walk = (n: FolderBucket) => {
    out.add(n.folder.id);
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}

/**
 * Filtro da busca: fica a pasta cujo NOME casa, ou que tem pack que casa, ou que
 * tem subpasta que ficou — é assim que as pastas acima de um resultado fundo
 * continuam na tela (decisão de produto). Os packs listados são só os que casam,
 * e a contagem passa a ser a dos resultados.
 */
export function filterFolderTree(
  roots: FolderBucket[],
  matchPack: (pack: AdsPack) => boolean,
  matchFolder: (folder: PackFolder) => boolean,
): FolderBucket[] {
  const walk = (node: FolderBucket): FolderBucket | null => {
    // Casou pelo NOME: a pasta é o resultado, com tudo o que tem dentro. Esvaziá-la
    // mostraria "Pasta vazia" numa pasta cheia.
    if (matchFolder(node.folder)) return node;
    const children = node.children.map(walk).filter((c): c is FolderBucket => c !== null);
    const packs = node.packs.filter(matchPack);
    if (packs.length === 0 && children.length === 0) return null;
    return summarize(node.folder, packs, children, node.depth);
  };
  return roots.map(walk).filter((n): n is FolderBucket => n !== null);
}

/**
 * Onde a pasta vai parar ao ser solta em `targetId`, na borda `edge`: o pai novo e
 * a ordem COMPLETA dos irmãos no destino. `null` = movimento inválido (para dentro
 * de si mesma ou de uma descendente) ou sem efeito (já estava ali).
 */
export function planFolderMove(
  folders: PackFolder[],
  folderId: string,
  targetId: string,
  edge: FolderDropEdge,
): { parentId: string | null; siblingIds: string[] } | null {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const moving = byId.get(folderId);
  const target = byId.get(targetId);
  if (!moving || !target || folderId === targetId) return null;

  // O alvo não pode estar abaixo da pasta movida.
  const seen = new Set<string>();
  let cursor: PackFolder | undefined = target;
  while (cursor && !seen.has(cursor.id)) {
    if (cursor.id === folderId) return null;
    seen.add(cursor.id);
    cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
  }

  const normalizeParent = (id: string | null) => (id && byId.has(id) ? id : null);
  const parentId = edge === "inside" ? targetId : normalizeParent(target.parent_id);
  const siblings = folders.filter((f) => f.id !== folderId && normalizeParent(f.parent_id) === parentId).sort(byOrder);

  let index = siblings.length;
  if (edge !== "inside") {
    const at = siblings.findIndex((f) => f.id === targetId);
    index = edge === "before" ? at : at + 1;
  }
  const next = [...siblings.slice(0, index), moving, ...siblings.slice(index)];

  const before = folders.filter((f) => normalizeParent(f.parent_id) === normalizeParent(moving.parent_id)).sort(byOrder);
  const unchanged = normalizeParent(moving.parent_id) === parentId && before.length === next.length && before.every((f, i) => f.id === next[i].id);
  if (unchanged) return null;

  return { parentId, siblingIds: next.map((f) => f.id) };
}

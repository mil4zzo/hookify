"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api/endpoints";
import { showError, showSuccess } from "@/lib/utils/toast";
import { logger } from "@/lib/utils/logger";
import { translate } from "@/lib/i18n/translate";
import { useClientPacks } from "@/lib/hooks/useClientSession";
import { bulkJudgmentStorePatch } from "@/lib/utils/packJudgmentBulk";
import type { AdsPack, DirectShareEntry, FolderAccessChanges, FolderShareEntry, PackFolder, PackFolderMembers } from "@/lib/types";
import { buildFolderTree, flattenTree, planFolderMove, type FolderBucket, type FolderDropEdge } from "@/lib/utils/folderTree";

export type { FolderBucket } from "@/lib/utils/folderTree";

/**
 * Pastas da Biblioteca. O vínculo vem do servidor como {pack_id: folder_id} e o
 * agrupamento é derivado no cliente sobre os packs que a página já carregou —
 * zero query por pasta.
 *
 * Toda escrita é OTIMISTA e reverte no erro. Arrastar precisa responder na hora:
 * esperar o servidor para o card sair da tela faria o gesto parecer travado.
 */
export function useFolders(packs: AdsPack[]) {
  const { updatePack } = useClientPacks();
  const [folders, setFolders] = useState<PackFolder[]>([]);
  const [members, setMembers] = useState<PackFolderMembers>({});
  // Quem tem cada pasta que o usuário compartilhou (migration 181). Só leitura aqui:
  // quem muda é o diálogo de compartilhar, que chama `reload`.
  const [folderShares, setFolderShares] = useState<FolderShareEntry[]>([]);
  // Convites diretos dos packs do usuário: a pasta os absorve ao cobrir a pessoa, e o
  // aviso antes de mover diz isso. Só vem quando o usuário compartilha alguma pasta.
  const [directShares, setDirectShares] = useState<DirectShareEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await api.folders.list({ signal: controller.signal });
      if (controller.signal.aborted) return;
      setFolders(res.folders || []);
      setMembers(res.members || {});
      setFolderShares(res.folder_shares || []);
      setDirectShares(res.direct_shares || []);
    } catch (error) {
      if (controller.signal.aborted) return;
      logger.error("Erro ao carregar pastas:", error);
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  /**
   * A árvore. `buckets` é ela achatada na ordem desenhada (quem só precisa achar
   * uma pasta por id continua funcionando); `rootBuckets` é o topo; `bucketById`
   * é o atalho. Vínculo órfão (pasta apagada em outra aba) cai em "soltos".
   */
  const { rootBuckets, buckets, bucketById, loosePacks, folderIdByPack } = useMemo(() => {
    const { roots, byId, loose } = buildFolderTree(folders, packs, members);
    return { rootBuckets: roots, buckets: flattenTree(roots), bucketById: byId as Map<string, FolderBucket>, loosePacks: loose as AdsPack[], folderIdByPack: members };
  }, [folders, packs, members]);

  const createFolder = useCallback(
    async (name: string, packIds: string[] = [], parentId: string | null = null) => {
      try {
        const res = await api.folders.create(name, packIds, parentId);
        // Subpasta de uma pasta compartilhada nasce na árvore do DONO, com o papel que o
        // usuário tem na de cima — senão o menu dela ofereceria o que o banco recusaria.
        const parent = parentId ? folders.find((f) => f.id === parentId) : undefined;
        const created: PackFolder = { ...res.folder, access: parent?.access ?? "dono", owner_id: parent?.owner_id ?? res.folder.owner_id, owner_name: parent?.owner_name ?? null };
        setFolders((prev) => [...prev, created].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "pt-BR")));
        if (packIds.length) {
          setMembers((prev) => {
            const next = { ...prev };
            packIds.forEach((id) => { next[id] = res.folder.id; });
            return next;
          });
        }
        showSuccess(packIds.length ? translate("packs.folders.createdWithPacks", { name: res.folder.name, count: packIds.length }) : translate("packs.folders.created", { name: res.folder.name }));
        return res.folder;
      } catch (error) {
        showError(error instanceof Error ? error : new Error(translate("packs.folders.errCreate")));
        return null;
      }
    },
    [folders],
  );

  const renameFolder = useCallback(async (folderId: string, name: string) => {
    const previous = folders;
    setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, name } : f)));
    try {
      await api.folders.rename(folderId, name);
    } catch (error) {
      setFolders(previous);
      showError(error instanceof Error ? error : new Error(translate("packs.folders.errRename")));
    }
  }, [folders]);

  /**
   * Desfaz a pasta. Nada é apagado além dela: subpastas e packs SOBEM um nível, no
   * lugar dela (na raiz, os packs ficam soltos). O otimista põe tudo no pai na hora;
   * a ordem exata vem do servidor no `load()` seguinte.
   */
  const deleteFolder = useCallback(async (folderId: string) => {
    const target = folders.find((f) => f.id === folderId);
    if (!target) return;
    const parentId = target.parent_id ?? null;
    const parentName = parentId ? folders.find((f) => f.id === parentId)?.name : null;

    setFolders((prev) =>
      prev
        .filter((f) => f.id !== folderId)
        // Fração só para a ordem otimista ficar no lugar da desfeita até o reload.
        .map((f) => (f.parent_id === folderId ? { ...f, parent_id: parentId, position: target.position + (f.position + 1) / 1000 } : f)),
    );
    setMembers((prev) => {
      const next: PackFolderMembers = {};
      Object.entries(prev).forEach(([packId, fid]) => {
        if (fid !== folderId) next[packId] = fid;
        else if (parentId) next[packId] = parentId;
      });
      return next;
    });

    try {
      const res = await api.folders.remove(folderId);
      const moved = (res.packs_moved || 0) + (res.folders_moved || 0);
      const lostAccess = res.access_changes?.revoked ?? 0;
      const lost = lostAccess > 0 ? "yes" : "no";
      showSuccess(
        moved > 0
          ? translate("packs.folders.dissolvedMoved", {
              packs: res.packs_moved > 0 ? res.packs_moved : 0,
              folders: res.folders_moved > 0 ? res.folders_moved : 0,
              both: res.packs_moved > 0 && res.folders_moved > 0 ? "yes" : "no",
              moved,
              dest: parentName ? "parent" : "root",
              parent: parentName ?? "",
              lost,
            })
          : translate("packs.folders.dissolved", { lost }),
      );
    } catch (error) {
      showError(error instanceof Error ? error : new Error(translate("packs.folders.errDissolve")));
    } finally {
      // A verdade vem do servidor nos dois casos: no sucesso, a ordem exata das
      // subpastas que subiram; no erro, desfazer à mão um otimista de vários
      // níveis seria mais frágil que reler.
      load();
    }
  }, [folders, load]);

  /**
   * Leva a pasta para antes, depois ou para DENTRO de outra. A conta é sobre a
   * lista INTEIRA, não a que a busca deixou na tela — senão reordenar com filtro
   * gravaria posições só dos visíveis e embaralharia os escondidos.
   */
  const moveFolder = useCallback(async (folderId: string, targetId: string, edge: FolderDropEdge) => {
    const plan = planFolderMove(folders, folderId, targetId, edge);
    if (!plan) return;

    const previous = folders;
    const positionOf = new Map(plan.siblingIds.map((id, i) => [id, i]));
    setFolders((prev) =>
      prev.map((f) => {
        if (f.id === folderId) return { ...f, parent_id: plan.parentId, position: positionOf.get(f.id)! };
        return positionOf.has(f.id) ? { ...f, position: positionOf.get(f.id)! } : f;
      }),
    );
    try {
      const res = await api.folders.place(folderId, plan.parentId, plan.siblingIds);
      // Entrou numa pasta que manda no critério: os packs herdaram no servidor (187).
      for (const r of res.judgment_inherited ?? []) {
        if (r.status === "updated" && r.judgment) updatePack(r.pack_id, bulkJudgmentStorePatch(r.judgment));
      }
      // A pasta pode ter perdido o critério próprio mesmo sem pack para herdar: reler.
      if (res.judgment_inherited || res.judgment_reconciled || res.judgment_reconcile_failed) load();
      if (res.judgment_reconcile_failed) showError(new Error(translate("packs.folders.errReconcile")));
    } catch (error) {
      setFolders(previous);
      showError(error instanceof Error ? error : new Error(translate("packs.folders.errMove")));
    }
  }, [folders, updatePack, load]);

  /**
   * Move packs. `folderId` nulo tira da pasta.
   * Devolve o estado anterior para quem quiser oferecer "Desfazer" — arrasto erra
   * em silêncio, e sem volta o engano só aparece muito depois.
   */
  const movePacks = useCallback(
    async (packIds: string[], folderId: string | null) => {
      if (!packIds.length) return null;
      const before: PackFolderMembers = {};
      packIds.forEach((id) => { if (members[id]) before[id] = members[id]; });

      setMembers((prev) => {
        const next = { ...prev };
        packIds.forEach((id) => {
          if (folderId) next[id] = folderId;
          else delete next[id];
        });
        return next;
      });

      try {
        const res = await api.folders.move(packIds, folderId);
        // Pack que entrou numa pasta com critério o herdou no servidor: a tela acompanha.
        for (const r of res.judgment_inherited ?? []) {
          if (r.status === "updated" && r.judgment) updatePack(r.pack_id, bulkJudgmentStorePatch(r.judgment));
        }
        return { packIds, before, accessChanges: res.access_changes as FolderAccessChanges | undefined };
      } catch (error) {
        setMembers((prev) => {
          const next = { ...prev };
          packIds.forEach((id) => {
            if (before[id]) next[id] = before[id];
            else delete next[id];
          });
          return next;
        });
        showError(error instanceof Error ? error : new Error(translate("packs.folders.errMovePacks")));
        return null;
      }
    },
    [members, updatePack],
  );

  /** Volta um movimento ao estado exato de antes, pack a pack. */
  const undoMove = useCallback(async (packIds: string[], before: PackFolderMembers) => {
    const byTarget = new Map<string | null, string[]>();
    packIds.forEach((id) => {
      const target = before[id] ?? null;
      const list = byTarget.get(target) || [];
      list.push(id);
      byTarget.set(target, list);
    });

    setMembers((prev) => {
      const next = { ...prev };
      packIds.forEach((id) => {
        if (before[id]) next[id] = before[id];
        else delete next[id];
      });
      return next;
    });

    try {
      await Promise.all(Array.from(byTarget.entries()).map(([target, ids]) => api.folders.move(ids, target)));
    } catch (error) {
      logger.error("Erro ao desfazer o movimento:", error);
      load();
    }
  }, [load]);

  /** Quem recebeu a pasta sai dela inteira. A verdade (o que sumiu da tela) vem do reload. */
  const leaveFolder = useCallback(async (folderId: string) => {
    try {
      await api.folderShares.leave(folderId);
      showSuccess(translate("packs.folders.left"));
    } catch (error) {
      showError(error instanceof Error ? error : new Error(translate("packs.folders.errLeave")));
    } finally {
      load();
    }
  }, [load]);

  return { folders, folderShares, directShares, leaveFolder, rootBuckets, buckets, bucketById, loosePacks, folderIdByPack, isLoading, createFolder, renameFolder, deleteFolder, moveFolder, movePacks, undoMove, reload: load };
}

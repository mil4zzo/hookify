"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api/endpoints";
import { showError, showSuccess } from "@/lib/utils/toast";
import { logger } from "@/lib/utils/logger";
import type { AdsPack, PackFolder, PackFolderMembers } from "@/lib/types";
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
  const [folders, setFolders] = useState<PackFolder[]>([]);
  const [members, setMembers] = useState<PackFolderMembers>({});
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
        setFolders((prev) => [...prev, res.folder].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "pt-BR")));
        if (packIds.length) {
          setMembers((prev) => {
            const next = { ...prev };
            packIds.forEach((id) => { next[id] = res.folder.id; });
            return next;
          });
        }
        showSuccess(packIds.length ? `Pasta "${res.folder.name}" criada com ${packIds.length} ${packIds.length === 1 ? "pack" : "packs"}.` : `Pasta "${res.folder.name}" criada.`);
        return res.folder;
      } catch (error) {
        showError(error instanceof Error ? error : new Error("Erro ao criar a pasta"));
        return null;
      }
    },
    [],
  );

  const renameFolder = useCallback(async (folderId: string, name: string) => {
    const previous = folders;
    setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, name } : f)));
    try {
      await api.folders.rename(folderId, name);
    } catch (error) {
      setFolders(previous);
      showError(error instanceof Error ? error : new Error("Erro ao renomear a pasta"));
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
      const parts = [
        res.packs_moved > 0 ? `${res.packs_moved} ${res.packs_moved === 1 ? "pack" : "packs"}` : null,
        res.folders_moved > 0 ? `${res.folders_moved} ${res.folders_moved === 1 ? "subpasta" : "subpastas"}` : null,
      ].filter(Boolean);
      const where = parentName ? `para “${parentName}”` : "para a Biblioteca";
      showSuccess(moved > 0 ? `Pasta desfeita. ${parts.join(" e ")} ${moved > 1 ? "subiram" : "subiu"} ${where}.` : "Pasta desfeita.");
    } catch (error) {
      showError(error instanceof Error ? error : new Error("Erro ao desfazer a pasta"));
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
      await api.folders.place(folderId, plan.parentId, plan.siblingIds);
    } catch (error) {
      setFolders(previous);
      showError(error instanceof Error ? error : new Error("Erro ao mover a pasta"));
    }
  }, [folders]);

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
        await api.folders.move(packIds, folderId);
        return { packIds, before };
      } catch (error) {
        setMembers((prev) => {
          const next = { ...prev };
          packIds.forEach((id) => {
            if (before[id]) next[id] = before[id];
            else delete next[id];
          });
          return next;
        });
        showError(error instanceof Error ? error : new Error("Erro ao mover os packs"));
        return null;
      }
    },
    [members],
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

  return { folders, rootBuckets, buckets, bucketById, loosePacks, folderIdByPack, isLoading, createFolder, renameFolder, deleteFolder, moveFolder, movePacks, undoMove, reload: load };
}

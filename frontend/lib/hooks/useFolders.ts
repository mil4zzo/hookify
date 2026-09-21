"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api/endpoints";
import { showError, showSuccess } from "@/lib/utils/toast";
import { logger } from "@/lib/utils/logger";
import type { AdsPack, PackFolder, PackFolderMembers } from "@/lib/types";

export interface FolderBucket {
  folder: PackFolder;
  packs: AdsPack[];
  totalSpend: number;
  hasSheet: boolean;
  hasShared: boolean;
}

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

  /** Pasta de cada pack, e os packs que não estão em nenhuma. */
  const { buckets, loosePacks, folderIdByPack } = useMemo(() => {
    const byId = new Map<string, AdsPack[]>();
    folders.forEach((f) => byId.set(f.id, []));
    const loose: AdsPack[] = [];

    packs.forEach((pack) => {
      const folderId = members[pack.id];
      const bucket = folderId ? byId.get(folderId) : undefined;
      // Vínculo órfão (pasta apagada em outra aba) cai em "soltos" em vez de sumir.
      if (bucket) bucket.push(pack);
      else loose.push(pack);
    });

    const list: FolderBucket[] = folders.map((folder) => {
      const inside = byId.get(folder.id) || [];
      return {
        folder,
        packs: inside,
        totalSpend: inside.reduce((sum, p) => sum + (p.stats?.totalSpend || 0), 0),
        hasSheet: inside.some((p) => !!p.sheet_integration?.id),
        hasShared: inside.some((p) => !!p.shared_role),
      };
    });

    return { buckets: list, loosePacks: loose, folderIdByPack: members };
  }, [folders, packs, members]);

  const createFolder = useCallback(
    async (name: string, packIds: string[] = []) => {
      try {
        const res = await api.folders.create(name, packIds);
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

  /** Desfaz a pasta. Os packs ficam: voltam para "soltos". */
  const deleteFolder = useCallback(async (folderId: string) => {
    const prevFolders = folders;
    const prevMembers = members;
    const freed = Object.values(members).filter((id) => id === folderId).length;

    setFolders((prev) => prev.filter((f) => f.id !== folderId));
    setMembers((prev) => {
      const next: PackFolderMembers = {};
      Object.entries(prev).forEach(([packId, fid]) => { if (fid !== folderId) next[packId] = fid; });
      return next;
    });

    try {
      await api.folders.remove(folderId);
      showSuccess(freed > 0 ? `Pasta desfeita. ${freed} ${freed === 1 ? "pack voltou" : "packs voltaram"} para a Biblioteca.` : "Pasta desfeita.");
    } catch (error) {
      setFolders(prevFolders);
      setMembers(prevMembers);
      showError(error instanceof Error ? error : new Error("Erro ao desfazer a pasta"));
    }
  }, [folders, members]);

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

  return { folders, buckets, loosePacks, folderIdByPack, isLoading, createFolder, renameFolder, deleteFolder, movePacks, undoMove, reload: load };
}

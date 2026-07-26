"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/api/endpoints";
import { useClientPacks } from "@/lib/hooks/useClientSession";
import { useInvalidatePackAds } from "@/lib/api/hooks";
import { finishProgressToast, showProgressToast } from "@/lib/utils/toast";
import { logger } from "@/lib/utils/logger";

export interface PackDeleteTarget {
  id: string;
  name: string;
}

export interface BulkPackDeleteResult {
  deletedIds: string[];
  failed: PackDeleteTarget[];
}

const TOAST_ID = "bulk-pack-delete";

/**
 * Deleta packs UM DE CADA VEZ.
 *
 * `delete_pack` é caro no backend: varre a junction `ad_metric_pack_map`, apaga as métricas
 * exclusivas em lotes de 200, reescreve o `pack_ids` dos ads compartilhados via RPC e ainda
 * limpa thumbnails no storage. Disparar isso em paralelo reproduz o mesmo estouro de
 * statement timeout (57014) que derrubou o refresh concorrente — a serialização aqui é
 * requisito do backend, não preferência de UX.
 *
 * A integração de Google Sheets do pack cai junto por `ON DELETE CASCADE` em
 * `ad_sheet_integrations.pack_id`; como cada pack tem sua própria linha de integração,
 * deletar um pack nunca afeta a planilha de outro.
 */
export function useBulkPackDelete() {
  const { removePack } = useClientPacks();
  const { invalidatePackAds, invalidateAdPerformance } = useInvalidatePackAds();
  const [isDeleting, setIsDeleting] = useState(false);

  const deletePacks = useCallback(
    async (targets: PackDeleteTarget[]): Promise<BulkPackDeleteResult> => {
      const result: BulkPackDeleteResult = { deletedIds: [], failed: [] };
      if (targets.length === 0) return result;

      const total = targets.length;
      const header = total === 1 ? "Removendo pack" : `Removendo ${total} packs`;
      setIsDeleting(true);

      try {
        for (let index = 0; index < total; index++) {
          const target = targets[index];
          showProgressToast(TOAST_ID, header, index, total, total === 1 ? target.name : `${target.name} (${index + 1} de ${total})`);

          try {
            await api.analytics.deletePack(target.id, []);
            result.deletedIds.push(target.id);
          } catch (error) {
            logger.error(`Erro ao deletar pack ${target.id}:`, error);
            result.failed.push(target);
          }

          // Sai do store mesmo em falha — é o mesmo contrato da deleção individual
          // ("removido localmente"): um card fantasma confunde mais que a dessincronia.
          removePack(target.id);
          // Invalidação alvo por pack. Um invalidate amplo aqui derrubaria o read-path
          // inteiro por statement timeout quando a lista é grande.
          await invalidatePackAds(target.id).catch(() => {});
        }

        invalidateAdPerformance();

        const ok = result.failed.length === 0;
        const removed = result.deletedIds.length;
        finishProgressToast(
          TOAST_ID,
          ok,
          ok
            ? `${removed} ${removed === 1 ? "pack removido" : "packs removidos"}.`
            : `${removed} de ${total} ${removed === 1 ? "removido" : "removidos"}. Falharam no servidor: ${result.failed.map((f) => f.name).join(", ")}.`,
        );

        return result;
      } finally {
        setIsDeleting(false);
      }
    },
    [removePack, invalidatePackAds, invalidateAdPerformance],
  );

  return { deletePacks, isDeleting };
}

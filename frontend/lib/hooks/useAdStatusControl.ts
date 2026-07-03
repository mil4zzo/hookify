import { useCallback, useMemo, useState } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/endpoints";
import { showError, showSuccess } from "@/lib/utils/toast";
import { toast } from "sonner";

export type AdEntityType = "ad" | "adset" | "campaign";
export type AdEntityStatus = "PAUSED" | "ACTIVE";

/**
 * Patch effective_status in all cached rankings entries for a given ad_id, in-place.
 * Avoids broad invalidation that triggers a flood of duplicate RPC calls (fetch_manager_rankings_core_v2)
 * — metrics don't change when status toggles, only the badge does.
 */
function patchAdStatusInCaches(qc: QueryClient, adId: string, nextStatus: string): void {
  if (!adId) return;
  const patchRow = (row: any): any => {
    if (!row || typeof row !== "object") return row;
    if (row.ad_id !== adId) return row;
    if (!Object.prototype.hasOwnProperty.call(row, "effective_status")) return row;
    return { ...row, effective_status: nextStatus, status_resolved: true };
  };
  qc.setQueriesData<unknown>({ queryKey: ["analytics", "rankings"] }, (cached: unknown) => {
    if (cached == null) return cached;
    if (Array.isArray(cached)) {
      let mutated = false;
      const next = cached.map((row) => {
        const patched = patchRow(row);
        if (patched !== row) mutated = true;
        return patched;
      });
      return mutated ? next : cached;
    }
    if (typeof cached === "object") {
      const obj = cached as Record<string, any>;
      // Shape: { data: Item[] } (RankingsResponse, ad-history, ad-name-history)
      if (Array.isArray(obj.data)) {
        let mutated = false;
        const nextData = obj.data.map((row: any) => {
          const patched = patchRow(row);
          if (patched !== row) mutated = true;
          return patched;
        });
        return mutated ? { ...obj, data: nextData } : cached;
      }
      // Shape: single item (ad-details, ad-name-details)
      const patched = patchRow(obj);
      return patched !== obj ? patched : cached;
    }
    return cached;
  });
}

export interface UseAdStatusControlOptions {
  entityType: AdEntityType;
  entityId: string;
  currentStatus?: string | null;
  onSuccess?: (nextStatus: AdEntityStatus) => void;
}

export interface UseAdStatusControlReturn {
  status: string | null;
  isPaused: boolean;
  isLoading: boolean;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  toggleStatus: () => Promise<void>;
}

function isPausedStatus(status?: string | null): boolean {
  if (!status) return false;
  const s = String(status).toUpperCase();
  return s === "PAUSED" || s === "ADSET_PAUSED" || s === "CAMPAIGN_PAUSED";
}

function patchBulkAdStatusInCaches(qc: QueryClient, updates: { adId: string; status: AdEntityStatus }[]): void {
  if (!updates.length) return;
  const updateMap = new Map(updates.map((u) => [u.adId, u.status]));
  const patchRow = (row: any): any => {
    if (!row || typeof row !== "object") return row;
    const nextStatus = updateMap.get(row.ad_id);
    if (!nextStatus) return row;
    if (!Object.prototype.hasOwnProperty.call(row, "effective_status")) return row;
    return { ...row, effective_status: nextStatus, status_resolved: true };
  };
  qc.setQueriesData<unknown>({ queryKey: ["analytics", "rankings"] }, (cached: unknown) => {
    if (cached == null) return cached;
    if (Array.isArray(cached)) {
      let mutated = false;
      const next = cached.map((row) => {
        const patched = patchRow(row);
        if (patched !== row) mutated = true;
        return patched;
      });
      return mutated ? next : cached;
    }
    if (typeof cached === "object") {
      const obj = cached as Record<string, any>;
      if (Array.isArray(obj.data)) {
        let mutated = false;
        const nextData = obj.data.map((row: any) => {
          const patched = patchRow(row);
          if (patched !== row) mutated = true;
          return patched;
        });
        return mutated ? { ...obj, data: nextData } : cached;
      }
      const patched = patchRow(obj);
      return patched !== obj ? patched : cached;
    }
    return cached;
  });
}

export interface UseBulkAdStatusControlReturn {
  bulkPause: (adIds: string[]) => void;
  bulkActivate: (adIds: string[]) => void;
  isLoading: boolean;
}

export function useBulkAdStatusControl(): UseBulkAdStatusControlReturn {
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ adIds, status }: { adIds: string[]; status: "PAUSED" | "ACTIVE" }) =>
      api.facebook.batchUpdateAdStatus(adIds, status),
    onSuccess: (data, variables) => {
      const { status } = variables;
      const { updated_ids, failed_ids } = data;
      const blockedIds = Object.keys(data.blocked ?? {});
      const label = status === "PAUSED" ? "pausados" : "ativados";

      if (updated_ids.length > 0) {
        // Só os aplicados de fato — bloqueados/falhos mantêm o effective_status atual no cache.
        patchBulkAdStatusInCaches(
          qc,
          updated_ids.map((id) => ({ adId: id, status: status as AdEntityStatus })),
        );
      }

      const plural = (n: number) => (n !== 1 ? "s" : "");

      if (blockedIds.length === 0 && failed_ids.length === 0) {
        showSuccess(`${updated_ids.length} anúncio${plural(updated_ids.length)} ${label}.`);
        return;
      }

      if (updated_ids.length > 0) {
        // Parcial: aplicou alguns, mas houve bloqueio (pai pausado) e/ou falha.
        const segments = [`${updated_ids.length} ${label}`];
        if (blockedIds.length > 0) segments.push(`${blockedIds.length} bloqueado${plural(blockedIds.length)} (pai pausado)`);
        if (failed_ids.length > 0) segments.push(`${failed_ids.length} com falha`);
        toast.warning(`${segments.join(", ")}.`, { duration: 6000 });
        return;
      }

      // Nada aplicado.
      if (blockedIds.length > 0 && failed_ids.length === 0) {
        // Todos bloqueados por pausa herdada: é orientação, não falha do Meta.
        toast.warning(
          `Nenhum ativado: ${blockedIds.length} bloqueado${plural(blockedIds.length)} porque um pai está pausado. Ative a campanha/conjunto primeiro.`,
          { duration: 7000 },
        );
        return;
      }

      showError(`Falha ao atualizar ${failed_ids.length} anúncio${plural(failed_ids.length)}.`);
    },
    onError: (e: any) => {
      const msg = e?.message || "Falha ao atualizar status em lote.";
      showError(msg);
    },
  });

  const bulkPause = useCallback(
    (adIds: string[]) => mutation.mutate({ adIds, status: "PAUSED" }),
    [mutation],
  );

  const bulkActivate = useCallback(
    (adIds: string[]) => mutation.mutate({ adIds, status: "ACTIVE" }),
    [mutation],
  );

  return { bulkPause, bulkActivate, isLoading: mutation.isPending };
}

export function useAdStatusControl(options: UseAdStatusControlOptions): UseAdStatusControlReturn {
  const { entityType, entityId, currentStatus, onSuccess } = options;
  const qc = useQueryClient();
  const [statusOverride, setStatusOverride] = useState<string | null>(null);

  const effectiveStatus = statusOverride ?? (currentStatus ?? null);
  const isPaused = useMemo(() => isPausedStatus(effectiveStatus), [effectiveStatus]);

  const mutation = useMutation({
    mutationFn: async (nextStatus: AdEntityStatus) => {
      if (!entityId || !entityId.trim()) {
        throw new Error("entityId é obrigatório");
      }
      if (entityType === "ad") return api.facebook.updateAdStatus(entityId, nextStatus);
      if (entityType === "adset") return api.facebook.updateAdsetStatus(entityId, nextStatus);
      return api.facebook.updateCampaignStatus(entityId, nextStatus);
    },
    onSuccess: async (data) => {
      // Refletir o effective_status REAL relido do Meta (verify), não o status pedido.
      // Evita o "sucesso fantasma" que revertia no próximo refresh: se o Meta devolver um
      // estado ainda pausado, o badge mostra a verdade em vez de um ACTIVE otimista.
      const realStatus = (data.effective_status && data.effective_status.trim()) || data.status;
      setStatusOverride(realStatus);
      onSuccess?.(data.status);

      showSuccess(data.status === "PAUSED" ? "Pausado com sucesso." : "Ativado com sucesso.");

      if (entityType === "ad") {
        // Toggle de status não muda métricas — só effective_status. Patch in-place
        // evita o storm de refetches que causa timeouts no fetch_manager_rankings_core_v2.
        patchAdStatusInCaches(qc, entityId, realStatus);
      } else {
        // adset/campaign: o cascade para effective_status dos filhos (ADSET_PAUSED/CAMPAIGN_PAUSED)
        // é complexo de inferir client-side. Toggles desses são raros — invalidação ampla aceitável.
        await qc.invalidateQueries({ queryKey: ["analytics", "rankings"], refetchType: "active" });
      }
      // /me é cache pequeno e barato de revalidar
      await qc.invalidateQueries({ queryKey: ["facebook", "me"] });
    },
    onError: (e: any) => {
      const msg = e?.message || "Falha ao atualizar status.";
      // Pausa herdada de um pai ou entidade já ativa: é orientação ao usuário, não uma falha.
      if (e?.code === "PARENT_PAUSED" || e?.code === "ALREADY_ACTIVE") {
        toast.warning(msg, { duration: 6000 });
        return;
      }
      showError(msg);
    },
  });

  const pause = useCallback(async () => {
    // onError já trata a mensagem; swallow evita unhandled rejection nos call sites
    // (bloqueio por pausa herdada / "já ativo" agora é fluxo normal, não erro raro).
    try {
      await mutation.mutateAsync("PAUSED");
    } catch {
      /* tratado em onError */
    }
  }, [mutation]);

  const resume = useCallback(async () => {
    try {
      await mutation.mutateAsync("ACTIVE");
    } catch {
      /* tratado em onError */
    }
  }, [mutation]);

  const toggleStatus = useCallback(async () => {
    if (isPaused) {
      await resume();
      return;
    }
    await pause();
  }, [isPaused, pause, resume]);

  return {
    status: effectiveStatus,
    isPaused,
    isLoading: mutation.isPending,
    pause,
    resume,
    toggleStatus,
  };
}



import { useCallback, useMemo, useState } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/endpoints";
import { showError, showSuccess } from "@/lib/utils/toast";

export type AdEntityType = "ad" | "adset" | "campaign";
export type AdEntityStatus = "PAUSED" | "ACTIVE";

/**
 * Patch effective_status in all cached rankings entries for a given ad_id, in-place.
 * Avoids broad invalidation that triggers a flood of duplicate RPC calls (fetch_manager_rankings_core_v2)
 * — metrics don't change when status toggles, only the badge does.
 */
function patchAdStatusInCaches(qc: QueryClient, adId: string, nextStatus: AdEntityStatus): void {
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
      // Atualizar UI local imediatamente (antes do refetch) para melhor UX
      setStatusOverride(data.status);
      onSuccess?.(data.status);

      showSuccess(data.status === "PAUSED" ? "Pausado com sucesso." : "Ativado com sucesso.");

      if (entityType === "ad") {
        // Toggle de status não muda métricas — só effective_status. Patch in-place
        // evita o storm de refetches que causa timeouts no fetch_manager_rankings_core_v2.
        patchAdStatusInCaches(qc, entityId, data.status);
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
      showError(msg);
    },
  });

  const pause = useCallback(async () => {
    await mutation.mutateAsync("PAUSED");
  }, [mutation]);

  const resume = useCallback(async () => {
    await mutation.mutateAsync("ACTIVE");
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



import { useCallback, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/endpoints";
import { showError, showSuccess } from "@/lib/utils/toast";

export type AdEntityType = "ad" | "adset" | "campaign";
export type AdEntityStatus = "PAUSED" | "ACTIVE";

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

      // Rankings/ad-performance usam a mesma base de queryKey: ['analytics','rankings', ...]
      await qc.invalidateQueries({ queryKey: ["analytics", "rankings"], refetchType: "active" });
      // Também garantir que dados de /me e caches relacionados não fiquem defasados (seguro e barato)
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



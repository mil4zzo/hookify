import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/endpoints";
import { showError, showSuccess } from "@/lib/utils/toast";
import { toast } from "sonner";

export type AdEntityType = "ad" | "adset" | "campaign";
export type AdEntityStatus = "PAUSED" | "ACTIVE";

/**
 * Os caches de rankings vivem todos sob ["analytics","rankings"], mas nem toda entrada tem
 * linhas de nível de ANÚNCIO. Linhas agregadas (adset/campanha/ad_name) carregam
 * ad_id = anúncio representante do grupo — patchar por ad_id nelas contamina o status do
 * GRUPO com o de um único ad (ex.: pausar 1 ad fazia a linha da campanha dele aparecer
 * pausada na aba "por campanha"). Só o nível de ad pode ser patchado in-place com segurança.
 */
function isAdLevelRankingsKey(queryKey: readonly unknown[]): boolean {
  const marker = queryKey[2];
  if (typeof marker === "string") {
    // Sub-rotas cujas linhas são ads individuais.
    if (marker === "ad-details" || marker === "ad-history" || marker === "children" || marker === "adset-children") {
      return true;
    }
    // Sub-rotas de grupo (ad_name / adsets de campanha) ou sem effective_status.
    if (marker === "ad-name-details" || marker === "ad-name-history" || marker === "campaign-children" || marker === "ad-creative") {
      return false;
    }
  }
  // Chave principal do rankings/adPerformance: group_by fica na posição 4.
  return queryKey[4] === "ad_id";
}

/**
 * Aplica `patchRow` nas entradas ad-level dos caches de rankings e marca as entradas de
 * grupo como stale SEM refetch imediato (refetchType "none") — elas recarregam ao serem
 * montadas. Invalidação ampla com refetch ativo dispara storm de RPCs pesadas
 * (fetch_manager_rankings_core_v2) e estoura statement_timeout.
 */
function patchRankingsCaches(qc: QueryClient, patchRow: (row: any) => any): void {
  qc.setQueriesData<unknown>(
    { queryKey: ["analytics", "rankings"], predicate: (q) => isAdLevelRankingsKey(q.queryKey) },
    (cached: unknown) => {
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
        // Shape: { data: Item[] } (RankingsResponse, ad-history)
        if (Array.isArray(obj.data)) {
          let mutated = false;
          const nextData = obj.data.map((row: any) => {
            const patched = patchRow(row);
            if (patched !== row) mutated = true;
            return patched;
          });
          return mutated ? { ...obj, data: nextData } : cached;
        }
        // Shape: item único (ad-details)
        const patched = patchRow(obj);
        return patched !== obj ? patched : cached;
      }
      return cached;
    },
  );
  void qc.invalidateQueries({
    queryKey: ["analytics", "rankings"],
    refetchType: "none",
    predicate: (q) => !isAdLevelRankingsKey(q.queryKey),
  });
}

function makeAdStatusPatcher(adId: string, nextStatus: string): (row: any) => any {
  return (row: any): any => {
    if (!row || typeof row !== "object") return row;
    if (row.ad_id !== adId) return row;
    if (!Object.prototype.hasOwnProperty.call(row, "effective_status")) return row;
    return { ...row, effective_status: nextStatus, status_resolved: true };
  };
}

/**
 * Patch effective_status nos caches ad-level de rankings para um ad_id, in-place.
 * Evita invalidação ampla que dispara flood de RPCs — métricas não mudam no toggle,
 * só o badge.
 */
function patchAdStatusInCaches(qc: QueryClient, adId: string, nextStatus: string): void {
  if (!adId) return;
  patchRankingsCaches(qc, makeAdStatusPatcher(adId, nextStatus));
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

/**
 * Detecta pela mensagem (não pelo código aninhado, que é frágil) se o erro do Meta é de
 * limite de requisições. Cobre os códigos comuns de rate limit da Graph/Marketing API
 * design-system-exception: raw-color - códigos de erro da Meta abaixo, não são cores
 * (#4, #17, #32, #613, #80000–80009) e as frases em inglês que o Meta retorna.
 */
function isMetaRateLimitMessage(message?: string | null): boolean {
  if (!message) return false;
  return /request limit|rate limit|reduce the (amount|number)|too many calls|\(#(4|17|32|613|80\d{3})\)/i.test(String(message));
}

function patchBulkAdStatusInCaches(qc: QueryClient, updates: { adId: string; status: string }[]): void {
  if (!updates.length) return;
  const updateMap = new Map(updates.map((u) => [u.adId, u.status]));
  patchRankingsCaches(qc, (row: any): any => {
    if (!row || typeof row !== "object") return row;
    const nextStatus = updateMap.get(row.ad_id);
    if (!nextStatus) return row;
    if (!Object.prototype.hasOwnProperty.call(row, "effective_status")) return row;
    return { ...row, effective_status: nextStatus, status_resolved: true };
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
      // Verdade relida do Meta após a escrita (verify) — preferir ao status pedido.
      const verified: Record<string, string> = data.statuses ?? {};
      const label = status === "PAUSED" ? "pausados" : "ativados";

      // Aplicados: verdade do verify (ou o pedido). Bloqueados COM verify: self-heal do badge
      // com o estado real recém-lido (ADSET_PAUSED/CAMPAIGN_PAUSED) — espelha o 409 individual.
      const patches = [
        ...updated_ids.map((id) => ({ adId: id, status: verified[id] || status })),
        ...blockedIds.filter((id) => verified[id]).map((id) => ({ adId: id, status: verified[id] })),
      ];
      if (patches.length > 0) {
        patchBulkAdStatusInCaches(qc, patches);
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
      if (isMetaRateLimitMessage(msg)) {
        toast.warning("Limite de requisições do Meta atingido. Aguarde alguns segundos e tente novamente.", { duration: 7000 });
        return;
      }
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

  // Dados mais frescos do servidor voltam a mandar: o override existe só para cobrir a
  // janela entre a mutação e a próxima entrega de currentStatus (patch/refetch).
  useEffect(() => {
    setStatusOverride(null);
  }, [currentStatus]);

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
        // adset/campaign: o backend releu do Meta e persistiu o estado real dos filhos.
        // Toggles desses são raros — invalidação ampla aceitável.
        await qc.invalidateQueries({ queryKey: ["analytics", "rankings"], refetchType: "active" });
      }
      // /me é cache pequeno e barato de revalidar
      await qc.invalidateQueries({ queryKey: ["facebook", "me"] });
    },
    onError: (e: any) => {
      const msg = e?.message || "Falha ao atualizar status.";
      // Pausa herdada de um pai ou entidade já ativa: é orientação ao usuário, não uma falha.
      if (e?.code === "PARENT_PAUSED" || e?.code === "ALREADY_ACTIVE") {
        // Self-heal: o backend acabou de ler (e persistir) o estado REAL no Meta — refletir
        // no badge/cache em vez de deixar o status defasado até o próximo refresh do pack.
        const realStatus = String((e?.details as any)?.effective_status || "").trim();
        if (realStatus) {
          setStatusOverride(realStatus);
          if (entityType === "ad") {
            patchAdStatusInCaches(qc, entityId, realStatus);
          }
        }
        if (entityType !== "ad") {
          void qc.invalidateQueries({ queryKey: ["analytics", "rankings"], refetchType: "active" });
        }
        toast.warning(msg, { duration: 6000 });
        return;
      }
      // Rate limit do Meta: pausar/ativar anúncios um a um em sequência dispara 2 chamadas Meta
      // por anúncio (write + verify) e estoura o limite de requisições — enquanto "selecionar
      // vários + pausar em massa" usa a Batch API (1 requisição por 50). Orienta à ação em vez
      // de mostrar o "(#17) User request limit reached" cru.
      if (isMetaRateLimitMessage(msg)) {
        toast.warning(
          "Muitas ações de status em sequência. Aguarde alguns segundos e tente de novo — ou selecione vários anúncios e use “Pausar/Ativar em massa”.",
          { duration: 7000 },
        );
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

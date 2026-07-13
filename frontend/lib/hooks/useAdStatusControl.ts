import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/endpoints";
import { showError } from "@/lib/utils/toast";
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

export interface UseBulkEntityStatusControlReturn {
  bulkPause: (ids: string[]) => void;
  bulkActivate: (ids: string[]) => void;
  isLoading: boolean;
}

// Retrocompat: o call-site antigo importa este nome.
export type UseBulkAdStatusControlReturn = UseBulkEntityStatusControlReturn;

export const BULK_ENTITY_NOUN: Record<AdEntityType, { singular: string; plural: string; parentHint: string }> = {
  ad: { singular: "anúncio", plural: "anúncios", parentHint: "a campanha/conjunto" },
  adset: { singular: "conjunto", plural: "conjuntos", parentHint: "a campanha" },
  campaign: { singular: "campanha", plural: "campanhas", parentHint: "" },
};

/**
 * O write+verify no Meta leva segundos (e até ~5s extras quando o verify precisa de retry
 * por leitura transitória) — sem loading imediato o usuário fica sem feedback nenhum até a
 * resposta voltar ("nem vi toast"). O toast terminal atualiza o MESMO id in-place.
 */
function showStatusLoadingToast(toastId: string, status: AdEntityStatus, subject: string): void {
  toast.loading(`${status === "PAUSED" ? "Pausando" : "Ativando"} ${subject}…`, { id: toastId });
}

/** Fecha o loading e delega ao showError (card persistente com botão de fechar). */
function failStatusToast(toastId: string, message: string): void {
  toast.dismiss(toastId);
  showError(message);
}

/**
 * Pausar/ativar em massa via Meta Batch API (1 req/50), para ad, adset ou campaign.
 * - ad: patch in-place do cache ad-level (métricas não mudam → evita storm de RPC).
 * - adset/campaign: 1 invalidação ampla de rankings (o backend releu/reconciliou o cache local;
 *   1 mutação = 1 invalidação, sem amplificação — mesma via do toggle individual).
 */
export function useBulkEntityStatusControl(entityType: AdEntityType = "ad"): UseBulkEntityStatusControlReturn {
  const qc = useQueryClient();
  const noun = BULK_ENTITY_NOUN[entityType];
  const toastId = `bulk-status-${entityType}`;

  const mutation = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: "PAUSED" | "ACTIVE" }) => {
      if (entityType === "adset") return api.facebook.batchUpdateAdsetStatus(ids, status);
      if (entityType === "campaign") return api.facebook.batchUpdateCampaignStatus(ids, status);
      return api.facebook.batchUpdateAdStatus(ids, status);
    },
    onMutate: ({ ids, status }) => {
      showStatusLoadingToast(toastId, status, `${ids.length} ${ids.length === 1 ? noun.singular : noun.plural}`);
    },
    onSuccess: async (data, variables) => {
      const { status } = variables;
      const { updated_ids, failed_ids } = data;
      const blockedIds = Object.keys(data.blocked ?? {});
      // Verdade relida do Meta após a escrita (verify) — preferir ao status pedido.
      const verified: Record<string, string> = data.statuses ?? {};

      if (entityType === "ad") {
        // Aplicados: verdade do verify (ou o pedido). Bloqueados COM verify: self-heal do badge
        // com o estado real recém-lido (ADSET_PAUSED/CAMPAIGN_PAUSED) — espelha o 409 individual.
        const patches = [
          ...updated_ids.map((id) => ({ adId: id, status: verified[id] || status })),
          ...blockedIds.filter((id) => verified[id]).map((id) => ({ adId: id, status: verified[id] })),
        ];
        if (patches.length > 0) patchBulkAdStatusInCaches(qc, patches);
      } else {
        // adset/campaign: o backend releu do Meta e reconciliou o cache local. Toggles em massa
        // desses são raros e é 1 mutação só — invalidação ampla aceitável (sem amplificação).
        await qc.invalidateQueries({ queryKey: ["analytics", "rankings"], refetchType: "active" });
        await qc.invalidateQueries({ queryKey: ["facebook", "me"] });
      }

      const plural = (n: number) => (n !== 1 ? "s" : "");
      const verb = (n: number) => `${status === "PAUSED" ? "pausad" : "ativad"}o${plural(n)}`;
      const nounFor = (n: number) => (n === 1 ? noun.singular : noun.plural);

      if (blockedIds.length === 0 && failed_ids.length === 0) {
        toast.success(`${updated_ids.length} ${nounFor(updated_ids.length)} ${verb(updated_ids.length)}.`, { id: toastId });
        return;
      }

      if (updated_ids.length > 0) {
        // Parcial: aplicou alguns, mas houve bloqueio (pai pausado) e/ou falha.
        const segments = [`${updated_ids.length} ${verb(updated_ids.length)}`];
        if (blockedIds.length > 0) segments.push(`${blockedIds.length} bloqueado${plural(blockedIds.length)} (pai pausado)`);
        if (failed_ids.length > 0) segments.push(`${failed_ids.length} com falha`);
        toast.warning(`${segments.join(", ")}.`, { id: toastId, duration: 6000 });
        return;
      }

      // Nada aplicado.
      if (blockedIds.length > 0 && failed_ids.length === 0) {
        // Todos bloqueados por pausa herdada: é orientação, não falha do Meta.
        toast.warning(
          `Nenhum ativado: ${blockedIds.length} bloqueado${plural(blockedIds.length)} porque ${noun.parentHint || "um pai"} está pausado(a). Ative ${noun.parentHint || "a campanha/conjunto"} primeiro.`,
          { id: toastId, duration: 7000 },
        );
        return;
      }

      failStatusToast(toastId, `Falha ao atualizar ${failed_ids.length} ${nounFor(failed_ids.length)}.`);
    },
    onError: (e: any) => {
      const msg = e?.message || "Falha ao atualizar status em lote.";
      if (isMetaRateLimitMessage(msg)) {
        toast.warning("Limite de requisições do Meta atingido. Aguarde alguns segundos e tente novamente.", { id: toastId, duration: 7000 });
        return;
      }
      failStatusToast(toastId, msg);
    },
  });

  const bulkPause = useCallback(
    (ids: string[]) => mutation.mutate({ ids, status: "PAUSED" }),
    [mutation],
  );

  const bulkActivate = useCallback(
    (ids: string[]) => mutation.mutate({ ids, status: "ACTIVE" }),
    [mutation],
  );

  return { bulkPause, bulkActivate, isLoading: mutation.isPending };
}

/** Retrocompat: bulk de anúncios. Prefira `useBulkEntityStatusControl(entityType)`. */
export function useBulkAdStatusControl(): UseBulkEntityStatusControlReturn {
  return useBulkEntityStatusControl("ad");
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
  // Id inclui a entidade: toggles rápidos em linhas diferentes não podem clobber o toast um do outro.
  const toastId = `status-${entityType}-${entityId}`;

  const mutation = useMutation({
    mutationFn: async (nextStatus: AdEntityStatus) => {
      if (!entityId || !entityId.trim()) {
        throw new Error("entityId é obrigatório");
      }
      if (entityType === "ad") return api.facebook.updateAdStatus(entityId, nextStatus);
      if (entityType === "adset") return api.facebook.updateAdsetStatus(entityId, nextStatus);
      return api.facebook.updateCampaignStatus(entityId, nextStatus);
    },
    onMutate: (nextStatus) => {
      showStatusLoadingToast(toastId, nextStatus, BULK_ENTITY_NOUN[entityType].singular);
    },
    onSuccess: async (data) => {
      // Refletir o effective_status REAL relido do Meta (verify), não o status pedido.
      // Evita o "sucesso fantasma" que revertia no próximo refresh: se o Meta devolver um
      // estado ainda pausado, o badge mostra a verdade em vez de um ACTIVE otimista.
      const realStatus = (data.effective_status && data.effective_status.trim()) || data.status;
      setStatusOverride(realStatus);
      onSuccess?.(data.status);

      toast.success(data.status === "PAUSED" ? "Pausado com sucesso." : "Ativado com sucesso.", { id: toastId });

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
        toast.warning(msg, { id: toastId, duration: 6000 });
        return;
      }
      // Rate limit do Meta: pausar/ativar anúncios um a um em sequência dispara 2 chamadas Meta
      // por anúncio (write + verify) e estoura o limite de requisições — enquanto "selecionar
      // vários + pausar em massa" usa a Batch API (1 requisição por 50). Orienta à ação em vez
      // de mostrar o "(#17) User request limit reached" cru.
      if (isMetaRateLimitMessage(msg)) {
        toast.warning(
          "Muitas ações de status em sequência. Aguarde alguns segundos e tente de novo — ou selecione vários anúncios e use “Pausar/Ativar em massa”.",
          { id: toastId, duration: 7000 },
        );
        return;
      }
      failStatusToast(toastId, msg);
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

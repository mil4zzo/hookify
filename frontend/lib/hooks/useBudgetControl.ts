import { useCallback } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/endpoints";
import type { UpdateEntityBudgetResponse } from "@/lib/api/schemas";
import { showError, showSuccess } from "@/lib/utils/toast";
import { toast } from "sonner";

export type BudgetEntityType = "adset" | "campaign";

export interface BudgetInput {
  daily_budget?: number;
  lifetime_budget?: number;
}

/**
 * Patch in-place do budget nos caches de rankings após edição verificada.
 *
 * Guardas (evitam a contaminação que o patch de status por ad_id teve):
 * - só linhas que CARREGAM chaves de budget (a RPC só as anexa a linhas de grupo
 *   adset/campanha — linhas de ad nem têm a chave);
 * - match por `group_key`, que é o id da PRÓPRIA entidade da linha (linhas de campanha
 *   carregam adset_id/campaign_id de um ad representante — usar esses contaminaria).
 * Métricas não mudam ao editar budget → nenhuma invalidação/refetch é necessária; o
 * valor patchado É a verdade verificada, e o sync on-focus re-confirma em ≤5min.
 */
function patchBudgetInCaches(qc: QueryClient, entityId: string, verified: UpdateEntityBudgetResponse): void {
  const patchRow = (row: any): any => {
    if (!row || typeof row !== "object") return row;
    if (!Object.prototype.hasOwnProperty.call(row, "budget_daily")) return row;
    if (String(row.group_key ?? "") !== entityId) return row;
    return { ...row, budget_daily: verified.daily_budget, budget_lifetime: verified.lifetime_budget };
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
    }
    return cached;
  });
}

export interface UseBudgetControlOptions {
  entityType: BudgetEntityType;
  entityId: string;
}

export interface UseBudgetControlReturn {
  /** Envia o novo budget (SUBUNIDADE da moeda da conta; exatamente um dos campos). Resolve true em sucesso. */
  updateBudget: (budget: BudgetInput) => Promise<boolean>;
  isLoading: boolean;
}

/**
 * Edição de orçamento de adset (ABO) / campanha (CBO), espelhando o contrato do
 * useAdStatusControl: o backend faz pre-check de modo → write → verify read-back, e a
 * resposta carrega a verdade RELIDA do Meta — é ela que entra no cache, nunca o pedido.
 */
export function useBudgetControl({ entityType, entityId }: UseBudgetControlOptions): UseBudgetControlReturn {
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (budget: BudgetInput) => {
      if (!entityId || !entityId.trim()) {
        throw new Error("entityId é obrigatório");
      }
      if (entityType === "campaign") return api.facebook.updateCampaignBudget(entityId, budget);
      return api.facebook.updateAdsetBudget(entityId, budget);
    },
    onSuccess: (data) => {
      if (data.noop) {
        toast.info("O orçamento já estava nesse valor.", { duration: 4000 });
        return;
      }
      if (!data.verified) {
        // Write ok, read-back falhou: sem verdade lida não patchamos cache — o sync
        // on-focus (≤5min) traz o valor real.
        showSuccess("Orçamento enviado ao Meta. O valor atualizado aparece em instantes.");
        return;
      }
      showSuccess("Orçamento atualizado com sucesso.");
      patchBudgetInCaches(qc, entityId, data);
    },
    onError: (e: any) => {
      const msg = e?.message || "Falha ao atualizar o orçamento.";
      // Modo errado (CBO/ABO) ou tipo errado (daily/lifetime): orientação, não falha.
      if (e?.code === "BUDGET_ON_CAMPAIGN" || e?.code === "BUDGET_ON_ADSETS" || e?.code === "BUDGET_TYPE_MISMATCH") {
        toast.warning(msg, { duration: 7000 });
        return;
      }
      showError(msg);
    },
  });

  const updateBudget = useCallback(
    async (budget: BudgetInput): Promise<boolean> => {
      try {
        await mutation.mutateAsync(budget);
        return true;
      } catch {
        // onError já mostrou a mensagem; o retorno false mantém o popover aberto.
        return false;
      }
    },
    [mutation],
  );

  return { updateBudget, isLoading: mutation.isPending };
}

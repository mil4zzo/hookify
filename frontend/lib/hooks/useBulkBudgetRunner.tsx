import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/endpoints";
import { translate } from "@/lib/i18n/translate";
import type { BatchBudgetResponse } from "@/lib/api/schemas";
import { patchBudgetsInCaches, type VerifiedBudget } from "@/lib/hooks/useBudgetControl";
import type { BulkBudgetEntityType } from "@/lib/manager/budget";
import { useBulkBudgetJobStore, type BulkBudgetJob } from "@/lib/store/bulkBudgetJob";
import { showError } from "@/lib/utils/toast";

let nextBulkBudgetJobId = 1;

/** "3 campanhas" / "1 ad set": contagem + substantivo, no idioma atual. */
export function bulkBudgetCountText(n: number, entityType: BulkBudgetEntityType) {
  return translate("manager.bulkBudget.count", { kind: entityType, count: n });
}

/**
 * Falha do lote inteiro. Só um 4xx garante que nada foi aplicado (validação, permissão, token
 * — tudo antes do primeiro write). Sem resposta, ou 5xx (proxy 502/504 com o backend ainda
 * rodando, erro depois dos writes), o backend pode ter aplicado.
 */
function describeBulkFailure(e: unknown): { message: string; maybeApplied: boolean } {
  const err = (e ?? {}) as { status?: number; message?: string };
  const maybeApplied = !err.status || err.status >= 500;
  const message = maybeApplied
    ? translate("manager.bulkBudget.job.describeFailure.maybeApplied")
    : String(err.message || translate("manager.bulkBudget.job.describeFailure.default"));
  return { message, maybeApplied };
}

/**
 * Ajuste de orçamento em massa que SOBREVIVE ao diálogo. O lote mora no store
 * (`useBulkBudgetJobStore`), não no componente: a pessoa pode minimizar o diálogo ou sair do
 * Manager no meio, e a requisição segue (o backend termina de qualquer jeito). Minimizado, o
 * card do canto (`BulkBudgetMiniCard`) acompanha o lote e reabre o diálogo no resultado.
 *
 * O cache recebe só o que o backend RELEU da Meta, como na edição individual.
 */
export function useBulkBudgetRunner() {
  const qc = useQueryClient();

  const send = useCallback(
    async (jobId: number, ids: string[]) => {
      const job = useBulkBudgetJobStore.getState().job;
      if (!job || job.id !== jobId) return;
      const isRetry = job.status !== "running";
      if (isRetry) useBulkBudgetJobStore.getState().patchJob(jobId, { retrying: ids });

      let response: BatchBudgetResponse | null = null;
      let failure: { message: string; maybeApplied: boolean } | null = null;
      try {
        response = await api.facebook.batchUpdateBudget(job.entityType, { ids, ...job.request }, job.packIds);
      } catch (e) {
        failure = describeBulkFailure(e);
      }

      if (response) {
        const verified = new Map<string, VerifiedBudget>();
        for (const item of response.items) {
          if (item.outcome === "updated" && item.verified) {
            verified.set(item.id, { daily_budget: item.daily_budget ?? null, lifetime_budget: item.lifetime_budget ?? null });
          }
        }
        patchBudgetsInCaches(qc, verified);
      }

      const store = useBulkBudgetJobStore.getState();
      const current = store.job;
      if (!current || current.id !== jobId) return; // logout/novo lote no meio
      const items = { ...current.items };
      if (response) for (const item of response.items) items[item.id] = item;

      if (isRetry) {
        // Retry que falhou inteiro não apaga o resultado anterior: só avisa. Retry que
        // respondeu tira o lote do estado de erro (agora há resultado confirmado).
        store.patchJob(jobId, response ? { items, retrying: [], status: "done", error: undefined } : { retrying: [] });
        if (failure) showError(failure.message);
        return;
      }

      store.patchJob(jobId, { items, status: failure ? "error" : "done", error: failure ?? undefined });
    },
    [qc],
  );

  const start = useCallback(
    (init: Pick<BulkBudgetJob, "entityType" | "packIds" | "request" | "rowInfo" | "sentIds" | "items">) => {
      const id = nextBulkBudgetJobId++;
      useBulkBudgetJobStore.setState({
        job: { ...init, id, status: "running", retrying: [], seen: false },
        // A seleção que abriu o formulário virou lote: "Concluir" fecha, não volta ao formulário.
        draft: null,
      });
      void send(id, init.sentIds);
    },
    [send],
  );

  const retry = useCallback(
    (ids: string[]) => {
      const job = useBulkBudgetJobStore.getState().job;
      if (job && job.status !== "running" && ids.length > 0 && job.retrying.length === 0) void send(job.id, ids);
    },
    [send],
  );

  return { start, retry };
}

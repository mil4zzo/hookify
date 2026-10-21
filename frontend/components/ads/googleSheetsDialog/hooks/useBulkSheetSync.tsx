"use client";

import { useCallback } from "react";
import { api } from "@/lib/api/endpoints";
import type { BulkSheetSyncResult } from "@/lib/api/schemas";
import { useInvalidatePackAds } from "@/lib/api/hooks";
import { logger } from "@/lib/utils/logger";
import { listNames, summarizeBulkSheetSync } from "@/lib/utils/bulkSheetSync";
import {
  dismissToast,
  finishProgressToast,
  showError,
  showProcessCancelledWarning,
  showProgressToast,
  showWarning,
} from "@/lib/utils/toast";
import { GoogleSheetsIcon } from "@/components/icons/GoogleSheetsIcon";

const POLL_MS = 1500;
// Quedas de rede seguidas toleradas no polling antes de desistir de acompanhar
// (o job segue no servidor; só a tela para de mostrar).
const MAX_POLL_ERRORS = 5;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sync de planilha em massa: UM job no servidor que sincroniza os packs em série e
 * lê cada arquivo uma vez (antes, N jobs = N leituras do arquivo inteiro ao mesmo
 * tempo). Um toast só, com "pack X de N", cancelar, e o resumo por desfecho no fim.
 */
export function useBulkSheetSync() {
  const { invalidatePackAds, invalidateAdPerformance } = useInvalidatePackAds();

  return useCallback(
    async (options: { integrationIds: string[]; packNames: Record<string, string>; title: string }): Promise<void> => {
      const { integrationIds, packNames, title } = options;
      const total = integrationIds.length;
      if (total === 0) return;
      const toastId = `sheet-bulk-${Date.now()}`;
      const icon = <GoogleSheetsIcon className="h-5 w-5 flex-shrink-0" />;
      let jobId: string | null = null;
      let cancelled = false;

      const onCancel = () => {
        cancelled = true;
        if (jobId) api.facebook.cancelJobsBatch([jobId], "Sincronização em massa cancelada pelo usuário").catch(() => {});
        dismissToast(toastId);
        showProcessCancelledWarning("sheets", title);
      };

      const paint = (done: number) =>
        showProgressToast(
          toastId,
          title,
          Math.min(done + 1, total),
          total,
          undefined,
          onCancel,
          icon,
          {
            stageLabel: `Pack ${Math.min(done + 1, total)} de ${total}`,
            stageTitle: "Sincronizando planilha",
            dynamicLine: "Lendo o arquivo uma vez para todos os packs",
            stageContext: "Leadscore",
          },
          Math.round((done / total) * 95),
        );

      paint(0);
      try {
        const started = await api.integrations.google.startBulkSyncJob(integrationIds);
        jobId = started.job_id;
        let pollErrors = 0;
        let results: BulkSheetSyncResult[] = [];
        for (;;) {
          await sleep(POLL_MS);
          if (cancelled) return;
          let progress;
          try {
            progress = await api.integrations.google.getBulkSyncJobProgress(started.job_id);
            pollErrors = 0;
          } catch (e) {
            pollErrors += 1;
            if (pollErrors >= MAX_POLL_ERRORS) throw e;
            continue;
          }
          results = progress.details?.bulk_results ?? results;
          if (progress.status === "cancelled") return;
          if (progress.status === "failed") {
            finishProgressToast(toastId, false, progress.message || "Erro ao sincronizar as planilhas.", { context: "sheets", packName: title });
            return;
          }
          if (progress.status === "completed") break;
          paint(progress.details?.bulk_done ?? 0);
        }

        const summary = summarizeBulkSheetSync(results, packNames);
        invalidateAdPerformance();
        await Promise.all(summary.packIdsWithChanges.map((packId) => invalidatePackAds(packId)));
        const syncedPackIds = results.map((r) => r.pack_id).filter((id): id is string => !!id);
        if (syncedPackIds.length) {
          // Um evento para todos: o carregador de packs recarrega a lista uma vez.
          window.dispatchEvent(new CustomEvent("pack-integration-updated", { detail: { packIds: syncedPackIds } }));
        }

        finishProgressToast(toastId, true, summary.headline, { context: "sheets", packName: title });
        if (summary.noMatch.length) {
          // O caso do pack antigo: a planilha é um arquivo só, com o conteúdo trocado a
          // cada lançamento — os anúncios dele podem não estar mais lá.
          showWarning(
            `Sem linhas correspondentes em ${listNames(summary.noMatch)}: a planilha não tem leads dos anúncios desses packs. ` +
              "Se forem de um lançamento anterior, o arquivo provavelmente já traz outro lançamento.",
          );
        }
        if (summary.failed.length) {
          showError(
            new Error(
              summary.failed.length === 1
                ? `${summary.failed[0].name}: ${summary.failed[0].error}`
                : `Falharam: ${listNames(summary.failed.map((f) => f.name))}. ${summary.failed[0].error}`,
            ),
          );
        }
      } catch (error: any) {
        logger.error("useBulkSheetSync: erro ao iniciar ou acompanhar o sync em massa", { error });
        finishProgressToast(toastId, false, error?.message || "Erro ao sincronizar as planilhas.", { context: "sheets", packName: title });
      }
    },
    [invalidatePackAds, invalidateAdPerformance],
  );
}

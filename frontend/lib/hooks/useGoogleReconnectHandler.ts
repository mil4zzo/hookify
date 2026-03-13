import React, { useEffect, useCallback, useRef } from "react";
import { usePausedSheetJobsStore } from "@/lib/store/pausedSheetJobs";
import { useGoogleOAuthConnect } from "@/lib/hooks/useGoogleOAuthConnect";
import { api } from "@/lib/api/endpoints";
import {
  showProgressToast,
  finishProgressToast,
  dismissToast,
  showProcessCancelledWarning,
  buildSheetsToastContent,
  SHEETS_TOAST_TOTAL_STEPS,
} from "@/lib/utils/toast";
import { GoogleSheetsIcon } from "@/components/icons/GoogleSheetsIcon";
import { logger } from "@/lib/utils/logger";
import { pollSheetsSyncJob } from "@/lib/utils/pollSheetsSyncJob";

const sheetsIcon = React.createElement(GoogleSheetsIcon, { className: "h-5 w-5 flex-shrink-0" });

/**
 * Hook que escuta o evento "google-connected" e retoma jobs de sincronização pausados.
 *
 * Quando o usuário reconecta a conta do Google após um token expirado:
 * 1. Fecha o toast de pausa existente
 * 2. Cria um NOVO job de sync (o anterior ficou como "failed" no backend)
 * 3. Inicia o polling do novo job via pollSheetsSyncJob (toast, cancelar, pause, reconnect)
 * 4. Limpa o job pausado da store
 */
export function useGoogleReconnectHandler() {
  const { getAllPausedJobs, clearJob, pauseJob } = usePausedSheetJobsStore();
  const { connect: connectGoogle } = useGoogleOAuthConnect();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const handleGoogleConnected = useCallback(async () => {
    const pausedJobs = getAllPausedJobs();

    if (pausedJobs.length === 0) {
      return;
    }

    logger.debug(`[useGoogleReconnectHandler] Reconexão detectada. Retomando ${pausedJobs.length} job(s) pausado(s).`);

    for (const pausedJob of pausedJobs) {
      try {
        // Fechar toast de pausa existente
        dismissToast(pausedJob.toastId);

        // Criar novo toast de progresso com mesmo layout padronizado do fluxo Sheets
        const newToastId = `sync-sheet-${pausedJob.packId}-${Date.now()}`;
        const cancelledRef = { current: false };
        const jobIdRef = { current: null as string | null };

        const handleCancelSheets = () => {
          cancelledRef.current = true;
          if (jobIdRef.current) {
            api.facebook.cancelJobsBatch([jobIdRef.current], "Importação do Leadscore cancelada pelo usuário").catch(() => {});
          }
          finishProgressToast(newToastId, false, "Importação cancelada");
          showProcessCancelledWarning("sheets", pausedJob.packName);
        };

        showProgressToast(
          newToastId,
          pausedJob.packName,
          1,
          SHEETS_TOAST_TOTAL_STEPS,
          undefined,
          handleCancelSheets,
          sheetsIcon,
          buildSheetsToastContent("processing", { stage: "lendo_planilha" }),
          0
        );

        if (!pausedJob.integrationId) {
          logger.error(`[useGoogleReconnectHandler] Job pausado sem integrationId: ${pausedJob.packId}`);
          finishProgressToast(newToastId, false, "Erro: integração não encontrada");
          clearJob(pausedJob.packId);
          continue;
        }

        // Criar NOVO job de sync (job anterior fica como "failed")
        const syncResponse = await api.integrations.google.startSyncJob(pausedJob.integrationId);

        if (!syncResponse.job_id) {
          logger.error(`[useGoogleReconnectHandler] Falha ao criar novo job para pack ${pausedJob.packId}`);
          finishProgressToast(newToastId, false, "Erro ao retomar sincronização");
          clearJob(pausedJob.packId);
          continue;
        }

        jobIdRef.current = syncResponse.job_id;
        logger.debug(`[useGoogleReconnectHandler] Novo job criado: ${syncResponse.job_id} para pack ${pausedJob.packId}`);

        // Limpar job pausado da store ANTES de iniciar polling
        // (para evitar que seja retomado novamente se houver outro evento)
        clearJob(pausedJob.packId);

        // Iniciar polling do novo job via helper compartilhado (toast, cancelar, pause, reconnect)
        pollSheetsSyncJob({
          syncJobId: syncResponse.job_id,
          toastId: newToastId,
          packName: pausedJob.packName,
          packId: pausedJob.packId,
          integrationId: pausedJob.integrationId,
          getCancelled: () => cancelledRef.current,
          getMounted: () => mountedRef.current,
          onCancel: handleCancelSheets,
          pauseJob,
          clearJob,
          connectGoogle,
          onPackIntegrationUpdated: (pId) => {
            window.dispatchEvent(new CustomEvent("pack-integration-updated", { detail: { packId: pId } }));
          },
        }).catch((error) => {
          logger.error(`[useGoogleReconnectHandler] Erro no polling do novo job:`, error);
        });
      } catch (error) {
        logger.error(`[useGoogleReconnectHandler] Erro ao retomar sync do pack ${pausedJob.packId}:`, error);
        finishProgressToast(pausedJob.toastId, false, "Erro ao retomar sincronização");
        clearJob(pausedJob.packId);
      }
    }
  }, [getAllPausedJobs, clearJob, pauseJob, connectGoogle]);

  useEffect(() => {
    // Escutar evento de reconexão do Google
    window.addEventListener("google-connected", handleGoogleConnected);

    return () => {
      window.removeEventListener("google-connected", handleGoogleConnected);
    };
  }, [handleGoogleConnected]);
}

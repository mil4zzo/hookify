"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { api } from "@/lib/api/endpoints";
import { logger } from "@/lib/utils/logger";
import { SheetSyncResponse } from "@/lib/api/schemas";
import {
  showProgressToast,
  finishProgressToast,
  showProcessCancelledWarning,
  dismissToast,
  buildSheetsToastContent,
  SHEETS_TOAST_TOTAL_STEPS,
} from "@/lib/utils/toast";
import { GoogleSheetsIcon } from "@/components/icons/GoogleSheetsIcon";
import { usePausedSheetJobsStore } from "@/lib/store/pausedSheetJobs";
import { useGoogleOAuthConnect } from "@/lib/hooks/useGoogleOAuthConnect";
import { pollSheetsSyncJob } from "@/lib/utils/pollSheetsSyncJob";
import { useInvalidatePackAds } from "@/lib/api/hooks";

type ImportStep = "idle" | "saving" | "reading" | "processing" | "complete";

export function useGoogleSyncJob() {
  const [isImporting, setIsImporting] = useState(false);
  const [importStep, setImportStep] = useState<ImportStep>("idle");
  const [importProgress, setImportProgress] = useState(0);
  const [lastSyncStats, setLastSyncStats] = useState<SheetSyncResponse["stats"] | null>(null);

  const { pauseJob, clearJob } = usePausedSheetJobsStore();
  const { connect: connectGoogle } = useGoogleOAuthConnect();
  const { invalidatePackAds, invalidateAdPerformance } = useInvalidatePackAds();
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const sheetsToastIcon = <GoogleSheetsIcon className="h-5 w-5 flex-shrink-0" />;

  /**
   * Inicia o sync e exibe o progresso no toast padronizado (3 linhas + barra + botão Cancelar).
   * Usado após fechar o modal ao criar/configurar integração.
   * Usa o helper compartilhado pollSheetsSyncJob (toast, cancelar, pause, reconnect).
   */
  const startSyncWithToast = useCallback(
    async (options: { integrationId: string; title: string; packId?: string | null }): Promise<void> => {
      const { integrationId, title, packId } = options;
      const toastId = `sheet-import-${integrationId}-${Date.now()}`;
      const packNameForWarning = title || "Importação";
      const storeKey = packId ?? integrationId;

      const jobIdRef = { current: null as string | null };
      const cancelledRef = { current: false };

      const handleCancelSheets = () => {
        cancelledRef.current = true;
        if (jobIdRef.current) {
          api.facebook.cancelJobsBatch([jobIdRef.current], "Importação do Leadscore cancelada pelo usuário").catch(() => {});
        }
        dismissToast(toastId);
        showProcessCancelledWarning("sheets", packNameForWarning);
      };

      showProgressToast(
        toastId,
        title,
        1,
        SHEETS_TOAST_TOTAL_STEPS,
        undefined,
        handleCancelSheets,
        sheetsToastIcon,
        buildSheetsToastContent("processing", { stage: "lendo_planilha" }),
        0
      );

      try {
        const { job_id } = await api.integrations.google.startSyncJob(integrationId);
        jobIdRef.current = job_id;

        const result = await pollSheetsSyncJob({
          syncJobId: job_id,
          toastId,
          packName: title,
          packId: storeKey,
          integrationId,
          getCancelled: () => cancelledRef.current,
          // Fluxo detached: o modal fecha antes do polling concluir.
          // Não interromper por unmount do componente do dialog.
          getMounted: () => true,
          onCancel: handleCancelSheets,
          pauseJob,
          clearJob,
          connectGoogle,
          onSuccessInvalidate: async (_pId) => {
            // Manager/Insights leem via useAdPerformance (staleTime: Infinity);
            // sem invalidar, leadscore só atualiza após logout/login.
            invalidateAdPerformance();
            if (packId) {
              await invalidatePackAds(packId);
            }
          },
          onPackIntegrationUpdated: packId
            ? (pId) => {
                window.dispatchEvent(new CustomEvent("pack-integration-updated", { detail: { packId: pId } }));
              }
            : undefined,
        });

        if (!result.success && !result.paused && result.error) {
          logger.warn("useGoogleSyncJob: sync finalizado com falha (toast de progresso já exibido)", {
            integrationId,
            packId,
            error: result.error,
          });
        }
      } catch (error: any) {
        const msg = error?.message || "Erro ao iniciar importação";
        logger.error("useGoogleSyncJob: erro ao iniciar ou processar sync com Google Sheets", { integrationId, packId, error });
        finishProgressToast(toastId, false, msg);
      }
    },
    [pauseJob, clearJob, connectGoogle, invalidatePackAds, invalidateAdPerformance]
  );

  /**
   * Inicia o sync a partir do Summary step (Sincronizar novamente).
   * Usa o mesmo fluxo unificado: toast com cancelar, progresso, pause e reconnect.
   */
  const startSync = useCallback(
    async (integrationId: string, packId?: string | null): Promise<void> => {
      setIsImporting(true);
      setImportStep("reading");
      setImportProgress(30);

      const toastId = `sheet-sync-${integrationId}-${Date.now()}`;
      const storeKey = packId ?? integrationId;

      const jobIdRef = { current: null as string | null };
      const cancelledRef = { current: false };
      const handleCancelSheets = () => {
        cancelledRef.current = true;
        if (jobIdRef.current) {
          api.facebook.cancelJobsBatch([jobIdRef.current], "Importação do Leadscore cancelada pelo usuário").catch(() => {});
        }
        dismissToast(toastId);
        showProcessCancelledWarning("sheets", "Planilha");
      };

      showProgressToast(
        toastId,
        "Planilha",
        1,
        SHEETS_TOAST_TOTAL_STEPS,
        undefined,
        handleCancelSheets,
        sheetsToastIcon,
        buildSheetsToastContent("processing", { stage: "lendo_planilha" }),
        0
      );

      try {
        const { job_id } = await api.integrations.google.startSyncJob(integrationId);
        jobIdRef.current = job_id;

        const result = await pollSheetsSyncJob({
          syncJobId: job_id,
          toastId,
          packName: "Planilha",
          packId: storeKey,
          integrationId,
          getCancelled: () => cancelledRef.current,
          getMounted: () => mountedRef.current,
          onCancel: handleCancelSheets,
          pauseJob,
          clearJob,
          connectGoogle,
          onCompleted: (stats) => {
            setLastSyncStats({
              processed_rows: stats.rows_processed || 0,
              updated_rows: stats.rows_updated || 0,
              skipped_no_match: 0,
              skipped_invalid: 0,
            });
          },
          onSuccessInvalidate: async (_pId) => {
            // Manager/Insights leem via useAdPerformance (staleTime: Infinity);
            // sem invalidar, leadscore só atualiza após logout/login.
            invalidateAdPerformance();
            if (packId) {
              await invalidatePackAds(packId);
            }
          },
          onPackIntegrationUpdated: packId
            ? (pId) => {
                window.dispatchEvent(new CustomEvent("pack-integration-updated", { detail: { packId: pId } }));
              }
            : undefined,
        });

        if (!result.success && !result.paused && result.error) {
          throw new Error(result.error);
        }
      } catch (error) {
        throw error;
      } finally {
        setIsImporting(false);
        setImportStep("idle");
        setImportProgress(0);
      }
    },
    [pauseJob, clearJob, connectGoogle, invalidatePackAds, invalidateAdPerformance]
  );

  const reset = useCallback(() => {
    setIsImporting(false);
    setImportStep("idle");
    setImportProgress(0);
    setLastSyncStats(null);
  }, []);

  return {
    isImporting,
    importStep,
    importProgress,
    lastSyncStats,
    setLastSyncStats,
    startSync,
    startSyncWithToast,
    reset,
  };
}

import { useState, useCallback } from "react";
import { api } from "@/lib/api/endpoints";
import { logger } from "@/lib/utils/logger";
import { SheetSyncResponse } from "@/lib/api/schemas";
import { showProgressToast, updateProgressToast, finishProgressToast, showSuccess, showError, showProcessCancelledWarning, buildSheetsToastContent, calculateSheetsProgressPercent, SHEETS_TOAST_TOTAL_STEPS } from "@/lib/utils/toast";
import { GoogleSheetsIcon } from "@/components/icons/GoogleSheetsIcon";

type ImportStep = "idle" | "saving" | "reading" | "processing" | "complete";

export function useGoogleSyncJob() {
  const [isImporting, setIsImporting] = useState(false);
  const [importStep, setImportStep] = useState<ImportStep>("idle");
  const [importProgress, setImportProgress] = useState(0);
  const [lastSyncStats, setLastSyncStats] = useState<SheetSyncResponse["stats"] | null>(null);

  const sheetsToastIcon = <GoogleSheetsIcon className="h-5 w-5 flex-shrink-0" />;

  const pollJobProgress = useCallback(async (jobId: string): Promise<void> => {
    const maxAttempts = 300; // 5 minutos (300 * 1s)
    let attempts = 0;

    const poll = async (): Promise<void> => {
      if (attempts >= maxAttempts) {
        throw new Error("Timeout ao aguardar conclusão do sync");
      }

      try {
        const progress = await api.integrations.google.getSyncJobProgress(jobId);

        // Atualizar progresso visual
        if (progress.details?.stage) {
          const stage = progress.details.stage as string;
          if (stage === "lendo_planilha") {
            setImportStep("reading");
            setImportProgress(30);
          } else if (stage === "processando_dados") {
            setImportStep("processing");
            setImportProgress(50);
          } else if (stage === "persistindo") {
            setImportStep("processing");
            setImportProgress(75);
          }
        }

        // Verificar se concluiu
        if (progress.status === "completed") {
          setImportStep("complete");
          setImportProgress(100);

          // Converter stats do job para formato esperado
          if (progress.stats) {
            setLastSyncStats({
              processed_rows: progress.stats.rows_processed || 0,
              updated_rows: progress.stats.rows_updated || 0,
              skipped_no_match: 0,
              skipped_invalid: progress.stats.rows_skipped || 0,
            });
          }

          return;
        }

        if (progress.status === "failed") {
          throw new Error(progress.message || "Erro ao processar sync");
        }

        // Continuar polling
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return poll();
      } catch (error: any) {
        // Se for erro de job não encontrado, pode ser que ainda não foi criado
        if (error?.status === 404 && attempts < 10) {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 500));
          return poll();
        }
        logger.error("useGoogleSyncJob: erro no polling do job de sync", { jobId, error });
        throw error;
      }
    };

    return poll();
  }, []);

  /**
   * Inicia o sync e exibe o progresso no toast padronizado (3 linhas + barra + botão Cancelar).
   * Usado após fechar o modal ao criar/configurar integração. Idêntico ao toast de atualização de Sheets.
   */
  const startSyncWithToast = useCallback(async (options: { integrationId: string; title: string; packId?: string | null }): Promise<void> => {
    const { integrationId, title, packId } = options;
    const toastId = `sheet-import-${integrationId}-${Date.now()}`;
    const packNameForWarning = title || "Importação";

    const jobIdRef = { current: null as string | null };
    const cancelledRef = { current: false };

    const handleCancelSheets = () => {
      cancelledRef.current = true;
      if (jobIdRef.current) {
        api.facebook.cancelJobsBatch([jobIdRef.current], "Importação do Leadscore cancelada pelo usuário").catch(() => {});
      }
      finishProgressToast(toastId, false, "Importação cancelada");
      showProcessCancelledWarning("sheets", packNameForWarning);
    };

    showProgressToast(toastId, title, 1, SHEETS_TOAST_TOTAL_STEPS, undefined, handleCancelSheets, sheetsToastIcon, buildSheetsToastContent("processing", { stage: "lendo_planilha" }), 0);

    try {
      const { job_id } = await api.integrations.google.startSyncJob(integrationId);
      jobIdRef.current = job_id;
      const maxAttempts = 300;
      let attempts = 0;

      while (attempts < maxAttempts) {
        if (cancelledRef.current) {
          if (jobIdRef.current) {
            try {
              await api.facebook.cancelJobsBatch([jobIdRef.current], "Importação do Leadscore cancelada pelo usuário");
            } catch (_) {}
          }
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (cancelledRef.current) {
          if (jobIdRef.current) {
            try {
              await api.facebook.cancelJobsBatch([jobIdRef.current], "Importação do Leadscore cancelada pelo usuário");
            } catch (_) {}
          }
          return;
        }

        const progress = await api.integrations.google.getSyncJobProgress(job_id);
        const details = (progress as any)?.details || {};

        if (progress.status === "completed") {
          const stats = (progress as any)?.stats || {};
          const updatedRows = stats.rows_updated ?? stats.updated_rows ?? 0;
          finishProgressToast(toastId, true, updatedRows > 0 ? `Planilha importada com sucesso! ${updatedRows} registros atualizados.` : "Importação concluída. Nenhuma atualização necessária.", { visibleDurationOnly: 5, context: "sheets", packName: title });
          showSuccess(updatedRows > 0 ? `Importação concluída! Atualizadas ${updatedRows} linhas em ad_metrics.` : "Importação concluída!");
          if (packId) {
            try {
              const response = await api.analytics.listPacks(false);
              if (response.success && response.packs) {
                const updatedPack = response.packs.find((p: any) => p.id === packId);
                if (updatedPack?.sheet_integration) {
                  window.dispatchEvent(
                    new CustomEvent("pack-integration-updated", {
                      detail: { packId, sheetIntegration: updatedPack.sheet_integration },
                    }),
                  );
                }
              }
            } catch (e) {
              logger.error("useGoogleSyncJob: erro ao recarregar pack após sync concluído", { packId, error: e });
            }
          }
          return;
        }

        if (progress.status === "failed") {
          const msg = progress.message || "Erro ao importar planilha";
          finishProgressToast(toastId, false, msg);
          showError(new Error(msg));
          return;
        }

        if (progress.status === "cancelled") {
          finishProgressToast(toastId, false, "Importação cancelada");
          return;
        }

        updateProgressToast(toastId, title, 1, SHEETS_TOAST_TOTAL_STEPS, undefined, handleCancelSheets, sheetsToastIcon, buildSheetsToastContent(progress.status, details), calculateSheetsProgressPercent(progress.status, details));
        attempts++;
      }

      finishProgressToast(toastId, false, "Timeout ao importar planilha (demorou mais de 10 minutos)");
      showError(new Error("Timeout ao importar planilha"));
    } catch (error: any) {
      const msg = error?.message || "Erro ao iniciar importação";
      logger.error("useGoogleSyncJob: erro ao iniciar ou processar sync com Google Sheets", { integrationId, packId, error });
      finishProgressToast(toastId, false, msg);
      showError(error instanceof Error ? error : new Error(msg));
    }
  }, []);

  const startSync = useCallback(
    async (integrationId: string): Promise<void> => {
      setIsImporting(true);
      setImportStep("reading");
      setImportProgress(30);

      try {
        const { job_id } = await api.integrations.google.startSyncJob(integrationId);
        await pollJobProgress(job_id);
      } finally {
        setIsImporting(false);
        setImportStep("idle");
        setImportProgress(0);
      }
    },
    [pollJobProgress],
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

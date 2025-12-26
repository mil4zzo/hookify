import { useState, useCallback } from "react";
import { api } from "@/lib/api/endpoints";
import { SheetSyncResponse } from "@/lib/api/schemas";

type ImportStep = "idle" | "saving" | "reading" | "processing" | "complete";

export function useGoogleSyncJob() {
  const [isImporting, setIsImporting] = useState(false);
  const [importStep, setImportStep] = useState<ImportStep>("idle");
  const [importProgress, setImportProgress] = useState(0);
  const [lastSyncStats, setLastSyncStats] = useState<SheetSyncResponse["stats"] | null>(null);

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
        throw error;
      }
    };

    return poll();
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
    [pollJobProgress]
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
    reset,
  };
}


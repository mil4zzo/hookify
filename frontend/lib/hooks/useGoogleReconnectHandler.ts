import { useEffect, useCallback } from "react";
import { usePausedSheetJobsStore } from "@/lib/store/pausedSheetJobs";
import { api } from "@/lib/api/endpoints";
import {
  showProgressToast,
  updateProgressToast,
  finishProgressToast,
  dismissToast,
} from "@/lib/utils/toast";

/**
 * Faz polling simples do job de sync do Google Sheets.
 * Esta versão NÃO pausa novamente em caso de erro - apenas reporta o erro.
 */
async function pollResumedSyncJob(
  syncJobId: string,
  toastId: string,
  packName: string
): Promise<{ success: boolean; error?: string }> {
  let attempts = 0;
  const maxAttempts = 300; // 10 minutos máximo

  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      const progress = await api.integrations.google.getSyncJobProgress(syncJobId);
      const details = (progress as any)?.details || {};

      if (progress.status === "failed") {
        finishProgressToast(
          toastId,
          false,
          `Erro ao sincronizar planilha: ${progress.message || "Erro desconhecido"}`
        );
        return { success: false, error: progress.message || "Erro desconhecido" };
      }

      // Atualizar mensagem baseada no estágio
      let message = progress.message || "Sincronizando planilha...";
      if (details.stage === "lendo_planilha") {
        message = `Lendo planilha... ${details.rows_read || 0} linhas`;
      } else if (details.stage === "processando_dados") {
        message = `Processando dados... ${details.rows_processed || 0} linhas`;
      } else if (details.stage === "persistindo") {
        message = "Salvando dados de enriquecimento...";
      }

      updateProgressToast(toastId, `Planilha: ${packName}`, 0, 1, message);

      if (progress.status === "completed") {
        const stats = (progress as any)?.stats || {};
        const updatedRows = stats.rows_updated || stats.updated_rows || 0;
        finishProgressToast(
          toastId,
          true,
          `Planilha sincronizada! ${updatedRows > 0 ? `${updatedRows} registros atualizados.` : "Nenhuma atualização necessária."}`
        );
        return { success: true };
      }
    } catch (error) {
      console.error(`[pollResumedSyncJob] Erro ao verificar progresso:`, error);
      updateProgressToast(toastId, `Planilha: ${packName}`, 0, 1, "Erro ao verificar progresso, tentando novamente...");
    }

    attempts++;
  }

  finishProgressToast(toastId, false, "Timeout ao sincronizar planilha (demorou mais de 10 minutos)");
  return { success: false, error: "Timeout" };
}

/**
 * Hook que escuta o evento "google-connected" e retoma jobs de sincronização pausados.
 *
 * Quando o usuário reconecta a conta do Google após um token expirado:
 * 1. Fecha o toast de pausa existente
 * 2. Cria um NOVO job de sync (o anterior ficou como "failed" no backend)
 * 3. Inicia o polling do novo job
 * 4. Limpa o job pausado da store
 */
export function useGoogleReconnectHandler() {
  const { getAllPausedJobs, clearJob } = usePausedSheetJobsStore();

  const handleGoogleConnected = useCallback(async () => {
    const pausedJobs = getAllPausedJobs();

    if (pausedJobs.length === 0) {
      return;
    }

    console.log(`[useGoogleReconnectHandler] Reconexão detectada. Retomando ${pausedJobs.length} job(s) pausado(s).`);

    for (const pausedJob of pausedJobs) {
      try {
        // Fechar toast de pausa existente
        dismissToast(pausedJob.toastId);

        // Criar novo toast de progresso
        const newToastId = `sync-sheet-${pausedJob.packId}-${Date.now()}`;
        showProgressToast(newToastId, `Planilha: ${pausedJob.packName}`, 0, 1, "Retomando sincronização...");

        if (!pausedJob.integrationId) {
          console.error(`[useGoogleReconnectHandler] Job pausado sem integrationId: ${pausedJob.packId}`);
          finishProgressToast(newToastId, false, "Erro: integração não encontrada");
          clearJob(pausedJob.packId);
          continue;
        }

        // Criar NOVO job de sync (job anterior fica como "failed")
        const syncResponse = await api.integrations.google.startSyncJob(pausedJob.integrationId);

        if (!syncResponse.job_id) {
          console.error(`[useGoogleReconnectHandler] Falha ao criar novo job para pack ${pausedJob.packId}`);
          finishProgressToast(newToastId, false, "Erro ao retomar sincronização");
          clearJob(pausedJob.packId);
          continue;
        }

        console.log(`[useGoogleReconnectHandler] Novo job criado: ${syncResponse.job_id} para pack ${pausedJob.packId}`);

        // Limpar job pausado da store ANTES de iniciar polling
        // (para evitar que seja retomado novamente se houver outro evento)
        clearJob(pausedJob.packId);

        // Iniciar polling do novo job (não bloqueia)
        pollResumedSyncJob(syncResponse.job_id, newToastId, pausedJob.packName).catch((error) => {
          console.error(`[useGoogleReconnectHandler] Erro no polling do novo job:`, error);
        });
      } catch (error) {
        console.error(`[useGoogleReconnectHandler] Erro ao retomar sync do pack ${pausedJob.packId}:`, error);
        finishProgressToast(pausedJob.toastId, false, "Erro ao retomar sincronização");
        clearJob(pausedJob.packId);
      }
    }
  }, [getAllPausedJobs, clearJob]);

  useEffect(() => {
    // Escutar evento de reconexão do Google
    window.addEventListener("google-connected", handleGoogleConnected);

    return () => {
      window.removeEventListener("google-connected", handleGoogleConnected);
    };
  }, [handleGoogleConnected]);
}

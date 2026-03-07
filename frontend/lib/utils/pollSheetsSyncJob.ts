/**
 * Helper compartilhado para polling de jobs de sync do Google Sheets.
 * Centraliza a lógica de progresso, toast, cancelamento e tratamento de token expirado (pause + reconnect).
 * Usado por: usePackRefresh, useGoogleSyncJob, useGoogleReconnectHandler.
 */

import { api } from "@/lib/api/endpoints";
import { pollJob } from "@/lib/utils/pollJob";
import { SHEETS_POLL_INTERVAL_MS } from "@/lib/constants/sheetsPolling";
import {
  finishProgressToast,
  updateProgressToast,
  showPausedJobToast,
  dismissToast,
  buildSheetsToastContent,
  calculateSheetsProgressPercent,
  SHEETS_TOAST_TOTAL_STEPS,
} from "@/lib/utils/toast";
import {
  handleGoogleAuthError,
  isGoogleTokenError,
  GOOGLE_TOKEN_EXPIRED,
  GOOGLE_CONNECTION_NOT_FOUND,
} from "@/lib/utils/googleAuthError";
import { AppError } from "@/lib/utils/errors";
import { logger } from "@/lib/utils/logger";
import React from "react";
import { GoogleSheetsIcon } from "@/components/icons/GoogleSheetsIcon";

const sheetsToastIcon = React.createElement(GoogleSheetsIcon, { className: "h-5 w-5 flex-shrink-0" });

export interface PollSheetsSyncJobConfig {
  syncJobId: string;
  toastId: string;
  packName: string;
  packId: string;
  integrationId: string;
  getCancelled: () => boolean;
  getMounted: () => boolean;
  onCancel?: () => void;
  pauseJob: (job: {
    syncJobId: string;
    packId: string;
    packName: string;
    toastId: string;
    integrationId: string;
    pausedAt: Date;
    reason: "google_token_expired";
  }) => void;
  clearJob: (packId: string) => void;
  connectGoogle: (opts?: { silent?: boolean }) => Promise<unknown>;
  /** Chamado ao concluir com sucesso (para atualizar lastSyncStats etc.) */
  onCompleted?: (stats: { rows_updated?: number; rows_processed?: number }) => void;
  /** Chamado ao concluir para disparar evento pack-integration-updated */
  onPackIntegrationUpdated?: (packId: string) => void;
}

export type PollSheetsSyncJobResult = {
  success: boolean;
  error?: string;
  paused?: boolean;
  needsGoogleReconnect?: boolean;
  stats?: { rows_updated?: number; rows_processed?: number };
};

export async function pollSheetsSyncJob(config: PollSheetsSyncJobConfig): Promise<PollSheetsSyncJobResult> {
  const {
    syncJobId,
    toastId,
    packName,
    packId,
    integrationId,
    getCancelled,
    getMounted,
    onCancel,
    pauseJob,
    clearJob,
    connectGoogle,
    onCompleted,
    onPackIntegrationUpdated,
  } = config;

  const pauseJobAndShowToast = (errorMessage: string) => {
    pauseJob({
      syncJobId,
      packId,
      packName,
      toastId,
      integrationId,
      pausedAt: new Date(),
      reason: "google_token_expired",
    });

    showPausedJobToast(
      toastId,
      packName,
      async () => {
        await connectGoogle({ silent: true });
      },
      () => {
        clearJob(packId);
        dismissToast(toastId);
      }
    );

    handleGoogleAuthError({ code: GOOGLE_TOKEN_EXPIRED, message: errorMessage } as AppError);
  };

  return pollJob<PollSheetsSyncJobResult>({
    label: `sheets-${syncJobId.slice(0, 8)}`,
    intervalMs: SHEETS_POLL_INTERVAL_MS,
    maxAttempts: 300, // 10 min
    getCancelled,
    getMounted,

    fetchProgress: () => api.integrations.google.getSyncJobProgress(syncJobId),

    handleProgress: (progress, lastPercent) => {
      const details = (progress as any)?.details || {};

      if (progress.status === "failed") {
        const errorCode = details?.error_code || (progress as any)?.error_code;
        const errorMessage = progress.message || "";

        const isGoogleTokenExpiredError =
          errorCode === GOOGLE_TOKEN_EXPIRED ||
          errorCode === GOOGLE_CONNECTION_NOT_FOUND ||
          (errorMessage.toLowerCase().includes("token") &&
            (errorMessage.toLowerCase().includes("expirado") ||
              errorMessage.toLowerCase().includes("expired") ||
              errorMessage.toLowerCase().includes("revogado") ||
              errorMessage.toLowerCase().includes("revoked")));

        if (isGoogleTokenExpiredError) {
          pauseJobAndShowToast(errorMessage);
          return { done: true, result: { success: false, error: errorMessage, paused: true, needsGoogleReconnect: true } };
        }

        const syncError = new Error(`Erro ao sincronizar planilha: ${progress.message || "Erro desconhecido"}`);
        logger.error(syncError);
        finishProgressToast(toastId, false, syncError.message);
        return { done: true, result: { success: false, error: progress.message || "Erro desconhecido" } };
      }

      const sheetsContent = buildSheetsToastContent(progress.status, details);
      const progressPercent = calculateSheetsProgressPercent(progress.status, details);

      updateProgressToast(
        toastId,
        packName,
        1,
        SHEETS_TOAST_TOTAL_STEPS,
        undefined,
        onCancel,
        sheetsToastIcon,
        sheetsContent,
        progressPercent
      );

      if (progress.status === "completed") {
        const stats = (progress as any)?.stats || {};
        const updatedRows = stats.rows_updated || stats.updated_rows || 0;
        finishProgressToast(
          toastId,
          true,
          `Planilha importada com sucesso! ${updatedRows > 0 ? `${updatedRows} registros atualizados.` : "Nenhuma atualização necessária."}`,
          { visibleDurationOnly: 5, context: "sheets", packName }
        );

        onCompleted?.({
          rows_updated: updatedRows,
          rows_processed: stats.rows_processed,
        });

        onPackIntegrationUpdated?.(packId);

        return { done: true, result: { success: true, stats: { rows_updated: updatedRows, rows_processed: stats.rows_processed } } };
      }

      if (progress.status === "cancelled") {
        finishProgressToast(toastId, false, `Importação do Leadscore cancelada`);
        return { done: true, result: { success: false, error: "Cancelado" } };
      }

      return { done: false, progressPercent };
    },

    handleError: (error, consecutiveErrors, lastPercent) => {
      if (isGoogleTokenError(error)) {
        const { shouldReconnect, message } = handleGoogleAuthError(error as AppError);
        if (shouldReconnect) {
          pauseJobAndShowToast(message);
          return;
        }
      }

      logger.error(`Erro ao verificar progresso do sync job ${syncJobId}:`, error);
      updateProgressToast(
        toastId,
        packName,
        1,
        SHEETS_TOAST_TOTAL_STEPS,
        undefined,
        onCancel,
        sheetsToastIcon,
        buildSheetsToastContent("processing", {}, `Erro ao verificar progresso (tentativa ${consecutiveErrors})...`),
        lastPercent
      );
    },

    onTimeout: () => {
      finishProgressToast(toastId, false, `Timeout ao sincronizar planilha (demorou mais de 10 minutos)`);
      return { success: false, error: "Timeout" };
    },
    onCancelled: () => ({ success: false, error: "Cancelado pelo usuário" }),
    onUnmounted: () => ({ success: false, error: "Componente desmontado" }),
    onMaxConsecutiveErrors: () => {
      finishProgressToast(toastId, false, `Erro persistente ao sincronizar planilha. Tente novamente.`);
      return { success: false, error: "Erros consecutivos" };
    },
  });
}

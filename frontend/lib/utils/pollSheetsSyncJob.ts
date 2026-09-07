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
  showProcessCancelledWarning,
  showSheetSyncOutcomeWarning,
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
import { AppError, normalizeJobErrorMessage } from "@/lib/utils/errors";
import { logger } from "@/lib/utils/logger";
import type { SheetSyncCustomColumnReport } from "@/lib/api/schemas";
import React from "react";

/**
 * O que o job de sync devolve ao terminar (`stats` do progresso). Nasce em
 * `run_ad_metrics_sheet_import`, é gravado no job por `google_sheet_sync_job` e
 * remontado pela rota de progresso — os três lugares precisam da mesma chave para o
 * número chegar à tela de resumo.
 */
export type SheetSyncJobStats = {
  rows_read?: number;
  rows_processed?: number;
  rows_updated?: number;
  rows_skipped?: number;
  /** As duas parcelas de `rows_skipped`, que o resumo mostra separadas. */
  skipped_invalid?: number;
  skipped_no_match?: number;
  unique_ad_date_pairs?: number;
  total_update_queries?: number;
  /** As duas parcelas de `skipped_no_match`: par inexistente x par fora do pack. */
  ids_not_found_count?: number | null;
  ids_out_of_pack_count?: number | null;
  /** 140: por coluna vinculada. */
  custom_columns?: Record<string, SheetSyncCustomColumnReport>;
  /**
   * Desfecho do sync. "no_match" = rodou inteiro e não aplicou nada; é um aviso,
   * não um erro. "empty" = planilha ainda sem nenhuma linha válida (caso legítimo).
   * Ausente em jobs antigos — o consumidor deriva de `rows_updated`.
   */
  sync_outcome?: "success" | "no_match" | "empty" | null;
  outcome_reason?: string | null;
  outcome_message?: string | null;
  sheet_date_min?: string | null;
  sheet_date_max?: string | null;
  pack_date_start?: string | null;
  pack_date_stop?: string | null;
  /** Nome atual; e o anterior quando a planilha foi renomeada na origem. */
  spreadsheet_name?: string | null;
  spreadsheet_renamed_from?: string | null;
};
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
  connectGoogle: (opts?: { silent?: boolean; packId?: string }) => Promise<unknown>;
  /** false => viewer: mostra o toast pausado sem botao de reconectar (ele nao pode). */
  canReconnect?: boolean;
  ownerName?: string | null;
  /** Chamado ao concluir com sucesso (para atualizar lastSyncStats etc.) */
  onCompleted?: (stats: SheetSyncJobStats) => void;
  /** Chamado ao concluir para disparar evento pack-integration-updated */
  onPackIntegrationUpdated?: (packId: string) => void;
  /**
   * Chamado ao concluir com sucesso, antes de onPackIntegrationUpdated.
   * Aqui o caller deve invalidar caches (TanStack Query e IndexedDB) que dependem
   * dos novos valores de leadscore em ad_metrics — sem isso, Manager exibe dados velhos
   * até logout/login (useAdPerformance tem staleTime: Infinity).
   */
  onSuccessInvalidate?: (packId: string) => void | Promise<void>;
}

export type PollSheetsSyncJobResult = {
  success: boolean;
  error?: string;
  paused?: boolean;
  needsGoogleReconnect?: boolean;
  stats?: SheetSyncJobStats;
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
    onSuccessInvalidate,
    canReconnect = true,
    ownerName = null,
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
        // packId em escopo: se o pack for compartilhado, o backend grava a
        // credencial no silo do dono (Opcao B). Para pack proprio e no-op.
        await connectGoogle({ silent: true, packId });
      },
      () => {
        clearJob(packId);
        dismissToast(toastId);
      },
      canReconnect,
      ownerName,
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

        // O cabeçalho do toast já diz "<pack>: Leadscore › Falhou" — a linha
        // principal fica com a causa do backend (sem reprefixar) e o detalhe
        // técnico vai para a linha de diagnóstico.
        const { message: userMessage, diagnostic } = normalizeJobErrorMessage(
          progress.message,
          "Não foi possível sincronizar a planilha.",
        );
        // O backend manda o detalhe técnico em details.technical; a extração da
        // mensagem é fallback para erros antigos/de outras camadas.
        const technical = typeof details?.technical === "string" ? details.technical : undefined;
        logger.error(new Error(`Sync de planilha falhou: ${progress.message || "sem mensagem"}`));
        finishProgressToast(toastId, false, userMessage, {
          context: "sheets",
          packName,
          diagnosticLine: technical ?? diagnostic,
        });
        return { done: true, result: { success: false, error: userMessage } };
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
        // O backend classifica o desfecho; `updatedRows === 0` é o fallback para
        // jobs antigos, que não carregam sync_outcome.
        const outcome: "success" | "no_match" | "empty" =
          stats.sync_outcome ?? (updatedRows > 0 ? "success" : "no_match");

        if (outcome === "success") {
          // Renomeação na origem costuma acompanhar troca de conteúdo. Num sync que
          // deu certo isso não é alarme, mas precisa ser dito: é o sinal de que o
          // arquivo pode não ser mais o mesmo que foi vinculado.
          const renameNote = stats.spreadsheet_renamed_from
            ? ` A planilha foi renomeada para "${stats.spreadsheet_name}".`
            : "";
          finishProgressToast(
            toastId,
            true,
            `Planilha importada com sucesso! ${updatedRows} registros atualizados.${renameNote}`,
            { durationSeconds: renameNote ? 9 : 5, context: "sheets", packName }
          );
        } else {
          // Rodou inteiro e não aplicou nada. Sai da pilha de progresso e vira aviso:
          // um toast verde aqui deixa o leadscore parado sem ninguém perceber.
          dismissToast(toastId);
          showSheetSyncOutcomeWarning(
            packName,
            stats.outcome_message ||
              "Nenhuma linha da planilha foi aplicada. Confira se ela está vinculada ao pack certo.",
            outcome === "empty" ? "empty" : "no_match"
          );
        }

        onCompleted?.({ ...stats, rows_updated: updatedRows });

        try {
          const maybe = onSuccessInvalidate?.(packId);
          if (maybe && typeof (maybe as Promise<void>).then === "function") {
            (maybe as Promise<void>).catch((err) => {
              logger.error("Erro ao invalidar caches após sync de leadscore:", err);
            });
          }
        } catch (err) {
          logger.error("Erro ao invalidar caches após sync de leadscore:", err);
        }

        onPackIntegrationUpdated?.(packId);

        return { done: true, result: { success: true, stats: { ...stats, rows_updated: updatedRows } } };
      }

      if (progress.status === "cancelled") {
        // Cancelamento (cliente ou servidor): nunca mostrar erro vermelho — apenas o aviso amarelo padrão.
        dismissToast(toastId);
        showProcessCancelledWarning("sheets", packName);
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
        lastPercent,
        true,
      );
    },

    onTimeout: () => {
      finishProgressToast(
        toastId, false,
        "A importação da planilha demorou mais de 10 minutos e o acompanhamento foi encerrado.",
        {
          context: "sheets",
          packName,
          diagnosticLine: "Registros já importados estão salvos. Rode a sincronização novamente se necessário.",
        }
      );
      return { success: false, error: "Timeout" };
    },
    onCancelled: () => ({ success: false, error: "Cancelado pelo usuário" }),
    onUnmounted: () => ({ success: false, error: "Componente desmontado" }),
    onMaxConsecutiveErrors: () => {
      finishProgressToast(
        toastId, false,
        "Não foi possível verificar o progresso da importação. Verifique sua conexão e tente novamente.",
        { context: "sheets", packName }
      );
      return { success: false, error: "Erros consecutivos" };
    },
  });
}

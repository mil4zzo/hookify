"use client";

/**
 * Hook centralizado para atualização de packs.
 *
 * - Polling do job Meta Ads com progresso granular
 * - Polling paralelo do Google Sheets sync
 * - Cancelamento de ambos os jobs (Meta + Sheets)
 * - Tratamento de token Google expirado com pause/reconnect
 * - Toast de progresso com botão cancelar
 * - Invalidação de cache após conclusão
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import { api } from "@/lib/api/endpoints";
import { useClientPacks } from "@/lib/hooks/useClientSession";
import { useInvalidatePackAds } from "@/lib/api/hooks";
import { useUpdatingPacksStore } from "@/lib/store/updatingPacks";
import { useActiveJobsStore } from "@/lib/store/activeJobs";
import { usePausedSheetJobsStore } from "@/lib/store/pausedSheetJobs";
import { useGoogleOAuthConnect } from "@/lib/hooks/useGoogleOAuthConnect";
import { getTodayLocal } from "@/lib/utils/dateFilters";
import {
  showProgressToast,
  updateProgressToast,
  finishProgressToast,
  showCancellingToast,
  showPausedJobToast,
  dismissToast,
  showProcessCancelledWarning,
  getMetaStageInfo,
  getMetaDynamicLine,
  buildSheetsToastContent,
  calculateSheetsProgressPercent,
  SHEETS_TOAST_TOTAL_STEPS,
  buildTranscriptionToastContent,
  calculateTranscriptionProgressPercent,
  type ProgressToastContent,
} from "@/lib/utils/toast";
import {
  handleGoogleAuthError,
  isGoogleTokenError,
  GOOGLE_TOKEN_EXPIRED,
  GOOGLE_CONNECTION_NOT_FOUND,
} from "@/lib/utils/googleAuthError";
import { AppError } from "@/lib/utils/errors";
import { AdsPack } from "@/lib/types";
import { MetaIcon } from "@/components/icons/MetaIcon";
import { GoogleSheetsIcon } from "@/components/icons/GoogleSheetsIcon";
import { logger } from "@/lib/utils/logger";
import { pollJob } from "@/lib/utils/pollJob";

// ============================================================================
// TYPES
// ============================================================================

export type RefreshType = "since_last_refresh" | "full_period";

export interface PackRefreshOptions {
  /** Called when refresh completes successfully */
  onComplete?: (result: PackRefreshResult) => void;
  /** Called when refresh fails */
  onError?: (error: Error) => void;
}

export interface PackRefreshResult {
  packId: string;
  packName: string;
  adsCount: number;
  sheetSyncSuccess?: boolean;
}

export interface StartRefreshParams {
  packId: string;
  packName: string;
  /** Defaults to "since_last_refresh" */
  refreshType?: RefreshType;
  /** Optional: Integration ID for Google Sheets (if known ahead of time) */
  sheetIntegrationId?: string;
}

export interface UsePackRefreshReturn {
  /** Start refreshing a pack */
  refreshPack: (params: StartRefreshParams) => Promise<void>;
  /** Cancel an in-progress refresh */
  cancelRefresh: (packId: string) => Promise<void>;
  /** Inicia apenas a transcrição dos vídeos do pack (sem refresh). */
  startTranscriptionOnly: (packId: string, packName: string) => Promise<void>;
  /** Check if a specific pack is currently refreshing */
  isRefreshing: (packId: string) => boolean;
  /** Get all currently refreshing pack IDs */
  refreshingPackIds: string[];
}

// Internal type to track active refresh state
interface ActiveRefresh {
  packId: string;
  packName: string;
  toastId: string;
  metaJobId: string | null;
  sheetSyncJobId: string | null;
  sheetSyncToastId: string | null;
  metaCancelled: boolean;
  sheetsCancelled: boolean;
  pendingCancellation: boolean;
  isCancelling: boolean;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const ESTIMATED_PAGES_COLLECTION = 10;

function updateActiveRefresh(
  map: React.MutableRefObject<Map<string, ActiveRefresh>>,
  packId: string,
  updates: Partial<ActiveRefresh>
) {
  const ar = map.current.get(packId);
  if (ar) Object.assign(ar, updates);
}

/**
 * Calcula progressPercent (0-100) baseado em etapas e sub-unidades.
 */
function calculateMetaProgressPercent(status: string, details: any, apiProgress?: number): number {
  if (status === "completed") return 100;
  if (status === "failed" || status === "cancelled") return 0;

  const stage = details?.stage || "";

  // Etapa 1 (0-20%): meta_running
  if (status === "meta_running" || status === "meta_completed") {
    if (apiProgress != null && apiProgress >= 0 && apiProgress <= 100) {
      return (apiProgress / 100) * 20;
    }
    return 0;
  }

  // Etapa 2 (20-40%): paginação
  if (status === "processing" && (stage === "paginação" || stage === "STAGE_PAGINATION")) {
    const pageCount = details?.page_count ?? 0;
    const pageProgress = Math.min(pageCount / ESTIMATED_PAGES_COLLECTION, 1);
    return 20 + pageProgress * 20;
  }

  // Etapa 3 (40-60%): enriquecimento
  if (status === "processing" && (stage === "enriquecimento" || stage === "STAGE_ENRICHMENT")) {
    const batchNum = details?.enrichment_batches ?? 0;
    const totalBatches = details?.enrichment_total || 1;
    const enrichProgress = totalBatches > 0 ? Math.min(batchNum / totalBatches, 1) : 0;
    return 40 + enrichProgress * 20;
  }

  // Etapa 4 (60-80%): formatação
  if (status === "processing" && (stage === "formatação" || stage === "STAGE_FORMATTING")) {
    return 60;
  }

  // Etapa 5 (80-100%): persistência
  if (status === "persisting" || (stage === "persistência" || stage === "STAGE_PERSISTENCE")) {
    const msg = details?.message || "";
    if (msg.includes("Salvando anúncios")) return 82;
    if (msg.includes("Salvando métricas")) return 86;
    if (msg.includes("Calculando")) return 90;
    if (msg.includes("Otimizando")) return 94;
    if (msg.includes("Finalizando")) return 98;
    return 80;
  }

  // processing sem stage reconhecido: assumir etapa 2 (início)
  if (status === "processing") return 20;
  return 0;
}

/** Constrói conteúdo das 3 linhas do toast Meta a partir de status e details */
function buildMetaToastContent(status: string, details: any, topLevelMessage?: string): ProgressToastContent {
  const { stepIndex, title } = getMetaStageInfo(status, details);
  const stage = details?.stage || "";
  const detailsWithMessage = topLevelMessage
    ? { ...details, message: topLevelMessage }
    : details;
  const dynamicLine = getMetaDynamicLine(status, stage, detailsWithMessage);
  return {
    stageLabel: `Etapa ${stepIndex} de 5`,
    stageTitle: title,
    dynamicLine,
    stageContext: "Meta",
  };
}

// ============================================================================
// MAIN HOOK
// ============================================================================

const metaToastIcon = React.createElement(MetaIcon, { className: "h-5 w-5 flex-shrink-0" });
const sheetsToastIcon = React.createElement(GoogleSheetsIcon, { className: "h-5 w-5 flex-shrink-0" });

const TRANSCRIPTION_TOAST_TOTAL_STEPS = 2;

export function usePackRefresh(options?: PackRefreshOptions): UsePackRefreshReturn {
  // === HOOKS ===
  const { updatePack } = useClientPacks();
  const { invalidatePackAds, invalidateAdPerformance } = useInvalidatePackAds();
  const { addUpdatingPack, removeUpdatingPack } = useUpdatingPacksStore();
  const { addActiveJob, removeActiveJob } = useActiveJobsStore();
  const { pauseJob, clearJob } = usePausedSheetJobsStore();
  const { connect: connectGoogle } = useGoogleOAuthConnect();

  // === STATE ===
  const [refreshingPackIds, setRefreshingPackIds] = useState<string[]>([]);
  const activeRefreshesRef = useRef<Map<string, ActiveRefresh>>(new Map());

  // Fix #1: cleanup on unmount
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Fix #8: stable options ref
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // ============================================================================
  // CLEANUP HELPER
  // ============================================================================

  const cleanupRefreshState = useCallback(
    (packId: string, jobId?: string | null) => {
      if (jobId) removeActiveJob(jobId);
      activeRefreshesRef.current.delete(packId);
      setRefreshingPackIds((prev) => prev.filter((id) => id !== packId));
      removeUpdatingPack(packId);
    },
    [removeActiveJob, removeUpdatingPack]
  );

  // ============================================================================
  // SHEET SYNC POLLING
  // ============================================================================

  const pollSheetSyncJob = useCallback(
    async (
      syncJobId: string,
      toastId: string,
      packName: string,
      packId: string,
      integrationId: string,
      getCancelled: () => boolean,
      onCancel?: () => void
    ): Promise<{ success: boolean; error?: string; paused?: boolean; needsGoogleReconnect?: boolean }> => {
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

      type SheetResult = { success: boolean; error?: string; paused?: boolean; needsGoogleReconnect?: boolean };

      return pollJob<SheetResult>({
        label: `sheets-${syncJobId.slice(0, 8)}`,
        maxAttempts: 300, // 10 min
        getCancelled,
        getMounted: () => mountedRef.current,

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
            toastId, packName, 1, SHEETS_TOAST_TOTAL_STEPS,
            undefined, onCancel, sheetsToastIcon, sheetsContent, progressPercent
          );

          if (progress.status === "completed") {
            const stats = (progress as any)?.stats || {};
            const updatedRows = stats.rows_updated || stats.updated_rows || 0;
            finishProgressToast(
              toastId, true,
              `Planilha importada com sucesso! ${updatedRows > 0 ? `${updatedRows} registros atualizados.` : "Nenhuma atualização necessária."}`,
              { visibleDurationOnly: 5, context: "sheets", packName }
            );

            window.dispatchEvent(
              new CustomEvent("pack-integration-updated", { detail: { packId } })
            );

            return { done: true, result: { success: true } };
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
            toastId, packName, 1, SHEETS_TOAST_TOTAL_STEPS,
            undefined, onCancel, sheetsToastIcon,
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
    },
    [pauseJob, clearJob, connectGoogle]
  );

  // ============================================================================
  // TRANSCRIPTION POLLING (used by startTranscriptionOnly)
  // ============================================================================

  const pollTranscriptionJob = useCallback(
    async (
      transcriptionJobId: string,
      toastId: string,
      packName: string,
      getCancelled: () => boolean,
      onCancel?: () => void
    ): Promise<{ success: boolean; error?: string }> => {
      type TranscriptionResult = { success: boolean; error?: string };

      return pollJob<TranscriptionResult>({
        label: `transcription-${transcriptionJobId.slice(0, 8)}`,
        maxAttempts: 300, // 10 min
        getCancelled,
        getMounted: () => mountedRef.current,

        fetchProgress: () => api.facebook.getTranscriptionProgress(transcriptionJobId),

        handleProgress: (progress, lastPercent) => {
          const details = (progress as any)?.details || {};

          const transcriptionContent = buildTranscriptionToastContent(progress.status, details);
          const progressPercent = calculateTranscriptionProgressPercent(progress.status, details);

          updateProgressToast(
            toastId, packName, 1, TRANSCRIPTION_TOAST_TOTAL_STEPS,
            undefined, onCancel, metaToastIcon, transcriptionContent, progressPercent
          );

          if (progress.status === "completed") {
            const successCount = Number(details.success_count ?? 0);
            const failCount = Number(details.fail_count ?? 0);
            const skippedExisting = Number(details.skipped_existing ?? 0);

            const summaryParts: string[] = [];
            summaryParts.push(`${successCount} sucesso(s)`);
            if (failCount > 0) summaryParts.push(`${failCount} falha(s)`);
            if (skippedExisting > 0) summaryParts.push(`${skippedExisting} já existente(s)`);

            finishProgressToast(
              toastId, true,
              `Transcrição de "${packName}" concluída (${summaryParts.join(", ")}).`,
              { visibleDurationOnly: 5, context: "transcription", packName }
            );
            return { done: true, result: { success: true } };
          }

          if (progress.status === "cancelled") {
            if (getCancelled()) {
              return { done: true, result: { success: false, error: progress.message || "Cancelado pelo usuário" } };
            }
            dismissToast(toastId);
            showProcessCancelledWarning("transcription", packName);
            return { done: true, result: { success: false, error: progress.message || "Cancelado pelo usuário" } };
          }

          if (progress.status === "failed") {
            const transcriptionError = new Error(progress.message || `Transcrição de "${packName}" falhou`);
            logger.error(transcriptionError);
            finishProgressToast(toastId, false, transcriptionError.message);
            return { done: true, result: { success: false, error: progress.message || "Falha na transcrição" } };
          }

          return { done: false, progressPercent };
        },

        handleError: (error, consecutiveErrors, lastPercent) => {
          logger.error(`Erro no polling do job de transcrição`, { transcriptionJobId, packName, error });
          updateProgressToast(
            toastId, packName, 1, TRANSCRIPTION_TOAST_TOTAL_STEPS,
            undefined, onCancel, metaToastIcon,
            buildTranscriptionToastContent("processing", {}, `Erro ao verificar progresso (tentativa ${consecutiveErrors})...`),
            lastPercent
          );
        },

        onTimeout: () => {
          finishProgressToast(toastId, false, `Timeout ao transcrever vídeos de "${packName}" (demorou mais de 10 minutos)`);
          return { success: false, error: "Timeout" };
        },
        onCancelled: () => ({ success: false, error: "Cancelado pelo usuário" }),
        onUnmounted: () => ({ success: false, error: "Componente desmontado" }),
        onMaxConsecutiveErrors: () => {
          finishProgressToast(toastId, false, `Erro persistente ao transcrever vídeos. Tente novamente.`);
          return { success: false, error: "Erros consecutivos" };
        },
      });
    },
    []
  );

  // ============================================================================
  // START TRANSCRIPTION ONLY (manual, standalone)
  // ============================================================================

  const startTranscriptionOnly = useCallback(
    async (packId: string, packName: string): Promise<void> => {
      const toastId = `transcription-only-${packId}`;
      let cancelled = false;
      let cancelWarningShown = false;
      const jobIdRef = { current: null as string | null };

      const showCancelledWarningOnce = () => {
        if (cancelWarningShown) return;
        cancelWarningShown = true;
        showProcessCancelledWarning("transcription", packName);
      };

      const handleCancelTranscriptionOnly = async () => {
        if (cancelled) return;
        cancelled = true;
        if (jobIdRef.current) {
          try {
            await api.facebook.cancelJobsBatch([jobIdRef.current], "Transcrição cancelada pelo usuário");
            dismissToast(toastId);
            showCancelledWarningOnce();
          } catch (error) {
            logger.error("Erro ao cancelar transcrição:", error);
            dismissToast(toastId);
          }
        } else {
          dismissToast(toastId);
          showCancelledWarningOnce();
        }
      };

      showProgressToast(
        toastId, packName, 1, TRANSCRIPTION_TOAST_TOTAL_STEPS,
        undefined, handleCancelTranscriptionOnly, metaToastIcon,
        buildTranscriptionToastContent("processing", {}), 0
      );

      try {
        const res = await api.facebook.startPackTranscription(packId);
        if (cancelled) {
          if (res.transcription_job_id) {
            try {
              await api.facebook.cancelJobsBatch([res.transcription_job_id], "Transcrição cancelada pelo usuário");
            } catch (err) {
              logger.error("Erro ao cancelar transcrição pendente:", err);
            }
            dismissToast(toastId);
            showCancelledWarningOnce();
          }
          return;
        }
        if (res.transcription_job_id) {
          jobIdRef.current = res.transcription_job_id;
          updateProgressToast(
            toastId, packName, 1, TRANSCRIPTION_TOAST_TOTAL_STEPS,
            undefined, handleCancelTranscriptionOnly, metaToastIcon,
            buildTranscriptionToastContent("processing", {}), 0
          );
          pollTranscriptionJob(res.transcription_job_id, toastId, packName, () => cancelled, handleCancelTranscriptionOnly).catch((err) => {
            logger.error("Erro no polling da transcrição:", err);
          });
        } else {
          finishProgressToast(toastId, false, res.message || "Todos anúncios já estão transcritos.");
        }
      } catch (error) {
        logger.error("Erro ao iniciar transcrição:", error);
        finishProgressToast(toastId, false, error instanceof Error ? error.message : "Erro ao iniciar transcrição");
      }
    },
    [pollTranscriptionJob]
  );

  // ============================================================================
  // CANCEL REFRESH
  // ============================================================================

  const cancelRefresh = useCallback(async (packId: string): Promise<void> => {
    const activeRefresh = activeRefreshesRef.current.get(packId);
    if (!activeRefresh || activeRefresh.isCancelling) {
      return;
    }

    logger.debug(`[PACK_REFRESH] Cancelando todos os processos do pack ${packId}`);

    updateActiveRefresh(activeRefreshesRef, packId, {
      isCancelling: true,
      metaCancelled: true,
      sheetsCancelled: true,
    });

    const jobsToCancel: string[] = [];
    if (activeRefresh.metaJobId) jobsToCancel.push(activeRefresh.metaJobId);
    if (activeRefresh.sheetSyncJobId) jobsToCancel.push(activeRefresh.sheetSyncJobId);

    if (jobsToCancel.length > 0) {
      try {
        await api.facebook.cancelJobsBatch(jobsToCancel, "Cancelado pelo usuário");
        logger.debug(`[PACK_REFRESH] Jobs cancelados: ${jobsToCancel.join(", ")}`);
      } catch (error) {
        logger.error("Erro ao cancelar jobs:", error);
      }
    } else if (!activeRefresh.metaJobId) {
      updateActiveRefresh(activeRefreshesRef, packId, { pendingCancellation: true });
    }

    if (activeRefresh.sheetSyncToastId) {
      finishProgressToast(activeRefresh.sheetSyncToastId, false, "Importação do Leadscore cancelada pelo usuário");
      showProcessCancelledWarning("sheets", activeRefresh.packName);
    }
    if (activeRefresh.toastId) {
      showCancellingToast(activeRefresh.toastId, activeRefresh.packName, metaToastIcon);
      setTimeout(() => {
        dismissToast(activeRefresh.toastId);
        showProcessCancelledWarning("meta", activeRefresh.packName);
      }, 500);
    }

    // Fix #5: cleanup state immediately on cancel
    cleanupRefreshState(packId, activeRefresh.metaJobId);
  }, [cleanupRefreshState]);

  // ============================================================================
  // REFRESH PACK
  // ============================================================================

  const refreshPack = useCallback(
    async (params: StartRefreshParams): Promise<void> => {
      const {
        packId,
        packName,
        refreshType = "since_last_refresh",
        sheetIntegrationId,
      } = params;

      if (activeRefreshesRef.current.has(packId)) {
        logger.warn(`[PACK_REFRESH] Pack ${packId} já está em refresh, ignorando`);
        return;
      }

      logger.debug(`[PACK_REFRESH] Iniciando refresh do pack ${packId} (${packName})`);

      const toastId = `refresh-pack-${packId}`;
      const activeRefresh: ActiveRefresh = {
        packId,
        packName,
        toastId,
        metaJobId: null,
        sheetSyncJobId: null,
        sheetSyncToastId: null,
        metaCancelled: false,
        sheetsCancelled: false,
        pendingCancellation: false,
        isCancelling: false,
      };
      activeRefreshesRef.current.set(packId, activeRefresh);

      setRefreshingPackIds((prev) => [...prev, packId]);
      addUpdatingPack(packId);

      // Capture Sheets poll promise for finally await (Fix #2)
      let sheetsPollPromise: Promise<any> | null = null;

      const handleCancelMeta = async () => {
        const ar = activeRefreshesRef.current.get(packId);
        if (!ar || ar.metaCancelled) return;
        updateActiveRefresh(activeRefreshesRef, packId, { metaCancelled: true });
        logger.debug(`[PACK_REFRESH] Cancelando apenas Meta do pack ${packId}`);
        if (ar.metaJobId) {
          try {
            showCancellingToast(ar.toastId, ar.packName, metaToastIcon);
            await api.facebook.cancelJobsBatch([ar.metaJobId], "Atualização Meta cancelada pelo usuário");
            finishProgressToast(ar.toastId, false, "Atualização Meta cancelada pelo usuário");
            showProcessCancelledWarning("meta", ar.packName);
          } catch (error) {
            logger.error("Erro ao cancelar job Meta:", error);
            finishProgressToast(ar.toastId, false, "Erro ao cancelar atualização Meta");
          }
        } else {
          updateActiveRefresh(activeRefreshesRef, packId, { pendingCancellation: true });
          dismissToast(ar.toastId);
          showProcessCancelledWarning("meta", ar.packName);
        }
      };

      const handleCancelSheets = async () => {
        const ar = activeRefreshesRef.current.get(packId);
        if (!ar || ar.sheetsCancelled) return;
        updateActiveRefresh(activeRefreshesRef, packId, { sheetsCancelled: true });
        logger.debug(`[PACK_REFRESH] Cancelando apenas Sheets do pack ${packId}`);
        if (ar.sheetSyncJobId && ar.sheetSyncToastId) {
          try {
            await api.facebook.cancelJobsBatch([ar.sheetSyncJobId], "Importação do Leadscore cancelada pelo usuário");
            finishProgressToast(ar.sheetSyncToastId, false, "Importação do Leadscore cancelada pelo usuário");
            showProcessCancelledWarning("sheets", ar.packName);
          } catch (error) {
            logger.error("Erro ao cancelar sync job:", error);
            finishProgressToast(ar.sheetSyncToastId, false, "Erro ao cancelar importação da planilha");
          }
        } else if (ar.sheetSyncToastId) {
          dismissToast(ar.sheetSyncToastId);
          showProcessCancelledWarning("sheets", ar.packName);
        }
      };

      // Show toast immediately (before any await)
      showProgressToast(
        toastId, packName, 1, 5,
        undefined, handleCancelMeta, metaToastIcon,
        buildMetaToastContent("meta_running", {}), 0
      );

      // Show Sheets toast immediately if integration is known
      if (sheetIntegrationId) {
        updateActiveRefresh(activeRefreshesRef, packId, { sheetSyncToastId: `sync-sheet-${packId}` });
        showProgressToast(
          `sync-sheet-${packId}`, packName, 1, SHEETS_TOAST_TOTAL_STEPS,
          undefined, handleCancelSheets, sheetsToastIcon,
          buildSheetsToastContent("processing", { stage: "lendo_planilha" }), 0
        );
      }

      let refreshResult: { job_id?: string; date_range?: { since: string; until: string }; sync_job_id?: string } | null = null;

      try {
        refreshResult = await api.facebook.refreshPack(packId, getTodayLocal(), refreshType);

        // Capture sync_job_id from initial response
        const syncJobIdFromResponse = refreshResult?.sync_job_id;
        if (syncJobIdFromResponse) {
          updateActiveRefresh(activeRefreshesRef, packId, {
            sheetSyncJobId: syncJobIdFromResponse,
            sheetSyncToastId: activeRefresh.sheetSyncToastId || `sync-sheet-${packId}`,
          });
          logger.debug(`[PACK_REFRESH] sync_job_id capturado do response inicial: ${syncJobIdFromResponse}`);
        }

        // Check if Meta was cancelled before receiving job_id
        if (activeRefresh.metaCancelled && activeRefresh.pendingCancellation && refreshResult.job_id) {
          logger.debug(`[PACK_REFRESH] Executando cancelamento pendente do Meta job ${refreshResult.job_id}`);
          try {
            await api.facebook.cancelJobsBatch([refreshResult.job_id], "Atualização Meta cancelada pelo usuário");
          } catch (error) {
            logger.error("Erro ao cancelar job Meta pendente:", error);
          }
          // Sheets continues if it has sync_job_id
          if (activeRefresh.sheetSyncJobId && activeRefresh.sheetSyncToastId) {
            try {
              await pollSheetSyncJob(
                activeRefresh.sheetSyncJobId, activeRefresh.sheetSyncToastId,
                packName, packId, sheetIntegrationId || "",
                () => activeRefresh.sheetsCancelled, handleCancelSheets
              );
            } catch (error) {
              logger.error(`Erro no polling do sync job:`, error);
            }
          }
          return;
        }

        if (!refreshResult.job_id) {
          finishProgressToast(toastId, false, `Erro ao iniciar atualização de "${packName}"`);
          return;
        }

        updateActiveRefresh(activeRefreshesRef, packId, { metaJobId: refreshResult.job_id });

        if (!addActiveJob(refreshResult.job_id)) {
          logger.warn(`[PACK_REFRESH] Polling já ativo para job ${refreshResult.job_id}. Ignorando...`);
          finishProgressToast(toastId, false, `Este job já está sendo processado. Aguarde a conclusão.`);
          return;
        }

        // Start Sheets polling immediately if we have sync_job_id
        if (activeRefresh.sheetSyncJobId && activeRefresh.sheetSyncToastId) {
          logger.debug(`[PACK_REFRESH] Iniciando polling do Sheets imediatamente`);
          updateProgressToast(
            activeRefresh.sheetSyncToastId, packName, 1, SHEETS_TOAST_TOTAL_STEPS,
            undefined, handleCancelSheets, sheetsToastIcon,
            buildSheetsToastContent("processing", { stage: "lendo_planilha" }), 0
          );
          sheetsPollPromise = pollSheetSyncJob(
            activeRefresh.sheetSyncJobId, activeRefresh.sheetSyncToastId,
            packName, packId, sheetIntegrationId || "",
            () => activeRefresh.sheetsCancelled, handleCancelSheets
          ).catch((error) => {
            logger.error(`Erro no polling do sync job:`, error);
          });
        } else if (!activeRefresh.sheetSyncJobId && activeRefresh.sheetSyncToastId) {
          // Toast was created early but API didn't return sync_job_id
          dismissToast(activeRefresh.sheetSyncToastId);
          updateActiveRefresh(activeRefreshesRef, packId, { sheetSyncToastId: null });
        }

        const dateRange = refreshResult.date_range;
        if (!dateRange) {
          finishProgressToast(toastId, false, `Erro: intervalo de datas não disponível para "${packName}"`);
          return;
        }

        updateProgressToast(
          toastId, packName, 1, 5,
          undefined, handleCancelMeta, metaToastIcon,
          buildMetaToastContent("meta_running", {}),
          calculateMetaProgressPercent("meta_running", {})
        );

        // ====== META POLLING via pollJob (Fix #3: 15 min timeout, Fix #4: preserve progress) ======
        type MetaResult = { completed: boolean; adsCount: number; error?: string };
        const jobId = refreshResult.job_id;

        const metaResult = await pollJob<MetaResult>({
          label: `meta-${jobId.slice(0, 8)}`,
          maxAttempts: 450, // 15 min
          getCancelled: () => activeRefresh.metaCancelled,
          getMounted: () => mountedRef.current,

          fetchProgress: () => api.facebook.getJobProgress(jobId),

          handleProgress: (progress, lastPercent) => {
            const details = (progress as any)?.details || {};

            // Detect sync_job_id from polling and start Sheets if needed
            if (details.sync_job_id && !activeRefresh.sheetSyncJobId) {
              updateActiveRefresh(activeRefreshesRef, packId, {
                sheetSyncJobId: details.sync_job_id,
                sheetSyncToastId: activeRefresh.sheetSyncToastId || `sync-sheet-${packId}`,
              });
              logger.debug(`[PACK_REFRESH] sync_job_id capturado do polling: ${details.sync_job_id}`);

              const integrationIdToUse = sheetIntegrationId || details.integration_id || "";

              updateProgressToast(
                activeRefresh.sheetSyncToastId!, packName, 1, SHEETS_TOAST_TOTAL_STEPS,
                undefined, handleCancelSheets, sheetsToastIcon,
                buildSheetsToastContent("processing", { stage: "lendo_planilha" }), 0
              );
              sheetsPollPromise = pollSheetSyncJob(
                activeRefresh.sheetSyncJobId!, activeRefresh.sheetSyncToastId!,
                packName, packId, integrationIdToUse,
                () => activeRefresh.sheetsCancelled, handleCancelSheets
              ).catch((error) => {
                logger.error(`Erro no polling do sync job:`, error);
              });
            }

            const apiProgress = (progress as any)?.progress;
            const progressPercent = calculateMetaProgressPercent(progress.status, details, apiProgress);

            updateProgressToast(
              toastId, packName, 1, 5,
              undefined, handleCancelMeta, metaToastIcon,
              buildMetaToastContent(progress.status, details, (progress as any)?.message),
              progressPercent
            );

            if (progress.status === "completed") {
              const adsCount = Array.isArray(progress.data) ? progress.data.length : 0;
              return { done: true, result: { completed: true, adsCount } };
            }

            if (progress.status === "failed") {
              const failError = new Error(`Erro ao atualizar "${packName}": ${progress.message || "Erro desconhecido"}`);
              logger.error(failError);
              finishProgressToast(toastId, false, failError.message);
              optionsRef.current?.onError?.(failError);
              return { done: true, result: { completed: false, adsCount: 0, error: progress.message } };
            }

            if (progress.status === "cancelled") {
              return { done: true, result: { completed: false, adsCount: 0, error: "Cancelado" } };
            }

            return { done: false, progressPercent };
          },

          handleError: (error, consecutiveErrors, lastPercent) => {
            logger.error(`Erro ao verificar progresso do pack ${packId}:`, error);
            updateProgressToast(
              toastId, packName, 1, 5,
              undefined, handleCancelMeta, metaToastIcon,
              {
                stageLabel: "Etapa 1 de 5",
                stageTitle: "Verificando...",
                dynamicLine: `Erro ao verificar progresso (tentativa ${consecutiveErrors})...`,
              },
              lastPercent
            );
          },

          onTimeout: () => {
            finishProgressToast(toastId, false, `Timeout ao atualizar "${packName}" (demorou mais de 15 minutos)`);
            optionsRef.current?.onError?.(new Error("Timeout"));
            return { completed: false, adsCount: 0, error: "Timeout" };
          },
          onCancelled: () => ({ completed: false, adsCount: 0, error: "Cancelado" }),
          onUnmounted: () => ({ completed: false, adsCount: 0, error: "Componente desmontado" }),
          onMaxConsecutiveErrors: () => {
            finishProgressToast(toastId, false, `Erro persistente ao atualizar "${packName}". Tente novamente.`);
            optionsRef.current?.onError?.(new Error("Erros consecutivos"));
            return { completed: false, adsCount: 0, error: "Erros consecutivos" };
          },
        });

        // Handle Meta completion
        if (metaResult.completed) {
          const metaSuccessMessage =
            metaResult.adsCount > 0
              ? `Anúncios atualizados com sucesso. ${metaResult.adsCount} anúncios atualizados.`
              : "Anúncios atualizados com sucesso.";
          finishProgressToast(
            toastId, true, metaSuccessMessage,
            { visibleDurationOnly: 5, context: "meta", packName }
          );

          // Fix #11: fetch only the refreshed pack instead of all packs
          try {
            const response = await api.analytics.getPack(packId, false);
            if (response.success && response.pack) {
              const updatedPack = response.pack;
              updatePack(packId, {
                stats: updatedPack.stats || {},
                updated_at: updatedPack.updated_at || new Date().toISOString(),
                auto_refresh: updatedPack.auto_refresh !== undefined ? updatedPack.auto_refresh : undefined,
                date_stop: updatedPack.date_stop,
              } as Partial<AdsPack>);

              await invalidatePackAds(packId);
            }

            invalidateAdPerformance();
          } catch (error) {
            logger.error("Erro ao recarregar pack após refresh:", error);
          }

          optionsRef.current?.onComplete?.({
            packId,
            packName,
            adsCount: metaResult.adsCount,
          });
        }
      } catch (error) {
        if (!activeRefresh.metaCancelled) {
          logger.error(`Erro ao atualizar pack ${packId}:`, error);
          finishProgressToast(
            toastId, false,
            `Erro ao atualizar "${packName}": ${error instanceof Error ? error.message : "Erro desconhecido"}`
          );
          optionsRef.current?.onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      } finally {
        logger.debug(`[PACK_REFRESH] Finalizando refresh do pack ${packId}`);

        // Fix #2: wait for Sheets to finish before cleaning up
        if (sheetsPollPromise) {
          try { await sheetsPollPromise; } catch {}
        }

        cleanupRefreshState(packId, refreshResult?.job_id);
      }
    },
    [
      addUpdatingPack,
      addActiveJob,
      updatePack,
      invalidatePackAds,
      invalidateAdPerformance,
      pollSheetSyncJob,
      cleanupRefreshState,
    ]
  );

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  const isRefreshing = useCallback(
    (packId: string): boolean => refreshingPackIds.includes(packId),
    [refreshingPackIds]
  );

  return {
    refreshPack,
    cancelRefresh,
    startTranscriptionOnly,
    isRefreshing,
    refreshingPackIds,
  };
}

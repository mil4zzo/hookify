"use client";

/**
 * Hook centralizado para atualização de packs.
 *
 * Processos modulares e independentes:
 * - Meta Ads: polling com progresso granular
 * - Leadscore (Google Sheets): sync independente via startSyncJob
 * - Transcrição: transcrição de vídeos independente
 *
 * Cada processo tem seu próprio toast, cancelamento e cleanup.
 */

import React, { useCallback, useRef, useEffect } from "react";
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
  dismissToast,
  showProcessCancelledWarning,
  buildSheetsToastContent,
  calculateSheetsProgressPercent,
  SHEETS_TOAST_TOTAL_STEPS,
  buildTranscriptionToastContent,
  calculateTranscriptionProgressPercent,
  calculateMetaProgressPercent,
  buildMetaToastContent,
  type ProgressToastContent,
} from "@/lib/utils/toast";
import { AppError } from "@/lib/utils/errors";
import { AdsPack } from "@/lib/types";
import { MetaIcon } from "@/components/icons/MetaIcon";
import { GoogleSheetsIcon } from "@/components/icons/GoogleSheetsIcon";
import { logger } from "@/lib/utils/logger";
import { pollJob } from "@/lib/utils/pollJob";
import { pollSheetsSyncJob } from "@/lib/utils/pollSheetsSyncJob";

// ============================================================================
// TYPES
// ============================================================================

export type RefreshType = "since_last_refresh" | "full_period";

export interface RefreshToggles {
  meta: boolean;
  leadscore: boolean;
  transcription: boolean;
}

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
  /** Which processes to run. Defaults to { meta: true, leadscore: true, transcription: false } */
  toggles?: RefreshToggles;
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
  transcriptionJobId: string | null;
  transcriptionToastId: string | null;
  metaCancelled: boolean;
  sheetsCancelled: boolean;
  transcriptionCancelled: boolean;
  pendingCancellation: boolean;
  isCancelling: boolean;
  toggles: RefreshToggles;
}

const activeRefreshes = new Map<string, ActiveRefresh>();
const BACKGROUND_JOB_IS_MOUNTED = () => true;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function updateActiveRefresh(packId: string, updates: Partial<ActiveRefresh>) {
  const ar = activeRefreshes.get(packId);
  if (ar) Object.assign(ar, updates);
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
  const updatingPackIds = useUpdatingPacksStore((state) => state.updatingPackIds);
  const refreshingPackIds = Array.from(updatingPackIds);
  const { addActiveJob, removeActiveJob } = useActiveJobsStore();
  const { pauseJob, clearJob } = usePausedSheetJobsStore();
  const { connect: connectGoogle } = useGoogleOAuthConnect();

  // Track local mount only for optional UI callbacks; background polling survives route changes.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Fix #8: stable options ref
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // ============================================================================
  // CLEANUP HELPER
  // ============================================================================

  const cleanupRefreshState = useCallback(
    (packId: string, jobId?: string | null) => {
      if (jobId) removeActiveJob(jobId);
      activeRefreshes.delete(packId);
      useUpdatingPacksStore.getState().removeUpdatingPack(packId);
    },
    [removeActiveJob]
  );

  // ============================================================================
  // SHEET SYNC POLLING (usa helper compartilhado pollSheetsSyncJob)
  // ============================================================================

  const runPollSheetsSyncJob = useCallback(
    (
      syncJobId: string,
      toastId: string,
      packName: string,
      packId: string,
      integrationId: string,
      getCancelled: () => boolean,
      onCancel?: () => void
    ) =>
      pollSheetsSyncJob({
        syncJobId,
        toastId,
        packName,
        packId,
        integrationId,
        getCancelled,
        getMounted: BACKGROUND_JOB_IS_MOUNTED,
        onCancel,
        pauseJob,
        clearJob,
        connectGoogle,
        onPackIntegrationUpdated: (pId) => {
          window.dispatchEvent(new CustomEvent("pack-integration-updated", { detail: { packId: pId } }));
        },
      }),
    [pauseJob, clearJob, connectGoogle]
  );

  // ============================================================================
  // TRANSCRIPTION POLLING
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
        getMounted: BACKGROUND_JOB_IS_MOUNTED,

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
    const activeRefresh = activeRefreshes.get(packId);
    if (!activeRefresh || activeRefresh.isCancelling) {
      return;
    }

    logger.debug(`[PACK_REFRESH] Cancelando todos os processos do pack ${packId}`);

    updateActiveRefresh(packId, {
      isCancelling: true,
      metaCancelled: true,
      sheetsCancelled: true,
      transcriptionCancelled: true,
    });

    const jobsToCancel: string[] = [];
    if (activeRefresh.metaJobId) jobsToCancel.push(activeRefresh.metaJobId);
    if (activeRefresh.sheetSyncJobId) jobsToCancel.push(activeRefresh.sheetSyncJobId);
    if (activeRefresh.transcriptionJobId) jobsToCancel.push(activeRefresh.transcriptionJobId);

    if (jobsToCancel.length > 0) {
      try {
        await api.facebook.cancelJobsBatch(jobsToCancel, "Cancelado pelo usuário");
        logger.debug(`[PACK_REFRESH] Jobs cancelados: ${jobsToCancel.join(", ")}`);
      } catch (error) {
        logger.error("Erro ao cancelar jobs:", error);
      }
    } else if (!activeRefresh.metaJobId) {
      updateActiveRefresh(packId, { pendingCancellation: true });
    }

    if (activeRefresh.sheetSyncToastId) {
      finishProgressToast(activeRefresh.sheetSyncToastId, false, "Importação do Leadscore cancelada pelo usuário");
      showProcessCancelledWarning("sheets", activeRefresh.packName);
    }
    if (activeRefresh.transcriptionToastId) {
      finishProgressToast(activeRefresh.transcriptionToastId, false, "Transcrição cancelada pelo usuário");
      showProcessCancelledWarning("transcription", activeRefresh.packName);
    }
    if (activeRefresh.toastId && activeRefresh.toggles.meta) {
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
  // MODULAR PROCESS: META REFRESH
  // ============================================================================

  const runMetaRefresh = useCallback(
    async (
      packId: string,
      packName: string,
      refreshType: RefreshType,
      activeRefresh: ActiveRefresh,
    ): Promise<{ completed: boolean; adsCount: number }> => {
      const toastId = activeRefresh.toastId;
      const startTime = Date.now();

      const handleCancelMeta = async () => {
        const ar = activeRefreshes.get(packId);
        if (!ar || ar.metaCancelled) return;
        updateActiveRefresh(packId, { metaCancelled: true });
        logger.debug(`[PACK_REFRESH] Cancelando Meta do pack ${packId}`);
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
          updateActiveRefresh(packId, { pendingCancellation: true });
          dismissToast(ar.toastId);
          showProcessCancelledWarning("meta", ar.packName);
        }
      };

      // Show toast immediately
      showProgressToast(
        toastId, packName, 1, 5,
        undefined, handleCancelMeta, metaToastIcon,
        buildMetaToastContent("meta_running", {}), 0
      );

      // Always skip_sheets_sync — frontend controls Sheets independently now
      const refreshResult = await api.facebook.refreshPack(packId, getTodayLocal(), refreshType, true);

      const jobId = refreshResult.job_id ? String(refreshResult.job_id) : "";

      // Check if Meta was cancelled before receiving job_id
      if (activeRefresh.metaCancelled && activeRefresh.pendingCancellation && jobId) {
        logger.debug(`[PACK_REFRESH] Executando cancelamento pendente do Meta job ${jobId}`);
        try {
          await api.facebook.cancelJobsBatch([jobId], "Atualização Meta cancelada pelo usuário");
        } catch (error) {
          logger.error("Erro ao cancelar job Meta pendente:", error);
        }
        return { completed: false, adsCount: 0 };
      }

      if (!jobId) {
        finishProgressToast(toastId, false, `Erro ao iniciar atualização de "${packName}"`);
        return { completed: false, adsCount: 0 };
      }

      updateActiveRefresh(packId, { metaJobId: jobId });

      if (!addActiveJob(jobId)) {
        logger.warn(`[PACK_REFRESH] Polling já ativo para job ${jobId}. Ignorando...`);
        finishProgressToast(toastId, false, `Este job já está sendo processado. Aguarde a conclusão.`);
        return { completed: false, adsCount: 0 };
      }

      const dateRange = refreshResult.date_range;
      if (!dateRange) {
        finishProgressToast(toastId, false, `Erro: intervalo de datas não disponível para "${packName}"`);
        return { completed: false, adsCount: 0 };
      }

      updateProgressToast(
        toastId, packName, 1, 5,
        undefined, handleCancelMeta, metaToastIcon,
        buildMetaToastContent("meta_running", {}),
        calculateMetaProgressPercent("meta_running", {})
      );

      type MetaResult = { completed: boolean; adsCount: number; error?: string };
      const metaResult = await pollJob<MetaResult>({
        label: `meta-${jobId.slice(0, 8)}`,
        maxAttempts: 450, // 15 min
        getCancelled: () => activeRefresh.metaCancelled,
        getMounted: BACKGROUND_JOB_IS_MOUNTED,

        fetchProgress: () => api.facebook.getJobProgress(jobId),

        handleProgress: (progress, lastPercent) => {
          const details = (progress as any)?.details || {};
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
            if (mountedRef.current) {
              optionsRef.current?.onError?.(failError);
            }
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
          if (mountedRef.current) {
            optionsRef.current?.onError?.(new Error("Timeout"));
          }
          return { completed: false, adsCount: 0, error: "Timeout" };
        },
        onCancelled: () => ({ completed: false, adsCount: 0, error: "Cancelado" }),
        onUnmounted: () => ({ completed: false, adsCount: 0, error: "Componente desmontado" }),
        onMaxConsecutiveErrors: () => {
          finishProgressToast(toastId, false, `Erro persistente ao atualizar "${packName}". Tente novamente.`);
          if (mountedRef.current) {
            optionsRef.current?.onError?.(new Error("Erros consecutivos"));
          }
          return { completed: false, adsCount: 0, error: "Erros consecutivos" };
        },
      });

      // Handle Meta completion
      if (metaResult.completed) {
        const elapsedSec = Math.round((Date.now() - startTime) / 1000);
        const elapsedStr = elapsedSec >= 60
          ? `${Math.floor(elapsedSec / 60)}min e ${elapsedSec % 60}s`
          : `${elapsedSec}s`;
        const metaSuccessMessage =
          metaResult.adsCount > 0
            ? `Pack "${packName}" atualizado com ${metaResult.adsCount} anúncios (${elapsedStr}).`
            : `Pack "${packName}" atualizado com sucesso (${elapsedStr}).`;
        finishProgressToast(
          toastId, true, metaSuccessMessage,
          { visibleDurationOnly: 5, context: "meta", packName }
        );

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

        if (mountedRef.current) {
          optionsRef.current?.onComplete?.({
            packId,
            packName,
            adsCount: metaResult.adsCount,
          });
        }
      }

      return metaResult;
    },
    [addActiveJob, updatePack, invalidatePackAds, invalidateAdPerformance]
  );

  // ============================================================================
  // MODULAR PROCESS: LEADSCORE (SHEETS) SYNC
  // ============================================================================

  const runLeadscoreSync = useCallback(
    async (
      packId: string,
      packName: string,
      integrationId: string,
      activeRefresh: ActiveRefresh,
    ): Promise<{ success: boolean; paused?: boolean; error?: string }> => {
      const toastId = `sync-sheet-${packId}`;
      updateActiveRefresh(packId, { sheetSyncToastId: toastId });

      const handleCancelSheets = async () => {
        const ar = activeRefreshes.get(packId);
        if (!ar || ar.sheetsCancelled) return;
        updateActiveRefresh(packId, { sheetsCancelled: true });
        logger.debug(`[PACK_REFRESH] Cancelando Sheets do pack ${packId}`);
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

      // Show toast immediately
      showProgressToast(
        toastId, packName, 1, SHEETS_TOAST_TOTAL_STEPS,
        undefined, handleCancelSheets, sheetsToastIcon,
        buildSheetsToastContent("processing", { stage: "lendo_planilha" }), 0
      );

      try {
        // Start sync job independently via dedicated endpoint
        const syncResult = await api.integrations.google.startSyncJob(integrationId);
        const syncJobId = syncResult.job_id;

        if (!syncJobId) {
          finishProgressToast(toastId, false, "Erro ao iniciar sincronização do Leadscore");
          return { success: false };
        }

        updateActiveRefresh(packId, { sheetSyncJobId: syncJobId });

        if (activeRefresh.sheetsCancelled) {
          try {
            await api.facebook.cancelJobsBatch([syncJobId], "Importação do Leadscore cancelada pelo usuário");
          } catch {}
          return { success: false };
        }

        // Poll the sync job
        const pollResult = await runPollSheetsSyncJob(
          syncJobId, toastId, packName, packId, integrationId,
          () => activeRefresh.sheetsCancelled, handleCancelSheets
        );

        return {
          success: pollResult.success,
          paused: pollResult.paused,
          error: pollResult.error,
        };
      } catch (error) {
        logger.error("Erro ao iniciar sync do Leadscore:", error);
        const message = error instanceof Error ? error.message : "Erro ao iniciar sincronização do Leadscore";
        finishProgressToast(toastId, false, message);
        return { success: false, error: message };
      }
    },
    [runPollSheetsSyncJob]
  );

  // ============================================================================
  // MODULAR PROCESS: TRANSCRIPTION (within refresh flow)
  // ============================================================================

  const runTranscription = useCallback(
    async (
      packId: string,
      packName: string,
      activeRefresh: ActiveRefresh,
    ): Promise<{ success: boolean }> => {
      const toastId = `transcription-refresh-${packId}`;
      updateActiveRefresh(packId, { transcriptionToastId: toastId });

      const handleCancelTranscription = async () => {
        const ar = activeRefreshes.get(packId);
        if (!ar || ar.transcriptionCancelled) return;
        updateActiveRefresh(packId, { transcriptionCancelled: true });
        if (ar.transcriptionJobId) {
          try {
            await api.facebook.cancelJobsBatch([ar.transcriptionJobId], "Transcrição cancelada pelo usuário");
            dismissToast(toastId);
            showProcessCancelledWarning("transcription", packName);
          } catch (error) {
            logger.error("Erro ao cancelar transcrição:", error);
            dismissToast(toastId);
          }
        } else {
          dismissToast(toastId);
          showProcessCancelledWarning("transcription", packName);
        }
      };

      showProgressToast(
        toastId, packName, 1, TRANSCRIPTION_TOAST_TOTAL_STEPS,
        undefined, handleCancelTranscription, metaToastIcon,
        buildTranscriptionToastContent("processing", {}), 0
      );

      try {
        const res = await api.facebook.startPackTranscription(packId);

        if (activeRefresh.transcriptionCancelled) {
          if (res.transcription_job_id) {
            try {
              await api.facebook.cancelJobsBatch([res.transcription_job_id], "Transcrição cancelada pelo usuário");
            } catch {}
          }
          dismissToast(toastId);
          return { success: false };
        }

        if (res.transcription_job_id) {
          updateActiveRefresh(packId, { transcriptionJobId: res.transcription_job_id });

          const result = await pollTranscriptionJob(
            res.transcription_job_id, toastId, packName,
            () => activeRefresh.transcriptionCancelled, handleCancelTranscription
          );

          return { success: result.success };
        } else {
          finishProgressToast(toastId, false, res.message || "Todos anúncios já estão transcritos.");
          return { success: true };
        }
      } catch (error) {
        logger.error("Erro ao iniciar transcrição:", error);
        finishProgressToast(toastId, false, error instanceof Error ? error.message : "Erro ao iniciar transcrição");
        return { success: false };
      }
    },
    [pollTranscriptionJob]
  );

  // ============================================================================
  // REFRESH PACK (orchestrator)
  // ============================================================================

  const refreshPack = useCallback(
    async (params: StartRefreshParams): Promise<void> => {
      const {
        packId,
        packName,
        refreshType = "since_last_refresh",
        sheetIntegrationId,
        toggles = { meta: true, leadscore: true, transcription: false },
      } = params;

      // At least one toggle must be active
      if (!toggles.meta && !toggles.leadscore && !toggles.transcription) {
        logger.warn(`[PACK_REFRESH] Nenhum processo selecionado para o pack ${packId}`);
        return;
      }

      if (activeRefreshes.has(packId)) {
        logger.warn(`[PACK_REFRESH] Pack ${packId} já está em refresh, ignorando`);
        return;
      }

      logger.debug(`[PACK_REFRESH] Iniciando refresh do pack ${packId} (${packName}) — toggles: meta=${toggles.meta}, leadscore=${toggles.leadscore}, transcription=${toggles.transcription}`);

      const toastId = `refresh-pack-${packId}`;
      const activeRefresh: ActiveRefresh = {
        packId,
        packName,
        toastId,
        metaJobId: null,
        sheetSyncJobId: null,
        sheetSyncToastId: null,
        transcriptionJobId: null,
        transcriptionToastId: null,
        metaCancelled: false,
        sheetsCancelled: false,
        transcriptionCancelled: false,
        pendingCancellation: false,
        isCancelling: false,
        toggles,
      };
      activeRefreshes.set(packId, activeRefresh);
      useUpdatingPacksStore.getState().addUpdatingPack(packId);

      const promises: Promise<any>[] = [];
      let leadscoreStarted = false;
      let leadscoreResult: { success: boolean; paused?: boolean; error?: string } = { success: false, error: "Leadscore não executado" };

      try {
        // Start all selected processes in parallel
        if (toggles.meta) {
          promises.push(
            runMetaRefresh(packId, packName, refreshType, activeRefresh).catch((error) => {
              if (!activeRefresh.metaCancelled) {
                logger.error(`Erro ao atualizar pack ${packId} (Meta):`, error);
                finishProgressToast(
                  toastId, false,
                  `Erro ao atualizar "${packName}": ${error instanceof Error ? error.message : "Erro desconhecido"}`
                );
                if (mountedRef.current) {
                  optionsRef.current?.onError?.(error instanceof Error ? error : new Error(String(error)));
                }
              }
            })
          );
        }

        if (toggles.leadscore && sheetIntegrationId) {
          leadscoreStarted = true;
          promises.push(
            runLeadscoreSync(packId, packName, sheetIntegrationId, activeRefresh)
              .then((result) => {
                leadscoreResult = result;
                if (!result.success && !result.paused && !activeRefresh.sheetsCancelled && mountedRef.current) {
                  optionsRef.current?.onError?.(
                    new Error(result.error || `Falha na sincronização de Leadscore para "${packName}"`)
                  );
                }
              })
              .catch((error) => {
                logger.error(`Erro no Leadscore do pack ${packId}:`, error);
                leadscoreResult = { success: false, error: error instanceof Error ? error.message : String(error) };
                if (!activeRefresh.sheetsCancelled && mountedRef.current) {
                  optionsRef.current?.onError?.(
                    error instanceof Error ? error : new Error(String(error))
                  );
                }
              })
          );
        } else if (toggles.leadscore && !sheetIntegrationId) {
          logger.warn(`[PACK_REFRESH] Leadscore habilitado, mas pack ${packId} não possui integração de planilha`);
        }

        if (toggles.transcription) {
          promises.push(
            runTranscription(packId, packName, activeRefresh).catch((error) => {
              logger.error(`Erro na transcrição do pack ${packId}:`, error);
            })
          );
        }

        // Wait for all processes to complete
        await Promise.allSettled(promises);
        if (leadscoreStarted) {
          if (leadscoreResult.success) {
            logger.debug(`[PACK_REFRESH] Leadscore concluído com sucesso para pack ${packId}`);
          } else if (leadscoreResult.paused) {
            logger.info(`[PACK_REFRESH] Leadscore pausado aguardando reconexão Google para pack ${packId}`);
          } else {
            logger.warn(`[PACK_REFRESH] Leadscore finalizado com falha para pack ${packId}: ${leadscoreResult.error || "erro desconhecido"}`);
          }
        }
      } finally {
        logger.debug(`[PACK_REFRESH] Finalizando refresh do pack ${packId}`);
        const ar = activeRefreshes.get(packId);
        cleanupRefreshState(packId, ar?.metaJobId);
      }
    },
    [
      runMetaRefresh,
      runLeadscoreSync,
      runTranscription,
      cleanupRefreshState,
    ]
  );

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  const isRefreshing = useCallback(
    (packId: string): boolean => useUpdatingPacksStore.getState().isPackUpdating(packId),
    []
  );

  return {
    refreshPack,
    cancelRefresh,
    startTranscriptionOnly,
    isRefreshing,
    refreshingPackIds,
  };
}

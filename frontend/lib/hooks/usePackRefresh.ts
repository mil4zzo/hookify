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
import { useClientPacks, useClientAuth } from "@/lib/hooks/useClientSession";
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
  showInfo,
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
import { AppError, parseError, normalizeJobErrorMessage } from "@/lib/utils/errors";
import { AdsPack } from "@/lib/types";
import { MetaIcon } from "@/components/icons/MetaIcon";
import { GoogleSheetsIcon } from "@/components/icons/GoogleSheetsIcon";
import { logger } from "@/lib/utils/logger";
import { pollJob } from "@/lib/utils/pollJob";
import { pollPackBackgroundTasks } from "@/lib/utils/pollPackBackgroundTasks";
import { pollSheetsSyncJob } from "@/lib/utils/pollSheetsSyncJob";

/**
 * Monta linha de diagnóstico (mono) para erros vindos do `meta_error` do backend.
 * Mostra apenas IDs úteis para suporte (account_id, time_ref, fbtrace_id, code/subcode).
 */
function buildMetaErrorDiagnosticLine(metaError: Record<string, unknown> | undefined): string | undefined {
  if (!metaError) return undefined;
  const parts: string[] = [];
  const account = metaError.account_id;
  const timeRef = metaError.time_ref;
  const trace = metaError.fbtrace_id;
  const code = metaError.code;
  const subcode = metaError.subcode;
  if (account) parts.push(`account=${account}`);
  if (timeRef) parts.push(`time_ref=${timeRef}`);
  if (trace) parts.push(`trace=${trace}`);
  if (code != null) parts.push(`code=${code}${subcode != null ? `/${subcode}` : ""}`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * Detecta se o erro retornado pela Meta indica scope OAuth faltando.
 * Padrões observados:
 * - `code=3` + mensagem com "GK" / "must pass" — Gate Keeper interno disparado por scope ausente
 * - `code=200` + "Missing Permission" — clássica falta de permissão
 * - `code=10` + mensagem mencionando permissão específica
 */
function isMetaScopeError(metaError: Record<string, unknown> | undefined): boolean {
  if (!metaError) return false;
  const code = metaError.code;
  const message = String(metaError.message || "").toLowerCase();
  if (code === 200) return true;
  if (code === 3 && (message.includes("gk") || message.includes("must pass"))) return true;
  if (message.includes("missing permission") || message.includes("permissão")) return true;
  return false;
}

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
  /** Inicia apenas a transcrição dos vídeos do pack (sem refresh). adNames filtra quais ads transcrever. */
  startTranscriptionOnly: (packId: string, packName: string, adNames?: string[], options?: { forceNoAudio?: boolean }) => Promise<void>;
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
  /** true ⇒ o backend orquestra o sync do Leadscore após o Meta (response server_chain). */
  serverChain: boolean;
  /** Timeout pendente para o "Cancelando..." → dismiss + warning. Limpado em cleanupRefreshState. */
  cancelTimeoutId?: ReturnType<typeof setTimeout> | null;
}

const activeRefreshes = new Map<string, ActiveRefresh>();
const BACKGROUND_JOB_IS_MOUNTED = () => true;

// Re-attach de jobs ativos: 1 tentativa por carregamento de página, independente
// de quantas instâncias do hook montarem (Topbar, /packs, etc.).
let jobReattachAttempted = false;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function updateActiveRefresh(packId: string, updates: Partial<ActiveRefresh>) {
  const ar = activeRefreshes.get(packId);
  if (ar) Object.assign(ar, updates);
}

// ============================================================================
// FILA SERIAL DE REFRESH
// ============================================================================
// Atualizar vários packs ao mesmo tempo saturava (a) o BANCO — cada refresh faz
// upserts grandes em ad_metrics/ads e a contenção estourava o statement_timeout
// (Postgres 57014 "canceling statement due to statement timeout" ao salvar
// métricas) — e (b) os SOCKETS do backend (em dev Windows: WinError 10035
// "WSAEWOULDBLOCK" ao salvar anúncios). Serializar os refresh na raiz elimina as
// duas causas de uma vez, e é seguro porque os upserts são idempotentes
// (reescrevem valores absolutos). Singleton de módulo → vale entre TODOS os
// callers (Topbar, cards, página de packs), independente da instância do hook.

/** Quantos refresh podem PROCESSAR de fato ao mesmo tempo. 1 = estritamente em fila. */
const REFRESH_MAX_CONCURRENCY = 1;
let refreshActiveCount = 0;
const refreshQueue: Array<() => void> = [];

function pumpRefreshQueue(): void {
  while (refreshActiveCount < REFRESH_MAX_CONCURRENCY && refreshQueue.length > 0) {
    const run = refreshQueue.shift()!;
    refreshActiveCount++;
    run();
  }
}

/** Enfileira `task`; resolve/rejeita com o resultado dela, respeitando a concorrência máxima. */
function enqueueRefresh<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    refreshQueue.push(() => {
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          refreshActiveCount--;
          pumpRefreshQueue();
        });
    });
    pumpRefreshQueue();
  });
}

/** Este novo refresh vai ter que esperar (algo já processando ou na frente na fila)? */
function refreshWillQueue(): boolean {
  return refreshActiveCount >= REFRESH_MAX_CONCURRENCY || refreshQueue.length > 0;
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
      const ar = activeRefreshes.get(packId);
      if (ar?.cancelTimeoutId) {
        clearTimeout(ar.cancelTimeoutId);
        ar.cancelTimeoutId = null;
      }
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
        onSuccessInvalidate: async (pId) => {
          // Sem isso, Manager mantém leadscore velho até logout/login
          // (useAdPerformance tem staleTime: Infinity).
          await invalidatePackAds(pId);
          invalidateAdPerformance();
        },
        onPackIntegrationUpdated: (pId) => {
          window.dispatchEvent(new CustomEvent("pack-integration-updated", { detail: { packId: pId } }));
        },
      }),
    [pauseJob, clearJob, connectGoogle, invalidatePackAds, invalidateAdPerformance]
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
        // Com stallTimeoutMs, o job só é abandonado se o backend ficar mudo
        // (sem heartbeat/keepalive) por 5 min — o que significa morte real do
        // processo (restart/crash), nunca lentidão. Job vivo = polling infinito
        // (a assinatura inclui o keepalive de 30s e reseta os attempts).
        maxAttempts: 1800,
        stallTimeoutMs: 5 * 60_000,
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
            const noAudioCount = Number(details.no_audio_count ?? 0);
            const skippedExisting = Number(details.skipped_existing ?? 0);

            // Batch 100% sem-áudio: constatação, não falha — mensagem dedicada.
            let summary: string;
            if (successCount === 0 && failCount === 0 && noAudioCount > 0) {
              summary = `Transcrição de "${packName}" concluída: ${noAudioCount === 1 ? "1 vídeo não tem" : `${noAudioCount} vídeos não têm`} áudio detectável para transcrever.`;
            } else {
              const summaryParts: string[] = [];
              summaryParts.push(`${successCount} sucesso(s)`);
              if (failCount > 0) summaryParts.push(`${failCount} falha(s)`);
              if (noAudioCount > 0) summaryParts.push(`${noAudioCount} sem áudio`);
              if (skippedExisting > 0) summaryParts.push(`${skippedExisting} já existente(s)`);
              summary = `Transcrição de "${packName}" concluída (${summaryParts.join(", ")}).`;
            }

            finishProgressToast(
              toastId, true,
              summary,
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
            const { message: userMessage, diagnostic } = normalizeJobErrorMessage(
              progress.message,
              `Não foi possível concluir a transcrição de "${packName}".`,
            );
            logger.error(new Error(`Transcrição falhou: ${progress.message || "sem mensagem"}`));
            const lastError = (details as any)?.last_error_message;
            const diagnosticLine = lastError && typeof lastError === "string" && !userMessage.includes(lastError)
              ? lastError
              : diagnostic;
            finishProgressToast(toastId, false, userMessage, {
              context: "transcription",
              packName,
              diagnosticLine,
            });
            return { done: true, result: { success: false, error: progress.message || "Falha na transcrição" } };
          }

          return {
            done: false,
            progressPercent,
            progressSignature: `${progress.status}:${details.done ?? ""}/${details.total ?? ""}:${details.keepalive_at ?? ""}`,
          };
        },

        handleError: (error, consecutiveErrors, lastPercent) => {
          logger.error(`Erro no polling do job de transcrição`, { transcriptionJobId, packName, error });
          updateProgressToast(
            toastId, packName, 1, TRANSCRIPTION_TOAST_TOTAL_STEPS,
            undefined, onCancel, metaToastIcon,
            buildTranscriptionToastContent("processing", {}, `Erro ao verificar progresso (tentativa ${consecutiveErrors})...`),
            lastPercent,
            true,
          );
        },

        onTimeout: () => {
          // Só chega aqui se o backend ficou 5 min sem heartbeat/keepalive —
          // morte real do processo (restart/crash), não lentidão.
          finishProgressToast(
            toastId, false,
            `A transcrição de "${packName}" foi interrompida no servidor.`,
            {
              context: "transcription",
              packName,
              diagnosticLine: "Transcrições já concluídas estão salvas. Rode novamente para retomar as pendentes.",
            }
          );
          return { success: false, error: "Backend sem resposta (sem heartbeat por 5 min)" };
        },
        onCancelled: () => ({ success: false, error: "Cancelado pelo usuário" }),
        onUnmounted: () => ({ success: false, error: "Componente desmontado" }),
        onMaxConsecutiveErrors: () => {
          finishProgressToast(toastId, false, `Erro persistente ao transcrever vídeos. Tente novamente.`, { context: "transcription", packName });
          return { success: false, error: "Erros consecutivos" };
        },
      });
    },
    []
  );

  // ============================================================================
  // META REFRESH POLLING (helper compartilhado: fluxo normal + re-attach)
  // ============================================================================
  // Além de acompanhar, o polling de getJobProgress é o que DIRIGE a fase 2 do
  // refresh no servidor (claim/self-healing) — re-anexar o polling RETOMA um
  // job estacionado. No completed, executa o pós-processamento completo
  // (background tasks, updatePack, invalidações) e devolve chainedSyncJobId
  // quando o backend encadeou o sync do Leadscore (cadeia server-side).

  const pollMetaRefreshJob = useCallback(
    async (
      jobId: string,
      toastId: string,
      packId: string,
      packName: string,
      getCancelled: () => boolean,
      onCancel: (() => void) | undefined,
      startTime: number,
    ): Promise<{ completed: boolean; adsCount: number; error?: string; chainedSyncJobId?: string }> => {
      type MetaResult = { completed: boolean; adsCount: number; error?: string; chainedSyncJobId?: string };
      const metaResult = await pollJob<MetaResult>({
        label: `meta-${jobId.slice(0, 8)}`,
        maxAttempts: 450, // 15 min
        getCancelled,
        getMounted: BACKGROUND_JOB_IS_MOUNTED,

        fetchProgress: () => api.facebook.getJobProgress(jobId),

        handleProgress: (progress, lastPercent) => {
          const details = (progress as any)?.details || {};
          const apiProgress = (progress as any)?.progress;
          const progressPercent = calculateMetaProgressPercent(progress.status, details, apiProgress);

          updateProgressToast(
            toastId, packName, 1, 5,
            undefined, onCancel, metaToastIcon,
            buildMetaToastContent(progress.status, details, (progress as any)?.message),
            progressPercent
          );

          if (progress.status === "completed") {
            const adsCount = Array.isArray(progress.data) ? progress.data.length : 0;
            const chainedSyncJobId = typeof details.chained_sync_job_id === "string" && details.chained_sync_job_id
              ? details.chained_sync_job_id
              : undefined;
            return { done: true, result: { completed: true, adsCount, chainedSyncJobId } };
          }

          if (progress.status === "failed") {
            const metaError = (details as any)?.meta_error as Record<string, unknown> | undefined;

            // Se Meta indicou scope faltando, mostrar mensagem direcionada à reauth
            // em vez do erro técnico cru.
            const scopeError = isMetaScopeError(metaError);
            // Sem reprefixar: o cabeçalho já identifica pack e etapa. Detalhe
            // técnico (repr de exceção) vai para a linha de diagnóstico.
            const normalized = normalizeJobErrorMessage(
              progress.message,
              `Não foi possível concluir a atualização de "${packName}".`,
            );
            const userMessage = scopeError
              ? `Esta conta de anúncios exige uma permissão que não está autorizada na conexão Facebook. Vá em "Configurações → Conexões" e clique em "Atualizar permissões".`
              : normalized.message;
            const diagnosticLine = buildMetaErrorDiagnosticLine(metaError) ?? normalized.diagnostic;

            const failError = new Error(userMessage);
            logger.error(failError);
            finishProgressToast(toastId, false, userMessage, { context: "meta", packName, diagnosticLine });
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
            undefined, onCancel, metaToastIcon,
            {
              stageLabel: "Etapa 1 de 5",
              stageTitle: "Verificando...",
              dynamicLine: `Erro ao verificar progresso (tentativa ${consecutiveErrors})...`,
            },
            lastPercent,
            true,
          );
        },

        onTimeout: () => {
          finishProgressToast(
            toastId, false,
            `A atualização de "${packName}" passou de 15 minutos e o acompanhamento foi encerrado.`,
            {
              context: "meta",
              packName,
              diagnosticLine: "O processamento pode continuar no servidor. Recarregue a página para reacompanhar.",
            }
          );
          if (mountedRef.current) {
            optionsRef.current?.onError?.(new Error("Timeout"));
          }
          return { completed: false, adsCount: 0, error: "Timeout" };
        },
        onCancelled: () => ({ completed: false, adsCount: 0, error: "Cancelado" }),
        onUnmounted: () => ({ completed: false, adsCount: 0, error: "Componente desmontado" }),
        onMaxConsecutiveErrors: () => {
          finishProgressToast(
            toastId, false,
            "Não foi possível verificar o progresso da atualização. Verifique sua conexão e tente novamente.",
            {
              context: "meta",
              packName,
              diagnosticLine: "O processamento pode continuar no servidor. Recarregue a página para reacompanhar.",
            }
          );
          if (mountedRef.current) {
            optionsRef.current?.onError?.(new Error("Erros consecutivos"));
          }
          return { completed: false, adsCount: 0, error: "Erros consecutivos" };
        },
      });

      // Handle Meta completion
      if (metaResult.completed) {
        pollPackBackgroundTasks(jobId, packId);

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
    [updatePack, invalidatePackAds, invalidateAdPerformance]
  );

  // ============================================================================
  // START TRANSCRIPTION ONLY (manual, standalone)
  // ============================================================================

  const startTranscriptionOnly = useCallback(
    async (packId: string, packName: string, adNames?: string[], options?: { forceNoAudio?: boolean }): Promise<void> => {
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
        const res = await api.facebook.startPackTranscription(packId, adNames, options?.forceNoAudio);
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
          // Não é sucesso nem falha: nada para transcrever. Toast neutro informativo.
          dismissToast(toastId);
          showInfo(res.message || "Todos anúncios já estão transcritos.");
        }
      } catch (error) {
        logger.error("Erro ao iniciar transcrição:", error);
        const { message, diagnostic } = normalizeJobErrorMessage(
          parseError(error).message,
          "Não foi possível iniciar a transcrição.",
        );
        finishProgressToast(toastId, false, message, { context: "transcription", packName, diagnosticLine: diagnostic });
      }
    },
    [pollTranscriptionJob]
  );

  // ============================================================================
  // RE-ATTACH DE JOBS ATIVOS (após reload/login)
  // ============================================================================
  // O backend processa jobs fire-and-forget: um reload/logout não os interrompe,
  // mas a UI perdia o acompanhamento. Ao carregar o app, buscamos jobs com
  // heartbeat recente e retomamos toast + polling. Cobre transcrição e
  // leadscore (google_sheet_sync); meta refresh exige retomar também a cadeia
  // pós-conclusão (leadscore/transcrição/invalidations) e entra depois.

  const reattachTranscriptionJob = useCallback(
    (jobId: string, packName: string, initialProgress: number) => {
      if (!addActiveJob(jobId)) return; // já há polling deste job nesta sessão
      const toastId = `transcription-reattach-${jobId}`;
      let cancelled = false;

      const handleCancel = async () => {
        if (cancelled) return;
        cancelled = true;
        try {
          await api.facebook.cancelJobsBatch([jobId], "Transcrição cancelada pelo usuário");
        } catch (error) {
          logger.error("Erro ao cancelar transcrição re-anexada:", error);
        }
        dismissToast(toastId);
        showProcessCancelledWarning("transcription", packName);
      };

      showProgressToast(
        toastId, packName, 1, TRANSCRIPTION_TOAST_TOTAL_STEPS,
        undefined, handleCancel, metaToastIcon,
        {
          stageLabel: "Reconectando",
          stageTitle: "Transcrição em andamento",
          dynamicLine: "Verificando progresso atual…",
          stageContext: "Transcrevendo",
        }, initialProgress
      );

      pollTranscriptionJob(jobId, toastId, packName, () => cancelled, handleCancel)
        .catch((err) => logger.error("Erro no polling re-anexado da transcrição:", err))
        .finally(() => removeActiveJob(jobId));
    },
    [addActiveJob, removeActiveJob, pollTranscriptionJob]
  );

  // Também usado pelo fluxo normal para OBSERVAR o sync encadeado pelo backend
  // (cadeia server-side) — por isso devolve o resultado do polling. Nunca rejeita.
  const reattachSheetSyncJob = useCallback(
    async (
      jobId: string,
      packId: string,
      packName: string,
      integrationId: string
    ): Promise<{ success: boolean; paused?: boolean; error?: string } | undefined> => {
      if (!addActiveJob(jobId)) return undefined; // já há polling deste job nesta sessão
      const toastId = `sheets-reattach-${jobId}`;
      let cancelled = false;

      const handleCancel = async () => {
        if (cancelled) return;
        cancelled = true;
        try {
          await api.facebook.cancelJobsBatch([jobId], "Sincronização cancelada pelo usuário");
        } catch (error) {
          logger.error("Erro ao cancelar sync re-anexado:", error);
        }
        dismissToast(toastId);
        showProcessCancelledWarning("sheets", packName);
      };

      showProgressToast(
        toastId, packName, 1, SHEETS_TOAST_TOTAL_STEPS,
        undefined, handleCancel, sheetsToastIcon,
        {
          stageLabel: "Reconectando",
          stageTitle: "Sincronização em andamento",
          dynamicLine: "Verificando progresso atual…",
          stageContext: "Leadscore",
        }, 0
      );

      try {
        return await runPollSheetsSyncJob(jobId, toastId, packName, packId, integrationId, () => cancelled, handleCancel);
      } catch (err) {
        logger.error("Erro no polling re-anexado do sync de planilha:", err);
        return undefined;
      } finally {
        removeActiveJob(jobId);
      }
    },
    [addActiveJob, removeActiveJob, runPollSheetsSyncJob]
  );

  // Re-attach do refresh Meta: além do toast, o próprio polling RETOMA o
  // processamento server-side (claim/self-healing em get_job_progress). Se o
  // backend encadeou o sync do Leadscore, anexa o acompanhamento dele ao final.
  const reattachMetaRefreshJob = useCallback(
    (jobId: string, packId: string, packName: string, integrationId?: string) => {
      if (!addActiveJob(jobId)) return; // já há polling deste job nesta sessão
      useUpdatingPacksStore.getState().addUpdatingPack(packId);
      const toastId = `meta-reattach-${jobId}`;
      let cancelled = false;

      const handleCancel = async () => {
        if (cancelled) return;
        cancelled = true;
        try {
          showCancellingToast(toastId, packName, metaToastIcon);
          await api.facebook.cancelJobsBatch([jobId], "Atualização Meta cancelada pelo usuário");
          dismissToast(toastId);
          showProcessCancelledWarning("meta", packName);
        } catch (error) {
          logger.error("Erro ao cancelar refresh re-anexado:", error);
          finishProgressToast(
            toastId, false,
            "Não foi possível cancelar a atualização. Ela pode continuar rodando no servidor.",
            { context: "meta", packName }
          );
        }
      };

      // Conteúdo inicial próprio de re-attach: o job já está em andamento no
      // servidor — o primeiro poll sobrescreve com o estágio real.
      showProgressToast(
        toastId, packName, 1, 5,
        undefined, handleCancel, metaToastIcon,
        {
          stageLabel: "Reconectando",
          stageTitle: "Atualização em andamento",
          dynamicLine: "Verificando progresso atual…",
          stageContext: "Meta",
        }, 0
      );

      (async () => {
        try {
          const metaResult = await pollMetaRefreshJob(
            jobId, toastId, packId, packName, () => cancelled, handleCancel, Date.now()
          );
          if (metaResult.completed && metaResult.chainedSyncJobId) {
            let integ = integrationId;
            if (!integ) {
              try {
                const res = await api.integrations.google.listSheetIntegrations(packId);
                integ = res.integrations?.[0]?.id;
              } catch (error) {
                logger.warn("Não foi possível resolver integração para sync encadeado:", { error });
              }
            }
            if (integ) {
              reattachSheetSyncJob(metaResult.chainedSyncJobId, packId, packName, integ);
            }
          }
        } catch (err) {
          logger.error("Erro no polling re-anexado do refresh Meta:", err);
        } finally {
          removeActiveJob(jobId);
          useUpdatingPacksStore.getState().removeUpdatingPack(packId);
        }
      })();
    },
    [addActiveJob, removeActiveJob, pollMetaRefreshJob, reattachSheetSyncJob]
  );

  const { isAuthenticated, isClient } = useClientAuth();
  useEffect(() => {
    if (!isClient || !isAuthenticated || jobReattachAttempted) return;
    // Pequeno delay para não competir com o bootstrap da sessão.
    const timeout = setTimeout(async () => {
      if (jobReattachAttempted) return;
      jobReattachAttempted = true;
      try {
        const res = await api.facebook.getActiveJobs();
        for (const job of res.jobs ?? []) {
          if (job.type === "transcription") {
            logger.info(`[JOB_REATTACH] Retomando acompanhamento de transcrição (job ${job.job_id})`);
            reattachTranscriptionJob(job.job_id, job.pack_name || "Pack", job.progress ?? 0);
          } else if (job.type === "google_sheet_sync" && job.pack_id && job.integration_id) {
            logger.info(`[JOB_REATTACH] Retomando acompanhamento de sync de planilha (job ${job.job_id})`);
            reattachSheetSyncJob(job.job_id, job.pack_id, job.pack_name || "Pack", job.integration_id);
          } else if (job.type === "pack_refresh" && job.pack_id) {
            logger.info(`[JOB_REATTACH] Retomando acompanhamento de refresh Meta (job ${job.job_id})`);
            reattachMetaRefreshJob(job.job_id, job.pack_id, job.pack_name || "Pack");
          }
        }
      } catch (error) {
        // Best-effort: sem re-attach o job segue no backend; nada a interromper.
        logger.warn("[JOB_REATTACH] Falha ao listar jobs ativos", { error });
      }
    }, 1500);
    return () => clearTimeout(timeout);
  }, [isClient, isAuthenticated, reattachTranscriptionJob, reattachSheetSyncJob, reattachMetaRefreshJob]);

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
      dismissToast(activeRefresh.sheetSyncToastId);
      showProcessCancelledWarning("sheets", activeRefresh.packName);
    }
    if (activeRefresh.transcriptionToastId) {
      dismissToast(activeRefresh.transcriptionToastId);
      showProcessCancelledWarning("transcription", activeRefresh.packName);
    }
    if (activeRefresh.toastId && activeRefresh.toggles.meta) {
      showCancellingToast(activeRefresh.toastId, activeRefresh.packName, metaToastIcon);
      const cancelTimeoutId = setTimeout(() => {
        dismissToast(activeRefresh.toastId);
        showProcessCancelledWarning("meta", activeRefresh.packName);
      }, 500);
      activeRefresh.cancelTimeoutId = cancelTimeoutId;
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
      sheetIntegrationId?: string,
    ): Promise<{ completed: boolean; adsCount: number; error?: string; chainedSyncJobId?: string; reattached?: boolean }> => {
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
            dismissToast(ar.toastId);
            showProcessCancelledWarning("meta", ar.packName);
          } catch (error) {
            logger.error("Erro ao cancelar job Meta:", error);
            // Falha real ao chamar a API de cancelamento — mostra erro persistente.
            finishProgressToast(
              ar.toastId, false,
              "Não foi possível cancelar a atualização. Ela pode continuar rodando no servidor.",
              { context: "meta", packName: ar.packName }
            );
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

      // skip_sheets_sync=true SEMPRE (legado paralelo morto). A cadeia
      // server-side vai pelo campo próprio chain_sheets_after_meta: com a flag
      // ligada no backend, ele dispara o sync após o Meta (response
      // server_chain=true); caso contrário o frontend orquestra como hoje.
      const wantsChain = activeRefresh.toggles.leadscore && !!sheetIntegrationId;
      let refreshResult: Awaited<ReturnType<typeof api.facebook.refreshPack>>;
      try {
        refreshResult = await api.facebook.refreshPack(
          packId, getTodayLocal(), refreshType, true, wantsChain, sheetIntegrationId
        );
      } catch (error) {
        const parsed = parseError(error);
        const conflictDetails = parsed.details as { job_id?: string } | undefined;
        if (parsed.status === 409 && parsed.code === "REFRESH_ALREADY_RUNNING" && conflictDetails?.job_id) {
          // Guard anti-dupla: outro refresh deste pack já está ativo no servidor
          // (outra aba/sessão). Re-anexar ao job existente em vez de duplicar.
          // setTimeout(0): o cleanupRefreshState do refreshPack (finally) roda
          // ainda neste task e removeria o addUpdatingPack que o re-attach faz —
          // adiar um macrotask garante que o estado "atualizando" sobreviva.
          logger.info(`[PACK_REFRESH] Pack ${packId} já em refresh no servidor (job ${conflictDetails.job_id}); re-anexando`);
          dismissToast(toastId);
          const existingJobId = String(conflictDetails.job_id);
          setTimeout(() => reattachMetaRefreshJob(existingJobId, packId, packName, sheetIntegrationId), 0);
          return { completed: false, adsCount: 0, reattached: true };
        }
        throw error;
      }

      updateActiveRefresh(packId, { serverChain: !!refreshResult.server_chain });

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
        finishProgressToast(
          toastId, false,
          `Não foi possível iniciar a atualização de "${packName}". Tente novamente.`,
          { context: "meta", packName }
        );
        return { completed: false, adsCount: 0 };
      }

      updateActiveRefresh(packId, { metaJobId: jobId });

      if (!addActiveJob(jobId)) {
        // Outro fluxo (re-attach ou aba irmã) já acompanha este job e já mostra
        // o próprio toast — sinalizar "reattached" evita disparar dependentes em
        // duplicidade e não trata isso como falha. Soltar o metaJobId para o
        // cleanup não remover do activeJobs um polling que não é nosso.
        logger.warn(`[PACK_REFRESH] Polling já ativo para job ${jobId}; deixando o acompanhamento existente seguir`);
        updateActiveRefresh(packId, { metaJobId: null });
        dismissToast(toastId);
        return { completed: false, adsCount: 0, reattached: true };
      }

      const dateRange = refreshResult.date_range;
      if (!dateRange) {
        finishProgressToast(
          toastId, false,
          `Intervalo de datas não disponível para "${packName}".`,
          { context: "meta", packName }
        );
        return { completed: false, adsCount: 0 };
      }

      updateProgressToast(
        toastId, packName, 1, 5,
        undefined, handleCancelMeta, metaToastIcon,
        buildMetaToastContent("meta_running", {}),
        calculateMetaProgressPercent("meta_running", {})
      );

      const metaResult = await pollMetaRefreshJob(
        jobId, toastId, packId, packName,
        () => activeRefresh.metaCancelled, handleCancelMeta, startTime
      );

      return metaResult;
    },
    [addActiveJob, pollMetaRefreshJob, reattachMetaRefreshJob]
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
            dismissToast(ar.sheetSyncToastId);
            showProcessCancelledWarning("sheets", ar.packName);
          } catch (error) {
            logger.error("Erro ao cancelar sync job:", error);
            // Falha real ao chamar a API de cancelamento — mostra erro persistente.
            finishProgressToast(
              ar.sheetSyncToastId, false,
              "Não foi possível cancelar a importação. Ela pode continuar rodando no servidor.",
              { context: "sheets", packName: ar.packName }
            );
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
          finishProgressToast(
            toastId, false,
            "Não foi possível iniciar a importação da planilha. Tente novamente.",
            { context: "sheets", packName }
          );
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
        const { message, diagnostic } = normalizeJobErrorMessage(
          parseError(error).message,
          "Não foi possível iniciar a importação da planilha.",
        );
        finishProgressToast(toastId, false, message, {
          context: "sheets",
          packName,
          diagnosticLine: diagnostic,
        });
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
          // Não é sucesso nem falha: nada para transcrever. Toast neutro informativo.
          dismissToast(toastId);
          showInfo(res.message || "Todos anúncios já estão transcritos.");
          return { success: true };
        }
      } catch (error) {
        logger.error("Erro ao iniciar transcrição:", error);
        const { message, diagnostic } = normalizeJobErrorMessage(
          parseError(error).message,
          "Não foi possível iniciar a transcrição.",
        );
        finishProgressToast(toastId, false, message, { context: "transcription", packName, diagnosticLine: diagnostic });
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
        serverChain: false,
        cancelTimeoutId: null,
      };
      activeRefreshes.set(packId, activeRefresh);
      useUpdatingPacksStore.getState().addUpdatingPack(packId);

      const promises: Promise<any>[] = [];
      let leadscoreStarted = false;
      let leadscoreResult: { success: boolean; paused?: boolean; error?: string } = { success: false, error: "Leadscore não executado" };

      // Sinaliza "na fila" quando já há refresh processando/aguardando. Mesmo toastId →
      // sobrescrito pelo toast real do Meta assim que este pack de fato começar.
      if (toggles.meta && refreshWillQueue()) {
        showProgressToast(
          toastId, packName, 0, 5,
          undefined, undefined, metaToastIcon,
          { stageLabel: "Na fila", stageTitle: "Aguardando outras atualizações", dynamicLine: "Começa assim que a anterior terminar…", stageContext: "Meta" },
          0,
        );
      }

      // Enfileira o trabalho pesado (Meta + persistência): só REFRESH_MAX_CONCURRENCY
      // roda de fato ao mesmo tempo — evita saturar banco/sockets. A marcação de
      // "updating" (acima) já aconteceu, então o card reflete o estado imediatamente.
      await enqueueRefresh(async () => {
      try {
        // Meta → (Leadscore ∥ Transcrição): dependentes esperam Meta concluir.
        // Leadscore atualiza ad_metrics; Transcrição processa ads novos. Meta é quem
        // cria essas linhas para ads recém-ativos. Em paralelo, dependentes terminam
        // antes de Meta popular o estado e perdem updates dos ads novos do dia.
        // Se Meta falhar/cancelar, dependentes abortam (dados ficariam imprecisos).
        const metaThenDependents = (async () => {
          let metaSucceeded = !toggles.meta;
          let chainedSyncJobId: string | undefined;

          if (toggles.meta) {
            try {
              const metaResult = await runMetaRefresh(packId, packName, refreshType, activeRefresh, sheetIntegrationId);
              if (metaResult.reattached) {
                // Guard anti-dupla: já havia refresh ativo no servidor e o
                // re-attach assumiu (toast + cadeia). Nada mais a fazer aqui.
                return;
              }
              // completed && !cancelled — Meta falhado também aborta dependentes
              // (comentário acima: dados ficariam imprecisos).
              metaSucceeded = metaResult.completed && !activeRefresh.metaCancelled;
              chainedSyncJobId = metaResult.chainedSyncJobId;
            } catch (error) {
              metaSucceeded = false;
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
            }
          }

          if (toggles.meta && !metaSucceeded) {
            if (toggles.leadscore) {
              logger.warn(`[PACK_REFRESH] Leadscore abortado para pack ${packId}: Meta não concluiu com sucesso`);
            }
            if (toggles.transcription) {
              logger.warn(`[PACK_REFRESH] Transcrição abortada para pack ${packId}: Meta não concluiu com sucesso`);
            }
            return;
          }

          const dependents: Promise<any>[] = [];

          if (toggles.leadscore && sheetIntegrationId && !activeRefresh.sheetsCancelled) {
            leadscoreStarted = true;
            if (activeRefresh.serverChain && chainedSyncJobId) {
              // Cadeia server-side: o backend JÁ criou e disparou o sync ao
              // concluir o Meta — aqui só observamos (orquestrador único; criar
              // outro sync duplicaria o trabalho).
              const syncJobId = chainedSyncJobId;
              updateActiveRefresh(packId, {
                sheetSyncJobId: syncJobId,
                sheetSyncToastId: `sheets-reattach-${syncJobId}`,
              });
              dependents.push(
                reattachSheetSyncJob(syncJobId, packId, packName, sheetIntegrationId).then((result) => {
                  leadscoreResult = result ?? { success: false, error: "Sync encadeado não pôde ser acompanhado" };
                  if (result && !result.success && !result.paused && !activeRefresh.sheetsCancelled && mountedRef.current) {
                    optionsRef.current?.onError?.(
                      new Error(result.error || `Falha na sincronização de Leadscore para "${packName}"`)
                    );
                  }
                })
              );
            } else {
              // Fluxo client-side: flag off/backend antigo, OU fallback quando o
              // backend aceitou a cadeia mas falhou ao criar o sync job
              // (server_chain sem chained_sync_job_id nos details).
              if (activeRefresh.serverChain && !chainedSyncJobId) {
                logger.warn(`[PACK_REFRESH] server_chain sem chained_sync_job_id para pack ${packId}; fallback client-side`);
              }
              dependents.push(
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
            }
          } else if (toggles.leadscore && !sheetIntegrationId) {
            logger.warn(`[PACK_REFRESH] Leadscore habilitado, mas pack ${packId} não possui integração de planilha`);
          }

          if (toggles.transcription && !activeRefresh.transcriptionCancelled) {
            dependents.push(
              runTranscription(packId, packName, activeRefresh).catch((error) => {
                logger.error(`Erro na transcrição do pack ${packId}:`, error);
              })
            );
          }

          await Promise.allSettled(dependents);
        })();

        promises.push(metaThenDependents);

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
      });
    },
    [
      runMetaRefresh,
      runLeadscoreSync,
      runTranscription,
      reattachSheetSyncJob,
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

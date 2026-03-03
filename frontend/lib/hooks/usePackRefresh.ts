"use client";

/**
 * Hook centralizado para atualização de packs.
 *
 * Baseado na implementação completa do Topbar.tsx, inclui:
 * - Polling do job Meta Ads com progresso granular
 * - Polling paralelo do Google Sheets sync
 * - Cancelamento de ambos os jobs (Meta + Sheets)
 * - Tratamento de token Google expirado com pause/reconnect
 * - Toast de progresso com botão cancelar
 * - Invalidação de cache após conclusão
 */

import React, { useState, useCallback, useRef } from "react";
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
  showWarning,
  showProcessCancelledWarning,
  getMetaStageInfo,
  getMetaDynamicLine,
  buildSheetsToastContent,
  calculateSheetsProgressPercent,
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
  /** Inicia apenas a transcrição dos vídeos do pack (sem refresh). Útil para testes. */
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
  metaCancelled: boolean;
  sheetsCancelled: boolean;
  transcriptionCancelled: boolean;
  /** @deprecated Use metaCancelled/sheetsCancelled/transcriptionCancelled. Mantido para compatibilidade com cancelRefresh "cancelar tudo". */
  cancelled: boolean;
  pendingCancellation: boolean;
  isCancelling: boolean;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const ESTIMATED_PAGES_COLLECTION = 10;

/**
 * Calcula progressPercent (0-100) baseado em etapas e sub-unidades.
 * Sem fallback 50%: todo status/stage mapeado explicitamente.
 */
function calculateMetaProgressPercent(status: string, details: any, apiProgress?: number): number {
  if (status === "completed") return 100;
  if (status === "failed" || status === "cancelled") return 0;

  const stage = details?.stage || "";

  // Etapa 1 (0-20%): meta_running
  if (status === "meta_running" || status === "meta_completed") {
    if (apiProgress != null && apiProgress >= 0 && apiProgress <= 100) {
      return (apiProgress / 100) * 20; // mapear 0-100 -> 0-20
    }
    return 0; // início da etapa
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

  // processing sem stage reconhecido: assumir etapa 1 (início)
  if (status === "processing") return 20;
  return 0; // desconhecido: etapa 1 início
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

// Ícones para identificar a origem do toast
const metaToastIcon = React.createElement(MetaIcon, { className: "h-5 w-5 flex-shrink-0" });
const sheetsToastIcon = React.createElement(GoogleSheetsIcon, { className: "h-5 w-5 flex-shrink-0" });

/** Total de etapas no toast do Sheets (barra usa progressPercent quando informado). */
const SHEETS_TOAST_TOTAL_STEPS = 3;

/** Total de etapas no toast da transcrição (barra usa progressPercent quando informado). */
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

  // ============================================================================
  // SHEET SYNC POLLING
  // ============================================================================

  /**
   * Faz polling do job de sincronização do Google Sheets em paralelo
   */
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
      let completed = false;
      let attempts = 0;
      const maxAttempts = 300; // 10 minutos máximo (300 * 2s = 600s)

      // Helper para pausar o job e mostrar toast de pausa
      const pauseJobAndShowToast = (errorMessage: string) => {
        // Pausar job na store
        pauseJob({
          syncJobId,
          packId,
          packName,
          toastId,
          integrationId,
          pausedAt: new Date(),
          reason: "google_token_expired",
        });

        // Mostrar toast de pausa (não permite fechar, só reconectar ou cancelar)
        showPausedJobToast(
          toastId,
          packName,
          async () => {
            // Callback de reconectar: abre popup OAuth diretamente
            await connectGoogle({ silent: true });
          },
          () => {
            // Callback de cancelar: limpa job da store e fecha toast
            clearJob(packId);
            dismissToast(toastId);
          }
        );

        // Disparar evento para UI reagir
        handleGoogleAuthError({ code: GOOGLE_TOKEN_EXPIRED, message: errorMessage } as AppError);
      };

      console.log(`[PACK_REFRESH] 🚀 Iniciando polling do sync job ${syncJobId}`);

      while (!completed && attempts < maxAttempts && !getCancelled()) {
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Aguardar 2 segundos

        // Verificar se foi cancelado
        const isCancelledNow = getCancelled();
        if (isCancelledNow) {
          console.log(`[PACK_REFRESH] ⛔ Polling do sync job ${syncJobId} cancelado pelo usuário`);
          return { success: false, error: "Cancelado pelo usuário" };
        }

        try {
          const progress = await api.integrations.google.getSyncJobProgress(syncJobId);
          const details = (progress as any)?.details || {};

          // Cancelamento pode ter sido acionado enquanto aguardávamos a resposta
          if (getCancelled()) {
            console.log(`[PACK_REFRESH] ⛔ Sync job ${syncJobId} cancelado após resposta do backend`);
            return { success: false, error: "Cancelado pelo usuário" };
          }

          // Verificar se o job falhou por token expirado do Google
          if (progress.status === "failed") {
            const errorCode = details?.error_code || (progress as any)?.error_code;
            const errorMessage = progress.message || "";

            // Detectar erro de token do Google expirado ou conexão não encontrada
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
              return { success: false, error: errorMessage, paused: true, needsGoogleReconnect: true };
            }

            finishProgressToast(toastId, false, `Erro ao sincronizar planilha: ${progress.message || "Erro desconhecido"}`);
            return { success: false, error: progress.message || "Erro desconhecido" };
          }

          const sheetsContent = buildSheetsToastContent(progress.status, details);
          const progressPercent = calculateSheetsProgressPercent(progress.status, details);

          updateProgressToast(
            toastId,
            `Planilha: ${packName}`,
            1,
            SHEETS_TOAST_TOTAL_STEPS,
            undefined,
            onCancel,
            sheetsToastIcon,
            sheetsContent,
            progressPercent
          );

          if (progress.status === "completed") {
            console.log(`[PACK_REFRESH] ✅ Sync job ${syncJobId} completado`);
            const stats = (progress as any)?.stats || {};
            const updatedRows = stats.rows_updated || stats.updated_rows || 0;
            finishProgressToast(
              toastId,
              true,
              `Planilha importada com sucesso! ${updatedRows > 0 ? `${updatedRows} registros atualizados.` : "Nenhuma atualização necessária."}`,
              { visibleDurationOnly: 5, context: "sheets", packName }
            );

            // Disparar evento para recarregar dados do pack
            window.dispatchEvent(
              new CustomEvent("pack-integration-updated", {
                detail: { packId },
              })
            );

            return { success: true };
          } else if (progress.status === "cancelled") {
            console.log(`[PACK_REFRESH] ✅ Backend retornou status "cancelled" para sync job ${syncJobId}`);
            finishProgressToast(toastId, false, `Importação do Leadscore cancelada`);
            return { success: false, error: "Cancelado" };
          }
        } catch (error) {
          console.error(`Erro ao verificar progresso do sync job ${syncJobId}:`, error);

          // Se o usuário já cancelou, não ressuscitar o toast de progresso
          if (getCancelled()) {
            console.log(
              `[PACK_REFRESH] ⛔ Ignorando erro de polling do Sheets pois o job já foi cancelado`
            );
            return { success: false, error: "Cancelado pelo usuário" };
          }

          // Verificar se é erro de token do Google expirado
          if (isGoogleTokenError(error)) {
            const { shouldReconnect, message } = handleGoogleAuthError(error as AppError);

            if (shouldReconnect) {
              pauseJobAndShowToast(message);
              return { success: false, error: message, paused: true, needsGoogleReconnect: true };
            }
          }

          updateProgressToast(
            toastId,
            `Planilha: ${packName}`,
            1,
            SHEETS_TOAST_TOTAL_STEPS,
            undefined,
            onCancel,
            sheetsToastIcon,
            buildSheetsToastContent("processing", {}, "Erro ao verificar progresso, tentando novamente..."),
            0
          );
        }

        attempts++;
      }

      // Se foi cancelado, não tratar como timeout
      if (getCancelled()) {
        console.log(`[PACK_REFRESH] ✅ Sync job ${syncJobId} tratado como cancelado (sem timeout)`);
        return { success: false, error: "Cancelado pelo usuário" };
      }

      if (!completed) {
        finishProgressToast(toastId, false, `Timeout ao sincronizar planilha (demorou mais de 10 minutos)`);
        return { success: false, error: "Timeout" };
      }

      return { success: false, error: "Job não completou" };
    },
    [pauseJob, clearJob, connectGoogle]
  );

  /**
   * Faz polling do job de transcrição em paralelo.
   */
  const pollTranscriptionJob = useCallback(
    async (
      transcriptionJobId: string,
      toastId: string,
      packName: string,
      getCancelled: () => boolean,
      onCancel?: () => void
    ): Promise<{ success: boolean; error?: string }> => {
      let completed = false;
      let attempts = 0;
      const maxAttempts = 300; // 10 minutos

      while (!completed && attempts < maxAttempts && !getCancelled()) {
        await new Promise((resolve) => setTimeout(resolve, 2000));

        if (getCancelled()) {
          return { success: false, error: "Cancelado pelo usuário" };
        }

        try {
          const progress = await api.facebook.getTranscriptionProgress(transcriptionJobId);
          const details = (progress as any)?.details || {};

          // Cancelamento pode ter sido acionado enquanto aguardávamos a resposta
          if (getCancelled()) {
            console.log(
              `[PACK_REFRESH] ⛔ Transcription job ${transcriptionJobId} cancelado após resposta do backend`
            );
            return { success: false, error: "Cancelado pelo usuário" };
          }

          const transcriptionContent = buildTranscriptionToastContent(progress.status, details);
          const progressPercent = calculateTranscriptionProgressPercent(progress.status, details);

          updateProgressToast(
            toastId,
            `Transcrição: ${packName}`,
            1,
            TRANSCRIPTION_TOAST_TOTAL_STEPS,
            undefined,
            onCancel,
            metaToastIcon,
            transcriptionContent,
            progressPercent
          );

          if (progress.status === "completed") {
            const successCount = Number(details.success_count ?? 0);
            const failCount = Number(details.fail_count ?? 0);
            const skippedExisting = Number(details.skipped_existing ?? 0);

            const summaryParts: string[] = [];
            summaryParts.push(`${successCount} sucesso(s)`);
            if (failCount > 0) summaryParts.push(`${failCount} falha(s)`);
            if (skippedExisting > 0) summaryParts.push(`${skippedExisting} já existente(s)`);

            const summary = summaryParts.join(", ");

            finishProgressToast(
              toastId,
              true,
              `Transcrição de "${packName}" concluída (${summary}).`,
              { visibleDurationOnly: 5, context: "transcription", packName }
            );
            return { success: true };
          }

          if (progress.status === "cancelled") {
            if (getCancelled()) {
              return { success: false, error: progress.message || "Cancelado pelo usuário" };
            }
            dismissToast(toastId);
            showProcessCancelledWarning("transcription", packName);
            return { success: false, error: progress.message || "Cancelado pelo usuário" };
          }

          if (progress.status === "failed") {
            finishProgressToast(
              toastId,
              false,
              progress.message || `Transcrição de "${packName}" falhou`
            );
            return { success: false, error: progress.message || "Falha na transcrição" };
          }
        } catch (error) {
          // Se o usuário já cancelou, não ressuscitar o toast de progresso
          if (getCancelled()) {
            console.log(
              `[PACK_REFRESH] ⛔ Ignorando erro de polling da transcrição pois o job já foi cancelado`
            );
            return { success: false, error: "Cancelado pelo usuário" };
          }

          updateProgressToast(
            toastId,
            `Transcrição: ${packName}`,
            1,
            TRANSCRIPTION_TOAST_TOTAL_STEPS,
            undefined,
            onCancel,
            metaToastIcon,
            buildTranscriptionToastContent("processing", {}, "Erro ao verificar progresso da transcrição, tentando novamente..."),
            0
          );
        }

        attempts++;
      }

      // Se foi cancelado, não tratar como timeout
      if (getCancelled()) {
        console.log(
          `[PACK_REFRESH] ✅ Job de transcrição ${transcriptionJobId} tratado como cancelado (sem timeout)`
        );
        return { success: false, error: "Cancelado pelo usuário" };
      }

      if (!completed) {
        finishProgressToast(
          toastId,
          false,
          `Timeout ao transcrever vídeos de "${packName}" (demorou mais de 10 minutos)`
        );
      }

      return { success: false, error: "Timeout" };
    },
    []
  );

  /**
   * Inicia apenas o processo de transcrição dos anúncios do pack (sem refresh).
   * Útil para testes ou para rodar transcrição após um refresh que não a disparou.
   */
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
            console.error("Erro ao cancelar transcrição:", error);
            dismissToast(toastId);
          }
        } else {
          dismissToast(toastId);
          showCancelledWarningOnce();
        }
      };

      // Toast imediato (antes de qualquer await)
      showProgressToast(
        toastId,
        `Transcrição: ${packName}`,
        1,
        TRANSCRIPTION_TOAST_TOTAL_STEPS,
        undefined,
        handleCancelTranscriptionOnly,
        metaToastIcon,
        buildTranscriptionToastContent("processing", {}),
        0
      );
      try {
        const res = await api.facebook.startPackTranscription(packId);
        if (cancelled) {
          if (res.transcription_job_id) {
            try {
              await api.facebook.cancelJobsBatch([res.transcription_job_id], "Transcrição cancelada pelo usuário");
            } catch (err) {
              console.error("Erro ao cancelar transcrição pendente:", err);
            }
            dismissToast(toastId);
            showCancelledWarningOnce();
          }
          return;
        }
        if (res.transcription_job_id) {
          jobIdRef.current = res.transcription_job_id;
          updateProgressToast(
            toastId,
            `Transcrição: ${packName}`,
            1,
            TRANSCRIPTION_TOAST_TOTAL_STEPS,
            undefined,
            handleCancelTranscriptionOnly,
            metaToastIcon,
            buildTranscriptionToastContent("processing", {}),
            0
          );
          pollTranscriptionJob(res.transcription_job_id, toastId, packName, () => cancelled, handleCancelTranscriptionOnly).catch((err) => {
            console.error("Erro no polling da transcrição:", err);
          });
        } else {
          finishProgressToast(toastId, false, res.message || "Todos anúncios já estão transcritos.");
        }
      } catch (error) {
        console.error("Erro ao iniciar transcrição:", error);
        finishProgressToast(toastId, false, error instanceof Error ? error.message : "Erro ao iniciar transcrição");
      }
    },
    [pollTranscriptionJob]
  );

  // ============================================================================
  // CANCEL REFRESH
  // ============================================================================

  /**
   * Cancela todos os processos em andamento do pack (Meta + Sheets + Transcrição).
   * Usado para ações de "cancelar tudo", ex.: logout ou modal de confirmação.
   * Os botões individuais de cada toast usam handlers específicos (handleCancelMeta, etc.).
   */
  const cancelRefresh = useCallback(async (packId: string): Promise<void> => {
    const activeRefresh = activeRefreshesRef.current.get(packId);
    if (!activeRefresh || activeRefresh.isCancelling) {
      return;
    }

    console.log(`[PACK_REFRESH] 🛑 Cancelando todos os processos do pack ${packId}`);

    activeRefresh.isCancelling = true;
    activeRefresh.cancelled = true;
    activeRefresh.metaCancelled = true;
    activeRefresh.sheetsCancelled = true;
    activeRefresh.transcriptionCancelled = true;

    const jobsToCancel: string[] = [];
    if (activeRefresh.metaJobId) jobsToCancel.push(activeRefresh.metaJobId);
    if (activeRefresh.sheetSyncJobId) jobsToCancel.push(activeRefresh.sheetSyncJobId);
    if (activeRefresh.transcriptionJobId) jobsToCancel.push(activeRefresh.transcriptionJobId);

    if (jobsToCancel.length > 0) {
      try {
        await api.facebook.cancelJobsBatch(jobsToCancel, "Cancelado pelo usuário");
        console.log(`[PACK_REFRESH] Jobs cancelados: ${jobsToCancel.join(", ")}`);
      } catch (error) {
        console.error("Erro ao cancelar jobs:", error);
      }
    } else if (!activeRefresh.metaJobId) {
      activeRefresh.pendingCancellation = true;
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
  }, []);

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

      // Verificar se já está em refresh
      if (activeRefreshesRef.current.has(packId)) {
        console.warn(`[PACK_REFRESH] Pack ${packId} já está em refresh, ignorando`);
        return;
      }

      console.log(`[PACK_REFRESH] Iniciando refresh do pack ${packId} (${packName})`);

      // Criar tracking de refresh ativo
      const toastId = `refresh-pack-${packId}`;
      const activeRefresh: ActiveRefresh = {
        packId,
        packName,
        toastId,
        metaJobId: null,
        sheetSyncJobId: null,
        sheetSyncToastId: null,
        transcriptionJobId: null,
        metaCancelled: false,
        sheetsCancelled: false,
        transcriptionCancelled: false,
        cancelled: false,
        pendingCancellation: false,
        isCancelling: false,
      };
      activeRefreshesRef.current.set(packId, activeRefresh);

      // Atualizar UI state
      setRefreshingPackIds((prev) => [...prev, packId]);
      addUpdatingPack(packId);

      const handleCancelMeta = async () => {
        const ar = activeRefreshesRef.current.get(packId);
        if (!ar || ar.metaCancelled) return;
        ar.metaCancelled = true;
        console.log(`[PACK_REFRESH] Cancelando apenas Meta do pack ${packId}`);
        if (ar.metaJobId) {
          try {
            showCancellingToast(ar.toastId, ar.packName, metaToastIcon);
            await api.facebook.cancelJobsBatch([ar.metaJobId], "Atualização Meta cancelada pelo usuário");
            finishProgressToast(ar.toastId, false, "Atualização Meta cancelada pelo usuário");
            showProcessCancelledWarning("meta", ar.packName);
          } catch (error) {
            console.error("Erro ao cancelar job Meta:", error);
            finishProgressToast(ar.toastId, false, "Erro ao cancelar atualização Meta");
          }
        } else {
          ar.pendingCancellation = true;
          dismissToast(ar.toastId);
          showProcessCancelledWarning("meta", ar.packName);
        }
      };

      const handleCancelSheets = async () => {
        const ar = activeRefreshesRef.current.get(packId);
        if (!ar || ar.sheetsCancelled) return;
        ar.sheetsCancelled = true;
        console.log(`[PACK_REFRESH] Cancelando apenas Sheets do pack ${packId}`);
        if (ar.sheetSyncJobId && ar.sheetSyncToastId) {
          try {
            await api.facebook.cancelJobsBatch([ar.sheetSyncJobId], "Importação do Leadscore cancelada pelo usuário");
            finishProgressToast(ar.sheetSyncToastId, false, "Importação do Leadscore cancelada pelo usuário");
            showProcessCancelledWarning("sheets", ar.packName);
          } catch (error) {
            console.error("Erro ao cancelar sync job:", error);
            finishProgressToast(ar.sheetSyncToastId, false, "Erro ao cancelar importação da planilha");
          }
        } else if (ar.sheetSyncToastId) {
          dismissToast(ar.sheetSyncToastId);
          showProcessCancelledWarning("sheets", ar.packName);
        }
      };

      const handleCancelTranscription = async (transcriptionToastId: string, transcriptionJobId: string) => {
        const ar = activeRefreshesRef.current.get(packId);
        if (!ar || ar.transcriptionCancelled) return;
        ar.transcriptionCancelled = true;
        console.log(`[PACK_REFRESH] Cancelando apenas Transcrição do pack ${packId}`);
        try {
          await api.facebook.cancelJobsBatch([transcriptionJobId], "Transcrição cancelada pelo usuário");
          dismissToast(transcriptionToastId);
          showProcessCancelledWarning("transcription", ar.packName);
        } catch (error) {
          console.error("Erro ao cancelar transcrição:", error);
          finishProgressToast(transcriptionToastId, false, "Erro ao cancelar transcrição");
        }
      };

      // Mostrar toast imediatamente (antes de qualquer await da API)
      showProgressToast(
        toastId,
        packName,
        1, // currentStep placeholder (bar usa progressPercent)
        5, // totalSteps
        undefined,
        handleCancelMeta,
        metaToastIcon,
        buildMetaToastContent("meta_running", {}),
        0 // progressPercent: Etapa 1 início
      );

      // Mostrar toast do Sheets imediatamente se sabemos que há integração
      if (sheetIntegrationId) {
        activeRefresh.sheetSyncToastId = `sync-sheet-${packId}`;
        showProgressToast(
          activeRefresh.sheetSyncToastId,
          `Planilha: ${packName}`,
          1,
          SHEETS_TOAST_TOTAL_STEPS,
          undefined,
          handleCancelSheets,
          sheetsToastIcon,
          buildSheetsToastContent("processing", { stage: "lendo_planilha" }),
          0
        );
      }

      let refreshResult: { job_id?: string; date_range?: { since: string; until: string }; sync_job_id?: string } | null = null;

      try {
        // Iniciar refresh
        refreshResult = await api.facebook.refreshPack(packId, getTodayLocal(), refreshType);

        // Capturar sync_job_id do response inicial (se existir)
        const syncJobIdFromResponse = refreshResult?.sync_job_id;
        if (syncJobIdFromResponse) {
          activeRefresh.sheetSyncJobId = syncJobIdFromResponse;
          if (!activeRefresh.sheetSyncToastId) {
            activeRefresh.sheetSyncToastId = `sync-sheet-${packId}`;
          }
          console.log(`[PACK_REFRESH] sync_job_id capturado do response inicial: ${syncJobIdFromResponse}`);
        }

        // Verificar se Meta foi cancelado antes de receber job_id
        if (activeRefresh.metaCancelled && activeRefresh.pendingCancellation && refreshResult.job_id) {
          console.log(`[PACK_REFRESH] Executando cancelamento pendente apenas do Meta job ${refreshResult.job_id}`);
          try {
            await api.facebook.cancelJobsBatch([refreshResult.job_id], "Atualização Meta cancelada pelo usuário");
          } catch (error) {
            console.error("Erro ao cancelar job Meta pendente:", error);
          }
          // Sheets continua se tiver sync_job_id (usuário cancelou só Meta)
          if (activeRefresh.sheetSyncJobId && activeRefresh.sheetSyncToastId) {
            try {
              await pollSheetSyncJob(
                activeRefresh.sheetSyncJobId,
                activeRefresh.sheetSyncToastId,
                packName,
                packId,
                sheetIntegrationId || "",
                () => activeRefresh.sheetsCancelled,
                handleCancelSheets
              );
            } catch (error) {
              console.error(`Erro no polling do sync job:`, error);
            }
          }
          return;
        }

        if (!refreshResult.job_id) {
          finishProgressToast(toastId, false, `Erro ao iniciar atualização de "${packName}"`);
          return;
        }

        activeRefresh.metaJobId = refreshResult.job_id;

        // Verificar e adicionar job ativo (proteção contra múltiplos pollings)
        if (!addActiveJob(refreshResult.job_id)) {
          console.warn(`[PACK_REFRESH] Polling já ativo para job ${refreshResult.job_id}. Ignorando...`);
          finishProgressToast(toastId, false, `Este job já está sendo processado. Aguarde a conclusão.`);
          return;
        }

        // Iniciar polling do Sheets imediatamente se temos sync_job_id
        if (activeRefresh.sheetSyncJobId && activeRefresh.sheetSyncToastId) {
          console.log(`[PACK_REFRESH] Iniciando polling do Sheets imediatamente`);
          updateProgressToast(
            activeRefresh.sheetSyncToastId,
            `Planilha: ${packName}`,
            1,
            SHEETS_TOAST_TOTAL_STEPS,
            undefined,
            handleCancelSheets,
            sheetsToastIcon,
            buildSheetsToastContent("processing", { stage: "lendo_planilha" }),
            0
          );
          pollSheetSyncJob(
            activeRefresh.sheetSyncJobId,
            activeRefresh.sheetSyncToastId,
            packName,
            packId,
            sheetIntegrationId || "",
            () => activeRefresh.sheetsCancelled,
            handleCancelSheets
          ).catch((error) => {
            console.error(`Erro no polling do sync job:`, error);
          });
        } else if (!activeRefresh.sheetSyncJobId && activeRefresh.sheetSyncToastId) {
          // Toast do Sheets foi criado antecipadamente mas API não retornou sync_job_id
          dismissToast(activeRefresh.sheetSyncToastId);
          activeRefresh.sheetSyncToastId = null;
        }

        // Calcular total de dias
        const dateRange = refreshResult.date_range;
        if (!dateRange) {
          finishProgressToast(toastId, false, `Erro: intervalo de datas não disponível para "${packName}"`);
          return;
        }
        updateProgressToast(
          toastId,
          packName,
          1,
          5,
          undefined,
          handleCancelMeta,
          metaToastIcon,
          buildMetaToastContent("meta_running", {}),
          calculateMetaProgressPercent("meta_running", {})
        );

        // Fazer polling do job Meta
        let completed = false;
        let attempts = 0;
        const maxAttempts = 150; // 5 minutos máximo

        while (!completed && attempts < maxAttempts && !activeRefresh.metaCancelled) {
          await new Promise((resolve) => setTimeout(resolve, 2000)); // Aguardar 2 segundos

          if (activeRefresh.metaCancelled) {
            break;
          }

          try {
            const progress = await api.facebook.getJobProgress(refreshResult.job_id);
            const details = (progress as any)?.details || {};

            // Verificar se há sync_job_id e ainda não iniciamos o polling de Sheets
            if (details.sync_job_id && !activeRefresh.sheetSyncJobId) {
              activeRefresh.sheetSyncJobId = details.sync_job_id;
              if (!activeRefresh.sheetSyncToastId) {
                activeRefresh.sheetSyncToastId = `sync-sheet-${packId}`;
              }
              console.log(`[PACK_REFRESH] sync_job_id capturado do polling: ${details.sync_job_id}`);

              // Buscar integrationId
              const integrationIdToUse = sheetIntegrationId || details.integration_id || "";

              // Atualizar (ou criar) toast do Sheets e iniciar polling
              updateProgressToast(
                activeRefresh.sheetSyncToastId!,
                `Planilha: ${packName}`,
                1,
                SHEETS_TOAST_TOTAL_STEPS,
                undefined,
                handleCancelSheets,
                sheetsToastIcon,
                buildSheetsToastContent("processing", { stage: "lendo_planilha" }),
                0
              );
              pollSheetSyncJob(
                activeRefresh.sheetSyncJobId!,
                activeRefresh.sheetSyncToastId!,
                packName,
                packId,
                integrationIdToUse,
                () => activeRefresh.sheetsCancelled,
                handleCancelSheets
              ).catch((error) => {
                console.error(`Erro no polling do sync job:`, error);
              });
            }

            // Calcular progressPercent (0-100) por etapa e sub-unidades
            const apiProgress = (progress as any)?.progress;
            const progressPercent = calculateMetaProgressPercent(progress.status, details, apiProgress);

            updateProgressToast(
              toastId,
              packName,
              1,
              5,
              undefined,
              handleCancelMeta,
              metaToastIcon,
              buildMetaToastContent(progress.status, details, (progress as any)?.message),
              progressPercent
            );

            if (progress.status === "completed") {
              const adsCount = Array.isArray(progress.data) ? progress.data.length : 0;
              const metaSuccessMessage =
                adsCount > 0
                  ? `Anúncios atualizados com sucesso. ${adsCount} anúncios atualizados.`
                  : "Anúncios atualizados com sucesso.";
              finishProgressToast(
                toastId,
                true,
                metaSuccessMessage,
                { visibleDurationOnly: 5, context: "meta", packName }
              );

              // Recarregar pack do backend
              try {
                const response = await api.analytics.listPacks(false);
                if (response.success && response.packs) {
                  const updatedPack = response.packs.find((p: any) => p.id === packId);
                  if (updatedPack) {
                    updatePack(packId, {
                      stats: updatedPack.stats || {},
                      updated_at: updatedPack.updated_at || new Date().toISOString(),
                      auto_refresh: updatedPack.auto_refresh !== undefined ? updatedPack.auto_refresh : undefined,
                      date_stop: updatedPack.date_stop,
                    } as Partial<AdsPack>);

                    await invalidatePackAds(packId);
                  }
                }

                invalidateAdPerformance();
              } catch (error) {
                console.error("Erro ao recarregar pack após refresh:", error);
              }

              const transcriptionJobId = details?.transcription_job_id;
              if (transcriptionJobId) {
                activeRefresh.transcriptionJobId = transcriptionJobId;
                const transcriptionToastId = `transcription-${packId}`;
                const onCancelTranscription = () => handleCancelTranscription(transcriptionToastId, transcriptionJobId);
                showProgressToast(
                  transcriptionToastId,
                  `Transcrição: ${packName}`,
                  1,
                  TRANSCRIPTION_TOAST_TOTAL_STEPS,
                  undefined,
                  onCancelTranscription,
                  metaToastIcon,
                  buildTranscriptionToastContent("processing", {}),
                  0
                );
                pollTranscriptionJob(
                  transcriptionJobId,
                  transcriptionToastId,
                  packName,
                  () => activeRefresh.transcriptionCancelled,
                  onCancelTranscription
                ).catch((error) => {
                  console.error("Erro no polling da transcrição:", error);
                });
              }

              completed = true;

              // Callback de sucesso
              options?.onComplete?.({
                packId,
                packName,
                adsCount,
              });
            } else if (progress.status === "failed") {
              finishProgressToast(toastId, false, `Erro ao atualizar "${packName}": ${progress.message || "Erro desconhecido"}`);
              completed = true;
              options?.onError?.(new Error(progress.message || "Erro desconhecido"));
            } else if (progress.status === "cancelled") {
              completed = true;
            }
          } catch (error) {
            console.error(`Erro ao verificar progresso do pack ${packId}:`, error);
            updateProgressToast(
              toastId,
              packName,
              1,
              5,
              undefined,
              handleCancelMeta,
              metaToastIcon,
              {
                stageLabel: "Etapa 1 de 5",
                stageTitle: "Verificando...",
                dynamicLine: "Erro ao verificar progresso, tentando novamente...",
              },
              0 // progressPercent: início da etapa 1
            );
          }

          attempts++;
        }

        // Verificar se foi cancelado
        if (activeRefresh.metaCancelled) {
          return;
        }

        if (!completed) {
          finishProgressToast(toastId, false, `Timeout ao atualizar "${packName}" (demorou mais de 5 minutos)`);
          options?.onError?.(new Error("Timeout"));
        }
      } catch (error) {
        // Não mostrar erro se foi cancelado
        if (!activeRefresh.metaCancelled) {
          console.error(`Erro ao atualizar pack ${packId}:`, error);
          finishProgressToast(
            toastId,
            false,
            `Erro ao atualizar "${packName}": ${error instanceof Error ? error.message : "Erro desconhecido"}`
          );
          options?.onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      } finally {
        // Limpar estados
        console.log(`[PACK_REFRESH] Finalizando refresh do pack ${packId}`);

        if (refreshResult?.job_id) {
          removeActiveJob(refreshResult.job_id);
        }

        activeRefreshesRef.current.delete(packId);
        setRefreshingPackIds((prev) => prev.filter((id) => id !== packId));
        removeUpdatingPack(packId);
      }
    },
    [
      addUpdatingPack,
      removeUpdatingPack,
      addActiveJob,
      removeActiveJob,
      updatePack,
      invalidatePackAds,
      invalidateAdPerformance,
      pollSheetSyncJob,
      pollTranscriptionJob,
      cancelRefresh,
      options,
    ]
  );

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  const isRefreshing = useCallback(
    (packId: string): boolean => {
      return refreshingPackIds.includes(packId);
    },
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

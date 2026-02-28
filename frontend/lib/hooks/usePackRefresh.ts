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
  getStageMessage,
  getStatusMessage,
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
  cancelled: boolean;
  pendingCancellation: boolean;
  isCancelling: boolean;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calcula diferença em dias entre duas datas (YYYY-MM-DD)
 */
function calculateDaysBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays + 1; // +1 para incluir o dia final
}

/**
 * Calcula progresso granular baseado em stage e detalhes do backend
 */
function calculateProgress(status: string, details: any): number {
  if (status === "completed") return 100;
  if (status === "failed" || status === "cancelled") return 0;

  const stage = details?.stage || "";

  // meta_running: 0-10%
  if (status === "meta_running") return 5;

  // processing stages: 10-85%
  if (status === "processing") {
    if (stage === "paginação" || stage === "STAGE_PAGINATION") {
      // 10-35%: usar page_count para progresso dentro do stage
      const pageCount = details?.page_count || 0;
      const estimatedPages = 10;
      const pageProgress = Math.min(pageCount / estimatedPages, 1);
      return 10 + pageProgress * 25;
    }
    if (stage === "enriquecimento" || stage === "STAGE_ENRICHMENT") {
      // 35-60%: usar enrichment_batches
      const batchNum = details?.enrichment_batches || 0;
      const totalBatches = details?.enrichment_total || 1;
      const enrichProgress = totalBatches > 0 ? batchNum / totalBatches : 0;
      return 35 + enrichProgress * 25;
    }
    if (stage === "formatação" || stage === "STAGE_FORMATTING") {
      return 65; // 60-70%
    }
  }

  // persisting: 70-95%
  if (status === "persisting") {
    const msg = details?.message || "";
    if (msg.includes("Salvando anúncios")) return 75;
    if (msg.includes("Salvando métricas")) return 82;
    if (msg.includes("Calculando")) return 88;
    if (msg.includes("Otimizando")) return 92;
    if (msg.includes("Finalizando")) return 95;
    return 70;
  }

  return 50; // Fallback
}

/**
 * Converte percentual em dias estimados
 */
function progressToDays(progressPercent: number, totalDays: number): number {
  const estimatedDay = Math.ceil((progressPercent / 100) * totalDays);
  return Math.max(1, Math.min(estimatedDay, totalDays));
}

// ============================================================================
// MAIN HOOK
// ============================================================================

// Ícones para identificar a origem do toast
const metaToastIcon = React.createElement(MetaIcon, { className: "h-5 w-5 flex-shrink-0" });
const sheetsToastIcon = React.createElement(GoogleSheetsIcon, { className: "h-5 w-5 flex-shrink-0" });

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
      getCancelled: () => boolean
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

          // Usar mensagens user-friendly
          const stage = details?.stage || "";
          const displayMessage = getStageMessage(stage, details);

          // Calcular progresso (Google Sheets é geralmente rápido: 2 "dias")
          let currentDay = 1;
          if (progress.status === "processing") {
            currentDay = stage === "lendo_planilha" ? 1 : 1;
          } else if (progress.status === "persisting") {
            currentDay = 2;
          }

          updateProgressToast(toastId, `Planilha: ${packName}`, currentDay, 2, displayMessage, undefined, sheetsToastIcon);

          if (progress.status === "completed") {
            console.log(`[PACK_REFRESH] ✅ Sync job ${syncJobId} completado`);
            const stats = (progress as any)?.stats || {};
            const updatedRows = stats.rows_updated || stats.updated_rows || 0;
            finishProgressToast(
              toastId,
              true,
              `Planilha importada com sucesso! ${updatedRows > 0 ? `${updatedRows} registros atualizados.` : "Nenhuma atualização necessária."}`
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
            finishProgressToast(toastId, false, `Importação da planilha cancelada`);
            return { success: false, error: "Cancelado" };
          }
        } catch (error) {
          console.error(`Erro ao verificar progresso do sync job ${syncJobId}:`, error);

          // Verificar se é erro de token do Google expirado
          if (isGoogleTokenError(error)) {
            const { shouldReconnect, message } = handleGoogleAuthError(error as AppError);

            if (shouldReconnect) {
              pauseJobAndShowToast(message);
              return { success: false, error: message, paused: true, needsGoogleReconnect: true };
            }
          }

          updateProgressToast(toastId, `Planilha: ${packName}`, 0, 1, "Erro ao verificar progresso, tentando novamente...", undefined, sheetsToastIcon);
        }

        attempts++;
      }

      if (!completed) {
        finishProgressToast(toastId, false, `Timeout ao sincronizar planilha (demorou mais de 10 minutos)`);
        return { success: false, error: "Timeout" };
      }

      return { success: false, error: "Job não completou" };
    },
    [pauseJob, clearJob, connectGoogle]
  );

  // ============================================================================
  // CANCEL REFRESH
  // ============================================================================

  const cancelRefresh = useCallback(async (packId: string): Promise<void> => {
    const activeRefresh = activeRefreshesRef.current.get(packId);
    if (!activeRefresh || activeRefresh.isCancelling || activeRefresh.cancelled) {
      return;
    }

    console.log(`[PACK_REFRESH] 🛑 Cancelando refresh do pack ${packId}`);

    // Evitar múltiplos cliques
    activeRefresh.isCancelling = true;
    activeRefresh.cancelled = true;

    // Mostrar "Cancelando..." imediatamente
    showCancellingToast(activeRefresh.toastId, activeRefresh.packName, metaToastIcon);

    // Cancelar job do Meta via API se já foi criado
    if (activeRefresh.metaJobId) {
      try {
        await api.facebook.cancelJobsBatch([activeRefresh.metaJobId], "Cancelado pelo usuário");
        console.log(`[PACK_REFRESH] Job Meta ${activeRefresh.metaJobId} cancelado no backend`);
      } catch (error) {
        console.error("Erro ao cancelar job Meta:", error);
      }
    } else {
      // Job ID ainda não recebido - marcar para cancelamento pendente
      console.log(`[PACK_REFRESH] Marcando cancelamento pendente para pack ${packId}`);
      activeRefresh.pendingCancellation = true;
    }

    // Cancelar job do Google Sheets se existir
    if (activeRefresh.sheetSyncJobId) {
      console.log(`[PACK_REFRESH] Cancelando sync job ${activeRefresh.sheetSyncJobId}`);
      try {
        await api.facebook.cancelJobsBatch([activeRefresh.sheetSyncJobId], "Cancelado pelo usuário");
        console.log(`[PACK_REFRESH] Sync job ${activeRefresh.sheetSyncJobId} cancelado no backend`);
      } catch (error) {
        console.error("Erro ao cancelar sync job:", error);
      }
    }

    // Fechar toast do Sheets se existir
    if (activeRefresh.sheetSyncToastId) {
      dismissToast(activeRefresh.sheetSyncToastId);
    }

    // Fechar toast após breve delay (para usuário ver "Cancelando...")
    setTimeout(() => {
      dismissToast(activeRefresh.toastId);
      showWarning(`Atualização de "${activeRefresh.packName}" cancelada`);
    }, 500);
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
        cancelled: false,
        pendingCancellation: false,
        isCancelling: false,
      };
      activeRefreshesRef.current.set(packId, activeRefresh);

      // Atualizar UI state
      setRefreshingPackIds((prev) => [...prev, packId]);
      addUpdatingPack(packId);

      // Criar handler de cancelamento
      const handleCancel = async () => {
        await cancelRefresh(packId);
      };

      // Mostrar toast imediatamente
      const estimatedTotalDays = 1;
      showProgressToast(
        toastId,
        packName,
        1,
        estimatedTotalDays,
        "Preparando atualização...",
        handleCancel,
        metaToastIcon
      );

      // Mostrar toast do Sheets imediatamente se sabemos que há integração
      if (sheetIntegrationId) {
        activeRefresh.sheetSyncToastId = `sync-sheet-${packId}`;
        showProgressToast(activeRefresh.sheetSyncToastId, `Planilha: ${packName}`, 1, 2, "Preparando importação...", undefined, sheetsToastIcon);
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

        // Verificar se foi cancelado antes de receber job_id
        if (activeRefresh.cancelled && activeRefresh.pendingCancellation && refreshResult.job_id) {
          console.log(`[PACK_REFRESH] Executando cancelamento pendente para job ${refreshResult.job_id}`);

          const jobsToCancel = [refreshResult.job_id];
          if (activeRefresh.sheetSyncJobId) {
            jobsToCancel.push(activeRefresh.sheetSyncJobId);
          }

          try {
            await api.facebook.cancelJobsBatch(jobsToCancel, "Cancelado pelo usuário (pendente)");
            console.log(`[PACK_REFRESH] Jobs cancelados: ${jobsToCancel.join(", ")}`);
          } catch (error) {
            console.error("Erro ao cancelar jobs pendentes:", error);
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
          updateProgressToast(activeRefresh.sheetSyncToastId, `Planilha: ${packName}`, 1, 2, "Importando planilha...", undefined, sheetsToastIcon);
          pollSheetSyncJob(
            activeRefresh.sheetSyncJobId,
            activeRefresh.sheetSyncToastId,
            packName,
            packId,
            sheetIntegrationId || "",
            () => activeRefresh.cancelled
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
        const totalDays = calculateDaysBetween(dateRange.since, dateRange.until);
        updateProgressToast(toastId, packName, 1, totalDays, undefined, handleCancel, metaToastIcon);

        // Fazer polling do job Meta
        let completed = false;
        let attempts = 0;
        const maxAttempts = 150; // 5 minutos máximo

        while (!completed && attempts < maxAttempts && !activeRefresh.cancelled) {
          await new Promise((resolve) => setTimeout(resolve, 2000)); // Aguardar 2 segundos

          if (activeRefresh.cancelled) {
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
              updateProgressToast(activeRefresh.sheetSyncToastId!, `Planilha: ${packName}`, 1, 2, "Importando planilha...", undefined, sheetsToastIcon);
              pollSheetSyncJob(
                activeRefresh.sheetSyncJobId!,
                activeRefresh.sheetSyncToastId!,
                packName,
                packId,
                integrationIdToUse,
                () => activeRefresh.cancelled
              ).catch((error) => {
                console.error(`Erro no polling do sync job:`, error);
              });
            }

            // Calcular progresso granular
            const progressPercent = calculateProgress(progress.status, details);
            const currentDay = progressToDays(progressPercent, totalDays);

            // Usar mensagens user-friendly
            let displayMessage: string;
            if (progress.status === "meta_running") {
              displayMessage = "Preparando atualização...";
            } else if (progress.status === "processing" || progress.status === "persisting") {
              const stage = details?.stage || "";
              displayMessage = getStageMessage(stage, details);
            } else {
              displayMessage = getStatusMessage(progress.status, details?.stage, details);
            }

            updateProgressToast(toastId, packName, currentDay, totalDays, displayMessage, handleCancel, metaToastIcon);

            if (progress.status === "completed") {
              const adsCount = Array.isArray(progress.data) ? progress.data.length : 0;
              finishProgressToast(
                toastId,
                true,
                `"${packName}" atualizado com sucesso! ${adsCount > 0 ? `${adsCount} anúncios atualizados.` : ""}`
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
            const lastKnownDay = attempts > 0 ? Math.min(attempts, totalDays) : 1;
            updateProgressToast(
              toastId,
              packName,
              lastKnownDay,
              totalDays,
              "Erro ao verificar progresso, tentando novamente...",
              handleCancel,
              metaToastIcon
            );
          }

          attempts++;
        }

        // Verificar se foi cancelado
        if (activeRefresh.cancelled) {
          return;
        }

        if (!completed) {
          finishProgressToast(toastId, false, `Timeout ao atualizar "${packName}" (demorou mais de 5 minutos)`);
          options?.onError?.(new Error("Timeout"));
        }
      } catch (error) {
        // Não mostrar erro se foi cancelado
        if (!activeRefresh.cancelled) {
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
    isRefreshing,
    refreshingPackIds,
  };
}

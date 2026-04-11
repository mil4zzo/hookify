"use client";

/**
 * Hook para criação de packs com progresso via toast.
 *
 * Reutiliza a mesma infra de polling e toast do refresh (pollJob, showProgressToast, etc.).
 * O modal fecha imediatamente após o job iniciar; o progresso aparece no toast.
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import { api } from "@/lib/api/endpoints";
import { useClientPacks } from "@/lib/hooks/useClientSession";
import { useActiveJobsStore } from "@/lib/store/activeJobs";
import {
  showProgressToast,
  updateProgressToast,
  finishProgressToast,
  showCancellingToast,
  dismissToast,
  showWarning,
  calculateMetaProgressPercent,
  buildMetaToastContent,
  type ProgressToastContent,
} from "@/lib/utils/toast";
import { pollJob } from "@/lib/utils/pollJob";
import { pollPackBackgroundTasks } from "@/lib/utils/pollPackBackgroundTasks";
import { filterVideoAds } from "@/lib/utils/filterVideoAds";
import { getAdStatistics } from "@/lib/utils/adCounting";
import { MetaIcon } from "@/components/icons/MetaIcon";
import { logger } from "@/lib/utils/logger";
import type { AdsPack } from "@/lib/types";

// ============================================================================
// TYPES
// ============================================================================

export interface PackCreationParams {
  adaccount_id: string;
  date_start: string;
  date_stop: string;
  level: "campaign" | "adset" | "ad";
  limit: number;
  filters: any[];
  name: string;
  auto_refresh: boolean;
  today_local: string;
}

export interface PackCreationOptions {
  onComplete?: (result: { packId: string; packName: string; adsCount: number }) => void;
  onError?: (error: Error) => void;
}

export interface UsePackCreationReturn {
  startCreation: (params: PackCreationParams) => Promise<{ jobId: string } | null>;
  cancelCreation: () => Promise<void>;
  isCreating: boolean;
}

// ============================================================================
// HOOK
// ============================================================================

const metaToastIcon = React.createElement(MetaIcon, { className: "h-5 w-5 flex-shrink-0" });

export function usePackCreation(options?: PackCreationOptions): UsePackCreationReturn {
  const { addPack, removePack } = useClientPacks();
  const { addActiveJob, removeActiveJob } = useActiveJobsStore();

  const [isCreating, setIsCreating] = useState(false);
  const mountedRef = useRef(true);
  const cancelledRef = useRef(false);
  const jobIdRef = useRef<string | null>(null);
  const packIdRef = useRef<string | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ============================================================================
  // CANCEL
  // ============================================================================

  const cancelCreation = useCallback(async () => {
    if (cancelledRef.current) return;
    cancelledRef.current = true;

    const jobId = jobIdRef.current;
    const packId = packIdRef.current;
    const toastId = jobId ? `create-pack-${jobId}` : null;

    // Cancel the backend job
    if (jobId) {
      if (toastId) showCancellingToast(toastId, "Pack", metaToastIcon);
      try {
        await api.facebook.cancelJobsBatch([jobId], "Criação cancelada pelo usuário");
      } catch (error) {
        logger.error("Erro ao cancelar job de criação:", error);
      }
    }

    // Delete pack if already created
    if (packId) {
      try {
        removePack(packId);
      } catch {}
      try {
        const { removeCachedPackAds } = await import("@/lib/storage/adsCache");
        await removeCachedPackAds(packId);
      } catch {}
      try {
        await api.analytics.deletePack(packId, []);
      } catch {}
    }

    // Cleanup
    if (toastId) {
      dismissToast(toastId);
    }
    showWarning("Criação do pack cancelada.");
    if (jobId) removeActiveJob(jobId);
    jobIdRef.current = null;
    packIdRef.current = null;
    setIsCreating(false);
  }, [removePack, removeActiveJob]);

  // ============================================================================
  // START CREATION
  // ============================================================================

  const startCreation = useCallback(
    async (params: PackCreationParams): Promise<{ jobId: string } | null> => {
      if (isCreating) {
        logger.warn("[PACK_CREATION] Já existe uma criação em andamento");
        return null;
      }

      cancelledRef.current = false;
      packIdRef.current = null;
      setIsCreating(true);

      const startTime = Date.now();
      const packName = params.name;

      try {
        // Start the job
        const result = await api.facebook.startAdsJob(params);

        if (!result.job_id) {
          throw new Error("Falha ao iniciar job de busca de anúncios");
        }

        if (cancelledRef.current) {
          try { await api.facebook.cancelJobsBatch([result.job_id], "Cancelado antes de iniciar"); } catch {}
          setIsCreating(false);
          return null;
        }

        const jobId = result.job_id;
        jobIdRef.current = jobId;

        if (!addActiveJob(jobId)) {
          logger.warn(`[PACK_CREATION] Polling já ativo para job ${jobId}`);
          setIsCreating(false);
          return null;
        }

        const toastId = `create-pack-${jobId}`;

        const handleCancel = () => cancelCreation();

        // Show initial toast
        showProgressToast(
          toastId, packName, 1, 5,
          undefined, handleCancel, metaToastIcon,
          buildMetaToastContent("meta_running", {}), 0
        );

        // Return immediately — polling runs in background
        const jobIdResult = { jobId };

        // Background polling (fire and forget)
        type CreationResult = { completed: boolean; adsCount: number };

        pollJob<CreationResult>({
          label: `create-${jobId.slice(0, 8)}`,
          maxAttempts: 600, // 20 min
          getCancelled: () => cancelledRef.current,
          getMounted: () => mountedRef.current,

          fetchProgress: () => api.facebook.getJobProgress(jobId),

          handleProgress: (progress, lastPercent) => {
            const details = (progress as any)?.details || {};
            const apiProgress = (progress as any)?.progress;
            const progressPercent = calculateMetaProgressPercent(progress.status, details, apiProgress);

            updateProgressToast(
              toastId, packName, 1, 5,
              undefined, handleCancel, metaToastIcon,
              buildMetaToastContent(progress.status, details, (progress as any)?.message),
              progressPercent
            );

            if (progress.status === "completed") {
              // Handle completion asynchronously
              handleCreationCompleted(progress, toastId, packName, jobId, params, startTime);
              return { done: true, result: { completed: true, adsCount: (progress as any)?.result_count || 0 } };
            }

            if (progress.status === "failed") {
              const error = new Error(progress.message || `Erro ao criar pack "${packName}"`);
              logger.error(error);
              finishProgressToast(toastId, false, error.message);
              optionsRef.current?.onError?.(error);
              cleanup(jobId);
              return { done: true, result: { completed: false, adsCount: 0 } };
            }

            if (progress.status === "cancelled") {
              cleanup(jobId);
              return { done: true, result: { completed: false, adsCount: 0 } };
            }

            return { done: false, progressPercent };
          },

          handleError: (error, consecutiveErrors, lastPercent) => {
            logger.error(`Erro ao verificar progresso da criação:`, error);
            updateProgressToast(
              toastId, packName, 1, 5,
              undefined, handleCancel, metaToastIcon,
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
            finishProgressToast(toastId, false, `Timeout ao criar "${packName}" (demorou mais de 20 minutos)`);
            optionsRef.current?.onError?.(new Error("Timeout"));
            cleanup(jobId);
            return { completed: false, adsCount: 0 };
          },
          onCancelled: () => {
            cleanup(jobId);
            return { completed: false, adsCount: 0 };
          },
          onUnmounted: () => {
            cleanup(jobId);
            return { completed: false, adsCount: 0 };
          },
          onMaxConsecutiveErrors: () => {
            finishProgressToast(toastId, false, `Erro persistente ao criar "${packName}". Tente novamente.`);
            optionsRef.current?.onError?.(new Error("Erros consecutivos"));
            cleanup(jobId);
            return { completed: false, adsCount: 0 };
          },
        }).catch((err) => {
          logger.error("[PACK_CREATION] Erro inesperado no polling:", err);
          cleanup(jobId);
        });

        return jobIdResult;
      } catch (error) {
        logger.error("[PACK_CREATION] Erro ao iniciar criação:", error);
        setIsCreating(false);
        throw error;
      }
    },
    [isCreating, addActiveJob, cancelCreation]
  );

  // ============================================================================
  // HELPERS
  // ============================================================================

  function cleanup(jobId: string) {
    removeActiveJob(jobId);
    jobIdRef.current = null;
    packIdRef.current = null;
    setIsCreating(false);
  }

  async function handleCreationCompleted(
    progress: any,
    toastId: string,
    packName: string,
    jobId: string,
    params: PackCreationParams,
    startTime: number,
  ) {
    try {
      const packId = progress.pack_id;
      if (!packId) {
        const resultCount = progress.result_count || 0;
        if (resultCount === 0) {
          finishProgressToast(toastId, false, "Nenhum anúncio encontrado para os parâmetros selecionados.");
        } else {
          finishProgressToast(toastId, false, "Erro: Pack ID não retornado pelo backend.");
        }
        cleanup(jobId);
        return;
      }

      packIdRef.current = packId;

      if (cancelledRef.current) {
        cleanup(jobId);
        return;
      }

      // Fetch full pack from backend
      const packResponse = await api.analytics.getPack(packId, true);

      if (!packResponse.success || !packResponse.pack) {
        logger.error("usePackCreation: getPack retornou falha após criação", { packId });
        finishProgressToast(toastId, false, "Erro ao carregar pack criado.");
        cleanup(jobId);
        return;
      }

      const backendPack = packResponse.pack;
      const formattedAds = Array.isArray(backendPack.ads) ? backendPack.ads : [];
      const videoAds = filterVideoAds(formattedAds);

      if (!videoAds || videoAds.length === 0) {
        finishProgressToast(toastId, false, "Nenhum anúncio de vídeo retornado para os parâmetros selecionados.");
        cleanup(jobId);
        return;
      }

      if (cancelledRef.current) {
        cleanup(jobId);
        return;
      }

      // Build pack object
      const backendStats = backendPack.stats || {};
      const localStats = getAdStatistics(formattedAds);

      const pack = {
        id: packId,
        name: backendPack.name || packName,
        adaccount_id: backendPack.adaccount_id || params.adaccount_id,
        date_start: backendPack.date_start || params.date_start,
        date_stop: backendPack.date_stop || params.date_stop,
        level: "ad" as const,
        filters: backendPack.filters || params.filters,
        auto_refresh: backendPack.auto_refresh || params.auto_refresh || false,
        ads: [],
        stats: {
          totalAds: backendStats.totalAds || formattedAds.length,
          uniqueAds: backendStats.uniqueAds || localStats.uniqueAds,
          uniqueAdNames: backendStats.uniqueAdNames || localStats.uniqueAds,
          uniqueCampaigns: backendStats.uniqueCampaigns || localStats.uniqueCampaigns,
          uniqueAdsets: backendStats.uniqueAdsets || localStats.uniqueAdsets,
          totalSpend: backendStats.totalSpend || localStats.totalSpend,
          totalClicks: backendStats.totalClicks || formattedAds.reduce((sum: number, ad: any) => sum + (ad.clicks || 0), 0),
          totalImpressions: backendStats.totalImpressions || formattedAds.reduce((sum: number, ad: any) => sum + (ad.impressions || 0), 0),
          totalReach: backendStats.totalReach || formattedAds.reduce((sum: number, ad: any) => sum + (ad.reach || 0), 0),
          totalInlineLinkClicks: backendStats.totalInlineLinkClicks || formattedAds.reduce((sum: number, ad: any) => sum + (ad.inline_link_clicks || 0), 0),
          totalPlays: backendStats.totalPlays || formattedAds.reduce((sum: number, ad: any) => sum + (ad.video_plays || 0), 0),
          totalThruplays: backendStats.totalThruplays || formattedAds.reduce((sum: number, ad: any) => sum + (ad.video_thruplay || 0), 0),
          ctr: backendStats.ctr || 0,
          cpm: backendStats.cpm || 0,
          frequency: backendStats.frequency || 0,
        },
        created_at: backendPack.created_at || new Date().toISOString(),
        updated_at: backendPack.updated_at || new Date().toISOString(),
      };

      addPack(pack);

      // Background tasks polling (thumbnails + stats estendidos)
      pollPackBackgroundTasks(jobId);

      // Cache ads to IndexedDB
      if (formattedAds.length > 0) {
        try {
          const { cachePackAds } = await import("@/lib/storage/adsCache");
          await cachePackAds(packId, formattedAds);
        } catch (error) {
          logger.error("Erro ao salvar ads no cache:", error);
        }
      }

      // Check warnings
      const warnings = progress.warnings || [];
      if (warnings.length > 0) {
        warnings.forEach((warning: string) => {
          showWarning(warning);
        });
      }

      // Success toast
      const totalAds = formattedAds.length;
      const videoAdsCount = videoAds.length;
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      const elapsedStr = elapsedSec >= 60
        ? `${Math.floor(elapsedSec / 60)}min e ${elapsedSec % 60}s`
        : `${elapsedSec}s`;

      const message = totalAds === videoAdsCount
        ? `Pack "${packName}" criado com ${videoAdsCount} anúncios de vídeo (${elapsedStr}).`
        : `Pack "${packName}" criado com ${videoAdsCount} anúncios de vídeo de ${totalAds} total (${elapsedStr}).`;

      finishProgressToast(toastId, true, message, { visibleDurationOnly: 5, context: "meta", packName });

      optionsRef.current?.onComplete?.({ packId, packName, adsCount: totalAds });
    } catch (error) {
      logger.error("usePackCreation: erro no handleCreationCompleted:", error);
      finishProgressToast(toastId, false, error instanceof Error ? error.message : "Erro ao finalizar criação do pack");
      optionsRef.current?.onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      cleanup(jobId);
    }
  }

  return { startCreation, cancelCreation, isCreating };
}

import { api } from "@/lib/api/endpoints";
import { logger } from "@/lib/utils/logger";
import { showError } from "@/lib/utils/toast";

const INTERVALS_MS = [2000, 2000, 3000, 3000, 5000];
const MAX_POLLS = 60;
const MAX_MISSING_BG = 3;

function getInterval(pollIndex: number): number {
  return INTERVALS_MS[Math.min(pollIndex, INTERVALS_MS.length - 1)];
}

export interface BackgroundTasksStatus {
  thumbnails?: "pending" | "running" | "completed" | "failed";
  thumbnails_error?: string;
  stats_extended?: "pending" | "running" | "completed" | "failed";
  stats_extended_error?: string;
}

function isDone(status: BackgroundTasksStatus): boolean {
  const t = status.thumbnails;
  const s = status.stats_extended;
  // Treat absent fields as done — if the backend doesn't report a task, don't wait for it.
  const tDone = t === undefined || t === "completed" || t === "failed";
  const sDone = s === undefined || s === "completed" || s === "failed";
  return tDone && sDone;
}

async function refreshPackAdsCache(packId: string, requireReady: boolean = false): Promise<boolean> {
  const response = await api.analytics.getPackThumbnailCache(packId);
  const thumbnails = Array.isArray(response.thumbnails) ? response.thumbnails : [];
  if (!response.success || thumbnails.length === 0) return false;
  if (requireReady && !response.ready) return false;

  const { promoteCachedPackAdsThumbnails } = await import("@/lib/storage/adsCache");
  const promoted = await promoteCachedPackAdsThumbnails(packId, thumbnails);
  if (!promoted.success) {
    logger.warn("[pollPackBackgroundTasks] Failed to promote thumbnail cache:", promoted.error);
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("hookify:pack-ads-cache-updated", { detail: { packId } }));
  }

  return true;
}

export function pollPackBackgroundTasks(jobId: string, packId?: string): void {
  let polls = 0;
  let missingBgCount = 0;
  let refreshedThumbnailCache = false;
  const seenErrors = { thumbnails: false, stats_extended: false };

  const poll = async () => {
    while (polls < MAX_POLLS) {
      await new Promise((resolve) => setTimeout(resolve, getInterval(polls)));
      polls++;

      try {
        const progress = await api.facebook.getJobProgress(jobId);

        const jobStatus = (progress as any).status;
        if (jobStatus === "failed" || jobStatus === "cancelled") {
          logger.debug(`[pollPackBackgroundTasks] Job ended as ${jobStatus}, stopping`);
          break;
        }

        const bg = (progress as any).background_tasks_status as BackgroundTasksStatus | undefined;

        if (!bg) {
          missingBgCount++;
          if (missingBgCount >= MAX_MISSING_BG) {
            if (packId && !refreshedThumbnailCache) {
              const refreshed = await refreshPackAdsCache(packId, true);
              if (refreshed) refreshedThumbnailCache = true;
            }
            logger.debug("[pollPackBackgroundTasks] Missing background status, stopping");
            break;
          }
          continue;
        }
        missingBgCount = 0;

        if (bg.thumbnails === "completed" && packId && !refreshedThumbnailCache) {
          refreshedThumbnailCache = await refreshPackAdsCache(packId).catch((error) => {
            logger.warn("[pollPackBackgroundTasks] Failed to refresh thumbnail cache:", error);
            return false;
          });
        }

        if (bg.thumbnails === "failed" && !seenErrors.thumbnails) {
          seenErrors.thumbnails = true;
          const msg = bg.thumbnails_error || "Falha ao processar thumbnails em segundo plano.";
          showError({ message: msg });
          logger.warn("[pollPackBackgroundTasks] Thumbnails failed:", msg);
        }

        if (bg.stats_extended === "failed" && !seenErrors.stats_extended) {
          seenErrors.stats_extended = true;
          const msg = bg.stats_extended_error || "Falha ao calcular estatisticas completas em segundo plano.";
          showError({ message: msg });
          logger.warn("[pollPackBackgroundTasks] Extended stats failed:", msg);
        }

        if (isDone(bg)) break;
      } catch (error) {
        logger.debug("[pollPackBackgroundTasks] Poll error, continuing:", error);
      }
    }
  };

  poll();
}

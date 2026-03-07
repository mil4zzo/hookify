/**
 * Polling de background tasks (thumbnails + stats estendidos) após criação de pack.
 * Exibe toast de erro imediatamente quando alguma task falha.
 * Sem toast de sucesso (conforme plano).
 */
import { api } from "@/lib/api/endpoints";
import { showError } from "@/lib/utils/toast";
import { logger } from "@/lib/utils/logger";

// Backoff progressivo: 2s, 2s, 3s, 3s, 5s, 5s, 5s...
const INTERVALS_MS = [2000, 2000, 3000, 3000, 5000];
const MAX_POLLS = 60;
const MAX_MISSING_BG = 3; // Parar se 3 polls consecutivos sem background_tasks_status

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
  const tDone = t === "completed" || t === "failed";
  const sDone = s === "completed" || s === "failed";
  return tDone && sDone;
}

/**
 * Polla o progresso do job para detectar falhas nas tasks em background.
 * Roda em background (não bloquear a UI). Exibe toast de erro quando detecta falha.
 */
export function pollPackBackgroundTasks(jobId: string): void {
  let polls = 0;
  let missingBgCount = 0;
  const seenErrors = { thumbnails: false, stats_extended: false };

  const poll = async () => {
    while (polls < MAX_POLLS) {
      await new Promise((r) => setTimeout(r, getInterval(polls)));
      polls++;

      try {
        const progress = await api.facebook.getJobProgress(jobId);
        const bg = (progress as any).background_tasks_status as BackgroundTasksStatus | undefined;

        if (!bg) {
          missingBgCount++;
          if (missingBgCount >= MAX_MISSING_BG) {
            logger.debug("[pollPackBackgroundTasks] Sem background_tasks_status após", missingBgCount, "polls, parando");
            break;
          }
          continue;
        }
        missingBgCount = 0;

        if (bg.thumbnails === "failed" && !seenErrors.thumbnails) {
          seenErrors.thumbnails = true;
          const msg = bg.thumbnails_error || "Falha ao processar thumbnails em segundo plano.";
          showError({ message: msg });
          logger.warn("[pollPackBackgroundTasks] Thumbnails falhou:", msg);
        }
        if (bg.stats_extended === "failed" && !seenErrors.stats_extended) {
          seenErrors.stats_extended = true;
          const msg = bg.stats_extended_error || "Falha ao calcular estatísticas completas em segundo plano.";
          showError({ message: msg });
          logger.warn("[pollPackBackgroundTasks] Stats estendidos falhou:", msg);
        }

        if (isDone(bg)) break;
      } catch (e) {
        logger.debug("[pollPackBackgroundTasks] Erro ao poll (continuando):", e);
      }
    }
  };

  poll();
}

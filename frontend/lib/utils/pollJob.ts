import { logger } from "@/lib/utils/logger";
import { getIsLoggingOut } from "@/lib/api/client";

export interface PollJobConfig<TResult> {
  /** Label for debug logs */
  label: string;
  /** Polling interval in ms (default: 2000) */
  intervalMs?: number;
  /** Max polling attempts before timeout */
  maxAttempts: number;
  /**
   * Optional stall detection: give up only if the progress signature stays
   * unchanged for this long. When set, every signature change ALSO resets the
   * attempts counter, so a job that keeps signaling life is never abandoned by
   * wall-clock time — maxAttempts becomes "max attempts without any change"
   * (a redundant backstop). Include a backend keepalive in the signature so
   * long-running items don't read as stalls.
   */
  stallTimeoutMs?: number;
  /** Max consecutive fetch errors before giving up (default: 5) */
  maxConsecutiveErrors?: number;
  /** Returns true if the job was cancelled */
  getCancelled: () => boolean;
  /** Returns true if the component is still mounted */
  getMounted: () => boolean;
  /** Fetch current progress from backend */
  fetchProgress: () => Promise<any>;
  /**
   * Process a successful progress response.
   * Receives lastPercent so handlers can build on previous progress.
   * Return { done: true, result } to stop polling, or { done: false, progressPercent } to continue.
   */
  handleProgress: (
    progress: any,
    lastPercent: number
  ) =>
    | { done: true; result: TResult }
    | {
        done: false;
        progressPercent: number;
        /**
         * Fine-grained progress marker for stall detection (e.g. "12/104").
         * Falls back to progressPercent when omitted.
         */
        progressSignature?: string;
      };
  /**
   * Handle a fetch error. Receives consecutive error count and last known progress.
   * Use lastPercent to preserve progress instead of resetting to 0.
   */
  handleError: (
    error: unknown,
    consecutiveErrors: number,
    lastPercent: number
  ) => void;
  /** Called when maxAttempts is reached */
  onTimeout: () => TResult;
  /** Called when getCancelled() returns true */
  onCancelled: () => TResult;
  /** Called when getMounted() returns false (component unmounted) */
  onUnmounted: () => TResult;
  /** Called when maxConsecutiveErrors is reached */
  onMaxConsecutiveErrors: () => TResult;
}

export async function pollJob<TResult>(
  config: PollJobConfig<TResult>
): Promise<TResult> {
  const {
    label,
    intervalMs = 2000,
    maxAttempts,
    stallTimeoutMs,
    maxConsecutiveErrors = 5,
    getCancelled,
    getMounted,
    fetchProgress,
    handleProgress,
    handleError,
    onTimeout,
    onCancelled,
    onUnmounted,
    onMaxConsecutiveErrors,
  } = config;

  let attempts = 0;
  let consecutiveErrors = 0;
  let lastPercent = 0;
  let lastProgressSignature: string | null = null;
  let lastProgressChangeAt = Date.now();

  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    if (!getMounted()) {
      logger.debug(`[pollJob:${label}] Component unmounted, stopping`);
      return onUnmounted();
    }
    if (getCancelled() || getIsLoggingOut()) {
      logger.debug(`[pollJob:${label}] Cancelled before fetch`);
      return onCancelled();
    }

    try {
      const progress = await fetchProgress();

      if (!getMounted()) {
        logger.debug(`[pollJob:${label}] Unmounted after fetch`);
        return onUnmounted();
      }
      if (getCancelled() || getIsLoggingOut()) {
        logger.debug(`[pollJob:${label}] Cancelled after fetch`);
        return onCancelled();
      }

      consecutiveErrors = 0;
      const result = handleProgress(progress, lastPercent);

      if (result.done) {
        return result.result;
      }
      lastPercent = result.progressPercent;

      if (stallTimeoutMs !== undefined) {
        const signature = result.progressSignature ?? String(result.progressPercent);
        if (signature !== lastProgressSignature) {
          lastProgressSignature = signature;
          lastProgressChangeAt = Date.now();
          attempts = 0; // job vivo: nunca desistir por relógio
        } else if (Date.now() - lastProgressChangeAt >= stallTimeoutMs) {
          logger.warn(
            `[pollJob:${label}] Stalled: no progress for ${stallTimeoutMs}ms (signature "${signature}")`
          );
          return onTimeout();
        }
      }
    } catch (error) {
      if (!getMounted()) return onUnmounted();
      if (getCancelled()) return onCancelled();

      consecutiveErrors++;
      handleError(error, consecutiveErrors, lastPercent);

      if (consecutiveErrors >= maxConsecutiveErrors) {
        logger.warn(
          `[pollJob:${label}] ${maxConsecutiveErrors} consecutive errors, giving up`
        );
        return onMaxConsecutiveErrors();
      }
    }

    attempts++;
  }

  if (getCancelled()) return onCancelled();
  if (!getMounted()) return onUnmounted();

  logger.warn(`[pollJob:${label}] Timeout after ${maxAttempts} attempts`);
  return onTimeout();
}

/**
 * Fila de transcrição por pack: lógica pura, sem React nem toast.
 *
 * O backend permite um job de transcrição vivo por pack. Um pedido que chega com um
 * job vivo espera ele terminar e depois é refeito — o backend recalcula os pendentes
 * nessa hora, então só o que sobrou vira job.
 */

export interface QueuedTranscription {
  /** undefined = pack inteiro */
  adNames?: string[];
  forceNoAudio: boolean;
}

/** Junta um pedido novo ao que já está na fila do pack. Sem lista = pack inteiro, que
 *  contém qualquer lista — então vence a união. */
export function mergeQueuedTranscription(
  queued: QueuedTranscription,
  incoming: { adNames?: string[]; forceNoAudio?: boolean },
): QueuedTranscription {
  return {
    adNames: queued.adNames && incoming.adNames ? Array.from(new Set([...queued.adNames, ...incoming.adNames])) : undefined,
    forceNoAudio: queued.forceNoAudio || !!incoming.forceNoAudio,
  };
}

const TERMINAL_STATUSES = new Set(["completed", "cancelled", "failed"]);

export interface WaitForJobEndOptions {
  fetchStatus: () => Promise<{ status: string; details?: { done?: unknown; total?: unknown; keepalive_at?: unknown } }>;
  isCancelled: () => boolean;
  intervalMs?: number;
  maxWaitMs?: number;
  maxConsecutiveErrors?: number;
  /** Sem NENHUMA mudança na assinatura de progresso por tanto tempo, o job é dado como morto
   *  (backend reiniciado no meio: fica `processing` para sempre). Mesmo critério do polling
   *  normal da transcrição, que inclui o keepalive de 30 s do backend. */
  stallMs?: number;
}

/** Espera o job chegar a um estado final. Job morto (sem sinal), falhas seguidas de rede ou o
 *  teto de tempo também liberam a fila — o backend decide, de novo, se ainda há job vivo. */
export async function waitForTranscriptionJobEnd({
  fetchStatus,
  isCancelled,
  intervalMs = 3000,
  maxWaitMs = 30 * 60_000,
  maxConsecutiveErrors = 5,
  stallMs = 5 * 60_000,
}: WaitForJobEndOptions): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  let consecutiveErrors = 0;
  let lastSignature: string | null = null;
  let lastChangeAt = Date.now();
  while (!isCancelled() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    if (isCancelled()) return;
    try {
      const { status, details } = await fetchStatus();
      consecutiveErrors = 0;
      if (TERMINAL_STATUSES.has(status)) return;
      const signature = `${status}:${details?.done ?? ""}/${details?.total ?? ""}:${details?.keepalive_at ?? ""}`;
      if (signature !== lastSignature) {
        lastSignature = signature;
        lastChangeAt = Date.now();
      } else if (Date.now() - lastChangeAt >= stallMs) {
        return;
      }
    } catch {
      if (++consecutiveErrors >= maxConsecutiveErrors) return;
    }
  }
}

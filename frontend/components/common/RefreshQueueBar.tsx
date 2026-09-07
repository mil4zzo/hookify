"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { useRefreshQueueStore, selectQueuedCount } from "@/lib/store/refreshQueue";
import { cancelQueuedPackRefreshes } from "@/lib/hooks/usePackRefresh";

/**
 * Placar do lote de atualizações — a faixa fina no pé da coluna do canto (ver AppToaster).
 *
 * Existe porque quem está na fila deixou de emitir toast: este é o ÚNICO lugar da interface
 * onde os packs que ainda esperam a vez aparecem, e o único de onde dá para pará-los.
 * O nome e o progresso do pack ativo não são repetidos aqui de propósito — eles já estão no
 * card da frente da pilha, logo acima.
 */
export function RefreshQueueBar() {
  const queuedCount = useRefreshQueueStore(selectQueuedCount);
  const doneCount = useRefreshQueueStore((state) => state.doneCount);
  const failedCount = useRefreshQueueStore((state) => state.failedCount);

  if (queuedCount === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto flex h-control-default w-[22rem] animate-in fade-in slide-in-from-bottom-2 max-w-[min(22rem,calc(100vw-1rem))] items-center gap-2 rounded-lg border border-border bg-card px-3 shadow-elevation-overlay"
    >
      <span className="relative flex h-2 w-2 flex-none" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60 motion-reduce:hidden" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
      </span>

      <span className="whitespace-nowrap text-xs font-medium text-foreground">{queuedCount} na fila</span>

      {(doneCount > 0 || failedCount > 0) && <div className="h-4 w-px flex-none bg-border" />}
      {doneCount > 0 && <span className="whitespace-nowrap text-xs text-muted-foreground">{doneCount} ok</span>}
      {failedCount > 0 && (
        <span className="whitespace-nowrap text-xs text-destructive">
          {failedCount} {failedCount === 1 ? "falhou" : "falharam"}
        </span>
      )}

      <div className="flex-1" />

      <Button
        variant="ghost"
        size="sm"
        className="px-2 text-xs text-muted-foreground hover:text-destructive"
        onClick={() => cancelQueuedPackRefreshes()}
      >
        Cancelar fila
      </Button>
    </div>
  );
}

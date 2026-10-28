"use client";

import React from "react";
import { IconAlertTriangle, IconArrowsMaximize, IconCircleCheck, IconLoader2, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { bulkBudgetCountText } from "@/lib/hooks/useBulkBudgetRunner";
import { isBulkBudgetJobBusy, useBulkBudgetJobStore, type BulkBudgetJob } from "@/lib/store/bulkBudgetJob";
import { cn } from "@/lib/utils/cn";

function summarize(job: BulkBudgetJob): { tone: "busy" | "success" | "warning"; text: string } {
  if (job.status === "running") return { tone: "busy", text: `Aplicando orçamento em ${bulkBudgetCountText(job.sentIds.length, job.entityType)}…` };
  if (job.retrying.length > 0) return { tone: "busy", text: `Tentando de novo em ${bulkBudgetCountText(job.retrying.length, job.entityType)}…` };
  if (job.status === "error") return { tone: "warning", text: "Orçamento: não foi possível confirmar o resultado." };
  const items = Object.values(job.items);
  const updated = items.filter((it) => it.outcome === "updated").length;
  const failed = items.filter((it) => it.outcome === "failed").length;
  if (failed > 0) return { tone: "warning", text: `Orçamento: ${updated} de ${updated + failed} mudaram, ${failed} com erro.` };
  if (updated === 0) return { tone: "warning", text: "Orçamento: nada foi alterado." };
  return { tone: "success", text: `Orçamento de ${bulkBudgetCountText(updated, job.entityType)} atualizado.` };
}

/**
 * O diálogo de orçamento em massa minimizado — mora na coluna do canto (ver AppToaster), em
 * qualquer página. Enquanto o lote trabalha não tem como dispensar: é o único fio até o
 * resultado. Terminado, fica até a pessoa abrir o resultado ou dispensar (o que conta como visto).
 */
export function BulkBudgetMiniCard() {
  const job = useBulkBudgetJobStore((s) => s.job);
  const dialogOpen = useBulkBudgetJobStore((s) => s.dialogOpen);
  const openDialog = useBulkBudgetJobStore((s) => s.openDialog);
  const acknowledge = useBulkBudgetJobStore((s) => s.acknowledge);

  if (!job || dialogOpen) return null;
  const busy = isBulkBudgetJobBusy(job);
  if (!busy && job.seen) return null;

  const { tone, text } = summarize(job);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto flex w-[22rem] max-w-[min(22rem,calc(100vw-1rem))] animate-in fade-in slide-in-from-bottom-2 items-center gap-3 rounded-lg border border-border bg-card py-2 pl-3 pr-2 shadow-elevation-overlay"
    >
      <span className={cn("flex h-4 w-4 flex-none items-center justify-center", tone === "success" && "text-success", tone === "warning" && "text-warning")}>
        {tone === "busy" ? <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : tone === "success" ? <IconCircleCheck className="h-4 w-4" /> : <IconAlertTriangle className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1 text-xs font-medium text-foreground">{text}</span>
      <Button variant="outline" size="sm" onClick={openDialog}>
        {busy ? <IconArrowsMaximize className="h-3.5 w-3.5" /> : null}
        {busy ? "Expandir" : "Ver resultado"}
      </Button>
      {!busy ? (
        <Button variant="ghost" size="icon" aria-label="Dispensar" onClick={acknowledge}>
          <IconX className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}

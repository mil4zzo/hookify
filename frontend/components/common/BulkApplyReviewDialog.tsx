"use client";

import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import type { BulkReview } from "@/lib/utils/bulkApplyReview";

interface BulkApplyReviewDialogProps {
  /** `null` = fechado. */
  review: BulkReview | null;
  packCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Segunda confirmação das configurações em massa: o que vai ser gravado, igual em
 * todos os packs, com o que é SOBRESCRITO primeiro (aviso) e o informativo depois.
 * Aberto por cima do diálogo de configuração (`nested`). Só abre quando
 * `review.needsConfirm` — quem chama decide (ver `bulkApplyReview.ts`).
 */
export function BulkApplyReviewDialog({ review, packCount, onCancel, onConfirm }: BulkApplyReviewDialogProps) {
  const lines = review ? [...review.lines.filter((l) => l.overwrites), ...review.lines.filter((l) => !l.overwrites)] : [];
  const noun = packCount === 1 ? "pack" : "packs";
  return (
    <ConfirmDialog
      isOpen={!!review}
      onClose={onCancel}
      title={`Aplicar igual aos ${packCount} ${noun}?`}
      message="Nada é adaptado por pack: o que você configurou vale exatamente igual em todos, inclusive onde substitui o que o pack já tinha."
      layout="left-aligned"
      size="lg"
      nested
      cancelText="Voltar e revisar"
      confirmText={`Aplicar aos ${packCount} ${noun}`}
      onConfirm={onConfirm}
    >
      <ul className="space-y-3">
        {lines.map((line, index) => (
          <li key={index} className="flex items-start gap-2 text-sm">
            {line.overwrites ? (
              <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-label="Substitui o que o pack tinha" />
            ) : (
              <IconInfoCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className={line.overwrites ? "text-foreground" : "text-muted-foreground"}>{line.text}</span>
          </li>
        ))}
      </ul>
    </ConfirmDialog>
  );
}

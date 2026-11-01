"use client";

import { useTranslations } from "next-intl";
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
  const t = useTranslations("commonUi");
  const lines = review ? [...review.lines.filter((l) => l.overwrites), ...review.lines.filter((l) => !l.overwrites)] : [];
  return (
    <ConfirmDialog
      isOpen={!!review}
      onClose={onCancel}
      title={t("bulkReview.title", { count: packCount })}
      message={t("bulkReview.message")}
      layout="left-aligned"
      size="lg"
      nested
      cancelText={t("bulkReview.back")}
      confirmText={t("bulkReview.confirm", { count: packCount })}
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

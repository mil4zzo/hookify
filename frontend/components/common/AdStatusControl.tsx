"use client";

import { useTranslations } from "next-intl";
import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { IconLoader2, IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react";
import { useAdStatusControl, type AdEntityType, type AdEntityStatus } from "@/lib/hooks/useAdStatusControl";

export interface AdStatusControlProps {
  entityType: AdEntityType;
  entityId: string;
  currentStatus?: string | null;
  variant?: "button" | "icon" | "inline";
  showConfirm?: boolean;
  stopPropagation?: boolean;
  onStatusChange?: (newStatus: AdEntityStatus) => void;
}

export function AdStatusControl({ entityType, entityId, currentStatus, variant = "icon", showConfirm = true, stopPropagation = true, onStatusChange }: AdStatusControlProps) {
  const t = useTranslations("commonUi");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { isPaused, isLoading, toggleStatus, pause, resume } = useAdStatusControl({
    entityType,
    entityId,
    currentStatus,
    onSuccess: (s) => onStatusChange?.(s),
  });

  const label = useMemo(() => {
    return isPaused ? t("adStatus.activate", { kind: entityType }) : t("adStatus.pause", { kind: entityType });
  }, [entityType, isPaused, t]);

  const dialogConfig = useMemo(() => {
    if (isPaused) {
      return {
        title: t("adStatus.activateTitle"),
        message: t("adStatus.activateMessage", { kind: entityType }),
        confirmText: t("adStatus.activateConfirm"),
        variant: "default" as const,
      };
    } else {
      return {
        title: t("adStatus.pauseTitle"),
        message: t("adStatus.pauseMessage", { kind: entityType }),
        confirmText: t("adStatus.pauseConfirm"),
        variant: "destructive" as const,
      };
    }
  }, [entityType, isPaused, t]);

  const handleClick = async (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
    if (isLoading) return;

    // Sempre confirmar quando showConfirm estiver habilitado
    if (showConfirm) {
      setConfirmOpen(true);
      return;
    }

    await toggleStatus();
  };

  const handleConfirm = async () => {
    try {
      if (isPaused) {
        await resume();
      } else {
        await pause();
      }
    } finally {
      setConfirmOpen(false);
    }
  };

  const icon = isLoading ? <IconLoader2 className="h-4 w-4 animate-spin" /> : isPaused ? <IconPlayerPlay className="h-4 w-4" /> : <IconPlayerPause className="h-4 w-4" />;

  if (!entityId || !entityId.trim()) return null;

  return (
    <>
      {variant === "button" ? (
        <Button variant={isPaused ? "default" : "outline"} size="sm" onClick={handleClick} disabled={isLoading} title={label}>
          {icon}
          {label}
        </Button>
      ) : variant === "inline" ? (
        <button onClick={handleClick} disabled={isLoading} className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60" title={label}>
          {icon}
          <span>{label}</span>
        </button>
      ) : (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={handleClick} disabled={isLoading} aria-label={label} className="flex items-center justify-center">
                {icon}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">{label}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      <ConfirmDialog isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} title={dialogConfig.title} message={dialogConfig.message} confirmText={dialogConfig.confirmText} cancelText={t("cancel")} variant={dialogConfig.variant} isLoading={isLoading} onConfirm={handleConfirm} />
    </>
  );
}

"use client";

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
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { isPaused, isLoading, toggleStatus, pause, resume } = useAdStatusControl({
    entityType,
    entityId,
    currentStatus,
    onSuccess: (s) => onStatusChange?.(s),
  });

  const label = useMemo(() => {
    const kind = entityType === "ad" ? "anúncio" : entityType === "adset" ? "conjunto" : "campanha";
    return isPaused ? `Ativar ${kind}` : `Pausar ${kind}`;
  }, [entityType, isPaused]);

  const dialogConfig = useMemo(() => {
    const kind = entityType === "ad" ? "anúncio" : entityType === "adset" ? "conjunto" : "campanha";
    if (isPaused) {
      return {
        title: "Confirmar ativação",
        message: `Tem certeza que deseja ativar este ${kind}? Isso retomará a entrega do tráfego imediatamente e pode impactar seu orçamento.`,
        confirmText: "Ativar",
        variant: "default" as const,
      };
    } else {
      return {
        title: "Confirmar pausa",
        message: `Tem certeza que deseja pausar este ${kind}? Isso pode impactar a entrega do seu tráfego imediatamente.`,
        confirmText: "Pausar",
        variant: "destructive" as const,
      };
    }
  }, [entityType, isPaused]);

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
        <button onClick={handleClick} disabled={isLoading} className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-text disabled:opacity-60" title={label}>
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

      <ConfirmDialog isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} title={dialogConfig.title} message={dialogConfig.message} confirmText={dialogConfig.confirmText} cancelText="Cancelar" variant={dialogConfig.variant} isLoading={isLoading} onConfirm={handleConfirm} />
    </>
  );
}

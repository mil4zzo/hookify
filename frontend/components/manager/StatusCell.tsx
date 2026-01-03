"use client";

import React, { useMemo } from "react";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useAdStatusControl, type AdEntityType } from "@/lib/hooks/useAdStatusControl";
import { RankingsItem } from "@/lib/api/schemas";

interface StatusCellProps {
  original: RankingsItem;
  currentTab: "individual" | "por-anuncio" | "por-conjunto" | "por-campanha";
  showConfirm?: boolean;
}

function isPausedStatus(status?: string | null): boolean {
  if (!status) return false;
  const s = String(status).toUpperCase();
  return s === "PAUSED" || s === "ADSET_PAUSED" || s === "CAMPAIGN_PAUSED";
}

export function StatusCell({ original, currentTab, showConfirm = true }: StatusCellProps) {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const effectiveStatus = (original as any)?.effective_status;
  const isPaused = isPausedStatus(effectiveStatus);

  // Determinar entityType e entityId baseado na aba atual
  const { entityType, entityId } = useMemo(() => {
    if (currentTab === "individual") {
      const adId = String((original as any)?.ad_id || "").trim();
      return { entityType: "ad" as AdEntityType, entityId: adId };
    }
    if (currentTab === "por-conjunto") {
      const adsetId = String((original as any)?.adset_id || "").trim();
      return { entityType: "adset" as AdEntityType, entityId: adsetId };
    }
    if (currentTab === "por-campanha") {
      const campaignId = String((original as any)?.campaign_id || "").trim();
      return { entityType: "campaign" as AdEntityType, entityId: campaignId };
    }
    // Para "por-anuncio" (groupByAdNameEffective), não há um ID único, retornar null
    return { entityType: "ad" as AdEntityType, entityId: "" };
  }, [currentTab, original]);

  const { isLoading, toggleStatus, pause, resume } = useAdStatusControl({
    entityType,
    entityId,
    currentStatus: effectiveStatus,
  });

  // Se não houver entityId válido (ex: grupo por nome), não mostrar o switch
  if (!entityId || !entityId.trim()) {
    return <div className="flex items-center justify-center w-full">—</div>;
  }

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

  const handleCheckedChange = async (checked: boolean) => {
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

  return (
    <>
      <div className="flex items-center justify-center w-full">
        <Switch checked={!isPaused} onCheckedChange={handleCheckedChange} disabled={isLoading} aria-label={label} />
      </div>

      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={dialogConfig.title}
        message={dialogConfig.message}
        confirmText={dialogConfig.confirmText}
        cancelText="Cancelar"
        variant={dialogConfig.variant}
        isLoading={isLoading}
        onConfirm={handleConfirm}
      />
    </>
  );
}


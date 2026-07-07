"use client";

import React, { useMemo } from "react";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";
import { useAdStatusControl, type AdEntityType } from "@/lib/hooks/useAdStatusControl";
import { RankingsItem } from "@/lib/api/schemas";

interface StatusCellProps {
  original: RankingsItem;
  currentTab: "individual" | "por-anuncio" | "por-conjunto" | "por-campanha";
}

function isPausedStatus(status?: string | null): boolean {
  if (!status) return false;
  const s = String(status).toUpperCase();
  return s === "PAUSED" || s === "ADSET_PAUSED" || s === "CAMPAIGN_PAUSED";
}

export function StatusCell({ original, currentTab }: StatusCellProps) {
  const effectiveStatus = (original as any)?.effective_status;
  const statusResolved = (original as any)?.status_resolved;

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
    // Para "por-anuncio" (groupByAdNameEffective), nÃ£o hÃ¡ um ID Ãºnico, retornar null
    return { entityType: "ad" as AdEntityType, entityId: "" };
  }, [currentTab, original]);

  const { isLoading, isPaused, toggleStatus } = useAdStatusControl({
    entityType,
    entityId,
    currentStatus: effectiveStatus,
  });

  // Hooks sempre ANTES dos early returns: status_resolved muda false→true na refetch e,
  // com hook depois do return condicional, o React lança "Rendered more hooks than during
  // the previous render" (crash intermitente da célula).
  const label = useMemo(() => {
    const kind = entityType === "ad" ? "anúncio" : entityType === "adset" ? "conjunto" : "campanha";
    return isPaused ? `Ativar ${kind}` : `Pausar ${kind}`;
  }, [entityType, isPaused]);

  if (statusResolved === false) {
    return (
      <div className="flex items-center justify-center w-full text-muted-foreground" onClick={(e) => e.stopPropagation()}>
        —
      </div>
    );
  }

  // Se não houver entityId válido (ex: grupo por nome), não mostrar o switch
  if (!entityId || !entityId.trim()) {
    return (
      <div className="flex items-center justify-center w-full" onClick={(e) => e.stopPropagation()}>
        —
      </div>
    );
  }

  const handleCheckedChange = async () => {
    if (isLoading) return;
    await toggleStatus();
  };

  return (
    <div className="flex items-center justify-center w-full" onClick={(e) => e.stopPropagation()}>
      <ToggleSwitch id={`status-${entityType}-${entityId}`} variant="minimal" checked={!isPaused} onCheckedChange={handleCheckedChange} disabled={isLoading} ariaLabel={label} />
    </div>
  );
}

"use client";

import React, { useMemo } from "react";
import { Switch } from "@/components/ui/switch";
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

  const { isLoading, isPaused, toggleStatus } = useAdStatusControl({
    entityType,
    entityId,
    currentStatus: effectiveStatus,
  });

  // Se não houver entityId válido (ex: grupo por nome), não mostrar o switch
  if (!entityId || !entityId.trim()) {
    return (
      <div className="flex items-center justify-center w-full" onClick={(e) => e.stopPropagation()}>
        —
      </div>
    );
  }

  const label = useMemo(() => {
    const kind = entityType === "ad" ? "anúncio" : entityType === "adset" ? "conjunto" : "campanha";
    return isPaused ? `Ativar ${kind}` : `Pausar ${kind}`;
  }, [entityType, isPaused]);

  const handleCheckedChange = async () => {
    if (isLoading) return;
    await toggleStatus();
  };

  return (
    <div className="flex items-center justify-center w-full" onClick={(e) => e.stopPropagation()}>
      <Switch checked={!isPaused} onCheckedChange={handleCheckedChange} disabled={isLoading} aria-label={label} />
    </div>
  );
}


import React from "react";
import { IconCircleCheck, IconPlayerPause, IconArchive, IconTrash, IconX, IconClock } from "@tabler/icons-react";

// Função helper para renderizar ícone de status do anúncio
export function AdStatusIcon({ status }: { status?: string | null }) {
  if (!status) return null;

  const statusUpper = status.toUpperCase();

  // Mapear status para ícone e cor
  const statusConfig: Record<string, { icon: React.ComponentType<{ className?: string; title?: string }>; color: string }> = {
    ACTIVE: { icon: IconCircleCheck, color: "text-success" },
    PAUSED: { icon: IconPlayerPause, color: "text-warning" },
    CAMPAIGN_PAUSED: { icon: IconPlayerPause, color: "text-warning" },
    ADSET_PAUSED: { icon: IconPlayerPause, color: "text-warning" },
    ARCHIVED: { icon: IconArchive, color: "text-muted-foreground" },
    DELETED: { icon: IconTrash, color: "text-destructive" },
    DISAPPROVED: { icon: IconX, color: "text-destructive" },
    PENDING_REVIEW: { icon: IconClock, color: "text-warning" },
    PREAPPROVED: { icon: IconClock, color: "text-primary" },
  };

  const config = statusConfig[statusUpper];
  if (!config) return null;

  const IconComponent = config.icon;

  return <IconComponent className={`w-4 h-4 ${config.color}`} title={status} />;
}

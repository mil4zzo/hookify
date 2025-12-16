import React from "react";
import { IconCircleCheck, IconPlayerPause, IconArchive, IconTrash, IconX, IconClock } from "@tabler/icons-react";

// Função helper para renderizar ícone de status do anúncio
export function AdStatusIcon({ status }: { status?: string | null }) {
  if (!status) return null;

  const statusUpper = status.toUpperCase();

  // Mapear status para ícone e cor
  const statusConfig: Record<string, { icon: React.ComponentType<{ className?: string; title?: string }>; color: string }> = {
    ACTIVE: { icon: IconCircleCheck, color: "text-green-600 dark:text-green-400" },
    PAUSED: { icon: IconPlayerPause, color: "text-yellow-600 dark:text-yellow-400" },
    CAMPAIGN_PAUSED: { icon: IconPlayerPause, color: "text-yellow-600 dark:text-yellow-400" },
    ADSET_PAUSED: { icon: IconPlayerPause, color: "text-yellow-600 dark:text-yellow-400" },
    ARCHIVED: { icon: IconArchive, color: "text-gray-500 dark:text-gray-400" },
    DELETED: { icon: IconTrash, color: "text-red-600 dark:text-red-400" },
    DISAPPROVED: { icon: IconX, color: "text-red-600 dark:text-red-400" },
    PENDING_REVIEW: { icon: IconClock, color: "text-orange-600 dark:text-orange-400" },
    PREAPPROVED: { icon: IconClock, color: "text-blue-600 dark:text-blue-400" },
  };

  const config = statusConfig[statusUpper];
  if (!config) return null;

  const IconComponent = config.icon;

  return <IconComponent className={`w-4 h-4 ${config.color}`} title={status} />;
}



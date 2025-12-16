"use client";

import { CardContent } from "@/components/ui/card";
import { StandardCard } from "@/components/common/StandardCard";
import { cn } from "@/lib/utils/cn";
import Image from "next/image";
import { IconPhoto } from "@tabler/icons-react";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";

interface KanbanCardProps {
  ad: {
    ad_id: string;
    ad_name: string;
    thumbnail?: string | null;
    metricValue: number;
    metricFormatted: string;
  };
  metricLabel: string;
  variant?: "success" | "danger";
  rank: number;
}

export function KanbanCard({ ad, metricLabel, variant = "success", rank }: KanbanCardProps) {
  const variantStyles = {
    success: {
      border: "border-green-500/30",
      bg: "bg-green-500/5",
      text: "text-green-600 dark:text-green-400",
      accent: "border-green-500",
    },
    danger: {
      border: "border-red-500/30",
      bg: "bg-red-500/5",
      text: "text-red-600 dark:text-red-400",
      accent: "border-red-500",
    },
  };

  const styles = variantStyles[variant];

  return (
    <StandardCard
      variant="default"
      padding="none"
      interactive={true}
      className={cn(styles.border, styles.bg)}
    >
      <CardContent className="p-1">
        <div className="flex items-start gap-3">
          {/* Thumbnail */}
          <div className="relative w-24 h-24 flex-shrink-0 rounded overflow-hidden bg-muted">
            {/* Rank badge - posicionado absolutamente no canto superior esquerdo */}
            <div className={cn("absolute top-0 left-0 z-10 w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs", variant === "success" ? "bg-green-500 text-white" : "bg-red-500 text-white")}>{rank}</div>
            {(() => {
              const thumbnail = getAdThumbnail(ad);
              return thumbnail ? (
                <Image src={thumbnail} alt={ad.ad_name || "Ad thumbnail"} fill className="object-cover" sizes="96px" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <IconPhoto className="w-8 h-8 text-muted-foreground opacity-50" />
                </div>
              );
            })()}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 space-y-2">
            {/* Ad name */}
            <div className="space-y-1">
              <p className="font-medium text-sm truncate" title={ad.ad_name}>
                {ad.ad_name || "Sem nome"}
              </p>
              <p className="text-xs text-muted-foreground font-mono truncate">{ad.ad_id}</p>
            </div>

            {/* Metric value */}
            <div className={cn("pt-2 border-t", styles.accent)}>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">{metricLabel}</span>
                <span className={cn("font-bold text-sm", styles.text)}>{ad.metricFormatted}</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </StandardCard>
  );
}

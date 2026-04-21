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
  variant?: "success" | "destructive";
  rank: number;
  secondaryText?: string;
  selected?: boolean;
  onClick?: () => void;
}

export function KanbanCard({ ad, metricLabel, variant = "success", rank, secondaryText, selected = false, onClick }: KanbanCardProps) {
  const variantStyles = {
    success: {
      border: "border-success-30",
      bg: "bg-success-10",
      text: "text-success",
      accent: "border-success",
    },
    destructive: {
      border: "border-destructive-40",
      bg: "bg-destructive-20",
      text: "text-destructive",
      accent: "border-destructive",
    },
  };

  const styles = variantStyles[variant];

  return (
    <StandardCard
      variant="default"
      padding="none"
      interactive={true}
      onClick={onClick}
      className={cn(styles.border, styles.bg, selected && "ring-2 ring-primary-20 border-primary bg-primary-5")}
    >
      <CardContent className="p-1">
        <div className="flex items-start gap-3">
          {/* Thumbnail */}
          <div className="relative w-24 h-24 flex-shrink-0 rounded overflow-hidden bg-muted">
            {/* Rank badge - posicionado absolutamente no canto superior esquerdo */}
            <div className={cn("absolute top-0 left-0 z-10 w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs", variant === "success" ? "bg-success text-success-foreground" : "bg-destructive text-destructive-foreground")}>{rank}</div>
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
              <p className="text-xs text-muted-foreground font-mono truncate">{secondaryText ?? ad.ad_id}</p>
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

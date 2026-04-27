"use client";

import { StandardCard } from "@/components/common/StandardCard";
import { KanbanCard } from "./KanbanCard";
import { cn } from "@/lib/utils/cn";

interface KanbanColumnProps {
  title: string;
  items: Array<{
    ad_id: string;
    ad_name: string;
    thumbnail?: string | null;
    metricValue: number;
    metricFormatted: string;
  }>;
  variant?: "success" | "destructive";
}

export function KanbanColumn({ title, items, variant = "success" }: KanbanColumnProps) {
  const variantStyles = {
    success: {
      headerBg: "bg-success-10 border-success-30",
      title: "text-success",
      accent: "border-success",
    },
    destructive: {
      headerBg: "bg-destructive-20 border-destructive-40",
      title: "text-destructive",
      accent: "border-destructive",
    },
  };

  const styles = variantStyles[variant];

  return (
    <StandardCard className="flex h-full flex-col space-y-4">
      <div className="h-auto flex-shrink-0 space-y-1">
        <p className="text-xs text-muted-foreground">Top {items.length}</p>
        <h2 className={cn("text-lg font-semibold", styles.title)}>{title}</h2>
      </div>
      <div className="space-y-3">{items.length === 0 ? <div className="rounded-md border border-border text-center py-8 text-muted-foreground text-sm">Nenhum item encontrado</div> : items.map((item, index) => <KanbanCard key={item.ad_id} ad={item} metricLabel={title} variant={variant} rank={index + 1} />)}</div>
    </StandardCard>
  );
}

"use client";

import React from "react";
import { IconInfoCircle } from "@tabler/icons-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/cn";

export interface GenericColumnColorScheme {
  headerBg?: string;
  title?: string;
  card: {
    border: string;
    bg: string;
    text: string;
    accent: string;
    badge: string;
  };
}

export interface GenericColumnProps {
  title: string;
  items: Array<{
    [key: string]: any;
  }>;
  colorScheme: GenericColumnColorScheme;
  averageValue?: number | null;
  renderCard: (item: any, index: number, colorScheme: GenericColumnColorScheme) => React.ReactNode;
  emptyMessage?: string;
  showAverage?: boolean;
  className?: string;
  headerRight?: React.ReactNode;
  headerContent?: React.ReactNode;
  formatAverage?: (value: number | null | undefined) => string;
  maxHeight?: string;
  tooltip?: {
    title: string;
    content?: React.ReactNode;
  };
}

export function GenericColumn({ title, items, colorScheme, averageValue, renderCard, emptyMessage = "Nenhum item encontrado", showAverage = true, className, headerRight, headerContent, formatAverage, maxHeight, tooltip }: GenericColumnProps) {
  const formatAverageValue =
    formatAverage ||
    ((value: number | null | undefined): string => {
      if (value == null || Number.isNaN(value) || !Number.isFinite(value) || value <= 0) {
        return "—";
      }

      return `${(value * 100).toFixed(2)}%`;
    });

  return (
    <div className={cn("flex h-full w-full flex-col gap-2 rounded-xl bg-card p-2", className)}>
      <div className="w-full flex-shrink-0 space-y-3 pr-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <h3 className={cn("text-base font-semibold text-white sm:text-md", colorScheme.title)}>🔹 {title}</h3>
            {tooltip ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="flex items-center justify-center rounded-md p-0.5 opacity-60 transition-colors hover:bg-muted-hover hover:opacity-100">
                      <IconInfoCircle className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8} className="max-w-sm">
                    {tooltip.content ? <div className="space-y-2">{tooltip.content}</div> : <p className="text-sm">{tooltip.title}</p>}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {showAverage ? <span className="text-[11px] text-muted-foreground">Média: {formatAverageValue(averageValue)}</span> : null}
            {headerRight}
          </div>
        </div>

        {headerContent}
      </div>

      <div className={cn("space-y-4", maxHeight && "min-h-0 flex-1 overflow-y-auto")} style={maxHeight ? { maxHeight } : undefined}>
        {items.length === 0 ? <div className="rounded-xl border border-dashed border-border-60 bg-background-40 px-4 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</div> : items.map((item, index) => renderCard(item, index, colorScheme))}
      </div>
    </div>
  );
}

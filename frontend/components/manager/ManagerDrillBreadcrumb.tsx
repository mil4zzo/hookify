"use client";

import React from "react";
import { IconChevronRight, IconFolder, IconBorderAll, IconPlayCardA } from "@tabler/icons-react";
import type { ResolvedDrillStep } from "@/lib/manager/useDrillState";

const KIND_LABEL: Record<ResolvedDrillStep["kind"], string> = {
  campaign: "Campanha",
  adset: "Conjunto",
  adname: "Anúncio",
};

const KIND_ICON: Record<ResolvedDrillStep["kind"], React.ElementType> = {
  campaign: IconFolder,
  adset: IconBorderAll,
  adname: IconPlayCardA,
};

function fallbackLabel(step: ResolvedDrillStep): string {
  return `${KIND_LABEL[step.kind]} #${step.id}`;
}

interface ManagerDrillBreadcrumbProps {
  stack: ResolvedDrillStep[];
  onNavigate: (index: number) => void;
}

export function ManagerDrillBreadcrumb({ stack, onNavigate }: ManagerDrillBreadcrumbProps) {
  if (stack.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm">
      {stack.map((step, index) => {
        const isLast = index === stack.length - 1;
        const label = step.name && step.name.trim() ? step.name : fallbackLabel(step);
        const Icon = KIND_ICON[step.kind];
        return (
          <React.Fragment key={`${step.kind}:${step.id}:${index}`}>
            {index > 0 && (
              <IconChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden />
            )}
            {isLast ? (
              <span className="flex flex-col items-start text-text" aria-current="page">
                <span className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
                  <Icon className="h-3 w-3" aria-hidden />
                  {KIND_LABEL[step.kind]}
                </span>
                <span className="font-medium truncate max-w-[280px]" title={label}>
                  {label}
                </span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(index)}
                className="flex flex-col items-start rounded text-muted-foreground transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center gap-1 text-xs uppercase tracking-wide">
                  <Icon className="h-3 w-3" aria-hidden />
                  {KIND_LABEL[step.kind]}
                </span>
                <span className="truncate max-w-[200px]" title={label}>
                  {label}
                </span>
              </button>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

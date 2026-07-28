"use client";

import React from "react";
import { IconChevronRight, IconFolder, IconBorderAll, IconPlayCardA } from "@tabler/icons-react";
import type { DrillKind } from "@/lib/manager/useDrillState";

export const KIND_LABEL: Record<DrillKind, string> = {
  campaign: "Campanha",
  adset: "Conjunto",
  adname: "Anúncio",
};

const KIND_ICON: Record<DrillKind, React.ElementType> = {
  campaign: IconFolder,
  adset: IconBorderAll,
  adname: IconPlayCardA,
};

export interface DrillCrumb {
  kind: DrillKind;
  label: string;
  /**
   * false quando o nível é ambíguo e não dá para navegar até ele — ex.: um ad_name
   * que vive em vários conjuntos não tem UM conjunto pai.
   */
  interactive?: boolean;
  /** Texto do title (tooltip). Ausente = usa o próprio label. */
  hint?: string;
}

interface ManagerDrillBreadcrumbProps {
  crumbs: DrillCrumb[];
  onNavigate: (index: number) => void;
}

export function ManagerDrillBreadcrumb({ crumbs, onNavigate }: ManagerDrillBreadcrumbProps) {
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm">
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;
        const canNavigate = !isLast && crumb.interactive !== false;
        const Icon = KIND_ICON[crumb.kind];
        const title = crumb.hint || crumb.label;
        const kindRow = (
          <span className="flex items-center gap-1 text-xs uppercase tracking-wide">
            <Icon className="h-3 w-3" aria-hidden />
            {KIND_LABEL[crumb.kind]}
          </span>
        );
        return (
          <React.Fragment key={`${crumb.kind}:${index}`}>
            {index > 0 && (
              <IconChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden />
            )}
            {isLast ? (
              <span className="flex flex-col items-start text-text" aria-current="page">
                <span className="text-muted-foreground">{kindRow}</span>
                <span className="font-medium truncate max-w-[280px]" title={title}>
                  {crumb.label}
                </span>
              </span>
            ) : canNavigate ? (
              <button
                type="button"
                onClick={() => onNavigate(index)}
                className="flex flex-col items-start rounded text-muted-foreground transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {kindRow}
                <span className="truncate max-w-[200px]" title={title}>
                  {crumb.label}
                </span>
              </button>
            ) : (
              <span className="flex cursor-default flex-col items-start text-muted-foreground" title={title}>
                {kindRow}
                <span className="truncate max-w-[200px] italic">{crumb.label}</span>
              </span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

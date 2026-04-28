"use client";

import type { ComponentType, ReactNode } from "react";
import { IconAlertTriangle, IconCircleCheck, IconFolderOpen, IconInfoCircle, IconLoader2 } from "@tabler/icons-react";
import { StandardCard } from "@/components/common/StandardCard";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";

export type StateTone = "loading" | "empty" | "error" | "success" | "warning" | "info";
export type StateDensity = "compact" | "default" | "spacious";
export type StateAlign = "left" | "center";

const toneIcon: Record<StateTone, ComponentType<{ className?: string }>> = {
  loading: IconLoader2,
  empty: IconFolderOpen,
  error: IconAlertTriangle,
  success: IconCircleCheck,
  warning: IconAlertTriangle,
  info: IconInfoCircle,
};

const toneClass: Record<StateTone, string> = {
  loading: "text-muted-foreground",
  empty: "text-muted-foreground",
  error: "text-destructive",
  success: "text-success",
  warning: "text-warning",
  info: "text-info",
};

const noticeClass: Record<Exclude<StateTone, "loading" | "empty" | "error"> | "destructive", string> = {
  info: "border-info-20 bg-info-10 text-info",
  warning: "border-warning-30 bg-warning-10 text-warning",
  success: "border-success-20 bg-success-10 text-success",
  destructive: "border-destructive-20 bg-destructive-10 text-destructive",
};

const densityClass: Record<StateDensity, string> = {
  compact: "p-widget-compact",
  default: "p-widget-default",
  spacious: "p-widget-spacious",
};

export interface StatePanelProps {
  kind: StateTone;
  title?: ReactNode;
  message?: ReactNode;
  action?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  fill?: boolean;
  framed?: boolean;
  density?: StateDensity;
  align?: StateAlign;
  className?: string;
}

export function StatePanel({
  kind,
  title,
  message,
  action,
  icon,
  fill = false,
  framed = true,
  density = "default",
  align = "center",
  className,
}: StatePanelProps) {
  const Icon = icon ?? toneIcon[kind];
  const content = (
    <div
      className={cn(
        "flex gap-3",
        align === "center" ? "items-center justify-center text-center" : "items-start text-left",
        fill && "min-h-[18rem] flex-1",
        densityClass[density],
        className,
      )}
    >
      <Icon className={cn("mt-0.5 h-5 w-5 flex-shrink-0", toneClass[kind], kind === "loading" && "animate-spin")} />
      <div className={cn("min-w-0 space-y-1", align === "center" && "max-w-xl")}>
        {title && <div className="font-medium text-foreground">{title}</div>}
        {message && <div className="text-sm text-muted-foreground">{message}</div>}
        {action && <div className="pt-2">{action}</div>}
      </div>
    </div>
  );

  if (!framed) return content;

  return (
    <StandardCard padding="none" className={cn("flex", fill && "min-h-[18rem] flex-1")}>
      {content}
    </StandardCard>
  );
}

export interface InlineNoticeProps {
  tone: "info" | "warning" | "destructive" | "success";
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function InlineNotice({ tone, title, children, action, className }: InlineNoticeProps) {
  const Icon = tone === "destructive" ? IconAlertTriangle : toneIcon[tone];
  return (
    <div className={cn("flex items-start gap-3 rounded-md border px-3 py-2 text-sm", noticeClass[tone], className)} role={tone === "destructive" || tone === "warning" ? "alert" : "status"}>
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && <div className="font-medium text-foreground">{title}</div>}
        {children && <div className="text-foreground/90">{children}</div>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

export interface StateSkeletonProps {
  variant: "page" | "widget" | "table" | "media";
  rows?: number;
  density?: StateDensity;
  className?: string;
}

export function StateSkeleton({ variant, rows = 4, density = "default", className }: StateSkeletonProps) {
  if (variant === "media") {
    return <Skeleton className={cn("aspect-[9/16] h-full min-h-64 rounded-lg", className)} />;
  }

  if (variant === "table") {
    return (
      <div className={cn("space-y-2", className)}>
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="grid grid-cols-[2fr_repeat(4,1fr)] gap-3 rounded-md border border-border p-3">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
          </div>
        ))}
      </div>
    );
  }

  const padding = densityClass[density];
  return (
    <div className={cn("space-y-4", padding, className)}>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-2/3" />
      <div className={cn("grid gap-3", variant === "page" ? "md:grid-cols-3" : "grid-cols-1")}>
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-24 rounded-md" />
        ))}
      </div>
    </div>
  );
}

export function LoadingState({ label = "Carregando..." }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-muted-foreground">
      <IconLoader2 className="h-5 w-5 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-destructive">
      <IconAlertTriangle className="h-5 w-5" />
      <span className="text-text">{message}</span>
      {action}
    </div>
  );
}

export function EmptyState({ message = "Sem dados para exibir" }: { message?: string }) {
  return (
    <div className="flex items-center gap-3 text-muted-foreground">
      <IconFolderOpen className="h-5 w-5" />
      <span>{message}</span>
    </div>
  );
}

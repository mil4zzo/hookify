"use client";

import type { ComponentType, ReactNode } from "react";
import { IconAlertTriangle, IconCircleCheck, IconFolderOpen, IconInfoCircle, IconLoader2 } from "@tabler/icons-react";
// design-system-exception: direct-skeleton-import - canonical state skeleton definitions
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";

export type StateTone = "loading" | "empty" | "error" | "success" | "warning" | "info";
export type StateDensity = "compact" | "default" | "spacious";

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

// Empilhado precisa de mais ar vertical que o padding de widget: o bloco é curto e
// centralizado, e com 16px ele gruda na moldura tracejada.
const stackDensityClass: Record<StateDensity, string> = {
  compact: "px-4 py-6 gap-1.5",
  default: "px-6 py-10 gap-2",
  spacious: "px-6 py-14 gap-2.5",
};

/**
 * Moldura do estado — escolha pelo LUGAR onde ele aparece:
 * - `dashed`: no lugar de uma lista, grade ou coluna, no corpo da página. Tracejado
 *   apagado (`.frame-placeholder`), fundo transparente. Nunca em erro.
 * - `none`: dentro de algo que já tem moldura (card, modal, tabela, painel), e todo erro.
 * Não existe card elevado: estado vazio não é algo em que se age.
 */
export type StateFrame = "dashed" | "none";

/** `stack`: ícone em cima, título, mensagem, ação. `inline`: uma linha, para linha de tabela ou lista densa. */
export type StateLayout = "stack" | "inline";

export interface StatePanelProps {
  kind: StateTone;
  title?: ReactNode;
  message?: ReactNode;
  action?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  /** false esconde o ícone (coluna estreita de kanban, por exemplo). */
  showIcon?: boolean;
  fill?: boolean;
  frame?: StateFrame;
  layout?: StateLayout;
  density?: StateDensity;
  className?: string;
}

export function StatePanel({
  kind,
  title,
  message,
  action,
  icon,
  showIcon = true,
  fill = false,
  frame = "none",
  layout = "stack",
  density = "default",
  className,
}: StatePanelProps) {
  const Icon = icon ?? toneIcon[kind];
  const iconMotion = kind === "loading" && "animate-spin";
  // Erro nunca é tracejado: não é um lugar esperando conteúdo, é um problema.
  const dashed = frame === "dashed" && kind !== "error";

  if (layout === "inline") {
    return (
      <div
        className={cn("flex items-center gap-2 text-xs text-muted-foreground", densityClass[density], dashed && "frame-placeholder rounded-md", className)}
        role={kind === "error" ? "alert" : undefined}
      >
        {showIcon && <Icon className={cn("h-4 w-4 flex-shrink-0", toneClass[kind], iconMotion)} />}
        <div className="min-w-0">
          {title && <span className="font-medium text-foreground">{title} </span>}
          {message}
        </div>
        {action && <div className="ml-auto flex-shrink-0">{action}</div>}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col items-center justify-center text-center",
        stackDensityClass[density],
        fill && "min-h-[18rem] flex-1",
        dashed && "frame-placeholder rounded-lg",
        className,
      )}
      role={kind === "error" ? "alert" : undefined}
    >
      {showIcon && (
        <div className={cn("state-icon-veil mb-1 grid flex-shrink-0 place-items-center rounded-full", density === "compact" ? "h-8 w-8" : "h-10 w-10")}>
          <Icon className={cn(density === "compact" ? "h-4 w-4" : "h-5 w-5", toneClass[kind], iconMotion)} />
        </div>
      )}
      {title && <div className="text-balance text-sm font-medium text-foreground">{title}</div>}
      {message && <div className={cn("max-w-md text-pretty text-muted-foreground", density === "compact" ? "text-xs" : "text-sm")}>{message}</div>}
      {action && <div className="flex flex-wrap justify-center gap-3 pt-2">{action}</div>}
    </div>
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
        {children && <div className="text-foreground">{children}</div>}
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
      <span className="text-foreground">{message}</span>
      {action}
    </div>
  );
}

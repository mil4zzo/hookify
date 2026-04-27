"use client";

import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { ErrorState, EmptyState, LoadingState } from "@/components/common/States";
import { StandardCard } from "@/components/common/StandardCard";
import { TabbedContent, type TabbedContentProps } from "@/components/common/TabbedContent";
import { KanbanScrollContainer } from "@/components/common/KanbanScrollContainer";
import { cn } from "@/lib/utils/cn";

type DivProps = HTMLAttributes<HTMLDivElement>;

export function PageBodyStack({ className, children, ...props }: DivProps) {
  return (
    <div className={cn("space-y-6", className)} {...props}>
      {children}
    </div>
  );
}

export function AnalyticsWorkspace({ className, children, ...props }: DivProps) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", className)} {...props}>
      {children}
    </div>
  );
}

export interface TabbedWorkspaceProps extends TabbedContentProps {
  className?: string;
  fullHeight?: boolean;
}

export function TabbedWorkspace({
  className,
  fullHeight = true,
  tabsContainerClassName,
  tabsListClassName,
  children,
  ...props
}: TabbedWorkspaceProps) {
  return (
    <div className={cn("w-full", fullHeight && "flex min-h-0 flex-1 flex-col", className)}>
      <TabbedContent
        {...props}
        tabsContainerClassName={cn("items-stretch gap-3 md:items-center", tabsContainerClassName)}
        tabsListClassName={cn("w-full overflow-x-auto md:w-fit", tabsListClassName)}
      >
        {children}
      </TabbedContent>
    </div>
  );
}

export type WorkspaceStateKind = "loading" | "empty" | "error";

export interface WorkspaceStateProps {
  kind: WorkspaceStateKind;
  label?: string;
  message?: string;
  action?: ReactNode;
  framed?: boolean;
  fill?: boolean;
  className?: string;
}

export function WorkspaceState({
  kind,
  label,
  message,
  action,
  framed = true,
  fill = false,
  className,
}: WorkspaceStateProps) {
  const content =
    kind === "loading" ? (
      <LoadingState label={label} />
    ) : kind === "error" ? (
      <ErrorState message={message || "Nao foi possivel carregar os dados."} action={action} />
    ) : (
      <EmptyState message={message} />
    );

  const contentWrapper = (
    <div className={cn("flex items-center justify-center py-12", fill && "min-h-[18rem] flex-1", className)}>
      {content}
    </div>
  );

  if (!framed) {
    return contentWrapper;
  }

  return (
    <StandardCard padding="lg" className={cn("flex justify-center", fill && "min-h-[18rem] flex-1")}>
      {contentWrapper}
    </StandardCard>
  );
}

export interface TableWorkspaceProps extends DivProps {
  toolbar?: ReactNode;
  toolbarClassName?: string;
  contentClassName?: string;
  compact?: boolean;
}

export function TableWorkspace({
  toolbar,
  toolbarClassName,
  contentClassName,
  compact = false,
  className,
  children,
  ...props
}: TableWorkspaceProps) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", compact ? "gap-0" : "gap-4", className)} {...props}>
      {toolbar && <div className={cn("flex flex-shrink-0 flex-col gap-4 md:flex-row md:items-center md:gap-6", toolbarClassName)}>{toolbar}</div>}
      <div className={cn("min-h-0 flex-1 overflow-hidden", contentClassName)}>{children}</div>
    </div>
  );
}

export interface KanbanWorkspaceProps extends ComponentProps<typeof KanbanScrollContainer> {
  vertical?: boolean;
  contentClassName?: string;
}

export function KanbanWorkspace({
  vertical = false,
  className,
  contentClassName,
  children,
  ...props
}: KanbanWorkspaceProps) {
  if (vertical) {
    return <div className={cn("w-full overflow-y-auto", className)}>{children}</div>;
  }

  return (
    <KanbanScrollContainer className={cn("min-h-0", className)} {...props}>
      <div className={cn("min-w-0", contentClassName)}>{children}</div>
    </KanbanScrollContainer>
  );
}

export function DashboardGrid({ className, children, ...props }: DivProps) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", className)} {...props}>
      {children}
    </div>
  );
}

export interface FormStepWorkspaceProps extends DivProps {
  header?: ReactNode;
  actions?: ReactNode;
}

export function FormStepWorkspace({ header, actions, className, children, ...props }: FormStepWorkspaceProps) {
  return (
    <div className={cn("space-y-6", className)} {...props}>
      {(header || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          {header && <div className="min-w-0">{header}</div>}
          {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

"use client";

import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { StatePanel, type StateDensity, type StateTone } from "@/components/common/States";
import { StandardCard } from "@/components/common/StandardCard";
import { TabbedContent, type TabbedContentProps } from "@/components/common/TabbedContent";
import { KanbanScrollContainer } from "@/components/common/KanbanScrollContainer";
import { cn } from "@/lib/utils/cn";

type DivProps = HTMLAttributes<HTMLDivElement>;
type DivPropsWithoutTitle = Omit<DivProps, "title">;
export type LayoutDensity = "compact" | "default" | "spacious";

const stackGapClass: Record<LayoutDensity, string> = {
  compact: "space-y-stack-compact",
  default: "space-y-stack",
  spacious: "space-y-stack-spacious",
};

const flexGapClass: Record<LayoutDensity, string> = {
  compact: "gap-stack-compact",
  default: "gap-stack",
  spacious: "gap-stack-spacious",
};

const gridGapClass: Record<LayoutDensity, string> = {
  compact: "gap-grid-compact",
  default: "gap-grid",
  spacious: "gap-grid-spacious",
};

export interface PageBodyStackProps extends DivProps {
  density?: LayoutDensity;
}

export function PageBodyStack({ className, children, density = "default", ...props }: PageBodyStackProps) {
  return (
    <div className={cn(stackGapClass[density], className)} {...props}>
      {children}
    </div>
  );
}

export interface AnalyticsWorkspaceProps extends DivProps {
  density?: LayoutDensity;
}

export function AnalyticsWorkspace({ className, children, density = "default", ...props }: AnalyticsWorkspaceProps) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", flexGapClass[density], className)} {...props}>
      {children}
    </div>
  );
}

export interface TabbedWorkspaceProps extends TabbedContentProps {
  className?: string;
  fullHeight?: boolean;
  density?: LayoutDensity;
}

export function TabbedWorkspace({
  className,
  fullHeight = true,
  density = "default",
  tabsContainerClassName,
  tabsListClassName,
  children,
  ...props
}: TabbedWorkspaceProps) {
  return (
    <div className={cn("w-full", fullHeight && "flex min-h-0 flex-1 flex-col", className)}>
      <TabbedContent
        {...props}
        tabsContainerClassName={cn("items-stretch md:items-center", flexGapClass[density], tabsContainerClassName)}
        tabsListClassName={cn("w-full overflow-x-auto md:w-fit", tabsListClassName)}
      >
        {children}
      </TabbedContent>
    </div>
  );
}

export type WorkspaceStateKind = "empty" | "error";

export interface WorkspaceStateProps {
  kind: WorkspaceStateKind;
  tone?: Exclude<StateTone, "loading">;
  title?: ReactNode;
  label?: string;
  message?: ReactNode;
  action?: ReactNode;
  framed?: boolean;
  fill?: boolean;
  density?: StateDensity;
  className?: string;
}

export function WorkspaceState({
  kind,
  tone,
  title,
  label,
  message,
  action,
  framed = true,
  fill = false,
  density = "default",
  className,
}: WorkspaceStateProps) {
  return (
    <StatePanel
      kind={tone ?? kind}
      title={title}
      message={message || (kind === "error" ? "Nao foi possivel carregar os dados." : label)}
      action={action}
      framed={framed}
      fill={fill}
      density={density}
      className={className}
    />
  );
}

export interface TableWorkspaceProps extends DivProps {
  toolbar?: ReactNode;
  toolbarClassName?: string;
  contentClassName?: string;
  compact?: boolean;
  density?: LayoutDensity;
}

export function TableWorkspace({
  toolbar,
  toolbarClassName,
  contentClassName,
  compact = false,
  density = "default",
  className,
  children,
  ...props
}: TableWorkspaceProps) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", compact ? "gap-0" : flexGapClass[density], className)} {...props}>
      {toolbar && <div className={cn("flex flex-shrink-0 flex-col md:flex-row md:items-center", flexGapClass[density], toolbarClassName)}>{toolbar}</div>}
      <div className={cn("min-h-0 flex-1 overflow-hidden", contentClassName)}>{children}</div>
    </div>
  );
}

export interface KanbanWorkspaceProps extends ComponentProps<typeof KanbanScrollContainer> {
  vertical?: boolean;
  contentClassName?: string;
  density?: LayoutDensity;
}

export function KanbanWorkspace({
  vertical = false,
  density = "default",
  className,
  contentClassName,
  children,
  ...props
}: KanbanWorkspaceProps) {
  if (vertical) {
    return <div className={cn("w-full overflow-y-auto", stackGapClass[density], className)}>{children}</div>;
  }

  return (
    <KanbanScrollContainer className={cn("min-h-0", className)} {...props}>
      <div className={cn("min-w-0", contentClassName)}>{children}</div>
    </KanbanScrollContainer>
  );
}

export interface DashboardGridProps extends DivProps {
  density?: LayoutDensity;
}

export function DashboardGrid({ className, children, density = "default", ...props }: DashboardGridProps) {
  return (
    <div className={cn("grid sm:grid-cols-2 xl:grid-cols-4", gridGapClass[density], className)} {...props}>
      {children}
    </div>
  );
}

export interface FormStepWorkspaceProps extends DivProps {
  header?: ReactNode;
  actions?: ReactNode;
  density?: LayoutDensity;
}

export function FormStepWorkspace({ header, actions, density = "default", className, children, ...props }: FormStepWorkspaceProps) {
  return (
    <div className={cn(stackGapClass[density], className)} {...props}>
      {(header || actions) && (
        <div className={cn("flex flex-wrap items-center justify-between", flexGapClass[density])}>
          {header && <div className="min-w-0">{header}</div>}
          {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export interface FormPageSectionProps extends DivPropsWithoutTitle {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  density?: LayoutDensity;
  framed?: boolean;
}

export function FormPageSection({
  title,
  description,
  actions,
  footer,
  density = "default",
  framed = true,
  className,
  children,
  ...props
}: FormPageSectionProps) {
  const content = (
    <section className={cn(stackGapClass[density], className)} {...props}>
      {(title || description || actions) && (
        <div className={cn("flex flex-wrap items-start justify-between", flexGapClass[density])}>
          <div className="min-w-0 space-y-1">
            {title && <h2 className="text-base font-semibold text-foreground">{title}</h2>}
            {description && <div className="text-sm text-muted-foreground">{description}</div>}
          </div>
          {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
      {footer && <div className="border-t border-border pt-widget-compact">{footer}</div>}
    </section>
  );

  if (!framed) return content;

  return (
    <StandardCard density={density}>
      {content}
    </StandardCard>
  );
}

export interface SettingsPanelLayoutProps extends DivProps {
  sidebar?: ReactNode;
  sidebarClassName?: string;
  contentClassName?: string;
  density?: LayoutDensity;
}

export function SettingsPanelLayout({
  sidebar,
  sidebarClassName,
  contentClassName,
  density = "default",
  className,
  children,
  ...props
}: SettingsPanelLayoutProps) {
  return (
    <div className={cn("grid min-h-0 grid-cols-1 md:grid-cols-[16rem_minmax(0,1fr)]", gridGapClass[density], className)} {...props}>
      {sidebar && <aside className={cn("min-w-0", sidebarClassName)}>{sidebar}</aside>}
      <div className={cn("min-w-0", contentClassName)}>{children}</div>
    </div>
  );
}

export interface WidgetPanelProps extends DivPropsWithoutTitle {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  density?: LayoutDensity;
  scrollable?: boolean;
}

export function WidgetPanel({
  title,
  description,
  actions,
  density = "default",
  scrollable = false,
  className,
  children,
  ...props
}: WidgetPanelProps) {
  return (
    <StandardCard density={density} className={cn("flex min-w-0 flex-col", scrollable && "min-h-0", className)} {...props}>
      {(title || description || actions) && (
        <div className={cn("flex flex-shrink-0 flex-wrap items-start justify-between", flexGapClass[density])}>
          <div className="min-w-0 space-y-1">
            {title && <h2 className="text-base font-semibold text-foreground">{title}</h2>}
            {description && <div className="text-sm text-muted-foreground">{description}</div>}
          </div>
          {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn(stackGapClass[density], scrollable && "min-h-0 flex-1 overflow-y-auto")}>{children}</div>
    </StandardCard>
  );
}

"use client";

import React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/common/Separator";
import { cn } from "@/lib/utils/cn";

export interface TabItem {
  value: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  tooltip?: string;
}

export interface TabbedContentProps {
  value: string;
  onValueChange: (value: string) => void;
  tabs: TabItem[];
  children: React.ReactNode;
  variant?: "simple" | "with-icons" | "with-controls";
  orientation?: "horizontal" | "vertical";
  controls?: React.ReactNode;
  tabsListClassName?: string;
  contentClassName?: string;
  tabsContainerClassName?: string;
  showTooltips?: boolean;
  separatorAfterTabs?: boolean;
}

export function TabbedContent({ value, onValueChange, tabs, children, variant = "simple", orientation = "horizontal", controls, tabsListClassName, contentClassName, tabsContainerClassName, showTooltips = false, separatorAfterTabs = false }: TabbedContentProps) {
  const renderTabTrigger = (tab: TabItem) => {
    // Mostrar ícone se fornecido, independente da variante
    const hasIcon = !!tab.icon;
    const IconComponent = tab.icon;
    const triggerContent = (
      <>
        {hasIcon && IconComponent && <IconComponent className={cn(orientation === "vertical" ? "h-5 w-5" : "w-4 h-4")} />}
        <span>{tab.label}</span>
      </>
    );

    const trigger = (
      <TabsTrigger value={tab.value} className={cn(orientation === "vertical" && "w-full justify-start gap-3")}>
        {hasIcon ? <div className="flex items-center gap-2">{triggerContent}</div> : triggerContent}
      </TabsTrigger>
    );

    if (showTooltips && tab.tooltip) {
      return (
        <Tooltip key={tab.value}>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent>
            <p>{tab.tooltip}</p>
          </TooltipContent>
        </Tooltip>
      );
    }

    return trigger;
  };

  const tabsContent = (
    <TabsList className={cn(orientation === "vertical" ? "flex-col w-full h-full bg-secondary rounded-none border-r border-border p-2 space-y-1" : variant === "with-controls" ? "flex-shrink-0" : "mb-6", tabsListClassName)}>
      {tabs.map((tab) => (
        <React.Fragment key={tab.value}>{renderTabTrigger(tab)}</React.Fragment>
      ))}
    </TabsList>
  );

  const tabsWrapper =
    orientation === "vertical" ? (
      <div className={cn("flex flex-row h-full", tabsContainerClassName)}>
        {tabsContent}
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    ) : (
      <div className={cn(variant === "with-controls" ? "flex items-center gap-4 flex-nowrap min-w-0" : "", tabsContainerClassName)}>
        {tabsContent}
        {variant === "with-controls" && controls && <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">{controls}</div>}
      </div>
    );

  const Wrapper = showTooltips ? TooltipProvider : React.Fragment;

  return (
    <Wrapper>
      <Tabs value={value} onValueChange={onValueChange} className={cn("w-full h-full flex-1 flex", orientation === "vertical" ? "flex-row" : "flex-col min-h-0")}>
        {tabsWrapper}
        {orientation === "horizontal" && separatorAfterTabs && <Separator vertical="md" />}
        {orientation === "horizontal" && children}
      </Tabs>
    </Wrapper>
  );
}

// Componente helper para renderizar TabsContent com className padrão
export interface TabbedContentItemProps {
  value: string;
  children: React.ReactNode;
  className?: string;
  variant?: "simple" | "with-icons" | "with-controls";
  orientation?: "horizontal" | "vertical";
}

export function TabbedContentItem({ value, children, className, variant = "simple", orientation = "horizontal" }: TabbedContentItemProps) {
  const defaultClassName = orientation === "vertical" ? "flex-1 overflow-y-auto p-4 md:p-6" : variant === "with-controls" ? "flex-1 flex flex-col min-h-0" : "space-y-6";

  return (
    <TabsContent value={value} className={cn(defaultClassName, className)}>
      {children}
    </TabsContent>
  );
}

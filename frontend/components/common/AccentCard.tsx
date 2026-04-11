"use client";

import type { HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export interface AccentCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  accentColor: string;
  title: ReactNode;
  titleTooltip?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  interactive?: boolean;
  contentClassName?: string;
}

export function AccentCard({
  accentColor,
  title,
  titleTooltip,
  subtitle,
  icon,
  trailing,
  selected = false,
  disabled = false,
  interactive,
  className,
  contentClassName,
  onClick,
  onKeyDown,
  ...props
}: AccentCardProps) {
  const isInteractive = interactive ?? Boolean(onClick);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);

    if (event.defaultPrevented || !isInteractive || disabled || !onClick) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick(event as unknown as MouseEvent<HTMLDivElement>);
    }
  };

  const handleTooltipTriggerClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  const handleTooltipTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  return (
    <div
      className={cn(
        "flex items-stretch overflow-hidden rounded-md border text-xs transition-colors",
        selected ? "border-border bg-primary-10" : "border-border bg-background",
        isInteractive && !disabled && "cursor-pointer hover:bg-muted",
        disabled && "cursor-not-allowed opacity-30",
        className
      )}
      onClick={disabled ? undefined : onClick}
      onKeyDown={handleKeyDown}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive && !disabled ? 0 : undefined}
      aria-disabled={disabled || undefined}
      {...props}
    >
      <div className="w-1 flex-shrink-0 self-stretch" style={{ backgroundColor: accentColor }} aria-hidden />
      <div className={cn("flex min-w-0 flex-1 items-center justify-between gap-2 px-2 py-1.5", contentClassName)}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {icon ? <div className="flex-shrink-0 text-muted-foreground">{icon}</div> : null}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="min-w-0 truncate text-foreground">{title}</div>
              {titleTooltip ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="flex-shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                        aria-label="Ver descrição da métrica"
                        onClick={handleTooltipTriggerClick}
                        onKeyDown={handleTooltipTriggerKeyDown}
                      >
                        <CircleHelp className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" align="center" className="max-w-72">
                      {titleTooltip}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null}
            </div>
            {subtitle ? <div className="truncate text-[11px] leading-tight text-muted-foreground">{subtitle}</div> : null}
          </div>
        </div>
        {trailing ? <div className="flex-shrink-0">{trailing}</div> : null}
      </div>
    </div>
  );
}

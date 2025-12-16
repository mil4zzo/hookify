"use client";

import { Button } from "@/components/ui/button";
import { IconChevronDown } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";
import { forwardRef } from "react";

interface FilterSelectButtonProps extends React.ComponentProps<typeof Button> {
  iconPosition?: "start" | "end";
  icon?: React.ReactNode;
}

export const FilterSelectButton = forwardRef<HTMLButtonElement, FilterSelectButtonProps>(
  ({ className, iconPosition = "end", icon, children, ...props }, ref) => {
    const defaultIcon = <IconChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />;
    // Se um ícone customizado foi fornecido, usar ele; senão usar o padrão apenas quando iconPosition é "end"
    const displayIcon = icon || (iconPosition === "end" ? defaultIcon : null);

    return (
      <Button
        ref={ref}
        variant="outline"
        role="combobox"
        className={cn(
          "h-10 w-full items-center rounded-md border border-border px-3 py-2 text-sm",
          "ring-offset-background transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "[&>span]:truncate",
          iconPosition === "start" ? "justify-start" : "justify-between",
          className
        )}
        {...props}
      >
        {iconPosition === "start" && displayIcon}
        <span className="truncate text-left">{children}</span>
        {iconPosition === "end" && displayIcon}
      </Button>
    );
  }
);

FilterSelectButton.displayName = "FilterSelectButton";


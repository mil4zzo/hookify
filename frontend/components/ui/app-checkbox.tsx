"use client";

import { IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";

interface AppCheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
}

/**
 * Standard checkbox component. Uses a hidden native input for accessibility
 * and a styled visual indicator. Wrap children after the indicator.
 *
 * Usage:
 *   <AppCheckbox checked={val} onCheckedChange={setVal}>Label text</AppCheckbox>
 *   <AppCheckbox checked={val} onCheckedChange={setVal} className="flex w-full gap-3">
 *     <img ... /> <span>Row content</span>
 *   </AppCheckbox>
 */
export function AppCheckbox({
  checked,
  onCheckedChange,
  disabled = false,
  className,
  children,
}: AppCheckboxProps) {
  return (
    <label
      className={cn(
        "inline-flex select-none items-center gap-2",
        disabled ? "cursor-default opacity-50" : "cursor-pointer",
        className,
      )}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.target.checked)}
      />
      <div
        aria-hidden="true"
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors",
          checked ? "border-primary bg-primary" : "border-border bg-background",
        )}
      >
        {checked && <IconCheck className="h-2.5 w-2.5 text-primary-foreground" />}
      </div>
      {children}
    </label>
  );
}

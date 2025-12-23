"use client";

import * as React from "react";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { DayButton, DayPicker, getDefaultClassNames } from "react-day-picker";

import { cn } from "@/lib/utils/cn";
import { Button, buttonVariants } from "@/components/ui/button";

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const defaultClassNames = getDefaultClassNames();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "bg-transparent group/calendar p-2 sm:p-3 md:p-4",
        // Tamanho de célula responsivo: 44px em mobile (mínimo para toque), 40px em tablet, 32px em desktop
        "[--cell-size:2.75rem] sm:[--cell-size:2.5rem] md:[--cell-size:2.5rem]",
        "[[data-slot=card-content]_&]:bg-transparent [[data-slot=popover-content]_&]:bg-transparent",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className
      )}
      captionLayout={captionLayout}
      formatters={{
        formatMonthDropdown: (date) => date.toLocaleString("default", { month: "short" }),
        ...formatters,
      }}
      classNames={{
        root: cn("w-fit min-w-0", defaultClassNames.root),
        months: cn("relative flex flex-col gap-3 sm:gap-4 md:gap-4 md:flex-row", defaultClassNames.months),
        month: cn("flex w-full flex-col gap-3 sm:gap-4", defaultClassNames.month),
        nav: cn("absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1 sm:gap-2", "px-1 sm:px-2", defaultClassNames.nav),
        button_previous: cn(buttonVariants({ variant: buttonVariant }), "h-[--cell-size] w-[--cell-size] min-h-[2.75rem] min-w-[2.75rem] sm:min-h-[2.5rem] sm:min-w-[2.5rem] md:min-h-0 md:min-w-0", "select-none p-0 rounded-md transition-colors", "hover:bg-accent hover:text-accent-foreground", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", "aria-disabled:opacity-40 aria-disabled:cursor-not-allowed", defaultClassNames.button_previous),
        button_next: cn(buttonVariants({ variant: buttonVariant }), "h-[--cell-size] w-[--cell-size] min-h-[2.75rem] min-w-[2.75rem] sm:min-h-[2.5rem] sm:min-w-[2.5rem] md:min-h-0 md:min-w-0", "select-none p-0 rounded-md transition-colors", "hover:bg-accent hover:text-accent-foreground", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", "aria-disabled:opacity-40 aria-disabled:cursor-not-allowed", defaultClassNames.button_next),
        month_caption: cn("flex h-[--cell-size] w-full items-center justify-center px-[--cell-size]", "min-h-[2.75rem] sm:min-h-[2.5rem] md:min-h-0", defaultClassNames.month_caption),
        dropdowns: cn("flex h-[--cell-size] w-full items-center justify-center gap-1.5 sm:gap-2", "min-h-[2.75rem] sm:min-h-[2.5rem] md:min-h-0", "text-sm sm:text-base font-medium", defaultClassNames.dropdowns),
        dropdown_root: cn("has-focus:border-ring border-input shadow-xs", "has-focus:ring-ring/50 has-focus:ring-[3px]", "relative rounded-md border transition-all", defaultClassNames.dropdown_root),
        dropdown: cn("bg-popover absolute inset-0 opacity-0", defaultClassNames.dropdown),
        caption_label: cn("select-none font-semibold text-foreground", captionLayout === "label" ? "text-sm sm:text-base md:text-lg" : "[&>svg]:text-muted-foreground flex h-8 sm:h-9 items-center gap-1.5 rounded-md pl-2 pr-1.5 text-sm sm:text-base [&>svg]:size-3.5 sm:[&>svg]:size-4", defaultClassNames.caption_label),
        table: "w-full border-collapse",
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn("text-muted-foreground flex-1 select-none", "text-xs sm:text-sm font-medium", "flex items-center justify-center", "h-[--cell-size] min-h-[2.75rem] sm:min-h-[2.5rem] md:min-h-0", defaultClassNames.weekday),
        week: cn("flex w-full", defaultClassNames.week),
        week_number_header: cn("w-[--cell-size] select-none", defaultClassNames.week_number_header),
        week_number: cn("text-muted-foreground select-none text-xs sm:text-sm", defaultClassNames.week_number),
        day: cn("group/day relative aspect-square h-full w-full select-none p-0 text-center", "[&:first-child[data-selected=true]_button]:rounded-l-md [&:last-child[data-selected=true]_button]:rounded-r-md", defaultClassNames.day),
        range_start: cn("!bg-primary-20 rounded-md", defaultClassNames.range_start),
        range_middle: cn("!bg-popover", "[&:first-child]:rounded-l-md [&:last-child]:rounded-r-md", defaultClassNames.range_middle),
        range_end: cn("!bg-primary-20 rounded-md", defaultClassNames.range_end),
        today: cn("underline underline-offset-4 decoration-2 decoration-dotted decoration-primary text-accent-foreground rounded-md font-semibold", "data-[selected=true]:rounded-md data-[selected=true]:bg-primary data-[selected=true]:text-primary-foreground", defaultClassNames.today),
        outside: cn("text-muted-foreground/60 aria-selected:text-muted-foreground/60", defaultClassNames.outside),
        disabled: cn("text-muted-foreground/40 opacity-50 cursor-not-allowed", defaultClassNames.disabled),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return <div data-slot="calendar" ref={rootRef} className={cn(className)} {...props} />;
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return <ChevronLeftIcon className={cn("size-4", className)} {...props} />;
          }

          if (orientation === "right") {
            return <ChevronRightIcon className={cn("size-4", className)} {...props} />;
          }

          return <ChevronDownIcon className={cn("size-4", className)} {...props} />;
        },
        DayButton: CalendarDayButton,
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div className="flex size-[--cell-size] items-center justify-center text-center">{children}</div>
            </td>
          );
        },
        ...components,
      }}
      {...props}
    />
  );
}

function CalendarDayButton({ className, day, modifiers, ...props }: React.ComponentProps<typeof DayButton>) {
  const defaultClassNames = getDefaultClassNames();

  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString()}
      data-selected-single={modifiers.selected && !modifiers.range_start && !modifiers.range_end && !modifiers.range_middle}
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        // Estados de seleção
        "data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground",
        "data-[selected-single=true]:font-semibold",
        // Estados de range - INÍCIO
        "data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground",
        "data-[range-start=true]:font-semibold",
        // Estados de range - MEIO (mais visível agora)
        "data-[range-middle=true]:bg-primary-20 data-[range-middle=true]:text-primary",
        "data-[range-middle=true]:font-medium",
        // Estados de range - FIM
        "data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground",
        "data-[range-end=true]:font-semibold",
        // Layout e tamanho responsivo
        "flex aspect-square h-auto w-full",
        "min-h-[2.75rem] min-w-[2.75rem] sm:min-h-[2.5rem] sm:min-w-[2.5rem] md:min-h-[--cell-size] md:min-w-[--cell-size]",
        "flex-col gap-0.5 sm:gap-1",
        // Tipografia responsiva
        "font-normal leading-none",
        "text-sm sm:text-base",
        "[&>span]:text-xs sm:[&>span]:text-sm [&>span]:opacity-70",
        // Bordas e transições
        "rounded-md transition-all duration-150",
        // Bordas específicas para range
        "data-[range-start=true]:rounded-l-md data-[range-end=true]:rounded-r-md",
        "data-[range-middle=true]:rounded-none",
        // Hover e interatividade
        "hover:bg-accent hover:text-accent-foreground",
        // Hover específico para range
        "data-[selected-single=true]:hover:bg-primary-90",
        "data-[range-start=true]:hover:bg-primary-90 data-[range-end=true]:hover:bg-primary-90",
        "data-[range-middle=true]:hover:bg-primary-30",
        // Focus states
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10",
        "group-data-[focused=true]/day:ring-[3px] group-data-[focused=true]/day:ring-ring/50",
        defaultClassNames.day,
        className
      )}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };

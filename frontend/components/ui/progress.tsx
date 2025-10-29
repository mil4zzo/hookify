"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

const Progress = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    value?: number;
    max?: number;
  }
>(({ className, value = 0, max = 100, ...props }, ref) => (
  <div ref={ref} className={cn("relative h-2 w-full overflow-hidden rounded-full bg-surface2", className)} {...props}>
    <div className="h-full w-full flex-1 bg-brand transition-all duration-300 ease-in-out" style={{ transform: `translateX(-${100 - (value / max) * 100}%)` }} />
  </div>
));
Progress.displayName = "Progress";

export { Progress };

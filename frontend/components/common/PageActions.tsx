"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

interface PageActionsProps {
  children: ReactNode;
  className?: string;
}

export function PageActions({ children, className }: PageActionsProps) {
  return <div className={cn("flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end", className)}>{children}</div>;
}

"use client";

import React from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRelativeTime } from "@/lib/utils/formatRelativeTime";
import { cn } from "@/lib/utils/cn";

interface UpdatedAtTextProps {
  dateTime: string;
  className?: string;
}

/**
 * Exibe texto de tempo relativo ("Atualizado há/as..."). Quando a atualização
 * foi há mais de 2 dias, mostra a data exata no hover usando o Tooltip do app.
 */
export function UpdatedAtText({ dateTime, className }: UpdatedAtTextProps) {
  const result = formatRelativeTime(dateTime);

  if (result.tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn("cursor-default", className)}>{result.text}</span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            <p>{result.tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return <span className={className}>{result.text}</span>;
}

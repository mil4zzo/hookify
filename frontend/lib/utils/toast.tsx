import { toast } from "sonner";
import { AppError } from "./errors";
import { parseError } from "./errors";
import { IconLoader2 } from "@tabler/icons-react";
import React from "react";
import { Progress } from "@/components/ui/progress";

export function showError(error: AppError | Error | unknown) {
  // Garantir que sempre temos um AppError com message string
  let appError: AppError;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    // Já é um AppError válido
    appError = error as AppError;
  } else {
    // Parse para AppError
    appError = parseError(error);
  }

  // Garantir que message seja string (nunca renderizar objeto)
  const message = typeof appError.message === "string" ? appError.message : JSON.stringify(appError.message);

  toast.error(message);
}

export function showSuccess(message: string) {
  toast.success(message);
}

export function showInfo(message: string) {
  toast(message);
}

export function showWarning(message: string) {
  toast.warning(message, {
    duration: 5000,
  });
}

/**
 * Mostra toast de progresso para atualização de pack
 */
export function showProgressToast(toastId: string, packName: string, currentDay: number, totalDays: number, message?: string) {
  const progress = totalDays > 0 ? Math.min(100, Math.max(0, (currentDay / totalDays) * 100)) : 0;
  
  toast.loading(
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center gap-3">
        <IconLoader2 className="h-5 w-5 animate-spin flex-shrink-0" />
        <span className="text-sm">
          Atualizando <strong>{packName}</strong> em {totalDays} dia{totalDays > 1 ? "s" : ""} (dia {currentDay}/{totalDays}){message ? ` - ${message}` : "..."}
        </span>
      </div>
      <Progress value={progress} max={100} className="w-full" />
    </div>,
    { id: toastId }
  );
}

/**
 * Atualiza toast de progresso existente
 */
export function updateProgressToast(toastId: string, packName: string, currentDay: number, totalDays: number, message?: string) {
  const progress = totalDays > 0 ? Math.min(100, Math.max(0, (currentDay / totalDays) * 100)) : 0;
  
  toast.loading(
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center gap-3">
        <IconLoader2 className="h-5 w-5 animate-spin flex-shrink-0" />
        <span className="text-sm">
          Atualizando <strong>{packName}</strong> em {totalDays} dia{totalDays > 1 ? "s" : ""} (dia {currentDay}/{totalDays}){message ? ` - ${message}` : "..."}
        </span>
      </div>
      <Progress value={progress} max={100} className="w-full" />
    </div>,
    { id: toastId }
  );
}

/**
 * Finaliza toast de progresso com sucesso ou erro
 */
export function finishProgressToast(toastId: string, success: boolean, message: string) {
  if (success) {
    toast.success(message, { id: toastId });
  } else {
    toast.error(message, { id: toastId });
  }
}

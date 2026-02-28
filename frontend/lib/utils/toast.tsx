import { toast } from "sonner";
import { AppError } from "./errors";
import { parseError } from "./errors";
import { IconLoader2, IconAlertCircle } from "@tabler/icons-react";
import React, { type ReactNode } from "react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

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
 * Traduz stages técnicos do backend para mensagens amigáveis
 */
export function getStageMessage(stage: string, details?: any): string {
  // Meta Ads stages
  if (stage === 'paginação' || stage === 'STAGE_PAGINATION') {
    return 'Coletando anúncios...';
  }
  if (stage === 'enriquecimento' || stage === 'STAGE_ENRICHMENT') {
    return 'Buscando detalhes...';
  }
  if (stage === 'formatação' || stage === 'STAGE_FORMATTING') {
    return 'Processando dados...';
  }
  if (stage === 'persistência' || stage === 'STAGE_PERSISTENCE') {
    const msg = details?.message || '';
    if (msg.includes('Salvando anúncios')) return 'Salvando anúncios...';
    if (msg.includes('Salvando métricas')) return 'Salvando métricas...';
    if (msg.includes('Calculando resumo')) return 'Calculando estatísticas...';
    if (msg.includes('Otimizando')) return 'Finalizando...';
    if (msg.includes('Finalizando')) return 'Concluindo...';
    return 'Salvando...';
  }

  // Google Sheets stages
  if (stage === 'lendo_planilha') return 'Lendo planilha...';
  if (stage === 'processando_dados') return 'Processando dados...';
  if (stage.includes('persistindo')) return 'Salvando dados...';

  // Fallback
  return details?.message || 'Processando...';
}

/**
 * Traduz status do job para mensagem de progresso
 */
export function getStatusMessage(status: string, stage?: string, details?: any): string {
  if (status === 'meta_running') return 'Preparando atualização...';
  if (status === 'processing') return stage ? getStageMessage(stage, details) : 'Processando...';
  if (status === 'persisting') return getStageMessage('persistência', details);
  if (status === 'completed') return 'Concluído!';
  if (status === 'failed') return 'Erro ao atualizar';
  if (status === 'cancelled') return 'Cancelado';
  return 'Processando...';
}

/**
 * Mostra toast de progresso para atualização de pack
 */
export function showProgressToast(toastId: string, packName: string, currentDay: number, totalDays: number, message?: string, onCancel?: () => void, icon?: ReactNode) {
  const progress = totalDays > 0 ? Math.min(100, Math.max(0, (currentDay / totalDays) * 100)) : 0;

  toast.loading(
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center gap-3">
        {icon || <IconLoader2 className="h-5 w-5 animate-spin flex-shrink-0" />}
        <span className="text-sm">
          Atualizando <strong>{packName}</strong> em {totalDays} dia{totalDays > 1 ? "s" : ""} (dia {currentDay}/{totalDays}){message ? ` - ${message}` : "..."}
        </span>
      </div>
      <Progress value={progress} max={100} className="w-full" />
      {onCancel && (
        <div className="flex gap-2 mt-1">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      )}
    </div>,
    { id: toastId, duration: Infinity }
  );
}

/**
 * Atualiza toast de progresso existente
 */
export function updateProgressToast(toastId: string, packName: string, currentDay: number, totalDays: number, message?: string, onCancel?: () => void, icon?: ReactNode) {
  const progress = totalDays > 0 ? Math.min(100, Math.max(0, (currentDay / totalDays) * 100)) : 0;

  toast.loading(
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center gap-3">
        {icon || <IconLoader2 className="h-5 w-5 animate-spin flex-shrink-0" />}
        <span className="text-sm">
          Atualizando <strong>{packName}</strong> em {totalDays} dia{totalDays > 1 ? "s" : ""} (dia {currentDay}/{totalDays}){message ? ` - ${message}` : "..."}
        </span>
      </div>
      <Progress value={progress} max={100} className="w-full" />
      {onCancel && (
        <div className="flex gap-2 mt-1">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      )}
    </div>,
    { id: toastId, duration: Infinity }
  );
}

/**
 * Mostra toast de "Cancelando..." - usado quando usuário clica no botão cancelar
 * Não tem botão de cancelar (evita cliques múltiplos)
 */
export function showCancellingToast(toastId: string, packName: string, icon?: ReactNode) {
  toast.loading(
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center gap-3">
        {icon || <IconLoader2 className="h-5 w-5 animate-spin flex-shrink-0" />}
        <span className="text-sm">
          Cancelando atualização de <strong>{packName}</strong>...
        </span>
      </div>
    </div>,
    { id: toastId, duration: Infinity }
  );
}

/**
 * Finaliza toast de progresso com sucesso ou erro
 * Erros são persistentes (não fecham automaticamente) até o usuário fechar
 */
export function finishProgressToast(toastId: string, success: boolean, message: string) {
  if (success) {
    toast.success(message, { id: toastId, duration: 5000 });
  } else {
    // Erro sempre persistente até usuário fechar
    toast.error(message, {
      id: toastId,
      duration: Infinity,
      dismissible: true,
    });
  }
}

/**
 * Mostra toast de job pausado aguardando reconexão do Google
 * Não pode ser fechado - usuário deve usar os botões
 */
export function showPausedJobToast(
  toastId: string,
  packName: string,
  onReconnect: () => void,
  onCancel: () => void
) {
  toast.warning(
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center gap-2">
        <IconAlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0" />
        <span className="font-medium">Sincronização pausada</span>
      </div>
      <span className="text-sm text-muted-foreground">
        Planilha &quot;{packName}&quot; aguardando reconexão do Google
      </span>
      <div className="flex gap-2 mt-1">
        <Button size="sm" variant="default" onClick={onReconnect}>
          Reconectar Google
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>,
    {
      id: toastId,
      duration: Infinity,
      dismissible: false, // Força usuário a usar os botões
    }
  );
}

/**
 * Fecha um toast específico pelo ID
 */
export function dismissToast(toastId: string) {
  toast.dismiss(toastId);
}

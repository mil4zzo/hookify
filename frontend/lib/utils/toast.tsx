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

// Meta Ads: mapeamento status/stage -> índice 1-5 para "Etapa X de 5"
const META_TOTAL_STAGES = 5;
const META_STAGE_TITLES: Record<string, string> = {
  "1": "Preparando atualização",
  "2": "Coletando anúncios",
  "3": "Buscando detalhes",
  "4": "Processando dados",
  "5": "Salvando",
};

/** Retorna índice da etapa (1-5) e título a partir de status e details. */
export function getMetaStageInfo(status: string, details?: any): { stepIndex: number; title: string } {
  const stage = details?.stage || "";
  if (status === "meta_running" || status === "meta_completed") {
    return { stepIndex: 1, title: META_STAGE_TITLES["1"] };
  }
  if (status === "processing") {
    if (stage === "paginação" || stage === "STAGE_PAGINATION")
      return { stepIndex: 2, title: META_STAGE_TITLES["2"] };
    if (stage === "enriquecimento" || stage === "STAGE_ENRICHMENT")
      return { stepIndex: 3, title: META_STAGE_TITLES["3"] };
    if (stage === "formatação" || stage === "STAGE_FORMATTING")
      return { stepIndex: 4, title: META_STAGE_TITLES["4"] };
  }
  if (status === "persisting" || (status === "processing" && (stage === "persistência" || stage === "STAGE_PERSISTENCE"))) {
    return { stepIndex: 5, title: META_STAGE_TITLES["5"] };
  }
  return { stepIndex: 1, title: META_STAGE_TITLES["1"] };
}

/**
 * Retorna a linha dinâmica: dados complementares quando o backend enviar,
 * senão fallback por etapa para que a linha nunca sumir (evita flick vertical).
 */
export function getMetaDynamicLine(status: string, stage: string, details?: any): string {
  // Paginação: "Página X (Y registros)"
  if (stage === "paginação" || stage === "STAGE_PAGINATION") {
    const pageCount = details?.page_count;
    const totalCollected = details?.total_collected;
    if (pageCount != null && totalCollected != null) {
      return `Página ${pageCount} (${totalCollected} registros)`;
    }
    if (pageCount != null) return `Página ${pageCount}`;
    return "Trabalhando nisso...";
  }

  // Enriquecimento: "X de Y anúncios"
  if (stage === "enriquecimento" || stage === "STAGE_ENRICHMENT") {
    const adsEnriched = details?.ads_enriched;
    const total = details?.ads_after_dedup ?? details?.enrichment_total;
    if (adsEnriched != null && total != null && total > 0) {
      return `${adsEnriched} de ${total} anúncios`;
    }
    if (details?.enrichment_batches != null && details?.enrichment_total != null) {
      return `Bloco ${details.enrichment_batches} de ${details.enrichment_total}`;
    }
    return "Buscando detalhes...";
  }

  // Formatação
  if (stage === "formatação" || stage === "STAGE_FORMATTING") {
    return "Otimizando...";
  }

  // Persistência (message vem de progress.message no backend, passada via details em buildMetaToastContent)
  if (stage === "persistência" || stage === "STAGE_PERSISTENCE") {
    const msg = details?.message || "";
    if (msg) return msg;
    return "Salvando...";
  }

  // meta_running ou fallback
  if (status === "meta_running") return "Solicitando dados ao Meta...";
  return "Aguarde...";
}

/**
 * Traduz stages técnicos do backend para mensagens amigáveis (legado)
 */
export function getStageMessage(stage: string, details?: any): string {
  if (stage === "paginação" || stage === "STAGE_PAGINATION") return "Coletando anúncios";
  if (stage === "enriquecimento" || stage === "STAGE_ENRICHMENT") return "Buscando detalhes";
  if (stage === "formatação" || stage === "STAGE_FORMATTING") return "Processando dados";
  if (stage === "persistência" || stage === "STAGE_PERSISTENCE") {
    const msg = details?.message || "";
    if (msg.includes("Salvando anúncios")) return "Salvando anúncios";
    if (msg.includes("Salvando métricas")) return "Salvando métricas";
    if (msg.includes("Calculando")) return "Calculando estatísticas";
    if (msg.includes("Otimizando")) return "Finalizando";
    if (msg.includes("Finalizando")) return "Concluindo";
    return "Salvando";
  }
  if (stage === "lendo_planilha") return "Lendo planilha";
  if (stage === "processando_dados") return "Processando dados";
  if (stage.includes("persistindo")) return "Salvando dados";
  return details?.message || "Processando";
}

/**
 * Traduz status do job para mensagem de progresso (legado)
 */
export function getStatusMessage(status: string, stage?: string, details?: any): string {
  if (status === "meta_running") return "Preparando atualização";
  if (status === "processing") return stage ? getStageMessage(stage, details) : "Processando";
  if (status === "persisting") return getStageMessage("persistência", details);
  if (status === "completed") return "Concluído";
  if (status === "failed") return "Erro ao atualizar";
  if (status === "cancelled") return "Cancelado";
  return "Processando";
}

/** Conteúdo do toast de progresso em etapas (Meta, Sheets, Transcrição). */
export interface ProgressToastContent {
  stageLabel: string;
  stageTitle: string;
  dynamicLine: string;
}

/** @deprecated Use ProgressToastContent */
export type MetaProgressToastContent = ProgressToastContent;

// ----- Google Sheets Sync -----
const SHEETS_TOTAL_STAGES = 3;
const SHEETS_STAGE_TITLES: Record<string, string> = {
  "1": "Lendo planilha",
  "2": "Processando dados",
  "3": "Salvando dados",
};

export function getSheetsStageInfo(status: string, details?: any): { stepIndex: number; title: string } {
  const stage = details?.stage || "";
  if (status === "completed" || status === "cancelled" || status === "failed") {
    return { stepIndex: SHEETS_TOTAL_STAGES, title: SHEETS_STAGE_TITLES["3"] };
  }
  if (status === "persisting") return { stepIndex: 3, title: SHEETS_STAGE_TITLES["3"] };
  if (status === "processing") {
    if (stage === "lendo_planilha") return { stepIndex: 1, title: SHEETS_STAGE_TITLES["1"] };
    if (stage === "processando_dados") return { stepIndex: 2, title: SHEETS_STAGE_TITLES["2"] };
    if (stage === "persistindo") return { stepIndex: 3, title: SHEETS_STAGE_TITLES["3"] };
    return { stepIndex: 1, title: SHEETS_STAGE_TITLES["1"] };
  }
  return { stepIndex: 1, title: SHEETS_STAGE_TITLES["1"] };
}

export function getSheetsDynamicLine(status: string, stage: string, details?: any): string {
  if (status === "completed") {
    const rows = details?.rows_updated ?? details?.updated_rows;
    if (rows != null && rows > 0) return `${rows} registros atualizados`;
    return "Importação concluída";
  }
  if (stage === "lendo_planilha") {
    const rows = details?.rows_read;
    if (rows != null && rows > 0) return `${rows} linhas lidas`;
    return "Conectando à planilha...";
  }
  if (stage === "processando_dados") {
    const rows = details?.rows_processed;
    if (rows != null && rows > 0) return `${rows} linhas processadas`;
    return "Validando dados...";
  }
  if (stage === "persistindo" || status === "persisting") {
    return "Salvando no banco de dados...";
  }
  return "Preparando importação...";
}

/**
 * Conteúdo para toast de progresso do Google Sheets (layout 3 linhas).
 * overrideDynamicLine opcional para mensagem custom (ex.: erro de rede).
 */
export function buildSheetsToastContent(
  status: string,
  details?: any,
  overrideDynamicLine?: string
): ProgressToastContent {
  const { stepIndex, title } = getSheetsStageInfo(status, details);
  const stage = details?.stage ?? "";
  const dynamicLine =
    overrideDynamicLine ?? getSheetsDynamicLine(status, stage, details);
  return {
    stageLabel: `Etapa ${stepIndex} de ${SHEETS_TOTAL_STAGES}`,
    stageTitle: title,
    dynamicLine,
  };
}

/** Percentual 0–100 para barra do Sheets (3 etapas). */
export function calculateSheetsProgressPercent(status: string, details?: any): number {
  if (status === "completed") return 100;
  if (status === "cancelled" || status === "failed") return 0;
  const { stepIndex } = getSheetsStageInfo(status, details);
  const pctPerStep = 100 / SHEETS_TOTAL_STAGES;
  return Math.min(100, Math.round(stepIndex * pctPerStep));
}

// ----- Transcrição -----
const TRANSCRIPTION_TOTAL_STAGES = 2;
const TRANSCRIPTION_STAGE_TITLES: Record<string, string> = {
  "1": "Preparando",
  "2": "Transcrevendo anúncios",
};

export function getTranscriptionStageInfo(status: string, details?: any): { stepIndex: number; title: string } {
  const total = Math.max(0, Number(details?.total ?? 0));
  const done = Math.max(0, Number(details?.done ?? 0));
  if (status === "completed" || status === "cancelled" || status === "failed") {
    return { stepIndex: TRANSCRIPTION_TOTAL_STAGES, title: "Concluído" };
  }
  if (status === "processing") {
    if (total > 0 || done > 0) return { stepIndex: 2, title: TRANSCRIPTION_STAGE_TITLES["2"] };
    return { stepIndex: 1, title: TRANSCRIPTION_STAGE_TITLES["1"] };
  }
  return { stepIndex: 1, title: TRANSCRIPTION_STAGE_TITLES["1"] };
}

function formatTranscriptionCount(count: number): string {
  if (count === 0) return "0 anúncios transcritos";
  if (count === 1) return "1 anúncio transcrito";
  return `${count} anúncios transcritos`;
}

export function getTranscriptionDynamicLine(status: string, details?: any): string {
  const total = Math.max(0, Number(details?.total ?? 0));
  const done = Math.max(0, Number(details?.done ?? 0));
  if (status === "completed") {
    const success = Number(details?.success_count ?? done);
    return formatTranscriptionCount(success);
  }
  if (status === "processing" && total > 0) {
    const current = Math.min(done, total);
    const label = total === 1 ? "anúncio" : "anúncios";
    return `${current} de ${total} ${label}`;
  }
  return "Iniciando transcrição...";
}

/**
 * Conteúdo para toast de progresso da transcrição (layout 3 linhas).
 * overrideDynamicLine opcional para mensagem custom (ex.: erro de rede).
 */
export function buildTranscriptionToastContent(
  status: string,
  details?: any,
  overrideDynamicLine?: string
): ProgressToastContent {
  const { stepIndex, title } = getTranscriptionStageInfo(status, details);
  const dynamicLine = overrideDynamicLine ?? getTranscriptionDynamicLine(status, details);
  return {
    stageLabel: `Etapa ${stepIndex} de ${TRANSCRIPTION_TOTAL_STAGES}`,
    stageTitle: title,
    dynamicLine,
  };
}

/**
 * Percentual 0–100 para a barra da transcrição.
 * Etapa 1 (Preparando): 0%.
 * Etapa 2 (Transcrevendo anúncios): barra sobe aos poucos conforme (anúncios já transcritos / total de anúncios) * 100.
 * Concluído: 100%.
 */
export function calculateTranscriptionProgressPercent(status: string, details?: any): number {
  if (status === "completed") return 100;
  if (status === "cancelled" || status === "failed") return 0;
  const { stepIndex } = getTranscriptionStageInfo(status, details);
  const total = Math.max(0, Number(details?.total ?? 0));
  const done = Math.max(0, Number(details?.done ?? 0));
  if (stepIndex === 1) return 0;
  // Etapa 2: percentual de anúncios já transcritos em relação ao total
  if (total > 0) return Math.min(100, Math.round((done / total) * 100));
  return 0;
}

function renderProgressToastContent(
  packName: string,
  progress: number,
  stagedContent: ProgressToastContent | undefined,
  message: string | undefined,
  onCancel: (() => void) | undefined,
  icon: ReactNode | undefined,
  currentStep: number,
  totalSteps: number
) {
  const hasStagedLayout =
    stagedContent && stagedContent.stageLabel && stagedContent.stageTitle && stagedContent.dynamicLine;

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center gap-3">
        {icon || <IconLoader2 className="h-5 w-5 animate-spin flex-shrink-0" />}
        {hasStagedLayout ? (
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <span className="text-xs text-muted-foreground">
              Atualizando {packName} — {stagedContent.stageLabel}
            </span>
            <span className="text-sm font-semibold text-foreground">{stagedContent.stageTitle}</span>
            <div className="flex items-center gap-2">
              <IconLoader2 className="h-4 w-4 animate-spin flex-shrink-0 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{stagedContent.dynamicLine}</span>
            </div>
          </div>
        ) : (
          <span className="text-sm">
            {packName} — etapa {currentStep}/{totalSteps}
            {message ? ` — ${message}` : "..."}
          </span>
        )}
      </div>
      <Progress value={progress} max={100} className="w-full" />
      {onCancel && (
        <div className="flex gap-2 mt-1">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Calcula valor da barra: se progressPercent for fornecido, usa direto;
 * senão usa (currentStep/totalSteps)*100 como fallback.
 */
function resolveProgressValue(
  progressPercent: number | undefined,
  currentStep: number,
  totalSteps: number
): number {
  if (progressPercent !== undefined && typeof progressPercent === "number") {
    return Math.min(100, Math.max(0, progressPercent));
  }
  return totalSteps > 0 ? Math.min(100, Math.max(0, (currentStep / totalSteps) * 100)) : 0;
}

/**
 * Mostra toast de progresso para atualização de pack.
 * stagedContent: layout em 3 linhas (Etapa X de Y; título; linha dinâmica). Sem ele, usa fallback "etapa X/Y".
 * progressPercent: 0–100 para a barra; se omitido, usa currentStep/totalSteps.
 */
export function showProgressToast(
  toastId: string,
  packName: string,
  currentStep: number,
  totalSteps: number,
  message?: string,
  onCancel?: () => void,
  icon?: ReactNode,
  stagedContent?: ProgressToastContent,
  progressPercent?: number
) {
  const progress = resolveProgressValue(progressPercent, currentStep, totalSteps);
  toast.loading(
    renderProgressToastContent(packName, progress, stagedContent, message, onCancel, icon, currentStep, totalSteps),
    { id: toastId, duration: Infinity }
  );
}

/**
 * Atualiza toast de progresso existente.
 * stagedContent e progressPercent: mesmo que showProgressToast.
 */
export function updateProgressToast(
  toastId: string,
  packName: string,
  currentStep: number,
  totalSteps: number,
  message?: string,
  onCancel?: () => void,
  icon?: ReactNode,
  stagedContent?: ProgressToastContent,
  progressPercent?: number
) {
  const progress = resolveProgressValue(progressPercent, currentStep, totalSteps);
  toast.loading(
    renderProgressToastContent(packName, progress, stagedContent, message, onCancel, icon, currentStep, totalSteps),
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

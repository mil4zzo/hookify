import { create } from "zustand";
import type { BatchBudgetItem, RankingsItem } from "@/lib/api/schemas";
import type { BudgetKind, BulkBudgetEntityType } from "@/lib/manager/budget";

export type BulkBudgetRequestBody = {
  mode: "percent" | "delta" | "fixed";
  percent?: number;
  amount?: number;
  budget_type?: BudgetKind;
};

/** O que o resultado precisa para se desenhar sem a tabela por perto (a pessoa pode ter saído do Manager). */
export type BulkBudgetRowInfo = { name: string; currency: string | null };

export type BulkBudgetJob = {
  id: number;
  entityType: BulkBudgetEntityType;
  packIds?: string[];
  request: BulkBudgetRequestBody;
  rowInfo: Record<string, BulkBudgetRowInfo>;
  /** Ids enviados ao backend. */
  sentIds: string[];
  /**
   * Resultado por id. Inclui, desde a partida, os que a tela já sabia que seriam pulados
   * (orçamento no outro nível, sem sincronização, resultado ≤ 0): o resultado final mostra
   * a seleção inteira, não só o que foi enviado.
   */
  items: Record<string, BatchBudgetItem>;
  status: "running" | "done" | "error";
  /** Falha do lote inteiro (rede, token). `maybeApplied`: sem resposta — o backend pode ter aplicado. */
  error?: { message: string; maybeApplied: boolean };
  /** Ids sendo repetidos agora (retry por item ou "todas"). */
  retrying: string[];
  /** A pessoa já viu o resultado final (fechou o diálogo com ele na tela). */
  seen: boolean;
};

type Draft = {
  entityType: BulkBudgetEntityType;
  rows: RankingsItem[];
  packIds?: string[];
  /** Quem abriu o formulário reage ao lote começar (o Manager limpa a seleção: ela já virou lote). */
  onStarted?: () => void;
  openedAt: number;
};

/** Lote ainda trabalhando (primeira execução ou um "tentar de novo"): o diálogo só minimiza. */
export function isBulkBudgetJobBusy(job: BulkBudgetJob | null): boolean {
  return !!job && (job.status === "running" || job.retrying.length > 0);
}

interface BulkBudgetJobStore {
  /** Um lote por vez: o último (em andamento ou com resultado ainda não visto). */
  job: BulkBudgetJob | null;
  /** Seleção que abriu o formulário. */
  draft: Draft | null;
  /** Diálogo na tela. Fechado com lote ocupado ou resultado não visto = minimizado no canto. */
  dialogOpen: boolean;
  openForm: (draft: Omit<Draft, "openedAt">) => void;
  openDialog: () => void;
  closeDialog: () => void;
  minimize: () => void;
  setJob: (job: BulkBudgetJob | null) => void;
  patchJob: (id: number, patch: Partial<BulkBudgetJob>) => void;
  /** Concluir: marca como visto e libera o formulário para a próxima seleção. */
  acknowledge: () => void;
  reset: () => void;
}

export const useBulkBudgetJobStore = create<BulkBudgetJobStore>((set, get) => ({
  job: null,
  draft: null,
  dialogOpen: false,
  openForm: (draft) => set({ draft: { ...draft, openedAt: Date.now() }, dialogOpen: true }),
  openDialog: () => set({ dialogOpen: true }),
  minimize: () => set({ dialogOpen: false }),
  closeDialog: () => {
    const { job } = get();
    // Fechar com o resultado na tela = visto. Durante a execução não fecha, minimiza: o card do
    // canto (BulkBudgetMiniCard) segue mostrando o andamento e reabre o diálogo.
    set({ dialogOpen: false, job: job && !isBulkBudgetJobBusy(job) ? { ...job, seen: true } : job });
  },
  setJob: (job) => set({ job }),
  patchJob: (id, patch) => {
    const { job } = get();
    if (!job || job.id !== id) return; // lote antigo terminando depois de um novo começar
    set({ job: { ...job, ...patch } });
  },
  acknowledge: () => {
    const { job } = get();
    if (job && !isBulkBudgetJobBusy(job)) set({ job: { ...job, seen: true } });
  },
  reset: () => set({ job: null, draft: null, dialogOpen: false }),
}));

// Fechar/recarregar a aba no meio de um lote (ou de um "tentar de novo"): o backend termina a alteração de qualquer
// jeito, mas a tela de resultado (o que mudou, o que falhou e por quê) se perde. O navegador
// pede confirmação; navegar DENTRO do app não passa por aqui e não perde nada.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if (isBulkBudgetJobBusy(useBulkBudgetJobStore.getState().job)) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

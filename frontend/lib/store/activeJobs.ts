import { create } from 'zustand';

interface ActiveJobsStore {
  activeJobIds: Set<string>;
  addActiveJob: (jobId: string) => boolean; // retorna false se já existe
  removeActiveJob: (jobId: string) => void;
  isJobActive: (jobId: string) => boolean;
  clearAll: () => void; // Limpa todos os jobs ativos
}

export const useActiveJobsStore = create<ActiveJobsStore>((set, get) => ({
  activeJobIds: new Set(),
  addActiveJob: (jobId: string) => {
    const { activeJobIds } = get();
    if (activeJobIds.has(jobId)) {
      console.warn(`[ACTIVE_JOBS] ❌ Job ${jobId} já está ativo. Jobs ativos:`, Array.from(activeJobIds));
      return false; // Já existe polling ativo
    }
    console.log(`[ACTIVE_JOBS] ✅ Adicionando job ${jobId} aos jobs ativos`);
    set({ activeJobIds: new Set([...activeJobIds, jobId]) });
    console.log(`[ACTIVE_JOBS] Jobs ativos após adição:`, Array.from(get().activeJobIds));
    return true;
  },
  removeActiveJob: (jobId: string) => {
    const { activeJobIds } = get();
    const newSet = new Set(activeJobIds);
    const existed = newSet.delete(jobId);
    if (existed) {
      console.log(`[ACTIVE_JOBS] ✅ Removendo job ${jobId} dos jobs ativos`);
    } else {
      console.warn(`[ACTIVE_JOBS] ⚠️ Tentou remover job ${jobId} que não estava ativo`);
    }
    set({ activeJobIds: newSet });
    console.log(`[ACTIVE_JOBS] Jobs ativos após remoção:`, Array.from(get().activeJobIds));
  },
  isJobActive: (jobId: string) => {
    return get().activeJobIds.has(jobId);
  },
  clearAll: () => {
    set({ activeJobIds: new Set() });
  },
}));















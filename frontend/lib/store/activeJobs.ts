import { create } from 'zustand';

interface ActiveJobsStore {
  activeJobIds: Set<string>;
  addActiveJob: (jobId: string) => boolean; // retorna false se já existe
  removeActiveJob: (jobId: string) => void;
  isJobActive: (jobId: string) => boolean;
}

export const useActiveJobsStore = create<ActiveJobsStore>((set, get) => ({
  activeJobIds: new Set(),
  addActiveJob: (jobId: string) => {
    const { activeJobIds } = get();
    if (activeJobIds.has(jobId)) {
      return false; // Já existe polling ativo
    }
    set({ activeJobIds: new Set([...activeJobIds, jobId]) });
    return true;
  },
  removeActiveJob: (jobId: string) => {
    const { activeJobIds } = get();
    const newSet = new Set(activeJobIds);
    newSet.delete(jobId);
    set({ activeJobIds: newSet });
  },
  isJobActive: (jobId: string) => {
    return get().activeJobIds.has(jobId);
  },
}));




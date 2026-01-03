import { create } from 'zustand';

export interface PausedSheetJob {
  syncJobId: string;
  packId: string;
  packName: string;
  toastId: string;
  integrationId: string;
  pausedAt: Date;
  reason: "google_token_expired";
}

interface PausedSheetJobsStore {
  pausedJobs: Map<string, PausedSheetJob>;
  pauseJob: (job: PausedSheetJob) => void;
  getJob: (packId: string) => PausedSheetJob | undefined;
  clearJob: (packId: string) => void;
  hasPausedJob: (packId: string) => boolean;
  getAllPausedJobs: () => PausedSheetJob[];
  clearAll: () => void;
}

export const usePausedSheetJobsStore = create<PausedSheetJobsStore>((set, get) => ({
  pausedJobs: new Map(),

  pauseJob: (job: PausedSheetJob) => {
    const { pausedJobs } = get();
    const newMap = new Map(pausedJobs);
    newMap.set(job.packId, job);
    set({ pausedJobs: newMap });
  },

  getJob: (packId: string) => {
    return get().pausedJobs.get(packId);
  },

  clearJob: (packId: string) => {
    const { pausedJobs } = get();
    const newMap = new Map(pausedJobs);
    newMap.delete(packId);
    set({ pausedJobs: newMap });
  },

  hasPausedJob: (packId: string) => {
    return get().pausedJobs.has(packId);
  },

  getAllPausedJobs: () => {
    return Array.from(get().pausedJobs.values());
  },

  clearAll: () => {
    set({ pausedJobs: new Map() });
  },
}));

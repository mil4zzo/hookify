import { create } from "zustand";
import type { ValidationCondition } from "@/components/common/ValidationCriteriaBuilder";

export const DEFAULT_LANGUAGE = "pt-BR";
export const DEFAULT_CURRENCY = "BRL";
export const DEFAULT_NICHE = "";
export const DEFAULT_MQL_LEADSCORE_MIN = 0;

export interface UserPreferencesValues {
  language: string;
  currency: string;
  niche: string;
  validationCriteria: ValidationCondition[];
  mqlLeadscoreMin: number;
}

interface UserPreferencesState extends UserPreferencesValues {
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  hasLoaded: boolean;
  loadedUserId: string | null;
}

interface UserPreferencesActions {
  setPreferences: (values: Partial<UserPreferencesValues>, loadedUserId?: string | null) => void;
  setIsLoading: (value: boolean) => void;
  setIsSaving: (value: boolean) => void;
  setError: (value: string | null) => void;
  resetLoadState: () => void;
}

type UserPreferencesStore = UserPreferencesState & UserPreferencesActions;

export const useUserPreferencesStore = create<UserPreferencesStore>()((set) => ({
  language: DEFAULT_LANGUAGE,
  currency: DEFAULT_CURRENCY,
  niche: DEFAULT_NICHE,
  validationCriteria: [],
  mqlLeadscoreMin: DEFAULT_MQL_LEADSCORE_MIN,
  isLoading: false,
  isSaving: false,
  error: null,
  hasLoaded: false,
  loadedUserId: null,

  setPreferences: (values, loadedUserId) => {
    set((state) => ({
      ...state,
      ...values,
      hasLoaded: true,
      loadedUserId: loadedUserId !== undefined ? loadedUserId : state.loadedUserId,
      error: null,
    }));
  },

  setIsLoading: (value) => set({ isLoading: value }),
  setIsSaving: (value) => set({ isSaving: value }),
  setError: (value) => set({ error: value }),
  resetLoadState: () => set({ hasLoaded: false, loadedUserId: null }),
}));

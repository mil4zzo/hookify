import { create } from "zustand";
import { EMPTY_RULE_TREE, type RuleTree } from "@/lib/rules/types";

export const DEFAULT_LANGUAGE = "pt-BR";
export const DEFAULT_CURRENCY = "BRL";
export const DEFAULT_NICHE = "";
export type DiagnosticCostMetric = "cpr" | "cpmql";
export const DEFAULT_DIAGNOSTIC_COST_METRIC: DiagnosticCostMetric = "cpr";

export interface UserPreferencesValues {
  language: string;
  currency: string;
  niche: string;
  /** Critério de validação: a MESMA árvore de regra do Manager e do Boards. */
  validationCriteria: RuleTree;
  diagnosticCostMetric: DiagnosticCostMetric;
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
  validationCriteria: EMPTY_RULE_TREE,
  diagnosticCostMetric: DEFAULT_DIAGNOSTIC_COST_METRIC,
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

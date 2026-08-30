"use client";

import { useCallback } from "react";
import type { RuleTree } from "@/lib/rules/types";
import { useUserPreferences } from "./useUserPreferences";

interface UseValidationCriteriaReturn {
  /** A regra de maturidade do anúncio — mesma árvore do Manager e do Boards. */
  criteria: RuleTree;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  updateCriteria: (criteria: RuleTree) => void;
  saveCriteria: (criteria: RuleTree) => Promise<void>;
}

export function useValidationCriteria(): UseValidationCriteriaReturn {
  const { validationCriteria, isLoading, isSaving, error, updatePreferences, savePreferences } = useUserPreferences();

  const updateCriteria = useCallback((criteria: RuleTree) => {
    updatePreferences({ validationCriteria: criteria });
  }, [updatePreferences]);

  const saveCriteria = useCallback(async (criteria: RuleTree) => {
    updatePreferences({ validationCriteria: criteria });
    await savePreferences({ validationCriteria: criteria });
  }, [savePreferences, updatePreferences]);

  return {
    criteria: validationCriteria,
    isLoading,
    isSaving,
    error,
    updateCriteria,
    saveCriteria,
  };
}

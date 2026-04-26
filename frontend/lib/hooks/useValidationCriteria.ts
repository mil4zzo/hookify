"use client";

import { useCallback } from "react";
import { ValidationCondition } from "@/components/common/ValidationCriteriaBuilder";
import { useUserPreferences } from "./useUserPreferences";

interface UseValidationCriteriaReturn {
  criteria: ValidationCondition[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  updateCriteria: (criteria: ValidationCondition[]) => void;
  saveCriteria: (criteria: ValidationCondition[]) => Promise<void>;
}

export function useValidationCriteria(): UseValidationCriteriaReturn {
  const { validationCriteria, isLoading, isSaving, error, updatePreferences, savePreferences } = useUserPreferences();

  const updateCriteria = useCallback((criteria: ValidationCondition[]) => {
    updatePreferences({ validationCriteria: criteria });
  }, [updatePreferences]);

  const saveCriteria = useCallback(async (criteria: ValidationCondition[]) => {
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

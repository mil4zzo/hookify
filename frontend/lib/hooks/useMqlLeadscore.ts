"use client";

import { useCallback } from "react";
import { useUserPreferences } from "./useUserPreferences";

interface UseMqlLeadscoreReturn {
  mqlLeadscoreMin: number;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  updateMqlLeadscoreMin: (value: number) => void;
  saveMqlLeadscoreMin: (value: number) => Promise<void>;
}

export function useMqlLeadscore(): UseMqlLeadscoreReturn {
  const { mqlLeadscoreMin, isLoading, isSaving, error, updatePreferences, savePreferences } = useUserPreferences();

  const updateMqlLeadscoreMin = useCallback((value: number) => {
    updatePreferences({ mqlLeadscoreMin: value });
  }, [updatePreferences]);

  const saveMqlLeadscoreMin = useCallback(async (value: number) => {
    if (value < 0 || isNaN(value)) {
      throw new Error("O leadscore mínimo deve ser um número >= 0");
    }

    await savePreferences({ mqlLeadscoreMin: value });
  }, [savePreferences]);

  return {
    mqlLeadscoreMin,
    isLoading,
    isSaving,
    error,
    updateMqlLeadscoreMin,
    saveMqlLeadscoreMin,
  };
}

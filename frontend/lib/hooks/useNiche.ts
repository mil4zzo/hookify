"use client";

import { useCallback } from "react";
import { useUserPreferences } from "./useUserPreferences";

interface UseNicheReturn {
  niche: string;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  updateNiche: (value: string) => void;
  saveNiche: (value: string) => Promise<void>;
}

export function useNiche(): UseNicheReturn {
  const { niche, isLoading, isSaving, error, updatePreferences, savePreferences } = useUserPreferences();

  const updateNiche = useCallback((value: string) => {
    updatePreferences({ niche: value });
  }, [updatePreferences]);

  const saveNiche = useCallback(async (value: string) => {
    if (typeof value !== "string") {
      throw new Error("O nicho deve ser um texto válido");
    }

    await savePreferences({ niche: value });
  }, [savePreferences]);

  return {
    niche,
    isLoading,
    isSaving,
    error,
    updateNiche,
    saveNiche,
  };
}

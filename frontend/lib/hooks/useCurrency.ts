"use client";

import { useCallback } from "react";
import { useUserPreferences } from "./useUserPreferences";

interface UseCurrencyReturn {
  currency: string;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  updateCurrency: (value: string) => void;
  saveCurrency: (value: string) => Promise<void>;
}

export function useCurrency(): UseCurrencyReturn {
  const { currency, isLoading, isSaving, error, updatePreferences, savePreferences } = useUserPreferences();

  const updateCurrency = useCallback((value: string) => {
    updatePreferences({ currency: value });
  }, [updatePreferences]);

  const saveCurrency = useCallback(async (value: string) => {
    if (!value || typeof value !== "string") {
      throw new Error("A moeda deve ser um código válido");
    }

    await savePreferences({ currency: value });
  }, [savePreferences]);

  return {
    currency,
    isLoading,
    isSaving,
    error,
    updateCurrency,
    saveCurrency,
  };
}

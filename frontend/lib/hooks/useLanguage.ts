"use client";

import { useCallback } from "react";
import { useUserPreferences } from "./useUserPreferences";

interface UseLanguageReturn {
  language: string;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  updateLanguage: (value: string) => void;
  saveLanguage: (value: string) => Promise<void>;
}

export function useLanguage(): UseLanguageReturn {
  const { language, isLoading, isSaving, error, updatePreferences, savePreferences } = useUserPreferences();

  const updateLanguage = useCallback((value: string) => {
    updatePreferences({ language: value });
  }, [updatePreferences]);

  const saveLanguage = useCallback(async (value: string) => {
    const supportedLanguages = ["pt-BR", "en-US", "es-ES"];

    if (!value || typeof value !== "string") {
      throw new Error("O idioma deve ser um código válido");
    }

    if (!supportedLanguages.includes(value)) {
      throw new Error("Idioma não suportado");
    }

    await savePreferences({ language: value });
  }, [savePreferences]);

  return {
    language,
    isLoading,
    isSaving,
    error,
    updateLanguage,
    saveLanguage,
  };
}

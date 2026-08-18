"use client";

import { useCallback } from "react";
import { useUserPreferences } from "./useUserPreferences";
import { usePackJudgment } from "./usePackJudgment";
import type { JudgmentSource } from "@/lib/judgment/resolveJudgment";

interface UseMqlLeadscoreReturn {
  /**
   * Valor EFETIVO para julgamento, já resolvido contra os packs selecionados.
   * É o que alimenta contagem de MQL, CPMQL, G.O.L.D. e diagnóstico.
   */
  mqlLeadscoreMin: number;
  /**
   * Padrão da conta (user_preferences). É isto que o editor global do Topbar
   * altera — nunca o valor efetivo, que pode vir do override de um pack.
   */
  userMqlLeadscoreMin: number;
  /** De onde veio o valor efetivo. */
  source: JudgmentSource;
  /** Packs selecionados discordam entre si neste campo. */
  divergent: boolean;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  /** Edita o padrão da conta (otimista, sem persistir). */
  updateMqlLeadscoreMin: (value: number) => void;
  /** Persiste o padrão da conta. */
  saveMqlLeadscoreMin: (value: number) => Promise<void>;
}

export function useMqlLeadscore(): UseMqlLeadscoreReturn {
  const {
    mqlLeadscoreMin: userMqlLeadscoreMin,
    isLoading,
    isSaving,
    error,
    updatePreferences,
    savePreferences,
  } = useUserPreferences();

  const judgment = usePackJudgment();

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
    mqlLeadscoreMin: judgment.mqlLeadscoreMin,
    userMqlLeadscoreMin,
    source: judgment.source.mqlLeadscoreMin,
    divergent: judgment.divergent.mqlLeadscoreMin,
    isLoading,
    isSaving,
    error,
    updateMqlLeadscoreMin,
    saveMqlLeadscoreMin,
  };
}

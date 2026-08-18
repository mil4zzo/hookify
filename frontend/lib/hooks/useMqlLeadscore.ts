"use client";

import { usePackJudgment } from "./usePackJudgment";

interface UseMqlLeadscoreReturn {
  /**
   * Corte EFETIVO para julgamento, resolvido contra os packs selecionados.
   * Alimenta contagem de MQL, CPMQL, G.O.L.D. e diagnóstico.
   *
   * `null` = NÃO DEFINIDO (pack sem corte, ou packs que discordam). Quem consome
   * precisa exibir indisponível — nunca tratar como 0, que contaria todo lead
   * como MQL e derrubaria o CPMQL para um número excelente e falso.
   */
  mqlLeadscoreMin: number | null;
  /** Packs selecionados discordam entre si neste campo. */
  divergent: boolean;
  isLoading: boolean;
}

/**
 * O corte vive no pack (migration 110) — não há padrão de conta para editar aqui.
 * Quem edita é `useJudgmentEditor`, que escreve no pack.
 */
export function useMqlLeadscore(): UseMqlLeadscoreReturn {
  const judgment = usePackJudgment();

  return {
    mqlLeadscoreMin: judgment.mqlLeadscoreMin,
    divergent: judgment.divergent.mqlLeadscoreMin,
    isLoading: judgment.isLoading,
  };
}

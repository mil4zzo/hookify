"use client";

import { useMemo } from "react";
import { usePackJudgment } from "./usePackJudgment";
import type { LeadEconomics } from "@/lib/utils/leadEconomics";

interface UseLeadEconomicsReturn {
  /**
   * Economia do lead EFETIVA (produtos e faixas de nota), resolvida contra os
   * packs selecionados e já normalizada. Alimenta Teto de CPL e Margem.
   *
   * `null` = NÃO CONFIGURADO (pack sem cadastro, cadastro inválido, ou packs que
   * discordam). Quem consome precisa exibir indisponível — nunca tratar como
   * zero, que diria "esse lead não vale nada" com um teto de R$ 0 falso.
   */
  leadEconomics: LeadEconomics | null;
  /** Packs selecionados discordam entre si neste campo. */
  divergent: boolean;
  isLoading: boolean;
}

/**
 * O cadastro vive no pack (`packs.lead_economics`, migration 179) — não há padrão
 * de conta. Quem edita é a configuração do pack (`PackJudgmentDialog`).
 */
export function useLeadEconomics(): UseLeadEconomicsReturn {
  const judgment = usePackJudgment();

  // Referência estável enquanto o CONTEÚDO não muda. `resolveJudgment` normaliza
  // de novo a cada mudança no store de packs (refresh terminando, stats, selo de
  // atualização) e devolve um objeto novo com o mesmo conteúdo — diferente do
  // corte de MQL, que é um número. Os comparadores de memo da tabela comparam
  // por referência e re-renderizariam todas as células à toa.
  const contentKey = JSON.stringify(judgment.leadEconomics);
  const leadEconomics = useMemo(() => judgment.leadEconomics, [contentKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    leadEconomics,
    divergent: judgment.divergent.leadEconomics,
    isLoading: judgment.isLoading,
  };
}

"use client";

import { useMemo } from "react";
import { usePackJudgment } from "./usePackJudgment";
import { normalizeLeadEconomics, type LeadEconomics, type LeadEconomicsByPack } from "@/lib/utils/leadEconomics";

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

interface UseLeadEconomicsByPackReturn {
  /**
   * Cadastro de cada pack SELECIONADO (`null` = pack sem cadastro). É o que o
   * Manager usa desde a D27: cada linha se resolve pelos `pack_ids` dela
   * (`resolveRowLeadEconomics`), e só a linha que mistura cadastros diferentes
   * fica sem teto — não a tela inteira, como no `useLeadEconomics` acima.
   */
  byPack: LeadEconomicsByPack;
  /** Algum pack selecionado tem cadastro: as colunas Teto de CPL e Margem existem. */
  hasLeadEconomics: boolean;
}

export function useLeadEconomicsByPack(): UseLeadEconomicsByPackReturn {
  const { selectedPacks } = usePackJudgment();

  // Mesma razão do memo acima, e aqui ela pesa mais: a conta por linha guarda cache
  // pela REFERÊNCIA do cadastro (computeLeadEconomics) e da resolução
  // (resolveRowLeadEconomics). Um mapa novo a cada mudança do store de packs
  // jogaria fora os dois caches e redesenharia todas as células.
  // Normaliza só quando a seleção (ou um pack dela) muda — a tabela re-renderiza a cada
  // tecla na busca, e `selectedPacks` já vem memoizado por `usePackJudgment`.
  const entries = useMemo(
    () => selectedPacks.map((pack) => [pack.id, normalizeLeadEconomics(pack.lead_economics)] as const),
    [selectedPacks],
  );
  const contentKey = useMemo(() => JSON.stringify(entries), [entries]);
  return useMemo(() => {
    const byPack: Record<string, LeadEconomics | null> = {};
    for (const [packId, config] of entries) byPack[packId] = config;
    return { byPack, hasLeadEconomics: entries.some(([, config]) => config !== null) };
  }, [contentKey]); // eslint-disable-line react-hooks/exhaustive-deps
}

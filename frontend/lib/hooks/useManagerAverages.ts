"use client";

import { useMemo } from "react";
import { RankingsItem } from "@/lib/api/schemas";
import { computeManagerAverages, type ManagerAverages } from "@/lib/metrics";

interface UseManagerAveragesOptions {
  ads: RankingsItem[];
  actionType?: string;
  hasSheetIntegration?: boolean;
  mqlLeadscoreMin: number;
}

/**
 * Calcula médias globais exibidas no header da ManagerTable.
 *
 * - Otimizado: 1 loop sobre `ads`
 * - Estável: memoiza por dependências de dados e parâmetros relevantes
 */
export function useManagerAverages({
  ads,
  actionType,
  hasSheetIntegration = false,
  mqlLeadscoreMin,
}: UseManagerAveragesOptions): ManagerAverages {
  return useMemo(
    () =>
      computeManagerAverages(ads as RankingsItem[], {
        actionType,
        hasSheetIntegration,
        includeScrollStop: true,
        mqlLeadscoreMin,
      }),
    [ads, actionType, hasSheetIntegration, mqlLeadscoreMin],
  );
}

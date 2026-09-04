"use client";

import { useMemo } from "react";
import { RankingsItem } from "@/lib/api/schemas";
import { computeManagerAverages, type ManagerAverages } from "@/lib/metrics";
import type { CustomColumnDef } from "@/lib/metrics/customColumns";

interface UseManagerAveragesOptions {
  ads: RankingsItem[];
  actionType?: string;
  hasSheetIntegration?: boolean;
  mqlLeadscoreMin: number | null;
  /** 140: colunas vinculadas da planilha (médias em `custom`). */
  customColumns?: ReadonlyArray<CustomColumnDef>;
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
  customColumns,
}: UseManagerAveragesOptions): ManagerAverages {
  return useMemo(
    () =>
      computeManagerAverages(ads as RankingsItem[], {
        actionType,
        hasSheetIntegration,
        includeScrollStop: true,
        mqlLeadscoreMin,
        customColumns,
      }),
    [ads, actionType, hasSheetIntegration, mqlLeadscoreMin, customColumns],
  );
}

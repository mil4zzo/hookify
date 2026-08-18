"use client";

import { useMemo } from "react";
import { useFiltersStore } from "@/lib/store/filters";
import { useClientPacks } from "@/lib/hooks/useClientSession";
import {
  resolveJudgment,
  type PackJudgmentConfig,
  type ResolvedJudgment,
} from "@/lib/judgment/resolveJudgment";
import type { AdsPack } from "@/lib/types";

export interface UsePackJudgmentReturn extends ResolvedJudgment {
  /** Packs atualmente selecionados (fonte da resolução). */
  selectedPacks: AdsPack[];
  /** Nomes dos packs selecionados — usado para explicar a divergência na UI. */
  selectedPackNames: string[];
  isLoading: boolean;
}

/**
 * Configuração de julgamento efetiva para a seleção atual de packs.
 *
 * Ponto único de resolução: quem precisa do valor efetivo consome daqui. O
 * critério vem SÓ dos packs selecionados — `user_preferences` não participa
 * mais desta resolução (migration 110).
 *
 * Assina o store de filtros de forma estreita (só `packPreferences`) em vez de
 * usar `useFilters()`, que carrega efeitos de sincronização de data e faria
 * qualquer consumidor de julgamento re-renderizar a cada mudança de período.
 */
export function usePackJudgment(): UsePackJudgmentReturn {
  const packPreferences = useFiltersStore((s) => s.packPreferences);
  // useClientPacks nao expoe loading: `isClient` false = ainda hidratando o
  // store persistido, que e exatamente o momento em que a selecao nao e confiavel.
  const { packs, isClient } = useClientPacks();
  const isLoading = !isClient;

  const selectedPacks = useMemo(() => {
    const enabled = new Set(
      Object.entries(packPreferences)
        .filter(([, isOn]) => isOn)
        .map(([id]) => id)
    );
    return packs.filter((pack) => enabled.has(pack.id));
  }, [packs, packPreferences]);

  const resolved = useMemo(
    () => resolveJudgment(selectedPacks as unknown as PackJudgmentConfig[]),
    [selectedPacks]
  );

  const selectedPackNames = useMemo(
    () => selectedPacks.map((pack) => pack.name).filter(Boolean),
    [selectedPacks]
  );

  return {
    ...resolved,
    selectedPacks,
    selectedPackNames,
    isLoading,
  };
}

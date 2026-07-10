"use client";

import { useMemo } from "react";
import { useAdAccountsDb } from "@/lib/api/hooks";

export interface DetectedAccountCurrency {
  /** Moeda única detectada nas contas conectadas, ou null se ainda não sincronizada/ambígua. */
  currency: string | null;
  /** true quando as contas conectadas têm moedas DIFERENTES entre si — nunca convertemos, só sinalizamos. */
  isMixed: boolean;
  /** true enquanto a lista de contas ainda está carregando (nunca chegou a resolver). */
  isLoading: boolean;
}

/**
 * Deriva a moeda "de verdade" (a da conta Meta conectada) a partir de ad_accounts.currency,
 * substituindo a antiga escolha manual do usuário: como a Meta já devolve spend/budget na
 * moeda da própria conta, deixar o usuário "escolher" outra moeda nunca converteu nada —
 * só descolava o símbolo exibido do valor real.
 */
export function useDetectedAccountCurrency(): DetectedAccountCurrency {
  const { data, isLoading } = useAdAccountsDb();

  return useMemo(() => {
    const currencies = Array.from(
      new Set(
        (data || [])
          .map((acc) => String((acc as { currency?: string | null } | undefined)?.currency || "").trim().toUpperCase())
          .filter(Boolean)
      )
    );

    if (currencies.length === 1) {
      return { currency: currencies[0], isMixed: false, isLoading };
    }
    if (currencies.length > 1) {
      return { currency: null, isMixed: true, isLoading };
    }
    return { currency: null, isMixed: false, isLoading };
  }, [data, isLoading]);
}

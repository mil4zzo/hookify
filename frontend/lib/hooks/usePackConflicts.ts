"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/endpoints";
import { useSupabaseAuth } from "@/lib/hooks/useSupabaseAuth";
import { useClientPacks } from "@/lib/hooks/useClientSession";

/**
 * Grafo de conflito cross-silo entre os packs acessíveis.
 *
 * Dois packs de DONOS diferentes que contêm o mesmo anúncio no mesmo dia não
 * podem ser analisados juntos: o dedup escolheria uma das linhas e o total
 * deixaria de ser exato. Decisão de produto: "impreciso é impreciso" — não se
 * avisa com porcentagem, bloqueia-se. Packs do MESMO dono nunca conflitam
 * (mesma linha física, nenhuma imprecisão).
 *
 * O grafo cobre TODOS os packs da lista, não só os selecionados: a seleção muda
 * a cada clique, mas o grafo só muda quando o conteúdo de um pack muda (refresh)
 * ou um grant aparece — por isso um fetch com staleTime serve todas as
 * interações, e o toggle de seleção é puramente client-side.
 */
export function usePackConflicts() {
  const { session, sessionReady } = useSupabaseAuth();
  const { packs, isClient } = useClientPacks();

  const packIds = useMemo(() => packs.map((p) => p.id).sort(), [packs]);

  const query = useQuery({
    // user_id na key: cache persistido não pode vazar entre contas.
    queryKey: ["pack-conflicts", session?.user?.id ?? "anon", packIds.join(",")],
    queryFn: ({ signal }) => api.packShares.getConflicts(packIds, { signal }),
    // Conflito exige 2+ packs e donos diferentes — com a lista vazia/unitária
    // nem vale a viagem.
    enabled: !!session && sessionReady && isClient && packIds.length >= 2,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  /** packId -> conjunto de packIds com que ele conflita (grafo não-direcionado). */
  const conflictMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const [a, b] of query.data?.pairs ?? []) {
      if (!map.has(a)) map.set(a, new Set());
      if (!map.has(b)) map.set(b, new Set());
      map.get(a)!.add(b);
      map.get(b)!.add(a);
    }
    return map;
  }, [query.data]);

  return {
    conflictMap,
    pairs: query.data?.pairs ?? [],
    isLoading: query.isLoading,
  };
}

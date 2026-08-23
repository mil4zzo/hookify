import { useInfiniteQuery } from "@tanstack/react-query"

import { api } from "@/lib/api/endpoints"
import { queryKeys } from "@/lib/api/hooks"
import type { PackActivityResponse } from "@/lib/api/schemas"

const PAGE_SIZE = 40

/**
 * Histórico de ações de um pack (P3.5).
 *
 * Paginação por cursor (`next_before`) e não por página numerada: o feed cresce
 * pelo topo, então um offset passaria a apontar para a linha errada assim que
 * alguém agisse no pack durante a leitura.
 *
 * `staleTime` curto de propósito — o valor do feed está em mostrar o que o
 * colega acabou de fazer.
 */
export function usePackActivity(packId: string | null, actorId?: string, enabled = true) {
  return useInfiniteQuery<PackActivityResponse>({
    queryKey: queryKeys.packActivity(packId ?? "", actorId ?? ""),
    enabled: enabled && !!packId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.analytics.getPackActivity(packId as string, {
        limit: PAGE_SIZE,
        before: pageParam as string | undefined,
        actorId,
        signal,
      }),
    getNextPageParam: (lastPage) => lastPage.next_before ?? undefined,
    staleTime: 30_000,
  })
}

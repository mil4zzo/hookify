"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { api } from "@/lib/api/endpoints"

export interface AdsSearchFilters {
  q?: string
  q_adset?: string
  q_campaign?: string
  pack_id?: string
}

const PAGE_SIZE = 50

export function useAdsSearch(filters: AdsSearchFilters) {
  return useInfiniteQuery({
    queryKey: ["ads-search", filters],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.bulkAds.searchAds({
        q: filters.q || undefined,
        q_adset: filters.q_adset || undefined,
        q_campaign: filters.q_campaign || undefined,
        pack_id: filters.pack_id || undefined,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    getNextPageParam: (last) => last.next_offset ?? undefined,
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
  })
}

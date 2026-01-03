"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/endpoints";
import type { GlobalSearchResponse } from "@/lib/api/schemas";

export interface UseGlobalSearchOptions {
  enabled?: boolean;
  limit?: number;
  debounceMs?: number;
}

function canSearch(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  const isDigits = /^\d+$/.test(q);
  if (isDigits) return q.length >= 3; // ad_id exato
  return q.length >= 2; // contains
}

export function useGlobalSearch(rawQuery: string, options: UseGlobalSearchOptions = {}) {
  const { enabled = true, limit = 20, debounceMs = 300 } = options;

  const [debouncedQuery, setDebouncedQuery] = useState(rawQuery.trim());

  useEffect(() => {
    const next = rawQuery.trim();
    const t = setTimeout(() => setDebouncedQuery(next), debounceMs);
    return () => clearTimeout(t);
  }, [rawQuery, debounceMs]);

  const effectiveEnabled = enabled && canSearch(debouncedQuery);

  const queryKey = useMemo(() => ["analytics", "global-search", debouncedQuery, limit] as const, [debouncedQuery, limit]);

  return useQuery<GlobalSearchResponse>({
    queryKey,
    queryFn: () => api.analytics.searchGlobal(debouncedQuery, limit),
    enabled: effectiveEnabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}



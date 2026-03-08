"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/endpoints";
import { useClientAuth } from "@/lib/hooks/useClientSession";
import type { OnboardingStatusResponse } from "@/lib/api/endpoints";

const qk = {
  status: ["onboarding", "status"] as const,
};

const CACHE_KEY = "hookify-onboarding-status";

function cacheStatus(data: OnboardingStatusResponse) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch { /* quota exceeded — ignorar */ }
}

export function getCachedOnboardingStatus(): OnboardingStatusResponse | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function useOnboardingStatus(enabled: boolean = true) {
  const { isAuthenticated } = useClientAuth();

  return useQuery({
    queryKey: qk.status,
    queryFn: async () => {
      const data = await api.onboarding.getStatus();
      cacheStatus(data);
      return data;
    },
    enabled: enabled && isAuthenticated,
    staleTime: Infinity,
  });
}




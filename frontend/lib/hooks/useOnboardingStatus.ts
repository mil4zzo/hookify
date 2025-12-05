"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/endpoints";
import { useClientAuth } from "@/lib/hooks/useClientSession";

const qk = {
  status: ["onboarding", "status"] as const,
};

export function useOnboardingStatus(enabled: boolean = true) {
  const { isAuthenticated } = useClientAuth();

  return useQuery({
    queryKey: qk.status,
    queryFn: api.onboarding.getStatus,
    enabled: enabled && isAuthenticated,
    // Sempre considerar status como "stale" para garantir que refetch ocorra
    staleTime: 0,
  });
}




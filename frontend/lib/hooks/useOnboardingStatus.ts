"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
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

/**
 * Atualiza o status de onboarding no cache do TanStack Query e no localStorage
 * imediatamente após uma mutação (salvar preferências, conectar Facebook, completar).
 *
 * Necessário porque a query usa staleTime: Infinity — sem este patch, o gate das
 * páginas do app continuaria lendo has_completed_onboarding=false e rebateria o
 * usuário de volta para /onboarding mesmo depois de concluído.
 */
export function patchOnboardingStatusCache(queryClient: QueryClient, patch: Partial<OnboardingStatusResponse>) {
  const current =
    queryClient.getQueryData<OnboardingStatusResponse>(qk.status) ?? getCachedOnboardingStatus();

  const next: OnboardingStatusResponse = {
    has_completed_onboarding: false,
    initial_settings_configured: false,
    facebook_connected: false,
    validation_criteria_configured: false,
    ...(current ?? {}),
    ...patch,
  };

  queryClient.setQueryData(qk.status, next);
  cacheStatus(next);
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




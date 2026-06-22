"use client"

import { useQuery } from "@tanstack/react-query"
import { getSupabaseClient } from "@/lib/supabase/client"
import { useClientAuth } from "@/lib/hooks/useClientSession"
import { type Tier, getEffectiveTier } from "@/lib/config/tierConfig"

export interface SubscriptionData {
  tier: Tier
  expires_at: string | null
  stripe_status: string | null
  cancel_at_period_end: boolean | null
  effectiveTier: Tier
}

async function fetchSubscription(): Promise<SubscriptionData> {
  const supabase = getSupabaseClient()
  const { data } = await supabase
    .from("subscriptions")
    .select("tier, expires_at, stripe_status, cancel_at_period_end")
    .maybeSingle()

  const tier = (data?.tier ?? "standard") as Tier
  const expiresAt = data?.expires_at ?? null
  const effectiveTier = getEffectiveTier(tier, expiresAt)

  return {
    tier,
    expires_at: expiresAt,
    stripe_status: data?.stripe_status ?? null,
    cancel_at_period_end: data?.cancel_at_period_end ?? null,
    effectiveTier,
  }
}

/** Returns effectiveTier as Tier string — drop-in compatible with all existing consumers. */
export function useUserTier() {
  const { isAuthenticated } = useClientAuth()

  return useQuery({
    queryKey: ["user-tier"],
    queryFn: fetchSubscription,
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
    select: (s) => s.effectiveTier,
  })
}

/** Returns full subscription object including stripe_status, expires_at, etc. */
export function useSubscription() {
  const { isAuthenticated } = useClientAuth()

  return useQuery({
    queryKey: ["user-tier"],
    queryFn: fetchSubscription,
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  })
}

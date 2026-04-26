"use client"

import { useQuery } from "@tanstack/react-query"
import { getSupabaseClient } from "@/lib/supabase/client"
import { useClientAuth } from "@/lib/hooks/useClientSession"
import { type Tier } from "@/lib/config/tierConfig"

async function fetchUserTier(): Promise<Tier> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from("subscriptions")
    .select("tier")
    .single()

  if (error || !data) return "standard"
  return data.tier as Tier
}

export function useUserTier() {
  const { isAuthenticated } = useClientAuth()

  return useQuery({
    queryKey: ["user-tier"],
    queryFn: fetchUserTier,
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  })
}

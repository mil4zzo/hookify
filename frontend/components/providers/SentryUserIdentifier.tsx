"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect } from "react"
import { useSupabaseAuth } from "@/lib/hooks/useSupabaseAuth"

/**
 * Identifica o usuário autenticado no Sentry para correlacionar erros.
 * Renderiza null — componente invisível.
 */
export function SentryUserIdentifier() {
  const { user } = useSupabaseAuth()

  useEffect(() => {
    if (user) {
      Sentry.setUser({
        id: user.id,
        email: user.email,
      })
    } else {
      Sentry.setUser(null)
    }
  }, [user])

  return null
}

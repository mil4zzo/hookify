"use client"
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider, type PersistQueryClientOptions } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { useState } from 'react'

const PERSIST_KEY = 'hookify-rq-cache-v1'
// Bump this string to invalidate all persisted caches at once (e.g., after a breaking schema change).
const PERSIST_BUSTER = 'hookify-2026-05-01'
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function ReactQueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        // Erros 4xx (400/401/403/429...) são determinísticos ou rate limit:
        // re-tentar não resolve e, no caso do 429, amplifica o excesso.
        retry: (failureCount, error) => {
          const status = (error as { status?: number } | null)?.status
          if (typeof status === 'number' && status >= 400 && status < 500) return false
          return failureCount < 2
        },
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  }))

  const [persistOptions] = useState<Omit<PersistQueryClientOptions, 'queryClient'>>(() => {
    const persister = createSyncStoragePersister({
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      key: PERSIST_KEY,
      throttleTime: 1000,
    })
    return {
      persister,
      maxAge: SEVEN_DAYS_MS,
      buster: PERSIST_BUSTER,
      dehydrateOptions: {
        shouldDehydrateQuery: (query) => {
          if (query.state.status !== 'success') return false
          const key = query.queryKey
          // Persist connections so the button area renders instantly on return visits (optimistic),
          // then revalidates in the background. Logout clears this via invalidateSessionCache.
          if (Array.isArray(key) && key[0] === 'facebook' && key[1] === 'connections') return true
          return false
        },
      },
    }
  })

  return (
    <PersistQueryClientProvider client={client} persistOptions={persistOptions}>
      {children}
    </PersistQueryClientProvider>
  )
}

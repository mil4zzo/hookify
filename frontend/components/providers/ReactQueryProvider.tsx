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
        retry: 2,
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
        // Persistir SOMENTE queries de conversion-types — array pequeno e raramente-mutável.
        // Cross-user safety: o queryKey do useConversionTypes inclui user_id, evitando vazamento.
        shouldDehydrateQuery: (query) => {
          if (query.state.status !== 'success') return false
          const key = query.queryKey
          return Array.isArray(key) && key[0] === 'analytics' && key[1] === 'conversion-types'
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

"use client"
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider, type PersistQueryClientOptions } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { useEffect, useState } from 'react'
import { persistManualAnalyticsUpdate } from '@/lib/api/analyticsPersister'
import { REACT_QUERY_PERSIST_KEY } from '@/lib/storage/reactQueryPersistKeys'

const PERSIST_KEY = REACT_QUERY_PERSIST_KEY
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
          // then revalidates in the background.
          // A chave é ['facebook','connections', userId] — o dono faz parte dela,
          // então uma entrada de outra conta nunca é reidratada como se fosse
          // desta. O logout ainda apaga o blob inteiro (store de sessão), mas o
          // escopo por usuário cobre os casos em que o logout não roda (sessão
          // expirada, aba fechada, cookie limpo).
          if (Array.isArray(key) && key[0] === 'facebook' && key[1] === 'connections') return true
          return false
        },
      },
    }
  })

  // Fase 2 do cache (IndexedDB por query): o persister grava no caminho de fetch; um
  // update MANUAL (setQueryData no toggle de status/tag) não passa por lá. Regrava aqui,
  // senão a recarga restauraria o estado de antes do toggle.
  useEffect(() => {
    return client.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'success' && event.action.manual) {
        persistManualAnalyticsUpdate(event.query)
      }
    })
  }, [client])

  return (
    <PersistQueryClientProvider client={client} persistOptions={persistOptions}>
      {children}
    </PersistQueryClientProvider>
  )
}

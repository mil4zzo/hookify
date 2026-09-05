"use client"

import { useEffect, useRef } from 'react'
import { api } from '@/lib/api/endpoints'
import { useClientAuth, useClientPacks } from '@/lib/hooks/useClientSession'
import { isPackRefreshingOnServer } from '@/lib/utils/packRefreshState'
import { logger } from '@/lib/utils/logger'

/**
 * Mantém atualizado o "outro membro está atualizando este pack".
 *
 * Por que é preciso: `useLoadPacks` roda UMA vez por carregamento de página (o
 * PacksLoader vive no layout raiz e tem guarda de execução única). Sem isto, o
 * selo de atualização congelaria no estado do login — apareceria e nunca sairia
 * até um F5, o que é pior do que não mostrar nada.
 *
 * Só sincroniza os DOIS campos de refresh; nunca toca em stats, julgamento ou
 * integração. Um patch amplo aqui atropelaria atualizações otimistas da tela
 * (ex.: o toggle de auto_refresh voltaria sozinho se a escrita ainda não pousou).
 *
 * Custo: zero requisição em repouso. Só busca quando (a) a aba volta ao foco e
 * já faz um tempo desde a última leitura, ou (b) existe refresh em andamento —
 * e aí para sozinho assim que o refresh termina.
 */

/** Enquanto há refresh vivo, com que frequência conferir se acabou. */
const POLL_ENQUANTO_ATUALIZA_MS = 30_000
/** Piso entre leituras disparadas por foco, para não repetir a cada alt-tab. */
const THROTTLE_FOCO_MS = 20_000

export function usePackRefreshSync() {
  const { isClient, isAuthenticated } = useClientAuth()
  const { packs, updatePack } = useClientPacks()

  // Refs para o efeito não reassinar listeners a cada mudança nos packs.
  const packsRef = useRef(packs)
  packsRef.current = packs
  const updatePackRef = useRef(updatePack)
  updatePackRef.current = updatePack
  const ultimaLeituraRef = useRef(0)
  const emVooRef = useRef(false)

  useEffect(() => {
    if (!isClient || !isAuthenticated) return

    let montado = true
    // useLoadPacks acabou de ler a lista neste carregamento; sem esta âncora, um
    // alt-tab nos primeiros segundos dispararia uma segunda leitura à toa.
    if (ultimaLeituraRef.current === 0) ultimaLeituraRef.current = Date.now()

    const sincronizar = async () => {
      if (emVooRef.current) return
      emVooRef.current = true
      try {
        const response = await api.analytics.listPacks(false)
        if (!montado || !response?.success || !response.packs) return
        ultimaLeituraRef.current = Date.now()

        for (const remoto of response.packs as Array<Record<string, any>>) {
          const local = packsRef.current.find((p) => p.id === remoto.id)
          if (!local) continue // pack novo: fica para o próximo carregamento
          const status = remoto.refresh_status ?? null
          const lock = remoto.refresh_lock_until ?? null
          const ator = remoto.refresh_actor_name ?? null
          if (
            status === ((local as any).refresh_status ?? null) &&
            lock === ((local as any).refresh_lock_until ?? null) &&
            ator === ((local as any).refresh_actor_name ?? null)
          ) {
            continue
          }
          updatePackRef.current(remoto.id, {
            refresh_status: status,
            refresh_lock_until: lock,
            refresh_actor_name: ator,
          } as any)
        }
      } catch (error) {
        // Best-effort: sem esta leitura o selo apenas demora mais a sair.
        logger.warn('[PACK_REFRESH_SYNC] Falha ao reler status de refresh', { error })
      } finally {
        emVooRef.current = false
      }
    }

    const aoVoltarAoFoco = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - ultimaLeituraRef.current < THROTTLE_FOCO_MS) return
      void sincronizar()
    }

    document.addEventListener('visibilitychange', aoVoltarAoFoco)
    window.addEventListener('focus', aoVoltarAoFoco)

    // O intervalo só gasta requisição enquanto houver refresh vivo na tela.
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (!packsRef.current.some((p) => isPackRefreshingOnServer(p))) return
      void sincronizar()
    }, POLL_ENQUANTO_ATUALIZA_MS)

    return () => {
      montado = false
      document.removeEventListener('visibilitychange', aoVoltarAoFoco)
      window.removeEventListener('focus', aoVoltarAoFoco)
      clearInterval(timer)
    }
  }, [isClient, isAuthenticated])
}

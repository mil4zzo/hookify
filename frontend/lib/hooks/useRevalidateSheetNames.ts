"use client"

import { useEffect, useRef } from 'react'
import { api } from '@/lib/api/endpoints'
import { useClientAuth, useClientPacks } from '@/lib/hooks/useClientSession'
import { logger } from '@/lib/utils/logger'

/**
 * Reconfere o nome das planilhas vinculadas depois que os packs carregaram.
 *
 * POR QUE EXISTE
 * --------------
 * `spreadsheet_name` é texto persistido: nenhuma tela lê o nome do Google. Ele
 * só era reconferido dentro do sync, então um pack que parou de sincronizar
 * exibia para sempre o nome do último sync. E como o arquivo do Drive costuma
 * ser UM SÓ, renomeado a cada lançamento com o conteúdo substituído, o vínculo
 * antigo não aponta para uma planilha morta — aponta para o arquivo VIVO.
 *
 * POR QUE NÃO TEM SKELETON
 * ------------------------
 * Já temos um nome, e ele está certo na esmagadora maioria dos carregamentos.
 * Trocar um nome correto por uma barra cinza em toda visita pagaria um custo
 * visual garantido para consertar um caso raro — e a lista de packs é a tela de
 * entrada do app, onde piscar lê como lentidão. O padrão é stale-while-
 * revalidate: pinta o guardado na hora e troca no lugar se voltar diferente.
 *
 * CUSTO
 * -----
 * O backend deduplica por arquivo, então os packs deste usuário custam ~1 a 5
 * chamadas ao Drive. Fora do caminho crítico (só dispara com os packs já na
 * tela) e com piso de tempo entre execuções, porque nome de planilha não muda
 * de hora em hora e um F5 seguido não é motivo para reconferir.
 */

/** Piso entre revalidações. Reload logo em seguida não reconfere de novo. */
const THROTTLE_MS = 15 * 60 * 1000

/**
 * Escopo por usuário: o logout limpa o localStorage chave a chave, e uma chave
 * global faria a conta B herdar o carimbo da conta A no mesmo navegador.
 */
const storageKey = (userId: string) => `hookify:sheet_names_revalidated_at:${userId}`

function shouldRun(userId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    const last = Number(window.localStorage.getItem(storageKey(userId)) || 0)
    return !Number.isFinite(last) || Date.now() - last > THROTTLE_MS
  } catch {
    // Navegador com storage bloqueado: revalidar é melhor que nunca revalidar.
    return true
  }
}

function stampRun(userId: string): void {
  try {
    window.localStorage.setItem(storageKey(userId), String(Date.now()))
  } catch {
    // Sem carimbo o pior caso é revalidar de novo no próximo load. Tudo bem.
  }
}

export function useRevalidateSheetNames(packsLoading: boolean) {
  const { isClient, isAuthenticated, user } = useClientAuth()
  const { packs, updatePack } = useClientPacks()
  const ranForUserRef = useRef<string | null>(null)

  // Refs para o corpo do efeito não depender do fechamento de um render
  // específico — o patch é aplicado depois do await, sobre os packs de então.
  const packsRef = useRef(packs)
  packsRef.current = packs
  const updatePackRef = useRef(updatePack)
  updatePackRef.current = updatePack

  // Cancelamento amarrado ao DESMONTE, não à lista de dependências. Com um
  // `let montado` local, cada reavaliação do efeito (e `packs.length` muda
  // várias vezes durante a carga) abortaria uma requisição ainda em voo.
  const montadoRef = useRef(true)
  useEffect(() => {
    montadoRef.current = true
    return () => {
      montadoRef.current = false
    }
  }, [])

  useEffect(() => {
    const userId = user?.id
    if (!isClient || !isAuthenticated || !userId) return
    if (packsLoading) return
    if (ranForUserRef.current === userId) return

    // Sem nenhuma planilha conectada não há o que conferir — e é o caso mais
    // comum de conta nova. Evita uma requisição que nunca teria resposta útil.
    const temIntegracao = packsRef.current.some((p: any) => p?.sheet_integration)
    if (!temIntegracao) return

    ranForUserRef.current = userId
    if (!shouldRun(userId)) return

    const revalidar = async () => {
      try {
        const res = await api.integrations.google.revalidateSheetNames()
        stampRun(userId)
        if (!montadoRef.current) return

        for (const item of res?.integrations || []) {
          // O patch é por PACK (é ele que o store indexa). Vínculo sem pack —
          // integração global legada — não tem card para atualizar.
          const packId = item.pack_id
          if (!packId) continue
          const pack: any = packsRef.current.find((p: any) => p.id === packId)
          if (!pack?.sheet_integration) continue

          updatePackRef.current(packId, {
            sheet_integration: {
              ...pack.sheet_integration,
              spreadsheet_name: item.spreadsheet_name,
              spreadsheet_renamed_from: item.spreadsheet_renamed_from ?? null,
            },
          } as any)
        }
      } catch (error) {
        // Silêncio é requisito, não desleixo: o usuário não pediu esta chamada.
        // Falhar aqui significa manter o nome guardado, que é o que ele já via.
        logger.warn('useRevalidateSheetNames: revalidação falhou (silencioso)', error)
      }
    }

    void revalidar()
    // `packs.length` entra de propósito: `useLoadPacks` põe isLoading em false
    // também na fase PRÉ-AUTH, então "!packsLoading" sozinho não significa
    // "packs no store". Sem esta dependência, um login novo avaliaria o efeito
    // com a lista vazia, cairia na guarda de "nenhuma planilha conectada" e
    // nunca mais reavaliaria. Reentrada é barrada por `ranForUserRef`.
  }, [isClient, isAuthenticated, user?.id, packsLoading, packs.length])
}

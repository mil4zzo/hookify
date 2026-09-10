"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { useFilters } from "@/lib/hooks/useFilters"
import { useClientAuth } from "@/lib/hooks/useClientSession"
import { PackFilter } from "@/components/common/PackFilter"
import { deselectVisible, selectVisibleRespectingConflicts } from "@/components/common/filterListBulk"
import { showInfo } from "@/lib/utils/toast"
import { usePackConflicts } from "@/lib/hooks/usePackConflicts"
import { ActionTypeFilter } from "@/components/common/ActionTypeFilter"
import { DateRangeFilter } from "@/components/common/DateRangeFilter"

/**
 * Global filter selectors rendered in the Topbar center section.
 * Reads/writes from the global useFiltersStore via useFilters().
 * Only visible when authenticated and on desktop (hidden md:flex).
 *
 * Pack selection is committed to the store only when the popover closes,
 * avoiding API requests while the user is still browsing the list.
 */
export function TopbarFilters() {
  const { isAuthenticated } = useClientAuth()
  const pathname = usePathname()
  const isPacksPage = pathname === "/packs"
  const isUploadPage = pathname === "/upload"
  const isAdminPage = pathname === "/admin"
  const {
    packs,
    packsClient,
    selectedPackIds,
    packPreferences,
    setPackPreferences,
    actionType,
    setActionType,
    actionTypeOptions,
    dateRange,
    setDateRange,
    usePackDates,
    setUsePackDates,
    calculateDateRangeFromPacks,
  } = useFilters()

  // ── Pending pack selection ─────────────────────────────────────────────────
  // pendingPackIds mirrors the visual state of the popover immediately.
  // The store is only updated when the popover closes (onClose).
  const [pendingPackIds, setPendingPackIds] = useState<Set<string>>(() => new Set(selectedPackIds))
  const pendingPackIdsRef = useRef<Set<string>>(new Set(selectedPackIds))
  const packPreferencesRef = useRef(packPreferences)
  const packsRef = useRef(packs)

  // Camada 1 do bloqueio de conflito: grafo de conflito (qualquer dono, desde a 145) p/ desabilitar na selecao.
  // `isUnavailable` = a busca do grafo falhou. Como o bloqueio e a UNICA protecao
  // (a 145 tirou o dedup do read-path de proposito), sem grafo o app fecha a porta:
  // so um pack por vez. Ver usePackConflicts.
  const { conflictMap, isUnavailable: conflictUnknown } = usePackConflicts()
  const conflictMapRef = useRef(conflictMap)
  const conflictUnknownRef = useRef(conflictUnknown)
  const isDirtyRef = useRef(false) // tracks whether pending differs from committed

  useEffect(() => { packPreferencesRef.current = packPreferences }, [packPreferences])
  useEffect(() => { packsRef.current = packs }, [packs])
  useEffect(() => { conflictMapRef.current = conflictMap }, [conflictMap])
  useEffect(() => { conflictUnknownRef.current = conflictUnknown }, [conflictUnknown])

  // Sync pending state when the store changes externally (initial load, syncPacksOnLoad)
  // Only sync when the popover is closed (isDirty=false means no pending local edits)
  useEffect(() => {
    if (!isDirtyRef.current) {
      const next = new Set(selectedPackIds)
      pendingPackIdsRef.current = next
      setPendingPackIds(next)
    }
  }, [selectedPackIds])

  const handleTogglePack = useCallback((packId: string) => {
    const next = new Set(pendingPackIdsRef.current)
    if (next.has(packId)) {
      next.delete(packId)
    } else {
      next.add(packId)
    }
    pendingPackIdsRef.current = next
    isDirtyRef.current = true
    setPendingPackIds(new Set(next))
  }, [])

  // Bulk: marca os packs VISÍVEIS na lista (a busca do popover já filtrou). União com a
  // seleção atual — quem está fora da busca não é tocado. Com a busca vazia, `visibleIds`
  // são todos os packs, então continua sendo "selecionar todos".
  //
  // Packs em conflito ficam de fora, inclusive quando conflitam entre si (o veto
  // visual do popover não pega esse caso — ver selectVisibleRespectingConflicts). Avisamos
  // no toast: pular calado se lê como bug.
  const handleSelectAllPacks = useCallback((visibleIds: string[]) => {
    // FALHA FECHADA: "selecionar todos" e a porta larga — ela nao passa pelo veto
    // visual de item nenhum. Sem grafo, marcar todos e exatamente o estado que o
    // bloqueio existe para impedir, so que de uma vez.
    //
    // Recuso o clique INTEIRO em vez de deixar passar o primeiro (que e o que a
    // regra pura permitiria, e ela segue valendo como rede): "selecionar todos"
    // que marca um pack arbitrario da lista se le como bug, nao como protecao.
    if (conflictUnknownRef.current) {
      showInfo("Não foi possível verificar conflito entre packs agora. Selecione um pack por vez — somar packs que compartilham anúncios daria totais errados.")
      return
    }
    const { next, skipped } = selectVisibleRespectingConflicts(pendingPackIdsRef.current, visibleIds, conflictMapRef.current, { graphUnavailable: conflictUnknownRef.current })
    pendingPackIdsRef.current = next
    isDirtyRef.current = true
    setPendingPackIds(new Set(next))

    if (skipped.length > 0) {
      const nameById = new Map(packsRef.current.map((p) => [p.id, p.name]))
      const label = skipped.length === 1 ? `«${nameById.get(skipped[0]) ?? "1 pack"}» não foi marcado: conflita` : `${skipped.length} packs não foram marcados: conflitam`
      showInfo(`${label} com packs selecionados (mesmos anúncios em contas de donos diferentes).`)
    }
  }, [])

  // Bulk: desmarca só os VISÍVEIS (subtração; ver acima). Chegar a 0 é estado válido —
  // o invariante ≥1 não existe: os hooks de analytics gateiam em size > 0.
  const handleDeselectAllPacks = useCallback((visibleIds: string[]) => {
    const next = deselectVisible(pendingPackIdsRef.current, visibleIds)
    pendingPackIdsRef.current = next
    isDirtyRef.current = true
    setPendingPackIds(new Set(next))
  }, [])

  const handlePackFilterClose = useCallback(() => {
    if (!isDirtyRef.current) return
    isDirtyRef.current = false
    // Build new preferences: keep all existing prefs, overlay current pack visibility
    const newPrefs = { ...packPreferencesRef.current }
    packsRef.current.forEach((p) => {
      newPrefs[p.id] = pendingPackIdsRef.current.has(p.id)
    })
    // Selecionar 0 packs é um estado válido: nenhuma query de analytics dispara
    // (todos os hooks gateiam em selectedPackIds.size > 0) e as páginas apenas
    // renderizam o empty state. Não forçamos ≥1 no commit.
    setPackPreferences(newPrefs)
  }, [setPackPreferences])

  if (!isAuthenticated || isPacksPage || isUploadPage || isAdminPage) return null

  return (
    <div className="hidden md:flex items-center gap-2">
      <PackFilter
        packs={packs}
        conflictMap={conflictMap}
        conflictUnknown={conflictUnknown}
        selectedPackIds={pendingPackIds}
        onTogglePack={handleTogglePack}
        onSelectAll={handleSelectAllPacks}
        onDeselectAll={handleDeselectAllPacks}
        onClose={handlePackFilterClose}
        packsClient={packsClient}
        isLoading={!packsClient || (packsClient && packs.length === 0)}
        showLabel={false}
        singleSelect={false}
      />
      <ActionTypeFilter
        label=""
        value={actionType}
        onChange={setActionType}
        options={actionTypeOptions}
        isLoading={actionTypeOptions.length === 0}
      />
      <DateRangeFilter
        showLabel={false}
        value={dateRange}
        onChange={setDateRange}
        requireConfirmation={true}
        disableFutureDates={true}
        usePackDates={usePackDates}
        onUsePackDatesChange={setUsePackDates}
        showPackDatesSwitch={packsClient && packs.length > 0 && pendingPackIds.size > 0}
        packDatesRange={calculateDateRangeFromPacks ?? null}
      />
    </div>
  )
}

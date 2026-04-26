"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { useFilters } from "@/lib/hooks/useFilters"
import { useClientAuth } from "@/lib/hooks/useClientSession"
import { PackFilter } from "@/components/common/PackFilter"
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
  const isDirtyRef = useRef(false) // tracks whether pending differs from committed

  useEffect(() => { packPreferencesRef.current = packPreferences }, [packPreferences])
  useEffect(() => { packsRef.current = packs }, [packs])

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
      if (next.size <= 1) return // guard: keep at least one selected
      next.delete(packId)
    } else {
      next.add(packId)
    }
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
    setPackPreferences(newPrefs)
  }, [setPackPreferences])

  if (!isAuthenticated || isPacksPage || isUploadPage || isAdminPage) return null

  return (
    <div className="hidden md:flex items-center gap-2">
      <PackFilter
        packs={packs}
        selectedPackIds={pendingPackIds}
        onTogglePack={handleTogglePack}
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

"use client"

import { useMemo, useEffect } from 'react'
import { useFiltersStore } from '@/lib/store/filters'
import { useClientPacks } from '@/lib/hooks/useClientSession'
import type { DateRange } from '@/lib/utils/dateFilters'

/**
 * Public API for global filter state.
 *
 * Wraps useFiltersStore with:
 * - `selectedPackIds` derived from packPreferences
 * - `calculateDateRangeFromPacks` (canonical logic from Manager page)
 * - `effectiveDateRange` — pack dates when usePackDates is active, else manual dateRange
 * - Auto-apply effect: updates dateRange when usePackDates is active and pack selection changes
 * - syncPacksOnLoad effect: keeps preferences in sync as packs change (new/deleted packs)
 */
export function useFilters() {
  const store = useFiltersStore()
  const { packs, isClient: packsClient } = useClientPacks()

  // ── Derived: selectedPackIds from packPreferences ──────────────────────────
  const selectedPackIds = useMemo(
    () =>
      new Set(
        Object.entries(store.packPreferences)
          .filter(([, v]) => v)
          .map(([k]) => k)
      ),
    [store.packPreferences]
  )

  // ── Derived: date range calculated from selected packs ────────────────────
  const calculateDateRangeFromPacks = useMemo((): DateRange | null => {
    if (selectedPackIds.size === 0) return null

    const selectedPacks = packs.filter((p) => selectedPackIds.has(p.id))
    if (selectedPacks.length === 0) return null

    // Single pack: use its dates directly
    if (selectedPacks.length === 1) {
      const { date_start, date_stop } = selectedPacks[0]
      return date_start && date_stop ? { start: date_start, end: date_stop } : null
    }

    // Multiple packs: use earliest start and latest end
    let minStart: string | null = null
    let maxEnd: string | null = null

    selectedPacks.forEach((pack) => {
      if (pack.date_start && (!minStart || pack.date_start < minStart)) minStart = pack.date_start
      if (pack.date_stop && (!maxEnd || pack.date_stop > maxEnd)) maxEnd = pack.date_stop
    })

    return minStart && maxEnd ? { start: minStart, end: maxEnd } : null
  }, [packs, selectedPackIds])

  // ── Derived: effective date range (pack dates override when enabled) ───────
  const effectiveDateRange: DateRange =
    store.usePackDates && calculateDateRangeFromPacks
      ? calculateDateRangeFromPacks
      : store.dateRange

  // ── Effect: auto-apply pack dates when usePackDates is active ─────────────
  useEffect(() => {
    if (!store.usePackDates) return
    if (!calculateDateRangeFromPacks) return
    if (
      store.dateRange.start === calculateDateRangeFromPacks.start &&
      store.dateRange.end === calculateDateRangeFromPacks.end
    )
      return
    store.setDateRange(calculateDateRangeFromPacks)
  }, [store.usePackDates, store.packPreferences, calculateDateRangeFromPacks]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect: sync pack preferences when packs list changes ─────────────────
  useEffect(() => {
    if (!packsClient || packs.length === 0) return
    store.syncPacksOnLoad(packs.map((p) => p.id))
  }, [packsClient, packs.length]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    // State
    packPreferences: store.packPreferences,
    selectedPackIds,
    dateRange: store.dateRange,
    effectiveDateRange,
    actionType: store.actionType,
    usePackDates: store.usePackDates,
    actionTypeOptions: store.actionTypeOptions,
    calculateDateRangeFromPacks,
    // Pack meta
    packs,
    packsClient,
    // Actions
    togglePack: store.togglePack,
    setPackPreferences: store.setPackPreferences,
    setDateRange: store.setDateRange,
    setActionType: store.setActionType,
    setUsePackDates: store.setUsePackDates,
    setActionTypeOptions: store.setActionTypeOptions,
  }
}

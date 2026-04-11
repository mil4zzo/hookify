"use client"

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
 */
export function TopbarFilters() {
  const { isAuthenticated } = useClientAuth()
  const pathname = usePathname()
  const isPacksPage = pathname === "/packs"
  const isUploadPage = pathname === "/upload"
  const {
    packs,
    packsClient,
    selectedPackIds,
    togglePack,
    actionType,
    setActionType,
    actionTypeOptions,
    dateRange,
    setDateRange,
    usePackDates,
    setUsePackDates,
    calculateDateRangeFromPacks,
  } = useFilters()

  if (!isAuthenticated || isPacksPage || isUploadPage) return null

  return (
    <div className="hidden md:flex items-center gap-2">
      <PackFilter
        packs={packs}
        selectedPackIds={selectedPackIds}
        onTogglePack={togglePack}
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
        showPackDatesSwitch={packsClient && packs.length > 0 && selectedPackIds.size > 0}
        packDatesRange={calculateDateRangeFromPacks ?? null}
      />
    </div>
  )
}

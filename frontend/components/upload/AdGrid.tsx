"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import {
  IconCheck,
  IconLoader2,
  IconPhoto,
  IconSearch,
} from "@tabler/icons-react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { PackFilter } from "@/components/common/PackFilter"
import { SearchInputWithClear } from "@/components/common/SearchInputWithClear"
import { useClientPacks } from "@/lib/hooks/useClientSession"
import { useAdsSearch } from "@/lib/hooks/useAdsSearch"
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback"
import type { FlatAd } from "@/lib/api/schemas"

interface AdGridProps {
  selectedAdId?: string | null
  onSelect: (adId: string, adName: string, accountId?: string | null) => void
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

function StatusDot({ status }: { status?: string | null }) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${status === "ACTIVE" ? "bg-success" : "bg-muted-foreground-40"}`}
      title={status ?? ""}
    />
  )
}

function LabeledFilter({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex-1 min-w-0">
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}

const AdRow = memo(function AdRow({
  ad,
  isSelected,
  onSelect,
}: {
  ad: FlatAd
  isSelected: boolean
  onSelect: (adId: string, adName: string, accountId?: string | null) => void
}) {
  const thumbnail = getAdThumbnail(ad) || ad.thumbnail_url || null

  return (
    <button
      type="button"
      onClick={() => onSelect(ad.ad_id, ad.ad_name ?? "", ad.account_id)}
      className={`group flex w-full cursor-pointer items-center gap-3 border-b border-border px-3 py-3 text-left transition-colors hover:bg-muted-40 ${isSelected ? "bg-primary-5 hover:bg-primary-10" : ""}`}
    >
      <div className={`relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border ${isSelected ? "border-primary-40" : "border-border"} bg-muted`}>
        {thumbnail ? (
          <Image
            src={thumbnail}
            alt={ad.ad_name ?? ""}
            fill
            className="object-cover"
            sizes="48px"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <IconPhoto className="h-4 w-4 text-muted-foreground opacity-50" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-1.5">
          <StatusDot status={ad.status} />
          <span className={`truncate text-sm font-medium ${isSelected ? "text-primary" : "text-foreground"}`}>
            {ad.ad_name ?? "Anúncio sem nome"}
          </span>
        </div>
        <div className="truncate text-xs text-muted-foreground">{ad.adset_name ?? "Conjunto sem nome"}</div>
        <div className="truncate text-xs text-muted-foreground opacity-70">{ad.campaign_name ?? "Campanha sem nome"}</div>
      </div>

      <div className={`shrink-0 transition-all ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-30"}`}>
        <div className={`flex h-5 w-5 items-center justify-center rounded-full ${isSelected ? "bg-primary text-primary-foreground" : "border border-border"}`}>
          {isSelected && <IconCheck className="h-3 w-3" />}
        </div>
      </div>
    </button>
  )
})

const AdGrid = memo(function AdGrid({ selectedAdId, onSelect }: AdGridProps) {
  const [qNameOrId, setQNameOrId] = useState("")
  const [qAdset, setQAdset] = useState("")
  const [qCampaign, setQCampaign] = useState("")
  const [selectedPackIds, setSelectedPackIds] = useState<Set<string>>(new Set())
  const packInitialized = useRef(false)

  const dQNameOrId = useDebouncedValue(qNameOrId, 250)
  const dQAdset = useDebouncedValue(qAdset, 250)
  const dQCampaign = useDebouncedValue(qCampaign, 250)

  const { packs, isClient } = useClientPacks()

  useEffect(() => {
    if (!packInitialized.current && packs.length > 0) {
      packInitialized.current = true
      setSelectedPackIds(new Set([packs[0].id]))
    }
  }, [packs])

  const handleTogglePack = useCallback((id: string) => {
    setSelectedPackIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.clear()
        next.add(id)
      }
      return next
    })
  }, [])

  const selectedPackId = selectedPackIds.size > 0 ? [...selectedPackIds][0] : undefined

  const filters = useMemo(
    () => ({
      q: dQNameOrId.trim(),
      q_adset: dQAdset.trim(),
      q_campaign: dQCampaign.trim(),
      pack_id: selectedPackId,
    }),
    [dQNameOrId, dQAdset, dQCampaign, selectedPackId],
  )

  const {
    data,
    isPending,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useAdsSearch(filters)

  const items: FlatAd[] = useMemo(
    () => (data?.pages.flatMap((p) => p.items) ?? []),
    [data],
  )

  const hasTextFilter = !!(dQNameOrId || dQAdset || dQCampaign)
  const hasAnyFilter = hasTextFilter || selectedPackIds.size > 0
  const selectedPackTotal = selectedPackId
    ? (packs.find((p) => p.id === selectedPackId)?.stats?.uniqueAds ?? null)
    : null

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    overscan: 5,
  })

  useEffect(() => {
    const virtualItems = virtualizer.getVirtualItems()
    if (virtualItems.length === 0) return
    const last = virtualItems[virtualItems.length - 1]
    if (last.index >= items.length - 5 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [virtualizer, items.length, hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex gap-2">
        <LabeledFilter label="Pack">
          <PackFilter
            packs={packs}
            selectedPackIds={selectedPackIds}
            onTogglePack={handleTogglePack}
            singleSelect
            showLabel={false}
            packsClient={isClient}
          />
        </LabeledFilter>
        <LabeledFilter label="Anúncio">
          <SearchInputWithClear
            value={qNameOrId}
            onChange={setQNameOrId}
            placeholder="Nome ou ID do anúncio"
          />
        </LabeledFilter>
        <LabeledFilter label="Conjunto">
          <SearchInputWithClear
            value={qAdset}
            onChange={setQAdset}
            placeholder="Nome do conjunto"
          />
        </LabeledFilter>
        <LabeledFilter label="Campanha">
          <SearchInputWithClear
            value={qCampaign}
            onChange={setQCampaign}
            placeholder="Nome da campanha"
          />
        </LabeledFilter>
      </div>

      <div className="flex items-center px-0.5">
        <span className="text-xs text-muted-foreground flex items-center gap-2">
          {isPending ? (
            "Carregando anúncios..."
          ) : (
            <>
              {hasTextFilter
                ? `${items.length}${hasNextPage ? "+" : ""} resultado${items.length !== 1 ? "s" : ""} encontrado${items.length !== 1 ? "s" : ""}`
                : selectedPackTotal !== null
                  ? `${selectedPackTotal} anúncio${selectedPackTotal !== 1 ? "s" : ""} no pack`
                  : `${items.length}${hasNextPage ? "+" : ""} anúncio${items.length !== 1 ? "s" : ""} disponível${items.length !== 1 ? "s" : ""}`}
              {isFetching && !isPending && (
                <IconLoader2 className="h-3 w-3 animate-spin opacity-60" />
              )}
            </>
          )}
        </span>
      </div>

      <div
        ref={scrollRef}
        className="scrollbar-thin max-h-[420px] overflow-y-auto rounded-md border border-border pr-0.5"
      >
        {isPending ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-3">
                <div className="h-12 w-12 shrink-0 animate-pulse rounded-lg bg-muted" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                  <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
                  <div className="h-2.5 w-1/3 animate-pulse rounded bg-muted opacity-70" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <IconSearch className="h-6 w-6 opacity-30" />
            <span>Nenhum anúncio encontrado para essa busca.</span>
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const ad = items[virtualRow.index]
              if (!ad) return null
              return (
                <div
                  key={ad.ad_id}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualRow.start}px)` }}
                >
                  <AdRow ad={ad} isSelected={selectedAdId === ad.ad_id} onSelect={onSelect} />
                </div>
              )
            })}
            {isFetchingNextPage && (
              <div
                style={{ position: "absolute", top: virtualizer.getTotalSize(), left: 0, width: "100%" }}
                className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground"
              >
                <IconLoader2 className="h-3 w-3 animate-spin" />
                Carregando mais…
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
})

export default AdGrid

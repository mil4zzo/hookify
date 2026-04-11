"use client"

import { memo, useCallback, useMemo, useState } from "react"
import { IconCheck, IconSearch, IconX } from "@tabler/icons-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import type { AdsTreeResponse } from "@/lib/api/schemas"

interface AdsetSelectorProps {
  data: AdsTreeResponse
  selectedAdsetIds: string[]
  onChange: (adsetIds: string[]) => void
}

interface FlatAdset {
  adset_id: string
  adset_name: string
  campaign_id: string
  campaign_name: string
  ads_count: number
}

function flattenAdsets(data: AdsTreeResponse): FlatAdset[] {
  const result: FlatAdset[] = []
  for (const campaign of data) {
    for (const adset of campaign.adsets) {
      result.push({
        adset_id: adset.adset_id,
        adset_name: adset.adset_name ?? "Conjunto sem nome",
        campaign_id: campaign.campaign_id,
        campaign_name: campaign.campaign_name ?? "Campanha sem nome",
        ads_count: adset.ads.length,
      })
    }
  }
  return result
}

const AdsetSelector = memo(function AdsetSelector({ data, selectedAdsetIds, onChange }: AdsetSelectorProps) {
  const [query, setQuery] = useState("")
  const normalizedQuery = query.trim().toLowerCase()

  const allAdsets = useMemo(() => flattenAdsets(data), [data])

  const { filtered, grouped } = useMemo(() => {
    const f = !normalizedQuery
      ? allAdsets
      : allAdsets.filter(
          (a) =>
            a.adset_name.toLowerCase().includes(normalizedQuery) ||
            a.campaign_name.toLowerCase().includes(normalizedQuery),
        )
    const map = new Map<string, { campaign_name: string; adsets: FlatAdset[] }>()
    for (const adset of f) {
      if (!map.has(adset.campaign_id)) {
        map.set(adset.campaign_id, { campaign_name: adset.campaign_name, adsets: [] })
      }
      map.get(adset.campaign_id)!.adsets.push(adset)
    }
    return { filtered: f, grouped: Array.from(map.values()) }
  }, [allAdsets, normalizedQuery])

  const toggleAdset = useCallback((adsetId: string) => {
    onChange(
      selectedAdsetIds.includes(adsetId)
        ? selectedAdsetIds.filter((id) => id !== adsetId)
        : [...selectedAdsetIds, adsetId],
    )
  }, [selectedAdsetIds, onChange])

  const selectAll = useCallback(() => {
    onChange(allAdsets.map((a) => a.adset_id))
  }, [allAdsets, onChange])

  const clearAll = useCallback(() => {
    onChange([])
  }, [onChange])

  const allSelected = useMemo(
    () => allAdsets.length > 0 && allAdsets.every((a) => selectedAdsetIds.includes(a.adset_id)),
    [allAdsets, selectedAdsetIds],
  )

  return (
    <div className="flex flex-col gap-3 min-h-0">
      {/* Header + controls */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por conjunto ou campanha…"
            className="pl-9 pr-8"
          />
          {query && (
            <button
              type="button"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setQuery("")}
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={allSelected ? clearAll : selectAll}
          className="shrink-0"
        >
          {allSelected ? "Desmarcar todos" : "Selecionar todos"}
        </Button>
      </div>

      {/* Counter */}
      <div className="flex items-center gap-2 px-0.5">
        <span className="text-xs text-muted-foreground">
          {selectedAdsetIds.length} de {allAdsets.length} conjunto{allAdsets.length !== 1 ? "s" : ""} selecionado{selectedAdsetIds.length !== 1 ? "s" : ""}
        </span>
        {selectedAdsetIds.length > 0 && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-destructive underline-offset-2 hover:underline transition-colors"
            onClick={clearAll}
          >
            Limpar
          </button>
        )}
      </div>

      {/* List — scrollable */}
      <div className="overflow-y-auto max-h-[420px] rounded-xl border border-border scrollbar-thin">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <IconSearch className="h-6 w-6 opacity-30" />
            <span>Nenhum conjunto encontrado.</span>
          </div>
        ) : (
          <div>
            {grouped.map((group, gi) => (
              <div key={group.campaign_name + gi}>
                {/* Campaign header */}
                <div className="sticky top-0 z-10 bg-muted-80 backdrop-blur-sm px-4 py-2 border-b border-border">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide truncate">
                    {group.campaign_name}
                  </span>
                </div>
                {/* Adsets */}
                <div className="divide-y divide-border">
                  {group.adsets.map((adset) => {
                    const isSelected = selectedAdsetIds.includes(adset.adset_id)
                    return (
                      <button
                        key={adset.adset_id}
                        type="button"
                        onClick={() => toggleAdset(adset.adset_id)}
                        className={`group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted-40 cursor-pointer ${isSelected ? "bg-primary-5 hover:bg-primary-10" : ""}`}
                      >
                        {/* Checkbox visual */}
                        <div
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${isSelected ? "border-primary bg-primary" : "border-border group-hover:border-primary-60"}`}
                        >
                          {isSelected && <IconCheck className="h-2.5 w-2.5 text-primary-foreground" />}
                        </div>

                        {/* Info */}
                        <div className="min-w-0 flex-1">
                          <div className={`truncate text-sm font-medium ${isSelected ? "text-primary" : "text-foreground"}`}>
                            {adset.adset_name}
                          </div>
                          {adset.ads_count > 0 && (
                            <div className="text-xs text-muted-foreground">
                              {adset.ads_count} anúncio{adset.ads_count !== 1 ? "s" : ""}
                            </div>
                          )}
                        </div>

                        {/* Selected indicator */}
                        {isSelected && (
                          <span className="shrink-0 text-xs font-medium text-primary">Selecionado</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
})

export default AdsetSelector

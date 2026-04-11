"use client"

import { memo, useMemo, useState } from "react"
import Image from "next/image"
import {
  IconCheck,
  IconPhoto,
  IconSearch,
  IconX,
} from "@tabler/icons-react"
import { Input } from "@/components/ui/input"
import type { AdsTreeResponse } from "@/lib/api/schemas"

interface AdGridProps {
  data: AdsTreeResponse
  selectedAdId?: string | null
  onSelect: (adId: string, adName: string, accountId?: string | null) => void
}

interface FlatAd {
  ad_id: string
  ad_name: string
  account_id?: string | null
  status?: string | null
  thumbnail_url?: string | null
  adset_id: string
  adset_name: string
  campaign_id: string
  campaign_name: string
}

function flattenTree(data: AdsTreeResponse): FlatAd[] {
  const result: FlatAd[] = []
  for (const campaign of data) {
    for (const adset of campaign.adsets) {
      for (const ad of adset.ads) {
        result.push({
          ad_id: ad.ad_id,
          ad_name: ad.ad_name ?? "Anúncio sem nome",
          account_id: ad.account_id,
          status: ad.status,
          thumbnail_url: ad.thumbnail_url,
          adset_id: adset.adset_id,
          adset_name: adset.adset_name ?? "Conjunto sem nome",
          campaign_id: campaign.campaign_id,
          campaign_name: campaign.campaign_name ?? "Campanha sem nome",
        })
      }
    }
  }
  return result
}

function StatusDot({ status }: { status?: string | null }) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${status === "ACTIVE" ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
      title={status ?? ""}
    />
  )
}

function SearchInput({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="relative flex-1 min-w-0">
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground opacity-60" />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-8 pl-8 pr-7 text-xs"
        />
        {value && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => onChange("")}
          >
            <IconX className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}

const AdGrid = memo(function AdGrid({ data, selectedAdId, onSelect }: AdGridProps) {
  const [qNameOrId, setQNameOrId] = useState("")
  const [qAdset, setQAdset] = useState("")
  const [qCampaign, setQCampaign] = useState("")

  const allAds = useMemo(() => flattenTree(data), [data])

  const filtered = useMemo(() => {
    const n = (s: string) => s.trim().toLowerCase()
    const nNameOrId = n(qNameOrId)
    const nAdset = n(qAdset)
    const nCampaign = n(qCampaign)
    if (!nNameOrId && !nAdset && !nCampaign) return allAds
    return allAds.filter(
      (ad) =>
        (!nNameOrId || ad.ad_name.toLowerCase().includes(nNameOrId) || ad.ad_id.toLowerCase().includes(nNameOrId)) &&
        (!nAdset || ad.adset_name.toLowerCase().includes(nAdset)) &&
        (!nCampaign || ad.campaign_name.toLowerCase().includes(nCampaign)),
    )
  }, [allAds, qNameOrId, qAdset, qCampaign])

  const hasAnyFilter = qNameOrId || qAdset || qCampaign

  return (
    <div className="flex flex-col gap-3 min-h-0">
      {/* Search inputs */}
      <div className="flex gap-2">
        <SearchInput label="Anúncio" placeholder="Nome ou ID do anúncio" value={qNameOrId} onChange={setQNameOrId} />
        <SearchInput label="Conjunto" placeholder="Nome do conjunto" value={qAdset} onChange={setQAdset} />
        <SearchInput label="Campanha" placeholder="Nome da campanha" value={qCampaign} onChange={setQCampaign} />
      </div>

      {/* Count */}
      <div className="flex items-center justify-between px-0.5">
        <span className="text-xs text-muted-foreground">
          {hasAnyFilter
            ? `${filtered.length} resultado${filtered.length !== 1 ? "s" : ""} encontrado${filtered.length !== 1 ? "s" : ""}`
            : `${allAds.length} anúncio${allAds.length !== 1 ? "s" : ""} disponível${allAds.length !== 1 ? "s" : ""}`}
        </span>
        {selectedAdId && (
          <span className="flex items-center gap-1 text-xs font-medium text-primary">
            <IconCheck className="h-3 w-3" />
            Modelo selecionado
          </span>
        )}
      </div>

      {/* List — scrollable */}
      <div className="overflow-y-auto max-h-[420px] rounded-xl border border-border pr-0.5 scrollbar-thin">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <IconSearch className="h-6 w-6 opacity-30" />
            <span>Nenhum anúncio encontrado para essa busca.</span>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((ad) => {
              const isSelected = selectedAdId === ad.ad_id
              return (
                <button
                  key={ad.ad_id}
                  type="button"
                  onClick={() => onSelect(ad.ad_id, ad.ad_name, ad.account_id)}
                  className={`group flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted-40 cursor-pointer ${isSelected ? "bg-primary-5 hover:bg-primary-10" : ""}`}
                >
                  {/* Thumbnail */}
                  <div className={`relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border ${isSelected ? "border-primary-40" : "border-border"} bg-muted`}>
                    {ad.thumbnail_url ? (
                      <Image
                        src={ad.thumbnail_url}
                        alt={ad.ad_name}
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

                  {/* Info */}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <StatusDot status={ad.status} />
                      <span className={`truncate text-sm font-medium ${isSelected ? "text-primary" : "text-foreground"}`}>
                        {ad.ad_name}
                      </span>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{ad.adset_name}</div>
                    <div className="truncate text-xs text-muted-foreground opacity-70">{ad.campaign_name}</div>
                  </div>

                  {/* Selected indicator */}
                  <div className={`shrink-0 transition-all ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-30"}`}>
                    <div className={`flex h-5 w-5 items-center justify-center rounded-full ${isSelected ? "bg-primary text-primary-foreground" : "border border-border"}`}>
                      {isSelected && <IconCheck className="h-3 w-3" />}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
})

export default AdGrid

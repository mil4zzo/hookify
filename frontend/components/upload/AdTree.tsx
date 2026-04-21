"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { IconPhoto, IconSearch } from "@tabler/icons-react"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback"
import type { AdsTreeResponse } from "@/lib/api/schemas"

interface AdTreeProps {
  data: AdsTreeResponse
  selectedAdId?: string | null
  onSelect: (adId: string, adName: string, accountId?: string | null) => void
}

export default function AdTree({ data, selectedAdId, onSelect }: AdTreeProps) {
  const [query, setQuery] = useState("")
  const [openCampaignIds, setOpenCampaignIds] = useState<string[]>([])
  const [openAdsetIds, setOpenAdsetIds] = useState<string[]>([])
  const normalizedQuery = query.trim().toLowerCase()

  const filtered = useMemo(() => {
    if (!normalizedQuery) return data
    return data
      .map((campaign) => ({
        ...campaign,
        adsets: campaign.adsets
          .map((adset) => ({
            ...adset,
            ads: adset.ads.filter((ad) => `${ad.ad_name ?? ""}`.toLowerCase().includes(normalizedQuery)),
          }))
          .filter((adset) => adset.ads.length > 0),
      }))
      .filter((campaign) => campaign.adsets.length > 0)
  }, [data, normalizedQuery])

  const queryOpenCampaignIds = useMemo(() => {
    if (!normalizedQuery) return []
    return filtered.map((campaign) => campaign.campaign_id)
  }, [filtered, normalizedQuery])

  const queryOpenAdsetIds = useMemo(() => {
    if (!normalizedQuery) return []
    return filtered.flatMap((campaign) => campaign.adsets.map((adset) => adset.adset_id))
  }, [filtered, normalizedQuery])

  useEffect(() => {
    if (normalizedQuery) return
    setOpenCampaignIds([])
    setOpenAdsetIds([])
  }, [normalizedQuery])

  const visibleCampaignIds = normalizedQuery ? queryOpenCampaignIds : openCampaignIds
  const visibleAdsetIds = normalizedQuery ? queryOpenAdsetIds : openAdsetIds

  return (
    <div className="space-y-4">
      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar anuncio modelo"
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          Nenhum anuncio encontrado para essa busca.
        </div>
      ) : null}

      <Accordion
        type="multiple"
        className="space-y-3"
        value={visibleCampaignIds}
        onValueChange={(values) => {
          if (normalizedQuery) return
          setOpenCampaignIds(values)
        }}
      >
        {filtered.map((campaign) => (
          <AccordionItem key={campaign.campaign_id} value={campaign.campaign_id}>
            <AccordionTrigger>
              <div className="flex min-w-0 flex-col text-left">
                <span className="truncate font-medium">{campaign.campaign_name || "Campanha sem nome"}</span>
                <span className="text-xs text-muted-foreground">{campaign.adsets.length} conjunto(s)</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-3">
              <Accordion
                type="multiple"
                className="space-y-3"
                value={visibleAdsetIds.filter((adsetId) =>
                  campaign.adsets.some((adset) => adset.adset_id === adsetId),
                )}
                onValueChange={(values) => {
                  if (normalizedQuery) return
                  setOpenAdsetIds((current) => {
                    const campaignAdsetIds = campaign.adsets.map((adset) => adset.adset_id)
                    const remaining = current.filter((adsetId) => !campaignAdsetIds.includes(adsetId))
                    return [...remaining, ...values]
                  })
                }}
              >
                {campaign.adsets.map((adset) => (
                  <AccordionItem key={adset.adset_id} value={adset.adset_id}>
                    <AccordionTrigger className="bg-background">
                      <div className="flex min-w-0 flex-col text-left">
                        <span className="truncate text-sm font-medium">{adset.adset_name || "Conjunto sem nome"}</span>
                        <span className="text-xs text-muted-foreground">{adset.ads.length} anuncio(s) disponivel(is)</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-2">
                      {adset.ads.map((ad) => {
                        const isSelected = selectedAdId === ad.ad_id
                        const thumbnail = getAdThumbnail(ad) || ad.thumbnail_url || null
                        return (
                          <div
                            key={ad.ad_id}
                            className={`flex items-center justify-between gap-3 rounded-md border p-3 ${
                              isSelected ? "border-primary bg-primary-5" : "border-border"
                            }`}
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                                {thumbnail ? (
                                  <Image
                                    src={thumbnail}
                                    alt={ad.ad_name || "Thumbnail do anuncio"}
                                    fill
                                    className="object-cover"
                                    sizes="56px"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center">
                                    <IconPhoto className="h-5 w-5 text-muted-foreground" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium">{ad.ad_name || "Anuncio sem nome"}</div>
                                <div className="text-xs text-muted-foreground">{ad.status || "sem status"}</div>
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant={isSelected ? "default" : "outline"}
                              size="sm"
                              onClick={() => onSelect(ad.ad_id, ad.ad_name || "Anuncio sem nome", ad.account_id)}
                            >
                              {isSelected ? "Selecionado" : "Usar modelo"}
                            </Button>
                          </div>
                        )
                      })}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  )
}

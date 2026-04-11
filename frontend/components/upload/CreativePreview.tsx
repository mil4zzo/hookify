"use client"

import Image from "next/image"
import {
  IconBrandInstagram,
  IconExternalLink,
  IconPhoto,
} from "@tabler/icons-react"
import type { AdCreativeDetailResponse } from "@/lib/api/schemas"

interface CreativePreviewProps {
  creative: AdCreativeDetailResponse | null
}

type PreviewSurface = "story" | "feed" | "generic"

function inferPreviewSurface(creative: AdCreativeDetailResponse): PreviewSurface {
  const placements = creative.media_slots.flatMap((slot) => slot.placements_summary).join(" ").toLowerCase()
  const format = `${creative.format ?? ""}`.toLowerCase()
  if (/(story|stories|reels|reel)/.test(placements) || /(story|reels|reel)/.test(format)) return "story"
  if (/(feed|instagram|facebook)/.test(placements) || /(image|video|creative)/.test(format)) return "feed"
  return "generic"
}


function PreviewMedia({ creative, className }: { creative: AdCreativeDetailResponse; className?: string }) {
  if (creative.thumbnail_url) {
    return (
      <div className={`relative overflow-hidden bg-neutral-900 ${className ?? ""}`}>
        <Image
          src={creative.thumbnail_url}
          alt={creative.title || creative.body || "Prévia do anúncio"}
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 300px"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
      </div>
    )
  }
  return (
    <div className={`flex items-center justify-center bg-gradient-to-br from-muted to-muted/50 ${className ?? ""}`}>
      <div className="flex flex-col items-center gap-2 text-muted-foreground opacity-50">
        <IconPhoto className="h-7 w-7" />
        <span className="text-xs">Sem miniatura</span>
      </div>
    </div>
  )
}

function StoryMockup({ creative }: { creative: AdCreativeDetailResponse }) {
  return (
    <div className="mx-auto w-full max-w-[200px]">
      <div className="overflow-hidden rounded-2xl bg-neutral-950 shadow-lg">
        <div className="relative">
          <PreviewMedia creative={creative} className="aspect-[9/16]" />
          <div className="absolute inset-x-0 bottom-0 space-y-2 p-3 text-white">
            {creative.title && (
              <div className="line-clamp-1 text-xs font-semibold">{creative.title}</div>
            )}
            <div className="line-clamp-2 text-xs text-white/80">
              {creative.body || "Texto do anúncio"}
            </div>
            <div className="rounded-full bg-white/20 px-3 py-1 text-center text-xs font-medium backdrop-blur-sm">
              {creative.call_to_action || "Saiba mais"}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function FeedMockup({ creative }: { creative: AdCreativeDetailResponse }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 via-pink-500 to-purple-600 text-white">
          <IconBrandInstagram className="h-3.5 w-3.5" />
        </div>
        <span className="text-xs font-semibold text-gray-800">Instagram</span>
        <span className="ml-auto text-[10px] text-gray-400">Patrocinado</span>
      </div>
      <PreviewMedia creative={creative} className="aspect-square" />
      <div className="space-y-1.5 px-3 py-2.5 text-xs">
        {creative.title && <div className="font-semibold text-gray-900">{creative.title}</div>}
        <div className="line-clamp-2 text-gray-600">{creative.body || "Texto do anúncio"}</div>
        {creative.call_to_action && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-gray-100 px-2.5 py-1.5">
            <span className="font-medium text-gray-800">{creative.call_to_action}</span>
            <IconExternalLink className="h-3 w-3 text-gray-500" />
          </div>
        )}
      </div>
    </div>
  )
}

function GenericMockup({ creative }: { creative: AdCreativeDetailResponse }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
      <PreviewMedia creative={creative} className="aspect-video" />
      <div className="space-y-1.5 p-3 text-xs">
        {creative.title && <div className="font-semibold">{creative.title}</div>}
        <div className="line-clamp-2 text-muted-foreground">{creative.body || "Texto do anúncio"}</div>
      </div>
    </div>
  )
}

export default function CreativePreview({ creative }: CreativePreviewProps) {
  if (!creative) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted-20 p-6 text-center">
        <IconPhoto className="h-8 w-8 text-muted-foreground opacity-30" />
        <div className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">Nenhum anúncio selecionado</div>
          <div className="text-xs text-muted-foreground opacity-60">Selecione um modelo ao lado para ver a prévia</div>
        </div>
      </div>
    )
  }

  const surface = inferPreviewSurface(creative)

  return (
    <div className="space-y-4">
      {/* Mockup */}
      <div className="rounded-2xl bg-gradient-to-b from-muted/60 to-muted/20 p-4">
        {surface === "story" && <StoryMockup creative={creative} />}
        {surface === "feed" && <FeedMockup creative={creative} />}
        {surface === "generic" && <GenericMockup creative={creative} />}
      </div>

      {!creative.supports_bulk_clone && (
        <div className="rounded-xl border border-destructive-20 bg-destructive-5 p-3 text-xs text-destructive">
          Esse modelo ainda não pode ser usado com segurança no upload em massa.
        </div>
      )}
    </div>
  )
}

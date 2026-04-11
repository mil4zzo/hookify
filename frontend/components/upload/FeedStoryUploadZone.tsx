"use client"

import { useRef } from "react"
import {
  IconCircleCheck,
  IconPhoto,
  IconPlus,
  IconVideo,
  IconX,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export interface FeedStoryPair {
  id: string
  feed: File | null
  story: File | null
  adName: string
}

interface FeedStoryUploadZoneProps {
  pairs: FeedStoryPair[]
  onChange: (pairs: FeedStoryPair[]) => void
  requireBothSlots?: boolean
}

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "video/mp4", "video/quicktime"]

function buildDefaultAdName(file: File | null): string {
  if (!file) return ""
  return file.name.replace(/\.[^.]+$/, "")
}

function generateId() {
  return Math.random().toString(36).slice(2, 9)
}

function FileSlot({
  label,
  description,
  file,
  required,
  onFile,
  onClear,
}: {
  label: string
  description: string
  file: File | null
  required: boolean
  onFile: (file: File) => void
  onClear: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const isVideo = file?.type.startsWith("video/")

  return (
    <div className="flex-1 min-w-0">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-xs font-semibold text-foreground">{label}</span>
        {required && <span className="text-[10px] font-medium text-muted-foreground bg-muted rounded px-1 py-0.5">obrigatório</span>}
      </div>
      {file ? (
        <div className="flex items-center gap-2 rounded-lg border border-primary-30 bg-primary-5 px-3 py-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary-10">
            {isVideo
              ? <IconVideo className="h-3.5 w-3.5 text-primary" />
              : <IconPhoto className="h-3.5 w-3.5 text-primary" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-foreground">{file.name}</div>
            <div className="text-[10px] text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</div>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive-10 transition-colors"
            onClick={onClear}
          >
            <IconX className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="group flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-muted-20 px-3 py-4 text-center transition-colors hover:border-primary-60 hover:bg-primary-5 cursor-pointer"
          onClick={() => inputRef.current?.click()}
        >
          <IconPlus className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
          <span className="text-xs text-muted-foreground group-hover:text-primary transition-colors">{description}</span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".jpg,.jpeg,.png,.mp4,.mov"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f && ACCEPTED_TYPES.includes(f.type)) onFile(f)
          e.target.value = ""
        }}
      />
    </div>
  )
}

function PairCard({
  pair,
  index,
  requireBothSlots,
  onUpdate,
  onRemove,
}: {
  pair: FeedStoryPair
  index: number
  requireBothSlots: boolean
  onUpdate: (patch: Partial<FeedStoryPair>) => void
  onRemove: () => void
}) {
  const hasFeed = !!pair.feed
  const hasStory = !!pair.story
  const isComplete = requireBothSlots ? hasFeed && hasStory && !!pair.adName.trim() : (hasFeed || hasStory) && !!pair.adName.trim()
  const hasAnyMedia = hasFeed || hasStory

  return (
    <div className={`rounded-xl border transition-colors ${isComplete ? "border-primary-30 bg-primary-5" : "border-border bg-background"}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2.5">
          {isComplete
            ? <IconCircleCheck className="h-4 w-4 text-primary shrink-0" />
            : <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground text-[10px] font-bold text-muted-foreground opacity-40">{index + 1}</div>
          }
          <span className="text-sm font-semibold">Criativo {index + 1}</span>
          {hasFeed && hasStory && <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5">Feed + Story</Badge>}
          {hasAnyMedia && requireBothSlots && !(hasFeed && hasStory) && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 text-amber-600 border-amber-300">
              Faltando {!hasFeed ? "feed" : "story"}
            </Badge>
          )}
        </div>
        <button
          type="button"
          className="rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive-10 transition-colors"
          onClick={onRemove}
        >
          <IconX className="h-4 w-4" />
        </button>
      </div>

      {/* Media slots */}
      <div className="flex gap-3 px-4 pt-3 pb-2">
        <FileSlot
          label="Feed"
          description={requireBothSlots ? "Quadrado / paisagem" : "Quadrado / paisagem (opcional)"}
          file={pair.feed}
          required={requireBothSlots}
          onFile={(f) => {
            const patch: Partial<FeedStoryPair> = { feed: f }
            if (!pair.adName && !pair.story) patch.adName = buildDefaultAdName(f)
            onUpdate(patch)
          }}
          onClear={() => onUpdate({ feed: null })}
        />
        <FileSlot
          label="Story"
          description={requireBothSlots ? "Vertical 9:16" : "Vertical 9:16 (opcional)"}
          file={pair.story}
          required={requireBothSlots}
          onFile={(f) => {
            const patch: Partial<FeedStoryPair> = { story: f }
            if (!pair.adName && !pair.feed) patch.adName = buildDefaultAdName(f)
            onUpdate(patch)
          }}
          onClear={() => onUpdate({ story: null })}
        />
      </div>

      {/* Ad name */}
      <div className="px-4 pb-4">
        <label className="mb-1.5 block text-xs font-semibold text-foreground">
          Nome do anúncio
        </label>
        <input
          type="text"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary-30 focus:border-primary transition-colors"
          placeholder="Ex: Criativo Verão 01"
          value={pair.adName}
          onChange={(e) => onUpdate({ adName: e.target.value })}
        />
        <p className="mt-1 text-[10px] text-muted-foreground">
          Cada criativo vai gerar uma nova campanha com esse nome como base.
        </p>
      </div>
    </div>
  )
}

export default function FeedStoryUploadZone({ pairs, onChange, requireBothSlots = false }: FeedStoryUploadZoneProps) {
  function addPair() {
    onChange([...pairs, { id: generateId(), feed: null, story: null, adName: "" }])
  }

  function removePair(id: string) {
    onChange(pairs.filter((p) => p.id !== id))
  }

  function updatePair(id: string, patch: Partial<FeedStoryPair>) {
    onChange(pairs.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }

  const completedCount = pairs.filter((p) => {
    const hasMedia = requireBothSlots ? !!p.feed && !!p.story : !!p.feed || !!p.story
    return hasMedia && !!p.adName.trim()
  }).length

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      {pairs.length > 0 && (
        <div className="flex items-center justify-between px-0.5">
          <span className="text-xs text-muted-foreground">
            {completedCount} de {pairs.length} criativo{pairs.length !== 1 ? "s" : ""} pronto{completedCount !== 1 ? "s" : ""}
          </span>
          {completedCount === pairs.length && pairs.length > 0 && (
            <span className="flex items-center gap-1 text-xs font-medium text-primary">
              <IconCircleCheck className="h-3.5 w-3.5" />
              Todos prontos
            </span>
          )}
        </div>
      )}

      {/* Pairs */}
      <div className="space-y-2.5">
        {pairs.map((pair, index) => (
          <PairCard
            key={pair.id}
            pair={pair}
            index={index}
            requireBothSlots={requireBothSlots}
            onUpdate={(patch) => updatePair(pair.id, patch)}
            onRemove={() => removePair(pair.id)}
          />
        ))}
      </div>

      {/* Add button */}
      <button
        type="button"
        className="group flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted-10 py-3 text-sm text-muted-foreground transition-colors hover:border-primary-60 hover:bg-primary-5 hover:text-primary cursor-pointer"
        onClick={addPair}
      >
        <IconPlus className="h-4 w-4 transition-transform group-hover:scale-110" />
        Adicionar criativo
      </button>

      {pairs.length === 0 && (
        <p className="text-center text-xs text-muted-foreground opacity-60 pt-1">
          Cada criativo gera uma nova campanha duplicada.
        </p>
      )}
    </div>
  )
}

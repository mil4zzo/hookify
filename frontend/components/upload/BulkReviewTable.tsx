"use client"

import { memo, useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { IconTrash } from "@tabler/icons-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export interface BulkReviewRowItem {
  id: string
  fileIndex?: number
  fileName?: string
  bundleId?: string
  bundleName?: string
  slotFiles?: Record<string, number>
  sourceLabel: string
  sourceDetails?: string
  adsetId: string
  adsetName: string
  adName: string
  status: "ACTIVE" | "PAUSED"
}

interface BulkReviewTableProps {
  items: BulkReviewRowItem[]
  onNameChange: (id: string, value: string) => void
  onRemove: (id: string) => void
  onStatusChange: (id: string, value: "ACTIVE" | "PAUSED") => void
}

const ReviewRow = memo(function ReviewRow({
  item,
  onNameChange,
  onRemove,
  onStatusChange,
}: {
  item: BulkReviewRowItem
  onNameChange: (id: string, value: string) => void
  onRemove: (id: string) => void
  onStatusChange: (id: string, value: "ACTIVE" | "PAUSED") => void
}) {
  return (
    <div className="grid grid-cols-[1.1fr_1fr_1.6fr_0.9fr_56px] items-center gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <div className="truncate text-sm">{item.sourceLabel}</div>
        {item.sourceDetails ? <div className="truncate text-xs text-muted-foreground">{item.sourceDetails}</div> : null}
      </div>
      <div className="truncate text-sm">{item.adsetName}</div>
      <Input value={item.adName} onChange={(event) => onNameChange(item.id, event.target.value)} />
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={item.status === "ACTIVE" ? "default" : "outline"}
          onClick={() => onStatusChange(item.id, "ACTIVE")}
        >
          ACTIVE
        </Button>
        <Button
          type="button"
          size="sm"
          variant={item.status === "PAUSED" ? "default" : "outline"}
          onClick={() => onStatusChange(item.id, "PAUSED")}
        >
          PAUSED
        </Button>
      </div>
      <div className="text-right">
        <Button type="button" variant="ghost" size="icon" onClick={() => onRemove(item.id)} aria-label={`Remover ${item.adName}`}>
          <IconTrash className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
})

export default function BulkReviewTable({ items, onNameChange, onRemove, onStatusChange }: BulkReviewTableProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    overscan: 8,
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{items.length} combinacao(oes)</div>
        <Badge variant="secondary">Virtualizado</Badge>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="grid grid-cols-[1.1fr_1fr_1.6fr_0.9fr_56px] gap-3 bg-muted-40 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <div>Origem</div>
          <div>Conjunto</div>
          <div>Nome do anuncio</div>
          <div>Status</div>
          <div className="text-right">Acao</div>
        </div>
        <div ref={scrollRef} className="max-h-[420px] overflow-auto">
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = items[virtualRow.index]
              return (
                <div
                  key={item.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <ReviewRow
                    item={item}
                    onNameChange={onNameChange}
                    onRemove={onRemove}
                    onStatusChange={onStatusChange}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

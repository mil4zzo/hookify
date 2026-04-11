"use client"

import { useMemo } from "react"
import { IconCheck, IconLoader2, IconX } from "@tabler/icons-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import type { BulkAdItemProgress, BulkAdProgressResponse } from "@/lib/api/schemas"

interface BulkProgressListProps {
  progress: BulkAdProgressResponse
}

function StatusBadge({ item }: { item: BulkAdItemProgress }) {
  if (item.status === "success") {
    return (
      <Badge className="gap-1 bg-emerald-600">
        <IconCheck className="h-3 w-3" />
        Sucesso
      </Badge>
    )
  }
  if (item.status === "error") {
    return (
      <Badge variant="destructive" className="gap-1">
        <IconX className="h-3 w-3" />
        Erro
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <IconLoader2 className="h-3 w-3 animate-spin" />
      {item.status}
    </Badge>
  )
}

export default function BulkProgressList({ progress }: BulkProgressListProps) {
  const grouped = useMemo(() => {
    return progress.items.reduce<Record<string, BulkAdItemProgress[]>>((acc, item) => {
      const groupKey = item.bundle_name || item.file_name
      if (!acc[groupKey]) acc[groupKey] = []
      acc[groupKey].push(item)
      return acc
    }, {})
  }, [progress.items])

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Progresso do job</div>
            <div className="text-xs text-muted-foreground">{progress.message}</div>
          </div>
          <Badge variant="secondary">{progress.status}</Badge>
        </div>
        <Progress value={progress.progress} />
        <div className="grid gap-3 sm:grid-cols-4">
          <Card className="p-3"><div className="text-xs text-muted-foreground">Total</div><div className="text-2xl font-semibold">{progress.summary.total}</div></Card>
          <Card className="p-3"><div className="text-xs text-muted-foreground">Sucesso</div><div className="text-2xl font-semibold">{progress.summary.success}</div></Card>
          <Card className="p-3"><div className="text-xs text-muted-foreground">Erros</div><div className="text-2xl font-semibold">{progress.summary.error}</div></Card>
          <Card className="p-3"><div className="text-xs text-muted-foreground">Pendentes</div><div className="text-2xl font-semibold">{progress.summary.pending}</div></Card>
        </div>
      </Card>

      {Object.entries(grouped).map(([fileName, items]) => (
        <Card key={fileName} className="space-y-3 p-4">
          <div className="text-sm font-semibold">{fileName}</div>
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{item.ad_name}</div>
                  <div className="text-xs text-muted-foreground">{item.adset_name || item.adset_id}</div>
                  {item.error_message ? <div className="mt-1 text-xs text-destructive">{item.error_message}</div> : null}
                </div>
                <StatusBadge item={item} />
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}

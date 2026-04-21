"use client"

import { useMemo, useState } from "react"
import {
  IconAlertCircle,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconExternalLink,
  IconLoader2,
  IconX,
} from "@tabler/icons-react"
import type { BulkAdItemProgress, BulkAdProgressResponse, AdCreativeDetailResponse } from "@/lib/api/schemas"

const ADS_PIPELINE = ["pending", "uploading_media", "creating_creative", "creating_ad", "success"]
const CAMPAIGN_PIPELINE = ["pending", "uploading_media", "creating_creative", "creating_campaign", "creating_adsets", "success"]

const GENERAL_STATUSES = new Set(["pending"])
const TERMINAL_ITEM_STATUSES = new Set(["success", "error", "skipped"])

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function extractPlacementLabels(raw: string): string[] {
  const normalized = raw.toLowerCase()
  const labels: string[] = []
  if (/feed|stream|profile feed|video feed|instagram|facebook/.test(normalized)) labels.push("Feed")
  if (/stor/.test(normalized)) labels.push("Story")
  if (/reel/.test(normalized)) labels.push("Reels")
  return unique(labels)
}

function formatPlacementList(labels: string[]): string {
  if (labels.length <= 1) return labels[0] || ""
  if (labels.length === 2) return `${labels[0]} e ${labels[1]}`
  return `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`
}

function getCurrentItemLabel(items: Array<{ ad_name: string; status: string }>): string | null {
  if (!items.length) return null
  const currentIndex = items.findIndex((item) => !GENERAL_STATUSES.has(item.status) && !TERMINAL_ITEM_STATUSES.has(item.status))
  const fallbackIndex = items.findIndex((item) => !TERMINAL_ITEM_STATUSES.has(item.status))
  const index = currentIndex >= 0 ? currentIndex : fallbackIndex
  if (index < 0) return null
  return `Subindo anúncio ${index + 1} de ${items.length}: ${items[index].ad_name}`
}

function getUploadLabel(
  slotKeys: string[] | undefined,
  creative: AdCreativeDetailResponse | null | undefined,
): string {
  if (!slotKeys?.length || !creative) return "Subindo mídia no Meta..."

  const placements = slotKeys
    .map((slotKey) => {
      const slot = creative.media_slots.find((candidate) => candidate.slot_key === slotKey)
      if (!slot) return null
      return [
        ...extractPlacementLabels(slot.primary_placement || ""),
        ...slot.placements_summary.flatMap((summary) => extractPlacementLabels(summary)),
      ]
    })
    .flat()
    .filter((label): label is string => !!label)

  const ordered = ["Feed", "Story", "Reels"].filter((label) => placements.includes(label))
  if (!ordered.length) return "Subindo mídia no Meta..."
  return `Subindo ${formatPlacementList(ordered)} no Meta...`
}

function getStepLabel(
  step: string,
  opts: {
    errorMessage?: string | null
    slotKeys?: string[]
    creative?: AdCreativeDetailResponse | null
    indexInGroup: number
    groupSize: number
  },
): string {
  switch (step) {
    case "pending":
      return "Aguardando na fila"
    case "uploading_media":
      return getUploadLabel(opts.slotKeys, opts.creative)
    case "creating_creative":
      return "Criando criativo..."
    case "creating_campaign":
      return "Criando campanha..."
    case "creating_adsets":
      return `Criando conjunto ${opts.indexInGroup} de ${opts.groupSize}...`
    case "creating_ad":
      return "Transformando em anúncio..."
    case "success":
      return "Concluído"
    case "error":
      return opts.errorMessage ? `Erro: ${opts.errorMessage}` : "Erro desconhecido"
    default:
      return step
  }
}

export interface ProgressItemCardProps {
  adName: string
  adsetName?: string | null
  status: string
  errorMessage?: string | null
  errorDetails?: Record<string, unknown> | null
  metaAdId?: string | null
  pipeline: string[]
  slotKeys?: string[]
  creative?: AdCreativeDetailResponse | null
  indexInGroup: number
  groupSize: number
  autoExpand?: boolean
}

export function ProgressItemCard({
  adName,
  adsetName,
  status,
  errorMessage,
  errorDetails,
  metaAdId,
  pipeline,
  slotKeys,
  creative,
  indexInGroup,
  groupSize,
  autoExpand = false,
}: ProgressItemCardProps) {
  const [expanded, setExpanded] = useState(autoExpand)

  const isDone = status === "success"
  const isError = status === "error"
  const isPending = GENERAL_STATUSES.has(status)
  const isActive = !isDone && !isError && !isPending

  const currentPipelineIdx = pipeline.indexOf(status)
  const labelOpts = { errorMessage, slotKeys, creative, indexInGroup, groupSize }
  const currentLabel = getStepLabel(status, labelOpts)

  const borderClass = isDone
    ? "border-success-30 bg-success-5"
    : isError
      ? "border-destructive-30 bg-destructive-5"
      : isActive
        ? "border-primary-30 bg-primary-5"
        : "border-border bg-muted-10"

  return (
    <div className={`rounded-xl border transition-colors ${borderClass}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isDone ? "bg-success-10" : isError ? "bg-destructive-10" : isActive ? "bg-primary-10" : "bg-muted"
        }`}>
          {isDone && <IconCheck className="h-3.5 w-3.5 text-success-600" />}
          {isError && <IconX className="h-3.5 w-3.5 text-destructive" />}
          {isActive && <IconLoader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
          {isPending && <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground-30" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{adName}</div>
          <div className={`flex items-center gap-1.5 text-xs ${
            isDone ? "text-success-600" : isError ? "text-destructive" : isActive ? "text-primary" : "text-muted-foreground"
          }`}>
            {isActive && <IconLoader2 className="h-3 w-3 shrink-0 animate-spin" />}
            <span className="truncate">{currentLabel}</span>
          </div>
        </div>

        {isDone && metaAdId && (
          <a
            href={`https://www.facebook.com/adsmanager/manage/ads?act=&selected_ad_ids=${metaAdId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
            title="Ver no Meta Ads Manager"
          >
            <IconExternalLink className="h-3.5 w-3.5" />
          </a>
        )}

        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
            expanded
              ? "border-border bg-muted text-foreground"
              : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {expanded ? (
            <>Ocultar <IconChevronUp className="h-3 w-3" /></>
          ) : (
            <>Detalhes <IconChevronDown className="h-3 w-3" /></>
          )}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border-60 px-4 pb-4 pt-3">
          {adsetName && (
            <p className="mb-3 text-[11px] text-muted-foreground">{adsetName}</p>
          )}

          {isError ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-destructive-20 bg-destructive-5 px-3 py-2.5">
              <IconAlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-xs text-destructive">{errorMessage || "Erro desconhecido"}</p>
                {errorDetails && (
                  <div className="space-y-0.5 border-t border-destructive-20 pt-1.5">
                    {errorDetails.error_subcode != null && (
                      <p className="text-[10px] text-destructive-70">subcode: {String(errorDetails.error_subcode)}</p>
                    )}
                    {!!errorDetails.fbtrace_id && (
                      <p className="break-all font-mono text-[10px] text-destructive-70">trace: {String(errorDetails.fbtrace_id)}</p>
                    )}
                    {!!errorDetails.type && (
                      <p className="text-[10px] text-destructive-70">type: {String(errorDetails.type)}</p>
                    )}
                    {Array.isArray(errorDetails.error_blame_field_specs) && errorDetails.error_blame_field_specs.length > 0 && (
                      <p className="break-all text-[10px] text-destructive-70">blame: {JSON.stringify(errorDetails.error_blame_field_specs)}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {pipeline.filter((step) => step !== "error").map((step, index) => {
                const isStepDone = isDone || index < currentPipelineIdx
                const isStepCurrent = !isDone && index === currentPipelineIdx
                const isStepUpcoming = !isDone && index > currentPipelineIdx

                return (
                  <div key={step} className="flex items-center gap-2.5">
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                      {isStepDone && <IconCheck className="h-4 w-4 text-success-600" />}
                      {isStepCurrent && <IconLoader2 className="h-4 w-4 animate-spin text-primary" />}
                      {isStepUpcoming && <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground-40" />}
                    </div>

                    <span className={`text-xs ${
                      isStepDone
                        ? "font-medium text-success-600"
                        : isStepCurrent
                          ? "font-semibold text-primary"
                          : "text-muted-foreground-50"
                    }`}>
                      {getStepLabel(step, labelOpts)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface BulkProgressListProps {
  progress: BulkAdProgressResponse
  creative?: AdCreativeDetailResponse | null
}

export default function BulkProgressList({ progress, creative }: BulkProgressListProps) {
  const { summary, items } = progress

  const isCompleted = progress.status === "completed"
  const isFailed = progress.status === "failed"
  const isCancelled = progress.status === "cancelled"
  const isTerminal = isCompleted || isFailed || isCancelled
  const pct = progress.progress

  const grouped = useMemo(() => {
    return items.reduce<Record<string, BulkAdItemProgress[]>>((accumulator, item) => {
      const key = item.bundle_name || item.file_name
      if (!accumulator[key]) accumulator[key] = []
      accumulator[key].push(item)
      return accumulator
    }, {})
  }, [items])

  const pipeline = items.some(
    (item) => item.status === "creating_campaign" || item.status === "creating_adsets",
  ) ? CAMPAIGN_PIPELINE : ADS_PIPELINE
  const currentItemLabel = getCurrentItemLabel(items)

  return (
    <div className="space-y-4">
      {summary.total > 1 && (
        <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
          <div className="flex items-center gap-3 border-b border-border px-5 py-4">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              isCompleted ? "bg-success-10" : isFailed ? "bg-destructive-10" : isCancelled ? "bg-muted" : "bg-primary-10"
            }`}>
              {isCompleted && <IconCheck className="h-5 w-5 text-success-600" />}
              {isFailed && <IconAlertCircle className="h-5 w-5 text-destructive" />}
              {isCancelled && <IconX className="h-5 w-5 text-muted-foreground" />}
              {!isTerminal && <IconLoader2 className="h-5 w-5 animate-spin text-primary" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">
                {isCompleted ? "Upload concluído!" : isFailed ? "Erro no upload" : isCancelled ? "Cancelado" : currentItemLabel || "Criando anúncios..."}
              </div>
              <div className="text-xs text-muted-foreground">
                {summary.success} de {summary.total} anúncios criados
              </div>
            </div>
            <div className="shrink-0 text-2xl font-bold tabular-nums text-primary">{pct}%</div>
          </div>

          <div className="h-1.5 bg-muted">
            <div
              className={`h-full transition-all duration-500 ${
                isCompleted ? "bg-success" : isFailed ? "bg-destructive" : isCancelled ? "bg-muted-foreground-30" : "bg-primary"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>

          <div className="grid grid-cols-3 divide-x divide-border text-center">
            {[
              { label: "Criados", value: summary.success, color: "text-success-600" },
              { label: "Erros", value: summary.error, color: summary.error > 0 ? "text-destructive" : "" },
              { label: "Pendentes", value: summary.pending, color: "" },
            ].map(({ label, value, color }) => (
              <div key={label} className="py-3">
                <div className={`text-xl font-bold tabular-nums ${color}`}>{value}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {Object.entries(grouped).map(([, groupItems]) =>
          groupItems.map((item, index) => (
            <ProgressItemCard
              key={item.id}
              adName={item.ad_name}
              adsetName={item.adset_name}
              status={item.status}
              errorMessage={item.error_message}
              errorDetails={item.error_details}
              metaAdId={item.meta_ad_id}
              pipeline={pipeline}
              slotKeys={item.slot_files ? Object.keys(item.slot_files) : undefined}
              creative={creative}
              indexInGroup={index + 1}
              groupSize={groupItems.length}
              autoExpand={item.status === "error" || summary.total === 1}
            />
          )),
        )}
      </div>
    </div>
  )
}

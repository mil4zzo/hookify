"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheck,
  IconLoader2,
  IconX,
  IconAlertCircle,
  IconCopy,
  IconPhoto,
} from "@tabler/icons-react"
import { api } from "@/lib/api/endpoints"
import { useBulkCreate } from "@/lib/hooks/useBulkCreate"
import { useCampaignBulkCreate } from "@/lib/hooks/useCampaignBulkCreate"
import { useActiveJobsStore } from "@/lib/store/activeJobs"
import type {
  AdsTreeResponse,
  AdCreativeDetailResponse,
  BulkAdConfig,
  CampaignTemplateResponse,
  CampaignBulkConfig,
} from "@/lib/api/schemas"
import type { BulkReviewRowItem } from "@/components/upload/BulkReviewTable"
import type { BundleDraft, BundlePoolFile } from "@/components/upload/BundleUploadZone"
import type { FeedStoryPair } from "@/components/upload/FeedStoryUploadZone"
import type { CampaignReviewItem } from "@/components/upload/CampaignReviewTable"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { PageContainer } from "@/components/common/PageContainer"
import { TabbedContent, TabbedContentItem, type TabItem } from "@/components/common/TabbedContent"
import AdGrid from "@/components/upload/AdGrid"
import CreativePreview from "@/components/upload/CreativePreview"

const FileUploadZone = dynamic(() => import("@/components/upload/FileUploadZone"), {
  loading: () => <Skeleton className="h-64 w-full" />,
})
const AdsetSelector = dynamic(() => import("@/components/upload/AdsetSelector"), {
  loading: () => <Skeleton className="h-64 w-full" />,
})
const BulkReviewTable = dynamic(() => import("@/components/upload/BulkReviewTable"), {
  loading: () => <Skeleton className="h-96 w-full" />,
})
const BundleUploadZone = dynamic(() => import("@/components/upload/BundleUploadZone"), {
  loading: () => <Skeleton className="h-96 w-full" />,
})
const BulkProgressList = dynamic(() => import("@/components/upload/BulkProgressList"), {
  loading: () => <Skeleton className="h-80 w-full" />,
})
const FeedStoryUploadZone = dynamic(() => import("@/components/upload/FeedStoryUploadZone"), {
  loading: () => <Skeleton className="h-80 w-full" />,
})
const CampaignReviewTable = dynamic(() => import("@/components/upload/CampaignReviewTable"), {
  loading: () => <Skeleton className="h-96 w-full" />,
})

const stepsAds = [
  { id: 1, label: "Modelo", description: "Escolha o anúncio base" },
  { id: 2, label: "Mídias", description: "Adicione os arquivos" },
  { id: 3, label: "Conjuntos", description: "Onde publicar" },
  { id: 4, label: "Revisão", description: "Confirme e crie" },
]

const stepsCampaign = [
  { id: 1, label: "Modelo", description: "Escolha o anúncio base" },
  { id: 2, label: "Criativos", description: "Adicione feed e story" },
  { id: 3, label: "Conjuntos", description: "Quais conjuntos replicar" },
  { id: 4, label: "Revisão", description: "Confirme e crie" },
]

function buildDefaultAdName(templateName: string, fileName: string, adsetName: string) {
  const fileBase = fileName.replace(/\.[^/.]+$/, "")
  return `${templateName} - ${fileBase} - ${adsetName}`
}

function buildDefaultBundleAdName(templateName: string, bundleName: string, adsetName: string) {
  return `${templateName} - ${bundleName} - ${adsetName}`
}

function createEmptyBundleDraft(slotKeys: string[], index: number): BundleDraft {
  return {
    id: `bundle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: `Bundle ${index}`,
    slotFiles: Object.fromEntries(slotKeys.map((slotKey) => [slotKey, null])),
  }
}

function isBundleComplete(bundle: BundleDraft, requiredSlotKeys: string[]) {
  if (!bundle.name.trim()) return false
  return requiredSlotKeys.every((slotKey) => !!bundle.slotFiles[slotKey])
}

function parseBundleName(fileName: string) {
  const match = fileName.match(/^(.+?)__([^.]+)\.[^.]+$/)
  if (!match) return null
  return { bundleName: match[1], slotKey: match[2] }
}

function generateId() {
  return Math.random().toString(36).slice(2, 9)
}

function buildCampaignTreeForSelector(template: CampaignTemplateResponse): AdsTreeResponse {
  return [
    {
      campaign_id: template.campaign_id,
      campaign_name: template.campaign_name,
      status: "ACTIVE",
      adsets: template.adsets.map((a) => ({
        adset_id: a.id,
        adset_name: a.name,
        status: a.status ?? "ACTIVE",
        ads: [],
      })),
    },
  ]
}

// ── Skeletons ─────────────────────────────────────────────────────────────────

function AdGridSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {/* Search bar */}
      <div className="flex gap-2">
        <Skeleton className="h-9 w-32 shrink-0" />
        <Skeleton className="h-9 flex-1" />
      </div>
      {/* Count line */}
      <Skeleton className="h-3.5 w-24" />
      {/* List */}
      <div className="rounded-xl border border-border overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-3 border-b border-border last:border-0">
            <Skeleton className="h-12 w-12 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-1.5 min-w-0">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-2/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CampaignPreviewSkeleton({ mode }: { mode: "ads" | "campaign" }) {
  return (
    <div className="space-y-3">
      {/* Creative name badge */}
      <Skeleton className="h-5 w-28" />
      {/* Video preview */}
      <div className="rounded-2xl bg-gradient-to-b from-muted/60 to-muted/20 p-4 flex justify-center">
        <Skeleton className="w-[200px] aspect-[9/16] rounded-2xl" />
      </div>
      {/* Campaign structure card — only in campaign mode */}
      {mode === "campaign" && (
        <div className="rounded-xl border border-border bg-background p-4 space-y-3">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-4 w-48" />
          <div className="space-y-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="h-1 w-1 rounded-full bg-muted-foreground/20 shrink-0" />
                <Skeleton className="h-3 w-40" />
              </div>
            ))}
          </div>
          <Skeleton className="h-3 w-36 mt-2" />
        </div>
      )}
    </div>
  )
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({
  steps,
  currentStep,
  onStepClick,
}: {
  steps: { id: number; label: string; description: string }[]
  currentStep: number
  onStepClick?: (stepId: number) => void
}) {
  return (
    <div className="flex items-center gap-0">
      {steps.map((step, index) => {
        const isDone = step.id < currentStep
        const isActive = step.id === currentStep
        return (
          <div key={step.id} className="flex items-center">
            <button
              type="button"
              disabled={!onStepClick}
              onClick={() => onStepClick?.(step.id)}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${
                isActive
                  ? "bg-primary-10 text-primary"
                  : isDone
                  ? "text-primary-400 hover:bg-muted-50 cursor-pointer"
                  : "text-muted-foreground opacity-50 cursor-default"
              }`}
            >
              <div
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : isDone
                    ? "bg-primary-20 text-primary"
                    : "bg-muted text-muted-foreground opacity-50 border border-border"
                }`}
              >
                {isDone ? <IconCheck className="h-3 w-3" /> : step.id}
              </div>
              <div className="hidden sm:block">
                <div className={`text-sm font-semibold leading-none ${isActive ? "" : ""}`}>{step.label}</div>
                <div className="mt-0.5 text-[10px] leading-none opacity-70">{step.description}</div>
              </div>
            </button>
            {index < steps.length - 1 && (
              <div className={`h-px w-6 shrink-0 transition-colors ${step.id < currentStep ? "bg-primary-30" : "bg-border"}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Mode toggle ───────────────────────────────────────────────────────────────

// ── Campaign progress view ────────────────────────────────────────────────────

const STEP_LABELS: Record<string, string> = {
  pending: "Na fila",
  uploading_media: "Enviando mídia",
  creating_creative: "Criando criativo",
  creating_campaign: "Criando campanha",
  creating_adsets: "Criando conjuntos",
  creating_ad: "Criando anúncio",
  success: "Concluído",
  error: "Erro",
}

const STEP_ORDER = [
  "pending",
  "uploading_media",
  "creating_creative",
  "creating_campaign",
  "creating_adsets",
  "creating_ad",
  "success",
]

function stepIndex(status: string) {
  const idx = STEP_ORDER.indexOf(status)
  return idx === -1 ? 0 : idx
}

function CampaignProgressItemRow({ item }: { item: { id: string; ad_name: string; status: string; error_message?: string | null } }) {
  const isDone = item.status === "success"
  const isError = item.status === "error"
  const isActive = !isDone && !isError && item.status !== "pending"

  return (
    <div className={`rounded-xl border px-4 py-3 transition-colors ${isDone ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/20" : isError ? "border-destructive-30 bg-destructive-5" : isActive ? "border-primary-30 bg-primary-5" : "border-border bg-muted-10"}`}>
      <div className="flex items-center gap-3">
        {/* Icon */}
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isDone ? "bg-emerald-100 dark:bg-emerald-900/40" : isError ? "bg-destructive-10" : isActive ? "bg-primary-10" : "bg-muted"}`}>
          {isDone && <IconCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
          {isError && <IconX className="h-4 w-4 text-destructive" />}
          {isActive && <IconLoader2 className="h-4 w-4 animate-spin text-primary" />}
          {!isDone && !isError && !isActive && <div className="h-2 w-2 rounded-full bg-muted-foreground opacity-30" />}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{item.ad_name}</div>
          {isError && item.error_message ? (
            <div className="mt-0.5 text-xs text-destructive">{item.error_message}</div>
          ) : (
            <div className={`text-xs ${isDone ? "text-emerald-600 dark:text-emerald-400" : isActive ? "text-primary" : "text-muted-foreground"}`}>
              {STEP_LABELS[item.status] ?? item.status}
            </div>
          )}
        </div>

        {/* Step mini progress dots (only when active or done) */}
        {!isError && (
          <div className="hidden sm:flex items-center gap-1 shrink-0">
            {STEP_ORDER.filter((s) => s !== "pending").map((s) => {
              const sIdx = stepIndex(item.status)
              const thisIdx = stepIndex(s)
              const done = isDone || thisIdx < sIdx
              const active = !isDone && thisIdx === sIdx
              return (
                <div
                  key={s}
                  title={STEP_LABELS[s]}
                  className={`h-1.5 rounded-full transition-all ${active ? "w-4 bg-primary" : done ? "w-1.5 bg-emerald-500" : "w-1.5 bg-muted-foreground opacity-20"}`}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function CampaignProgressView({
  progress,
  isCreating,
  onCancel,
}: {
  progress: import("@/lib/api/schemas").CampaignBulkProgressResponse
  isCreating: boolean
  onCancel: () => void
}) {
  const { summary, message, items } = progress
  const pct = summary.total > 0
    ? Math.round(((summary.success + summary.error) / summary.total) * 100)
    : progress.progress
  const isCompleted = progress.status === "completed"
  const isFailed = progress.status === "failed"
  const isCancelled = progress.status === "cancelled"
  const isTerminal = isCompleted || isFailed || isCancelled

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="rounded-2xl border border-border bg-background shadow-sm overflow-hidden">
        {/* Top: status + message */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${isCompleted ? "bg-emerald-100 dark:bg-emerald-900/40" : isFailed ? "bg-destructive-10" : "bg-primary-10"}`}>
            {isCompleted && <IconCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />}
            {isFailed && <IconAlertCircle className="h-5 w-5 text-destructive" />}
            {isCancelled && <IconX className="h-5 w-5 text-muted-foreground" />}
            {!isTerminal && <IconLoader2 className="h-5 w-5 animate-spin text-primary" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">
              {isCompleted ? "Criação concluída!" : isFailed ? "Erro na criação" : isCancelled ? "Cancelado" : "Criando campanhas…"}
            </div>
            <div className="text-xs text-muted-foreground truncate">{message}</div>
          </div>
          <div className="text-2xl font-bold tabular-nums text-primary shrink-0">{pct}%</div>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-muted">
          <div
            className={`h-full transition-all duration-500 ${isCompleted ? "bg-emerald-500" : isFailed ? "bg-destructive" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Summary counters */}
        <div className="grid grid-cols-4 divide-x divide-border text-center">
          {[
            { label: "Total", value: summary.total, color: "" },
            { label: "Concluídos", value: summary.success, color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Erros", value: summary.error, color: summary.error > 0 ? "text-destructive" : "" },
            { label: "Pendentes", value: summary.pending, color: "" },
          ].map(({ label, value, color }) => (
            <div key={label} className="py-3">
              <div className={`text-xl font-bold tabular-nums ${color}`}>{value}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Item list */}
      <div className="space-y-2">
        {items.map((item) => (
          <CampaignProgressItemRow key={item.id} item={item} />
        ))}
      </div>

      {/* Actions */}
      {isCreating && (
        <Button type="button" variant="outline" size="sm" onClick={onCancel} className="gap-1.5">
          <IconX className="h-3.5 w-3.5" />
          Cancelar job
        </Button>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function UploadPage() {
  // ── shared ──────────────────────────────────────────────────────────────────
  const [uploadMode, setUploadMode] = useState<"ads" | "campaign">("campaign")
  const [currentStep, setCurrentStep] = useState<number>(1)
  const [treeData, setTreeData] = useState<AdsTreeResponse>([])
  const [selectedTemplateAdId, setSelectedTemplateAdId] = useState<string | null>(null)
  const [selectedTemplateAdName, setSelectedTemplateAdName] = useState<string>("")
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [isLoadingCreative, setIsLoadingCreative] = useState(false)
  const [isLoadingTree, setIsLoadingTree] = useState(true)

  // ── ads mode ────────────────────────────────────────────────────────────────
  const [creative, setCreative] = useState<AdCreativeDetailResponse | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [bundleUploadMode, setBundleUploadMode] = useState<"visual" | "filename">("visual")
  const [bundleFilePool, setBundleFilePool] = useState<BundlePoolFile[]>([])
  const [bundleDrafts, setBundleDrafts] = useState<BundleDraft[]>([])
  const [bundleParseErrors, setBundleParseErrors] = useState<string[]>([])
  const [selectedAdsetIds, setSelectedAdsetIds] = useState<string[]>([])
  const [reviewItems, setReviewItems] = useState<BulkReviewRowItem[]>([])
  const { isCreating, progress, startBulkCreate, retryFailed, cancelBulkCreate, resumePolling } = useBulkCreate()

  // ── campaign mode ────────────────────────────────────────────────────────────
  const [campaignTemplate, setCampaignTemplate] = useState<CampaignTemplateResponse | null>(null)
  const [feedStoryPairs, setFeedStoryPairs] = useState<FeedStoryPair[]>([{ id: generateId(), feed: null, story: null, adName: "" }])
  const [campaignSelectedAdsetIds, setCampaignSelectedAdsetIds] = useState<string[]>([])
  const [campaignReviewItems, setCampaignReviewItems] = useState<CampaignReviewItem[]>([])
  const [campaignNameTemplate, setCampaignNameTemplate] = useState<string>("{ad_name}")
  const [adsetNameTemplate, setAdsetNameTemplate] = useState<string>("{ad_name}")
  const [campaignBudget, setCampaignBudget] = useState<number | null>(null)
  const { isCreating: isCampaignCreating, progress: campaignProgress, startCampaignBulk, cancelCampaignBulk } = useCampaignBulkCreate()

  // ── derived ──────────────────────────────────────────────────────────────────
  const adsetMap = useMemo(() => {
    const entries = new Map<string, string>()
    treeData.forEach((campaign) => {
      campaign.adsets.forEach((adset) => {
        entries.set(adset.adset_id, adset.adset_name || "Conjunto sem nome")
      })
    })
    return entries
  }, [treeData])

  const isMultiSlotTemplate = !!creative?.is_multi_slot
  const requiredSlotKeys = useMemo(
    () => (creative?.media_slots || []).filter((slot) => slot.required).map((slot) => slot.slot_key),
    [creative],
  )
  const completeBundles = useMemo(
    () => (!isMultiSlotTemplate ? [] : bundleDrafts.filter((bundle) => isBundleComplete(bundle, requiredSlotKeys))),
    [bundleDrafts, isMultiSlotTemplate, requiredSlotKeys],
  )
  const allBundlesComplete = useMemo(
    () => isMultiSlotTemplate && bundleDrafts.length > 0 && bundleDrafts.every((bundle) => isBundleComplete(bundle, requiredSlotKeys)),
    [bundleDrafts, isMultiSlotTemplate, requiredSlotKeys],
  )

  const campaignTreeForSelector = useMemo(
    () => (campaignTemplate ? buildCampaignTreeForSelector(campaignTemplate) : []),
    [campaignTemplate],
  )

  const campaignRequiresBothSlots = useMemo(
    () => uploadMode === "campaign" && !!creative?.is_multi_slot,
    [uploadMode, creative],
  )

  const campaignTemplateUnsupportedSlots = useMemo(
    () => uploadMode === "campaign" && (creative?.media_slots?.length ?? 0) > 2,
    [uploadMode, creative],
  )

  const validPairs = useMemo(
    () =>
      feedStoryPairs.filter((p) => {
        if (!p.adName.trim()) return false
        if (campaignRequiresBothSlots) return !!p.feed && !!p.story
        return !!p.feed || !!p.story
      }),
    [feedStoryPairs, campaignRequiresBothSlots],
  )

  const hasIncompleteCampaignPairs = useMemo(
    () =>
      feedStoryPairs.some((p) => {
        const hasAnyInput = !!p.adName.trim() || !!p.feed || !!p.story
        if (!hasAnyInput) return false
        if (campaignRequiresBothSlots) return !(p.adName.trim() && p.feed && p.story)
        return !p.adName.trim() || !(p.feed || p.story)
      }),
    [feedStoryPairs, campaignRequiresBothSlots],
  )

  // ── effects ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function checkForActiveJob() {
      const activeJobIds = Array.from(useActiveJobsStore.getState().activeJobIds)
      for (const activeJobId of activeJobIds) {
        try {
          const jobProgress = await api.bulkAds.getProgress(activeJobId)
          if (jobProgress.items?.length) return activeJobId
        } catch { /* ignore stale jobs */ }
      }
      return null
    }

    Promise.all([api.bulkAds.getAdsTree(), checkForActiveJob()]).then(async ([tree, activeJobId]) => {
      setTreeData(tree)
      setIsLoadingTree(false)
      if (activeJobId) {
        setCurrentStep(4)
        await resumePolling(activeJobId)
      }
    })
  }, [resumePolling])

  // review items for ads mode
  useEffect(() => {
    if (!selectedTemplateAdName || selectedAdsetIds.length === 0) { setReviewItems([]); return }
    let nextItems: BulkReviewRowItem[] = []
    if (isMultiSlotTemplate) {
      if (completeBundles.length === 0) { setReviewItems([]); return }
      nextItems = completeBundles.flatMap((bundle) =>
        selectedAdsetIds.map((adsetId) => ({
          id: `${bundle.id}-${adsetId}`,
          bundleId: bundle.id,
          bundleName: bundle.name,
          sourceLabel: bundle.name,
          sourceDetails: `${requiredSlotKeys.length} slot(s) preenchido(s)`,
          adsetId,
          adsetName: adsetMap.get(adsetId) || "Conjunto sem nome",
          adName: buildDefaultBundleAdName(selectedTemplateAdName, bundle.name, adsetMap.get(adsetId) || "Conjunto sem nome"),
          status: "PAUSED" as const,
        })),
      )
    } else {
      if (files.length === 0) { setReviewItems([]); return }
      nextItems = files.flatMap((file, fileIndex) =>
        selectedAdsetIds.map((adsetId) => ({
          id: `${fileIndex}-${adsetId}`,
          fileIndex,
          fileName: file.name,
          sourceLabel: file.name,
          adsetId,
          adsetName: adsetMap.get(adsetId) || "Conjunto sem nome",
          adName: buildDefaultAdName(selectedTemplateAdName, file.name, adsetMap.get(adsetId) || "Conjunto sem nome"),
          status: "PAUSED" as const,
        })),
      )
    }
    setReviewItems(nextItems)
  }, [selectedTemplateAdName, files, selectedAdsetIds, adsetMap, isMultiSlotTemplate, completeBundles, requiredSlotKeys])

  // review items for campaign mode
  useEffect(() => {
    if (!campaignTemplate || validPairs.length === 0 || campaignSelectedAdsetIds.length === 0) {
      setCampaignReviewItems([])
      return
    }
    setCampaignReviewItems(
      validPairs.map((pair) => ({
        id: pair.id,
        adName: pair.adName,
        feedFileName: pair.feed?.name,
        storyFileName: pair.story?.name,
        status: "ACTIVE" as const,
      })),
    )
  }, [campaignTemplate, validPairs, campaignSelectedAdsetIds])

  useEffect(() => {
    if (!isMultiSlotTemplate || bundleUploadMode !== "filename") {
      if (bundleUploadMode !== "filename") setBundleParseErrors([])
      return
    }
    const slotMap = new Map((creative?.media_slots || []).map((slot) => [slot.slot_key, slot]))
    const nextBundles = new Map<string, BundleDraft>()
    const nextErrors: string[] = []
    for (const poolEntry of bundleFilePool) {
      const parsed = parseBundleName(poolEntry.file.name)
      if (!parsed) { nextErrors.push(`Arquivo fora do padrão: ${poolEntry.file.name}`); continue }
      const slot = slotMap.get(parsed.slotKey)
      if (!slot) { nextErrors.push(`slot_key inválido no arquivo ${poolEntry.file.name}: ${parsed.slotKey}`); continue }
      if (slot.media_type !== poolEntry.mediaType) { nextErrors.push(`Tipo de mídia inválido para ${poolEntry.file.name}; esperado ${slot.media_type}`); continue }
      const existing = nextBundles.get(parsed.bundleName) || createEmptyBundleDraft(Array.from(slotMap.keys()), nextBundles.size + 1)
      existing.id = `bundle-${parsed.bundleName}`
      existing.name = parsed.bundleName
      if (existing.slotFiles[parsed.slotKey]) { nextErrors.push(`Bundle ${parsed.bundleName} possui arquivo duplicado para o slot ${parsed.slotKey}`); continue }
      existing.slotFiles[parsed.slotKey] = poolEntry.id
      nextBundles.set(parsed.bundleName, existing)
    }
    setBundleDrafts(Array.from(nextBundles.values()))
    setBundleParseErrors(nextErrors)
  }, [bundleFilePool, bundleUploadMode, creative, isMultiSlotTemplate])

  useEffect(() => {
    if (!isMultiSlotTemplate || bundleUploadMode !== "visual") return
    if (bundleDrafts.length > 0) return
    const slotKeys = (creative?.media_slots || []).map((slot) => slot.slot_key)
    if (slotKeys.length === 0) return
    setBundleDrafts([createEmptyBundleDraft(slotKeys, 1)])
  }, [bundleDrafts.length, bundleUploadMode, creative, isMultiSlotTemplate])

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!isCreating && !isCampaignCreating) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [isCreating, isCampaignCreating])

  const failedItemIds = useMemo(
    () => progress?.items.filter((item) => item.status === "error").map((item) => item.id) || [],
    [progress],
  )

  // ── review item mutation handlers (stable refs so ReviewRow memo holds) ───────
  const handleReviewNameChange = useCallback((id: string, value: string) => {
    setReviewItems((prev) => prev.map((item) => (item.id === id ? { ...item, adName: value } : item)))
  }, [])

  const handleReviewRemove = useCallback((id: string) => {
    setReviewItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const handleReviewStatusChange = useCallback((id: string, value: "ACTIVE" | "PAUSED") => {
    setReviewItems((prev) => prev.map((item) => (item.id === id ? { ...item, status: value } : item)))
  }, [])

  const handleCampaignItemChange = useCallback((id: string, patch: Partial<CampaignReviewItem>) => {
    setCampaignReviewItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }, [])

  const handleCampaignRemove = useCallback((id: string) => {
    setCampaignReviewItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  // ── handlers ──────────────────────────────────────────────────────────────────
  const switchMode = useCallback(function switchMode(mode: "ads" | "campaign") {
    setUploadMode(mode)
    setCurrentStep(1)
    setSelectedTemplateAdId(null)
    setSelectedTemplateAdName("")
    setSelectedAccountId(null)
    setCreative(null)
    setFiles([])
    setBundleFilePool([])
    setBundleDrafts([])
    setBundleParseErrors([])
    setSelectedAdsetIds([])
    setReviewItems([])
    setCampaignTemplate(null)
    setFeedStoryPairs([{ id: generateId(), feed: null, story: null, adName: "" }])
    setCampaignSelectedAdsetIds([])
    setCampaignReviewItems([])
    setCampaignNameTemplate("{ad_name}")
    setAdsetNameTemplate("{ad_name}")
    setCampaignBudget(null)
  }, [])

  const handleBundleModeChange = useCallback(function handleBundleModeChange(mode: "visual" | "filename") {
    setBundleUploadMode(mode)
    setBundleFilePool([])
    setBundleDrafts(
      mode === "visual" && creative?.media_slots?.length
        ? [createEmptyBundleDraft(creative.media_slots.map((slot) => slot.slot_key), 1)]
        : [],
    )
    setBundleParseErrors([])
  }, [creative?.media_slots])

  const handleTemplateSelect = useCallback(async function handleTemplateSelect(adId: string, adName: string, accountId?: string | null) {
    // Optimistic update: mark selected immediately before any async call
    setSelectedTemplateAdId(adId)
    setSelectedTemplateAdName(adName)
    setSelectedAccountId(accountId || null)
    setCreative(null)
    setIsLoadingCreative(true)
    setFiles([])
    setBundleFilePool([])
    setBundleDrafts([])
    setBundleParseErrors([])
    setSelectedAdsetIds([])
    setReviewItems([])
    setCampaignTemplate(null)
    setCampaignSelectedAdsetIds([])
    setCurrentStep(1)

    try {
      if (uploadMode === "campaign") {
        const template = await api.campaignBulk.getCampaignTemplate(adId)
        setCampaignTemplate(template)
        setCampaignNameTemplate(`Cópia de ${template.campaign_name}`)
        setAdsetNameTemplate("Cópia de {template_adset_name} - {ad_name} - [{index}]")
        setCampaignBudget(template.campaign_daily_budget ?? null)
        // Pre-select all template adsets
        setCampaignSelectedAdsetIds(template.adsets.map((a) => a.id))
        const preview = await api.bulkAds.getAdCreative(adId)
        setCreative(preview)
      } else {
        const preview = await api.bulkAds.getAdCreative(adId)
        setCreative(preview)
        // Pre-select all adsets from the same campaign as the template
        const campaignAdsetIds: string[] = []
        for (const campaign of treeData) {
          const found = campaign.adsets.some((adset) => adset.ads.some((ad) => ad.ad_id === adId))
          if (found) {
            campaign.adsets.forEach((adset) => campaignAdsetIds.push(adset.adset_id))
            break
          }
        }
        if (campaignAdsetIds.length > 0) setSelectedAdsetIds(campaignAdsetIds)
      }
    } finally {
      setIsLoadingCreative(false)
    }
  }, [uploadMode, treeData])

  async function handleStartAds() {
    if (!selectedTemplateAdId || !selectedAccountId || reviewItems.length === 0) return
    if (!isMultiSlotTemplate) {
      const config: BulkAdConfig = {
        template_ad_id: selectedTemplateAdId,
        account_id: selectedAccountId,
        status: "PAUSED",
        bundle_strategy: "legacy_single_file",
        items: reviewItems.map((item) => ({
          file_index: item.fileIndex,
          adset_id: item.adsetId,
          adset_name: item.adsetName,
          ad_name: item.adName,
        })),
      }
      await startBulkCreate(files, config)
      return
    }

    const fileMap = new Map(bundleFilePool.map((entry) => [entry.id, entry.file]))
    const usedFileIds = Array.from(
      new Set(completeBundles.flatMap((bundle) => Object.values(bundle.slotFiles).filter((v): v is string => !!v))),
    )
    const orderedFiles = usedFileIds.map((fileId) => fileMap.get(fileId)).filter((file): file is File => !!file)
    const fileIndexById = new Map(usedFileIds.map((fileId, index) => [fileId, index]))
    const bundleMap = new Map(completeBundles.map((bundle) => [bundle.id, bundle]))

    const config: BulkAdConfig = {
      template_ad_id: selectedTemplateAdId,
      account_id: selectedAccountId,
      status: "PAUSED",
      bundle_strategy: "explicit_bundles",
      items: reviewItems.map((item) => {
        const bundle = bundleMap.get(item.bundleId || "")
        const slotFiles = Object.fromEntries(
          Object.entries(bundle?.slotFiles || {}).map(([slotKey, fileId]) => [slotKey, fileIndexById.get(fileId || "") ?? -1]),
        )
        return { bundle_id: bundle?.id, bundle_name: bundle?.name, slot_files: slotFiles, adset_id: item.adsetId, adset_name: item.adsetName, ad_name: item.adName }
      }),
    }
    await startBulkCreate(orderedFiles, config)
  }

  async function handleStartCampaign() {
    if (!selectedTemplateAdId || !selectedAccountId || campaignReviewItems.length === 0 || campaignSelectedAdsetIds.length === 0) return

    const allFiles: File[] = []
    const fileIndexMap = new Map<string, number>()

    validPairs.forEach((pair) => {
      if (pair.feed) {
        fileIndexMap.set(`${pair.id}-feed`, allFiles.length)
        allFiles.push(pair.feed)
      }
      if (pair.story) {
        fileIndexMap.set(`${pair.id}-story`, allFiles.length)
        allFiles.push(pair.story)
      }
    })

    const config: CampaignBulkConfig = {
      template_ad_id: selectedTemplateAdId,
      account_id: selectedAccountId,
      status: campaignReviewItems[0]?.status ?? "ACTIVE",
      adset_ids: campaignSelectedAdsetIds,
      campaign_name_template: campaignNameTemplate,
      adset_name_template: adsetNameTemplate,
      campaign_budget_override: campaignBudget ?? undefined,
      items: campaignReviewItems.map((item) => {
        const pair = validPairs.find((p) => p.id === item.id)
        return {
          ad_name: item.adName,
          feed_file_index: pair?.feed ? fileIndexMap.get(`${pair.id}-feed`) : undefined,
          story_file_index: pair?.story ? fileIndexMap.get(`${pair.id}-story`) : undefined,
        }
      }),
    }

    await startCampaignBulk(allFiles, config)
  }

  // ── navigation ────────────────────────────────────────────────────────────────
  const steps = uploadMode === "campaign" ? stepsCampaign : stepsAds

  const step2Ready = uploadMode === "campaign"
    ? validPairs.length > 0 && !hasIncompleteCampaignPairs
    : (!isMultiSlotTemplate && files.length > 0) || (isMultiSlotTemplate && allBundlesComplete && bundleParseErrors.length === 0)

  const step3Ready = uploadMode === "campaign"
    ? campaignSelectedAdsetIds.length > 0
    : selectedAdsetIds.length > 0

  const step1Ready = uploadMode === "ads"
    ? !!selectedTemplateAdId && !!creative && !!creative.supports_bulk_clone
    : !!selectedTemplateAdId && !!campaignTemplate && !!creative && !!creative.supports_bulk_clone && !campaignTemplateUnsupportedSlots

  const isAnyCreating = isCreating || isCampaignCreating

  const canGoNext =
    (currentStep === 1 && step1Ready) ||
    (currentStep === 2 && step2Ready) ||
    (currentStep === 3 && step3Ready) ||
    false

  const canCreate = uploadMode === "campaign"
    ? campaignReviewItems.length > 0 && !isAnyCreating && !campaignProgress
    : reviewItems.length > 0 && !isAnyCreating && !progress

  const uploadTabs: TabItem[] = [
    { value: "campaign", label: "Duplicar campanha", icon: IconCopy },
    { value: "ads", label: "Criar anúncios", icon: IconPhoto },
  ]

  const navActions = (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={currentStep === 1 || isAnyCreating}
        onClick={() => setCurrentStep((prev) => prev - 1)}
        className="gap-1.5"
      >
        <IconChevronLeft className="h-4 w-4" />
        Voltar
      </Button>

      {currentStep < 4 ? (
        <Button
          type="button"
          size="sm"
          disabled={!canGoNext}
          onClick={() => setCurrentStep((prev) => prev + 1)}
          className="gap-1.5"
        >
          Continuar
          <IconChevronRight className="h-4 w-4" />
        </Button>
      ) : uploadMode === "campaign" ? (
        <Button
          type="button"
          size="sm"
          disabled={!canCreate}
          onClick={() => void handleStartCampaign()}
          className="gap-1.5"
        >
          {isCampaignCreating
            ? "Criando…"
            : `Criar ${campaignReviewItems.length} campanha${campaignReviewItems.length !== 1 ? "s" : ""}`}
          {!isCampaignCreating && <IconCircleCheck className="h-4 w-4" />}
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          disabled={!canCreate}
          onClick={() => void handleStartAds()}
          className="gap-1.5"
        >
          {isCreating
            ? "Criando…"
            : `Criar ${reviewItems.length} anúncio${reviewItems.length !== 1 ? "s" : ""}`}
          {!isCreating && <IconCircleCheck className="h-4 w-4" />}
        </Button>
      )}
    </div>
  )

  return (
    <PageContainer
      title="Upload em Massa"
      description="Crie ou duplique anúncios e campanhas em lote"
      actions={navActions}
    >
      <TabbedContent
        value={uploadMode}
        onValueChange={switchMode as (v: string) => void}
        tabs={uploadTabs}
        separatorAfterTabs={true}
      >
      {/* ── Content area (shared between tabs) ── */}
      <TabbedContentItem value={uploadMode} className="space-y-6">

        {/* Step breadcrumb */}
        <StepIndicator steps={steps} currentStep={currentStep} onStepClick={(id) => { if (id < currentStep) setCurrentStep(id) }} />

        {/* Step 1: Template selection */}
        {currentStep === 1 && (
          <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
            {/* Left: ad grid */}
            <div className="space-y-3">
              {isLoadingTree ? (
                <AdGridSkeleton />
              ) : (
                <AdGrid
                  data={treeData}
                  selectedAdId={selectedTemplateAdId}
                  onSelect={handleTemplateSelect}
                />
              )}
            </div>

            {/* Right: preview */}
            <div className="space-y-3">
              <h2 className="text-base font-semibold">Prévia do modelo</h2>
              {isLoadingCreative ? (
                <CampaignPreviewSkeleton mode={uploadMode} />
              ) : uploadMode === "ads" ? (
                <CreativePreview creative={creative} />
              ) : campaignTemplate ? (
                <div className="space-y-3">
                  {campaignTemplateUnsupportedSlots && (
                    <Card className="border-destructive-40 bg-destructive-5 p-4 text-sm text-destructive">
                      Template com mais de 2 slots não é suportado em duplicação de campanhas. Selecione outro.
                    </Card>
                  )}
                  <CreativePreview creative={creative} />
                  {/* Campaign structure */}
                  <div className="rounded-xl border border-border bg-background p-4 space-y-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Estrutura da campanha</div>
                    <div className="text-sm font-medium truncate">{campaignTemplate.campaign_name}</div>
                    <div className="space-y-1">
                      {campaignTemplate.adsets.map((adset) => (
                        <div key={adset.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <div className="h-1 w-1 rounded-full bg-muted-foreground/40 shrink-0" />
                          <span className="truncate">{adset.name}</span>
                        </div>
                      ))}
                    </div>
                    <div className="text-[10px] text-muted-foreground border-t border-border pt-2">
                      {campaignTemplate.adsets.length} conjunto(s) · {campaignTemplate.campaign_objective ?? "objetivo desconhecido"}
                    </div>
                  </div>
                </div>
              ) : (
                <CreativePreview creative={null} />
              )}
            </div>
          </div>
        )}

        {/* Step 2: Media upload */}
        {currentStep === 2 && (
          <div className="space-y-3">
            {uploadMode === "campaign" ? (
              <FeedStoryUploadZone
                pairs={feedStoryPairs}
                onChange={setFeedStoryPairs}
                requireBothSlots={campaignRequiresBothSlots}
              />
            ) : isMultiSlotTemplate ? (
              <BundleUploadZone
                mediaSlots={creative?.media_slots || []}
                mode={bundleUploadMode}
                onModeChange={handleBundleModeChange}
                filePool={bundleFilePool}
                bundles={bundleDrafts}
                parseErrors={bundleParseErrors}
                onFilePoolChange={setBundleFilePool}
                onBundlesChange={setBundleDrafts}
              />
            ) : (
              <FileUploadZone files={files} onFilesChange={setFiles} />
            )}
          </div>
        )}

        {/* Step 3: Adset selection */}
        {currentStep === 3 && (
          <div className="space-y-3">
            {uploadMode === "campaign" ? (
              <AdsetSelector
                data={campaignTreeForSelector}
                selectedAdsetIds={campaignSelectedAdsetIds}
                onChange={setCampaignSelectedAdsetIds}
              />
            ) : (
              <AdsetSelector
                data={treeData}
                selectedAdsetIds={selectedAdsetIds}
                onChange={setSelectedAdsetIds}
              />
            )}
          </div>
        )}

        {/* Step 4: Review / Progress */}
        {currentStep === 4 && (
          <div className="space-y-4">
            {/* Ads mode progress */}
            {progress && uploadMode === "ads" ? (
              <div className="space-y-4">
                <BulkProgressList progress={progress} />
                <div className="flex flex-wrap gap-3">
                  {isCreating && (
                    <Button type="button" variant="outline" onClick={() => void cancelBulkCreate()}>
                      Cancelar job
                    </Button>
                  )}
                  {progress.status === "completed" && failedItemIds.length > 0 && (
                    <Button type="button" onClick={() => void retryFailed(progress.job_id, failedItemIds)}>
                      Tentar novamente ({failedItemIds.length} falha(s))
                    </Button>
                  )}
                </div>
              </div>
            ) : campaignProgress && uploadMode === "campaign" ? (
              /* Campaign mode progress */
              <CampaignProgressView
                progress={campaignProgress}
                isCreating={isCampaignCreating}
                onCancel={() => void cancelCampaignBulk()}
              />
            ) : uploadMode === "campaign" ? (
              /* Campaign review */
              <div className="space-y-3">
                <CampaignReviewTable
                  items={campaignReviewItems}
                  campaignNameTemplate={campaignNameTemplate}
                  adsetNameTemplate={adsetNameTemplate}
                  campaignBudget={campaignBudget}
                  onItemChange={handleCampaignItemChange}
                  onRemove={handleCampaignRemove}
                  onCampaignNameTemplateChange={setCampaignNameTemplate}
                  onAdsetNameTemplateChange={setAdsetNameTemplate}
                  onBudgetChange={setCampaignBudget}
                />
              </div>
            ) : (
              /* Ads review */
              <div className="space-y-3">
                <BulkReviewTable
                  items={reviewItems}
                  onNameChange={handleReviewNameChange}
                  onRemove={handleReviewRemove}
                  onStatusChange={handleReviewStatusChange}
                />
              </div>
            )}
          </div>
        )}
      </TabbedContentItem>
      </TabbedContent>
    </PageContainer>
  )
}

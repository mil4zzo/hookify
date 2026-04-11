"use client"

import { useState } from "react"
import { IconAlertTriangle, IconPhoto, IconTrash, IconVideo } from "@tabler/icons-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

const AD_NAME_VAR = "{ad_name}"
const INDEX_VAR = "{index}"
const TEMPLATE_ADSET_NAME_VAR = "{template_adset_name}"

export interface CampaignReviewItem {
  id: string
  adName: string
  feedFileName?: string
  storyFileName?: string
  status: "ACTIVE" | "PAUSED"
}

interface CampaignReviewTableProps {
  items: CampaignReviewItem[]
  campaignNameTemplate: string
  adsetNameTemplate: string
  campaignBudget: number | null
  onItemChange: (id: string, patch: Partial<CampaignReviewItem>) => void
  onRemove: (id: string) => void
  onCampaignNameTemplateChange: (value: string) => void
  onAdsetNameTemplateChange: (value: string) => void
  onBudgetChange: (value: number | null) => void
}

function interpolate(template: string, adName: string, index: number, templateAdsetName = "{conjunto}"): string {
  return template
    .replace(TEMPLATE_ADSET_NAME_VAR, templateAdsetName)
    .replace(AD_NAME_VAR, adName)
    .replace(INDEX_VAR, String(index))
}

function templateHasAdNameVar(template: string): boolean {
  return template.includes(AD_NAME_VAR)
}

function FileInfo({ name }: { name?: string }) {
  if (!name) return null
  const isVideo = /\.(mp4|mov|avi|webm)$/i.test(name)
  return (
    <div className="flex items-center gap-1.5 truncate">
      {isVideo
        ? <IconVideo className="h-3 w-3 shrink-0 text-muted-foreground" />
        : <IconPhoto className="h-3 w-3 shrink-0 text-muted-foreground" />}
      <span className="truncate text-xs text-muted-foreground">{name}</span>
    </div>
  )
}

export default function CampaignReviewTable({
  items,
  campaignNameTemplate,
  adsetNameTemplate,
  campaignBudget,
  onItemChange,
  onRemove,
  onCampaignNameTemplateChange,
  onAdsetNameTemplateChange,
  onBudgetChange,
}: CampaignReviewTableProps) {
  const [globalStatus, setGlobalStatus] = useState<"ACTIVE" | "PAUSED">("ACTIVE")

  function applyGlobalStatus(status: "ACTIVE" | "PAUSED") {
    setGlobalStatus(status)
    items.forEach((item) => onItemChange(item.id, { status }))
  }

  const hasVarIssue = (item: CampaignReviewItem) =>
    (templateHasAdNameVar(campaignNameTemplate) || templateHasAdNameVar(adsetNameTemplate)) && !item.adName.trim()

  return (
    <div className="space-y-5">
      {/* Global config — grouped logically */}
      <div className="rounded-xl border border-border bg-background overflow-hidden">
        <div className="border-b border-border bg-muted-30 px-4 py-3">
          <div className="text-sm font-semibold">Configurações globais</div>
          <div className="text-xs text-muted-foreground mt-0.5">Aplicadas a todas as campanhas duplicadas</div>
        </div>

        <div className="p-4 space-y-4">
          {/* Naming — top to bottom: campanha → conjunto */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Nome da campanha</label>
              <Input
                value={campaignNameTemplate}
                onChange={(e) => onCampaignNameTemplateChange(e.target.value)}
                placeholder="Ex: Cópia de {ad_name}"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Nome do conjunto</label>
              <Input
                value={adsetNameTemplate}
                onChange={(e) => onAdsetNameTemplateChange(e.target.value)}
                placeholder="Ex: Cópia de {template_adset_name} - {ad_name} - [{index}]"
              />
            </div>

            {/* Shared variable legend */}
            <div className="rounded-lg border border-border bg-muted-20 px-3 py-2.5 space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Variáveis disponíveis</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span className="text-[11px] text-muted-foreground">
                  <code className="rounded bg-muted px-1 py-0.5 font-mono">{AD_NAME_VAR}</code>
                  {" — "}nome do criativo (feed/story)
                </span>
                <span className="text-[11px] text-muted-foreground">
                  <code className="rounded bg-muted px-1 py-0.5 font-mono">{TEMPLATE_ADSET_NAME_VAR}</code>
                  {" — "}nome do conjunto original
                </span>
                <span className="text-[11px] text-muted-foreground">
                  <code className="rounded bg-muted px-1 py-0.5 font-mono">{INDEX_VAR}</code>
                  {" — "}numeração automática
                </span>
              </div>
            </div>
          </div>

          {/* Budget + status */}
          <div className="flex flex-wrap items-end gap-4 pt-1 border-t border-border">
            <div className="space-y-1.5 flex-1 min-w-[180px]">
              <label className="text-xs font-semibold text-foreground">Orçamento diário (R$)</label>
              <Input
                type="number"
                min={0}
                step={0.01}
                placeholder="Deixe vazio para herdar do modelo"
                value={campaignBudget !== null ? (campaignBudget / 100).toFixed(2) : ""}
                onChange={(e) => {
                  const raw = parseFloat(e.target.value)
                  onBudgetChange(isNaN(raw) ? null : Math.round(raw * 100))
                }}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Status ao criar</label>
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={globalStatus === "ACTIVE" ? "default" : "outline"}
                  className="h-9"
                  onClick={() => applyGlobalStatus("ACTIVE")}
                >
                  Ativo
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={globalStatus === "PAUSED" ? "default" : "outline"}
                  className="h-9"
                  onClick={() => applyGlobalStatus("PAUSED")}
                >
                  Pausado
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Items table */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="border-b border-border bg-muted-30 px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="text-sm font-semibold">
            {items.length} campanha{items.length !== 1 ? "s" : ""} a criar
          </div>
          {items.some((i) => hasVarIssue(i)) && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600 font-medium">
              <IconAlertTriangle className="h-3.5 w-3.5" />
              Alguns criativos estão sem nome
            </div>
          )}
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[1fr_2fr_1.4fr_auto_32px] gap-3 border-b border-border bg-muted-10 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <div>Arquivos</div>
          <div>Nome da campanha (preview)</div>
          <div>Nome do anúncio</div>
          <div>Status</div>
          <div />
        </div>

        {items.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nenhum criativo adicionado. Volte ao passo anterior.
          </div>
        )}

        {/* Rows */}
        <div className="divide-y divide-border">
          {items.map((item, itemIndex) => {
            const campaignPreview = interpolate(campaignNameTemplate || AD_NAME_VAR, item.adName || "…", itemIndex + 1)
            const warn = hasVarIssue(item)

            return (
              <div
                key={item.id}
                className="grid grid-cols-[1fr_2fr_1.4fr_auto_32px] items-center gap-3 px-4 py-3"
              >
                {/* Files */}
                <div className="min-w-0 space-y-0.5">
                  <FileInfo name={item.feedFileName} />
                  <FileInfo name={item.storyFileName} />
                  {!item.feedFileName && !item.storyFileName && (
                    <span className="text-xs italic text-muted-foreground opacity-60">sem arquivo</span>
                  )}
                </div>

                {/* Campaign name preview */}
                <div className="min-w-0">
                  {warn ? (
                    <div className="flex items-center gap-1 text-xs text-amber-600">
                      <IconAlertTriangle className="h-3 w-3 shrink-0" />
                      Nome do anúncio vazio
                    </div>
                  ) : (
                    <div className="truncate text-xs text-muted-foreground" title={campaignPreview}>
                      {campaignPreview}
                    </div>
                  )}
                </div>

                {/* Ad name input */}
                <Input
                  value={item.adName}
                  placeholder="Nome do anúncio"
                  className="h-8 text-xs"
                  onChange={(e) => onItemChange(item.id, { adName: e.target.value })}
                />

                {/* Status toggle */}
                <div className="flex gap-1 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant={item.status === "ACTIVE" ? "default" : "outline"}
                    className="h-8 px-2 text-xs"
                    onClick={() => onItemChange(item.id, { status: "ACTIVE" })}
                  >
                    Ativo
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={item.status === "PAUSED" ? "default" : "outline"}
                    className="h-8 px-2 text-xs"
                    onClick={() => onItemChange(item.id, { status: "PAUSED" })}
                  >
                    Pausado
                  </Button>
                </div>

                {/* Remove */}
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive-10 transition-colors"
                  onClick={() => onRemove(item.id)}
                >
                  <IconTrash className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

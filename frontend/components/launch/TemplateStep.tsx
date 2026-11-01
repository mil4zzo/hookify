"use client"

import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { IconCalendarOff, IconLock } from "@tabler/icons-react"
import { api } from "@/lib/api/endpoints"
import { useLaunchWizard } from "@/lib/campaignLaunch/store"
import type { LaunchTemplate } from "@/lib/campaignLaunch/types"
import { budgetMinorToValue } from "@/lib/manager/budget"
import { Checkbox } from "@/components/ui/checkbox"
import { InlineNotice, StatePanel } from "@/components/common/States"
import AdGrid from "@/components/upload/AdGrid"
import CreativePreview from "@/components/upload/CreativePreview"
import { cn } from "@/lib/utils/cn"

export function formatMoney(minor: number | null | undefined, currency: string | null): string {
  if (minor == null) return "—"
  const code = (currency || "BRL").toUpperCase()
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(budgetMinorToValue(minor, code))
  } catch {
    return String(budgetMinorToValue(minor, code))
  }
}

export function budgetLabel(t: LaunchTemplate): string {
  const kind = t.budget.field === "lifetime_budget" ? "total" : "diário"
  if (t.budget.level === "campaign") return `Orçamento ${kind} da campanha`
  if (t.budget.level === "adset") return `Orçamento ${kind} por conjunto`
  return "Sem orçamento definido"
}

export function useLaunchTemplate(adId: string | null) {
  return useQuery({
    queryKey: ["campaign-launch", "template", adId],
    queryFn: () => api.campaignLaunch.getTemplate(adId!),
    enabled: Boolean(adId),
    staleTime: 5 * 60_000,
    retry: false,
  })
}

export function TemplateStep({ initialAdId }: { initialAdId: string | null }) {
  const templateAdId = useLaunchWizard((s) => s.templateAdId)
  const selectedAdsetIds = useLaunchWizard((s) => s.selectedAdsetIds)
  const selectTemplate = useLaunchWizard((s) => s.selectTemplate)
  const toggleAdset = useLaunchWizard((s) => s.toggleAdset)
  // `?ad=` (atalho "Usar como modelo" do Manager) tem prioridade sobre o modelo anterior.
  const [candidateId, setCandidateId] = useState<string | null>(initialAdId ?? templateAdId)
  const { data: template, isLoading, error } = useLaunchTemplate(candidateId)

  useEffect(() => {
    if (!template || template.ad_id === useLaunchWizard.getState().templateAdId) return
    selectTemplate({
      adId: template.ad_id,
      accountId: template.account_id,
      slots: template.creative.media_slots,
      adsetIds: template.adsets.filter((a) => !a.blocked_reason).map((a) => a.id),
      campaignName: template.campaign.name,
    })
  }, [template, selectTemplate])

  const errorText =
    (error as { response?: { data?: { detail?: { message?: string } } } } | null)?.response?.data?.detail?.message ??
    (error ? "Não foi possível carregar este anúncio como modelo." : null)

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="min-w-0 space-y-3">
        <p className="text-xs text-muted-foreground">
          Escolha um anúncio que já roda. A campanha, os conjuntos e o texto dele viram o modelo — só a mídia muda.
        </p>
        <AdGrid selectedAdId={candidateId} onSelect={(adId) => setCandidateId(adId)} />
      </div>

      <aside className="space-y-4">
        <h2 className="text-base font-semibold">Modelo</h2>
        {!candidateId ? (
          <StatePanel kind="empty" frame="dashed" title="Nenhum modelo escolhido" message="Selecione um anúncio ao lado." />
        ) : isLoading ? (
          <StatePanel kind="loading" frame="none" title="Lendo campanha e criativo na Meta..." />
        ) : errorText ? (
          <StatePanel kind="error" frame="none" title="Modelo indisponível" message={errorText} />
        ) : template ? (
          <TemplateSummary
            template={template}
            selectedAdsetIds={selectedAdsetIds}
            onToggleAdset={toggleAdset}
          />
        ) : null}
      </aside>
    </div>
  )
}

function TemplateSummary({
  template,
  selectedAdsetIds,
  onToggleAdset,
}: {
  template: LaunchTemplate
  selectedAdsetIds: string[]
  onToggleAdset: (id: string, selected: boolean) => void
}) {
  const selected = new Set(selectedAdsetIds)
  return (
    <div className="space-y-4">
      <CreativePreview creative={template.creative} adId={template.ad_id} />

      {template.blocking_reasons.map((reason) => (
        <InlineNotice key={reason} tone="destructive" title="Este anúncio não pode ser modelo">
          {reason}
        </InlineNotice>
      ))}
      {template.warnings.map((w) => (
        <InlineNotice key={w} tone="warning">
          {w}
        </InlineNotice>
      ))}

      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="space-y-1">
          <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Campanha modelo</p>
          <p className="text-sm font-medium">{template.campaign.name}</p>
          <p className="text-xs text-muted-foreground">
            {budgetLabel(template)}
            {template.budget.amount != null && `: ${formatMoney(template.budget.amount, template.currency)}`}
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            Conjuntos copiados em cada campanha ({selected.size}/{template.adsets.length})
          </p>
          <ul className="space-y-1">
            {template.adsets.map((adset) => {
              const blocked = Boolean(adset.blocked_reason)
              return (
                <li key={adset.id}>
                  <label
                    className={cn(
                      "flex items-start gap-3 rounded-md px-2 py-2 text-sm",
                      blocked ? "opacity-50" : "cursor-pointer hover:bg-surface-2",
                    )}
                  >
                    <Checkbox
                      checked={selected.has(adset.id)}
                      disabled={blocked}
                      onCheckedChange={(v) => onToggleAdset(adset.id, v === true)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="block truncate">{adset.name}</span>
                      {adset.is_template_adset && (
                        <span className="block text-xs text-muted-foreground">Conjunto do anúncio modelo</span>
                      )}
                      {adset.schedule_expired && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <IconCalendarOff className="h-3 w-3" /> Agenda vencida — a cópia começa sem data de fim
                        </span>
                      )}
                      {blocked && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <IconLock className="h-3 w-3" /> {adset.blocked_reason}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}

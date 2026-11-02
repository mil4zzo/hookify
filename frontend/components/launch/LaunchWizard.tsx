"use client"

import { useEffect, useMemo, useState } from "react"
import { IconCheck, IconChevronLeft, IconChevronRight, IconLoader2, IconRocket } from "@tabler/icons-react"
import { toast } from "sonner"
import { api } from "@/lib/api/endpoints"
import { useLaunchWizard, type LaunchStep } from "@/lib/campaignLaunch/store"
import { isCreativeComplete, renderName } from "@/lib/campaignLaunch/grouping"
import { useMediaPipeline } from "@/lib/campaignLaunch/useMediaPipeline"
import { Button } from "@/components/ui/button"
import { FormStepWorkspace } from "@/components/common/layout"
import { cn } from "@/lib/utils/cn"
import { CreativesStep } from "./CreativesStep"
import { LaunchProgressView } from "./LaunchProgressView"
import { ReviewStep } from "./ReviewStep"
import { TemplateStep, useLaunchTemplate } from "./TemplateStep"

const STEPS: { id: LaunchStep; label: string }[] = [
  { id: 1, label: "Modelo" },
  { id: 2, label: "Criativos" },
  { id: 3, label: "Revisar e lançar" },
]

function StepIndicator({ current, onStepClick }: { current: LaunchStep; onStepClick: (s: LaunchStep) => void }) {
  return (
    <ol className="flex items-center gap-1">
      {STEPS.map((step) => {
        const done = step.id < current
        const active = step.id === current
        return (
          <li key={step.id}>
            <button
              type="button"
              disabled={!done}
              onClick={() => onStepClick(step.id)}
              className={cn(
                "focus-inset flex items-center gap-2 rounded-md px-3 py-2 text-sm",
                active ? "text-primary" : done ? "text-foreground hover:bg-surface-2" : "text-muted-foreground opacity-50",
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                  active ? "bg-primary text-primary-foreground" : done ? "bg-success-800 text-white" : "border border-border",
                )}
              >
                {done ? <IconCheck className="h-3 w-3" /> : step.id}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

export function LaunchWizard({ initialAdId }: { initialAdId: string | null }) {
  const state = useLaunchWizard()
  const pipeline = useMediaPipeline()
  const { data: template } = useLaunchTemplate(state.templateAdId)
  const [launching, setLaunching] = useState(false)

  // Lançamento em andamento (outra aba, recarregou a página): abre direto o progresso.
  useEffect(() => {
    if (useLaunchWizard.getState().activeJobId) return
    api.campaignLaunch
      .getLatest()
      .then(({ launch }) => {
        if (launch?.status === "processing") useLaunchWizard.getState().setActiveJob(launch.job_id)
      })
      .catch(() => undefined)
  }, [])

  const valid = useMemo(
    () => state.creatives.filter((c) => isCreativeComplete(c, state.slots)),
    [state.creatives, state.slots],
  )
  const usedEntries = valid.flatMap((c) => Object.values(c.slots).map((k) => state.pool[k])).filter(Boolean)
  const mediaFailed = usedEntries.some((e) => e.status === "error")
  const mediaNotStarted = usedEntries.some((e) => !e.mediaId)

  const templateReady =
    Boolean(template) &&
    template?.ad_id === state.templateAdId &&
    template.blocking_reasons.length === 0 &&
    state.selectedAdsetIds.length > 0

  const canNext =
    (state.step === 1 && templateReady) || (state.step === 2 && valid.length > 0 && !mediaFailed)
  const needsEndDate =
    !state.endDate && Boolean(template?.adsets.some((a) => a.needs_end_date && state.selectedAdsetIds.includes(a.id)))
  const canLaunch = state.step === 3 && templateReady && !needsEndDate && valid.length > 0 && !mediaFailed && !mediaNotStarted && !launching

  const launch = async () => {
    if (!template) return
    setLaunching(true)
    try {
      const adsetIds = template.adsets.map((a) => a.id).filter((id) => state.selectedAdsetIds.includes(id))
      const { job_id } = await api.campaignLaunch.launch({
        template_ad_id: template.ad_id,
        adset_ids: adsetIds,
        status: state.launchStatus,
        adset_name_template: state.adsetNameTemplate.trim() || "{template_adset_name}",
        budget_amount: state.budgetAmount,
        end_date: state.endDate,
        items: valid.map((c, i) => ({
          ad_name: c.name.trim(),
          campaign_name: renderName(state.campaignNameTemplate, { ad_name: c.name.trim(), index: i + 1 }) || c.name.trim(),
          media: Object.fromEntries(
            Object.entries(c.slots).map(([slotKey, mediaKey]) => [slotKey, state.pool[mediaKey].mediaId!]),
          ),
        })),
      })
      state.setActiveJob(job_id)
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: { message?: string } } } })?.response?.data?.detail
      toast.error(detail?.message ?? "Não foi possível iniciar o lançamento.")
    } finally {
      setLaunching(false)
    }
  }

  if (state.activeJobId) {
    return (
      <LaunchProgressView
        jobId={state.activeJobId}
        onNewLaunch={() => state.reset()}
        onChangeTemplate={() => {
          state.setActiveJob(null)
          state.setStep(1)
        }}
      />
    )
  }

  const actions = (
    <>
      <Button type="button" variant="ghost" disabled={state.step === 1} onClick={() => state.setStep((state.step - 1) as LaunchStep)}>
        <IconChevronLeft className="h-4 w-4" /> Voltar
      </Button>
      {state.step < 3 ? (
        <Button type="button" disabled={!canNext} onClick={() => state.setStep((state.step + 1) as LaunchStep)}>
          Continuar <IconChevronRight className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          type="button"
          disabled={!canLaunch}
          onClick={() => void launch()}
          title={mediaNotStarted ? "Aguardando os envios começarem" : undefined}
        >
          {launching ? <IconLoader2 className="h-4 w-4 animate-spin" /> : <IconRocket className="h-4 w-4" />}
          Lançar {valid.length} campanha{valid.length === 1 ? "" : "s"}
        </Button>
      )}
    </>
  )

  return (
    <FormStepWorkspace header={<StepIndicator current={state.step} onStepClick={state.setStep} />} actions={actions}>
      {state.step === 1 && <TemplateStep initialAdId={initialAdId} />}
      {state.step === 2 && <CreativesStep pipeline={pipeline} />}
      {state.step === 3 && template && <ReviewStep template={template} />}
    </FormStepWorkspace>
  )
}

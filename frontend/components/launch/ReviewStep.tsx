"use client"

import { useMemo, useState } from "react"
import { useLaunchWizard } from "@/lib/campaignLaunch/store"
import { isCreativeComplete, renderName } from "@/lib/campaignLaunch/grouping"
import type { LaunchTemplate } from "@/lib/campaignLaunch/types"
import { budgetMinorToValue, budgetValueToMinor } from "@/lib/manager/budget"
import { Input } from "@/components/ui/input"
import { InlineNotice } from "@/components/common/States"
import { cn } from "@/lib/utils/cn"
import { budgetLabel, formatMoney } from "./TemplateStep"

const VARIABLES = [
  { token: "{ad_name}", hint: "nome do criativo" },
  { token: "{index}", hint: "nº do criativo (campanha) / do conjunto" },
  { token: "{template_adset_name}", hint: "nome do conjunto modelo" },
]

export function ReviewStep({ template }: { template: LaunchTemplate }) {
  const state = useLaunchWizard()
  const { creatives, slots, pool, selectedAdsetIds } = state
  const valid = creatives.filter((c) => isCreativeComplete(c, slots))
  const adsets = template.adsets.filter((a) => selectedAdsetIds.includes(a.id))
  const pending = Object.values(pool).filter((e) => e.status !== "ready" && e.status !== "error")
  const pendingLocal = pending.filter((e) => e.source === "upload").length
  const [budgetText, setBudgetText] = useState(() =>
    state.budgetAmount != null ? String(budgetMinorToValue(state.budgetAmount, template.currency)) : "",
  )

  const preview = useMemo(() => {
    const first = valid[0]
    if (!first) return null
    return {
      campaign: renderName(state.campaignNameTemplate, { ad_name: first.name, index: 1 }),
      adsets: adsets.map((a, i) =>
        renderName(state.adsetNameTemplate, { ad_name: first.name, index: i + 1, template_adset_name: a.name }),
      ),
    }
  }, [valid, adsets, state.campaignNameTemplate, state.adsetNameTemplate])

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="min-w-0 space-y-6">
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Nomes</h2>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Campanha</span>
            <Input
              value={state.campaignNameTemplate}
              onChange={(e) => state.setNaming({ campaignNameTemplate: e.target.value })}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Conjunto</span>
            <Input
              value={state.adsetNameTemplate}
              onChange={(e) => state.setNaming({ adsetNameTemplate: e.target.value })}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            {VARIABLES.map((v, i) => (
              <span key={v.token}>
                {i > 0 && " · "}
                <code className="rounded-sm bg-surface-2 px-1 text-foreground">{v.token}</code> {v.hint}
              </span>
            ))}
            . O anúncio leva o nome do criativo.
          </p>
          {preview && (
            <div className="space-y-1 rounded-md border border-border bg-surface-2 p-3 text-xs">
              <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                Prévia do 1º criativo
              </p>
              <p>
                <span className="text-muted-foreground">Campanha:</span> {preview.campaign || "—"}
              </p>
              {preview.adsets.map((name, i) => (
                <p key={i}>
                  <span className="text-muted-foreground">Conjunto {i + 1}:</span> {name || "—"}
                </p>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold">Como as campanhas nascem</h2>
          <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Status inicial">
            {(["PAUSED", "ACTIVE"] as const).map((status) => (
              <button
                key={status}
                type="button"
                role="radio"
                aria-checked={state.launchStatus === status}
                onClick={() => state.setLaunchStatus(status)}
                className={cn(
                  "focus-inset h-control-default rounded-md px-4 text-sm font-medium",
                  state.launchStatus === status ? "state-pressed text-white" : "btn-tonal text-foreground",
                )}
              >
                {status === "PAUSED" ? "Pausadas" : "Ativas"}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {state.launchStatus === "PAUSED"
              ? "Nada vai ao ar: revise no Gerenciador de Anúncios e ative quando quiser."
              : "Vão ao ar assim que forem criadas (a campanha é ativada por último, já completa)."}
          </p>

          {template.budget.level && (
            <label className="block max-w-xs space-y-1">
              <span className="text-xs text-muted-foreground">
                {budgetLabel(template)} ({(template.currency || "BRL").toUpperCase()})
              </span>
              <Input
                inputMode="decimal"
                value={budgetText}
                placeholder={`Igual ao modelo: ${formatMoney(template.budget.amount, template.currency)}`}
                onChange={(e) => {
                  setBudgetText(e.target.value)
                  const value = Number(e.target.value.replace(/\./g, "").replace(",", "."))
                  state.setBudgetAmount(
                    e.target.value.trim() && Number.isFinite(value) && value > 0
                      ? budgetValueToMinor(value, template.currency)
                      : null,
                  )
                }}
              />
            </label>
          )}
        </section>
      </div>

      <aside className="space-y-4">
        <h2 className="text-base font-semibold">Resumo</h2>
        <div className="space-y-2 rounded-lg border border-border bg-card p-4 text-sm">
          <p>
            <span className="text-2xl font-semibold">{valid.length}</span> campanha(s)
          </p>
          <p className="text-muted-foreground">
            {valid.length * adsets.length} conjunto(s) · {valid.length * adsets.length} anúncio(s)
          </p>
          <p className="text-xs text-muted-foreground">
            Cópias de <span className="text-foreground">{template.campaign.name}</span>
          </p>
        </div>
        {creatives.length > valid.length && (
          <InlineNotice tone="warning">
            {creatives.length - valid.length} criativo(s) incompletos ficam de fora (sem nome ou sem mídia em algum
            posicionamento).
          </InlineNotice>
        )}
        {pending.length > 0 && (
          <InlineNotice tone="info" title={`${pending.length} mídia(s) ainda a caminho da Meta`}>
            O lançamento espera por elas.
            {pendingLocal > 0 && " Mantenha esta aba aberta até os envios do computador terminarem."}
          </InlineNotice>
        )}
      </aside>
    </div>
  )
}

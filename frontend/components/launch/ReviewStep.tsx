"use client"

import { useEffect, useMemo, useState } from "react"
import { addDays, format, isValid, parse } from "date-fns"
import { IconCalendar, IconX } from "@tabler/icons-react"
import { useLaunchWizard } from "@/lib/campaignLaunch/store"
import { isCreativeComplete, renderName } from "@/lib/campaignLaunch/grouping"
import type { LaunchTemplate } from "@/lib/campaignLaunch/types"
import { budgetMinorToValue, budgetValueToMinor } from "@/lib/manager/budget"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { getDateFnsLocale } from "@/lib/utils/dateFnsLocale"
import { formatLocaleDate } from "@/lib/i18n/locale"
import { InlineNotice } from "@/components/common/States"
import { cn } from "@/lib/utils/cn"
import { adsetBudgets, budgetLabel, formatMoney } from "./TemplateStep"

const END_DATE_FORMAT = "yyyy-MM-dd"

function EndDatePicker({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) {
  const [open, setOpen] = useState(false)
  // parse() lê no fuso local; new Date("yyyy-MM-dd") é UTC e recuaria um dia.
  const selected = useMemo(() => {
    const parsed = value ? parse(value, END_DATE_FORMAT, new Date()) : null
    return parsed && isValid(parsed) ? parsed : undefined
  }, [value])
  return (
    <div className="flex items-center gap-3">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="picker" className="min-w-48 justify-between font-normal">
            <span className={cn(!selected && "text-muted-foreground")}>
              {selected ? formatLocaleDate(selected, { day: "2-digit", month: "2-digit", year: "numeric" }) : "Escolher data"}
            </span>
            <IconCalendar className="h-4 w-4 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            locale={getDateFnsLocale()}
            disabled={{ before: addDays(new Date(), 1) }}
            onSelect={(day) => {
              onChange(day ? format(day, END_DATE_FORMAT) : null)
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
      {selected && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          <IconX className="h-4 w-4" /> Limpar
        </Button>
      )}
    </div>
  )
}

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
  const abo = template.budget.level === "adset" ? adsetBudgets(adsets) : null
  const expiredLifetime = adsets.filter((a) => a.needs_end_date)
  const expiredDaily = adsets.filter((a) => a.schedule_expired && !a.needs_end_date)
  const endDateRequired = expiredLifetime.length > 0
  const budgetEditable = Boolean(template.budget.level) && !abo?.mixed
  const { setBudgetAmount } = state
  useEffect(() => {
    // Diário e total misturados: um valor só não serve aos dois (o backend recusa).
    if (abo?.mixed) {
      setBudgetText("")
      setBudgetAmount(null)
    }
  }, [abo?.mixed, setBudgetAmount])
  const budgetPlaceholder = abo
    ? abo.sameAmount != null
      ? `Igual ao modelo: ${formatMoney(abo.sameAmount, template.currency)}`
      : "Em branco: cada conjunto mantém o seu"
    : `Igual ao modelo: ${formatMoney(template.budget.amount, template.currency)}`

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

          {abo?.mixed && (
            <p className="text-xs text-muted-foreground">
              Os conjuntos escolhidos misturam orçamento diário e total: cada um mantém o seu.
            </p>
          )}
          {budgetEditable && (
            <label className="block max-w-xs space-y-1">
              <span className="text-xs text-muted-foreground">
                {abo ? `Orçamento ${abo.kind} por conjunto` : budgetLabel(template)} ({(template.currency || "BRL").toUpperCase()})
              </span>
              <Input
                inputMode="decimal"
                value={budgetText}
                placeholder={budgetPlaceholder}
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

        <section className="space-y-3">
          <h2 className="text-base font-semibold">Data de fim</h2>
          <EndDatePicker value={state.endDate} onChange={state.setEndDate} />
          <p className="text-xs text-muted-foreground">
            {endDateRequired && !state.endDate
              ? `Obrigatória: ${expiredLifetime.map((a) => a.name).join(", ")} tem orçamento total e a agenda do modelo já venceu.`
              : state.endDate
                ? "Vale para todos os conjuntos copiados, no fuso da conta de anúncios."
                : expiredDaily.length > 0
                  ? `Sem data, ${expiredDaily.map((a) => a.name).join(", ")} (agenda vencida no modelo) roda sem data de fim até você pausar. Os demais mantêm a data do modelo.`
                  : "Em branco: cada conjunto mantém a data de fim do modelo."}
          </p>
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

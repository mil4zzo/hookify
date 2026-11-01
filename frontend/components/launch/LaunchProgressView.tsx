"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  IconAlertCircle,
  IconCircleCheck,
  IconExternalLink,
  IconLoader2,
  IconRefresh,
} from "@tabler/icons-react"
import { toast } from "sonner"
import { api } from "@/lib/api/endpoints"
import type { LaunchItemProgress, LaunchProgress } from "@/lib/campaignLaunch/types"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { InlineNotice, StatePanel } from "@/components/common/States"

const STEP_LABEL: Record<string, string> = {
  media: "Esperando mídias ficarem prontas",
  campaign: "Copiando campanha",
  activate: "Ativando campanha",
  done: "Concluído",
}

function stepLabel(item: LaunchItemProgress): string {
  if (item.status === "pending") return "Na fila"
  if (item.status === "success") return `${item.adsets.length} conjunto(s) e anúncio(s) criados`
  const step = item.step ?? ""
  const [kind, n] = step.split(":")
  if (kind === "adset") return `Copiando conjunto ${n}/${item.adsets.length}`
  if (kind === "ad") return `Criando anúncio ${n}/${item.adsets.length}`
  return STEP_LABEL[kind] ?? "Processando"
}

function adsManagerUrl(accountId: string | null, campaignId: string): string {
  const act = String(accountId ?? "").replace(/^act_/, "")
  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${act}&selected_campaign_ids=${campaignId}`
}

export function useLaunchProgress(jobId: string | null) {
  return useQuery({
    queryKey: ["campaign-launch", "progress", jobId],
    queryFn: () => api.campaignLaunch.getProgress(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (query) => ((query.state.data as LaunchProgress | undefined)?.status === "processing" ? 2500 : false),
  })
}

export function LaunchProgressView({
  jobId,
  onNewLaunch,
  onChangeTemplate,
}: {
  jobId: string
  onNewLaunch: () => void
  onChangeTemplate: () => void
}) {
  const queryClient = useQueryClient()
  const { data, error } = useLaunchProgress(jobId)
  const [retrying, setRetrying] = useState(false)

  if (error && !data) {
    return <StatePanel kind="error" frame="none" title="Não foi possível ler o lançamento" message="Tente recarregar a página." />
  }
  if (!data) return <StatePanel kind="loading" frame="none" title="Carregando lançamento..." />

  const running = data.status === "processing"
  const failed = data.items.filter((i) => i.status === "error")
  const categories = new Set(failed.map((i) => i.error_category))
  const canRetry = !running && failed.some((i) => i.error_category !== "template_replaceable")

  const retry = async () => {
    setRetrying(true)
    try {
      await api.campaignLaunch.retry(jobId, failed.filter((i) => i.error_category !== "template_replaceable").map((i) => i.id))
      await queryClient.invalidateQueries({ queryKey: ["campaign-launch", "progress", jobId] })
    } catch {
      toast.error("Não foi possível tentar de novo.")
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">{data.message}</p>
            <p className="text-xs text-muted-foreground">
              Modelo: {data.template.campaign_name ?? data.template.ad_name} · campanhas{" "}
              {data.launch_status === "ACTIVE" ? "ativas" : "pausadas"}
            </p>
          </div>
          <div className="flex gap-3">
            {canRetry && (
              <Button type="button" variant="outline" onClick={() => void retry()} disabled={retrying}>
                {retrying ? <IconLoader2 className="h-4 w-4 animate-spin" /> : <IconRefresh className="h-4 w-4" />}
                Tentar de novo as que falharam
              </Button>
            )}
            {!running && (
              <Button type="button" onClick={onNewLaunch}>
                Novo lançamento
              </Button>
            )}
          </div>
        </div>
        <Progress value={running ? data.progress : 100} className="h-1.5" />
        <p className="text-xs text-muted-foreground">
          {data.summary.success} criada(s) · {data.summary.error} com erro · {data.summary.pending} na fila
          {running && " — pode fechar esta tela: o lançamento continua no servidor."}
        </p>
      </div>

      {categories.has("template_replaceable") && !running && (
        <InlineNotice
          tone="warning"
          title="Algumas falhas dependem do modelo"
          action={
            <Button type="button" variant="outline" size="sm" onClick={onChangeTemplate}>
              Escolher outro modelo
            </Button>
          }
        >
          Tentar de novo não resolve: o conjunto ou o criativo modelo precisa de ajuste no Gerenciador, ou escolha outro
          anúncio como modelo (as mídias já enviadas são reaproveitadas).
        </InlineNotice>
      )}

      <ul className="space-y-2">
        {data.items.map((item) => (
          <li key={item.id} className="flex items-start gap-3 rounded-md border border-border bg-card p-3">
            <span className="mt-0.5 shrink-0">
              {item.status === "success" ? (
                <IconCircleCheck className="h-4 w-4 text-success" />
              ) : item.status === "error" ? (
                <IconAlertCircle className="h-4 w-4 text-destructive" />
              ) : item.status === "running" ? (
                <IconLoader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <span className="block h-4 w-4 rounded-full border border-border" />
              )}
            </span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="truncate text-sm font-medium">{item.campaign_name}</p>
              <p className="text-xs text-muted-foreground">
                Anúncio {item.ad_name} · {stepLabel(item)}
              </p>
              {item.status === "error" && item.error_message && (
                <p className="text-xs text-destructive">{item.error_message}</p>
              )}
            </div>
            {item.meta_campaign_id && (
              <Button asChild variant="ghost" size="sm">
                <a href={adsManagerUrl(data.account_id, item.meta_campaign_id)} target="_blank" rel="noreferrer">
                  Gerenciador <IconExternalLink className="h-4 w-4" />
                </a>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

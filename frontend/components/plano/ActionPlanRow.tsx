"use client";

import { useState } from "react";
import type { ActionItem, Verdict } from "@/lib/utils/actionPlan";
import type { RankingsResponse } from "@/lib/api/schemas";
import { AdPlayArea } from "@/components/common/AdPlayArea";
import { AdStatusIcon } from "@/components/common/AdStatusIcon";
import { StandardCard } from "@/components/common/StandardCard";
import { AppDialog } from "@/components/common/AppDialog";
import { AdDetailsDialog } from "@/components/ads/AdDetailsDialog";
import { useFormatCurrency } from "@/lib/utils/currency";
import { getValueColor } from "@/lib/utils/metricColor";
import { IconAlertTriangle } from "@tabler/icons-react";

const LEVER_LABEL: Record<string, string> = {
  hook: "Hook",
  website_ctr: "Link CTR",
  connect_rate: "Connect Rate",
  page_conv: "Conv. Página",
};

const VERDICT_CHIP: Record<Verdict, { label: string; className: string }> = {
  gem:      { label: "Escalar",  className: "bg-success-20 text-success border border-success-30" },
  otimizar: { label: "Otimizar", className: "bg-attention-20 text-attention border border-attention-30" },
  licao:    { label: "Aprender", className: "bg-warning-20 text-warning border border-warning-30" },
  descartar:{ label: "Pausar",   className: "bg-destructive-20 text-destructive border border-destructive-30" },
  observar: { label: "Observar", className: "bg-muted-30 text-muted-foreground border border-border" },
};

type ActionPlanRowProps = {
  item: ActionItem;
  averages?: RankingsResponse["averages"];
  actionType: string;
  dateStart?: string;
  dateStop?: string;
  packIds?: string[];
  availableConversionTypes?: string[];
};

export function ActionPlanRow({
  item,
  averages,
  actionType,
  dateStart,
  dateStop,
  packIds,
  availableConversionTypes,
}: ActionPlanRowProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const formatCurrency = useFormatCurrency();
  const { ad, verdict, costActual, costTarget, lowData, costPotential, impactSavings } = item;
  const adRaw = ad as any;

  const chip = VERDICT_CHIP[verdict];
  const avgCpr = actionType ? (averages?.per_action_type?.[actionType]?.cpr ?? 0) : 0;
  const costRef = costTarget ?? avgCpr;
  const costRefLabel = costTarget ? "Alvo" : "Média";

  const dialogAverages = averages
    ? {
        hook: averages.hook ?? null,
        hold_rate: averages.hold_rate ?? null,
        video_watched_p50: averages.video_watched_p50 ?? null,
        scroll_stop: averages.scroll_stop ?? null,
        ctr: averages.ctr ?? null,
        website_ctr: averages.website_ctr ?? null,
        connect_rate: averages.connect_rate ?? null,
        cpm: averages.cpm ?? null,
        cpr: avgCpr ?? null,
        page_conv: averages.per_action_type?.[actionType]?.page_conv ?? null,
      }
    : undefined;

  return (
    <>
      <StandardCard
        variant="default"
        padding="sm"
        interactive
        onClick={() => setDialogOpen(true)}
        className="flex items-center gap-3"
      >
        <AdPlayArea
          ad={adRaw}
          aspectRatio="1:1"
          size={48}
          className="rounded flex-shrink-0"
          onPlayClick={(e) => { e.stopPropagation(); setDialogOpen(true); }}
        />

        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <AdStatusIcon status={adRaw.effective_status} />
            <span className="text-sm font-medium text-foreground truncate">
              {adRaw.ad_name || adRaw.ad_id || "—"}
            </span>
            {lowData && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-muted-30 text-muted-foreground border border-border flex-shrink-0">
                <IconAlertTriangle className="h-3 w-3" />
                Dados parciais
              </span>
            )}
          </div>
          <WhyLine item={item} formatCurrency={formatCurrency} />
        </div>

        <div className={`px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${chip.className}`}>
          {chip.label}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[10px] text-muted-foreground font-medium uppercase">CPR</span>
            <span className={`text-sm font-bold ${costActual > 0 ? getValueColor(costActual, avgCpr, true) : "text-muted-foreground"}`}>
              {costActual > 0 ? formatCurrency(costActual) : "—"}
            </span>
          </div>
          {costRef > 0 && (
            <>
              <span className="text-muted-foreground text-sm">→</span>
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-[10px] text-muted-foreground font-medium uppercase">{costRefLabel}</span>
                <span className="text-sm font-bold text-muted-foreground">{formatCurrency(costRef)}</span>
              </div>
            </>
          )}
        </div>
      </StandardCard>

      <AppDialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Detalhes do anúncio"
        size="5xl"
        padding="md"
        className="flex h-[90dvh] min-h-0 flex-col overflow-hidden"
        bodyClassName="flex min-h-0 flex-1 flex-col"
      >
        <AdDetailsDialog
          ad={ad}
          groupByAdName
          dateStart={dateStart}
          dateStop={dateStop}
          actionType={actionType}
          packIds={packIds}
          availableConversionTypes={availableConversionTypes}
          averages={dialogAverages}
        />
      </AppDialog>
    </>
  );
}

function WhyLine({ item, formatCurrency }: { item: ActionItem; formatCurrency: (v: number) => string }) {
  const { verdict, fixLevers, strongLevers, impactSavings } = item;
  const adRaw = item.ad as any;

  if (verdict === "gem") {
    return <span className="text-xs text-muted-foreground">Todas as métricas acima da média — escale agora</span>;
  }

  if (verdict === "otimizar") {
    if (fixLevers.length > 0) {
      const labels = fixLevers.map((l) => LEVER_LABEL[l] ?? l).join(", ");
      return (
        <span className="text-xs text-muted-foreground">
          {fixLevers.length > 1 ? "Corrija (por impacto): " : "Corrija "}
          <span className="font-medium text-attention">{labels}</span>
          {impactSavings && impactSavings > 0 ? (
            <>
              {" · "}potencial de economizar{" "}
              <span className="font-medium text-success">{formatCurrency(impactSavings)}</span>
            </>
          ) : null}
        </span>
      );
    }
    return <span className="text-xs text-muted-foreground">Custo sob controle — otimize as métricas</span>;
  }

  if (verdict === "licao") {
    if (strongLevers.length > 0) {
      const labels = strongLevers.map((l) => LEVER_LABEL[l] ?? l).join(", ");
      return (
        <span className="text-xs text-muted-foreground">
          {strongLevers.length > 1 ? "Pontos fortes: " : "Ponto forte: "}
          <span className="font-medium text-warning">{labels}</span>
          {strongLevers.length > 1 ? " — recicle esses elementos" : " — recicle esse elemento"}
        </span>
      );
    }
    return <span className="text-xs text-muted-foreground">Pausar e aprender com este anúncio</span>;
  }

  if (verdict === "descartar") {
    const spend = Number(adRaw.spend || 0);
    return (
      <span className="text-xs text-muted-foreground">
        Custo alto e métricas fracas
        {spend > 0 ? ` · ${formatCurrency(spend)} gastos` : ""}
      </span>
    );
  }

  if (verdict === "observar") {
    if (item.sourceBucket === "not_validated") {
      return <span className="text-xs text-muted-foreground">Não atende aos critérios de validação ainda</span>;
    }
    return <span className="text-xs text-muted-foreground">Dados insuficientes para veredito</span>;
  }

  return null;
}

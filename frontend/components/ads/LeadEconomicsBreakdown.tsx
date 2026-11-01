"use client";

import { getAppLocale } from "@/lib/i18n/locale";
import { translate } from "@/lib/i18n/translate";
import { useId, useState } from "react";
import { IconAlertTriangle, IconCalculator, IconChevronDown } from "@tabler/icons-react";

import { StatePanel } from "@/components/common/States";
import { VideoMetricCell } from "@/components/common/VideoMetricCell";
import { LEAD_ECONOMICS_UNAVAILABLE_TEXT } from "@/components/manager/LeadEconomicsCell";
import { Button } from "@/components/ui/button";
import { formatMetricValue } from "@/lib/metrics";
import { cn } from "@/lib/utils/cn";
import { LEAD_ECONOMICS_MIN_SAMPLE, leadMarginTone, type RowLeadEconomicsOutcome } from "@/lib/utils/leadEconomics";
import { getMetricValueTextClass } from "@/lib/utils/metricQuality";

const pct = (fraction: number) => formatMetricValue("lead_margin", fraction);
const count = (n: number) => n.toLocaleString(getAppLocale());

export interface LeadEconomicsBreakdownProps {
  /** A conta do anúncio (ou do criativo agrupado) — a MESMA de `getRowLeadEconomics`, que a coluna usa. */
  outcome: RowLeadEconomicsOutcome;
  formatCurrency: (n: number) => string;
  /** A tabela por faixa já aberta (teste; na tela ela abre no botão). */
  defaultExpanded?: boolean;
}

/**
 * A conta aberta no modal do anúncio (F3): de onde saem o CPL Max e a Margem da
 * coluna do Manager.
 *
 * Não recalcula nada: recebe o resultado de `computeLeadEconomics` e mostra as parcelas.
 * A coluna "Entra no teto" (fatia dos leads × teto da faixa) soma exatamente o Teto de
 * CPL — é isso que responde "por que o teto deste anúncio é R$ 17,91?".
 */
export function LeadEconomicsBreakdown({ outcome, formatCurrency, defaultExpanded = false }: LeadEconomicsBreakdownProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const tableId = useId();

  const header = (
    <div className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
      <IconCalculator className="h-4 w-4 flex-shrink-0" />
      <span>{translate("ads.leadBreakdown.title")}</span>
    </div>
  );

  if (!outcome.result) {
    return (
      <div className="space-y-2">
        {header}
        <StatePanel kind="empty" density="compact" frame="none" message={LEAD_ECONOMICS_UNAVAILABLE_TEXT[outcome.unavailable]} />
      </div>
    );
  }

  const result = outcome.result;
  const tone = leadMarginTone(result.margin, result.targetMargin);

  return (
    <div className="space-y-2">
      {header}
      <div className="grid grid-cols-4 gap-3">
        <VideoMetricCell label="CPL Max" value={formatCurrency(result.cplCeiling)} subtitle={translate("ads.leadBreakdown.perScoredLead")} subtitleInLabelRow />
        <VideoMetricCell
          label="CPL Real"
          value={result.cplActual === null ? "—" : formatCurrency(result.cplActual)}
          subtitle={translate("ads.leadBreakdown.spendOverLeads")}
          subtitleInLabelRow
        />
        <VideoMetricCell
          label={translate("ads.leadBreakdown.margin")}
          value={result.margin === null ? "—" : pct(result.margin)}
          // Cor pela meta, não pela média (D14): a mesma régua da coluna.
          valueClassName={cn("text-md", tone && getMetricValueTextClass(tone))}
          subtitle={result.targetMargin === null ? undefined : translate("ads.leadBreakdown.target", { value: pct(result.targetMargin) })}
          subtitleInLabelRow
        />
        <VideoMetricCell metricKey="leads_scored" label={translate("ads.leadBreakdown.leadsScored")} value={count(result.leadsScored)} />
      </div>

      {result.lowSample && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <IconAlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {translate("ads.leadBreakdown.lowSample", { min: LEAD_ECONOMICS_MIN_SAMPLE })}
        </p>
      )}

      <Button variant="ghost" size="sm" aria-expanded={expanded} aria-controls={tableId} onClick={() => setExpanded((open) => !open)}>
        <IconChevronDown className={cn("transition-transform", expanded && "rotate-180")} />
        {translate(expanded ? "ads.leadBreakdown.hideTable" : "ads.leadBreakdown.showTable")}
      </Button>

      {expanded && (
        <div id={tableId} className="space-y-2">
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[36rem] text-xs tabular-nums">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th scope="col" className="px-3 py-2 text-left font-normal">{translate("ads.leadBreakdown.colScore")}</th>
                  <th scope="col" className="px-3 py-2 text-right font-normal">{translate("ads.leadBreakdown.colLeads")}</th>
                  <th scope="col" className="px-3 py-2 text-left font-normal">{translate("ads.leadBreakdown.colProduct")}</th>
                  <th scope="col" className="px-3 py-2 text-right font-normal">{translate("ads.leadBreakdown.colConversion")}</th>
                  <th scope="col" className="px-3 py-2 text-right font-normal">{translate("ads.leadBreakdown.colBandCeiling")}</th>
                  <th scope="col" className="px-3 py-2 text-right font-normal">{translate("ads.leadBreakdown.colInCeiling")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-foreground">
                {result.bands.map((band) => (
                  <tr key={band.index}>
                    <th scope="row" className="px-3 py-2 text-left font-normal">{band.label}</th>
                    <td className="px-3 py-2 text-right">
                      {count(band.leads)} <span className="text-muted-foreground">({pct(band.share)})</span>
                    </td>
                    <td className="max-w-[10rem] truncate px-3 py-2" title={band.product.name}>{band.product.name}</td>
                    <td className="px-3 py-2 text-right">{pct(band.conversion)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(band.ceilingPerLead)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(band.share * band.ceilingPerLead)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-semibold text-foreground">
                  <th scope="row" colSpan={5} className="px-3 py-2 text-left">CPL Max</th>
                  <td className="px-3 py-2 text-right">{formatCurrency(result.cplCeiling)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="space-y-0.5 text-xs text-muted-foreground">
            <p>
              {translate("ads.leadBreakdown.basis", { formatted: count(result.leadsScored), count: result.leadsScored })}
            </p>
            <p>{translate("ads.leadBreakdown.formula")}</p>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useMemo } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  IconCircleCheck,
  IconAlertTriangle,
  IconCircleX,
  IconInfoCircle,
  IconLoader2,
} from "@tabler/icons-react";
import type { DateColumnProbe } from "@/lib/api/schemas";
import { overlapDays, buildVerdict, type HealthTone } from "@/lib/utils/dateColumnHealth";

/** YYYY-MM-DD → DD/MM. Datas viajam em ISO; a tela fala BR. */
function br(iso?: string | null): string {
  if (!iso) return "—";
  const [, m, d] = iso.split("-");
  return m && d ? `${d}/${m}` : iso;
}

const TONE_ICON: Record<HealthTone, typeof IconCircleCheck> = {
  ok: IconCircleCheck,
  warn: IconAlertTriangle,
  error: IconCircleX,
};

const TONE_TEXT: Record<HealthTone, string> = {
  ok: "text-success",
  warn: "text-warning",
  error: "text-destructive",
};

export interface DateColumnHealthProps {
  probe: DateColumnProbe | null;
  isProbing: boolean;
  failed: boolean;
  selectedFormat: string;
  packDateStart?: string | null;
  packDateStop?: string | null;
}

export function DateColumnHealth({
  probe,
  isProbing,
  failed,
  selectedFormat,
  packDateStart,
  packDateStop,
}: DateColumnHealthProps) {
  const overlap = useMemo(
    () => (probe ? overlapDays(probe.date_min, probe.date_max, packDateStart, packDateStop) : null),
    [probe, packDateStart, packDateStop],
  );

  if (isProbing) {
    return (
      <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
        <IconLoader2 className="w-3.5 h-3.5 animate-spin" />
        Analisando a coluna...
      </div>
    );
  }

  // Sondagem é conveniência: se ela falhar, não vira mais um erro na tela do
  // usuário — o sync segue funcionando exatamente como funcionava antes.
  if (failed || !probe) return null;

  const { tone, headline } = buildVerdict(probe, selectedFormat, overlap);
  const Icon = TONE_ICON[tone];

  const formatLine =
    probe.resolved_format === "DD/MM/YYYY"
      ? "dia/mês/ano — reconhecido pelos próprios dados"
      : probe.resolved_format === "MM/DD/YYYY"
        ? "mês/dia/ano — reconhecido pelos próprios dados"
        : probe.format_verdict === "conflicting"
          ? "há linhas que só fazem sentido em dia/mês e outras só em mês/dia"
          : probe.format_verdict === "ambiguous"
            ? "todas as datas caem entre os dias 1 e 12, então os dois formatos são possíveis"
            : "nenhuma data reconhecida";

  return (
    <div className={`flex items-center gap-1.5 text-2xs ${TONE_TEXT[tone]}`}>
      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="font-medium">{headline}</span>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <IconInfoCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help flex-shrink-0" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <div className="space-y-1.5">
              <div>
                <span className="font-medium">Datas</span>
                <p className="text-muted-foreground">
                  {probe.non_empty_cells.toLocaleString()} linhas preenchidas
                  {probe.resolved_format
                    ? probe.readable_cells === probe.non_empty_cells
                      ? ", todas legíveis."
                      : `, ${(probe.non_empty_cells - probe.readable_cells).toLocaleString()} que não consigo ler.`
                    : "."}
                  {probe.unparseable_samples.length > 0 && (
                    <> Ex.: {probe.unparseable_samples.map((s) => `"${s}"`).join(", ")}.</>
                  )}
                </p>
              </div>
              <div>
                <span className="font-medium">Formato</span>
                <p className="text-muted-foreground">{formatLine}</p>
              </div>
              {probe.date_min && (
                <div>
                  <span className="font-medium">Período</span>
                  <p className="text-muted-foreground">
                    planilha de {br(probe.date_min)} a {br(probe.date_max)}
                    {packDateStart && packDateStop ? (
                      <>
                        {" · "}pack de {br(packDateStart)} a {br(packDateStop)}
                        {overlap != null && (
                          <>
                            {" · "}
                            {overlap === 0
                              ? "nenhum dia em comum"
                              : `${overlap.toLocaleString()} ${overlap === 1 ? "dia" : "dias"} em comum`}
                          </>
                        )}
                      </>
                    ) : null}
                  </p>
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

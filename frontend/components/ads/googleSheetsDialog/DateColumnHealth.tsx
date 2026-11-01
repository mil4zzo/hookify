"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { formatLocaleDate } from "@/lib/i18n/locale";
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

/** YYYY-MM-DD → DD/MM (MM/DD em inglês). Datas viajam em ISO; a tela fala o idioma do usuário. */
function br(iso?: string | null): string {
  if (!iso) return "—";
  const [, m, d] = iso.split("-");
  return m && d ? formatLocaleDate(`${iso}T00:00:00`, { day: "2-digit", month: "2-digit" }) : iso;
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
  const t = useTranslations("ads.dateHealth");
  const overlap = useMemo(
    () => (probe ? overlapDays(probe.date_min, probe.date_max, packDateStart, packDateStop) : null),
    [probe, packDateStart, packDateStop],
  );

  if (isProbing) {
    return (
      <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
        <IconLoader2 className="w-3.5 h-3.5 animate-spin" />
        {t("analyzing")}
      </div>
    );
  }

  // Sondagem é conveniência: se ela falhar, não vira mais um erro na tela do
  // usuário — o sync segue funcionando exatamente como funcionava antes.
  if (failed || !probe) return null;

  const { tone, headline } = buildVerdict(probe, selectedFormat, overlap);
  const Icon = TONE_ICON[tone];

  const formatKind =
    probe.resolved_format === "DD/MM/YYYY"
      ? "dmy"
      : probe.resolved_format === "MM/DD/YYYY"
        ? "mdy"
        : probe.format_verdict === "conflicting" || probe.format_verdict === "ambiguous"
          ? probe.format_verdict
          : "none";
  const formatLine = t("formatLine", { kind: formatKind });
  const datesTail = probe.resolved_format ? (probe.readable_cells === probe.non_empty_cells ? "allReadable" : "someUnreadable") : "none";

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
                <span className="font-medium">{t("datesTitle")}</span>
                <p className="text-muted-foreground">
                  {t("datesFilled", { filled: probe.non_empty_cells, tail: datesTail, unreadable: probe.non_empty_cells - probe.readable_cells })}
                  {probe.unparseable_samples.length > 0 && (
                    <> {t("examples", { samples: probe.unparseable_samples.map((s) => `"${s}"`).join(", ") })}</>
                  )}
                </p>
              </div>
              <div>
                <span className="font-medium">{t("formatTitle")}</span>
                <p className="text-muted-foreground">{formatLine}</p>
              </div>
              {probe.date_min && (
                <div>
                  <span className="font-medium">{t("periodTitle")}</span>
                  <p className="text-muted-foreground">
                    {t("sheetRange", { from: br(probe.date_min), to: br(probe.date_max) })}
                    {packDateStart && packDateStop ? (
                      <>
                        {" · "}{t("packRange", { from: br(packDateStart), to: br(packDateStop) })}
                        {overlap != null && (
                          <>
                            {" · "}
                            {overlap === 0 ? t("noCommonDays") : t("commonDays", { count: overlap })}
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

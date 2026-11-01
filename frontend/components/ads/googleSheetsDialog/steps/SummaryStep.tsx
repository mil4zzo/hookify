"use client";

import { useTranslations } from "next-intl";
import { formatLocaleDate, formatLocaleNumber } from "@/lib/i18n/locale";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { IconCheck, IconRefresh, IconInfoCircle, IconAlertTriangle } from "@tabler/icons-react";
import { InlineNotice } from "@/components/common/States";
import { SheetSyncResponse } from "@/lib/api/schemas";

interface SummaryStepProps {
  stats: SheetSyncResponse["stats"];
  isImporting: boolean;
  onSyncAgain: () => void;
  onClose: () => void;
}

/** YYYY-MM-DD → DD/MM (MM/DD em inglês). Datas do backend vêm em ISO. */
function brShort(iso?: string | null): string {
  if (!iso) return "—";
  const [, m, d] = iso.split("-");
  return m && d ? formatLocaleDate(`${iso}T00:00:00`, { day: "2-digit", month: "2-digit" }) : iso;
}

export function SummaryStep({ stats, isImporting, onSyncAgain, onClose }: SummaryStepProps) {
  const t = useTranslations("ads.summaryStep");
  const fmt = (v: number) => formatLocaleNumber(v);
  const total = stats.processed_rows;
  const invalidas = stats.skipped_invalid;
  const validas = total - invalidas;
  const utilizadas = stats.utilized_sheet_rows ?? stats.updated_rows;
  const ignoradas = stats.skipped_sheet_rows ?? stats.skipped_no_match;
  const unicas = stats.matched_unique_pairs ?? stats.updated_rows;

  const pct = (v: number) => (total > 0 ? ((v / total) * 100).toFixed(1) : "0.0");
  const customColumns = Object.entries(stats.custom_columns ?? {});

  // Um sync que rodou inteiro e não aplicou nenhuma linha não é sucesso: era
  // exatamente esse card verde que fazia o desencontro de planilha passar batido.
  const outcome = stats.sync_outcome ?? (stats.updated_rows > 0 ? "success" : "no_match");
  const isSuccess = outcome === "success";

  return (
    // Fora do sucesso o card fica neutro e quem carrega a cor é o InlineNotice abaixo:
    // um card inteiro amarelo competiria com o próprio aviso que ele contém.
    <div className={isSuccess ? "border border-success-30 bg-success-10 rounded-lg p-6" : "border border-border rounded-lg p-6"}>
      <h3 className={isSuccess ? "font-semibold text-lg flex items-center gap-2 text-success mb-4" : "font-semibold text-lg flex items-center gap-2 text-warning mb-4"}>
        {isSuccess ? <IconCheck className="w-5 h-5" /> : <IconAlertTriangle className="w-5 h-5" />}
        {isSuccess
          ? t("titleSuccess")
          : outcome === "empty"
            ? t("titleEmpty")
            : t("titleNoRows")}
      </h3>
      <div className="space-y-4">
        {/* Renomeacao na origem: informa sempre, inclusive num sync que deu certo —
            trocar o nome costuma acompanhar trocar o conteudo. */}
        {stats.spreadsheet_renamed_from && (
          <InlineNotice tone="info">
            {t.rich("renamed", {
              from: stats.spreadsheet_renamed_from,
              to: stats.spreadsheet_name ?? "",
              old: (c) => <span className="line-through">{c}</span>,
              new: (c) => <span className="font-medium">{c}</span>,
            })}
          </InlineNotice>
        )}
        {/* O motivo vem pronto do backend: ele é quem sabe comparar a janela da
            planilha com a do pack. Aqui só exibe. */}
        {!isSuccess && stats.outcome_message && (
          <InlineNotice tone={outcome === "empty" ? "info" : "warning"}>
            {stats.outcome_message}
            {stats.sheet_date_min && stats.pack_date_start && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted-foreground">
                <span>{t("sheetRange", { from: brShort(stats.sheet_date_min), to: brShort(stats.sheet_date_max) })}</span>
                <span>{t("packRange", { from: brShort(stats.pack_date_start), to: brShort(stats.pack_date_stop) })}</span>
              </div>
            )}
          </InlineNotice>
        )}
        {/* Total de linhas processadas */}
        <div className="text-center">
          <div className="text-sm text-muted-foreground mb-1">{t("processed")}</div>
          <div className="text-2xl font-bold">{fmt(total)}</div>
        </div>

        {/* Grupos de métricas */}
        <div className="flex flex-col">
          <TooltipProvider>
            {/* Válidas */}
            <div className="flex items-center justify-between py-2 border-b border-border">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-foreground">{t("valid")}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <IconInfoCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t("validHint")}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{fmt(validas)}</span>
                <span className="text-xs text-muted-foreground">({pct(validas)}%)</span>
              </div>
            </div>
            {/* Utilizadas */}
            <div className="flex items-center justify-between py-2 border-b border-border">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-foreground pl-3">{t("used")}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <IconInfoCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t("usedHint")}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-success">{fmt(utilizadas)}</span>
                <span className="text-xs text-muted-foreground">({pct(utilizadas)}%)</span>
              </div>
            </div>
            {/* Únicas */}
            <div className="flex items-center justify-between py-2 border-b border-border">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-foreground pl-6">{t("unique")}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <IconInfoCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t("uniqueHint")}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-success-70">{fmt(unicas)}</span>
                <span className="text-xs text-muted-foreground">({pct(unicas)}%)</span>
              </div>
            </div>
            {/* Ignoradas */}
            <div className="flex items-center justify-between py-2 border-b border-border">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-foreground pl-3">{t("ignored")}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <IconInfoCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t("ignoredHint")}</p>
                    {stats.ids_not_found_count != null && stats.ids_out_of_pack_count != null && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("notFound", { notFound: stats.ids_not_found_count, outOfPack: stats.ids_out_of_pack_count })}
                      </p>
                    )}
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-warning">{fmt(ignoradas)}</span>
                <span className="text-xs text-muted-foreground">({pct(ignoradas)}%)</span>
              </div>
            </div>
            {/* Inválidas */}
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-foreground">{t("invalid")}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <IconInfoCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t("invalidHint")}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-destructive">{fmt(invalidas)}</span>
                <span className="text-xs text-muted-foreground">({pct(invalidas)}%)</span>
              </div>
            </div>
          </TooltipProvider>
        </div>

        {/* 140: o que o sync fez com cada coluna vinculada */}
        {customColumns.length > 0 && (
          <div className="rounded-md border border-border bg-background p-3 space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">{t("extraColumns")}</div>
            {customColumns.map(([id, report]) => (
              <div key={id} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">
                  {report.label || id}
                  <span className="text-2xs text-muted-foreground"> · {t("kind", { kind: report.kind === "leadscore" || report.kind === "category" ? report.kind : "number" })}</span>
                </span>
                {report.invalid_reason ? (
                  <span className="shrink-0 text-2xs text-warning">{t("ignoredReason", { reason: report.invalid_reason })}</span>
                ) : (
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                    {t("values", { count: fmt(report.values ?? 0) })}
                    {report.skipped ? t("skippedCells", { count: fmt(report.skipped) }) : ""}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onSyncAgain} disabled={isImporting} className="flex items-center gap-2">
            <IconRefresh className="w-4 h-4" />
            {t("syncAgain")}
          </Button>
          <Button type="button" variant="default" onClick={onClose} disabled={isImporting}>
            {t("close")}
          </Button>
        </div>
      </div>
    </div>
  );
}

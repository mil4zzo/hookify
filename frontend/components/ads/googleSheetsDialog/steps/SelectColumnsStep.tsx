"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { translate } from "@/lib/i18n/translate";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { IconChevronLeft, IconLoader2, IconAlertTriangle, IconPlus, IconX, IconLock } from "@tabler/icons-react";
import type { SheetColumnKind, DateColumnProbe } from "@/lib/api/schemas";
import { DateColumnHealth } from "../DateColumnHealth";
import { classifySampleValues, CATEGORY_MAX_DISTINCT } from "@/lib/utils/sheetColumnSamples";

export interface ColumnWithIndex {
  name: string;
  index: number;
  label: string;
}

/**
 * Coluna adicional em edição no dialog (migration 140). `serverId` presente = vínculo
 * já gravado: tipo e coluna ficam travados (decisão de mão única); rótulo, corte e
 * exclusão continuam livres.
 */
export interface ExtraColumnDraft {
  /** id local, estável enquanto o dialog está aberto */
  key: string;
  serverId?: string;
  /** valor do Combobox: "nome" ou "nome|índice" (duplicatas) */
  columnValue: string;
  /** índice conhecido (vínculo gravado, ou resolvido pelo cabeçalho) */
  columnIndex: number | null;
  label: string;
  kind: SheetColumnKind | "";
  mqlMin: string;
}

// Rótulos curtos: a coluna do seletor é estreita e truncava ("Leadscore (com corte…").
// O que o tipo leadscore tem de diferente aparece logo abaixo, no campo do corte.
const kindLabel = (kind: SheetColumnKind): string => translate("ads.selectColumns.kind", { kind });

interface SelectColumnsStepProps {
  /** Colunas simples (fallback quando columnsWithIndices vazio) */
  columns: string[];
  /** Colunas com índice e label para desambiguação de duplicatas */
  columnsWithIndices?: ColumnWithIndex[];
  /** Nomes de colunas que aparecem mais de uma vez: { "Leadscore": [1, 3] } */
  duplicates?: Record<string, number[]>;
  /** Amostra de linhas (linhas 2-10) para ajudar a escolher colunas duplicadas e sugerir tipo */
  sampleRows?: string[][];
  adIdColumn: string;
  dateColumn: string;
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "";
  /** Sondagem da coluna de data escolhida (formato provado + janela real). */
  dateProbe: DateColumnProbe | null;
  isProbingDate: boolean;
  dateProbeFailed: boolean;
  packDateStart?: string | null;
  packDateStop?: string | null;
  leadscoreColumn: string;
  /** Corte de MQL do pack. String vazia = ainda nao definido. */
  mqlLeadscoreMin: string;
  /** 140: colunas adicionais vinculadas */
  extraColumns: ExtraColumnDraft[];
  onExtraColumnsChange: (next: ExtraColumnDraft[]) => void;
  isSaving: boolean;
  isImporting: boolean;
  importStep: "idle" | "saving" | "reading" | "processing" | "complete";
  importProgress: number;
  canImport: boolean;
  onAdIdColumnChange: (value: string) => void;
  onDateColumnChange: (value: string) => void;
  onDateFormatChange: (value: "DD/MM/YYYY" | "MM/DD/YYYY") => void;
  onLeadscoreColumnChange: (value: string) => void;
  onMqlLeadscoreMinChange: (value: string) => void;
  onBack: () => void;
  onImport: () => void;
}

function buildColumnOptions(columns: string[], columnsWithIndices?: ColumnWithIndex[]): { label: string; value: string }[] {
  if (columnsWithIndices && columnsWithIndices.length > 0) {
    return columnsWithIndices.map((c) => ({
      label: c.label,
      value: c.label !== c.name ? `${c.name}|${c.index}` : c.name,
    }));
  }
  return columns.map((c) => ({ label: c, value: c }));
}

function indexToColumnLetter(idx: number): string {
  let result = "";
  let n = idx + 1;
  while (n > 0) {
    n -= 1;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

/** "nome|idx" → índice; "nome" → índice pelo cabeçalho (primeira ocorrência). */
export function resolveColumnIndex(value: string, columnsWithIndices: ColumnWithIndex[]): number | null {
  if (!value) return null;
  const cut = value.lastIndexOf("|");
  if (cut >= 0) {
    const idx = parseInt(value.slice(cut + 1), 10);
    if (Number.isFinite(idx)) return idx;
  }
  const name = cut >= 0 ? value.slice(0, cut) : value;
  const found = columnsWithIndices.find((c) => c.name === name);
  return found ? found.index : null;
}

let draftSeq = 0;
export function newExtraColumnDraft(): ExtraColumnDraft {
  draftSeq += 1;
  return { key: `draft_${Date.now().toString(36)}_${draftSeq}`, columnValue: "", columnIndex: null, label: "", kind: "", mqlMin: "" };
}

interface SamplePreviewTableProps {
  duplicates: Record<string, number[]>;
  columnsWithIndices: ColumnWithIndex[];
  sampleRows: string[][];
}

function SamplePreviewTable({ duplicates, columnsWithIndices, sampleRows }: SamplePreviewTableProps) {
  const t = useTranslations("ads.selectColumns");
  const indexToLabel = new Map(columnsWithIndices.map((c) => [c.index, c.label]));
  const duplicateColumns: { label: string; index: number }[] = [];
  for (const indices of Object.values(duplicates)) {
    for (const idx of indices) {
      const label = indexToLabel.get(idx) ?? t("unnamedColumn", { letter: indexToColumnLetter(idx), idx });
      duplicateColumns.push({ label, index: idx });
    }
  }

  const maxPreviewRows = 5;

  return (
    <div className="rounded-md border border-border bg-background overflow-hidden">
      <p className="text-xs font-medium px-3 py-2 text-muted-foreground border-b border-border">
        {t("samplePreview", { max: maxPreviewRows })}
      </p>
      <div className="overflow-x-auto max-h-48 overflow-y-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              {duplicateColumns.map(({ label }) => (
                <th key={label} className="text-left px-3 py-2 font-medium border-b border-border bg-background sticky top-0">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sampleRows.slice(0, maxPreviewRows).map((row, rowIdx) => (
              <tr key={rowIdx} className="border-b border-border hover:bg-muted">
                {duplicateColumns.map(({ index }) => (
                  <td key={`${rowIdx}-${index}`} className="px-3 py-1.5 text-muted-foreground">
                    {row[index] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * O que a amostra diz sobre uma coluna: sugere o tipo e recusa texto livre.
 * Devolve `null` sem coluna escolhida ou sem célula preenchida na amostra.
 */
export function describeSample(columnIndex: number | null, sampleRows: string[][]): { suggested: SheetColumnKind | "text" | null; distinct: number; nonEmpty: number } | null {
  if (columnIndex == null) return null;
  const values = sampleRows.map((row) => row[columnIndex] ?? "");
  const info = classifySampleValues(values);
  if (info.nonEmpty === 0) return null;
  return info;
}

/** Motivo de o vínculo não estar pronto para salvar (texto para o usuário), ou null. */
export function extraColumnProblem(draft: ExtraColumnDraft, sampleRows: string[][], reservedIndices: Set<number>): string | null {
  if (!draft.columnValue) return translate("ads.selectColumns.problemPickColumn");
  if (draft.columnIndex != null && reservedIndices.has(draft.columnIndex)) return translate("ads.selectColumns.problemReserved");
  const sample = describeSample(draft.columnIndex, sampleRows);
  if (sample?.suggested === "text") return translate("ads.selectColumns.problemFreeText", { max: CATEGORY_MAX_DISTINCT });
  if (!draft.kind) return translate("ads.selectColumns.problemPickKind");
  if ((draft.kind === "number" || draft.kind === "leadscore") && sample && sample.suggested === "category") {
    return translate("ads.selectColumns.problemNotNumbers");
  }
  if (!draft.label.trim()) return translate("ads.selectColumns.problemGiveName");
  if (draft.kind === "leadscore") {
    const n = Number(draft.mqlMin.trim());
    if (!draft.mqlMin.trim() || !Number.isFinite(n) || n < 0) return translate("ads.selectColumns.problemMqlRequired");
  }
  return null;
}

function ExtraColumnRow({
  draft,
  columnOptions,
  columnsWithIndices,
  sampleRows,
  reservedIndices,
  disabled,
  onChange,
  onRemove,
}: {
  draft: ExtraColumnDraft;
  columnOptions: { label: string; value: string }[];
  columnsWithIndices: ColumnWithIndex[];
  sampleRows: string[][];
  reservedIndices: Set<number>;
  disabled: boolean;
  onChange: (next: ExtraColumnDraft) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("ads.selectColumns");
  const locked = !!draft.serverId;
  const sample = useMemo(() => describeSample(draft.columnIndex, sampleRows), [draft.columnIndex, sampleRows]);
  const problem = extraColumnProblem(draft, sampleRows, reservedIndices);

  const hint = (() => {
    if (!draft.columnValue) return null;
    if (!sample) return t("hintEmptySample");
    if (sample.suggested === "text") return null; // vira o problema, abaixo
    if (sample.suggested === "number") return t("hintNumber");
    return t("hintCategory", { distinct: sample.distinct });
  })();

  return (
    <div className="rounded-md border border-border p-3 space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
        <div className="space-y-1 md:col-span-5">
          <label className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{t("sheetColumn")}</label>
          {locked ? (
            <div className="flex items-center gap-1.5 text-sm">
              <IconLock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate">{draft.columnValue || t("columnFallback", { letter: draft.columnIndex != null ? indexToColumnLetter(draft.columnIndex) : "?" })}</span>
            </div>
          ) : (
            <Combobox
              value={draft.columnValue}
              onValueChange={(value) => {
                const columnIndex = resolveColumnIndex(value, columnsWithIndices);
                const nextSample = describeSample(columnIndex, sampleRows);
                // Sugere o tipo pela amostra na primeira escolha; não sobrescreve o que o usuário já definiu.
                const kind: SheetColumnKind | "" = draft.kind || (nextSample?.suggested === "number" ? "number" : nextSample?.suggested === "category" ? "category" : "");
                const label = draft.label || (value.includes("|") ? value.slice(0, value.lastIndexOf("|")) : value);
                onChange({ ...draft, columnValue: value, columnIndex, kind, label });
              }}
              options={columnOptions}
              placeholder={t("select")}
              searchPlaceholder={t("searchColumn")}
            />
          )}
        </div>
        <div className="space-y-1 md:col-span-3">
          <label className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{t("type")}</label>
          {locked ? (
            <div className="flex items-center gap-1.5 text-sm">
              <IconLock className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{draft.kind ? kindLabel(draft.kind) : "—"}</span>
            </div>
          ) : (
            <Select value={draft.kind || undefined} onValueChange={(val) => onChange({ ...draft, kind: val as SheetColumnKind })} disabled={disabled}>
              <SelectTrigger size="sm">
                <SelectValue placeholder={t("choose")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="number">{kindLabel("number")}</SelectItem>
                <SelectItem value="category">{kindLabel("category")}</SelectItem>
                <SelectItem value="leadscore">{kindLabel("leadscore")}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="space-y-1 md:col-span-3">
          <label className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{t("nameInApp")}</label>
          <Input size="sm" value={draft.label} onChange={(e) => onChange({ ...draft, label: e.target.value })} placeholder={t("labelPlaceholder")} maxLength={60} disabled={disabled} />
        </div>
        <div className="flex items-end justify-end md:col-span-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="sm" onClick={onRemove} disabled={disabled} aria-label={t("removeColumn")}>
                  <IconX className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{locked ? t("deleteLink") : t("remove")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      {draft.kind === "leadscore" && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="space-y-1 md:col-span-5">
            <label className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{t("rowMqlCutoff")}</label>
            <Input size="sm" type="number" min="0" step="0.1" value={draft.mqlMin} onChange={(e) => onChange({ ...draft, mqlMin: e.target.value })} placeholder={t("rowMqlPlaceholder")} disabled={disabled} />
          </div>
        </div>
      )}
      {(problem || hint) && (
        <p className={`text-xs ${problem ? "text-warning" : "text-muted-foreground"}`}>{problem ?? hint}</p>
      )}
    </div>
  );
}

export function SelectColumnsStep({
  columns,
  columnsWithIndices = [],
  duplicates = {},
  sampleRows = [],
  adIdColumn,
  dateColumn,
  dateFormat,
  dateProbe,
  isProbingDate,
  dateProbeFailed,
  packDateStart,
  packDateStop,
  leadscoreColumn,
  isSaving,
  isImporting,
  importStep,
  importProgress,
  mqlLeadscoreMin,
  extraColumns,
  onExtraColumnsChange,
  canImport,
  onAdIdColumnChange,
  onDateColumnChange,
  onDateFormatChange,
  onLeadscoreColumnChange,
  onBack,
  onMqlLeadscoreMinChange,
  onImport,
}: SelectColumnsStepProps) {
  const t = useTranslations("ads.selectColumns");
  const columnOptions = buildColumnOptions(columns, columnsWithIndices);
  const hasDuplicates = Object.keys(duplicates).length > 0;
  const busy = isSaving || isImporting;

  // Colunas de anúncio e data não podem ser vinculadas; a de leadscore PODE (é assim
  // que se compara o leadscore V1 com um V2 lado a lado).
  const reservedIndices = useMemo(() => {
    const set = new Set<number>();
    for (const value of [adIdColumn, dateColumn]) {
      const idx = resolveColumnIndex(value, columnsWithIndices);
      if (idx != null) set.add(idx);
    }
    return set;
  }, [adIdColumn, dateColumn, columnsWithIndices]);

  const updateDraft = (key: string, next: ExtraColumnDraft) => onExtraColumnsChange(extraColumns.map((d) => (d.key === key ? next : d)));
  const removeDraft = (key: string) => onExtraColumnsChange(extraColumns.filter((d) => d.key !== key));

  return (
    <>
      <h3 className="font-semibold text-lg flex items-center gap-2">{t("title")}</h3>

      {hasDuplicates && (
        <Alert variant="default" className="border-warning-50 bg-warning-10">
          <IconAlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {t("duplicatesAlert")}
          </AlertDescription>
        </Alert>
      )}

      {hasDuplicates && sampleRows.length > 0 && columnsWithIndices.length > 0 && (
        <SamplePreviewTable
          duplicates={duplicates}
          columnsWithIndices={columnsWithIndices}
          sampleRows={sampleRows}
        />
      )}

      {columnOptions.length === 0 ? (
        <div className="text-sm text-muted-foreground">{t("loadingColumns")}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("adId")}</label>
              <Combobox value={adIdColumn} onValueChange={onAdIdColumnChange} options={columnOptions} placeholder={t("select")} searchPlaceholder={t("searchColumn")} />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t("leadscore")}</label>
              <Combobox value={leadscoreColumn} onValueChange={onLeadscoreColumnChange} options={columnOptions} placeholder={t("select")} searchPlaceholder={t("searchColumn")} />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t("mqlMin")}</label>
              <Input
                type="number"
                min="0"
                step="0.1"
                value={mqlLeadscoreMin}
                onChange={(e) => onMqlLeadscoreMinChange(e.target.value)}
                placeholder={t("mqlPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">
                {t("mqlHelp")}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t("date")}</label>
              <Combobox value={dateColumn} onValueChange={onDateColumnChange} options={columnOptions} placeholder={t("select")} searchPlaceholder={t("searchColumn")} />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t("dateFormat")}</label>
              <Select value={dateFormat} onValueChange={(val) => onDateFormatChange(val as "DD/MM/YYYY" | "MM/DD/YYYY")}>
                <SelectTrigger>
                  <SelectValue placeholder={t("dateFormatPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                  <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                </SelectContent>
              </Select>
              {/* Uma linha só; o detalhe fica no tooltip. */}
              <DateColumnHealth
                probe={dateProbe}
                isProbing={isProbingDate}
                failed={dateProbeFailed}
                selectedFormat={dateFormat}
                packDateStart={packDateStart}
                packDateStop={packDateStop}
              />
            </div>
          </div>

          {/* 140: colunas adicionais */}
          <div className="space-y-3 pt-4 border-t border-border">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <h4 className="text-sm font-medium">{t("extraTitle")}</h4>
                <p className="text-xs text-muted-foreground">
                  {t("extraHelp")}
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => onExtraColumnsChange([...extraColumns, newExtraColumnDraft()])} disabled={busy}>
                <IconPlus className="h-4 w-4" />
                {t("addColumn")}
              </Button>
            </div>
            {extraColumns.length > 0 && (
              <div className="space-y-2">
                {extraColumns.map((draft) => (
                  <ExtraColumnRow
                    key={draft.key}
                    draft={draft}
                    columnOptions={columnOptions}
                    columnsWithIndices={columnsWithIndices}
                    sampleRows={sampleRows}
                    reservedIndices={reservedIndices}
                    disabled={busy}
                    onChange={(next) => updateDraft(draft.key, next)}
                    onRemove={() => removeDraft(draft.key)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Ações do Step 3 */}
      <div className="space-y-3 pt-4 border-t border-border">
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onBack} className="flex items-center gap-1 text-muted-foreground hover:text-foreground" disabled={busy}>
            <IconChevronLeft className="w-4 h-4" />
            {t("back")}
          </Button>
          <Button type="button" onClick={onImport} disabled={!canImport || busy}>
            {isSaving ? (
              <span className="flex items-center gap-2">
                <IconLoader2 className="w-4 h-4 animate-spin" />
                {t("saving")}
              </span>
            ) : isImporting ? (
              <span className="flex items-center gap-2">
                <IconLoader2 className="w-4 h-4 animate-spin" />
                {t("applying")}
              </span>
            ) : (
              t("start")
            )}
          </Button>
        </div>
      </div>
    </>
  );
}

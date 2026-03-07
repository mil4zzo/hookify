"use client";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { IconChevronLeft, IconLoader2, IconAlertTriangle } from "@tabler/icons-react";

export interface ColumnWithIndex {
  name: string;
  index: number;
  label: string;
}

interface SelectColumnsStepProps {
  /** Colunas simples (fallback quando columnsWithIndices vazio) */
  columns: string[];
  /** Colunas com índice e label para desambiguação de duplicatas */
  columnsWithIndices?: ColumnWithIndex[];
  /** Nomes de colunas que aparecem mais de uma vez: { "Leadscore": [1, 3] } */
  duplicates?: Record<string, number[]>;
  /** Amostra de linhas (linhas 2-10) para ajudar a escolher colunas duplicadas */
  sampleRows?: string[][];
  adIdColumn: string;
  dateColumn: string;
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY";
  leadscoreColumn: string;
  cprMaxColumn: string;
  isSaving: boolean;
  isImporting: boolean;
  importStep: "idle" | "saving" | "reading" | "processing" | "complete";
  importProgress: number;
  canImport: boolean;
  onAdIdColumnChange: (value: string) => void;
  onDateColumnChange: (value: string) => void;
  onDateFormatChange: (value: "DD/MM/YYYY" | "MM/DD/YYYY") => void;
  onLeadscoreColumnChange: (value: string) => void;
  onCprMaxColumnChange: (value: string) => void;
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

interface SamplePreviewTableProps {
  duplicates: Record<string, number[]>;
  columnsWithIndices: ColumnWithIndex[];
  sampleRows: string[][];
}

function SamplePreviewTable({ duplicates, columnsWithIndices, sampleRows }: SamplePreviewTableProps) {
  const indexToLabel = new Map(columnsWithIndices.map((c) => [c.index, c.label]));
  const duplicateColumns: { label: string; index: number }[] = [];
  for (const indices of Object.values(duplicates)) {
    for (const idx of indices) {
      const label = indexToLabel.get(idx) ?? `${indexToColumnLetter(idx)} (índice ${idx})`;
      duplicateColumns.push({ label, index: idx });
    }
  }

  const maxPreviewRows = 5;

  return (
    <div className="rounded-md border border-border bg-muted/30 overflow-hidden">
      <p className="text-xs font-medium px-3 py-2 text-muted-foreground bg-muted/50">
        Amostra das colunas duplicadas (até {maxPreviewRows} linhas) — use para identificar qual coluna escolher
      </p>
      <div className="overflow-x-auto max-h-48 overflow-y-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              {duplicateColumns.map(({ label }) => (
                <th key={label} className="text-left px-3 py-2 font-medium border-b border-border bg-background/80 sticky top-0">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sampleRows.slice(0, maxPreviewRows).map((row, rowIdx) => (
              <tr key={rowIdx} className="border-b border-border/50 hover:bg-muted/20">
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

export function SelectColumnsStep({
  columns,
  columnsWithIndices = [],
  duplicates = {},
  sampleRows = [],
  adIdColumn,
  dateColumn,
  dateFormat,
  leadscoreColumn,
  cprMaxColumn,
  isSaving,
  isImporting,
  importStep,
  importProgress,
  canImport,
  onAdIdColumnChange,
  onDateColumnChange,
  onDateFormatChange,
  onLeadscoreColumnChange,
  onCprMaxColumnChange,
  onBack,
  onImport,
}: SelectColumnsStepProps) {
  const columnOptions = buildColumnOptions(columns, columnsWithIndices);
  const hasDuplicates = Object.keys(duplicates).length > 0;

  return (
    <>
      <h3 className="font-semibold text-lg flex items-center gap-2">Selecionar colunas</h3>

      {hasDuplicates && (
        <Alert variant="default" className="border-amber-500/50 bg-amber-500/5">
          <IconAlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Esta planilha possui colunas com nomes duplicados. Selecione a coluna correta em cada campo (ex: &quot;Leadscore (coluna B)&quot;).
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
        <div className="text-sm text-muted-foreground">Carregando colunas...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">AD ID</label>
            <Combobox value={adIdColumn} onValueChange={onAdIdColumnChange} options={columnOptions} placeholder="Selecione..." searchPlaceholder="Buscar coluna..." />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Leadscore</label>
            <Combobox value={leadscoreColumn} onValueChange={onLeadscoreColumnChange} options={columnOptions} placeholder="Selecione..." searchPlaceholder="Buscar coluna..." />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Data</label>
            <Combobox value={dateColumn} onValueChange={onDateColumnChange} options={columnOptions} placeholder="Selecione..." searchPlaceholder="Buscar coluna..." />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Formato da data</label>
            <Select value={dateFormat} onValueChange={(val) => onDateFormatChange(val as "DD/MM/YYYY" | "MM/DD/YYYY")}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o formato de data" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Ações do Step 3 */}
      <div className="space-y-3 pt-4 border-t border-border">
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onBack} className="flex items-center gap-1 text-muted-foreground hover:text-foreground" disabled={isSaving || isImporting}>
            <IconChevronLeft className="w-4 h-4" />
            Voltar
          </Button>
          <Button type="button" onClick={onImport} disabled={!canImport || isSaving || isImporting}>
            {isSaving ? (
              <span className="flex items-center gap-2">
                <IconLoader2 className="w-4 h-4 animate-spin" />
                Salvando...
              </span>
            ) : isImporting ? (
              <span className="flex items-center gap-2">
                <IconLoader2 className="w-4 h-4 animate-spin" />
                Aplicando...
              </span>
            ) : (
              "Iniciar integração"
            )}
          </Button>
        </div>
      </div>
    </>
  );
}

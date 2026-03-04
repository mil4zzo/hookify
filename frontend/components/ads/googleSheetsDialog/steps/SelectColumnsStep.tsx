"use client";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { IconChevronLeft, IconLoader2 } from "@tabler/icons-react";

interface SelectColumnsStepProps {
  columns: string[];
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

export function SelectColumnsStep({ columns, adIdColumn, dateColumn, dateFormat, leadscoreColumn, cprMaxColumn, isSaving, isImporting, importStep, importProgress, canImport, onAdIdColumnChange, onDateColumnChange, onDateFormatChange, onLeadscoreColumnChange, onCprMaxColumnChange, onBack, onImport }: SelectColumnsStepProps) {
  const columnOptions = columns.map((c) => ({ label: c, value: c }));

  return (
    <>
      <h3 className="font-semibold text-lg flex items-center gap-2">Selecionar colunas</h3>

      {columns.length === 0 ? (
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

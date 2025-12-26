"use client";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Progress } from "@/components/ui/progress";
import { IconChevronLeft, IconLoader2, IconCheck, IconCircle } from "@tabler/icons-react";
import { SheetSyncResponse } from "@/lib/api/schemas";

interface SelectColumnsStepProps {
  columns: string[];
  adIdColumn: string;
  dateColumn: string;
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY";
  leadscoreColumn: string;
  cprMaxColumn: string;
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

export function SelectColumnsStep({ columns, adIdColumn, dateColumn, dateFormat, leadscoreColumn, cprMaxColumn, isImporting, importStep, importProgress, canImport, onAdIdColumnChange, onDateColumnChange, onDateFormatChange, onLeadscoreColumnChange, onCprMaxColumnChange, onBack, onImport }: SelectColumnsStepProps) {
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

      {/* Progresso da importação */}
      {isImporting && (
        <div className="space-y-4 pt-4 border-t border-border">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Progresso da importação</span>
              <span className="text-muted-foreground">{importProgress}%</span>
            </div>
            <Progress value={importProgress} />
          </div>

          <div className="space-y-2">
            <div className={`flex items-center gap-2 text-sm ${importStep === "saving" ? "text-primary" : importStep === "reading" || importStep === "processing" || importStep === "complete" ? "text-green-500" : "text-muted-foreground"}`}>
              {importStep === "saving" ? <IconLoader2 className="w-4 h-4 animate-spin" /> : importStep === "reading" || importStep === "processing" || importStep === "complete" ? <IconCheck className="w-4 h-4" /> : <IconCircle className="w-4 h-4" />}
              <span>Salvando configuração da integração...</span>
            </div>

            <div className={`flex items-center gap-2 text-sm ${importStep === "reading" ? "text-primary" : importStep === "processing" || importStep === "complete" ? "text-green-500" : "text-muted-foreground"}`}>
              {importStep === "reading" ? <IconLoader2 className="w-4 h-4 animate-spin" /> : importStep === "processing" || importStep === "complete" ? <IconCheck className="w-4 h-4" /> : <IconCircle className="w-4 h-4" />}
              <span>Lendo dados da planilha do Google Sheets...</span>
            </div>

            <div className={`flex items-center gap-2 text-sm ${importStep === "processing" ? "text-primary" : importStep === "complete" ? "text-green-500" : "text-muted-foreground"}`}>
              {importStep === "processing" ? <IconLoader2 className="w-4 h-4 animate-spin" /> : importStep === "complete" ? <IconCheck className="w-4 h-4" /> : <IconCircle className="w-4 h-4" />}
              <span>Processando e aplicando dados em ad_metrics...</span>
            </div>

            {importStep === "complete" && (
              <div className="flex items-center gap-2 text-sm text-green-500">
                <IconCheck className="w-4 h-4" />
                <span>Importação concluída com sucesso!</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Ações do Step 3 */}
      <div className="space-y-3 pt-4 border-t border-border">
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onBack} className="flex items-center gap-1 text-muted-foreground hover:text-foreground" disabled={isImporting}>
            <IconChevronLeft className="w-4 h-4" />
            Voltar
          </Button>
          <Button type="button" onClick={onImport} disabled={!canImport || isImporting}>
            {isImporting ? (
              <span className="flex items-center gap-2">
                <IconLoader2 className="w-4 h-4 animate-spin" />
                Aplicando...
              </span>
            ) : (
              "Aplicar"
            )}
          </Button>
        </div>
      </div>
    </>
  );
}

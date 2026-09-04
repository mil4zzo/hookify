"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { IconCheck, IconRefresh, IconInfoCircle } from "@tabler/icons-react";
import { SheetSyncResponse } from "@/lib/api/schemas";

interface SummaryStepProps {
  stats: SheetSyncResponse["stats"];
  isImporting: boolean;
  onSyncAgain: () => void;
  onClose: () => void;
}

export function SummaryStep({ stats, isImporting, onSyncAgain, onClose }: SummaryStepProps) {
  const total = stats.processed_rows;
  const invalidas = stats.skipped_invalid;
  const validas = total - invalidas;
  const utilizadas = stats.utilized_sheet_rows ?? stats.updated_rows;
  const ignoradas = stats.skipped_sheet_rows ?? stats.skipped_no_match;
  const unicas = stats.matched_unique_pairs ?? stats.updated_rows;

  const pct = (v: number) => (total > 0 ? ((v / total) * 100).toFixed(1) : "0.0");
  const customColumns = Object.entries(stats.custom_columns ?? {});

  return (
    <div className="border border-success-30 bg-success-10 rounded-lg p-6">
      <h3 className="font-semibold text-lg flex items-center gap-2 text-success mb-4">
        <IconCheck className="w-5 h-5" />
        Importação concluída com sucesso!
      </h3>
      <div className="space-y-4">
        {/* Total de linhas processadas */}
        <div className="text-center">
          <div className="text-sm text-muted-foreground mb-1">Linhas processadas</div>
          <div className="text-2xl font-bold">{total.toLocaleString()}</div>
        </div>

        {/* Grupos de métricas */}
        <div className="flex flex-col">
          <TooltipProvider>
            {/* Válidas */}
            <div className="flex items-center justify-between py-2 border-b border-border">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-foreground">Válidas</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <IconInfoCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Linhas com ad_id não nulo, data válida e leadscore não nulo</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{validas.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">({pct(validas)}%)</span>
              </div>
            </div>
            {/* Utilizadas */}
            <div className="flex items-center justify-between py-2 border-b border-border">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-foreground pl-3">Utilizadas</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <IconInfoCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Linhas válidas cujo par (ad_id, data) tem match no ad_metrics</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-success">{utilizadas.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">({pct(utilizadas)}%)</span>
              </div>
            </div>
            {/* Únicas */}
            <div className="flex items-center justify-between py-2 border-b border-border">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-foreground pl-6">Únicas</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <IconInfoCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Pares únicos (ad_id, data) atualizados no ad_metrics. Linhas com mesmo ad_id e data são agregadas em um único registro</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-success-70">{unicas.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">({pct(unicas)}%)</span>
              </div>
            </div>
            {/* Ignoradas */}
            <div className="flex items-center justify-between py-2 border-b border-border">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-foreground pl-3">Ignoradas</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <IconInfoCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Linhas válidas cujo par (ad_id, data) não tem match no ad_metrics</p>
                    {stats.ids_not_found_count != null && stats.ids_out_of_pack_count != null && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Não encontrados: {stats.ids_not_found_count} · Fora do pack: {stats.ids_out_of_pack_count}
                      </p>
                    )}
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-warning">{ignoradas.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">({pct(ignoradas)}%)</span>
              </div>
            </div>
            {/* Inválidas */}
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-foreground">Inválidas</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <IconInfoCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Linhas com ad_id nulo, data inválida ou sem leadscore</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-destructive">{invalidas.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">({pct(invalidas)}%)</span>
              </div>
            </div>
          </TooltipProvider>
        </div>

        {/* 140: o que o sync fez com cada coluna vinculada */}
        {customColumns.length > 0 && (
          <div className="rounded-md border border-border bg-background-80 p-3 space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">Colunas adicionais</div>
            {customColumns.map(([id, report]) => (
              <div key={id} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">
                  {report.label || id}
                  <span className="text-2xs text-muted-foreground"> · {report.kind === "leadscore" ? "leadscore" : report.kind === "category" ? "categoria" : "número"}</span>
                </span>
                {report.invalid_reason ? (
                  <span className="shrink-0 text-2xs text-warning">ignorada: {report.invalid_reason}</span>
                ) : (
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                    {(report.values ?? 0).toLocaleString()} valores
                    {report.skipped ? ` · ${report.skipped.toLocaleString()} célula(s) inválida(s) pulada(s)` : ""}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onSyncAgain} disabled={isImporting} className="flex items-center gap-2">
            <IconRefresh className="w-4 h-4" />
            Atualizar dados novamente
          </Button>
          <Button type="button" variant="default" onClick={onClose} disabled={isImporting}>
            Fechar
          </Button>
        </div>
      </div>
    </div>
  );
}

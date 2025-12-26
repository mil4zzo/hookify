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
  const validas = total - stats.skipped_invalid;
  const utilizadas = stats.utilized_sheet_rows ?? stats.updated_rows;
  const ignoradas = stats.skipped_sheet_rows ?? stats.skipped_no_match;
  const invalidas = stats.skipped_invalid;

  const pctValidas = total > 0 ? ((validas / total) * 100).toFixed(1) : "0.0";
  const pctUtilizadas = total > 0 ? ((utilizadas / total) * 100).toFixed(1) : "0.0";
  const pctIgnoradas = total > 0 ? ((ignoradas / total) * 100).toFixed(1) : "0.0";
  const pctInvalidas = total > 0 ? ((invalidas / total) * 100).toFixed(1) : "0.0";

  return (
    <div className="border border-green-500/30 bg-green-500/10 rounded-lg p-6">
      <h3 className="font-semibold text-lg flex items-center gap-2 text-green-500 mb-4">
        <IconCheck className="w-5 h-5" />
        Importação concluída com sucesso!
      </h3>
      <div className="space-y-4">
        {/* Total de linhas processadas */}
        <div className="text-center">
          <div className="text-sm text-muted-foreground mb-1">Linhas processadas</div>
          <div className="text-2xl font-bold">{stats.processed_rows.toLocaleString()}</div>
        </div>

        {/* Grupos de métricas */}
        <div className="flex flex-col">
          <TooltipProvider>
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
                <span className="text-xs text-muted-foreground">({pctValidas}%)</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-foreground">Utilizadas</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <IconInfoCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Linhas válidas com match por ad_id no ad_metrics</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-green-500">{utilizadas.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">({pctUtilizadas}%)</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-foreground">Ignoradas</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <IconInfoCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Linhas válidas com ad_id sem match no ad_metrics</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-yellow-500">{ignoradas.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">({pctIgnoradas}%)</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-foreground">Inválidas</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <IconInfoCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Linhas com ad_id nulo, data inválida ou leadscore nulo</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-red-500">{invalidas.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">({pctInvalidas}%)</span>
              </div>
            </div>
          </TooltipProvider>
        </div>
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

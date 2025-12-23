"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { StandardCard } from "@/components/common/StandardCard";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { IconCalendar, IconFilter, IconTrash, IconEye, IconCode, IconLoader2, IconRotateClockwise, IconRefresh, IconPencil, IconTableExport, IconBuilding } from "@tabler/icons-react";
import { FilterRule } from "@/lib/api/schemas";
import { AdsPack } from "@/lib/types";

const FILTER_FIELDS = [
  { label: "Campaign Name", value: "campaign.name" },
  { label: "Adset Name", value: "adset.name" },
  { label: "Ad Name", value: "ad.name" },
];

export interface PackCardProps {
  pack: AdsPack;
  formatCurrency: (value: number) => string;
  formatDate: (dateString: string) => string;
  formatDateTime: (dateTimeString: string) => string;
  getAccountName: (accountId: string) => string;
  // Handlers
  onRename: (packId: string) => void;
  onRefresh: (packId: string) => void;
  onRemove: (packId: string) => void;
  onToggleAutoRefresh: (packId: string, checked: boolean) => void;
  onSyncSheetIntegration: (packId: string) => void;
  onPreview: (pack: AdsPack) => void;
  onViewJson: (pack: AdsPack) => void;
  onSetSheetIntegration: (pack: AdsPack) => void;
  // Estados de loading
  isRefreshing: boolean;
  isRenaming: boolean;
  isTogglingAutoRefresh: string | null;
  packToDisableAutoRefresh: { id: string; name: string } | null;
  isSyncingSheetIntegration: string | null;
}

/**
 * Componente de card para exibir informações de um pack de anúncios.
 *
 * Estrutura organizada conforme design:
 * - Nome do pack (com menu dropdown)
 * - Date range (com ícone de calendário e seta →)
 * - Filtros (formato: ícone + campo + operador + valor)
 * - Métricas: Campanhas, Adsets, Anúncios (grid de 3 colunas)
 * - Footer: Última atualização (esquerda) + Atualização automática (direita)
 */
export function PackCard({ pack, formatCurrency, formatDate, formatDateTime, getAccountName, onRename, onRefresh, onRemove, onToggleAutoRefresh, onSyncSheetIntegration, onPreview, onViewJson, onSetSheetIntegration, isRefreshing, isRenaming, isTogglingAutoRefresh, packToDisableAutoRefresh, isSyncingSheetIntegration }: PackCardProps) {
  const stats = pack.stats;

  const getFilterFieldLabel = (fieldValue: string) => {
    const field = FILTER_FIELDS.find((f) => f.value === fieldValue);
    return field ? field.label : fieldValue;
  };

  // Calcular duração em dias
  const calculateDays = (start: string, end: string): number => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays + 1; // +1 para incluir o dia final
  };

  // Verificar se a data final é hoje
  const isToday = (dateString: string): boolean => {
    const today = new Date();
    const date = new Date(dateString);
    return date.toDateString() === today.toDateString();
  };

  const daysCount = calculateDays(pack.date_start, pack.date_stop);
  const dateEndDisplay = isToday(pack.date_stop) ? "HOJE" : formatDate(pack.date_stop);

  return (
    <div className="relative inline-block w-full">
      {/* Cards decorativos atrás */}
      <div className="absolute inset-0 rounded-xl bg-card rotate-2 pointer-events-none" />
      <div className="absolute inset-0 rounded-xl bg-secondary rotate-1 pointer-events-none" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <StandardCard variant="default" padding="none" interactive={true} className="relative flex flex-col cursor-pointer hover:opacity-90 transition-opacity z-10 w-full">
            <div className="p-6 space-y-6 flex flex-col justify-between h-full">
              <div className="flex flex-col items-center gap-1">
                {/* Header: Nome do pack */}
                <div className="flex w-full items-start justify-between gap-3">
                  <div className="flex flex-col items-center justify-center flex-1 min-w-0">
                    <h3 className="text-xl font-semibold truncate" title={pack.name}>
                      {pack.name}
                    </h3>
                  </div>
                </div>
                {/* Filtros */}
                {pack.filters && pack.filters.length > 0 && (
                  <div className="flex justify-start flex-wrap gap-2">
                    {pack.filters.map((filter: FilterRule, index: number) => (
                      <div key={index} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <IconFilter className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="font-medium text-foreground/80">{getFilterFieldLabel(filter.field)}</span>
                        <span className="opacity-60">{filter.operator.toLowerCase().replace("_", " ")}</span>
                        <span className="font-medium text-foreground/80">"{filter.value}"</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col items-center gap-2">
                <div className="flex flex-col items-center">
                  {/* Date range */}
                  <div className="flex items-center text-sm">
                    <span>
                      {formatDate(pack.date_start)} → {dateEndDisplay}
                    </span>
                  </div>
                  {/* Duração */}
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {daysCount} {daysCount === 1 ? "dia" : "dias"}
                  </div>
                </div>
                {/* Valor monetário em destaque */}
                {(() => {
                  const formatted = formatCurrency(stats?.totalSpend || 0);
                  // Extrair símbolo e número (ex: "R$ 477.518,24" -> "R$" e "477.518,24")
                  const parts = formatted.split(/\s+/);
                  const symbol = parts[0] || "R$";
                  const number = parts.slice(1).join(" ") || formatted.replace(/[^\d,.]/g, "");
                  return (
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-sm text-muted-foreground">{symbol}</span>
                      <span className="text-3xl font-bold text-green-500">{number}</span>
                    </div>
                  );
                })()}
              </div>

              {/* Métricas: Lista vertical com separadores */}
              <div className="flex flex-col">
                <div className="flex items-center justify-between py-2 border-b border-border">
                  <span className="text-sm text-foreground">Campanhas</span>
                  <span className="text-sm font-medium text-foreground">{stats?.uniqueCampaigns || 0}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-border">
                  <span className="text-sm text-foreground">Conjuntos</span>
                  <span className="text-sm font-medium text-foreground">{stats?.uniqueAdsets || 0}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-foreground">Anúncios</span>
                  <span className="text-sm font-medium text-foreground">{stats?.uniqueAds || 0}</span>
                </div>
              </div>

              {/* Footer: Toggles e última atualização */}
              <div className="flex flex-col gap-2">
                <div onClick={(e) => e.stopPropagation()}>
                  <ToggleSwitch id={`auto-refresh-${pack.id}`} checked={pack.auto_refresh || false} onCheckedChange={(checked) => onToggleAutoRefresh(pack.id, checked)} disabled={isTogglingAutoRefresh === pack.id || packToDisableAutoRefresh?.id === pack.id} labelLeft="Atualização automática:" variant="default" size="md" className="w-full justify-between" labelClassName="text-sm text-foreground" switchClassName="data-[state=checked]:bg-green-500" />
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <ToggleSwitch
                    id={`leadscore-${pack.id}`}
                    checked={!!pack.sheet_integration}
                    onCheckedChange={(checked) => {
                      if (checked && !pack.sheet_integration) {
                        onSetSheetIntegration(pack);
                      }
                    }}
                    disabled={!!pack.sheet_integration}
                    labelLeft="Leadscore"
                    variant="default"
                    size="md"
                    className="w-full justify-between"
                    labelClassName="text-sm text-foreground"
                    switchClassName="data-[state=checked]:bg-green-500"
                  />
                </div>
                <div className="flex items-center justify-between mt-3 text-xs text-foreground">
                  <span>Última atualização:</span>
                  <span>{formatDateTime(pack.updated_at)}</span>
                </div>
              </div>
            </div>
          </StandardCard>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right">
          <DropdownMenuItem onClick={() => onRename(pack.id)} disabled={isRenaming}>
            <IconPencil className="w-4 h-4 mr-2" />
            Renomear pack
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onRefresh(pack.id)} disabled={isRefreshing}>
            <IconRotateClockwise className="w-4 h-4 mr-2" />
            Atualizar pack
          </DropdownMenuItem>
          {pack.sheet_integration ? (
            <DropdownMenuItem disabled className="opacity-100">
              <IconTableExport className="w-4 h-4 mr-2 text-green-500" />
              <div className="flex flex-col items-start">
                <span className="text-xs font-medium text-green-500">Planilha conectada</span>
                <span className="text-xs text-muted-foreground">
                  {pack.sheet_integration.spreadsheet_name || "Planilha"} • {pack.sheet_integration.worksheet_title || "Aba"}
                </span>
              </div>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => onSetSheetIntegration(pack)}>
              <IconTableExport className="w-4 h-4 mr-2" />
              Enriquecer leadscore (Google Sheets)
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => onPreview(pack)}>
            <IconEye className="w-4 h-4 mr-2" />
            Visualizar tabela
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onViewJson(pack)}>
            <IconCode className="w-4 h-4 mr-2" />
            Ver JSON
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onRemove(pack.id)} className="text-red-500 focus:text-red-500 focus:bg-red-500/10">
            <IconTrash className="w-4 h-4 mr-2" />
            Remover pack
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

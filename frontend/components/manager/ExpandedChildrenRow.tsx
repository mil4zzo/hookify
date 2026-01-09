"use client";

import React, { useState, useMemo } from "react";
import { IconArrowsSort, IconSearch } from "@tabler/icons-react";
import { useAdVariations, useAdsetChildren } from "@/lib/api/hooks";
import { RankingsChildrenItem } from "@/lib/api/schemas";
import { ThumbnailImage } from "@/components/common/ThumbnailImage";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";
import { StatusCell } from "@/components/manager/StatusCell";
import { Input } from "@/components/ui/input";
import { MANAGER_COLUMN_OPTIONS, MANAGER_COLUMN_RENDER_ORDER } from "@/components/manager/managerColumns";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";

interface ExpandedChildrenRowProps {
  adName?: string;
  adsetId?: string;
  dateStart: string;
  dateStop: string;
  actionType?: string;
  formatCurrency: (n: number) => string;
  formatPct: (v: number) => string;
  activeColumns: Set<ManagerColumnType>;
  hasSheetIntegration?: boolean;
  mqlLeadscoreMin?: number;
}

// Função de comparação customizada para React.memo
function areExpandedChildrenRowPropsEqual(prev: ExpandedChildrenRowProps, next: ExpandedChildrenRowProps): boolean {
  // Verificar se os sets de colunas ativas são iguais
  const activeColumnsEqual =
    prev.activeColumns.size === next.activeColumns.size &&
    Array.from(prev.activeColumns).every((col) => next.activeColumns.has(col));

  return (
    prev.adName === next.adName &&
    prev.adsetId === next.adsetId &&
    prev.dateStart === next.dateStart &&
    prev.dateStop === next.dateStop &&
    prev.actionType === next.actionType &&
    prev.formatCurrency === next.formatCurrency &&
    prev.formatPct === next.formatPct &&
    activeColumnsEqual &&
    prev.hasSheetIntegration === next.hasSheetIntegration &&
    prev.mqlLeadscoreMin === next.mqlLeadscoreMin
  );
}

export const ExpandedChildrenRow = React.memo(function ExpandedChildrenRow({
  adName,
  adsetId,
  dateStart,
  dateStop,
  actionType,
  formatCurrency,
  formatPct,
  activeColumns,
  hasSheetIntegration = false,
  mqlLeadscoreMin = 0,
}: ExpandedChildrenRowProps) {
  // Usar hook apropriado baseado em qual prop foi fornecida
  const adVariationsQuery = useAdVariations(adName || "", dateStart, dateStop, !!adName);
  const adsetChildrenQuery = useAdsetChildren(adsetId || "", dateStart, dateStop, !!adsetId);

  // Selecionar dados do hook correto
  const { data: childrenData, isLoading, isError } = adsetId ? adsetChildrenQuery : adVariationsQuery;
  const [sortConfig, setSortConfig] = useState<{ column: string | null; direction: "asc" | "desc" }>({
    column: null,
    direction: "asc",
  });
  const [searchTerm, setSearchTerm] = useState<string>("");

  // Preparar dados com cálculos, filtrar e ordenar
  // IMPORTANTE: useMemo deve ser chamado antes de qualquer retorno condicional para seguir as regras dos Hooks
  const sortedData = useMemo(() => {
    // Se não há dados, retornar array vazio
    if (!childrenData || childrenData.length === 0) {
      return [];
    }
    const dataWithCalculations = childrenData.map((child: RankingsChildrenItem) => {
      const lpv = Number(child.lpv || 0);
      const spend = Number(child.spend || 0);
      const impressions = Number(child.impressions || 0);
      // O backend pode não retornar conversions agregadas, então calcular a partir das séries se disponível
      let conversions = child.conversions || {};
      // Se conversions está vazio mas temos séries, calcular total a partir das séries
      if (Object.keys(conversions).length === 0 && child.series?.conversions) {
        const seriesConversions = child.series.conversions;
        conversions = {};
        // Somar todas as conversões de todos os dias da série
        for (const dayConversions of seriesConversions) {
          if (dayConversions && typeof dayConversions === "object") {
            for (const [actionType, value] of Object.entries(dayConversions)) {
              if (!conversions[actionType]) {
                conversions[actionType] = 0;
              }
              conversions[actionType] += Number(value || 0);
            }
          }
        }
      }
      // Calcular results: usar actionType se disponível, senão 0 (mesma lógica da linha principal)
      const results = actionType && typeof actionType === "string" && actionType.trim() ? Number(conversions[actionType] || 0) : 0;
      // Calcular page_conv: mesmo cálculo da linha principal
      const page_conv = lpv > 0 ? results / lpv : 0;
      // Calcular cpr: mesmo cálculo da linha principal
      const cpr = results > 0 ? spend / results : 0;
      // Usar cpm do backend se disponível, senão calcular
      // cpm sempre vem do backend
      const cpm = typeof child.cpm === "number" ? child.cpm : 0;
      // Calcular MQLs (leads com leadscore >= mqlLeadscoreMin)
      const childAny = child as any;
      const mqls = hasSheetIntegration && childAny.leads && Array.isArray(childAny.leads)
        ? childAny.leads.filter((lead: any) => Number(lead.leadscore || 0) >= mqlLeadscoreMin).length
        : 0;
      // Calcular CPMQL (custo por MQL)
      const cpmql = mqls > 0 ? spend / mqls : 0;
      // Calcular website_ctr (inline_link_clicks / impressions)
      const inline_link_clicks = Number(child.inline_link_clicks || 0);
      const website_ctr = impressions > 0 ? inline_link_clicks / impressions : 0;
      return {
        ...child,
        conversions,
        results,
        page_conv,
        cpr,
        cpm,
        lpv,
        spend,
        impressions,
        mqls,
        cpmql,
        website_ctr,
        ad_count: 1, // Cada child é um anúncio individual
      };
    });

    // Filtrar por termo de busca
    const filteredData = searchTerm.trim()
      ? dataWithCalculations.filter((child) => {
          const search = searchTerm.toLowerCase();
          const campaignName = String(child.campaign_name || "").toLowerCase();
          const adsetName = String(child.adset_name || "").toLowerCase();
          const adId = String(child.ad_id || "").toLowerCase();
          return campaignName.includes(search) || adsetName.includes(search) || adId.includes(search);
        })
      : dataWithCalculations;

    if (!sortConfig.column) {
      return filteredData;
    }

    const sorted = [...filteredData].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (sortConfig.column) {
        case "ad_id":
          aVal = String(a.ad_id || "");
          bVal = String(b.ad_id || "");
          break;
        case "hook":
          aVal = Number(a.hook || 0);
          bVal = Number(b.hook || 0);
          break;
        case "cpr":
          aVal = a.cpr || 0;
          bVal = b.cpr || 0;
          break;
        case "cpmql":
          aVal = a.cpmql || 0;
          bVal = b.cpmql || 0;
          break;
        case "spend":
          aVal = a.spend || 0;
          bVal = b.spend || 0;
          break;
        case "ctr":
          aVal = Number(a.ctr || 0);
          bVal = Number(b.ctr || 0);
          break;
        case "website_ctr":
          aVal = Number(a.website_ctr || 0);
          bVal = Number(b.website_ctr || 0);
          break;
        case "cpm":
          aVal = a.cpm || 0;
          bVal = b.cpm || 0;
          break;
        case "connect_rate":
          aVal = Number(a.connect_rate || 0);
          bVal = Number(b.connect_rate || 0);
          break;
        case "page_conv":
          aVal = a.page_conv || 0;
          bVal = b.page_conv || 0;
          break;
        case "results":
          aVal = a.results || 0;
          bVal = b.results || 0;
          break;
        case "mqls":
          aVal = a.mqls || 0;
          bVal = b.mqls || 0;
          break;
        default:
          return 0;
      }

      if (typeof aVal === "string") {
        return sortConfig.direction === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
    });

    return sorted;
  }, [childrenData, sortConfig, actionType, searchTerm, hasSheetIntegration, mqlLeadscoreMin]);

  const handleSort = (column: string) => {
    setSortConfig((prev) => {
      if (prev.column === column) {
        // Se já está ordenando por esta coluna, inverter direção
        return { column, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      // Nova coluna: começar com desc (exceto para ad_id que começa com asc)
      return { column, direction: column === "ad_id" ? "asc" : "desc" };
    });
  };

  // Gerar lista de colunas visíveis na ordem correta (mesma ordem da tabela principal)
  const visibleColumns = useMemo(() => {
    // Usar MANAGER_COLUMN_RENDER_ORDER para manter a ordem da tabela principal
    return MANAGER_COLUMN_RENDER_ORDER
      .filter(colId => {
        // Filtrar colunas que dependem de sheet integration
        if ((colId === "cpmql" || colId === "mqls") && !hasSheetIntegration) {
          return false;
        }
        return activeColumns.has(colId);
      })
      .map(colId => {
        // Encontrar o objeto completo da coluna em MANAGER_COLUMN_OPTIONS
        const col = MANAGER_COLUMN_OPTIONS.find(c => c.id === colId);
        return col!; // Safe porque sabemos que existe
      });
  }, [activeColumns, hasSheetIntegration]);

  // Calcular colspan:
  // A tabela pai tem: Status (opcional) + Ad Name + métricas visíveis
  // - Na aba "por-anuncio" (adName): não tem coluna Status -> 1 + visibleColumns.length
  // - Na aba "por-conjunto" (adsetId): tem coluna Status -> 2 + visibleColumns.length
  const colspan = visibleColumns.length + (adsetId ? 2 : 1);

  // Função helper para renderizar o valor de uma célula
  const renderCellValue = (child: any, columnId: ManagerColumnType) => {
    switch (columnId) {
      case "hook":
        return formatPct(Number(child.hook * 100));
      case "cpr":
        return child.results > 0 ? formatCurrency(child.cpr) : "—";
      case "cpmql":
        return child.mqls > 0 ? formatCurrency(child.cpmql) : "—";
      case "spend":
        return formatCurrency(child.spend);
      case "ctr":
        return formatPct(Number(child.ctr * 100));
      case "website_ctr":
        return formatPct(Number(child.website_ctr * 100));
      case "cpm":
        return formatCurrency(child.cpm);
      case "connect_rate":
        return formatPct(Number(child.connect_rate * 100));
      case "page_conv":
        return child.lpv > 0 ? formatPct(Number(child.page_conv * 100)) : "—";
      case "results":
        return child.results > 0 ? child.results.toLocaleString("pt-BR") : "—";
      case "mqls":
        return child.mqls > 0 ? child.mqls.toLocaleString("pt-BR") : "—";
      default:
        return "—";
    }
  };

  const childMetricsColumnClass = `px-4 py-3 text-center cursor-pointer select-none hover:text-brand`;

  // Retornos condicionais após todos os hooks
  if (isLoading) {
    return (
      <tr className="bg-border">
        <td className="p-0" colSpan={colspan}>
          <div className="p-2 pl-8">
            <div className="text-sm text-muted-foreground">Carregando variações...</div>
          </div>
        </td>
      </tr>
    );
  }

  if (isError) {
    return (
      <tr className="bg-border">
        <td className="p-0" colSpan={colspan}>
          <div className="p-2 pl-8">
            <div className="text-sm text-destructive">Erro ao carregar variações.</div>
          </div>
        </td>
      </tr>
    );
  }

  if (!childrenData || childrenData.length === 0) {
    return (
      <tr className="bg-border">
        <td className="p-0" colSpan={colspan}>
          <div className="p-2 pl-8">
            <div className="text-sm text-muted-foreground">Sem variações no período.</div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="bg-card">
      <td className="p-0" colSpan={colspan}>
        <div className="">
          {/* Campo de busca para filtrar variações */}
          <div className="px-4 py-3 bg-muted/50">
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <IconSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  type="search"
                  placeholder="Buscar variações por campanha, conjunto ou ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 h-9 text-xs"
                />
              </div>
              {searchTerm.trim() && (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {sortedData.length} de {childrenData?.length || 0} variações
                </span>
              )}
            </div>
          </div>
          {searchTerm.trim() && sortedData.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-muted-foreground">Nenhuma variação encontrada para "{searchTerm}"</p>
              <button
                onClick={() => setSearchTerm("")}
                className="mt-2 text-xs text-primary hover:underline"
              >
                Limpar busca
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-border">
                  <th className="p-4 text-center w-20"></th>
                  <th
                    className={`p-4 text-left cursor-pointer select-none hover:text-brand ${
                      sortConfig.column === "ad_id" ? "text-primary" : ""
                    }`}
                    onClick={() => handleSort("ad_id")}
                  >
                    <div className="flex items-center gap-1">
                      Variações
                      <IconArrowsSort className="w-3 h-3" />
                    </div>
                  </th>
                  {visibleColumns.map((col) => (
                    <th
                      key={col.id}
                      className={`${childMetricsColumnClass} ${sortConfig.column === col.id ? "text-primary" : ""}`}
                      onClick={() => handleSort(col.id)}
                    >
                      <div className="flex items-center justify-center gap-1">
                        {col.name}
                        <IconArrowsSort className="w-3 h-3" />
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedData.map((child) => {
                  return (
                    <tr key={child.ad_id} className="hover:bg-muted border-b border-border">
                      <td className="px-4 py-3 text-center">
                        <StatusCell
                          original={child}
                          currentTab="individual"
                        />
                      </td>
                      <td className="px-4 py-3 text-left">
                        <div className="flex items-center gap-2">
                          <ThumbnailImage src={getAdThumbnail(child)} alt="thumb" size="sm" />
                          <div className="flex-1 min-w-0">
                            {adsetId ? (
                              <>
                                <div className="truncate text-xs font-medium">{child.ad_name || "Sem nome"}</div>
                                <div className="flex items-center gap-2 truncate">
                                  <span className="text-xs text-muted-foreground truncate">{child.campaign_name}</span>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="truncate text-xs font-medium">{child.adset_name}</div>
                                <div className="flex items-center gap-2 truncate">
                                  <span className="text-xs text-muted-foreground truncate">{child.campaign_name}</span>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </td>
                      {visibleColumns.map((col) => (
                        <td key={col.id} className="p-2 text-center">
                          {renderCellValue(child, col.id)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </div>
      </td>
    </tr>
  );
}, areExpandedChildrenRowPropsEqual);

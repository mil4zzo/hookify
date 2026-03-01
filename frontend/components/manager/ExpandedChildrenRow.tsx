"use client";

import React, { useState, useMemo } from "react";
import { IconArrowsSort, IconSearch } from "@tabler/icons-react";
import { useAdVariations, useAdsetChildren } from "@/lib/api/hooks";
import { RankingsChildrenItem } from "@/lib/api/schemas";
import { ThumbnailImage } from "@/components/common/ThumbnailImage";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";
import { StatusCell } from "@/components/manager/StatusCell";
import type { ColumnFiltersState } from "@tanstack/react-table";
import { Input } from "@/components/ui/input";
import { FilterBar } from "@/components/manager/FilterBar";
import { MANAGER_COLUMN_OPTIONS, MANAGER_COLUMN_RENDER_ORDER } from "@/components/manager/managerColumns";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import { computeMqlMetricsFromLeadscore } from "@/lib/utils/mqlMetrics";
import { applyRowFilters } from "@/lib/utils/applyRowFilters";

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
  columnFilters?: ColumnFiltersState;
  setColumnFilters?: React.Dispatch<React.SetStateAction<ColumnFiltersState>>;
  /** Quando true, retorna apenas o conteúdo interno (sem tr/td) para uso dentro de uma célula pai */
  asContent?: boolean;
}

// Função de comparação customizada para React.memo
function areExpandedChildrenRowPropsEqual(prev: ExpandedChildrenRowProps, next: ExpandedChildrenRowProps): boolean {
  // Verificar se os sets de colunas ativas são iguais
  const activeColumnsEqual =
    prev.activeColumns.size === next.activeColumns.size &&
    Array.from(prev.activeColumns).every((col) => next.activeColumns.has(col));

  const columnFiltersEqual =
    (prev.columnFilters?.length ?? 0) === (next.columnFilters?.length ?? 0) &&
    JSON.stringify(prev.columnFilters ?? []) === JSON.stringify(next.columnFilters ?? []);

  return (
    prev.asContent === next.asContent &&
    prev.adName === next.adName &&
    prev.adsetId === next.adsetId &&
    prev.dateStart === next.dateStart &&
    prev.dateStop === next.dateStop &&
    prev.actionType === next.actionType &&
    prev.formatCurrency === next.formatCurrency &&
    prev.formatPct === next.formatPct &&
    activeColumnsEqual &&
    prev.hasSheetIntegration === next.hasSheetIntegration &&
    prev.mqlLeadscoreMin === next.mqlLeadscoreMin &&
    columnFiltersEqual &&
    prev.setColumnFilters === next.setColumnFilters
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
  columnFilters = [],
  setColumnFilters,
  asContent = false,
}: ExpandedChildrenRowProps) {
  // Usar hook apropriado baseado em qual prop foi fornecida
  const adVariationsQuery = useAdVariations(adName || "", dateStart, dateStop, !!adName);
  const adsetChildrenQuery = useAdsetChildren(adsetId || "", dateStart, dateStop, !!adsetId);

  // Selecionar dados do hook correto
  const { data: childrenData, isLoading, isError } = adsetId ? adsetChildrenQuery : adVariationsQuery;
  const [sortConfig, setSortConfig] = useState<{ column: string | null; direction: "asc" | "desc" }>({
    column: "spend",
    direction: "desc",
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
      // Tratar tanto chaves com prefixo ("conversion:xxx") quanto sem prefixo ("xxx")
      let results = 0;
      if (actionType && typeof actionType === "string" && actionType.trim()) {
        results = Number(conversions[actionType] || 0);
        // Se não encontrou e actionType tem prefixo, tentar sem prefixo
        if (results === 0 && (actionType.startsWith("conversion:") || actionType.startsWith("action:"))) {
          const unprefixed = actionType.replace(/^(conversion|action):/, '');
          results = Number(conversions[unprefixed] || 0);
        }
        // Se não encontrou e actionType não tem prefixo, tentar com prefixo
        if (results === 0 && !actionType.startsWith("conversion:") && !actionType.startsWith("action:")) {
          results = Number(conversions[`conversion:${actionType}`] || conversions[`action:${actionType}`] || 0);
        }
      }
      // Calcular page_conv: mesmo cálculo da linha principal
      const page_conv = lpv > 0 ? results / lpv : 0;
      // Calcular cpr: mesmo cálculo da linha principal
      const cpr = results > 0 ? spend / results : 0;
      // Usar cpm do backend se disponível, senão calcular
      // cpm sempre vem do backend
      const cpm = typeof child.cpm === "number" ? child.cpm : 0;
      // Calcular MQLs usando computeMqlMetricsFromLeadscore (mesma lógica da tabela principal)
      const { mqlCount } = hasSheetIntegration
        ? computeMqlMetricsFromLeadscore({
            spend,
            leadscoreRaw: (child as any).leadscore_values,
            mqlLeadscoreMin,
          })
        : { mqlCount: 0 };
      const mqls = mqlCount;
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

    // Filtrar por termo de busca: nome do anúncio ou ID do anúncio (por anúncio e por conjunto)
    let filteredData = searchTerm.trim()
      ? dataWithCalculations.filter((child) => {
          const search = searchTerm.toLowerCase();
          const adName = String(child.ad_name || "").toLowerCase();
          const adId = String(child.ad_id || "").toLowerCase();
          return adName.includes(search) || adId.includes(search);
        })
      : dataWithCalculations;

    // Filtrar por columnFilters (Status, nome, métricas)
    if (columnFilters.length > 0) {
      filteredData = filteredData.filter((row) => applyRowFilters(row as Record<string, unknown>, columnFilters));
    }

    if (!sortConfig.column) {
      return filteredData;
    }

    const isActiveStatus = (status?: string | null) =>
      status != null && String(status).toUpperCase() === "ACTIVE";

    const sorted = [...filteredData].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (sortConfig.column) {
        case "status": {
          const activeA = isActiveStatus((a as any).effective_status);
          const activeB = isActiveStatus((b as any).effective_status);
          if (activeA === activeB) return 0;
          const cmp = activeA && !activeB ? -1 : 1;
          return sortConfig.direction === "asc" ? cmp : -cmp;
        }
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
  }, [childrenData, sortConfig, actionType, searchTerm, hasSheetIntegration, mqlLeadscoreMin, columnFilters]);

  const handleSort = (column: string) => {
    setSortConfig((prev) => {
      if (prev.column === column) {
        return { column, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      // Status e ad_id: primeiro clique = asc (ativos primeiro / ordem natural)
      return { column, direction: column === "ad_id" || column === "status" ? "asc" : "desc" };
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

  // Colunas filtráveis (Status, nome, Campanha/Conjunto, métricas visíveis)
  const filterableColumns = useMemo(() => {
    const cols: Array<{ id: string; label: string; isPercentage?: boolean; isText?: boolean; isStatus?: boolean }> = [];
    cols.push({ id: "status", label: "Status", isStatus: true });
    if (adsetId) {
      cols.push({ id: "ad_name", label: "Anúncio", isText: true });
      cols.push({ id: "campaign_name_filter", label: "Campanha", isText: true });
    } else {
      cols.push({ id: "adset_name_filter", label: "Conjunto", isText: true });
      cols.push({ id: "campaign_name_filter", label: "Campanha", isText: true });
    }
    for (const col of visibleColumns) {
      const isPct = ["hook", "ctr", "website_ctr", "connect_rate", "page_conv"].includes(col.id);
      cols.push({ id: col.id, label: col.name, isPercentage: isPct });
    }
    return cols;
  }, [adsetId, visibleColumns]);

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

  const loadingContent = (
    <div className="p-2 pl-8">
      <div className="text-sm text-muted-foreground">Carregando variações...</div>
    </div>
  );

  const errorContent = (
    <div className="p-2 pl-8">
      <div className="text-sm text-destructive">Erro ao carregar variações.</div>
    </div>
  );

  const emptyContent = (
    <div className="p-2 pl-8">
      <div className="text-sm text-muted-foreground">Sem variações no período.</div>
    </div>
  );

  // Retornos condicionais após todos os hooks
  if (isLoading) {
    return asContent ? loadingContent : (
      <tr className="bg-border">
        <td className="p-0" colSpan={colspan}>{loadingContent}</td>
      </tr>
    );
  }

  if (isError) {
    return asContent ? errorContent : (
      <tr className="bg-border">
        <td className="p-0" colSpan={colspan}>{errorContent}</td>
      </tr>
    );
  }

  if (!childrenData || childrenData.length === 0) {
    return asContent ? emptyContent : (
      <tr className="bg-border">
        <td className="p-0" colSpan={colspan}>{emptyContent}</td>
      </tr>
    );
  }

  const innerContent = (
    <div className="">
          {/* Busca e filtros - flex horizontal: search à esquerda, filterbar à direita */}
          <div className="px-4 py-3 bg-muted/50" role="region" aria-label="Busca e filtros da tabela expandida">
            <div className="flex items-center gap-3 flex-nowrap">
              <div className="relative flex-shrink-0 w-72 max-w-[min(18rem,100%)]">
                <IconSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  type="search"
                  placeholder="Buscar por nome ou ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 h-9 text-xs w-full"
                />
              </div>
              {(searchTerm.trim() || columnFilters.length > 0) && (
                <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                  {sortedData.length} de {childrenData?.length || 0} variações
                </span>
              )}
              {setColumnFilters && (
                <div className="flex-1 min-w-0">
                  <FilterBar
                    columnFilters={columnFilters}
                    setColumnFilters={setColumnFilters}
                    filterableColumns={filterableColumns}
                    />
                </div>
              )}
            </div>
          </div>
          {sortedData.length === 0 && (searchTerm.trim() || columnFilters.length > 0) ? (
            <div className="p-8 text-center">
              <p className="text-sm text-muted-foreground">
                {searchTerm.trim()
                  ? columnFilters.length > 0
                    ? `Nenhuma variação encontrada para "${searchTerm}" com os filtros aplicados.`
                    : `Nenhuma variação encontrada para "${searchTerm}"`
                  : "Nenhuma variação corresponde aos filtros aplicados."}
              </p>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                {searchTerm.trim() && (
                  <button
                    onClick={() => setSearchTerm("")}
                    className="text-xs text-primary hover:underline"
                  >
                    Limpar busca
                  </button>
                )}
                {searchTerm.trim() && columnFilters.length > 0 && <span className="text-muted-foreground">·</span>}
                {columnFilters.length > 0 && setColumnFilters && (
                  <button
                    onClick={() => setColumnFilters([])}
                    className="text-xs text-primary hover:underline"
                  >
                    Limpar filtros
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-border">
                  <th
                    className={`p-4 text-center w-20 cursor-pointer select-none hover:text-brand ${sortConfig.column === "status" ? "text-primary" : ""}`}
                    onClick={() => handleSort("status")}
                  >
                    <div className="flex items-center justify-center gap-1">
                      Status
                      <IconArrowsSort className="w-3 h-3" />
                    </div>
                  </th>
                  <th
                    className={`p-4 text-left cursor-pointer select-none hover:text-brand ${
                      sortConfig.column === "ad_id" ? "text-primary" : ""
                    }`}
                    onClick={() => handleSort("ad_id")}
                  >
                    <div className="flex items-center gap-1">
                      {adsetId ? "Anúncios" : "Variações"}
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
  );

  return asContent ? innerContent : (
    <tr className="bg-card">
      <td className="p-0" colSpan={colspan}>
        {innerContent}
      </td>
    </tr>
  );
}, areExpandedChildrenRowPropsEqual);

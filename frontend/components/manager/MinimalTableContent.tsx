"use client";

import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { flexRender } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { TableSummaryBar } from "@/components/manager/TableSummaryBar";
import { Skeleton } from "@/components/ui/skeleton";
import { ExpandedChildrenRow } from "@/components/manager/ExpandedChildrenRow";
import { CampaignChildrenRow } from "@/components/manager/CampaignChildrenRow";
import { ExpandedRowCell } from "@/components/manager/ExpandedRowCell";
import type { RankingsItem } from "@/lib/api/schemas";
import type { SharedTableContentProps } from "@/components/manager/tableContentTypes";

export type MinimalTableContentProps = SharedTableContentProps;

// Função de comparação customizada otimizada para React.memo (mesma lógica do TableContent)
function areMinimalTableContentPropsEqual(prev: MinimalTableContentProps, next: MinimalTableContentProps): boolean {
  // 1. Comparações primitivas (rápidas)
  if (prev.isLoadingEffective !== next.isLoadingEffective || prev.groupByAdNameEffective !== next.groupByAdNameEffective || prev.currentTab !== next.currentTab || prev.dateStart !== next.dateStart || prev.dateStop !== next.dateStop || prev.actionType !== next.actionType || prev.showTrends !== next.showTrends) {
    return false;
  }

  // 2. Comparação de funções (devem ser estáveis via useCallback)
  if (prev.getRowKey !== next.getRowKey || prev.setExpanded !== next.setExpanded || prev.setSelectedAd !== next.setSelectedAd || prev.setSelectedAdset !== next.setSelectedAdset || prev.formatCurrency !== next.formatCurrency || prev.formatPct !== next.formatPct || prev.setColumnFilters !== next.setColumnFilters || prev.onVisibleRowKeysChange !== next.onVisibleRowKeysChange) {
    return false;
  }

  // 2.1 Comparação de activeColumns, hasSheetIntegration e mqlLeadscoreMin
  const activeColumnsEqual = prev.activeColumns.size === next.activeColumns.size && Array.from(prev.activeColumns).every((col) => next.activeColumns.has(col));

  if (!activeColumnsEqual || prev.hasSheetIntegration !== next.hasSheetIntegration || prev.mqlLeadscoreMin !== next.mqlLeadscoreMin) {
    return false;
  }

  // 3. Comparação de dados via referência direta ao array
  // NOTA: table.options.data não funciona para detectar mudanças porque table é uma
  // instância mutável estável do TanStack — prev.table === next.table sempre, então
  // prev.table.options.data === next.table.options.data é sempre true.
  // Usamos dataRef (referência direta ao array de dados) para detectar mudanças reais.
  if (prev.dataRef !== next.dataRef) {
    return false;
  }

  // Comparar dataLength para detectar quando dados chegam do servidor
  if (prev.dataLength !== next.dataLength) {
    return false;
  }

  // Comparar filtros e sorting (que afetam quais rows são mostradas)
  const prevState = prev.table.getState();
  const nextState = next.table.getState();

  // Comparar filtros (referência primeiro, stringify só se necessário)
  if (prevState.columnFilters !== nextState.columnFilters && JSON.stringify(prevState.columnFilters) !== JSON.stringify(nextState.columnFilters)) {
    return false;
  }

  // Comparar sorting (referência primeiro, stringify só se necessário)
  if (prev.sorting !== next.sorting && JSON.stringify(prev.sorting) !== JSON.stringify(next.sorting)) {
    return false;
  }

  // IMPORTANTE: Não comparar columnSizing aqui porque:
  // 1. columnSizing não afeta quais rows são mostradas, só o tamanho das colunas
  // 2. Durante resize, columnSizing muda frequentemente mas os dados não mudam
  // 3. O TanStack Table já atualiza o DOM diretamente via CSS (width das colunas)
  // 4. Comparar columnSizing aqui causaria re-renders desnecessários durante resize

  // 4. Comparação de columnFilters (array) — referência primeiro
  if (prev.columnFilters !== next.columnFilters) {
    if (prev.columnFilters.length !== next.columnFilters.length) {
      return false;
    }
    for (let i = 0; i < prev.columnFilters.length; i++) {
      const prevFilter = prev.columnFilters[i];
      const nextFilter = next.columnFilters[i];
      if (prevFilter.id !== nextFilter.id || (prevFilter.value !== nextFilter.value && JSON.stringify(prevFilter.value) !== JSON.stringify(nextFilter.value))) {
        return false;
      }
    }
  }

  // 5. Comparação de expanded (shallow comparison otimizada)
  const prevKeys = Object.keys(prev.expanded);
  const nextKeys = Object.keys(next.expanded);

  if (prevKeys.length !== nextKeys.length) {
    return false;
  }

  for (const key of prevKeys) {
    if (prev.expanded[key] !== next.expanded[key]) {
      return false;
    }
  }

  // 6. Filtros das tabelas expandidas (referência primeiro)
  const prevExpFilters = prev.expandedTableColumnFilters ?? [];
  const nextExpFilters = next.expandedTableColumnFilters ?? [];
  if (prevExpFilters !== nextExpFilters && JSON.stringify(prevExpFilters) !== JSON.stringify(nextExpFilters)) {
    return false;
  }
  if (prev.setExpandedTableColumnFilters !== next.setExpandedTableColumnFilters) {
    return false;
  }

  // Todas as props relevantes são iguais - não re-renderizar
  return true;
}

export const MinimalTableContent = React.memo(function MinimalTableContent({ table, isLoadingEffective, getRowKey, expanded, setExpanded, groupByAdNameEffective, currentTab, setSelectedAd, setSelectedAdset, dateStart, dateStop, actionType, formatCurrency, formatPct, columnFilters, setColumnFilters, activeColumns, hasSheetIntegration, mqlLeadscoreMin, sorting, expandedTableColumnFilters = [], setExpandedTableColumnFilters, onVisibleRowKeysChange }: MinimalTableContentProps) {
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // OTIMIZAÇÃO CRÍTICA: Memoizar rows para evitar processar 873 linhas durante resize
  // rows só deve ser recalculado quando dados, filtros ou sorting mudarem
  // NÃO recalcular quando apenas columnSizing mudar (durante resize)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- columnFilters/sorting comparados por referência, suficiente pois vêm de state controlado
  const rows = useMemo(() => {
    return table.getRowModel().rows;
  }, [table.options.data, table.getState().columnFilters, sorting]);

  // Estado para controlar se está redimensionando uma coluna
  const [isResizing, setIsResizing] = useState(false);
  // Estado para armazenar a posição do mouse durante o resize (linha visual)
  const [resizePosition, setResizePosition] = useState<number | null>(null);

  // Adicionar listeners globais para detectar quando o resize termina
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      setResizePosition(e.clientX);
    };

    const handleMouseUp = (e: MouseEvent) => {
      // O TanStack Table com columnResizeMode: "onEnd" processa o mouseup internamente
      // Precisamos garantir que o estado seja atualizado após o próximo frame
      // para que o TanStack Table tenha tempo de processar o evento
      requestAnimationFrame(() => {
        setIsResizing(false);
        setResizePosition(null);
      });
    };

    const handleMouseLeave = () => {
      setIsResizing(false);
      setResizePosition(null);
    };

    // Adicionar listeners no documento para capturar mesmo se o mouse sair do elemento
    // Usar capture: false para não interferir com o handler do TanStack Table
    document.addEventListener("mousemove", handleMouseMove, { passive: true });
    document.addEventListener("mouseup", handleMouseUp, { capture: false });
    document.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [isResizing]);

  // Estimate row height for minimal view: ~40px per row
  // Função estável para evitar recriação a cada render
  const estimateSize = useCallback(() => 40, []);

  // Handler de click nas linhas memoizado para evitar recriação
  const handleRowClick = useCallback(
    (e: React.MouseEvent<HTMLTableRowElement>, row: any) => {
      // Prevenir click durante o resize
      if (isResizing) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const original = row.original as RankingsItem;
      // Abas com expansão inline (por-campanha e por-conjunto)
      if (currentTab === "por-campanha" || currentTab === "por-conjunto") {
        const rowKey = getRowKey(row);
        setExpanded((prev) => ({ ...prev, [rowKey]: !prev[rowKey] }));
        return;
      }
      setSelectedAd(original);
    },
    [isResizing, currentTab, getRowKey, setExpanded, setSelectedAd],
  );

  const rowVirtualizer = useVirtualizer({
    count: isLoadingEffective ? 8 : rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize,
    overscan: 10, // More overscan for minimal view since rows are smaller
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const getSeriesGroupKey = useCallback(
    (row: any): string => {
      const original = row?.original as RankingsItem | undefined;
      if (!original) return "";
      if ((original as any).group_key) return String((original as any).group_key);
      if (currentTab === "individual") return String(original.ad_id || "");
      if (currentTab === "por-conjunto") return String((original as any).adset_id || "");
      if (currentTab === "por-campanha") return String((original as any).campaign_id || "");
      return String(original.ad_name || original.ad_id || "");
    },
    [currentTab],
  );

  useEffect(() => {
    if (!onVisibleRowKeysChange) return;
    if (isLoadingEffective) {
      return;
    }
    const keys = virtualRows
      .map((virtualRow) => rows[virtualRow.index])
      .filter(Boolean)
      .map((row) => getSeriesGroupKey(row))
      .filter(Boolean);
    if (keys.length === 0) return;
    onVisibleRowKeysChange(Array.from(new Set(keys)));
  }, [virtualRows, rows, getSeriesGroupKey, onVisibleRowKeysChange, isLoadingEffective]);

  // Calculate padding for virtualization
  const paddingTop = virtualRows.length > 0 ? virtualRows[0]?.start || 0 : 0;
  const paddingBottom = virtualRows.length > 0 ? totalSize - (virtualRows[virtualRows.length - 1]?.end || 0) : 0;

  return (
    <div className="w-full h-full flex-1 flex flex-col relative min-h-0">
      {/* Overlay invisível durante resize para capturar eventos globalmente */}
      {isResizing && (
        <div
          className="fixed inset-0 z-50 cursor-col-resize"
          style={{ pointerEvents: "auto" }}
          onMouseUp={(e) => {
            // O TanStack Table com columnResizeMode: "onEnd" processa o mouseup internamente
            // Precisamos garantir que o estado seja atualizado após o próximo frame
            // para que o TanStack Table tenha tempo de processar o evento
            requestAnimationFrame(() => {
              setIsResizing(false);
              setResizePosition(null);
            });
          }}
        />
      )}
      {/* Linha vertical que acompanha o mouse durante resize */}
      {isResizing && resizePosition !== null && <div className="fixed top-0 bottom-0 w-[2px] bg-primary z-[60] pointer-events-none" style={{ left: `${resizePosition}px` }} />}
      <div ref={tableContainerRef} className="flex-1 min-h-0 overflow-auto overscroll-contain border-x border-border rounded-t-lg">
        <table className="w-full text-xs border-collapse" style={{ tableLayout: "fixed" }}>
          <colgroup>
            {table.getVisibleLeafColumns().map((column) => (
              <col key={column.id} style={{ width: column.getSize() }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-card border-b border-border">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const headerAlign = header.column.id === "ad_name" ? "text-left" : "text-center";
                  const justify = header.column.id === "ad_name" ? "justify-start" : "justify-center";
                  return (
                    <th key={header.id} className={`text-xs font-medium py-1.5 px-2 ${headerAlign} relative border-r border-border last:border-r-0 first:rounded-tl-lg last:rounded-tr-lg`} style={{ width: header.getSize() }}>
                      {header.isPlaceholder ? null : (
                        <div
                          className={`flex items-center ${justify} gap-0.5 ${header.column.getCanSort() && !isResizing ? "cursor-pointer select-none hover:text-brand" : ""} ${header.column.getIsSorted() ? "text-primary" : ""}`}
                          onClick={(e) => {
                            if (isResizing) {
                              e.preventDefault();
                              e.stopPropagation();
                              return;
                            }
                            header.column.getToggleSortingHandler()?.(e);
                          }}
                          style={{ pointerEvents: isResizing ? "none" : "auto" }}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </div>
                      )}
                      {header.column.getCanResize() && (
                        <div
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setIsResizing(true);
                            header.getResizeHandler()(e);
                          }}
                          onTouchStart={(e) => {
                            e.stopPropagation();
                            setIsResizing(true);
                            header.getResizeHandler()(e);
                          }}
                          className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none hover:bg-border z-10"
                          style={{ userSelect: "none", WebkitUserSelect: "none", pointerEvents: "auto" }}
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr>
                <td style={{ height: `${paddingTop}px` }} />
              </tr>
            )}
            {isLoadingEffective ? (
              // Loading skeletons
              virtualRows.map((virtualRow) => (
                <tr key={`skeleton-${virtualRow.index}`} className="border-b border-border">
                  {table.getVisibleLeafColumns().map((column) => {
                    const isFirstColumn = column.id === "ad_name";
                    const cellAlign = isFirstColumn ? "text-left" : "text-center";
                    return (
                      <td key={column.id} className={`py-1.5 px-2 ${cellAlign} border-r border-border last:border-r-0`}>
                        {isFirstColumn ? (
                          <div className="flex items-center gap-2">
                            {currentTab !== "por-conjunto" && currentTab !== "por-campanha" && <Skeleton className="w-8 h-8 rounded flex-shrink-0" />}
                            <Skeleton className="h-3 w-24" />
                          </div>
                        ) : (
                          <Skeleton className="h-3 w-12 mx-auto" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length} className="p-4 text-center text-muted-foreground text-xs">
                  Nenhum resultado com esses filtros.
                </td>
              </tr>
            ) : (
              // Virtualized rows
              virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];
                const key = getRowKey(row);
                const isExpanded = !!expanded[key];
                const original = row.original as RankingsItem;
                const adName = String(original?.ad_name || "");

                const expandedContent =
                  (groupByAdNameEffective && isExpanded && adName ? <ExpandedChildrenRow adName={adName} dateStart={dateStart || ""} dateStop={dateStop || ""} actionType={actionType} formatCurrency={formatCurrency} formatPct={formatPct} activeColumns={activeColumns} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} columnFilters={expandedTableColumnFilters} setColumnFilters={setExpandedTableColumnFilters!} asContent /> : null) ??
                  (currentTab === "por-conjunto" && isExpanded && String((original as any)?.adset_id || "").trim() ? <ExpandedChildrenRow adsetId={String((original as any)?.adset_id || "").trim()} dateStart={dateStart || ""} dateStop={dateStop || ""} actionType={actionType} formatCurrency={formatCurrency} formatPct={formatPct} activeColumns={activeColumns} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} columnFilters={expandedTableColumnFilters} setColumnFilters={setExpandedTableColumnFilters!} asContent /> : null) ??
                  (currentTab === "por-campanha" && isExpanded && String((original as any)?.campaign_id || "").trim() ? <CampaignChildrenRow campaignId={String((original as any)?.campaign_id || "").trim()} dateStart={dateStart || ""} dateStop={dateStop || ""} actionType={actionType} formatCurrency={formatCurrency} formatPct={formatPct} activeColumns={activeColumns} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} columnFilters={expandedTableColumnFilters} setColumnFilters={setExpandedTableColumnFilters!} asContent /> : null);

                if (isExpanded && expandedContent) {
                  return <ExpandedRowCell key={row.id} ref={rowVirtualizer.measureElement} row={row} table={table} expandedContent={expandedContent} tdClassName="p-0 align-top border border-primary rounded-md bg-input-30" onRowClick={handleRowClick} trClassName={`border-b border-border transition-colors ${isResizing ? "cursor-col-resize" : "hover:bg-muted-30 cursor-pointer"} bg-muted-30`} dataIndex={virtualRow.index} summaryCellClassName="py-1.5 px-2" />;
                }

                return (
                  <tr key={row.id} data-index={virtualRow.index} ref={rowVirtualizer.measureElement} className={`border-b border-border transition-colors ${isResizing ? "cursor-col-resize" : "hover:bg-muted-30 cursor-pointer"} ${isExpanded ? "bg-muted-30" : ""}`} onClick={(e) => handleRowClick(e, row)}>
                    {row.getVisibleCells().map((cell, cellIndex) => {
                      const cellAlign = cell.column.id === "ad_name" ? "text-left" : "text-center";
                      const isFirst = cellIndex === 0;
                      return (
                        <td key={cell.id} className={`py-1.5 px-2 ${cellAlign} border-r border-border last:border-r-0 ${isExpanded && isFirst ? "!border-l-2 !border-l-primary" : ""}`}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
            {paddingBottom > 0 && (
              <tr>
                <td style={{ height: `${paddingBottom}px` }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <TableSummaryBar
        filteredCount={table.getFilteredRowModel().rows.length}
        totalCount={table.getPreFilteredRowModel().rows.length}
        itemLabel={currentTab === "por-conjunto" ? "conjuntos" : currentTab === "por-campanha" ? "campanhas" : "anúncios"}
        hasActiveFilters={columnFilters.length > 0}
        onResetFilters={() => setColumnFilters([])}
      />
    </div>
  );
}, areMinimalTableContentPropsEqual);

"use client";

import React, { Fragment, useRef, useState, useEffect, useCallback, useMemo } from "react";
import { flexRender } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { IconX } from "@tabler/icons-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ExpandedChildrenRow } from "@/components/manager/ExpandedChildrenRow";
import { CampaignChildrenRow } from "@/components/manager/CampaignChildrenRow";
import type { RankingsItem } from "@/lib/api/schemas";
import type { SharedTableContentProps } from "@/components/manager/tableContentTypes";

export type TableContentProps = SharedTableContentProps;

// Função de comparação customizada otimizada para React.memo
function areTableContentPropsEqual(prev: TableContentProps, next: TableContentProps): boolean {
  // 1. Comparações primitivas (rápidas)
  if (
    prev.isLoadingEffective !== next.isLoadingEffective ||
    prev.groupByAdNameEffective !== next.groupByAdNameEffective ||
    prev.currentTab !== next.currentTab ||
    prev.dateStart !== next.dateStart ||
    prev.dateStop !== next.dateStop ||
    prev.actionType !== next.actionType
  ) {
    return false;
  }

  // 2. Comparação de funções (devem ser estáveis via useCallback)
  if (
    prev.getRowKey !== next.getRowKey ||
    prev.setExpanded !== next.setExpanded ||
    prev.setSelectedAd !== next.setSelectedAd ||
    prev.setSelectedAdset !== next.setSelectedAdset ||
    prev.formatCurrency !== next.formatCurrency ||
    prev.formatPct !== next.formatPct ||
    prev.setColumnFilters !== next.setColumnFilters
  ) {
    return false;
  }

  // 2.1 Comparação de activeColumns, hasSheetIntegration e mqlLeadscoreMin
  const activeColumnsEqual =
    prev.activeColumns.size === next.activeColumns.size &&
    Array.from(prev.activeColumns).every((col) => next.activeColumns.has(col));

  if (
    !activeColumnsEqual ||
    prev.hasSheetIntegration !== next.hasSheetIntegration ||
    prev.mqlLeadscoreMin !== next.mqlLeadscoreMin
  ) {
    return false;
  }

  // 3. Comparação de table (TanStack Table - verifica se dados/filtros mudaram)
  // OTIMIZAÇÃO: Comparar dados originais diretamente em vez de processar todas as rows
  // Isso evita processar 873 linhas durante resize (columnSizing não afeta os dados)
  const prevData = prev.table.options.data;
  const nextData = next.table.options.data;
  
  // Se os dados originais mudaram, as rows mudaram
  if (prevData !== nextData) {
    return false;
  }

  // Comparar dataLength para detectar quando dados chegam do servidor
  if (prev.dataLength !== next.dataLength) {
    return false;
  }
  
  // Comparar filtros e sorting (que afetam quais rows são mostradas)
  const prevState = prev.table.getState();
  const nextState = next.table.getState();
  
  // Comparar filtros
  if (JSON.stringify(prevState.columnFilters) !== JSON.stringify(nextState.columnFilters)) {
    return false;
  }
  
  // Comparar sorting usando a prop direta (mais confiável que table.getState())
  if (JSON.stringify(prev.sorting) !== JSON.stringify(next.sorting)) {
    return false;
  }
  
  // IMPORTANTE: Não comparar columnSizing aqui porque:
  // 1. columnSizing não afeta quais rows são mostradas, só o tamanho das colunas
  // 2. Durante resize, columnSizing muda frequentemente mas os dados não mudam
  // 3. O TanStack Table já atualiza o DOM diretamente via CSS (width das colunas)
  // 4. Comparar columnSizing aqui causaria re-renders desnecessários durante resize

  // 4. Comparação de columnFilters (array)
  if (prev.columnFilters.length !== next.columnFilters.length) {
    return false;
  }

  // Comparação profunda de filtros
  for (let i = 0; i < prev.columnFilters.length; i++) {
    const prevFilter = prev.columnFilters[i];
    const nextFilter = next.columnFilters[i];
    if (
      prevFilter.id !== nextFilter.id ||
      JSON.stringify(prevFilter.value) !== JSON.stringify(nextFilter.value)
    ) {
      return false;
    }
  }

  // 5. Comparação de expanded (shallow comparison otimizada)
  // Só comparar se as chaves mudaram ou se os valores das chaves mudaram
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

  // Todas as props relevantes são iguais - não re-renderizar
  return true;
}

export const TableContent = React.memo(function TableContent({ table, isLoadingEffective, getRowKey, expanded, setExpanded, groupByAdNameEffective, currentTab, setSelectedAd, setSelectedAdset, dateStart, dateStop, actionType, formatCurrency, formatPct, columnFilters, setColumnFilters, activeColumns, hasSheetIntegration, mqlLeadscoreMin, sorting }: TableContentProps) {
  const tableContainerRef = useRef<HTMLDivElement>(null);
  
  // OTIMIZAÇÃO CRÍTICA: Memoizar rows para evitar processar 873 linhas durante resize
  // rows só deve ser recalculado quando dados, filtros ou sorting mudarem
  // NÃO recalcular quando apenas columnSizing mudar (durante resize)
  const rows = useMemo(() => {
    return table.getRowModel().rows;
  }, [
    // Dados originais - se mudarem, rows mudam
    table.options.data,
    // Filtros - se mudarem, rows filtradas mudam
    JSON.stringify(table.getState().columnFilters),
    // Sorting - usar a prop direta para garantir atualização imediata
    JSON.stringify(sorting),
    // NÃO incluir columnSizing - não afeta quais rows são mostradas
  ]);

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

  // Estimate row height: ~120px for main row + spacing
  // Função estável para evitar recriação a cada render
  const estimateSize = useCallback(() => 120, []);

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
      if (currentTab === "por-campanha") {
        const rowKey = getRowKey(row);
        setExpanded((prev) => ({ ...prev, [rowKey]: !prev[rowKey] }));
        return;
      }
      if (currentTab === "por-conjunto") {
        const adsetId = String((original as any)?.adset_id || "").trim();
        if (adsetId) {
          setSelectedAdset({
            adsetId,
            adsetName: (original as any)?.adset_name ?? null,
          });
        }
        return;
      }
      setSelectedAd(original);
    },
    [isResizing, currentTab, getRowKey, setExpanded, setSelectedAdset, setSelectedAd]
  );

  const rowVirtualizer = useVirtualizer({
    count: isLoadingEffective ? 8 : rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize,
    overscan: 5, // Render 5 extra rows above/below viewport
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

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
      {isResizing && resizePosition !== null && (
        <div
          className="fixed top-0 bottom-0 w-[2px] bg-primary z-[60] pointer-events-none"
          style={{ left: `${resizePosition}px` }}
        />
      )}
      <div ref={tableContainerRef} className="flex-1 overflow-x-auto overflow-y-auto">
        <table className="w-full text-sm border-separate border-spacing-y-4" style={{ tableLayout: "fixed" }}>
          <colgroup>
            {table.getAllColumns().map((column) => (
              <col key={column.id} style={{ width: column.getSize() }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-background">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="text-text/80">
                {hg.headers.map((header) => {
                  const headerAlign = header.column.id === "ad_name" ? "text-left" : "text-center";
                  const justify = header.column.id === "ad_name" ? "justify-start" : "justify-center";
                  return (
                    <th key={header.id} className={`text-base font-normal py-4 ${headerAlign} relative`}>
                      {header.isPlaceholder ? null : (
                        <div
                          className={`flex items-center ${justify} gap-1 ${header.column.getCanSort() && !isResizing ? "cursor-pointer select-none hover:text-brand" : ""} ${header.column.getIsSorted() ? "text-primary" : ""}`}
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
                            // Chamar o handler do TanStack Table para iniciar o resize
                            header.getResizeHandler()(e);
                          }}
                          onTouchStart={(e) => {
                            e.stopPropagation();
                            setIsResizing(true);
                            header.getResizeHandler()(e);
                          }}
                          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none touch-none hover:bg-border z-10"
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
                <tr key={`skeleton-${virtualRow.index}`} className="bg-background">
                  {table.getAllColumns().map((column, colIndex) => {
                    const isFirstColumn = column.id === "ad_name";
                    const cellAlign = isFirstColumn ? "text-left" : "text-center";
                    const isFirst = colIndex === 0;
                    const isLast = colIndex === table.getAllColumns().length - 1;
                    return (
                      <td key={column.id} className={`p-4 ${cellAlign} border-y border-border ${isFirst ? "rounded-l-md border-l" : ""} ${isLast ? "rounded-r-md border-r" : ""}`}>
                        {isFirstColumn ? (
                          <div className="flex items-center gap-3">
                            <Skeleton className="w-14 h-14 rounded flex-shrink-0" />
                            <div className="flex-1 min-w-0 space-y-2">
                              <Skeleton className="h-4 w-3/4" />
                              <Skeleton className="h-3 w-1/2" />
                            </div>
                          </div>
                        ) : (
                          <Skeleton className="h-4 w-16 mx-auto" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={table.getAllColumns().length} className="p-8 text-center text-muted-foreground">
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

                return (
                  <Fragment key={row.id}>
                    <tr
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      className={`bg-background transition-colors ${isResizing ? "cursor-col-resize" : "hover:bg-input-30 cursor-pointer"}`}
                      onClick={(e) => handleRowClick(e, row)}
                    >
                      {row.getVisibleCells().map((cell, cellIndex) => {
                        const cellAlign = cell.column.id === "ad_name" ? "text-left" : "text-center";
                        const isFirst = cellIndex === 0;
                        const isLast = cellIndex === row.getVisibleCells().length - 1;
                        return (
                          <td key={cell.id} className={`p-4 ${cellAlign} border-y border-border ${isFirst ? "rounded-l-md border-l" : ""} ${isLast ? "rounded-r-md border-r" : ""}`}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                    {groupByAdNameEffective && isExpanded && adName ? <ExpandedChildrenRow adName={adName} dateStart={dateStart || ""} dateStop={dateStop || ""} actionType={actionType} formatCurrency={formatCurrency} formatPct={formatPct} activeColumns={activeColumns} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} /> : null}
                    {currentTab === "por-campanha" && isExpanded && String((original as any)?.campaign_id || "").trim() ? <CampaignChildrenRow row={row as any} campaignId={String((original as any)?.campaign_id || "").trim()} dateStart={dateStart || ""} dateStop={dateStop || ""} actionType={actionType} formatCurrency={formatCurrency} formatPct={formatPct} /> : null}
                  </Fragment>
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

      <div className="sticky bottom-4 left-0 right-0 z-50 flex justify-center pointer-events-none mt-4">
        <div className="w-full bg-card border border-border shadow-lg pointer-events-auto rounded-lg">
          <div className="px-4 py-3">
            <div className="flex items-center justify-end gap-3">
              <div className="flex items-center text-sm text-muted-foreground">
                <span>
                  Exibindo {table.getFilteredRowModel().rows.length} de {table.getPreFilteredRowModel().rows.length} {currentTab === "por-conjunto" ? "conjuntos" : currentTab === "por-campanha" ? "campanhas" : "anúncios"}
                </span>
              </div>
              {columnFilters.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setColumnFilters([])} className="h-8 text-xs">
                  <IconX className="w-4 h-4 mr-1.5" />
                  Resetar filtros
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}, areTableContentPropsEqual);

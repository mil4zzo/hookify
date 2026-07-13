"use client";

import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { flexRender } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { StatePanel } from "@/components/common/States";
// design-system-exception: direct-skeleton-import - dense table rows keep row-shaped skeletons
import { Skeleton } from "@/components/ui/skeleton";
import type { RankingsItem } from "@/lib/api/schemas";
import { MANAGER_ROW_HEIGHT, type SharedTableContentProps } from "@/components/manager/tableContentTypes";

export type TableContentVariant = "detailed" | "minimal";

export type TableContentProps = SharedTableContentProps & {
  /** Densidade visual: "detailed" (cards espaçados, thumbnail grande) | "minimal" (grade densa). */
  variant?: TableContentVariant;
};

/**
 * Estilos por variante — única diferença real entre as antigas TableContent e
 * MinimalTableContent. Toda a lógica (virtualização, resize, memo, estados) é compartilhada.
 */
const VARIANT_STYLES = {
  detailed: {
    estimateSize: MANAGER_ROW_HEIGHT.detailed,
    overscan: 5,
    container: "flex-1 min-h-0 overflow-auto overscroll-contain",
    table: "w-full text-sm border-separate border-spacing-y-4",
    thead: "sticky top-0 z-10 bg-background",
    headerRow: "text-text/80",
    th: (headerAlign: string) => `text-base font-normal py-4 px-4 ${headerAlign} relative`,
    thWidthStyle: false,
    sortGap: "gap-1",
    resizeHandle: "w-1.5",
    skeletonRow: "bg-background",
    row: (isResizing: boolean) => `bg-background transition-colors ${isResizing ? "cursor-col-resize" : "hover:bg-input-30 cursor-pointer"}`,
    cell: (cellAlign: string, isFirst: boolean, isLast: boolean) => `p-4 ${cellAlign} border-y border-border ${isFirst ? "rounded-l-md border-l" : ""} ${isLast ? "rounded-r-md border-r" : ""}`,
    emptyTd: "p-4",
    skeletonThumb: "w-14 h-14",
    skeletonName: (
      <div className="flex-1 min-w-0 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    ),
    skeletonNameGap: "gap-3",
    skeletonValue: "h-4 w-16 mx-auto",
  },
  minimal: {
    estimateSize: MANAGER_ROW_HEIGHT.minimal,
    overscan: 10, // Linhas menores — mais overscan
    container: "flex-1 min-h-0 overflow-auto overscroll-contain border-x border-border rounded-t-lg",
    table: "w-full text-xs border-collapse",
    thead: "sticky top-0 z-10 bg-card border-b border-border",
    headerRow: "",
    th: (headerAlign: string) => `text-xs font-medium py-1.5 px-2 ${headerAlign} relative border-r border-border last:border-r-0 first:rounded-tl-lg last:rounded-tr-lg`,
    thWidthStyle: true,
    sortGap: "gap-0.5",
    resizeHandle: "w-1",
    skeletonRow: "border-b border-border",
    row: (isResizing: boolean) => `border-b border-border transition-colors ${isResizing ? "cursor-col-resize" : "hover:bg-muted-30 cursor-pointer"}`,
    cell: (cellAlign: string, _isFirst: boolean, _isLast: boolean) => `py-1.5 px-2 ${cellAlign} border-r border-border last:border-r-0`,
    emptyTd: "p-2",
    skeletonThumb: "w-8 h-8",
    skeletonName: <Skeleton className="h-3 w-24" />,
    skeletonNameGap: "gap-2",
    skeletonValue: "h-3 w-12 mx-auto",
  },
} as const;

// Função de comparação customizada otimizada para React.memo
function areTableContentPropsEqual(prev: TableContentProps, next: TableContentProps): boolean {
  // 1. Comparações primitivas (rápidas)
  if (prev.variant !== next.variant || prev.isLoadingEffective !== next.isLoadingEffective || prev.isError !== next.isError || prev.groupByAdNameEffective !== next.groupByAdNameEffective || prev.currentTab !== next.currentTab || prev.dateStart !== next.dateStart || prev.dateStop !== next.dateStop || prev.actionType !== next.actionType || prev.showTrends !== next.showTrends || prev.colorMetricValue !== next.colorMetricValue) {
    return false;
  }

  const prevPackIdsKey = [...(prev.selectedPackIds || [])].sort().join("|");
  const nextPackIdsKey = [...(next.selectedPackIds || [])].sort().join("|");
  if (prevPackIdsKey !== nextPackIdsKey) {
    return false;
  }

  // 2. Comparação de funções (devem ser estáveis via useCallback)
  if (prev.getRowKey !== next.getRowKey || prev.onOpenDrill !== next.onOpenDrill || prev.setSelectedAd !== next.setSelectedAd || prev.setSelectedAdset !== next.setSelectedAdset || prev.formatCurrency !== next.formatCurrency || prev.formatPct !== next.formatPct || prev.setColumnFilters !== next.setColumnFilters || prev.onVisibleRowKeysChange !== next.onVisibleRowKeysChange) {
    return false;
  }

  // 2.1 Comparação de activeColumns, columnOrder, hasSheetIntegration e mqlLeadscoreMin
  const activeColumnsEqual = prev.activeColumns.size === next.activeColumns.size && Array.from(prev.activeColumns).every((col) => next.activeColumns.has(col));
  const columnOrderEqual = prev.columnOrder.length === next.columnOrder.length && prev.columnOrder.every((col, i) => next.columnOrder[i] === col);

  if (!activeColumnsEqual || !columnOrderEqual || prev.hasSheetIntegration !== next.hasSheetIntegration || prev.mqlLeadscoreMin !== next.mqlLeadscoreMin) {
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

  // Comparar rowSelection por referência: setRowSelection gera objeto novo a cada toggle.
  // Sem isso, marcar/desmarcar um checkbox não re-renderiza a célula (getIsSelected fica defasado)
  // até um render não relacionado — o "lag" percebido no checkbox.
  if (prev.rowSelection !== next.rowSelection) {
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

  // Todas as props relevantes são iguais - não re-renderizar
  return true;
}

export const TableContent = React.memo(function TableContent({ table, isLoadingEffective, isError, currentTab, setSelectedAd, sorting, onVisibleRowKeysChange, onOpenDrill, variant = "detailed" }: TableContentProps) {
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const styles = VARIANT_STYLES[variant];

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

  // Estimativa de altura de linha por variante (real é medida via measureElement)
  const estimateSize = useCallback(() => styles.estimateSize, [styles.estimateSize]);

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
      // Abas drillable (por-campanha e por-conjunto): abrir modal de drill
      if (currentTab === "por-campanha" || currentTab === "por-conjunto") {
        onOpenDrill?.(original);
        return;
      }
      setSelectedAd(original);
    },
    [isResizing, currentTab, onOpenDrill, setSelectedAd],
  );

  const rowVirtualizer = useVirtualizer({
    count: isLoadingEffective ? 8 : rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize,
    overscan: styles.overscan,
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
          className="fixed inset-0 z-overlay cursor-col-resize"
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
      {isResizing && resizePosition !== null && <div className="fixed top-0 bottom-0 w-[2px] bg-primary z-overlay pointer-events-none" style={{ left: `${resizePosition}px` }} />}
      <div ref={tableContainerRef} className={styles.container}>
        <table className={styles.table} style={{ tableLayout: "fixed" }}>
          <colgroup>
            {table.getVisibleLeafColumns().map((column) => (
              <col key={column.id} style={{ width: column.getSize() }} />
            ))}
          </colgroup>
          <thead className={styles.thead}>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className={styles.headerRow}>
                {hg.headers.map((header) => {
                  const headerAlign = header.column.id === "ad_name" ? "text-left" : "text-center";
                  const justify = header.column.id === "ad_name" ? "justify-start" : "justify-center";
                  return (
                    <th key={header.id} className={styles.th(headerAlign)} style={styles.thWidthStyle ? { width: header.getSize() } : undefined}>
                      {header.isPlaceholder ? null : (
                        <div
                          className={`flex items-center ${justify} ${styles.sortGap} ${header.column.getCanSort() && !isResizing ? "cursor-pointer select-none hover:text-brand" : ""} ${header.column.getIsSorted() ? "text-primary" : ""}`}
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
                          className={`absolute right-0 top-0 h-full ${styles.resizeHandle} cursor-col-resize select-none touch-none hover:bg-border z-10`}
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
                <tr key={`skeleton-${virtualRow.index}`} className={styles.skeletonRow}>
                  {table.getVisibleLeafColumns().map((column, colIndex) => {
                    const isFirstColumn = column.id === "ad_name";
                    const cellAlign = isFirstColumn ? "text-left" : "text-center";
                    const isFirst = colIndex === 0;
                    const isLast = colIndex === table.getVisibleLeafColumns().length - 1;
                    // Colunas auxiliares de filtro (adset_name/campaign_name/active_count) têm
                    // largura 0 e não renderizam conteúdo real. Sem este guard, o pill (w-16) delas
                    // transbordava o td de 0px (via mx-auto) e "vazava" para a coluna vizinha — o
                    // skeleton dobrado que aparecia logo antes da coluna Spend.
                    let content: React.ReactNode = null;
                    if (isFirstColumn) {
                      content = (
                        <div className={`flex items-center ${styles.skeletonNameGap}`}>
                          {currentTab !== "por-conjunto" && currentTab !== "por-campanha" && <Skeleton className={`${styles.skeletonThumb} rounded flex-shrink-0`} />}
                          {styles.skeletonName}
                        </div>
                      );
                    } else if (column.id === "select") {
                      content = <Skeleton className="mx-auto h-4 w-4 rounded" />;
                    } else if (column.getSize() > 0) {
                      content = <Skeleton className={styles.skeletonValue} />;
                    }
                    return (
                      <td key={column.id} className={styles.cell(cellAlign, isFirst, isLast)}>
                        {content}
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length} className={styles.emptyTd}>
                  <StatePanel
                    kind={isError ? "error" : "empty"}
                    message={isError ? "Erro ao carregar dados. Tente reduzir o período ou selecionar menos packs." : "Nenhum resultado com esses filtros."}
                    framed={false}
                    density="compact"
                  />
                </td>
              </tr>
            ) : (
              // Virtualized rows
              virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];

                return (
                  <tr key={row.id} data-index={virtualRow.index} ref={rowVirtualizer.measureElement} className={styles.row(isResizing)} onClick={(e) => handleRowClick(e, row)}>
                    {row.getVisibleCells().map((cell, cellIndex) => {
                      const cellAlign = cell.column.id === "ad_name" ? "text-left" : "text-center";
                      const isFirst = cellIndex === 0;
                      const isLast = cellIndex === row.getVisibleCells().length - 1;
                      return (
                        <td key={cell.id} className={styles.cell(cellAlign, isFirst, isLast)}>
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

    </div>
  );
}, areTableContentPropsEqual);

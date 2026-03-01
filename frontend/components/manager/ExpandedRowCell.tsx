"use client";

import React, { forwardRef } from "react";
import { flexRender } from "@tanstack/react-table";
import type { Row, Table } from "@tanstack/react-table";
import type { RankingsItem } from "@/lib/api/schemas";

export interface ExpandedRowCellProps {
  row: Row<RankingsItem>;
  table: Table<RankingsItem>;
  expandedContent: React.ReactNode;
  /** Classes para a td (card: borda, fundo, padding) */
  tdClassName?: string;
  /** Handler para click na linha (expandir/colapsar) */
  onRowClick?: (e: React.MouseEvent<HTMLTableRowElement>, row: Row<RankingsItem>) => void;
  trClassName?: string;
  /** Índice da linha para o virtualizer (data-index) */
  dataIndex?: number;
  /** Classes para cada célula do resumo (ex: "py-1.5 px-2" para minimal) */
  summaryCellClassName?: string;
}

/**
 * Renderiza uma única linha expandida: uma tr com uma td colSpan contendo
 * (1) tabela aninhada de resumo com o mesmo colgroup da tabela principal (alinhamento e semântica),
 * (2) conteúdo expandido (search + FilterBar + tabela filha).
 * Usado por TableContent e MinimalTableContent para evitar duplicação.
 */
export const ExpandedRowCell = forwardRef<HTMLTableRowElement, ExpandedRowCellProps>(function ExpandedRowCell({ row, table, expandedContent, tdClassName = "", onRowClick, trClassName = "", dataIndex, summaryCellClassName = "p-4" }, ref) {
  const columns = table.getVisibleLeafColumns();
  const cells = row.getVisibleCells();
  const colspan = columns.length;

  return (
    <tr ref={ref} data-index={dataIndex} className={trClassName} onClick={onRowClick ? (e) => onRowClick(e, row) : undefined}>
      <td colSpan={colspan} className={tdClassName}>
        <table className="w-full border-0 rounded-t-md overflow-hidden border-b border-secondary" style={{ tableLayout: "fixed", width: "100%", borderCollapse: "separate" }}>
          <colgroup>
            {columns.map((col) => (
              <col key={col.id} style={{ width: col.getSize() }} />
            ))}
          </colgroup>
          <tbody>
            <tr>
              {cells.map((cell) => {
                const cellAlign = cell.column.id === "ad_name" ? "text-left" : "text-center";
                return (
                  <td key={cell.id} className={`${summaryCellClassName} ${cellAlign}`}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
        <div onClick={(e) => e.stopPropagation()} role="presentation">
          {expandedContent}
        </div>
      </td>
    </tr>
  );
});

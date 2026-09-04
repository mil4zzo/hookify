"use client";

import { useMemo } from "react";
import type { RowSelectionState, Table } from "@tanstack/react-table";
import { RankingsItem } from "@/lib/api/schemas";
import { computeManagerAverages, type ManagerAverages } from "@/lib/metrics";
import type { CustomColumnDef } from "@/lib/metrics/customColumns";

interface UseSelectionAveragesOptions {
  table: Table<RankingsItem>;
  /** Estado da seleção. Não é lido diretamente — é o gatilho do memo: `table` é
   *  instância mutável estável e nunca muda de referência. */
  rowSelection: RowSelectionState;
  actionType?: string;
  hasSheetIntegration?: boolean;
  mqlLeadscoreMin: number | null;
  /** 140: colunas vinculadas da planilha (médias em `custom`). */
  customColumns?: ReadonlyArray<CustomColumnDef>;
}

/**
 * Médias/somas das linhas SELECIONADAS — o grupo de comparação ad-hoc que o usuário
 * monta clicando nos checkboxes, sem precisar transformar isso num filtro.
 *
 * Usa `getSelectedRowModel()` (modelo completo), não o filtrado: uma linha marcada e
 * depois escondida por um filtro continua contando. Sair da média em silêncio por causa
 * de um filtro aplicado depois seria um número errado sem aviso — e é a mesma regra que
 * o compartilhamento já segue (selecionados escondidos entram, no fim da lista).
 *
 * Retorna `null` com seleção vazia (nada a exibir).
 */
export function useSelectionAverages({ table, rowSelection, actionType, hasSheetIntegration = false, mqlLeadscoreMin, customColumns }: UseSelectionAveragesOptions): ManagerAverages | null {
  return useMemo(() => {
    const selectedRows = table.getSelectedRowModel().rows;
    if (selectedRows.length === 0) return null;

    return computeManagerAverages(
      selectedRows.map((row) => row.original as RankingsItem),
      { actionType, hasSheetIntegration, includeScrollStop: false, mqlLeadscoreMin, customColumns },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rowSelection é o gatilho; table é ref estável
  }, [table, rowSelection, actionType, hasSheetIntegration, mqlLeadscoreMin, customColumns]);
}

"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { Table } from "@tanstack/react-table";
import type { RankingsItem } from "@/lib/api/schemas";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import { MANAGER_COLUMNS } from "@/components/manager/managerColumns";
import { AppDialog } from "@/components/common/AppDialog";
import { Button } from "@/components/ui/button";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";
import { exportManagerToCsv } from "@/lib/utils/exportManagerCsv";
import { IconPlus, IconX, IconFileText, IconLoader2, IconDownload } from "@tabler/icons-react";
import { toast } from "sonner";
import { logger } from "@/lib/utils/logger";

type ManagerTab = "individual" | "por-anuncio" | "por-conjunto" | "por-campanha";

const TABS_WITH_TRANSCRIPTION = new Set<ManagerTab>(["por-anuncio", "individual"]);

interface ManagerExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  table: Table<RankingsItem>;
  /** Colunas ativas na tabela — semente da seleção de export */
  activeColumns: Set<ManagerColumnType>;
  hasSheetIntegration: boolean;
  currentTab: ManagerTab;
  dateStart?: string;
  dateStop?: string;
}

export function ManagerExportDialog({ isOpen, onClose, table, activeColumns, hasSheetIntegration, currentTab, dateStart, dateStop }: ManagerExportDialogProps) {
  // Colunas exportáveis (exclui cpmql/mqls/leadscore_avg quando não há integração de planilha — o export as descarta de qualquer forma)
  const availableColumns = useMemo(() => MANAGER_COLUMNS.filter((c) => !((c.id === "cpmql" || c.id === "mqls" || c.id === "leadscore_avg") && !hasSheetIntegration)), [hasSheetIntegration]);

  const [selected, setSelected] = useState<Set<ManagerColumnType>>(new Set());
  const [withTranscriptions, setWithTranscriptions] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Ao abrir: semeia a seleção com as colunas ativas da tabela e reseta o toggle de transcrições
  useEffect(() => {
    if (!isOpen) return;
    const seed = new Set<ManagerColumnType>();
    for (const c of availableColumns) if (activeColumns.has(c.id)) seed.add(c.id);
    setSelected(seed);
    setWithTranscriptions(false);
  }, [isOpen, availableColumns, activeColumns]);

  const showTranscriptionToggle = TABS_WITH_TRANSCRIPTION.has(currentTab);

  // Quantos ads (filtrados+ordenados, o mesmo conjunto que o export percorre) têm transcrição disponível
  const transcriptionStats = useMemo(() => {
    if (!isOpen || !showTranscriptionToggle) return { withT: 0, total: 0 };
    const rows = table.getSortedRowModel().rows;
    let withT = 0;
    for (const r of rows) if (r.original.has_transcription) withT++;
    return { withT, total: rows.length };
  }, [isOpen, showTranscriptionToggle, table]);

  const activeList = availableColumns.filter((c) => selected.has(c.id));
  const inactiveList = availableColumns.filter((c) => !selected.has(c.id));

  const toggleColumn = (id: ManagerColumnType) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const itemLabel = currentTab === "individual" ? "anúncios" : "criativos";

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await exportManagerToCsv({
        table,
        activeColumns: selected,
        hasSheetIntegration,
        currentTab,
        dateStart,
        dateStop,
        withTranscriptions: withTranscriptions && showTranscriptionToggle,
      });
      onClose();
    } catch (e) {
      logger.error("Erro ao exportar CSV:", e);
      toast.error("Erro ao exportar CSV.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <AppDialog isOpen={isOpen} onClose={onClose} title="Exportar CSV" size="lg" padding="md">
      <div className="flex flex-col gap-5">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-text">Exportar CSV</h2>
          <p className="text-sm text-muted-foreground">Escolha as colunas e as opções do arquivo. Nome e Status entram sempre.</p>
        </div>

        {/* Colunas incluídas */}
        <div className="space-y-2">
          <span className="text-sm font-medium text-text">Colunas incluídas ({activeList.length})</span>
          {activeList.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma coluna selecionada — adicione abaixo.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {activeList.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleColumn(c.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-primary-20 bg-primary-10 px-2 py-1 text-xs text-text transition-colors hover:bg-primary-20"
                  aria-label={`Remover ${c.name} do export`}
                >
                  {c.name}
                  <IconX className="h-3 w-3 opacity-70" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Colunas disponíveis */}
        {inactiveList.length > 0 && (
          <div className="space-y-2">
            <span className="text-sm font-medium text-text">Disponíveis ({inactiveList.length})</span>
            <div className="flex flex-wrap gap-1.5">
              {inactiveList.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleColumn(c.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-text"
                  aria-label={`Adicionar ${c.name} ao export`}
                >
                  <IconPlus className="h-3 w-3 opacity-70" />
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Transcrições */}
        {showTranscriptionToggle && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <IconFileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-col">
                <span className="text-sm text-text">Incluir transcrições</span>
                <span className="text-xs text-muted-foreground">
                  {transcriptionStats.withT} de {transcriptionStats.total} {itemLabel} têm transcrição
                </span>
              </div>
            </div>
            <ToggleSwitch
              id="export-transcriptions"
              checked={withTranscriptions}
              onCheckedChange={setWithTranscriptions}
              variant="minimal"
              ariaLabel="Incluir transcrições"
              disabled={transcriptionStats.withT === 0}
            />
          </div>
        )}

        {/* Ações */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={isExporting}>
            Cancelar
          </Button>
          <Button onClick={handleExport} disabled={isExporting || selected.size === 0}>
            {isExporting ? <IconLoader2 className="h-4 w-4 mr-2 animate-spin" /> : <IconDownload className="h-4 w-4 mr-2" />}
            Exportar
          </Button>
        </div>
      </div>
    </AppDialog>
  );
}

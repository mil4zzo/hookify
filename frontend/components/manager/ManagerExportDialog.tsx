"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Row, Table } from "@tanstack/react-table";
import type { RankingsItem } from "@/lib/api/schemas";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import { MANAGER_COLUMNS, MANAGER_COLUMN_RENDER_ORDER, type ManagerColumnOption } from "@/components/manager/managerColumns";
import { AppDialog } from "@/components/common/AppDialog";
import { Button } from "@/components/ui/button";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";
import { exportManagerToCsv, fetchVideoUrls, getVideoAdNames, type VideoUrlFetchResult, type VideoUrlMap } from "@/lib/utils/exportManagerCsv";
import type { MetricValueContext } from "@/lib/metrics/calculations";
import { useProvenanceIndex } from "@/lib/manager/provenance";
import { IconPlus, IconX, IconFileText, IconLoader2, IconDownload, IconVideo, IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { toast } from "sonner";
import { logger } from "@/lib/utils/logger";

type ManagerTab = "individual" | "por-anuncio" | "por-conjunto" | "por-campanha";

const TABS_WITH_TRANSCRIPTION = new Set<ManagerTab>(["por-anuncio", "individual"]);
const TABS_WITH_MEDIA_URLS = new Set<ManagerTab>(["por-anuncio", "individual"]);

interface ManagerExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  table: Table<RankingsItem>;
  /** Colunas ativas na tabela — semente da seleção de export */
  activeColumns: Set<ManagerColumnType>;
  /** Ordem das colunas na tabela — o CSV e a lista deste dialog seguem a mesma ordem. */
  columnOrder?: readonly ManagerColumnType[];
  hasSheetIntegration: boolean;
  currentTab: ManagerTab;
  dateStart?: string;
  dateStop?: string;
  /** Contexto das métricas (actionType, mqlLeadscoreMin) — permite exportar colunas inativas na tabela. */
  metricContext?: MetricValueContext;
}

export function ManagerExportDialog({ isOpen, onClose, table, activeColumns, columnOrder, hasSheetIntegration, currentTab, dateStart, dateStop, metricContext }: ManagerExportDialogProps) {
  const provenanceIndex = useProvenanceIndex();

  // Colunas exportáveis, na ordem da tabela (exclui as métricas de planilha — cpmql/mqls/leadscore_avg/mql_rate — quando não há integração; o export as descarta de qualquer forma)
  const availableColumns = useMemo(() => {
    const byId = new Map(MANAGER_COLUMNS.map((c) => [c.id, c]));
    const order = columnOrder && columnOrder.length > 0 ? columnOrder : MANAGER_COLUMN_RENDER_ORDER;
    return order
      .map((id) => byId.get(id))
      .filter((c): c is ManagerColumnOption => !!c)
      .filter((c) => !((c.id === "cpmql" || c.id === "mqls" || c.id === "leadscore_avg" || c.id === "mql_rate") && !hasSheetIntegration));
  }, [columnOrder, hasSheetIntegration]);

  const [selected, setSelected] = useState<Set<ManagerColumnType>>(new Set());
  const [withTranscriptions, setWithTranscriptions] = useState(false);
  const [withMediaUrls, setWithMediaUrls] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  // Fase de revisão: batch de URLs voltou com falhas — usuário decide retentar ou exportar assim mesmo
  const [videoUrlReview, setVideoUrlReview] = useState<VideoUrlFetchResult | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  // Snapshot das linhas congelado no clique de "Exportar": a tabela pode refetchar com o
  // dialog aberto (fim de refresh de pack invalida o rankings) e reclassificar linhas —
  // o CSV deve sair do MESMO conjunto que a fase de resolução/revisão viu.
  const exportRowsRef = useRef<readonly Row<RankingsItem>[] | null>(null);

  // Ao abrir: semeia a seleção com as colunas ativas da tabela e reseta os toggles
  useEffect(() => {
    if (!isOpen) return;
    const seed = new Set<ManagerColumnType>();
    for (const c of availableColumns) if (activeColumns.has(c.id)) seed.add(c.id);
    setSelected(seed);
    setWithTranscriptions(false);
    setWithMediaUrls(false);
    setVideoUrlReview(null);
    exportRowsRef.current = null;
  }, [isOpen, availableColumns, activeColumns]);

  const showTranscriptionToggle = TABS_WITH_TRANSCRIPTION.has(currentTab);
  const showMediaUrlsToggle = TABS_WITH_MEDIA_URLS.has(currentTab);

  // Quantos ads (filtrados+ordenados, o mesmo conjunto que o export percorre) têm transcrição disponível
  const transcriptionStats = useMemo(() => {
    if (!isOpen || !showTranscriptionToggle) return { withT: 0, total: 0 };
    const rows = table.getSortedRowModel().rows;
    let withT = 0;
    for (const r of rows) if (r.original.has_transcription) withT++;
    return { withT, total: rows.length };
  }, [isOpen, showTranscriptionToggle, table]);

  // Quantos ads/criativos (mesmo conjunto que o export percorre) são vídeo — alvo das URLs
  const mediaUrlStats = useMemo(() => {
    if (!isOpen || !showMediaUrlsToggle) return { videos: 0, total: 0 };
    const rows = table.getSortedRowModel().rows;
    let videos = 0;
    for (const r of rows) if (r.original.media_type === "video") videos++;
    return { videos, total: rows.length };
  }, [isOpen, showMediaUrlsToggle, table]);

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

  const doExport = async (videoUrlMap?: VideoUrlMap) => {
    await exportManagerToCsv({
      table,
      activeColumns: selected,
      provenanceIndex,
      columnOrder,
      hasSheetIntegration,
      currentTab,
      dateStart,
      dateStop,
      withTranscriptions: withTranscriptions && showTranscriptionToggle,
      withMediaUrls: withMediaUrls && showMediaUrlsToggle,
      videoUrlMap,
      rowsSnapshot: exportRowsRef.current ?? undefined,
      metricContext,
    });
    onClose();
  };

  const handleExport = async () => {
    setIsExporting(true);
    exportRowsRef.current = table.getSortedRowModel().rows;
    try {
      // Com URLs de mídia: resolve ANTES de baixar — se houver falhas, abre a
      // fase de revisão (retentar / exportar assim mesmo) em vez de baixar direto
      if (withMediaUrls && showMediaUrlsToggle && mediaUrlStats.videos > 0) {
        const result = await fetchVideoUrls(getVideoAdNames(exportRowsRef.current));
        if (result.failedNames.length > 0) {
          setVideoUrlReview(result);
          return;
        }
        await doExport(result.map);
        return;
      }
      await doExport();
    } catch (e) {
      logger.error("Erro ao exportar CSV:", e);
      toast.error("Erro ao exportar CSV.");
    } finally {
      setIsExporting(false);
    }
  };

  // Re-resolve só as falhas; sucessos anteriores vêm do cache/merge. Zerou → exporta direto.
  const handleRetryFailed = async () => {
    if (!videoUrlReview) return;
    setIsRetrying(true);
    try {
      const result = await fetchVideoUrls(videoUrlReview.failedNames, videoUrlReview.map);
      if (result.failedNames.length === 0) {
        await doExport(result.map);
        return;
      }
      setVideoUrlReview(result);
    } catch (e) {
      logger.error("Erro ao retentar URLs de vídeo:", e);
      toast.error("Erro ao retentar URLs de vídeo.");
    } finally {
      setIsRetrying(false);
    }
  };

  const handleExportAnyway = async () => {
    if (!videoUrlReview) return;
    setIsExporting(true);
    try {
      await doExport(videoUrlReview.map);
    } catch (e) {
      logger.error("Erro ao exportar CSV:", e);
      toast.error("Erro ao exportar CSV.");
    } finally {
      setIsExporting(false);
    }
  };

  if (videoUrlReview) {
    const totalVideos = videoUrlReview.resolved + videoUrlReview.failedNames.length;
    const isBusy = isRetrying || isExporting;
    return (
      <AppDialog isOpen={isOpen} onClose={onClose} title="Exportar CSV" size="lg" padding="md">
        <div className="flex flex-col gap-5">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-text">Exportar CSV</h2>
            <p className="text-sm text-muted-foreground">
              {videoUrlReview.resolved} de {totalVideos} URLs de vídeo resolvidas — {videoUrlReview.failedNames.length} falharam.
            </p>
          </div>

          <div className="space-y-2 rounded-md border border-border bg-background px-3 py-2.5">
            <div className="flex items-center gap-2">
              <IconAlertTriangle className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <span className="text-sm text-text">Motivos das falhas</span>
            </div>
            <ul className="max-h-60 space-y-2 overflow-y-auto">
              {Object.entries(videoUrlReview.failuresByReason)
                .sort(([, a], [, b]) => b.length - a.length)
                .map(([reason, names]) => (
                  <li key={reason} className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-text">{names.length}×</span> {reason}
                    </p>
                    <ul className="space-y-0.5 border-l border-border pl-3">
                      {[...names].sort((a, b) => a.localeCompare(b)).map((name) => (
                        <li key={name} className="truncate text-2xs text-muted-foreground" title={name}>
                          {name}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Ao exportar assim mesmo, os anúncios com falha saem com &quot;ERRO: motivo&quot; na coluna de URL.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setVideoUrlReview(null)} disabled={isBusy}>
              Voltar
            </Button>
            <Button variant="outline" onClick={handleExportAnyway} disabled={isBusy}>
              {isExporting ? <IconLoader2 className="h-4 w-4 mr-2 animate-spin" /> : <IconDownload className="h-4 w-4 mr-2" />}
              Exportar assim mesmo
            </Button>
            <Button onClick={handleRetryFailed} disabled={isBusy}>
              {isRetrying ? <IconLoader2 className="h-4 w-4 mr-2 animate-spin" /> : <IconRefresh className="h-4 w-4 mr-2" />}
              Tentar novamente ({videoUrlReview.failedNames.length})
            </Button>
          </div>
        </div>
      </AppDialog>
    );
  }

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

        {/* URLs das mídias */}
        {showMediaUrlsToggle && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <IconVideo className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-col">
                <span className="text-sm text-text">Incluir URLs das mídias</span>
                <span className="text-xs text-muted-foreground">
                  {mediaUrlStats.videos} de {mediaUrlStats.total} {itemLabel} são vídeo — links da Meta expiram (validade na coluna do CSV)
                </span>
              </div>
            </div>
            <ToggleSwitch
              id="export-media-urls"
              checked={withMediaUrls}
              onCheckedChange={setWithMediaUrls}
              variant="minimal"
              ariaLabel="Incluir URLs das mídias"
              disabled={mediaUrlStats.total === 0}
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

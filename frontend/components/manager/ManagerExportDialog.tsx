"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Row, Table } from "@tanstack/react-table";
import type { RankingsItem } from "@/lib/api/schemas";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import { getManagerColumnOptions, type ManagerColumnOption } from "@/components/manager/managerColumns";
import type { CustomColumnDef } from "@/lib/metrics/customColumns";
import { AppDialog } from "@/components/common/AppDialog";
import { Button } from "@/components/ui/button";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";
import { exportManagerToCsv, fetchMediaUrls, getMediaAdNames, type MediaUrlFetchResult, type MediaUrlMap } from "@/lib/utils/exportManagerCsv";
import type { MetricValueContext } from "@/lib/metrics/calculations";
import { useProvenanceIndex } from "@/lib/manager/provenance";
import { useSessionStore } from "@/lib/store/session";
import { usePackRefresh } from "@/lib/hooks/usePackRefresh";
import { IconPlus, IconX, IconFileText, IconLoader2, IconDownload, IconVideo, IconAlertTriangle, IconRefresh, IconMicrophone } from "@tabler/icons-react";
import { showError } from "@/lib/utils/toast";
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
  /** Packs do contexto — transcrições de pack COMPARTILHADO vivem no silo do dono. */
  packIds?: string[];
  /** 140: colunas vinculadas da planilha nos packs selecionados (exportáveis). */
  customColumns?: ReadonlyArray<CustomColumnDef>;
}

export function ManagerExportDialog({ isOpen, onClose, table, activeColumns, columnOrder, hasSheetIntegration, currentTab, dateStart, dateStop, metricContext, packIds, customColumns = [] }: ManagerExportDialogProps) {
  const provenanceIndex = useProvenanceIndex();
  const packs = useSessionStore((state) => state.packs);
  const { startTranscriptionOnly } = usePackRefresh();

  // Colunas exportáveis, na ordem da tabela (exclui as métricas de planilha — cpmql/mqls/leadscore_avg/mql_rate — quando não há integração; o export as descarta de qualquer forma)
  const availableColumns = useMemo(() => {
    const options = getManagerColumnOptions(customColumns);
    const byId = new Map(options.map((c) => [c.id, c]));
    const order = columnOrder && columnOrder.length > 0 ? columnOrder : options.map((c) => c.id);
    return order
      .map((id) => byId.get(id))
      .filter((c): c is ManagerColumnOption => !!c)
      .filter((c) => !((c.id === "cpmql" || c.id === "mqls" || c.id === "leadscore_avg" || c.id === "mql_rate") && !hasSheetIntegration));
  }, [columnOrder, hasSheetIntegration, customColumns]);

  const [selected, setSelected] = useState<Set<ManagerColumnType>>(new Set());
  const [withTranscriptions, setWithTranscriptions] = useState(false);
  const [withMediaUrls, setWithMediaUrls] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  // Fase de revisão: batch de URLs voltou com falhas — usuário decide retentar ou exportar assim mesmo
  const [mediaUrlReview, setMediaUrlReview] = useState<MediaUrlFetchResult | null>(null);
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
    setMediaUrlReview(null);
    exportRowsRef.current = null;
  }, [isOpen, availableColumns, activeColumns]);

  const showTranscriptionToggle = TABS_WITH_TRANSCRIPTION.has(currentTab);
  const showMediaUrlsToggle = TABS_WITH_MEDIA_URLS.has(currentTab);

  // Composição do recorte que o export percorre (filtrado+ordenado, as MESMAS linhas
  // que virarão o CSV). Uma varredura só alimenta a linha de composição do card, o
  // rótulo das transcrições e o das URLs — antes eram duas contagens separadas, cada
  // uma com um denominador diferente, e cabia ao usuário conferir se batiam.
  //
  // O denominador da transcrição é o total de VÍDEOS, não o de criativos: imagem não
  // tem áudio e nunca será transcrita, então incluí-la no "de N" fazia um pack 100%
  // transcrito parecer incompleto (o caso real: "172 de 257", sendo 172/172 vídeos).
  //
  // 142: o vídeo não transcrito se divide em dois, e a diferença é o que separa um
  // botão que funciona de um que mente. "Sem áudio detectável" é falha PERMANENTE — o
  // backend recusa transcrever — então esses ficam fora de `pendingVideoRows` e fora
  // da conta do botão; entram no rótulo, para o número fechar aos olhos do usuário.
  const creativeStats = useMemo(() => {
    if (!isOpen || !(showTranscriptionToggle || showMediaUrlsToggle)) return null;
    const rows = table.getSortedRowModel().rows;
    let videos = 0;
    let images = 0;
    let unknown = 0;
    let videosTranscribed = 0;
    let videosNoAudio = 0;
    let transcribedTotal = 0;
    const pendingVideoRows: Row<RankingsItem>[] = [];
    for (const r of rows) {
      const hasTranscription = !!r.original.has_transcription;
      if (hasTranscription) transcribedTotal++;
      const mediaType = r.original.media_type;
      if (mediaType === "video") {
        videos++;
        if (hasTranscription) videosTranscribed++;
        else if (r.original.transcription_no_audio) videosNoAudio++;
        else pendingVideoRows.push(r);
      } else if (mediaType === "image") {
        images++;
      } else {
        unknown++;
      }
    }
    return { total: rows.length, videos, images, unknown, videosTranscribed, videosNoAudio, transcribedTotal, pendingVideoRows };
  }, [isOpen, showTranscriptionToggle, showMediaUrlsToggle, table]);

  // Vídeos ainda sem transcrição, agrupados pelo pack de onde a linha veio — a rota de
  // transcrição é POR PACK (`/packs/{id}/transcribe`), então o dialog precisa saber a
  // qual pack cada ad_name pertence. Pack em que o usuário é `viewer` fica de fora: o
  // backend recusa (transcrição gasta o saldo de AssemblyAI do dono).
  //
  // Cuidado com o pack escolhido: a rota, ao filtrar por `ad_names` e não achar nenhum,
  // cai de volta para "transcrever o pack inteiro". Só entram pares (pack, ad_name) em
  // que a própria linha declara o pack, o que garante o filtro não-vazio.
  const transcribePlan = useMemo(() => {
    if (!creativeStats || creativeStats.pendingVideoRows.length === 0) return null;
    const writablePacks = new Map<string, string>();
    for (const p of packs ?? []) {
      if (p?.id && p.shared_role !== "viewer") writablePacks.set(String(p.id), String(p.name || p.id));
    }
    const byPack = new Map<string, { name: string; adNames: string[] }>();
    const claimed = new Set<string>();
    let unreachable = 0;
    for (const r of creativeStats.pendingVideoRows) {
      const adName = String(r.original.ad_name ?? "").trim();
      if (!adName || claimed.has(adName)) continue;
      const packId = (r.original.pack_ids ?? []).map(String).find((id) => writablePacks.has(id));
      if (!packId) {
        unreachable++;
        continue;
      }
      claimed.add(adName);
      const entry = byPack.get(packId) ?? { name: writablePacks.get(packId)!, adNames: [] };
      entry.adNames.push(adName);
      byPack.set(packId, entry);
    }
    // `count === 0` com `unreachable > 0` ainda vale render: o usuário precisa saber
    // POR QUE não há botão para os vídeos que ele vê como não transcritos.
    if (claimed.size === 0 && unreachable === 0) return null;
    return { byPack, count: claimed.size, unreachable };
  }, [creativeStats, packs]);

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

  const allSelected = availableColumns.length > 0 && selected.size === availableColumns.length;
  const toggleAllColumns = () => {
    setSelected(allSelected ? new Set() : new Set(availableColumns.map((c) => c.id)));
  };

  const itemLabel = currentTab === "individual" ? "anúncios" : "criativos";

  // Transcrever daqui evita o desvio "sair do export → /packs → transcrever → voltar".
  // Um job (e um toast) por pack, como se o usuário tivesse clicado em cada card;
  // ao terminar, o polling invalida os rankings e a contagem daqui já sobe sozinha.
  const handleTranscribePending = async () => {
    if (!transcribePlan) return;
    const jobs = Array.from(transcribePlan.byPack.entries());
    onClose();
    for (const [packId, { name, adNames }] of jobs) {
      await startTranscriptionOnly(packId, name, adNames);
    }
  };

  const doExport = async (mediaUrlMap?: MediaUrlMap) => {
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
      mediaUrlMap,
      rowsSnapshot: exportRowsRef.current ?? undefined,
      metricContext,
      packIds,
      customColumns,
    });
    onClose();
  };

  const handleExport = async () => {
    setIsExporting(true);
    exportRowsRef.current = table.getSortedRowModel().rows;
    try {
      // Com URLs de mídia: resolve ANTES de baixar — se houver falhas, abre a
      // fase de revisão (retentar / exportar assim mesmo) em vez de baixar direto
      if (withMediaUrls && showMediaUrlsToggle && (creativeStats?.videos ?? 0) + (creativeStats?.images ?? 0) > 0) {
        const result = await fetchMediaUrls(getMediaAdNames(exportRowsRef.current), {}, packIds);
        if (result.failedNames.length > 0) {
          setMediaUrlReview(result);
          return;
        }
        await doExport(result.map);
        return;
      }
      await doExport();
    } catch (e) {
      logger.error("Erro ao exportar CSV:", e instanceof Error ? e.message : e, e);
      showError(e);
    } finally {
      setIsExporting(false);
    }
  };

  // Re-resolve só as falhas; sucessos anteriores vêm do cache/merge. Zerou → exporta direto.
  const handleRetryFailed = async () => {
    if (!mediaUrlReview) return;
    setIsRetrying(true);
    try {
      const result = await fetchMediaUrls(mediaUrlReview.failedNames, mediaUrlReview.map, packIds);
      if (result.failedNames.length === 0) {
        await doExport(result.map);
        return;
      }
      setMediaUrlReview(result);
    } catch (e) {
      logger.error("Erro ao retentar URLs de mídia:", e instanceof Error ? e.message : e, e);
      showError(e);
    } finally {
      setIsRetrying(false);
    }
  };

  const handleExportAnyway = async () => {
    if (!mediaUrlReview) return;
    setIsExporting(true);
    try {
      await doExport(mediaUrlReview.map);
    } catch (e) {
      logger.error("Erro ao exportar CSV:", e instanceof Error ? e.message : e, e);
      showError(e);
    } finally {
      setIsExporting(false);
    }
  };

  if (mediaUrlReview) {
    const totalMedia = mediaUrlReview.resolved + mediaUrlReview.failedNames.length;
    const isBusy = isRetrying || isExporting;
    return (
      <AppDialog isOpen={isOpen} onClose={onClose} title="Exportar CSV" size="lg" padding="md">
        <div className="flex flex-col gap-5">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-text">Exportar CSV</h2>
            <p className="text-sm text-muted-foreground">
              {mediaUrlReview.resolved} de {totalMedia} URLs de mídia resolvidas — {mediaUrlReview.failedNames.length} falharam.
            </p>
          </div>

          <div className="space-y-2 rounded-md border border-border bg-background px-3 py-2.5">
            <div className="flex items-center gap-2">
              <IconAlertTriangle className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <span className="text-sm text-text">Motivos das falhas</span>
            </div>
            <ul className="max-h-60 space-y-2 overflow-y-auto">
              {Object.entries(mediaUrlReview.failuresByReason)
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
            <Button variant="ghost" onClick={() => setMediaUrlReview(null)} disabled={isBusy}>
              Voltar
            </Button>
            <Button variant="outline" onClick={handleExportAnyway} disabled={isBusy}>
              {isExporting ? <IconLoader2 className="h-4 w-4 mr-2 animate-spin" /> : <IconDownload className="h-4 w-4 mr-2" />}
              Exportar assim mesmo
            </Button>
            <Button onClick={handleRetryFailed} disabled={isBusy}>
              {isRetrying ? <IconLoader2 className="h-4 w-4 mr-2 animate-spin" /> : <IconRefresh className="h-4 w-4 mr-2" />}
              Tentar novamente ({mediaUrlReview.failedNames.length})
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
          {/* Composição do recorte, UMA vez e no topo: é contexto do arquivo inteiro,
              não de um toggle. Antes vivia dentro do card de URLs, obrigando a somar
              de cabeça para conferir o total. */}
          {creativeStats && (
            <p className="text-xs text-muted-foreground">
              {creativeStats.total} {itemLabel} no recorte
              {creativeStats.videos > 0 && ` · ${creativeStats.videos} de vídeo`}
              {creativeStats.images > 0 && ` · ${creativeStats.images} de imagem`}
              {creativeStats.unknown > 0 && ` · ${creativeStats.unknown} sem mídia identificada`}
            </p>
          )}
        </div>

        {/* Colunas incluídas */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-text">Colunas incluídas ({activeList.length})</span>
            {availableColumns.length > 0 && (
              <Button variant="ghost" size="sm" onClick={toggleAllColumns}>
                {allSelected ? "Desmarcar todas" : "Marcar todas"}
              </Button>
            )}
          </div>
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
        {showTranscriptionToggle && creativeStats && (
          <div className="flex flex-col gap-2.5 rounded-md border border-border bg-background px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <IconFileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm text-text">Incluir transcrições</span>
                  <span className="text-xs text-muted-foreground">
                    {creativeStats.videos === 0
                      ? "Nenhum criativo de vídeo neste recorte"
                      : creativeStats.videosTranscribed === creativeStats.videos
                        ? `Todos os ${creativeStats.videos} vídeos estão transcritos`
                        : `${creativeStats.videosTranscribed} de ${creativeStats.videos} vídeos transcritos`}
                    {/* O "sem áudio" é o que faz a conta fechar: sem ele, 160 de 172 com
                        botão de "Transcrever 0" pareceria bug. */}
                    {creativeStats.videosNoAudio > 0 &&
                      ` · ${creativeStats.videosNoAudio} sem áudio detectável`}
                  </span>
                </div>
              </div>
              <ToggleSwitch
                id="export-transcriptions"
                checked={withTranscriptions}
                onCheckedChange={setWithTranscriptions}
                variant="minimal"
                ariaLabel="Incluir transcrições"
                disabled={creativeStats.transcribedTotal === 0}
              />
            </div>

            {transcribePlan && (
              <div className="flex items-center justify-between gap-3 border-t border-border pt-2.5">
                <p className="min-w-0 text-xs text-muted-foreground">
                  {transcribePlan.count > 0 && "Transcreva sem sair daqui — a contagem acima sobe sozinha quando terminar. "}
                  {transcribePlan.unreachable > 0 &&
                    `${transcribePlan.unreachable} ${transcribePlan.unreachable === 1 ? "vídeo está" : "vídeos estão"} em pack compartilhado só para leitura — só o dono pode transcrever.`}
                </p>
                {transcribePlan.count > 0 && (
                  <Button variant="outline" size="sm" onClick={handleTranscribePending} disabled={isExporting}>
                    <IconMicrophone className="h-4 w-4" />
                    Transcrever {transcribePlan.count}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {/* URLs das mídias */}
        {showMediaUrlsToggle && creativeStats && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <IconVideo className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-col">
                <span className="text-sm text-text">Incluir URLs das mídias</span>
                <span className="text-xs text-muted-foreground">
                  Link direto de cada vídeo e imagem, com a validade na coluna ao lado
                </span>
              </div>
            </div>
            <ToggleSwitch
              id="export-media-urls"
              checked={withMediaUrls}
              onCheckedChange={setWithMediaUrls}
              variant="minimal"
              ariaLabel="Incluir URLs das mídias"
              disabled={creativeStats.videos + creativeStats.images === 0}
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

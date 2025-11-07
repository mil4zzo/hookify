"use client";

import { useMemo, useState, useEffect, Fragment } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/common/Modal";
import { useFormatCurrency } from "@/lib/utils/currency";
import { AdInfoCard } from "@/components/ads/AdInfoCard";
import { AdDetailsDialog } from "@/components/ads/AdDetailsDialog";
import { VideoDialog } from "@/components/ads/VideoDialog";
import { createColumnHelper, getCoreRowModel, getSortedRowModel, useReactTable, flexRender } from "@tanstack/react-table";
import { IconArrowsSort, IconPlayerPlay, IconEye } from "@tabler/icons-react";
import { SparklineBars } from "@/components/common/SparklineBars";
import { MetricCard } from "@/components/common/MetricCard";
import { buildDailySeries } from "@/lib/utils/metricsTimeSeries";
import { api } from "@/lib/api/endpoints";
import { useAdVariations } from "@/lib/api/hooks";
import { RankingsItem, RankingsChildrenItem } from "@/lib/api/schemas";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";

type Ad = RankingsItem;

interface RankingsTableProps {
  ads: Ad[];
  groupByAdName?: boolean;
  actionType?: string;
  endDate?: string;
  dateStart?: string;
  dateStop?: string;
  averagesOverride?: {
    hook: number | null;
    scroll_stop: number | null;
    ctr: number | null;
    connect_rate: number | null;
    cpm: number | null;
    cpr: number | null;
    page_conv: number | null;
  };
}

const columnHelper = createColumnHelper<Ad>();

// Componente interno para renderizar linha expandida de variações
function ExpandedChildrenRow({
  row,
  adName,
  dateStart,
  dateStop,
  actionType,
  formatCurrency,
  formatPct,
}: {
  row: { getVisibleCells: () => any[] };
  adName: string;
  dateStart: string;
  dateStop: string;
  actionType?: string;
  formatCurrency: (n: number) => string;
  formatPct: (v: number) => string;
}) {
  const { data: childrenData, isLoading, isError } = useAdVariations(adName, dateStart, dateStop, true);

  if (isLoading) {
    return (
      <tr className="bg-border">
        <td className="p-0" colSpan={row.getVisibleCells().length}>
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
        <td className="p-0" colSpan={row.getVisibleCells().length}>
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
        <td className="p-0" colSpan={row.getVisibleCells().length}>
          <div className="p-2 pl-8">
            <div className="text-sm text-muted-foreground">Sem variações no período.</div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="bg-border">
      <td className="p-0" colSpan={row.getVisibleCells().length}>
        <div className="p-2 pl-8">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-border">
                  <th className="p-2 text-left">Ad ID</th>
                  <th className="p-2 text-center">Hook</th>
                  <th className="p-2 text-center">CPR</th>
                  <th className="p-2 text-center">Spend</th>
                  <th className="p-2 text-center">CTR</th>
                  <th className="p-2 text-center">CPM</th>
                  <th className="p-2 text-center">Connect</th>
                  <th className="p-2 text-center">Page</th>
                </tr>
              </thead>
              <tbody>
                {childrenData.map((child: RankingsChildrenItem) => {
                  const lpv = Number(child.lpv || 0);
                  const spend = Number(child.spend || 0);
                  const impressions = Number(child.impressions || 0);
                  const conversions = child.conversions || {};
                  // Calcular results: usar actionType se disponível, senão somar todas as conversões
                  let results = 0;
                  if (actionType && typeof actionType === "string" && actionType.trim()) {
                    results = Number(conversions[actionType] || 0);
                  } else {
                    // Se não há actionType, somar todas as conversões disponíveis
                    results = Object.values(conversions).reduce((sum, val) => {
                      const numVal = Number(val || 0);
                      return sum + (Number.isNaN(numVal) ? 0 : numVal);
                    }, 0);
                  }
                  const page_conv = lpv > 0 && results > 0 ? results / lpv : 0;
                  const cpr = results > 0 && spend > 0 ? spend / results : 0;
                  const cpm = impressions > 0 ? (spend * 1000) / impressions : 0;
                  const rowForMetric = { ...child, cpr, page_conv, cpm };
                  return (
                    <tr key={child.ad_id} className="hover:bg-muted">
                      <td className="p-2 text-left">
                        <div className="flex items-center gap-2">
                          {(() => {
                            const thumb = getAdThumbnail(child);
                            return thumb ? <img src={thumb} alt="thumb" className="w-10 h-10 object-cover rounded" /> : <div className="w-10 h-10 bg-border rounded" />;
                          })()}
                          <div className="truncate">{child.ad_id}</div>
                        </div>
                      </td>
                      <td className="p-2 text-center">{formatPct(Number(child.hook * 100))}</td>
                      <td className="p-2 text-center">{cpr > 0 ? formatCurrency(cpr) : "—"}</td>
                      <td className="p-2 text-center">{formatCurrency(spend)}</td>
                      <td className="p-2 text-center">{formatPct(Number(child.ctr * 100))}</td>
                      <td className="p-2 text-center">{formatCurrency(cpm)}</td>
                      <td className="p-2 text-center">{formatPct(Number(child.connect_rate * 100))}</td>
                      <td className="p-2 text-center">{page_conv > 0 ? formatPct(Number(page_conv * 100)) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </td>
    </tr>
  );
}

export function RankingsTable({ ads, groupByAdName = true, actionType = "", endDate, dateStart, dateStop, availableConversionTypes = [], averagesOverride }: RankingsTableProps) {
  const [selectedAd, setSelectedAd] = useState<Ad | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<{ videoId: string; actorId: string; title: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Os dados já vêm agregados do servidor quando pais; não re-agregar aqui
  const data = useMemo(() => ads, [ads]);
  const formatCurrency = useFormatCurrency();

  const formatPct = (v: number) => (v != null && !isNaN(v) ? `${Number(v).toFixed(2)}%` : "—");
  const formatNum = (v: number) => (v ? v.toLocaleString("pt-BR") : "—");
  // formatUsd agora usa formatCurrency diretamente dentro dos cells para reatividade

  type RankingsAverages = {
    count: number;
    spend: number;
    impressions: number;
    clicks: number;
    lpv: number;
    plays: number;
    results: number;
    hook: number | null;
    scroll_stop: number | null;
    ctr: number | null;
    connect_rate: number | null;
    cpm: number | null;
    cpr: number | null;
    page_conv: number | null;
  };

  const computedAverages: RankingsAverages = useMemo(() => {
    const n = ads.length;
    if (n === 0) {
      return {
        count: 0,
        spend: 0,
        impressions: 0,
        clicks: 0,
        lpv: 0,
        plays: 0,
        results: 0,
        hook: null,
        scroll_stop: null,
        ctr: null,
        connect_rate: null,
        cpm: null,
        cpr: null,
        page_conv: null,
      };
    }

    let sumSpend = 0;
    let sumImpr = 0;
    let sumClicks = 0;
    let sumLPV = 0;
    let sumPlays = 0;
    let sumResults = 0;

    let hookWeighted = 0;
    let hookWeight = 0;

    let scrollStopWeighted = 0;
    let scrollStopWeight = 0;

    let sumConnect = 0;
    let countConnect = 0;

    for (const ad of ads) {
      const spend = Number((ad as any).spend || 0);
      const impressions = Number((ad as any).impressions || 0);
      const clicks = Number((ad as any).clicks || 0);
      const lpv = Number((ad as any).lpv || 0);
      // Nem todos os objetos têm plays; usar fallback em video_total_plays se disponível
      const plays = Number((ad as any).plays ?? (ad as any).video_total_plays ?? 0);
      const hook = Number((ad as any).hook ?? 0);
      const connectRateVal = Number((ad as any).connect_rate ?? NaN);
      const convs = (ad as any).conversions || {};
      const res = actionType ? Number(convs[actionType] || 0) : 0;

      sumSpend += spend;
      sumImpr += impressions;
      sumClicks += clicks;
      sumLPV += lpv;
      sumPlays += plays;
      sumResults += res;

      const w = plays > 0 ? plays : 1;
      if (!Number.isNaN(hook)) {
        hookWeighted += hook * w;
        hookWeight += w;
      }

      // Calcular scroll_stop (índice 1 da curva de retenção) ponderado por plays
      // A curva vem em porcentagem (0-100), então normalizamos para decimal (0-1) antes de ponderar
      const curve = (ad as any).video_play_curve_actions;
      if (Array.isArray(curve) && curve.length > 1) {
        const scrollStopRaw = Number(curve[1] || 0);
        if (!Number.isNaN(scrollStopRaw) && isFinite(scrollStopRaw) && scrollStopRaw >= 0) {
          // Normalizar: se valor > 1, assume que está em porcentagem e divide por 100
          const scrollStopVal = scrollStopRaw > 1 ? scrollStopRaw / 100 : scrollStopRaw;
          if (scrollStopVal >= 0 && scrollStopVal <= 1) {
            scrollStopWeighted += scrollStopVal * w;
            scrollStopWeight += w;
          }
        }
      }

      if (!Number.isNaN(connectRateVal)) {
        sumConnect += connectRateVal;
        countConnect += 1;
      }
    }

    const hookAvg = hookWeight > 0 ? hookWeighted / hookWeight : null;
    const scrollStopAvg = scrollStopWeight > 0 ? scrollStopWeighted / scrollStopWeight : null;
    const ctr = sumImpr > 0 ? sumClicks / sumImpr : null;
    const cpm = sumImpr > 0 ? (sumSpend * 1000) / sumImpr : null;
    const cpr = sumResults > 0 ? sumSpend / sumResults : null;
    const pageConv = sumLPV > 0 ? sumResults / sumLPV : null;
    const connectAvg = countConnect > 0 ? sumConnect / countConnect : null;

    return {
      count: n,
      spend: sumSpend,
      impressions: sumImpr,
      clicks: sumClicks,
      lpv: sumLPV,
      plays: sumPlays,
      results: sumResults,
      hook: hookAvg,
      scroll_stop: scrollStopAvg,
      ctr,
      connect_rate: connectAvg,
      cpm,
      cpr,
      page_conv: pageConv,
    };
  }, [ads, actionType]);

  const averages = useMemo(() => {
    if (averagesOverride) {
      return {
        count: computedAverages.count,
        spend: computedAverages.spend,
        impressions: computedAverages.impressions,
        clicks: computedAverages.clicks,
        lpv: computedAverages.lpv,
        plays: computedAverages.plays,
        results: computedAverages.results,
        hook: averagesOverride.hook,
        scroll_stop: averagesOverride.scroll_stop,
        ctr: averagesOverride.ctr,
        connect_rate: averagesOverride.connect_rate,
        cpm: averagesOverride.cpm,
        cpr: averagesOverride.cpr,
        page_conv: averagesOverride.page_conv,
      } as RankingsAverages;
    }
    return computedAverages;
  }, [computedAverages, averagesOverride]);

  const getRowKey = (row: { original?: RankingsItem } | RankingsItem) => {
    const original = 'original' in row ? row.original : row;
    if (!original) return '';
    return groupByAdName ? String(original.ad_name || original.ad_id) : String(original.unique_id || `${original.account_id}:${original.ad_id}`);
  };

  // Pre-aggregate 5-day daily series ending at provided endDate (fallback se não vier do servidor)
  const { byKey } = useMemo(() => {
    if (!endDate) return { byKey: new Map<string, any>() };
    // Verificar se os dados já vêm com séries do servidor
    const hasServerSeries = ads.length > 0 && ads[0]?.series;
    if (hasServerSeries) {
      // Construir mapa a partir das séries do servidor
      const map = new Map<string, any>();
      ads.forEach((ad: RankingsItem) => {
        const key = getRowKey({ original: ad });
        if (ad.series) {
          map.set(key, { series: ad.series, axis: ad.series.axis });
        }
      });
      return { byKey: map };
    }
    // Fallback: calcular séries client-side
    return buildDailySeries(ads, {
      groupBy: groupByAdName ? "ad_name" : "ad_id",
      actionType,
      endDate,
      dateField: "date",
      windowDays: 5,
    });
  }, [ads, groupByAdName, actionType, endDate]);

  const MetricCell = ({ row, value, metric }: { row: RankingsItem | { original?: RankingsItem }; value: React.ReactNode; metric: "hook" | "cpr" | "spend" | "ctr" | "connect_rate" | "page_conv" | "cpm" }) => {
    // row já é o objeto agregado (info.row.original), então precisamos ajustar
    const original: RankingsItem = ('original' in row ? row.original : row) as RankingsItem;
    const serverSeries = original.series?.[metric];
    const s = serverSeries || (endDate ? byKey.get(getRowKey({ original: row }))?.series?.[metric] : null);
    
    return (
      <div className="flex flex-col items-center gap-3">
        {s ? (
          <SparklineBars 
            series={s} 
            size="small"
            valueFormatter={(n: number) => {
              if (metric === "spend" || metric === "cpr" || metric === "cpm") {
                return formatCurrency(n || 0);
              }
              // percent-based metrics
              return `${(n * 100).toFixed(2)}%`;
            }} 
          />
        ) : null}
        <span className="text-base font-medium leading-none">{value}</span>
      </div>
    );
  };

  const columns = useMemo(
    () => [
      // AD name
      columnHelper.accessor("ad_name", {
        header: "AD",
        size: 140,
        minSize: 140,
        cell: (info) => {
          const original = info.row.original as RankingsItem;
          const thumbnail = getAdThumbnail(original);
          const name = String(info.getValue() || "—");
          const id = original?.ad_id;
          const adCount = original?.ad_count || 1;
          const key = getRowKey(info.row);
          const isExpanded = !!expanded[key];

          let secondLine = "";
          if (groupByAdName) {
            secondLine = adCount === 1 ? "1 anúncio" : `+ ${adCount} anúncios`;
          } else {
            secondLine = adCount === 1 ? `ID: ${id || "-"}` : `ID: ${id || "-"} (${adCount} dias)`;
          }

          const handleToggleExpand = (e?: React.MouseEvent) => {
            e?.stopPropagation();
            const next = !isExpanded;
            setExpanded((prev) => ({ ...prev, [key]: next }));
          };

          return (
            <div className="flex items-center gap-2">
              {thumbnail ? <img src={thumbnail} alt="thumb" className="w-14 h-14 object-cover rounded" /> : <div className="w-14 h-14 bg-border rounded" />}
              <div className="min-w-0">
                <div className="truncate">{name}</div>
                {groupByAdName ? (
                  <div className="mt-1">
                    <Button size="sm" variant="ghost" onClick={handleToggleExpand} className="h-auto py-1 px-2 text-xs text-muted-foreground hover:text-text">
                      {isExpanded ? "- Recolher" : secondLine}
                    </Button>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground truncate">{secondLine}</div>
                )}
              </div>
            </div>
          );
        },
      }),
      // Hook (retention at 3s)
      columnHelper.accessor("hook", {
        header: "Hook",
        size: 140,
        minSize: 100,
        cell: (info) => {
          // Pegar hook diretamente do row.original em caso do accessor não funcionar
          const original = info.row.original as RankingsItem;
          const hookValue = info.getValue() ?? original?.hook ?? 0;
          const hookAsPct = Number(hookValue) * 100;
          return <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatPct(hookAsPct)}</span>} metric="hook" />;
        },
        sortingFn: "auto",
      }),
      // CPR
      columnHelper.accessor("cpr", {
        header: "CPR",
        size: 140,
        minSize: 100,
        cell: (info) => <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatCurrency(Number(info.getValue()) || 0)}</span>} metric="cpr" />,
        sortingFn: "auto",
      }),
      // Spend
      columnHelper.accessor("spend", {
        header: "Spend",
        size: 140,
        minSize: 100,
        cell: (info) => <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatCurrency(Number(info.getValue()) || 0)}</span>} metric="spend" />,
      }),
      // CTR
      columnHelper.accessor("ctr", {
        header: "CTR",
        size: 140,
        minSize: 100,
        cell: (info) => <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatPct(Number(info.getValue() * 100))}</span>} metric="ctr" />,
      }),
      // CPM
      columnHelper.accessor("cpm", {
        header: "CPM",
        size: 140,
        minSize: 100,
        cell: (info) => <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatCurrency(Number(info.getValue()) || 0)}</span>} metric="cpm" />,
        sortingFn: "auto",
      }),
      // Connect Rate
      columnHelper.accessor("connect_rate", {
        header: "Connect Rate",
        size: 160,
        minSize: 120,
        cell: (info) => <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatPct(Number(info.getValue() * 100))}</span>} metric="connect_rate" />,
      }),
      // Page Conversion
      columnHelper.accessor("page_conv", {
        header: "Page",
        size: 140,
        minSize: 100,
        cell: (info) => <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatPct(Number(info.getValue() * 100))}</span>} metric="page_conv" />,
      }),
    ],
    [groupByAdName, byKey, expanded, dateStart, dateStop, formatCurrency]
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: "onChange",
    initialState: {
      sorting: [{ id: "spend", desc: true }],
    },
    defaultColumn: {
      size: 120,
      minSize: 80,
    },
  });

  return (
    <div className="w-full">
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-sm border-separate border-spacing-y-4">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="sticky top-0 z-10 text-text/80">
                {hg.headers.map((header) => {
                  const headerAlign = header.column.id === "ad_name" ? "text-left" : "text-center";
                  const justify = header.column.id === "ad_name" ? "justify-start" : "justify-center";
                  const fixedWidth = "";
                  return (
                    <th key={header.id} className={`text-base font-normal py-4 ${headerAlign} ${fixedWidth} relative`} style={{ width: header.getSize() }}>
                      {header.isPlaceholder ? null : (
                        <div className={`flex items-center ${justify} gap-1 ${header.column.getCanSort() ? "cursor-pointer select-none hover:text-brand" : ""} ${header.column.getIsSorted() ? "text-primary" : ""}`} onClick={header.column.getToggleSortingHandler()}>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <IconArrowsSort className="w-3 h-3" />
                        </div>
                      )}
                      {header.column.getCanResize() && <div onMouseDown={header.getResizeHandler()} onTouchStart={header.getResizeHandler()} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none touch-none" />}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row, index) => {
              const key = getRowKey(row);
              const isExpanded = !!expanded[key];
              const original = row.original as RankingsItem;
              const adName = String(original?.ad_name || "");
              
              return (
                <Fragment key={row.id}>
                    <tr
                      key={`${row.id}-parent`}
                      className="bg-background hover:bg-input-30 cursor-pointer"
                      onClick={() => {
                        const original = row.original as RankingsItem;
                        setSelectedAd(original);
                      }}
                    >
                    {row.getVisibleCells().map((cell) => {
                      const cellAlign = cell.column.id === "ad_name" ? "text-left" : "text-center";
                      const fixedWidth = "";
                      const cellIndex = row.getVisibleCells().indexOf(cell);
                      const isFirst = cellIndex === 0;
                      const isLast = cellIndex === row.getVisibleCells().length - 1;
                      return (
                        <td key={cell.id} className={`p-4 ${cellAlign} ${fixedWidth} border-y border-border ${isFirst ? "rounded-l-md border-l" : ""} ${isLast ? "rounded-r-md border-r" : ""}`} style={{ width: cell.column.getSize() }}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                  {groupByAdName && isExpanded && adName ? (
                    <ExpandedChildrenRow
                      row={row}
                      adName={adName}
                      dateStart={dateStart || ""}
                      dateStop={dateStop || ""}
                      actionType={actionType}
                      formatCurrency={formatCurrency}
                      formatPct={formatPct}
                    />
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Details Dialog */}
        <Modal isOpen={!!selectedAd} onClose={() => setSelectedAd(null)} size="full" padding="md">
          {selectedAd && (
            <AdDetailsDialog
              ad={selectedAd}
              groupByAdName={groupByAdName}
              dateStart={dateStart}
              dateStop={dateStop}
              actionType={actionType}
              availableConversionTypes={availableConversionTypes}
              averages={averages}
            />
          )}
        </Modal>

      {/* Video Dialog - Único para toda a tabela */}
      <VideoDialog
        open={videoOpen}
        onOpenChange={(open) => {
          setVideoOpen(open);
          if (!open) setSelectedVideo(null);
        }}
        videoId={selectedVideo?.videoId}
        actorId={selectedVideo?.actorId}
        title={selectedVideo?.title}
      />
    </div>
  );
}

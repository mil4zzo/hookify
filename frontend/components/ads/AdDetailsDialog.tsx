"use client";

import { useMemo, useState } from "react";
import { useFormatCurrency } from "@/lib/utils/currency";
import { MetricCard } from "@/components/common/MetricCard";
import { RetentionChart } from "@/components/charts/RetentionChart";
import { SparklineBars } from "@/components/common/SparklineBars";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdVariations, useAdDetails, useAdCreative, useVideoSource, useAdHistory, useAdNameHistory } from "@/lib/api/hooks";
import { RankingsItem, RankingsChildrenItem } from "@/lib/api/schemas";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";
import { MetricHistoryChart, AVAILABLE_METRICS } from "@/components/charts/MetricHistoryChart";

interface AdDetailsDialogProps {
  ad: RankingsItem;
  groupByAdName: boolean;
  dateStart?: string;
  dateStop?: string;
  actionType?: string;
  availableConversionTypes?: string[]; // Tipos de conversão disponíveis (mesmos do seletor)
  averages?: {
    hook: number | null;
    scroll_stop: number | null;
    ctr: number | null;
    website_ctr: number | null;
    connect_rate: number | null;
    cpm: number | null;
    cpr: number | null;
    page_conv: number | null;
  };
}

export function AdDetailsDialog({ ad, groupByAdName, dateStart, dateStop, actionType, availableConversionTypes = [], averages }: AdDetailsDialogProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "conversions" | "variations" | "series" | "video" | "history">("overview");
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(["spend"]);

  const adName = String(ad?.ad_name || "");
  const adId = String(ad?.ad_id || "");
  const shouldLoadVariations = groupByAdName && activeTab === "variations" && !!adName && !!dateStart && !!dateStop;
  const shouldLoadDetails = activeTab === "overview" && !!adId && !!dateStart && !!dateStop;
  const shouldLoadCreative = activeTab === "video" && !!adId;
  const shouldLoadHistoryById = activeTab === "history" && !groupByAdName && !!adId && !!dateStart && !!dateStop;
  const shouldLoadHistoryByName = activeTab === "history" && groupByAdName && !!adName && !!dateStart && !!dateStop;

  const { data: childrenData, isLoading: loadingChildren, refetch: loadChildren } = useAdVariations(adName, dateStart || "", dateStop || "", shouldLoadVariations);

  const { data: adDetails } = useAdDetails(adId, dateStart || "", dateStop || "", shouldLoadDetails);

  // Buscar creative e video_ids quando a tab de vídeo estiver ativa
  const { data: creativeData, isLoading: loadingCreative } = useAdCreative(adId, shouldLoadCreative);

  // Extrair video_id e actor_id do creative buscado
  const creative = creativeData?.creative || {};
  const videoId = creative.video_id || creativeData?.adcreatives_videos_ids?.[0];
  const actorId = creative.actor_id;
  const shouldLoadVideo = activeTab === "video" && !!videoId && !!actorId && !loadingCreative;

  const { data: videoData, isLoading: loadingVideo, error: videoError } = useVideoSource({ video_id: videoId || "", actor_id: actorId || "" }, shouldLoadVideo);

  const { data: historyDataById, isLoading: loadingHistoryById } = useAdHistory(adId, dateStart || "", dateStop || "", shouldLoadHistoryById);
  const { data: historyDataByName, isLoading: loadingHistoryByName } = useAdNameHistory(adName, dateStart || "", dateStop || "", shouldLoadHistoryByName);
  const loadingHistory = loadingHistoryById || loadingHistoryByName;
  const historyData = groupByAdName ? historyDataByName : historyDataById;

  const formatCurrency = useFormatCurrency();
  const formatPct = (v: number | null | undefined) => {
    if (v == null || Number.isNaN(v)) return "—";
    return `${Number(v).toFixed(2)}%`;
  };

  function ValueWithDelta({ display, valueRaw, avgRaw, better }: { display: React.ReactNode; valueRaw?: number | null; avgRaw?: number | null; better: "higher" | "lower" }) {
    if (valueRaw == null || avgRaw == null || Number.isNaN(valueRaw as number) || Number.isNaN(avgRaw as number) || !isFinite(valueRaw as number) || !isFinite(avgRaw as number) || (avgRaw as number) === 0) {
      return <>{display}</>;
    }
    const diff = (valueRaw as number) / (avgRaw as number) - 1;
    const isBetter = better === "higher" ? diff > 0 : diff < 0;
    const color = isBetter ? "text-green-600" : "text-red-600";
    const sign = diff >= 0 ? "+" : "";
    return (
      <div className="flex items-center gap-2">
        <span>{display}</span>
        <span className={`text-xs ${color}`}>{`${sign}${(diff * 100).toFixed(1)}%`}</span>
      </div>
    );
  }

  // Mapa de conversões do ad (objeto original do servidor contendo todos os tipos)
  const conversionsMap: Record<string, number> = useMemo(() => {
    const c = ad?.conversions;
    if (!c || typeof c !== "object" || Array.isArray(c)) {
      return {};
    }
    // Retornar todos os valores do objeto original (podem ser 0)
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(c)) {
      const numValue = Number(value);
      if (key && !Number.isNaN(numValue) && isFinite(numValue)) {
        result[key] = numValue;
      }
    }
    return result;
  }, [ad]);

  // Obter todos os tipos de conversão disponíveis (priorizar availableConversionTypes, senão usar os do ad)
  const allConversionTypes = useMemo(() => {
    if (availableConversionTypes && availableConversionTypes.length > 0) {
      return availableConversionTypes;
    }
    // Fallback: extrair tipos únicos das conversões do ad e das variações
    const types = new Set<string>();
    // Do ad atual
    if (ad?.conversions && typeof ad.conversions === "object" && !Array.isArray(ad.conversions)) {
      Object.keys(ad.conversions).forEach((key) => {
        if (key && key.trim()) types.add(key);
      });
    }
    // Das variações (childrenData)
    if (childrenData && Array.isArray(childrenData)) {
      childrenData.forEach((child) => {
        if (child.conversions && typeof child.conversions === "object" && !Array.isArray(child.conversions)) {
          Object.keys(child.conversions).forEach((key) => {
            if (key && key.trim()) types.add(key);
          });
        }
      });
    }
    return Array.from(types).sort();
  }, [availableConversionTypes, ad?.conversions, childrenData]);

  const resultsForActionType = useMemo(() => {
    if (!actionType) return 0;
    return Number(conversionsMap[actionType] || 0);
  }, [conversionsMap, actionType]);

  // CPR: usar o valor já calculado do ranking se disponível, senão calcular
  const cpr = useMemo(() => {
    // Se o ad já tem CPR calculado (vem do ranking), usar esse valor
    if ("cpr" in ad && typeof (ad as any).cpr === "number" && (ad as any).cpr > 0) {
      return (ad as any).cpr;
    }
    // Caso contrário, calcular baseado no actionType
    if (!resultsForActionType) return 0;
    const spend = Number(ad?.spend || 0);
    return spend / resultsForActionType;
  }, [ad, resultsForActionType]);

  // Determinar se deve mostrar CPR (se há valor calculado ou se há results para o actionType)
  const hasCpr = useMemo(() => {
    return ("cpr" in ad && typeof (ad as any).cpr === "number" && (ad as any).cpr > 0) || resultsForActionType > 0;
  }, [ad, resultsForActionType]);

  const lpv = Number(ad?.lpv || 0);
  const pageConv = useMemo(() => {
    // Se o ad já tem page_conv calculado (vem do ranking), usar esse valor
    if ("page_conv" in ad && typeof (ad as any).page_conv === "number" && !Number.isNaN((ad as any).page_conv) && isFinite((ad as any).page_conv)) {
      return (ad as any).page_conv;
    }
    // Caso contrário, calcular baseado no actionType
    if (!lpv || !resultsForActionType) return 0;
    return resultsForActionType / lpv;
  }, [ad, lpv, resultsForActionType]);

  // cpm e website_ctr sempre vêm do backend
  const cpm = useMemo(() => {
    return typeof ad?.cpm === "number" && !Number.isNaN(ad.cpm) && isFinite(ad.cpm) ? ad.cpm : 0;
  }, [ad?.cpm]);

  const websiteCtr = useMemo(() => {
    return typeof (ad as any)?.website_ctr === "number" && !Number.isNaN((ad as any).website_ctr) && isFinite((ad as any).website_ctr)
      ? (ad as any).website_ctr
      : 0;
  }, [ad]);

  const series = ad?.series;

  // Retenção de vídeo (array 0..100 por segundo) - priorizar do ad (já vem do ranking agregado)
  const retentionSeries: number[] = useMemo(() => {
    // Priorizar do ad (já vem agregado do ranking, ponderado por plays)
    const fromAd = (ad as any)?.video_play_curve_actions as number[] | undefined;
    if (Array.isArray(fromAd) && fromAd.length > 0) {
      return fromAd.map((v) => Number(v || 0));
    }
    // Fallback: buscar via useAdDetails se não tiver no ad
    const fromDetails = (adDetails as any)?.video_play_curve_actions as number[] | undefined;
    if (Array.isArray(fromDetails) && fromDetails.length > 0) {
      return fromDetails.map((v) => Number(v || 0));
    }
    return [];
  }, [ad, adDetails]);

  // video_watched_p50 - priorizar do ad (já vem do ranking agregado)
  const videoWatchedP50 = useMemo(() => {
    // Priorizar do ad (já vem agregado do ranking, ponderado por plays)
    const fromAd = (ad as any)?.video_watched_p50 as number | undefined;
    if (fromAd != null && !Number.isNaN(fromAd)) {
      return Number(fromAd);
    }
    // Fallback: buscar via useAdDetails se não tiver no ad
    const fromDetails = (adDetails as any)?.video_watched_p50 as number | undefined;
    if (fromDetails != null && !Number.isNaN(fromDetails)) {
      return Number(fromDetails);
    }
    return undefined;
  }, [ad, adDetails]);

  const handleLoadChildren = () => {
    setActiveTab("variations");
    // Forçar refetch se ainda não há dados
    if (!childrenData && !loadingChildren) {
      loadChildren();
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-4">
        {(() => {
          const thumbnail = getAdThumbnail(ad);
          return thumbnail ? <img src={thumbnail} alt="thumb" className="w-20 h-20 rounded object-cover" /> : <div className="w-20 h-20 rounded bg-border" />;
        })()}
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold truncate">{ad?.ad_name || "—"}</h2>
          <div className="mt-1">{groupByAdName ? <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">Agrupado</span> : <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">Individual</span>}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border text-sm">
        <button className={`px-3 py-2 ${activeTab === "overview" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"}`} onClick={() => setActiveTab("overview")}>
          Visão geral
        </button>
        <button className={`px-3 py-2 ${activeTab === "history" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"}`} onClick={() => setActiveTab("history")}>
          Histórico
        </button>
        <button className={`px-3 py-2 ${activeTab === "conversions" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"}`} onClick={() => setActiveTab("conversions")}>
          Conversões
        </button>
        <button className={`px-3 py-2 ${activeTab === "series" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"}`} onClick={() => setActiveTab("series")}>
          Séries
        </button>
        {groupByAdName ? (
          <button className={`px-3 py-2 ${activeTab === "variations" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"}`} onClick={() => setActiveTab("variations")}>
            Variações
          </button>
        ) : null}
        <button className={`px-3 py-2 ${activeTab === "video" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"}`} onClick={() => setActiveTab("video")}>
          Vídeo
        </button>
      </div>

      {/* Content */}
      {activeTab === "overview" && (
        <div className="space-y-4">
          {retentionSeries && retentionSeries.length > 0 ? <RetentionChart videoPlayCurve={retentionSeries} videoWatchedP50={videoWatchedP50} averagesHook={averages?.hook ?? null} averagesScrollStop={averages?.scroll_stop ?? null} hookValue={ad?.hook != null ? Number(ad.hook) : null} /> : null}

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <MetricCard label="Hook" value={<ValueWithDelta display={formatPct(Number(ad?.hook * 100))} valueRaw={Number(ad?.hook ?? 0)} avgRaw={averages?.hook ?? null} better="higher" />} series={series?.hook} metric="hook" size="medium" layout="horizontal" formatPct={formatPct} />
            <MetricCard label="Spend" value={formatCurrency(Number(ad?.spend || 0))} series={series?.spend} metric="spend" size="medium" layout="horizontal" formatCurrency={formatCurrency} />
            <MetricCard label="CPR" value={<ValueWithDelta display={hasCpr ? formatCurrency(cpr) : "—"} valueRaw={hasCpr ? cpr : null} avgRaw={averages?.cpr ?? null} better="lower" />} series={(series as any)?.cpr} metric="cpr" size="medium" layout="horizontal" formatCurrency={formatCurrency} />
            <MetricCard label="CTR" value={<ValueWithDelta display={formatPct(Number(ad?.ctr * 100))} valueRaw={Number(ad?.ctr ?? 0)} avgRaw={averages?.ctr ?? null} better="higher" />} series={series?.ctr} metric="ctr" size="medium" layout="horizontal" formatPct={formatPct} />
            <MetricCard label="Website CTR" value={<ValueWithDelta display={formatPct(Number(websiteCtr * 100))} valueRaw={websiteCtr} avgRaw={averages?.website_ctr ?? null} better="higher" />} series={(series as any)?.website_ctr} metric="ctr" size="medium" layout="horizontal" formatPct={formatPct} />
            <MetricCard label="CPM" value={<ValueWithDelta display={formatCurrency(cpm)} valueRaw={cpm} avgRaw={averages?.cpm ?? null} better="lower" />} series={(series as any)?.cpm} metric="cpm" size="medium" layout="horizontal" formatCurrency={formatCurrency} />
            <MetricCard label="Connect Rate" value={<ValueWithDelta display={formatPct(Number(ad?.connect_rate * 100))} valueRaw={Number(ad?.connect_rate ?? 0)} avgRaw={averages?.connect_rate ?? null} better="higher" />} series={series?.connect_rate} metric="connect_rate" size="medium" layout="horizontal" formatPct={formatPct} />
            <MetricCard label="Page Conv" value={<ValueWithDelta display={formatPct(Number(pageConv * 100))} valueRaw={Number(pageConv ?? 0)} avgRaw={averages?.page_conv ?? null} better="higher" />} series={(series as any)?.page_conv} metric="page_conv" size="medium" layout="horizontal" formatPct={formatPct} />
            <MetricCard label="Impressions" value={Number(ad?.impressions || 0).toLocaleString("pt-BR")} series={undefined} metric="cpm" size="medium" layout="horizontal" formatCurrency={formatCurrency} />
            <MetricCard label="Clicks" value={Number(ad?.clicks || 0).toLocaleString("pt-BR")} series={undefined} metric="cpm" size="medium" layout="horizontal" formatCurrency={formatCurrency} />
          </div>
        </div>
      )}

      {activeTab === "conversions" && (
        <div className="space-y-2">
          {allConversionTypes.length === 0 ? (
            <div className="text-sm text-muted-foreground">Sem dados de conversão.</div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-2">Tipo</th>
                  <th className="py-2 text-right">Conversões</th>
                  <th className="py-2 text-right">CPR</th>
                </tr>
              </thead>
              <tbody>
                {allConversionTypes.map((type) => {
                  const v = Number(conversionsMap[type] || 0);
                  const spend = Number(ad?.spend || 0);
                  const cprType = v > 0 && spend > 0 && !Number.isNaN(spend) ? spend / v : null;
                  const isSelected = actionType && type === actionType;
                  return (
                    <tr key={type} className={isSelected ? "bg-muted" : ""}>
                      <td className="py-2 pr-2">{type}</td>
                      <td className="py-2 pr-2 text-right">{v.toLocaleString("pt-BR")}</td>
                      <td className="py-2 pr-2 text-right">{cprType && cprType > 0 && !Number.isNaN(cprType) && isFinite(cprType) ? formatCurrency(cprType) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === "variations" && groupByAdName && (
        <div className="space-y-2">
          {loadingChildren ? (
            <div className="text-sm text-muted-foreground">Carregando variações...</div>
          ) : !childrenData || childrenData.length === 0 ? (
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">{childrenData?.length === 0 ? "Sem variações no período." : "Clique para carregar variações desse anúncio agrupado."}</div>
              {!childrenData && (
                <Button size="sm" onClick={handleLoadChildren} disabled={loadingChildren}>
                  {loadingChildren ? "Carregando..." : "Carregar"}
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-border">
                    <th className="p-2 text-left">Ad ID</th>
                    <th className="p-2 text-right">Hook</th>
                    <th className="p-2 text-right">CPR</th>
                    <th className="p-2 text-right">Spend</th>
                    <th className="p-2 text-right">CTR</th>
                    <th className="p-2 text-right">CPM</th>
                    <th className="p-2 text-right">Connect</th>
                    <th className="p-2 text-right">Page</th>
                  </tr>
                </thead>
                <tbody>
                  {childrenData.map((child: RankingsChildrenItem) => {
                    const lpvC = Number(child.lpv || 0);
                    const spendC = Number(child.spend || 0);
                    const impressionsC = Number(child.impressions || 0);
                    const conversionsC = child.conversions || {};
                    // Calcular resultsC: usar actionType se disponível, senão somar todas as conversões
                    let resultsC = 0;
                    if (actionType && typeof actionType === "string" && actionType.trim()) {
                      resultsC = Number(conversionsC[actionType] || 0);
                    } else {
                      // Se não há actionType, somar todas as conversões disponíveis
                      resultsC = Object.values(conversionsC).reduce((sum, val) => {
                        const numVal = Number(val || 0);
                        return sum + (Number.isNaN(numVal) ? 0 : numVal);
                      }, 0);
                    }
                    const pageConvC = lpvC > 0 && resultsC > 0 ? resultsC / lpvC : 0;
                    const cprC = resultsC > 0 && spendC > 0 ? spendC / resultsC : 0;
                    // cpm sempre vem do backend
                    const cpmC = typeof child.cpm === "number" ? child.cpm : 0;
                    return (
                      <tr key={child.ad_id} className="hover:bg-muted">
                        <td className="p-2 text-left">
                          <div className="flex items-center gap-2">
                            {(() => {
                              const thumb = getAdThumbnail(child);
                              return thumb ? <img src={thumb} alt="thumb" className="w-8 h-8 object-cover rounded" /> : <div className="w-8 h-8 bg-border rounded" />;
                            })()}
                            <div className="truncate">{child.ad_id}</div>
                          </div>
                        </td>
                        <td className="p-2 text-right">{formatPct(Number(child.hook * 100))}</td>
                        <td className="p-2 text-right">{cprC > 0 ? formatCurrency(cprC) : "—"}</td>
                        <td className="p-2 text-right">{formatCurrency(spendC)}</td>
                        <td className="p-2 text-right">{formatPct(Number(child.ctr * 100))}</td>
                        <td className="p-2 text-right">{formatCurrency(cpmC)}</td>
                        <td className="p-2 text-right">{formatPct(Number(child.connect_rate * 100))}</td>
                        <td className="p-2 text-right">{pageConvC > 0 ? formatPct(Number(pageConvC * 100)) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "series" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <MetricCard label="Hook" value={series?.hook ? <ValueWithDelta display={formatPct(Number(ad?.hook * 100))} valueRaw={Number(ad?.hook ?? 0)} avgRaw={averages?.hook ?? null} better="higher" /> : "Sem série"} series={series?.hook} metric="hook" size="large" formatPct={formatPct} />
          <MetricCard label="Spend" value={series?.spend ? formatCurrency(Number(ad?.spend || 0)) : "Sem série"} series={series?.spend} metric="spend" size="large" formatCurrency={formatCurrency} />
          <MetricCard label="CTR" value={series?.ctr ? <ValueWithDelta display={formatPct(Number(ad?.ctr * 100))} valueRaw={Number(ad?.ctr ?? 0)} avgRaw={averages?.ctr ?? null} better="higher" /> : "Sem série"} series={series?.ctr} metric="ctr" size="large" formatPct={formatPct} />
          <MetricCard label="Connect Rate" value={series?.connect_rate ? <ValueWithDelta display={formatPct(Number(ad?.connect_rate * 100))} valueRaw={Number(ad?.connect_rate ?? 0)} avgRaw={averages?.connect_rate ?? null} better="higher" /> : "Sem série"} series={series?.connect_rate} metric="connect_rate" size="large" formatPct={formatPct} />
          <MetricCard label="CPR" value={(series as any)?.cpr && hasCpr ? <ValueWithDelta display={formatCurrency(cpr)} valueRaw={cpr} avgRaw={averages?.cpr ?? null} better="lower" /> : "Sem série"} series={(series as any)?.cpr} metric="cpr" size="large" formatCurrency={formatCurrency} />
          <MetricCard label="CPM" value={(series as any)?.cpm ? <ValueWithDelta display={formatCurrency(cpm)} valueRaw={cpm} avgRaw={averages?.cpm ?? null} better="lower" /> : "Sem série"} series={(series as any)?.cpm} metric="cpm" size="large" formatCurrency={formatCurrency} />
        </div>
      )}

      {activeTab === "video" && (
        <div className="space-y-4">
          {loadingCreative ? (
            <div className="text-sm text-muted-foreground p-6 text-center">Carregando informações do vídeo...</div>
          ) : !videoId || !actorId ? (
            <div className="text-sm text-muted-foreground p-6 text-center">Vídeo não disponível para este anúncio.</div>
          ) : (
            <div className="w-full bg-black rounded-lg overflow-hidden flex items-center justify-center">
              {loadingVideo && <div className="text-sm text-muted-foreground p-6">Carregando vídeo...</div>}
              {videoError && <div className="text-sm text-red-500 p-6">Falha ao carregar o vídeo. Tente novamente mais tarde.</div>}
              {!loadingVideo && !videoError && (videoData as any)?.source_url && <video src={(videoData as any).source_url} controls className="w-full h-auto max-h-[70vh] object-contain" playsInline />}
              {!loadingVideo && !videoError && !(videoData as any)?.source_url && <div className="text-sm text-muted-foreground p-6">URL do vídeo não disponível.</div>}
            </div>
          )}
        </div>
      )}

      {activeTab === "history" && (
        <div className="flex flex-col h-full min-h-0">
          <div className="text-lg font-semibold mb-4 flex-shrink-0">Evolução Histórica</div>

          {loadingHistory ? (
            <div className="flex-1 min-h-0 flex gap-12">
              {/* Skeleton do seletor de métricas */}
              <div className="flex-shrink-0 w-48 flex flex-col gap-4">
                <Skeleton className="h-4 w-20" />
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-8 w-full rounded-md" />
                  <Skeleton className="h-8 w-full rounded-md" />
                  <Skeleton className="h-8 w-full rounded-md" />
                  <Skeleton className="h-8 w-full rounded-md" />
                  <Skeleton className="h-8 w-full rounded-md" />
                  <Skeleton className="h-8 w-full rounded-md" />
                </div>
              </div>
              {/* Skeleton do gráfico */}
              <div className="flex-1 min-w-0 min-h-0">
                <Skeleton className="h-full w-full rounded-md" />
              </div>
            </div>
          ) : !historyData?.data || historyData.data.length === 0 ? (
            <div className="text-sm text-muted-foreground p-6 text-center">Sem dados históricos disponíveis para o período selecionado.</div>
          ) : (
            <div className="flex-1 min-h-0">
              <MetricHistoryChart data={historyData.data} dateStart={dateStart || ""} dateStop={dateStop || ""} actionType={actionType} availableMetrics={AVAILABLE_METRICS} selectedMetrics={selectedMetrics} onMetricsChange={setSelectedMetrics} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useFormatCurrency } from "@/lib/utils/currency";
import { MetricCard } from "@/components/common/MetricCard";
import { RetentionChart } from "@/components/charts/RetentionChart";
import { RetentionChartOverlay } from "@/components/charts/RetentionChartOverlay";
import { SparklineBars } from "@/components/common/SparklineBars";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdVariations, useAdDetails, useAdCreative, useVideoSource, useAdHistory, useAdNameHistory } from "@/lib/api/hooks";
import { RankingsItem, RankingsChildrenItem } from "@/lib/api/schemas";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";
import { MetricHistoryChart, AVAILABLE_METRICS } from "@/components/charts/MetricHistoryChart";
import { DateRangeFilter, DateRangeValue } from "@/components/common/DateRangeFilter";

interface AdDetailsDialogProps {
  ad: RankingsItem;
  groupByAdName: boolean;
  dateStart?: string;
  dateStop?: string;
  actionType?: string;
  availableConversionTypes?: string[]; // Tipos de conversão disponíveis (mesmos do seletor)
  initialTab?: "overview" | "conversions" | "variations" | "series" | "video" | "history"; // Aba inicial
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

export function AdDetailsDialog({ ad, groupByAdName, dateStart, dateStop, actionType, availableConversionTypes = [], initialTab = "overview", averages }: AdDetailsDialogProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "conversions" | "variations" | "series" | "video" | "history">(initialTab);
  const [shouldAutoplay, setShouldAutoplay] = useState(false);
  const [initialVideoTime, setInitialVideoTime] = useState<number | null>(null);

  // Atualizar aba quando initialTab mudar (quando o modal é reaberto com outro anúncio)
  useEffect(() => {
    setActiveTab(initialTab);
    setShouldAutoplay(initialTab === "video");
    setInitialVideoTime(null); // Resetar tempo inicial quando mudar de anúncio
  }, [initialTab, ad?.ad_id]); // Resetar quando o anúncio mudar
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(["spend"]);
  // Date range específico para o histórico (inicializa com o date range principal ou vazio para mostrar todos)
  const [historyDateRange, setHistoryDateRange] = useState<DateRangeValue>(() => ({
    start: dateStart,
    end: dateStop,
  }));

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
  const historyDataRaw = groupByAdName ? historyDataByName : historyDataById;

  // Filtrar dados históricos baseado no date range do histórico
  const historyData = useMemo(() => {
    if (!historyDataRaw?.data || historyDataRaw.data.length === 0) {
      return historyDataRaw;
    }

    // Se não há filtro de data definido, retornar todos os dados
    if (!historyDateRange.start && !historyDateRange.end) {
      return historyDataRaw;
    }

    const filtered = historyDataRaw.data.filter((item: any) => {
      const itemDate = item.date;
      if (!itemDate) return false;

      // Normalizar datas para formato YYYY-MM-DD para comparação segura
      const normalizeDate = (dateStr: string) => {
        // Se já está no formato YYYY-MM-DD, retornar direto
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          return dateStr;
        }
        // Caso contrário, tentar extrair a parte da data
        const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
        return match ? match[1] : dateStr;
      };

      const itemDateNormalized = normalizeDate(itemDate);
      const startDateNormalized = historyDateRange.start ? normalizeDate(historyDateRange.start) : null;
      const endDateNormalized = historyDateRange.end ? normalizeDate(historyDateRange.end) : null;

      // Comparação de strings (YYYY-MM-DD permite comparação lexicográfica)
      if (startDateNormalized && itemDateNormalized < startDateNormalized) {
        return false;
      }

      if (endDateNormalized && itemDateNormalized > endDateNormalized) {
        return false;
      }

      return true;
    });

    return {
      ...historyDataRaw,
      data: filtered,
    };
  }, [historyDataRaw, historyDateRange]);

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
    return typeof (ad as any)?.website_ctr === "number" && !Number.isNaN((ad as any).website_ctr) && isFinite((ad as any).website_ctr) ? (ad as any).website_ctr : 0;
  }, [ad]);

  // Calcular séries dinâmicas (cpr e page_conv) baseadas no actionType
  const series = useMemo(() => {
    const baseSeries = ad?.series;
    if (!baseSeries) return baseSeries;

    // Se não há actionType ou não há conversions, retornar série base
    if (!actionType || !baseSeries.conversions) {
      return baseSeries;
    }

    // Calcular results por dia para o action_type selecionado
    const resultsSeries = baseSeries.conversions.map((dayConversions: Record<string, number>) => {
      return dayConversions[actionType] || 0;
    });

    // Calcular cpr_series e page_conv_series
    const spendSeries = baseSeries.spend || [];
    const lpvSeries = baseSeries.lpv || [];

    const page_conv_series = resultsSeries.map((resultsDay: number, idx: number) => {
      const lpvDay = lpvSeries[idx] || 0;
      return lpvDay > 0 ? resultsDay / lpvDay : null;
    });

    const cpr_series = resultsSeries.map((resultsDay: number, idx: number) => {
      const spendDay = spendSeries[idx] || 0;
      return resultsDay > 0 ? spendDay / resultsDay : null;
    });

    return {
      ...baseSeries,
      cpr: cpr_series,
      page_conv: page_conv_series,
    } as any;
  }, [ad?.series, actionType]);

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

  // Calcular scroll_stop a partir da curva de retenção (índice 1)
  const scrollStop = useMemo(() => {
    if (retentionSeries && retentionSeries.length > 1) {
      // A curva vem em porcentagem (0-100), então dividimos por 100 para converter para decimal (0-1)
      return retentionSeries[1] / 100;
    }
    return 0;
  }, [retentionSeries]);

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

  // Handler para quando um ponto do gráfico de retenção é clicado
  const handleRetentionPointClick = (second: number) => {
    setInitialVideoTime(second);
    setActiveTab("video");
    setShouldAutoplay(false); // Não autoplay quando vem do gráfico
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
          {retentionSeries && retentionSeries.length > 0 ? <RetentionChart videoPlayCurve={retentionSeries} videoWatchedP50={videoWatchedP50} averagesHook={averages?.hook ?? null} averagesScrollStop={averages?.scroll_stop ?? null} hookValue={ad?.hook != null ? Number(ad.hook) : null} onPointClick={handleRetentionPointClick} /> : null}

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
            <div className="flex flex-col md:flex-row gap-4">
              {/* Player de vídeo */}
              <div className="w-full bg-black rounded-lg flex items-center justify-center md:max-w-[20rem] max-w-full ml-8" style={{ aspectRatio: "9/16" }}>
                {loadingVideo && <div className="text-sm text-muted-foreground p-6">Carregando vídeo...</div>}
                {videoError && <div className="text-sm text-red-500 p-6">Falha ao carregar o vídeo. Tente novamente mais tarde.</div>}
                {!loadingVideo && !videoError && (videoData as any)?.source_url && <VideoPlayer src={(videoData as any).source_url} autoplay={shouldAutoplay} initialTime={initialVideoTime} onTimeSet={() => setInitialVideoTime(null)} retentionCurve={retentionSeries} />}
                {!loadingVideo && !videoError && !(videoData as any)?.source_url && <div className="text-sm text-muted-foreground p-6">URL do vídeo não disponível.</div>}
              </div>

              {/* Cards de métricas */}
              <div className="flex-1 flex flex-row gap-4">
                {/* Primeira coluna vertical */}
                <div className="flex flex-col gap-4 flex-1">
                  <MetricCard label="Scroll Stop" value={<ValueWithDelta display={formatPct(scrollStop * 100)} valueRaw={scrollStop} avgRaw={averages?.scroll_stop ?? null} better="higher" />} series={undefined} metric="hook" size="medium" layout="horizontal" formatPct={formatPct} />
                  <MetricCard label="Hook" value={<ValueWithDelta display={formatPct(Number(ad?.hook * 100))} valueRaw={Number(ad?.hook ?? 0)} avgRaw={averages?.hook ?? null} better="higher" />} series={series?.hook} metric="hook" size="medium" layout="horizontal" formatPct={formatPct} />
                  <MetricCard label="Website CTR" value={<ValueWithDelta display={formatPct(Number(websiteCtr * 100))} valueRaw={websiteCtr} avgRaw={averages?.website_ctr ?? null} better="higher" />} series={(series as any)?.website_ctr} metric="ctr" size="medium" layout="horizontal" formatPct={formatPct} />
                  <MetricCard label="Connect Rate" value={<ValueWithDelta display={formatPct(Number(ad?.connect_rate * 100))} valueRaw={Number(ad?.connect_rate ?? 0)} avgRaw={averages?.connect_rate ?? null} better="higher" />} series={series?.connect_rate} metric="connect_rate" size="medium" layout="horizontal" formatPct={formatPct} />
                  <MetricCard label="Page Conv" value={<ValueWithDelta display={formatPct(Number(pageConv * 100))} valueRaw={Number(pageConv ?? 0)} avgRaw={averages?.page_conv ?? null} better="higher" />} series={(series as any)?.page_conv} metric="page_conv" size="medium" layout="horizontal" formatPct={formatPct} />
                </div>
                {/* Segunda coluna vertical */}
                <div className="flex flex-col gap-4 flex-1">
                  <MetricCard label="CPR" value={<ValueWithDelta display={hasCpr ? formatCurrency(cpr) : "—"} valueRaw={hasCpr ? cpr : null} avgRaw={averages?.cpr ?? null} better="lower" />} series={(series as any)?.cpr} metric="cpr" size="medium" layout="horizontal" formatCurrency={formatCurrency} />
                  <MetricCard label="Spend" value={formatCurrency(Number(ad?.spend || 0))} series={series?.spend} metric="spend" size="medium" layout="horizontal" formatCurrency={formatCurrency} />
                  <MetricCard label="CPM" value={<ValueWithDelta display={formatCurrency(cpm)} valueRaw={cpm} avgRaw={averages?.cpm ?? null} better="lower" />} series={(series as any)?.cpm} metric="cpm" size="medium" layout="horizontal" formatCurrency={formatCurrency} />
                  <MetricCard label="CTR" value={<ValueWithDelta display={formatPct(Number(ad?.ctr * 100))} valueRaw={Number(ad?.ctr ?? 0)} avgRaw={averages?.ctr ?? null} better="higher" />} series={series?.ctr} metric="ctr" size="medium" layout="horizontal" formatPct={formatPct} />
                  <MetricCard label="Impressions" value={Number(ad?.impressions || 0).toLocaleString("pt-BR")} series={undefined} metric="cpm" size="medium" layout="horizontal" formatCurrency={formatCurrency} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "history" && (
        <div className="flex flex-col h-full min-h-0">
          <div className="flex items-center justify-between mb-4 flex-shrink-0">
            <div className="text-lg font-semibold">Evolução Histórica</div>
            <DateRangeFilter label="Filtrar período" value={historyDateRange} onChange={setHistoryDateRange} className="w-auto" showLabel={false} />
          </div>

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
              <MetricHistoryChart data={historyData.data} dateStart={historyDateRange.start || dateStart || ""} dateStop={historyDateRange.end || dateStop || ""} actionType={actionType} availableMetrics={AVAILABLE_METRICS} selectedMetrics={selectedMetrics} onMetricsChange={setSelectedMetrics} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Componente para o player de vídeo com suporte a autoplay, tempo inicial e overlay
function VideoPlayer({ src, autoplay, initialTime, onTimeSet, retentionCurve }: { src: string; autoplay: boolean; initialTime?: number | null; onTimeSet?: () => void; retentionCurve?: number[] }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (autoplay && videoRef.current) {
      // Tentar reproduzir quando o vídeo estiver pronto
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch((error) => {
          // Autoplay pode ser bloqueado pelo navegador
          console.log("Autoplay bloqueado:", error);
        });
      }
    }
  }, [autoplay, src]);

  // Definir tempo inicial quando o vídeo estiver pronto
  useEffect(() => {
    if (initialTime != null && videoRef.current) {
      const video = videoRef.current;

      const handleLoadedMetadata = () => {
        if (video.duration >= initialTime) {
          video.currentTime = initialTime;
          if (onTimeSet) {
            onTimeSet();
          }
        }
      };

      // Se os metadados já foram carregados, definir o tempo imediatamente
      if (video.readyState >= 1) {
        handleLoadedMetadata();
      } else {
        video.addEventListener("loadedmetadata", handleLoadedMetadata);
        return () => {
          video.removeEventListener("loadedmetadata", handleLoadedMetadata);
        };
      }
    }
  }, [initialTime, src, onTimeSet]);

  // Atualizar tempo e duração do vídeo
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
    };

    const handleDurationChange = () => {
      setDuration(video.duration);
    };

    const handlePlay = () => {
      setIsPlaying(true);
    };

    const handlePause = () => {
      setIsPlaying(false);
    };

    const handleEnded = () => {
      setIsPlaying(false);
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("durationchange", handleDurationChange);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);

    // Inicializar valores se já estiverem disponíveis
    if (video.readyState >= 1) {
      setDuration(video.duration);
      setCurrentTime(video.currentTime);
    }

    // Verificar se está reproduzindo inicialmente
    setIsPlaying(!video.paused && !video.ended);

    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("durationchange", handleDurationChange);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("ended", handleEnded);
    };
  }, [src]);

  // Handler para quando o usuário clica no overlay
  const handleTimeSeek = (second: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = second;
      setCurrentTime(second);
    }
  };

  return (
    <div className="relative w-full h-full flex justify-center overflow-visible">
      {/* Container com proporção 9:16 (vertical) */}
      <div className="relative w-full h-full overflow-visible">
        <video ref={videoRef} src={src} controls className="absolute inset-0 w-full h-full object-contain" playsInline autoPlay={autoplay} />
        {retentionCurve && retentionCurve.length > 0 && <RetentionChartOverlay videoPlayCurve={retentionCurve} currentTime={currentTime} duration={duration} isPlaying={isPlaying} onTimeSeek={handleTimeSeek} />}
      </div>
    </div>
  );
}

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RankingsItem, RankingsResponse } from "@/lib/api/schemas";
import { computeOpportunityScores, OpportunityRow } from "@/lib/utils/opportunity";
import { useValidationCriteria } from "@/lib/hooks/useValidationCriteria";
import { evaluateValidationCriteria, AdMetricsData } from "@/lib/utils/validateAdCriteria";
import { useFormatCurrency } from "@/lib/utils/currency";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { IconInfoCircle } from "@tabler/icons-react";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";

type OpportunityWidgetProps = {
  ads: RankingsItem[];
  averages?: RankingsResponse["averages"];
  actionType: string;
  limit?: number;
  title?: string;
};

function formatPct(v: number): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

function formatPct1(v: number): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function mapRankingToMetrics(ad: RankingsItem, actionType: string): AdMetricsData {
  const impressions = Number((ad as any).impressions || 0);
  const spend = Number((ad as any).spend || 0);
  const cpm = impressions > 0 ? (spend * 1000) / impressions : Number((ad as any).cpm || 0);
  const website_ctr = Number((ad as any).website_ctr || 0);
  const connect_rate = Number((ad as any).connect_rate || 0);
  const lpv = Number((ad as any).lpv || 0);
  const results = actionType ? Number((ad as any).conversions?.[actionType] || 0) : 0;
  const page_conv = lpv > 0 ? results / lpv : 0;
  return {
    ad_name: (ad as any).ad_name,
    ad_id: (ad as any).ad_id,
    account_id: (ad as any).account_id,
    impressions,
    spend,
    cpm,
    website_ctr,
    connect_rate,
    // campos para possíveis critérios
    inline_link_clicks: Number((ad as any).inline_link_clicks || 0),
    clicks: Number((ad as any).clicks || 0),
    plays: Number((ad as any).plays || 0),
    hook: Number((ad as any).hook || 0),
    ctr: Number((ad as any).ctr || 0),
    page_conv,
  };
}

export function OpportunityWidget({
  ads,
  averages,
  actionType,
  limit = 10,
  title = "Oportunidades",
}: OpportunityWidgetProps) {
  const { criteria, isLoading: isLoadingCriteria } = useValidationCriteria();
  const formatCurrency = useFormatCurrency();

  const eligibleAds = useMemo(() => {
    if (!Array.isArray(ads) || ads.length === 0) return [];
    if (isLoadingCriteria) return [];
    if (!criteria || criteria.length === 0) {
      // Sem critérios → todos elegíveis
      return ads;
    }
    return ads.filter((ad) => {
      const metrics = mapRankingToMetrics(ad, actionType);
      return evaluateValidationCriteria(criteria, metrics, "AND");
    });
  }, [ads, criteria, isLoadingCriteria, actionType]);

  const rows: OpportunityRow[] = useMemo(() => {
    if (eligibleAds.length === 0) return [];
    const spendTotal = eligibleAds.reduce((s, a) => s + Number((a as any).spend || 0), 0);
    return computeOpportunityScores({
      ads: eligibleAds,
      averages,
      actionType,
      spendTotal,
      limit: Math.max(limit, 1),
    });
  }, [eligibleAds, averages, actionType, limit]);

  // Valores médios para exibir nos tooltips e nas células
  const avgHook = averages?.hook || 0;
  const avgWebsiteCtr = averages?.website_ctr || 0;
  const avgConnectRate = averages?.connect_rate || 0;
  const avgPageConv = averages?.per_action_type?.[actionType]?.page_conv || 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">Sem oportunidades com os filtros/validações atuais.</div>
        ) : (
          <div className="w-full">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-sm border-separate border-spacing-y-4">
                <thead>
                  <tr className="sticky top-0 z-10 text-text/80">
                    <th className="text-base font-normal py-4 text-left" style={{ width: 140 }}>
                      AD
                    </th>
                    <th className="text-base font-normal py-4 text-center" style={{ width: 140 }}>
                      CPM
                    </th>
                    <th className="text-base font-normal py-4 text-center" style={{ width: 140 }}>
                      Hook
                    </th>
                    <th className="text-base font-normal py-4 text-center" style={{ width: 140 }}>
                      Website CTR
                    </th>
                    <th className="text-base font-normal py-4 text-center" style={{ width: 160 }}>
                      Connect Rate
                    </th>
                    <th className="text-base font-normal py-4 text-center" style={{ width: 140 }}>
                      Page Conv
                    </th>
                    <th className="text-base font-normal py-4 text-center" style={{ width: 140 }}>
                      CPR
                    </th>
                    <th className="text-base font-normal py-4 text-center" style={{ width: 140 }}>
                      Melhoria %
                    </th>
                    <th className="text-base font-normal py-4 text-center" style={{ width: 140 }}>
                      Impacto relativo
                    </th>
                    <th className="text-base font-normal py-4 text-center" style={{ width: 140 }}>
                      Economia
                    </th>
                    <th className="text-base font-normal py-4 text-center" style={{ width: 140 }}>
                      Convs inc.
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => {
                    const belowAvgMetrics: string[] = [];
                    if (r.below_avg_flags.website_ctr) belowAvgMetrics.push(`Website CTR: ${formatPct(r.website_ctr)} (média: ${formatPct(avgWebsiteCtr)})`);
                    if (r.below_avg_flags.connect_rate) belowAvgMetrics.push(`Connect Rate: ${formatPct(r.connect_rate)} (média: ${formatPct(avgConnectRate)})`);
                    if (r.below_avg_flags.page_conv) belowAvgMetrics.push(`Page Conv: ${formatPct(r.page_conv)} (média: ${formatPct(avgPageConv)})`);

                    const thumbnail = r.thumbnail ? getAdThumbnail({ thumbnail: r.thumbnail } as any) : null;

                    return (
                      <tr key={`${r.ad_id || r.ad_name || idx}`} className="bg-background hover:bg-input-30 cursor-pointer">
                        <td className="p-4 text-left border-y border-border rounded-l-md border-l" style={{ width: 140 }}>
                          <div className="flex items-center gap-3">
                            {thumbnail ? (
                              <img src={thumbnail} alt="thumb" className="w-14 h-14 object-cover rounded" />
                            ) : (
                              <div className="w-14 h-14 bg-border rounded" />
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-1">
                                <span className="truncate">{r.ad_name || r.ad_id || "—"}</span>
                                {belowAvgMetrics.length > 0 && (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <IconInfoCircle className="w-4 h-4 text-muted-foreground hover:text-foreground flex-shrink-0" />
                                      </TooltipTrigger>
                                      <TooltipContent className="max-w-xs">
                                        <div className="space-y-1">
                                          <div className="font-semibold text-sm mb-2">Métricas abaixo da média:</div>
                                          {belowAvgMetrics.map((metric, i) => (
                                            <div key={i} className="text-xs">{metric}</div>
                                          ))}
                                        </div>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">{formatCurrency(r.spend)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-4 text-center border-y border-border" style={{ width: 140 }}>
                          <span className="text-base font-medium leading-none">{formatCurrency(r.cpm)}</span>
                        </td>
                        <td className="p-4 text-center border-y border-border" style={{ width: 140 }}>
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-base font-medium leading-none">{formatPct1(r.hook)}</span>
                            <span className="text-xs text-muted-foreground">média: {formatPct1(avgHook)}</span>
                          </div>
                        </td>
                        <td className="p-4 text-center border-y border-border" style={{ width: 140 }}>
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-base font-medium leading-none">{formatPct(r.website_ctr)}</span>
                            <span className="text-xs text-muted-foreground">média: {formatPct(avgWebsiteCtr)}</span>
                          </div>
                        </td>
                        <td className="p-4 text-center border-y border-border" style={{ width: 160 }}>
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-base font-medium leading-none">{formatPct1(r.connect_rate)}</span>
                            <span className="text-xs text-muted-foreground">média: {formatPct1(avgConnectRate)}</span>
                          </div>
                        </td>
                        <td className="p-4 text-center border-y border-border" style={{ width: 140 }}>
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-base font-medium leading-none">{formatPct1(r.page_conv)}</span>
                            <span className="text-xs text-muted-foreground">média: {formatPct1(avgPageConv)}</span>
                          </div>
                        </td>
                        <td className="p-4 text-center border-y border-border" style={{ width: 140 }}>
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-base font-medium leading-none">{formatCurrency(r.cpr_actual)}</span>
                            <span className="text-xs text-muted-foreground">potencial: {formatCurrency(r.cpr_potential)}</span>
                          </div>
                        </td>
                        <td className="p-4 text-center border-y border-border" style={{ width: 140 }}>
                          <span className="text-base font-medium leading-none">{formatPct1(r.improvement_pct)}</span>
                        </td>
                        <td className="p-4 text-center border-y border-border" style={{ width: 140 }}>
                          <span className="text-base font-medium leading-none">{formatPct(r.impact_relative)}</span>
                        </td>
                        <td className="p-4 text-center border-y border-border" style={{ width: 140 }}>
                          <span className="text-base font-medium leading-none">{formatCurrency(r.impact_abs_savings)}</span>
                        </td>
                        <td className="p-4 text-center border-y border-border rounded-r-md border-r" style={{ width: 140 }}>
                          <span className="text-base font-medium leading-none">{(r.impact_abs_conversions).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}



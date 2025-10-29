"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AggregatedData, formatCurrency, formatPercentage, formatNumber } from "@/lib/utils/aggregation";
import { Target, DollarSign, Eye, MousePointer, Users, TrendingUp, Play, PlayCircle, ExternalLink, User } from "lucide-react";

interface MetricsCardsProps {
  data: AggregatedData;
  resultsValue: number; // Valor total das conversões selecionadas
  costValue: number; // Custo total por conversão (para CPL)
}

export function MetricsCards({ data, resultsValue, costValue }: MetricsCardsProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Hook Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Target className="w-5 h-5 text-brand" />
            🪝 Hook
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center">
            <div className="text-3xl font-bold text-brand">{formatPercentage(data.retention_at_3, 0)}</div>
            <div className="text-sm text-muted">Retention at 3s</div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <div className="text-xl font-semibold">{formatNumber(data.video_total_plays)}</div>
              <div className="text-xs text-muted">Plays</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-semibold">{formatNumber(data.video_total_thruplays)}</div>
              <div className="text-xs text-muted">Thruplays</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Budget Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <DollarSign className="w-5 h-5 text-yellow-500" />
            💵 Budget
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <div className="text-lg font-semibold text-yellow-500">{formatCurrency(data.spend)}</div>
              <div className="text-xs text-muted">Spend</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-yellow-500">{formatCurrency(data.cpm)}</div>
              <div className="text-xs text-muted">CPM</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <div className="text-lg font-semibold">{formatCurrency(costValue)}</div>
              <div className="text-xs text-muted">CPL</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold">{formatNumber(resultsValue)}</div>
              <div className="text-xs text-muted">Results</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Audience Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="w-5 h-5 text-blue-500" />
            👤 Audience
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-lg font-semibold">{formatNumber(data.impressions)}</div>
              <div className="text-xs text-muted">Impressions</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold">{formatNumber(data.reach)}</div>
              <div className="text-xs text-muted">Reach</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold">{data.frequency.toFixed(2)}</div>
              <div className="text-xs text-muted">Frequency</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Clicks Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <MousePointer className="w-5 h-5 text-green-500" />
            👆 Clicks
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <div className="text-lg font-semibold text-green-500">{formatPercentage(data.ctr, 2)}</div>
              <div className="text-xs text-muted">CTR</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold">{formatNumber(data.clicks)}</div>
              <div className="text-xs text-muted">Clicks</div>
            </div>
          </div>

          {/* Website CTR */}
          <Card className="bg-surface2">
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className="text-center flex-1">
                  <div className="text-xl font-bold text-green-500">{formatPercentage(data.website_ctr, 2)}</div>
                  <div className="text-xs text-muted">Website CTR</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-muted">{formatNumber(data.inline_link_clicks)} clicks</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Profile CTR */}
          <Card className="bg-surface2">
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className="text-center flex-1">
                  <div className="text-xl font-bold text-green-500">{formatPercentage(data.profile_ctr, 2)}</div>
                  <div className="text-xs text-muted">Profile CTR</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-muted">{formatNumber(data.clicks - data.inline_link_clicks)} clicks</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </CardContent>
      </Card>

      {/* Landing Page Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ExternalLink className="w-5 h-5 text-purple-500" />
            🎯 Landing Page
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Connect Rate */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Connect Rate</span>
              <span className="text-sm font-semibold">{formatPercentage(data.connect_rate, 0)}</span>
            </div>
            <Progress value={data.connect_rate} className="h-2" />
          </div>

          {/* Conversion Rate */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Conversion Rate</span>
              <span className="text-sm font-semibold">{formatPercentage(data.landing_page_views > 0 ? (resultsValue / data.landing_page_views) * 100 : 0, 2)}</span>
            </div>
            <Progress value={data.landing_page_views > 0 ? (resultsValue / data.landing_page_views) * 100 : 0} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {/* Loaded ADs Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <TrendingUp className="w-5 h-5 text-orange-500" />
            🗂️ Loaded ADs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-500">{data.ad_id.length}</div>
              <div className="text-xs text-muted">ADs</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-500">{data.adset_id.length}</div>
              <div className="text-xs text-muted">Adsets</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-500">{data.campaign_id.length}</div>
              <div className="text-xs text-muted">Campaigns</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

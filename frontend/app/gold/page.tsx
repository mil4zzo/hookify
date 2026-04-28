"use client";

import { useState, useEffect, useMemo } from "react";
import { usePacksAds } from "@/lib/hooks/usePacksAds";
import { api } from "@/lib/api/endpoints";
import { AdPerformanceRequest, AdPerformanceResponse, RankingsItem } from "@/lib/api/schemas";
import { useValidationCriteria } from "@/lib/hooks/useValidationCriteria";
import { evaluateValidationCriteria, AdMetricsData } from "@/lib/utils/validateAdCriteria";
import { computeValidatedAveragesFromAdPerformance } from "@/lib/utils/validatedAverages";
import { PageContainer } from "@/components/common/PageContainer";
import { useAppAuthReady } from "@/lib/hooks/useAppAuthReady";
import { GoldKanbanWidget } from "@/components/gold/GoldKanbanWidget";
import { GoldTable } from "@/components/gold/GoldTable";
import { useFilters } from "@/lib/hooks/useFilters";
import { StateSkeleton } from "@/components/common/States";
import { AnalyticsWorkspace, DashboardGrid, WorkspaceState } from "@/components/common/layout";

function GoldPageSkeleton() {
  return (
    <PageContainer variant="analytics" title="G.O.L.D." description="Classificação de anúncios por performance">
      <AnalyticsWorkspace>
        <StateSkeleton variant="page" rows={4} className="rounded-md border border-border bg-card" />
      </AnalyticsWorkspace>
    </PageContainer>
  );
}

export default function GoldPage() {
  const { isClient, isAuthorized } = useAppAuthReady();

  const {
    selectedPackIds,
    effectiveDateRange: dateRange,
    actionType,
    actionTypeOptions,
    setActionTypeOptions,
    packs,
    packsClient,
  } = useFilters();

  const [serverData, setServerData] = useState<any[] | null>(null);
  const [averages, setAverages] = useState<any | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  // Fetch data
  useEffect(() => {
    if (!isAuthorized) return;

    const start = dateRange.start;
    const end = dateRange.end;
    if (!start || !end) return;
    if (selectedPackIds.size === 0) return;

    const req: AdPerformanceRequest = {
      date_start: start,
      date_stop: end,
      group_by: "ad_name",
      limit: 1000,
      filters: {},
      pack_ids: Array.from(selectedPackIds),
    };

    setLoading(true);
    api.analytics
      .getAdPerformance(req)
      .then((res: AdPerformanceResponse) => {
        setServerData(res.data || []);
        setActionTypeOptions(res.available_conversion_types || []);
        setAverages(res.averages);
      })
      .catch((err) => {
        console.error("Erro ao buscar dados:", err);
        setServerData([]);
      })
      .finally(() => setLoading(false));
  }, [isAuthorized, dateRange.start, dateRange.end, selectedPackIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedPacks = packs.filter((p) => selectedPackIds.has(p.id));
  const { packsAdsMap } = usePacksAds(selectedPacks);

  const isRankingInSelectedPacks = useMemo(() => {
    return (ranking: any): boolean => {
      if (selectedPackIds.size === 0) return false;
      if (selectedPacks.length === 0) return false;

      for (const pack of selectedPacks) {
        const packAds = packsAdsMap.get(pack.id) || [];
        if (packAds.length === 0) continue;

        const matches = packAds.some((ad: any) => {
          const rankingAdId = ranking.ad_id;
          const rankingAdName = ranking.ad_name;
          const rankingAccountId = ranking.account_id;

          const adId = ad.ad_id;
          const adName = ad.ad_name;
          const adAccountId = ad.account_id;

          if (rankingAccountId && adAccountId) {
            if (String(rankingAccountId).trim() !== String(adAccountId).trim()) {
              return false;
            }
          }

          if (rankingAdId && adId) {
            if (String(rankingAdId).trim() === String(adId).trim()) {
              return true;
            }
          }

          if (rankingAdName && adName) {
            if (String(rankingAdName).trim() === String(adName).trim()) {
              return true;
            }
          }

          return false;
        });

        if (matches) return true;
      }

      return false;
    };
  }, [selectedPackIds, selectedPacks, packsAdsMap]);

  const filteredRankings = useMemo(() => {
    if (!serverData) return [];
    return serverData.filter((row: any) => isRankingInSelectedPacks(row));
  }, [serverData, isRankingInSelectedPacks]);

  const { criteria: validationCriteria, isLoading: isLoadingCriteria } = useValidationCriteria();

  const [validatedRankings, validatedAverages] = useMemo(() => {
    if (!filteredRankings || filteredRankings.length === 0) {
      return [[], undefined] as [any[], any];
    }

    if (!validationCriteria || validationCriteria.length === 0) {
      const averagesFromAll = computeValidatedAveragesFromAdPerformance(filteredRankings as any, actionType, actionTypeOptions);
      return [filteredRankings, averagesFromAll] as [any[], any];
    }

    const validated = filteredRankings.filter((ad: any) => {
      const impressions = Number(ad.impressions || 0);
      const spend = Number(ad.spend || 0);
      const cpm = typeof ad.cpm === "number" && !Number.isNaN(ad.cpm) && isFinite(ad.cpm) ? ad.cpm : impressions > 0 ? (spend * 1000) / impressions : 0;
      const website_ctr = Number(ad.website_ctr || 0);
      const connect_rate = Number(ad.connect_rate || 0);
      const lpv = Number(ad.lpv || 0);
      const results = actionType ? Number(ad.conversions?.[actionType] || 0) : 0;
      const page_conv = lpv > 0 ? results / lpv : 0;
      const overall_conversion = website_ctr * connect_rate * page_conv;

      const metrics: AdMetricsData = {
        ad_name: ad.ad_name,
        ad_id: ad.ad_id,
        account_id: ad.account_id,
        impressions,
        spend,
        cpm,
        website_ctr,
        connect_rate,
        inline_link_clicks: Number(ad.inline_link_clicks || 0),
        clicks: Number(ad.clicks || 0),
        plays: Number(ad.plays || 0),
        hook: Number(ad.hook || 0),
        ctr: Number(ad.ctr || 0),
        page_conv,
        overall_conversion,
        conversions: ad.conversions || {},
      };
      return evaluateValidationCriteria(validationCriteria, metrics, "AND");
    });

    const averagesFromValidated = computeValidatedAveragesFromAdPerformance(validated as any, actionType, actionTypeOptions);
    return [validated, averagesFromValidated] as [any[], any];
  }, [filteredRankings, validationCriteria, actionType, actionTypeOptions]);

  if (!isClient || !isAuthorized) {
    return <GoldPageSkeleton />;
  }

  if (loading || isLoadingCriteria) {
    return <GoldPageSkeleton />;
  }

  if (!validatedRankings || validatedRankings.length === 0) {
    return (
      <PageContainer variant="analytics" title="G.O.L.D." description="Classificação de anúncios por performance">
        <WorkspaceState kind="empty" message="Nenhum anúncio encontrado para os filtros selecionados." framed={false} fill />
      </PageContainer>
    );
  }

  return (
    <PageContainer variant="analytics" title="G.O.L.D." description="Classificação de anúncios por performance">
      {actionType && validatedAverages && (
        <AnalyticsWorkspace className="gap-8 overflow-visible">
          <GoldKanbanWidget ads={validatedRankings as RankingsItem[]} averages={validatedAverages} actionType={actionType} validationCriteria={validationCriteria || []} dateStart={dateRange.start} dateStop={dateRange.end} availableConversionTypes={actionTypeOptions} />

          <div>
            <h2 className="text-xl font-semibold mb-4">Lista de Anúncios</h2>
            <DashboardGrid className="grid-cols-1 sm:grid-cols-1 xl:grid-cols-1">
              <GoldTable ads={validatedRankings as RankingsItem[]} averages={validatedAverages} actionType={actionType} />
            </DashboardGrid>
          </div>
        </AnalyticsWorkspace>
      )}
    </PageContainer>
  );
}

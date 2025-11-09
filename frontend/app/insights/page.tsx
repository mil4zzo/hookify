"use client";

import { useState, useEffect, useMemo } from "react";
import { useRequireAuth } from "@/lib/hooks/useRequireAuth";
import { LoadingState, EmptyState } from "@/components/common/States";
import { useClientAuth, useClientPacks } from "@/lib/hooks/useClientSession";
import { usePacksAds } from "@/lib/hooks/usePacksAds";
import { KanbanBoard } from "@/components/insights/KanbanBoard";
import { OpportunityCards } from "@/components/insights/OpportunityCards";
import { DateRangeFilter } from "@/components/common/DateRangeFilter";
import { ActionTypeFilter } from "@/components/common/ActionTypeFilter";
import { PackFilter } from "@/components/common/PackFilter";
import { api } from "@/lib/api/endpoints";
import { RankingsRequest, RankingsResponse } from "@/lib/api/schemas";
import { computeOpportunityScores } from "@/lib/utils/opportunity";
import { useValidationCriteria } from "@/lib/hooks/useValidationCriteria";
import { evaluateValidationCriteria, AdMetricsData } from "@/lib/utils/validateAdCriteria";
import { formatDateLocal } from "@/lib/utils/dateFilters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OpportunityWidget } from "@/components/insights/OpportunityWidget";

const STORAGE_KEY_PACKS = "hookify-insights-selected-packs";
const STORAGE_KEY_ACTION_TYPE = "hookify-insights-action-type";

type PackPreferences = Record<string, boolean>;

const savePackPreferences = (prefs: PackPreferences) => {
  try {
    localStorage.setItem(STORAGE_KEY_PACKS, JSON.stringify(prefs));
  } catch (e) {
    console.error("Erro ao salvar preferências de packs:", e);
  }
};

const loadPackPreferences = (): PackPreferences => {
  if (typeof window === "undefined") return {};
  try {
    const saved = localStorage.getItem(STORAGE_KEY_PACKS);
    if (!saved) return {};

    const parsed = JSON.parse(saved);

    if (Array.isArray(parsed)) {
      const migrated: PackPreferences = {};
      parsed.forEach((packId: string) => {
        migrated[packId] = true;
      });
      savePackPreferences(migrated);
      return migrated;
    }

    if (typeof parsed === "object" && parsed !== null) {
      return parsed as PackPreferences;
    }

    return {};
  } catch (e) {
    console.error("Erro ao carregar preferências de packs:", e);
    return {};
  }
};

export default function InsightsPage() {
  const { isClient, isAuthenticated } = useClientAuth();
  const { packs, isClient: packsClient } = useClientPacks();
  const { status } = useRequireAuth("/login");
  const [actionType, setActionType] = useState<string>(() => {
    if (typeof window === "undefined") return "";

    try {
      const saved = localStorage.getItem(STORAGE_KEY_ACTION_TYPE);
      if (saved) {
        return saved;
      }
    } catch (e) {
      console.error("Erro ao carregar actionType do localStorage:", e);
    }
    return "";
  });
  const [dateRange, setDateRange] = useState<{ start?: string; end?: string }>(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return {
      start: formatDateLocal(start),
      end: formatDateLocal(end),
    };
  });
  const [serverData, setServerData] = useState<any[] | null>(null);
  const [availableConversionTypes, setAvailableConversionTypes] = useState<string[]>([]);
  const [averages, setAverages] = useState<any | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  const [selectedPackIds, setSelectedPackIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    const prefs = loadPackPreferences();
    return new Set(
      Object.entries(prefs)
        .filter(([_, enabled]) => enabled)
        .map(([id]) => id)
    );
  });

  const uniqueConversionTypes = useMemo(() => {
    return availableConversionTypes;
  }, [availableConversionTypes]);

  useEffect(() => {
    if (uniqueConversionTypes.length === 0) return;

    if (!actionType) {
      try {
        const saved = localStorage.getItem(STORAGE_KEY_ACTION_TYPE);
        if (saved && uniqueConversionTypes.includes(saved)) {
          setActionType(saved);
        } else {
          setActionType(uniqueConversionTypes[0]);
        }
      } catch (e) {
        console.error("Erro ao carregar actionType:", e);
        setActionType(uniqueConversionTypes[0]);
      }
    } else {
      if (!uniqueConversionTypes.includes(actionType)) {
        setActionType(uniqueConversionTypes[0]);
      }
    }
  }, [uniqueConversionTypes, actionType]);

  const handleActionTypeChange = (value: string) => {
    setActionType(value);
    try {
      localStorage.setItem(STORAGE_KEY_ACTION_TYPE, value);
    } catch (e) {
      console.error("Erro ao salvar actionType no localStorage:", e);
    }
  };

  useEffect(() => {
    if (!isClient || status !== "authorized") return;

    const start = dateRange.start;
    const end = dateRange.end;
    if (!start || !end) return;

    const req: RankingsRequest = {
      date_start: start,
      date_stop: end,
      group_by: "ad_name",
      limit: 1000,
      filters: {},
    };

    setLoading(true);
    api.analytics
      .getRankings(req)
      .then((res: RankingsResponse) => {
        setServerData(res.data || []);
        setAvailableConversionTypes(res.available_conversion_types || []);
        setAverages(res.averages);
      })
      .catch((err) => {
        console.error("Erro ao buscar insights:", err);
        setServerData([]);
        setAvailableConversionTypes([]);
      })
      .finally(() => setLoading(false));
  }, [isClient, status, dateRange.start, dateRange.end]);

  useEffect(() => {
    if (!packsClient || packs.length === 0) return;

    const allPackIds = new Set(packs.map((p) => p.id));
    const currentPrefs = loadPackPreferences();

    let hasChanges = false;
    const newPrefs: PackPreferences = {};

    allPackIds.forEach((packId) => {
      if (packId in currentPrefs) {
        newPrefs[packId] = currentPrefs[packId];
      } else {
        newPrefs[packId] = true;
        hasChanges = true;
      }
    });

    Object.keys(currentPrefs).forEach((packId) => {
      if (!allPackIds.has(packId)) {
        hasChanges = true;
      }
    });

    if (hasChanges) {
      savePackPreferences(newPrefs);
    }

    const enabledPackIds = new Set(
      Object.entries(hasChanges ? newPrefs : currentPrefs)
        .filter(([_, enabled]) => enabled)
        .map(([id]) => id)
    );

    setSelectedPackIds((prevSelected) => {
      if (prevSelected.size !== enabledPackIds.size || !Array.from(enabledPackIds).every((id) => prevSelected.has(id))) {
        return enabledPackIds;
      }
      return prevSelected;
    });
  }, [packsClient, packs.length, packs.map((p) => p.id).join(",")]);

  // Buscar ads dos packs selecionados usando cache
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

  const handleTogglePack = (packId: string) => {
    const currentPrefs = loadPackPreferences();
    const newPrefs: PackPreferences = {
      ...currentPrefs,
      [packId]: !(currentPrefs[packId] ?? true),
    };

    savePackPreferences(newPrefs);

    const enabledPackIds = new Set(
      Object.entries(newPrefs)
        .filter(([_, enabled]) => enabled)
        .map(([id]) => id)
    );
    setSelectedPackIds(enabledPackIds);
  };

  const adsForKanban = useMemo(() => {
    if (!serverData) return [];

    let mappedData = serverData.map((row: any) => {
      const conversionsObj = row.conversions || {};
      const results = actionType ? Number(conversionsObj[actionType] || 0) : 0;
      const lpv = Number(row.lpv || 0);
      const spend = Number(row.spend || 0);
      const page_conv = lpv > 0 ? results / lpv : 0;
      const cpr = results > 0 ? spend / results : 0;

      return {
        account_id: row.account_id,
        ad_id: row.ad_id,
        ad_name: row.ad_name,
        thumbnail: row.thumbnail || null,
        hook: Number(row.hook || 0),
        ctr: Number(row.ctr || 0),
        page_conv,
        cpr,
        conversions: conversionsObj,
        lpv,
      };
    });

    const filteredData = mappedData.filter((ranking: any) => isRankingInSelectedPacks(ranking));

    return filteredData;
  }, [serverData, actionType, selectedPackIds, packs, isRankingInSelectedPacks]);

  // Conjunto bruto do backend filtrado por packs para o widget de oportunidades
  const filteredRankings = useMemo(() => {
    if (!serverData) return [];
    return serverData.filter((row: any) => isRankingInSelectedPacks(row));
  }, [serverData, isRankingInSelectedPacks]);

  // Calcular oportunidades para os cards
  const { criteria: validationCriteria, isLoading: isLoadingCriteria } = useValidationCriteria();
  
  const opportunityRows = useMemo(() => {
    if (!filteredRankings || filteredRankings.length === 0 || !averages) return [];
    if (isLoadingCriteria) return [];

    // Aplicar critérios de validação
    let eligibleAds = filteredRankings;
    if (validationCriteria && validationCriteria.length > 0) {
      eligibleAds = filteredRankings.filter((ad: any) => {
        const impressions = Number(ad.impressions || 0);
        const spend = Number(ad.spend || 0);
        const cpm = impressions > 0 ? (spend * 1000) / impressions : Number(ad.cpm || 0);
        const website_ctr = Number(ad.website_ctr || 0);
        const connect_rate = Number(ad.connect_rate || 0);
        const lpv = Number(ad.lpv || 0);
        const results = actionType ? Number(ad.conversions?.[actionType] || 0) : 0;
        const page_conv = lpv > 0 ? results / lpv : 0;
        
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
        };
        return evaluateValidationCriteria(validationCriteria, metrics, "AND");
      });
    }

    if (eligibleAds.length === 0) return [];
    const spendTotal = eligibleAds.reduce((s: number, a: any) => s + Number(a.spend || 0), 0);
    return computeOpportunityScores({
      ads: eligibleAds,
      averages,
      actionType,
      spendTotal,
      limit: 10,
    });
  }, [filteredRankings, averages, actionType, validationCriteria, isLoadingCriteria]);

  if (!isClient) {
    return (
      <div>
        <LoadingState label="Carregando..." />
      </div>
    );
  }

  if (status !== "authorized") {
    return (
      <div>
        <LoadingState label="Redirecionando para login..." />
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <LoadingState label="Carregando insights..." />
      </div>
    );
  }

  if (!serverData || serverData.length === 0) {
    return (
      <div>
        <EmptyState message="Sem dados no período selecionado." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold mb-2">Insights</h1>
        <p className="text-muted-foreground">Análise dos melhores e piores desempenhos por métrica</p>
      </div>

      <div className="mb-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <DateRangeFilter label="Período (Data do Insight)" value={dateRange} onChange={setDateRange} requireConfirmation={true} />
        <ActionTypeFilter label="Evento de Conversão" value={actionType} onChange={handleActionTypeChange} options={uniqueConversionTypes} />
        {packsClient && packs.length > 0 && <PackFilter packs={packs} selectedPackIds={selectedPackIds} onTogglePack={handleTogglePack} />}
      </div>

      {/* Cards de Oportunidades */}
      {opportunityRows.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Oportunidades</h2>
          {/* Debug: Métricas médias */}
          {averages && (
            <div className="mb-4 p-3 bg-muted rounded text-xs space-y-1">
              <div className="font-semibold mb-2">Médias (Debug):</div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                <div>Hook: {((averages.hook || 0) * 100).toFixed(1)}%</div>
                <div>CTR: {((averages.website_ctr || 0) * 100).toFixed(2)}%</div>
                <div>Connect: {((averages.connect_rate || 0) * 100).toFixed(1)}%</div>
                <div>Page: {((averages.per_action_type?.[actionType]?.page_conv || 0) * 100).toFixed(1)}%</div>
                <div>CPR: R$ {((averages.per_action_type?.[actionType]?.cpr || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}</div>
                <div>CPM: R$ {((averages.cpm || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}</div>
              </div>
            </div>
          )}
          <OpportunityCards rows={opportunityRows} averages={averages} actionType={actionType} />
        </div>
      )}

      {/* Tabela de Oportunidades */}
      <OpportunityWidget ads={filteredRankings as any} averages={averages} actionType={actionType} limit={10} />

      {/* Top Performers - Verde */}
      <Card className="">
        <CardHeader className="">
          <CardTitle className="text-green-700 dark:text-green-300">Top Performers</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <KanbanBoard ads={adsForKanban} variant="success" actionType={actionType} />
        </CardContent>
      </Card>

      {/* Worst Performers - Vermelho */}
      <Card className="">
        <CardHeader className="">
          <CardTitle className="text-red-700 dark:text-red-300">Piores Performances</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <KanbanBoard ads={adsForKanban} variant="danger" actionType={actionType} />
        </CardContent>
      </Card>
    </div>
  );
}

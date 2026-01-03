"use client";

import { useState, useEffect, useMemo } from "react";
import { LoadingState, EmptyState } from "@/components/common/States";
import { useClientPacks } from "@/lib/hooks/useClientSession";
import { usePacksAds } from "@/lib/hooks/usePacksAds";
import { api } from "@/lib/api/endpoints";
import { AdPerformanceRequest, AdPerformanceResponse, RankingsItem } from "@/lib/api/schemas";
import { useValidationCriteria } from "@/lib/hooks/useValidationCriteria";
import { evaluateValidationCriteria, AdMetricsData } from "@/lib/utils/validateAdCriteria";
import { computeValidatedAveragesFromAdPerformance } from "@/lib/utils/validatedAverages";
import { formatDateLocal } from "@/lib/utils/dateFilters";
import { PageContainer } from "@/components/common/PageContainer";
import { useAppAuthReady } from "@/lib/hooks/useAppAuthReady";
import { GoldKanbanWidget } from "@/components/gold/GoldKanbanWidget";
import { GoldTable } from "@/components/gold/GoldTable";
import { FiltersDropdown } from "@/components/common/FiltersDropdown";
import { DateRangeValue } from "@/components/common/DateRangeFilter";

// Chaves compartilhadas entre Insights e Rankings
const STORAGE_KEY_PACKS = "hookify-selected-packs";
const STORAGE_KEY_ACTION_TYPE = "hookify-action-type";
const STORAGE_KEY_DATE_RANGE = "hookify-date-range";
const STORAGE_KEY_USE_PACK_DATES = "hookify-use-pack-dates";

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
    let saved = localStorage.getItem(STORAGE_KEY_PACKS);
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

const saveDateRange = (dateRange: { start?: string; end?: string }) => {
  try {
    localStorage.setItem(STORAGE_KEY_DATE_RANGE, JSON.stringify(dateRange));
  } catch (e) {
    console.error("Erro ao salvar dateRange no localStorage:", e);
  }
};

const loadDateRange = (): { start?: string; end?: string } | null => {
  if (typeof window === "undefined") return null;
  try {
    let saved = localStorage.getItem(STORAGE_KEY_DATE_RANGE);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (parsed && typeof parsed === "object" && parsed.start && parsed.end) {
      return parsed;
    }
    return null;
  } catch (e) {
    console.error("Erro ao carregar dateRange do localStorage:", e);
    return null;
  }
};

export default function GoldPage() {
  const { packs, isClient: packsClient } = useClientPacks();
  const { isClient, authStatus, onboardingStatus, isAuthorized } = useAppAuthReady();
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
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => {
    const saved = loadDateRange();
    if (saved) {
      return saved;
    }
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

  const [usePackDates, setUsePackDates] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      let saved = localStorage.getItem(STORAGE_KEY_USE_PACK_DATES);
      return saved === "true";
    } catch (e) {
      console.error("Erro ao carregar usePackDates do localStorage:", e);
      return false;
    }
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

  const calculateDateRangeFromPacks = useMemo(() => {
    if (selectedPackIds.size === 0) return null;

    const selectedPacks = packs.filter((p) => selectedPackIds.has(p.id));
    if (selectedPacks.length === 0) return null;

    if (selectedPacks.length === 1) {
      const pack = selectedPacks[0];
      if (pack.date_start && pack.date_stop) {
        return { start: pack.date_start, end: pack.date_stop };
      }
      return null;
    }

    let minStart: string | null = null;
    let maxEnd: string | null = null;

    selectedPacks.forEach((pack) => {
      if (pack.date_start && (!minStart || pack.date_start < minStart)) {
        minStart = pack.date_start;
      }
      if (pack.date_stop && (!maxEnd || pack.date_stop > maxEnd)) {
        maxEnd = pack.date_stop;
      }
    });

    if (minStart && maxEnd) {
      return { start: minStart, end: maxEnd };
    }
    return null;
  }, [packs, selectedPackIds]);

  const handleDateRangeChange = (value: DateRangeValue) => {
    setDateRange(value);
    saveDateRange(value);
  };

  const handleUsePackDatesChange = (checked: boolean) => {
    setUsePackDates(checked);
    try {
      localStorage.setItem(STORAGE_KEY_USE_PACK_DATES, checked.toString());
    } catch (e) {
      console.error("Erro ao salvar usePackDates no localStorage:", e);
    }
  };

  useEffect(() => {
    if (!usePackDates) return;
    if (!calculateDateRangeFromPacks) return;
    if (dateRange.start === calculateDateRangeFromPacks.start && dateRange.end === calculateDateRangeFromPacks.end) {
      return;
    }
    setDateRange(calculateDateRangeFromPacks);
    saveDateRange(calculateDateRangeFromPacks);
  }, [usePackDates, selectedPackIds, calculateDateRangeFromPacks]);

  useEffect(() => {
    if (!isAuthorized) {
      return;
    }

    const start = dateRange.start;
    const end = dateRange.end;
    if (!start || !end) return;

    const req: AdPerformanceRequest = {
      date_start: start,
      date_stop: end,
      group_by: "ad_name",
      limit: 1000,
      filters: {},
    };

    setLoading(true);
    api.analytics
      .getAdPerformance(req)
      .then((res: AdPerformanceResponse) => {
        setServerData(res.data || []);
        setAvailableConversionTypes(res.available_conversion_types || []);
        setAverages(res.averages);
      })
      .catch((err) => {
        console.error("Erro ao buscar dados:", err);
        setServerData([]);
        setAvailableConversionTypes([]);
      })
      .finally(() => setLoading(false));
  }, [isAuthorized, dateRange.start, dateRange.end]);

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

    let enabledPackIds = new Set(
      Object.entries(hasChanges ? newPrefs : currentPrefs)
        .filter(([_, enabled]) => enabled)
        .map(([id]) => id)
    );

    if (enabledPackIds.size === 0 && allPackIds.size > 0) {
      const firstPackId = Array.from(allPackIds)[0];
      enabledPackIds = new Set([firstPackId]);
      const autoPrefs: PackPreferences = { [firstPackId]: true };
      savePackPreferences(autoPrefs);
    }

    setSelectedPackIds((prevSelected) => {
      if (prevSelected.size !== enabledPackIds.size || !Array.from(enabledPackIds).every((id) => prevSelected.has(id))) {
        return enabledPackIds;
      }
      return prevSelected;
    });
  }, [packsClient, packs.length, packs.map((p) => p.id).join(",")]);

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
      const averagesFromAll = computeValidatedAveragesFromAdPerformance(filteredRankings as any, actionType, uniqueConversionTypes);
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

    const averagesFromValidated = computeValidatedAveragesFromAdPerformance(validated as any, actionType, uniqueConversionTypes);
    return [validated, averagesFromValidated] as [any[], any];
  }, [filteredRankings, validationCriteria, actionType, uniqueConversionTypes]);

  if (!isClient || !isAuthorized) {
    return (
      <PageContainer title="G.O.L.D." description="Classificação de anúncios por performance">
        <LoadingState />
      </PageContainer>
    );
  }

  if (loading || isLoadingCriteria) {
    return (
      <PageContainer title="G.O.L.D." description="Classificação de anúncios por performance" actions={<FiltersDropdown expanded={true} dateRange={dateRange} onDateRangeChange={handleDateRangeChange} actionType={actionType} onActionTypeChange={handleActionTypeChange} actionTypeOptions={uniqueConversionTypes} packs={packs} selectedPackIds={selectedPackIds} onTogglePack={handleTogglePack} packsClient={packsClient} usePackDates={usePackDates} onUsePackDatesChange={handleUsePackDatesChange} packDatesRange={calculateDateRangeFromPacks ?? null} />}>
        <LoadingState />
      </PageContainer>
    );
  }

  if (!validatedRankings || validatedRankings.length === 0) {
    return (
      <PageContainer title="G.O.L.D." description="Classificação de anúncios por performance" actions={<FiltersDropdown expanded={true} dateRange={dateRange} onDateRangeChange={handleDateRangeChange} actionType={actionType} onActionTypeChange={handleActionTypeChange} actionTypeOptions={uniqueConversionTypes} packs={packs} selectedPackIds={selectedPackIds} onTogglePack={handleTogglePack} packsClient={packsClient} usePackDates={usePackDates} onUsePackDatesChange={handleUsePackDatesChange} packDatesRange={calculateDateRangeFromPacks ?? null} />}>
        <EmptyState message="Nenhum anúncio encontrado para os filtros selecionados." />
      </PageContainer>
    );
  }

  return (
    <PageContainer title="G.O.L.D." description="Classificação de anúncios por performance" actions={<FiltersDropdown expanded={true} dateRange={dateRange} onDateRangeChange={handleDateRangeChange} actionType={actionType} onActionTypeChange={handleActionTypeChange} actionTypeOptions={uniqueConversionTypes} packs={packs} selectedPackIds={selectedPackIds} onTogglePack={handleTogglePack} packsClient={packsClient} usePackDates={usePackDates} onUsePackDatesChange={handleUsePackDatesChange} packDatesRange={calculateDateRangeFromPacks ?? null} />}>
      {actionType && validatedAverages && (
        <>
          <GoldKanbanWidget ads={validatedRankings as RankingsItem[]} averages={validatedAverages} actionType={actionType} validationCriteria={validationCriteria || []} dateStart={dateRange.start} dateStop={dateRange.end} availableConversionTypes={uniqueConversionTypes} />

          <div className="mt-8">
            <h2 className="text-xl font-semibold mb-4">Lista de Anúncios</h2>
            <GoldTable ads={validatedRankings as RankingsItem[]} averages={validatedAverages} actionType={actionType} />
          </div>
        </>
      )}
    </PageContainer>
  );
}

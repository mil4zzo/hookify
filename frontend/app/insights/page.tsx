"use client";

import { useState, useEffect, useMemo } from "react";
import { useRequireAuth } from "@/lib/hooks/useRequireAuth";
import { LoadingState, EmptyState } from "@/components/common/States";
import { useClientAuth, useClientPacks } from "@/lib/hooks/useClientSession";
import { usePacksAds } from "@/lib/hooks/usePacksAds";
import { OpportunityCards } from "@/components/insights/OpportunityCards";
import { calculateGlobalMetricRanks } from "@/lib/utils/metricRankings";
import { FiltersDropdown } from "@/components/common/FiltersDropdown";
import { GemsWidget } from "@/components/insights/GemsWidget";
import { GemsColumnFilter, GemsColumnType } from "@/components/common/GemsColumnFilter";
import { InsightsKanbanWidget } from "@/components/insights/InsightsKanbanWidget";
import { api } from "@/lib/api/endpoints";
import { RankingsRequest, RankingsResponse } from "@/lib/api/schemas";
import { computeOpportunityScores } from "@/lib/utils/opportunity";
import { useValidationCriteria } from "@/lib/hooks/useValidationCriteria";
import { evaluateValidationCriteria, AdMetricsData } from "@/lib/utils/validateAdCriteria";
import { computeValidatedAveragesFromRankings } from "@/lib/utils/validatedAverages";
import { formatDateLocal } from "@/lib/utils/dateFilters";
import { Switch } from "@/components/ui/switch";
import { ActionTypeFilter } from "@/components/common/ActionTypeFilter";
import { IconSparkles } from "@tabler/icons-react";
import { Modal } from "@/components/common/Modal";
import { AdDetailsDialog } from "@/components/ads/AdDetailsDialog";
import { OpportunityRow } from "@/lib/utils/opportunity";
import { RankingsItem } from "@/lib/api/schemas";
import { useMqlLeadscore } from "@/lib/hooks/useMqlLeadscore";
import { PageSectionHeader } from "@/components/common/PageSectionHeader";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";

const STORAGE_KEY_PACKS = "hookify-insights-selected-packs";
const STORAGE_KEY_ACTION_TYPE = "hookify-insights-action-type";
const STORAGE_KEY_GROUP_BY_PACKS = "hookify-insights-group-by-packs";
const STORAGE_KEY_DATE_RANGE = "hookify-insights-date-range";
const STORAGE_KEY_USE_PACK_DATES = "hookify-insights-use-pack-dates";
const STORAGE_KEY_PACK_ACTION_TYPES = "hookify-insights-pack-action-types";
const STORAGE_KEY_GEMS_COMPACT = "hookify-insights-gems-compact";
const STORAGE_KEY_GEMS_COLUMNS = "hookify-insights-gems-columns";

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

// Funções auxiliares para gerenciar dateRange no localStorage
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
    const saved = localStorage.getItem(STORAGE_KEY_DATE_RANGE);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    // Validar que tem start e end
    if (parsed && typeof parsed === "object" && parsed.start && parsed.end) {
      return parsed;
    }
    return null;
  } catch (e) {
    console.error("Erro ao carregar dateRange do localStorage:", e);
    return null;
  }
};

// Funções auxiliares para gerenciar colunas de Gems no localStorage
const saveGemsColumns = (columns: Set<GemsColumnType>) => {
  try {
    const columnsArray = Array.from(columns);
    localStorage.setItem(STORAGE_KEY_GEMS_COLUMNS, JSON.stringify(columnsArray));
  } catch (e) {
    console.error("Erro ao salvar colunas de Gems no localStorage:", e);
  }
};

const loadGemsColumns = (): Set<GemsColumnType> => {
  if (typeof window === "undefined") {
    // Por padrão, todas as 5 colunas são ativas
    return new Set<GemsColumnType>(["hook", "website_ctr", "ctr", "page_conv", "hold_rate"]);
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY_GEMS_COLUMNS);
    if (!saved) {
      // Por padrão, todas as 5 colunas são ativas
      return new Set<GemsColumnType>(["hook", "website_ctr", "ctr", "page_conv", "hold_rate"]);
    }
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) {
      const validColumns = parsed.filter((col) => ["hook", "website_ctr", "ctr", "page_conv", "hold_rate"].includes(col));
      // Se não houver colunas válidas, retornar todas por padrão
      if (validColumns.length === 0) {
        return new Set<GemsColumnType>(["hook", "website_ctr", "ctr", "page_conv", "hold_rate"]);
      }
      return new Set<GemsColumnType>(validColumns as GemsColumnType[]);
    }
    // Por padrão, todas as 5 colunas são ativas
    return new Set<GemsColumnType>(["hook", "website_ctr", "ctr", "page_conv", "hold_rate"]);
  } catch (e) {
    console.error("Erro ao carregar colunas de Gems do localStorage:", e);
    // Por padrão, todas as 5 colunas são ativas
    return new Set<GemsColumnType>(["hook", "website_ctr", "ctr", "page_conv", "hold_rate"]);
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
    // Tentar carregar do localStorage primeiro
    const saved = loadDateRange();
    if (saved) {
      return saved;
    }
    // Se não houver salvo, inicializar com últimos 30 dias por padrão
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
  const [groupByPacks, setGroupByPacks] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const saved = localStorage.getItem(STORAGE_KEY_GROUP_BY_PACKS);
      return saved === "true";
    } catch (e) {
      console.error("Erro ao carregar groupByPacks do localStorage:", e);
      return false;
    }
  });

  const [isGemsCompact, setIsGemsCompact] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const saved = localStorage.getItem(STORAGE_KEY_GEMS_COMPACT);
      return saved !== "false"; // Default é true (compacto)
    } catch (e) {
      console.error("Erro ao carregar isGemsCompact do localStorage:", e);
      return true;
    }
  });

  const [activeGemsColumns, setActiveGemsColumns] = useState<Set<GemsColumnType>>(() => {
    return loadGemsColumns();
  });

  const [selectedPackIds, setSelectedPackIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    const prefs = loadPackPreferences();
    return new Set(
      Object.entries(prefs)
        .filter(([_, enabled]) => enabled)
        .map(([id]) => id)
    );
  });

  // Estado para controlar se deve usar datas dos packs
  const [usePackDates, setUsePackDates] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const saved = localStorage.getItem(STORAGE_KEY_USE_PACK_DATES);
      return saved === "true";
    } catch (e) {
      console.error("Erro ao carregar usePackDates do localStorage:", e);
      return false;
    }
  });

  // Estado para armazenar actionType de cada pack
  const [packActionTypes, setPackActionTypes] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = localStorage.getItem(STORAGE_KEY_PACK_ACTION_TYPES);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error("Erro ao carregar packActionTypes do localStorage:", e);
    }
    return {};
  });

  // Estado para controlar o anúncio selecionado no modal
  const [selectedAd, setSelectedAd] = useState<RankingsItem | null>(null);
  // Estado para controlar se deve abrir na aba de vídeo
  const [openInVideoTab, setOpenInVideoTab] = useState(false);

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

  // Função para calcular dateRange dos packs selecionados
  const calculateDateRangeFromPacks = useMemo(() => {
    if (selectedPackIds.size === 0) return null;

    const selectedPacks = packs.filter((p) => selectedPackIds.has(p.id));
    if (selectedPacks.length === 0) return null;

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

  // Handler para mudança de dateRange com salvamento no localStorage
  const handleDateRangeChange = (value: { start?: string; end?: string }) => {
    if (usePackDates) return; // Não permitir mudança manual quando usar datas dos packs
    setDateRange(value);
    saveDateRange(value);
  };

  // Handler para mudança de usePackDates
  const handleUsePackDatesChange = (checked: boolean) => {
    setUsePackDates(checked);
    try {
      localStorage.setItem(STORAGE_KEY_USE_PACK_DATES, checked.toString());
    } catch (e) {
      console.error("Erro ao salvar usePackDates no localStorage:", e);
    }

    if (checked && calculateDateRangeFromPacks) {
      setDateRange(calculateDateRangeFromPacks);
      saveDateRange(calculateDateRangeFromPacks);
    }
  };

  // Atualizar dateRange quando packs selecionados mudarem (se usePackDates estiver ativo)
  useEffect(() => {
    if (usePackDates && calculateDateRangeFromPacks) {
      setDateRange(calculateDateRangeFromPacks);
      saveDateRange(calculateDateRangeFromPacks);
    }
  }, [usePackDates, calculateDateRangeFromPacks]);

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

  const handleToggleGroupByPacks = (checked: boolean) => {
    setGroupByPacks(checked);
    try {
      localStorage.setItem(STORAGE_KEY_GROUP_BY_PACKS, checked.toString());
    } catch (e) {
      console.error("Erro ao salvar groupByPacks no localStorage:", e);
    }
  };

  const handleToggleGemsCompact = (checked: boolean) => {
    setIsGemsCompact(checked);
    try {
      localStorage.setItem(STORAGE_KEY_GEMS_COMPACT, checked.toString());
    } catch (e) {
      console.error("Erro ao salvar isGemsCompact no localStorage:", e);
    }
  };

  const handleToggleGemsColumn = (columnId: GemsColumnType) => {
    const newColumns = new Set(activeGemsColumns);
    if (newColumns.has(columnId)) {
      newColumns.delete(columnId);
    } else {
      newColumns.add(columnId);
    }
    setActiveGemsColumns(newColumns);
    saveGemsColumns(newColumns);
  };

  // Função para identificar qual pack pertence um ranking
  const getRankingPackId = useMemo(() => {
    return (ranking: any): string | null => {
      if (selectedPackIds.size === 0) return null;
      if (selectedPacks.length === 0) return null;

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

        if (matches) return pack.id;
      }

      return null;
    };
  }, [selectedPackIds, selectedPacks, packsAdsMap]);

  // Conjunto bruto do backend filtrado por packs para o widget de oportunidades
  const filteredRankings = useMemo(() => {
    if (!serverData) return [];
    return serverData.filter((row: any) => isRankingInSelectedPacks(row));
  }, [serverData, isRankingInSelectedPacks]);

  // Critérios de validação globais configurados pelo usuário
  const { criteria: validationCriteria, isLoading: isLoadingCriteria } = useValidationCriteria();

  // Conjunto de anúncios que passam pelos critérios de validação globais (independente do widget)
  const [validatedRankings, validatedAverages] = useMemo(() => {
    if (!filteredRankings || filteredRankings.length === 0) {
      return [[], undefined] as [any[], any];
    }

    // Enquanto critérios ainda não carregaram, considerar todos como validados
    if (!validationCriteria || validationCriteria.length === 0) {
      const averagesFromAll = computeValidatedAveragesFromRankings(filteredRankings as any, actionType);
      return [filteredRankings, averagesFromAll] as [any[], any];
    }

    const validated = filteredRankings.filter((ad: any) => {
      const impressions = Number(ad.impressions || 0);
      const spend = Number(ad.spend || 0);
      const cpm = impressions > 0 ? (spend * 1000) / impressions : Number(ad.cpm || 0);
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

    const averagesFromValidated = computeValidatedAveragesFromRankings(validated as any, actionType);
    return [validated, averagesFromValidated] as [any[], any];
  }, [filteredRankings, validationCriteria, actionType]);

  // Função para encontrar o anúncio original baseado no OpportunityRow
  const findAdFromOpportunityRow = useMemo(() => {
    return (row: OpportunityRow): RankingsItem | null => {
      if (!filteredRankings || filteredRankings.length === 0) return null;

      // Tentar encontrar por ad_id primeiro
      if (row.ad_id) {
        const foundById = filteredRankings.find((ad: any) => {
          const adId = String(ad.ad_id || "").trim();
          const rowAdId = String(row.ad_id || "").trim();
          return adId && rowAdId && adId === rowAdId;
        });
        if (foundById) return foundById as RankingsItem;
      }

      // Tentar encontrar por ad_name
      if (row.ad_name) {
        const foundByName = filteredRankings.find((ad: any) => {
          const adName = String(ad.ad_name || "").trim();
          const rowAdName = String(row.ad_name || "").trim();
          return adName && rowAdName && adName === rowAdName;
        });
        if (foundByName) return foundByName as RankingsItem;
      }

      return null;
    };
  }, [filteredRankings]);

  // Handler para quando um card de oportunidade é clicado
  const handleOpportunityCardClick = (row: OpportunityRow, openVideo: boolean = false) => {
    const ad = findAdFromOpportunityRow(row);
    if (ad) {
      setSelectedAd(ad);
      setOpenInVideoTab(openVideo);
    }
  };

  // Calcular oportunidades para os cards
  const { mqlLeadscoreMin } = useMqlLeadscore();

  const opportunityRows = useMemo(() => {
    if (!validatedRankings || validatedRankings.length === 0 || !validatedAverages) return [];
    if (isLoadingCriteria) return [];

    const eligibleAds = validatedRankings;
    const spendTotal = eligibleAds.reduce((s: number, a: any) => s + Number(a.spend || 0), 0);
    return computeOpportunityScores({
      ads: eligibleAds,
      averages: validatedAverages,
      actionType,
      spendTotal,
      mqlLeadscoreMin,
      limit: 10,
    });
  }, [validatedRankings, validatedAverages, actionType, isLoadingCriteria, mqlLeadscoreMin]);

  // Calcular rankings globais de métricas (para medalhas TOP 3)
  // IMPORTANTE: Os rankings são calculados apenas com anúncios que passam pelos critérios de validação
  // Se não houver critérios definidos (array vazio ou undefined), todos os anúncios são considerados
  const globalMetricRanks = useMemo(() => {
    if (!filteredRankings || filteredRankings.length === 0) {
      return {
        hookRank: new Map(),
        holdRateRank: new Map(),
        websiteCtrRank: new Map(),
        connectRateRank: new Map(),
        pageConvRank: new Map(),
        ctrRank: new Map(),
        spendRank: new Map(),
      };
    }
    // Passar validationCriteria apenas se houver critérios definidos (array não vazio)
    // Array vazio ou undefined significa "sem critérios" (todos os anúncios são válidos)
    const criteriaToUse = validationCriteria && validationCriteria.length > 0 ? validationCriteria : undefined;
    return calculateGlobalMetricRanks(filteredRankings, {
      validationCriteria: criteriaToUse,
      actionType,
      filterValidOnly: true,
    });
  }, [filteredRankings, validationCriteria, actionType]);

  // Agrupar oportunidades por pack quando groupByPacks estiver ativo
  const opportunityRowsByPack = useMemo(() => {
    if (!groupByPacks || !validatedRankings || validatedRankings.length === 0 || !validatedAverages) {
      return null;
    }
    if (isLoadingCriteria) return null;

    // Agrupar ads por pack
    const adsByPack = new Map<string, any[]>();
    validatedRankings.forEach((ad: any) => {
      const packId = getRankingPackId(ad);
      if (packId) {
        const packAds = adsByPack.get(packId) || [];
        packAds.push(ad);
        adsByPack.set(packId, packAds);
      }
    });

    // Calcular oportunidades para cada pack
    const rowsByPack = new Map<string, any[]>();
    adsByPack.forEach((packAds, packId) => {
      if (packAds.length === 0) return;
      const spendTotal = packAds.reduce((s: number, a: any) => s + Number(a.spend || 0), 0);
      // Usar actionType específico do pack, ou fallback para o global
      const packActionType = packActionTypes[packId] || actionType;
      const rows = computeOpportunityScores({
        ads: packAds,
        averages: validatedAverages,
        actionType: packActionType,
        spendTotal,
        limit: 10,
      });
      if (rows.length > 0) {
        rowsByPack.set(packId, rows);
      }
    });

    return rowsByPack;
  }, [groupByPacks, filteredRankings, averages, actionType, validationCriteria, isLoadingCriteria, getRankingPackId, packActionTypes]);

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
    <div className="space-y-12">
      {/* Seção Oportunidades */}
      <div className="space-y-6">
        <PageSectionHeader
          title="Oportunidades"
          description="Insights acionáveis para alavancar seus anúncios"
          actions={
            <>
              {/* Toggle Agrupar por Packs */}
              {packsClient && packs.length > 0 && selectedPackIds.size > 0 && <ToggleSwitch id="group-by-packs" checked={groupByPacks} onCheckedChange={handleToggleGroupByPacks} label="Agrupar por Packs" />}
              <FiltersDropdown dateRange={dateRange} onDateRangeChange={handleDateRangeChange} actionType={actionType} onActionTypeChange={handleActionTypeChange} actionTypeOptions={uniqueConversionTypes} packs={packs} selectedPackIds={selectedPackIds} onTogglePack={handleTogglePack} packsClient={packsClient} usePackDates={usePackDates} onUsePackDatesChange={handleUsePackDatesChange} />
            </>
          }
        />

        {/* Cards de Oportunidades */}
        {groupByPacks && opportunityRowsByPack ? (
          // Renderizar um slider para cada pack
          Array.from(opportunityRowsByPack.entries())
            .filter(([packId, rows]) => {
              const pack = packs.find((p) => p.id === packId);
              return pack && rows.length > 0;
            })
            .map(([packId, rows]) => {
              const pack = packs.find((p) => p.id === packId);
              if (!pack) return null;
              // Usar actionType específico do pack, ou fallback para o global
              const packActionType = packActionTypes[packId] || actionType;

              const handlePackActionTypeChange = (value: string) => {
                const newPackActionTypes = { ...packActionTypes, [packId]: value };
                setPackActionTypes(newPackActionTypes);
                try {
                  localStorage.setItem(STORAGE_KEY_PACK_ACTION_TYPES, JSON.stringify(newPackActionTypes));
                } catch (e) {
                  console.error("Erro ao salvar packActionTypes no localStorage:", e);
                }
              };

              // Função para formatar data de YYYY-MM-DD para DD/MM/YYYY
              const formatDate = (dateStr: string): string => {
                if (!dateStr) return "";
                const [year, month, day] = dateStr.split("-");
                return `${day}/${month}/${year}`;
              };

              return (
                <div key={packId} className="space-y-2">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                      <h2 className="text-xl font-semibold">{pack.name}</h2>
                      {pack.date_start && pack.date_stop && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {formatDate(pack.date_start)} - {formatDate(pack.date_stop)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <label className="text-sm font-medium text-foreground whitespace-nowrap">Evento de Conversão:</label>
                      <div style={{ width: "200px" }}>
                        <ActionTypeFilter label="" value={packActionType} onChange={handlePackActionTypeChange} options={uniqueConversionTypes} className="w-full" />
                      </div>
                    </div>
                  </div>
                  <OpportunityCards rows={rows} averages={averages} actionType={packActionType} onAdClick={handleOpportunityCardClick} globalMetricRanks={globalMetricRanks} />
                </div>
              );
            })
        ) : opportunityRows.length > 0 ? (
          // Renderizar slider único (comportamento atual)
          <div>
            <OpportunityCards rows={opportunityRows} averages={averages} actionType={actionType} onAdClick={handleOpportunityCardClick} globalMetricRanks={globalMetricRanks} />

            {/* Debug: Métricas médias */}
            {averages && (
              <div className="mt-4 p-3 bg-muted rounded text-xs space-y-1">
                <div className="font-semibold mb-2">Médias (Debug):</div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                  <div>Hook: {((averages.hook || 0) * 100).toFixed(1)}%</div>
                  <div>CTR: {((averages.website_ctr || 0) * 100).toFixed(2)}%</div>
                  <div>Connect: {((averages.connect_rate || 0) * 100).toFixed(1)}%</div>
                  <div>Page: {((averages.per_action_type?.[actionType]?.page_conv || 0) * 100).toFixed(1)}%</div>
                  <div>CPR: R$ {(averages.per_action_type?.[actionType]?.cpr || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div>CPM: R$ {(averages.cpm || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Seção Gems - Top Anúncios Validados */}
      <div className="space-y-6">
        <PageSectionHeader
          title="Gems"
          description="Assets para potencializar seus anúncios"
          icon={<IconSparkles className="w-5 h-5 text-yellow-500" />}
          actions={
            <>
              <div className="flex items-center gap-2 p-2 bg-card border border-border rounded-md">
                <Switch id="gems-compact" checked={isGemsCompact} onCheckedChange={handleToggleGemsCompact} />
                <label htmlFor="gems-compact" className="text-sm font-medium cursor-pointer">
                  Compacto
                </label>
              </div>
              <GemsColumnFilter activeColumns={activeGemsColumns} onToggleColumn={handleToggleGemsColumn} />
            </>
          }
        />
        {validationCriteria && validationCriteria.length > 0 && !isLoadingCriteria && validatedAverages && <GemsWidget ads={filteredRankings} averages={validatedAverages} actionType={actionType} validationCriteria={validationCriteria} limit={5} dateStart={dateRange.start} dateStop={dateRange.end} availableConversionTypes={uniqueConversionTypes} isCompact={isGemsCompact} activeColumns={activeGemsColumns} />}
      </div>

      {/* Seção Insights - Kanban */}
      <div className="space-y-6">
        <PageSectionHeader title="Insights" description="" />
        {validationCriteria && validationCriteria.length > 0 && !isLoadingCriteria && validatedAverages && <InsightsKanbanWidget ads={filteredRankings} averages={validatedAverages} actionType={actionType} validationCriteria={validationCriteria} dateStart={dateRange.start} dateStop={dateRange.end} availableConversionTypes={uniqueConversionTypes} />}
      </div>

      {/* Modal com detalhes do anúncio */}
      <Modal
        isOpen={!!selectedAd}
        onClose={() => {
          setSelectedAd(null);
          setOpenInVideoTab(false);
        }}
        size="4xl"
        padding="md"
      >
        {selectedAd && (
          <AdDetailsDialog
            ad={selectedAd}
            groupByAdName={true}
            dateStart={dateRange.start}
            dateStop={dateRange.end}
            actionType={actionType}
            availableConversionTypes={uniqueConversionTypes}
            initialTab={openInVideoTab ? "video" : "overview"}
            averages={
              averages
                ? {
                    hook: averages.hook ?? null,
                    scroll_stop: averages.scroll_stop ?? null,
                    ctr: averages.ctr ?? null,
                    website_ctr: averages.website_ctr ?? null,
                    connect_rate: averages.connect_rate ?? null,
                    cpm: averages.cpm ?? null,
                    cpr: actionType && averages.per_action_type?.[actionType] && typeof averages.per_action_type[actionType].cpr === "number" ? averages.per_action_type[actionType].cpr : null,
                    page_conv: actionType && averages.per_action_type?.[actionType] && typeof averages.per_action_type[actionType].page_conv === "number" ? averages.per_action_type[actionType].page_conv : null,
                  }
                : undefined
            }
          />
        )}
      </Modal>
    </div>
  );
}

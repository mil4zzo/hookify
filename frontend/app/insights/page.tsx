"use client";

import { useState, useEffect, useMemo } from "react";
import { LoadingState, EmptyState } from "@/components/common/States";
import { useClientPacks } from "@/lib/hooks/useClientSession";
import { usePacksAds } from "@/lib/hooks/usePacksAds";
import { OpportunityWidget } from "@/components/insights/OpportunityWidget";
import { calculateGlobalMetricRanks, createEmptyMetricRanks } from "@/lib/utils/metricRankings";
import { FiltersDropdown } from "@/components/common/FiltersDropdown";
import { GemsWidget } from "@/components/insights/GemsWidget";
import { GemsColumnFilter, GemsColumnType } from "@/components/common/GemsColumnFilter";
import { InsightsKanbanWidget } from "@/components/insights/InsightsKanbanWidget";
import { api } from "@/lib/api/endpoints";
import { AdPerformanceRequest, AdPerformanceResponse, RankingsItem } from "@/lib/api/schemas";
import { computeOpportunityScores, OpportunityRow } from "@/lib/utils/opportunity";
import { useValidationCriteria } from "@/lib/hooks/useValidationCriteria";
import { evaluateValidationCriteria, AdMetricsData } from "@/lib/utils/validateAdCriteria";
import { computeValidatedAveragesFromAdPerformance } from "@/lib/utils/validatedAverages";
import { formatDateLocal } from "@/lib/utils/dateFilters";
import { ActionTypeFilter } from "@/components/common/ActionTypeFilter";
import { IconSparkles, IconDiamond, IconSunFilled, IconStarFilled } from "@tabler/icons-react";
import { Modal } from "@/components/common/Modal";
import { AdDetailsDialog } from "@/components/ads/AdDetailsDialog";
import { useMqlLeadscore } from "@/lib/hooks/useMqlLeadscore";
import { PageContainer } from "@/components/common/PageContainer";
import { computeTopMetric, GemsTopItem } from "@/lib/utils/gemsTopMetrics";
import { useAppAuthReady } from "@/lib/hooks/useAppAuthReady";
import { Skeleton } from "@/components/ui/skeleton";
import { HookifyWidget } from "@/components/common/HookifyWidget";
import { TabbedContent, TabbedContentItem, type TabItem } from "@/components/common/TabbedContent";

// Insights e Manager compartilham a mesma base de Ad Performance retornada
// pelo endpoint `/analytics/ad-performance` (histórico `/analytics/rankings`).
// Aqui usamos esse snapshot para derivar oportunidades, Gems e Kanban.
// Chaves compartilhadas entre Insights e Manager
const STORAGE_KEY_PACKS = "hookify-selected-packs";
const STORAGE_KEY_ACTION_TYPE = "hookify-action-type";
const STORAGE_KEY_DATE_RANGE = "hookify-date-range";
const STORAGE_KEY_USE_PACK_DATES = "hookify-use-pack-dates";

// Chaves específicas do Insights
const STORAGE_KEY_GROUP_BY_PACKS = "hookify-insights-group-by-packs";
const STORAGE_KEY_PACK_ACTION_TYPES = "hookify-insights-pack-action-types";
const STORAGE_KEY_GEMS_COLUMNS = "hookify-insights-gems-columns";
const STORAGE_KEY_ACTIVE_TAB = "hookify-insights-active-tab";

// Classe padronizada para títulos das tabs
const TAB_TITLE_CLASS = "text-xl font-normal";

// Títulos das tabs para tooltips
const TAB_TITLES = {
  opportunities: "Melhorias para maximizar seus lucros",
  insights: "Melhorias pontuais por métrica",
  gems: "Os melhores de cada métrica",
} as const;

// Configuração do header para cada tab
const TAB_HEADER_CONFIG = {
  opportunities: {
    icon: IconStarFilled,
    title: "Oportunidades",
    description: "Melhorias para maximizar seus lucros, ordenada por maior impacto.",
  },
  insights: {
    icon: IconSunFilled,
    title: "Insights",
    description: "Melhorias acionáveis por métrica.",
  },
  gems: {
    icon: IconDiamond,
    title: "Gems",
    description: "Os melhores de cada métrica.",
  },
} as const;

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
    // Primeiro tentar carregar da chave compartilhada
    let saved = localStorage.getItem(STORAGE_KEY_PACKS);
    
    // Se não existir, tentar migrar das chaves antigas (insights ou manager)
    if (!saved) {
      const insightsKey = "hookify-insights-selected-packs";
      const managerKey = "hookify-manager-selected-packs";
      const insightsSaved = localStorage.getItem(insightsKey);
      const managerSaved = localStorage.getItem(managerKey);

      // Priorizar insights, depois manager
      if (insightsSaved) {
        saved = insightsSaved;
        // Migrar para chave compartilhada
        localStorage.setItem(STORAGE_KEY_PACKS, insightsSaved);
        // Opcional: remover chave antiga após migração
        localStorage.removeItem(insightsKey);
      } else if (managerSaved) {
        saved = managerSaved;
        // Migrar para chave compartilhada
        localStorage.setItem(STORAGE_KEY_PACKS, managerSaved);
        // Opcional: remover chave antiga após migração
        localStorage.removeItem(managerKey);
      }
    }
    
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
    // Primeiro tentar carregar da chave compartilhada
    let saved = localStorage.getItem(STORAGE_KEY_DATE_RANGE);
    
    // Se não existir, tentar migrar das chaves antigas (insights ou manager)
    if (!saved) {
      const insightsKey = "hookify-insights-date-range";
      const managerKey = "hookify-manager-date-range";
      const insightsSaved = localStorage.getItem(insightsKey);
      const managerSaved = localStorage.getItem(managerKey);

      // Priorizar insights, depois manager
      if (insightsSaved) {
        saved = insightsSaved;
        localStorage.setItem(STORAGE_KEY_DATE_RANGE, insightsSaved);
        localStorage.removeItem(insightsKey);
      } else if (managerSaved) {
        saved = managerSaved;
        localStorage.setItem(STORAGE_KEY_DATE_RANGE, managerSaved);
        localStorage.removeItem(managerKey);
      }
    }
    
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
    // Por padrão, todas as 6 colunas são ativas
    return new Set<GemsColumnType>(["hook", "website_ctr", "ctr", "page_conv", "hold_rate", "cpr"]);
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY_GEMS_COLUMNS);
    if (!saved) {
      // Por padrão, todas as 6 colunas são ativas
      return new Set<GemsColumnType>(["hook", "website_ctr", "ctr", "page_conv", "hold_rate", "cpr"]);
    }
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) {
      const validColumns = parsed.filter((col) => ["hook", "website_ctr", "ctr", "page_conv", "hold_rate", "cpr"].includes(col));
      // Se não houver colunas válidas, retornar todas por padrão
      if (validColumns.length === 0) {
        return new Set<GemsColumnType>(["hook", "website_ctr", "ctr", "page_conv", "hold_rate", "cpr"]);
      }
      return new Set<GemsColumnType>(validColumns as GemsColumnType[]);
    }
    // Por padrão, todas as 6 colunas são ativas
    return new Set<GemsColumnType>(["hook", "website_ctr", "ctr", "page_conv", "hold_rate", "cpr"]);
  } catch (e) {
    console.error("Erro ao carregar colunas de Gems do localStorage:", e);
    // Por padrão, todas as 6 colunas são ativas
    return new Set<GemsColumnType>(["hook", "website_ctr", "ctr", "page_conv", "hold_rate", "cpr"]);
  }
};

export default function InsightsPage() {
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
      // Primeiro tentar carregar da chave compartilhada
      let saved = localStorage.getItem(STORAGE_KEY_USE_PACK_DATES);
      
      // Se não existir, tentar migrar das chaves antigas
      if (!saved) {
        const insightsKey = "hookify-insights-use-pack-dates";
        const managerKey = "hookify-manager-use-pack-dates";
        const insightsSaved = localStorage.getItem(insightsKey);
        const managerSaved = localStorage.getItem(managerKey);

        // Priorizar insights, depois manager
        if (insightsSaved) {
          saved = insightsSaved;
          localStorage.setItem(STORAGE_KEY_USE_PACK_DATES, insightsSaved);
          localStorage.removeItem(insightsKey);
        } else if (managerSaved) {
          saved = managerSaved;
          localStorage.setItem(STORAGE_KEY_USE_PACK_DATES, managerSaved);
          localStorage.removeItem(managerKey);
        }
      }
      
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
  // Estado para controlar a tab ativa
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (typeof window === "undefined") return "opportunities";
    try {
      const saved = localStorage.getItem(STORAGE_KEY_ACTIVE_TAB);
      return saved || "opportunities";
    } catch (e) {
      console.error("Erro ao carregar activeTab do localStorage:", e);
      return "opportunities";
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

  // Função para calcular dateRange dos packs selecionados
  const calculateDateRangeFromPacks = useMemo(() => {
    if (selectedPackIds.size === 0) return null;

    const selectedPacks = packs.filter((p) => selectedPackIds.has(p.id));
    if (selectedPacks.length === 0) return null;

    // Se apenas 1 pack está selecionado, usar suas datas diretamente
    if (selectedPacks.length === 1) {
      const pack = selectedPacks[0];
      if (pack.date_start && pack.date_stop) {
        return { start: pack.date_start, end: pack.date_stop };
      }
      return null;
    }

    // Se 2 ou mais packs estão selecionados, usar menor since e maior until
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
    // Permitir mudança mesmo quando usePackDates estiver ativo, pois o usuário pode estar confirmando as datas dos packs
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
    // Não aplicar datas automaticamente - apenas selecionar no calendário e aguardar confirmação
  };

  // Aplicar dateRange automaticamente quando packs são selecionados/deselecionados
  // e usePackDates está ativo (sem necessidade de confirmação do usuário)
  useEffect(() => {
    // Só aplicar automaticamente se usePackDates estiver ativo
    if (!usePackDates) return;
    
    // Só aplicar se calculateDateRangeFromPacks retornar um valor válido
    if (!calculateDateRangeFromPacks) return;
    
    // Só aplicar se o dateRange calculado for diferente do atual
    // (evita loops infinitos e aplicações desnecessárias)
    if (
      dateRange.start === calculateDateRangeFromPacks.start &&
      dateRange.end === calculateDateRangeFromPacks.end
    ) {
      return;
    }
    
    // Aplicar automaticamente o novo dateRange
    setDateRange(calculateDateRangeFromPacks);
    saveDateRange(calculateDateRangeFromPacks);
  }, [usePackDates, selectedPackIds, calculateDateRangeFromPacks]); // Monitora mudanças em selectedPackIds (quando packs são selecionados/deselecionados)

  useEffect(() => {
    // Só dispara busca quando o app estiver autorizado (client + auth ok)
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
        // LOG TEMPORÁRIO PARA DEBUG
        console.log("[INSIGHTS DEBUG] Resposta recebida:", {
          hasData: !!res.data,
          dataLength: res.data?.length || 0,
          firstItem: res.data?.[0],
          availableConversionTypes: res.available_conversion_types,
          hasAverages: !!res.averages,
          fullResponse: res,
        });

        setServerData(res.data || []);
        setAvailableConversionTypes(res.available_conversion_types || []);
        setAverages(res.averages);
      })
      .catch((err) => {
        console.error("Erro ao buscar insights:", err);
        // LOG TEMPORÁRIO PARA DEBUG
        console.error("[INSIGHTS DEBUG] Erro completo:", {
          message: err.message,
          status: err.status,
          response: err.response,
          stack: err.stack,
        });
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

    // Se todos os packs selecionados foram deletados mas há packs disponíveis, selecionar automaticamente o primeiro
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

  // Buscar ads dos packs selecionados usando cache
  const selectedPacks = packs.filter((p) => selectedPackIds.has(p.id));
  const { packsAdsMap } = usePacksAds(selectedPacks);

  const isAdInSelectedPacks = useMemo(() => {
    return (ad: any): boolean => {
      if (selectedPackIds.size === 0) return false;

      if (selectedPacks.length === 0) return false;

      for (const pack of selectedPacks) {
        const packAds = packsAdsMap.get(pack.id) || [];
        if (packAds.length === 0) continue;

        const matches = packAds.some((packAd: any) => {
          const adId = ad.ad_id;
          const adName = ad.ad_name;
          const adAccountId = ad.account_id;

          const packAdId = packAd.ad_id;
          const packAdName = packAd.ad_name;
          const packAdAccountId = packAd.account_id;

          if (adAccountId && packAdAccountId) {
            if (String(adAccountId).trim() !== String(packAdAccountId).trim()) {
              return false;
            }
          }

          if (adId && packAdId) {
            if (String(adId).trim() === String(packAdId).trim()) {
              return true;
            }
          }

          if (adName && packAdName) {
            if (String(adName).trim() === String(packAdName).trim()) {
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

  // Handler para mudança de tab
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    try {
      localStorage.setItem(STORAGE_KEY_ACTIVE_TAB, value);
    } catch (e) {
      console.error("Erro ao salvar activeTab no localStorage:", e);
    }
  };

  // Função para identificar qual pack pertence um anúncio
  const getAdPackId = useMemo(() => {
    return (ad: any): string | null => {
      if (selectedPackIds.size === 0) return null;
      if (selectedPacks.length === 0) return null;

      for (const pack of selectedPacks) {
        const packAds = packsAdsMap.get(pack.id) || [];
        if (packAds.length === 0) continue;

        const matches = packAds.some((packAd: any) => {
          const adId = ad.ad_id;
          const adName = ad.ad_name;
          const adAccountId = ad.account_id;

          const packAdId = packAd.ad_id;
          const packAdName = packAd.ad_name;
          const packAdAccountId = packAd.account_id;

          if (adAccountId && packAdAccountId) {
            if (String(adAccountId).trim() !== String(packAdAccountId).trim()) {
              return false;
            }
          }

          if (adId && packAdId) {
            if (String(adId).trim() === String(packAdId).trim()) {
              return true;
            }
          }

          if (adName && packAdName) {
            if (String(adName).trim() === String(packAdName).trim()) {
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
  const filteredAds = useMemo(() => {
    if (!serverData) return [];
    return serverData.filter((row: any) => isAdInSelectedPacks(row));
  }, [serverData, isAdInSelectedPacks]);

  // Critérios de validação globais configurados pelo usuário
  const { criteria: validationCriteria, isLoading: isLoadingCriteria } = useValidationCriteria();

  // Conjunto de anúncios que passam pelos critérios de validação globais (independente do widget)
  const [validatedAds, validatedAverages] = useMemo(() => {
    if (!filteredAds || filteredAds.length === 0) {
      return [[], undefined] as [any[], any];
    }

    // Enquanto critérios ainda não carregaram, considerar todos como validados
    if (!validationCriteria || validationCriteria.length === 0) {
      const averagesFromAll = computeValidatedAveragesFromAdPerformance(filteredAds as any, actionType, uniqueConversionTypes);
      return [filteredAds, averagesFromAll] as [any[], any];
    }

    const validated = filteredAds.filter((ad: any) => {
      const impressions = Number(ad.impressions || 0);
      const spend = Number(ad.spend || 0);
      // CPM: priorizar valor do backend, senão calcular
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
  }, [filteredAds, validationCriteria, actionType, uniqueConversionTypes]);

  // Top 5 de cada métrica reaproveitando a mesma lógica de Gems, usando apenas anúncios já validados
  const topHookFromGems: GemsTopItem[] = useMemo(() => {
    if (!validatedAds || validatedAds.length === 0) return [];
    if (!actionType) return [];
    return computeTopMetric(validatedAds as RankingsItem[], "hook", actionType, 5);
  }, [validatedAds, actionType]);

  const topWebsiteCtrFromGems: GemsTopItem[] = useMemo(() => {
    if (!validatedAds || validatedAds.length === 0) return [];
    if (!actionType) return [];
    return computeTopMetric(validatedAds as RankingsItem[], "website_ctr", actionType, 5);
  }, [validatedAds, actionType]);

  const topCtrFromGems: GemsTopItem[] = useMemo(() => {
    if (!validatedAds || validatedAds.length === 0) return [];
    if (!actionType) return [];
    return computeTopMetric(validatedAds as RankingsItem[], "ctr", actionType, 5);
  }, [validatedAds, actionType]);

  const topPageConvFromGems: GemsTopItem[] = useMemo(() => {
    if (!validatedAds || validatedAds.length === 0) return [];
    if (!actionType) return [];
    return computeTopMetric(validatedAds as RankingsItem[], "page_conv", actionType, 5);
  }, [validatedAds, actionType]);

  const topHoldRateFromGems: GemsTopItem[] = useMemo(() => {
    if (!validatedAds || validatedAds.length === 0) return [];
    if (!actionType) return [];
    return computeTopMetric(validatedAds as RankingsItem[], "hold_rate", actionType, 5);
  }, [validatedAds, actionType]);

  // Função para encontrar o anúncio original baseado no OpportunityRow
  const findAdFromOpportunityRow = useMemo(() => {
    return (row: OpportunityRow): RankingsItem | null => {
      if (!filteredAds || filteredAds.length === 0) return null;

      // Tentar encontrar por ad_id primeiro
      if (row.ad_id) {
        const foundById = filteredAds.find((ad: any) => {
          const adId = String(ad.ad_id || "").trim();
          const rowAdId = String(row.ad_id || "").trim();
          return adId && rowAdId && adId === rowAdId;
        });
        if (foundById) return foundById as RankingsItem;
      }

      // Tentar encontrar por ad_name
      if (row.ad_name) {
        const foundByName = filteredAds.find((ad: any) => {
          const adName = String(ad.ad_name || "").trim();
          const rowAdName = String(row.ad_name || "").trim();
          return adName && rowAdName && adName === rowAdName;
        });
        if (foundByName) return foundByName as RankingsItem;
      }

      return null;
    };
  }, [filteredAds]);

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
    if (!validatedAds || validatedAds.length === 0 || !validatedAverages) return [];
    if (isLoadingCriteria) return [];

    const eligibleAds = validatedAds;
    const spendTotal = eligibleAds.reduce((s: number, a: any) => s + Number(a.spend || 0), 0);
    return computeOpportunityScores({
      ads: eligibleAds,
      averages: validatedAverages,
      actionType,
      spendTotal,
      mqlLeadscoreMin,
      limit: 10,
    });
  }, [validatedAds, validatedAverages, actionType, isLoadingCriteria, mqlLeadscoreMin]);

  // Calcular rankings globais de métricas (para medalhas TOP 3)
  // IMPORTANTE: Os rankings são calculados apenas com anúncios que passam pelos critérios de validação
  // Se não houver critérios definidos (array vazio ou undefined), todos os anúncios são considerados
  const globalMetricRanks = useMemo(() => {
    if (!filteredAds || filteredAds.length === 0) {
      return createEmptyMetricRanks();
    }
    // Passar validationCriteria apenas se houver critérios definidos (array não vazio)
    // Array vazio ou undefined significa "sem critérios" (todos os anúncios são válidos)
    const criteriaToUse = validationCriteria && validationCriteria.length > 0 ? validationCriteria : undefined;
    return calculateGlobalMetricRanks(filteredAds, {
      validationCriteria: criteriaToUse,
      actionType,
      filterValidOnly: true,
      mqlLeadscoreMin,
    });
  }, [filteredAds, validationCriteria, actionType, mqlLeadscoreMin]);

  // Agrupar oportunidades por pack quando groupByPacks estiver ativo
  const opportunityRowsByPack = useMemo(() => {
    if (!groupByPacks || !validatedAds || validatedAds.length === 0 || !validatedAverages) {
      return null;
    }
    if (isLoadingCriteria) return null;

    // Agrupar ads por pack
    const adsByPack = new Map<string, any[]>();
    validatedAds.forEach((ad: any) => {
      const packId = getAdPackId(ad);
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
  }, [groupByPacks, filteredAds, averages, actionType, validationCriteria, isLoadingCriteria, getAdPackId, packActionTypes]);

  // Configuração dinâmica do header baseada na tab ativa
  const headerConfig = useMemo(() => {
    const config = TAB_HEADER_CONFIG[activeTab as keyof typeof TAB_HEADER_CONFIG];
    if (!config) {
      // Fallback para opportunities caso a tab não seja reconhecida
      return TAB_HEADER_CONFIG.opportunities;
    }
    return config;
  }, [activeTab]);

  if (!isClient) {
    return (
      <div>
        <LoadingState label="Carregando..." />
      </div>
    );
  }

  if (authStatus !== "authorized") {
    return (
      <div>
        <LoadingState label="Redirecionando para login..." />
      </div>
    );
  }

  if (onboardingStatus === "requires_onboarding") {
    return (
      <div>
        <LoadingState label="Redirecionando para configuração inicial..." />
      </div>
    );
  }

  const hasData = serverData && serverData.length > 0;

  // Detectar se é primeiro carregamento ou recarregamento
  const isInitialLoad = serverData === null && loading;
  const isLoadingData = loading;

  // Componentes de Skeleton para cada tab
  const OpportunitiesSkeleton = () => (
    <div className="space-y-6">
      {/* Skeleton para slider horizontal de cards */}
      <div className="relative">
        <div className="flex gap-4 overflow-hidden">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-80 w-80 flex-shrink-0 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );

  const InsightsSkeleton = () => (
    <div className="space-y-6">
      {/* Skeleton para kanban com múltiplas colunas */}
      <div className="flex gap-4 overflow-x-auto">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex-shrink-0 w-80 space-y-4">
            <Skeleton className="h-12 w-full rounded-md" />
            <div className="space-y-2">
              {[1, 2, 3].map((j) => (
                <Skeleton key={j} className="h-32 w-full rounded-md" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const GemsSkeleton = () => (
    <div className="space-y-6">
      {/* Skeleton para filtro de colunas */}
      <div className="flex items-center justify-end gap-4 mb-4">
        <Skeleton className="h-10 w-48 rounded-md" />
      </div>
      {/* Skeleton para grid de gems */}
      <div className="flex gap-4 overflow-x-auto">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex-shrink-0 w-80 space-y-4">
            <Skeleton className="h-12 w-full rounded-md" />
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((j) => (
                <Skeleton key={j} className="h-32 w-full rounded-md" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <PageContainer
      title={headerConfig.title}
      description={headerConfig.description}
      actions={
        <FiltersDropdown
          expanded={true}
          dateRange={dateRange}
          onDateRangeChange={handleDateRangeChange}
          actionType={actionType}
          onActionTypeChange={handleActionTypeChange}
          actionTypeOptions={uniqueConversionTypes}
          packs={packs}
          selectedPackIds={selectedPackIds}
          onTogglePack={handleTogglePack}
          packsClient={packsClient}
          usePackDates={usePackDates}
          onUsePackDatesChange={handleUsePackDatesChange}
          packDatesRange={calculateDateRangeFromPacks ?? null}
          groupByPacks={activeTab === "opportunities" ? groupByPacks : false}
          onGroupByPacksChange={activeTab === "opportunities" ? handleToggleGroupByPacks : undefined}
        />
      }
    >
      {/* Tabs */}
      <TabbedContent
        value={activeTab}
        onValueChange={handleTabChange}
        variant="with-icons"
        showTooltips={true}
        tabs={[
          {
            value: "opportunities",
            label: "Oportunidades",
            icon: IconStarFilled,
            tooltip: TAB_TITLES.opportunities,
          },
          {
            value: "insights",
            label: "Insights",
            icon: IconSparkles,
            tooltip: TAB_TITLES.insights,
          },
          {
            value: "gems",
            label: "Gems",
            icon: IconDiamond,
            tooltip: TAB_TITLES.gems,
          },
        ]}
      >
        {/* Tab Oportunidades */}
        <TabbedContentItem value="opportunities" variant="with-icons">
          <HookifyWidget
            title={TAB_TITLES.opportunities}
            titleClassName={TAB_TITLE_CLASS}
            isLoading={isLoadingData || isInitialLoad}
            isEmpty={!hasData}
            emptyMessage="Sem dados no período selecionado. Ajuste os filtros acima para buscar em outro período."
            skeleton={<OpportunitiesSkeleton />}
            contentSpacing="space-y-6"
          >
            {/* Cards de Oportunidades */}
            {groupByPacks && opportunityRowsByPack ? (
              // Renderizar um slider para cada pack
              Array.from(opportunityRowsByPack.entries()).length > 0 ? (
                Array.from(opportunityRowsByPack.entries())
                  .filter(([packId, rows]) => {
                    const pack = packs.find((p) => p.id === packId);
                    return pack; // Removido filtro de rows.length > 0 para permitir empty state
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
                          <div className="flex-1 flex flex-row gap-4">
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
                        <OpportunityWidget rows={rows} averages={validatedAverages} actionType={packActionType} onAdClick={handleOpportunityCardClick} globalMetricRanks={globalMetricRanks} gemsTopHook={topHookFromGems} gemsTopWebsiteCtr={topWebsiteCtrFromGems} gemsTopCtr={topCtrFromGems} gemsTopPageConv={topPageConvFromGems} gemsTopHoldRate={topHoldRateFromGems} />
                      </div>
                    );
                  })
              ) : (
                // Quando agrupado por packs mas nenhum pack tem oportunidades, mostrar empty state
                <div>
                  <OpportunityWidget rows={[]} averages={validatedAverages} actionType={actionType} onAdClick={handleOpportunityCardClick} globalMetricRanks={globalMetricRanks} gemsTopHook={topHookFromGems} gemsTopWebsiteCtr={topWebsiteCtrFromGems} gemsTopCtr={topCtrFromGems} gemsTopPageConv={topPageConvFromGems} gemsTopHoldRate={topHoldRateFromGems} />
                </div>
              )
            ) : (
              // Renderizar slider único (comportamento atual)
              // Sempre renderizar o widget para permitir empty state quando não houver dados
              <div>
                <OpportunityWidget rows={opportunityRows} averages={validatedAverages} actionType={actionType} onAdClick={handleOpportunityCardClick} globalMetricRanks={globalMetricRanks} gemsTopHook={topHookFromGems} gemsTopWebsiteCtr={topWebsiteCtrFromGems} gemsTopCtr={topCtrFromGems} gemsTopPageConv={topPageConvFromGems} gemsTopHoldRate={topHoldRateFromGems} />
              </div>
            )}
          </HookifyWidget>
        </TabbedContentItem>

        {/* Tab Insights */}
        <TabbedContentItem value="insights" variant="with-icons">
          <HookifyWidget
            title={TAB_TITLES.insights}
            titleClassName={TAB_TITLE_CLASS}
            isLoading={isLoadingData || isInitialLoad}
            isEmpty={!hasData}
            emptyMessage="Sem dados no período selecionado. Ajuste os filtros acima para buscar em outro período."
            skeleton={<InsightsSkeleton />}
            contentSpacing="space-y-6"
          >
            {validationCriteria && validationCriteria.length > 0 && !isLoadingCriteria && validatedAverages ? (
              <InsightsKanbanWidget ads={validatedAds} averages={validatedAverages} actionType={actionType} validationCriteria={validationCriteria} dateStart={dateRange.start} dateStop={dateRange.end} availableConversionTypes={uniqueConversionTypes} />
            ) : (
              <div className="py-12">
                <EmptyState message="Configure critérios de validação nas configurações para ver insights." />
              </div>
            )}
          </HookifyWidget>
        </TabbedContentItem>

        {/* Tab Gems */}
        <TabbedContentItem value="gems" variant="with-icons">
          <HookifyWidget
            title={TAB_TITLES.gems}
            titleClassName={TAB_TITLE_CLASS}
            isLoading={isLoadingData || isInitialLoad}
            isEmpty={!hasData}
            emptyMessage="Sem dados no período selecionado. Ajuste os filtros acima para buscar em outro período."
            skeleton={<GemsSkeleton />}
            headerActions={<GemsColumnFilter activeColumns={activeGemsColumns} onToggleColumn={handleToggleGemsColumn} />}
            contentSpacing="space-y-6"
          >
            {validationCriteria && validationCriteria.length > 0 && !isLoadingCriteria && validatedAverages ? (
              <GemsWidget ads={validatedAds} averages={validatedAverages} actionType={actionType} validationCriteria={validationCriteria} limit={5} dateStart={dateRange.start} dateStop={dateRange.end} availableConversionTypes={uniqueConversionTypes} activeColumns={activeGemsColumns} />
            ) : (
              <div className="py-12">
                <EmptyState message="Configure critérios de validação nas configurações para ver gems." />
              </div>
            )}
          </HookifyWidget>
        </TabbedContentItem>
      </TabbedContent>

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
    </PageContainer>
  );
}

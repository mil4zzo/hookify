"use client";

import { useMemo, useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { LoadingState, EmptyState } from "@/components/common/States";
import { useClientPacks } from "@/lib/hooks/useClientSession";
import { usePacksAds } from "@/lib/hooks/usePacksAds";
import { ManagerTable } from "@/components/manager/ManagerTable";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api/endpoints";
import { RankingsItem, RankingsRequest } from "@/lib/api/schemas";
import { formatDateLocal } from "@/lib/utils/dateFilters";
import { useAdPerformance, useAdPerformanceSeries } from "@/lib/api/hooks";
import { Skeleton } from "@/components/ui/skeleton";
import { useValidationCriteria } from "@/lib/hooks/useValidationCriteria";
import { useAppAuthReady } from "@/lib/hooks/useAppAuthReady";
import { evaluateValidationCriteria, AdMetricsData } from "@/lib/utils/validateAdCriteria";
import { computeValidatedAveragesFromAdPerformance } from "@/lib/utils/validatedAverages";
import { PageContainer } from "@/components/common/PageContainer";
import { FiltersDropdown } from "@/components/common/FiltersDropdown";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";
import { PageIcon } from "@/lib/utils/pageIcon";
import { logger } from "@/lib/utils/logger";

// Chaves compartilhadas entre Insights e Manager
const STORAGE_KEY_PACKS = "hookify-selected-packs";
const STORAGE_KEY_ACTION_TYPE = "hookify-action-type";
const STORAGE_KEY_DATE_RANGE = "hookify-date-range";
const STORAGE_KEY_USE_PACK_DATES = "hookify-use-pack-dates";

// Tipo para as preferências de packs no localStorage
// Estrutura: { [packId: string]: boolean } onde true = habilitado, false = desabilitado
type PackPreferences = Record<string, boolean>;
type ManagerRow = RankingsItem & { series_loading?: boolean };

// Funções auxiliares para gerenciar preferências de packs
const savePackPreferences = (prefs: PackPreferences) => {
  try {
    localStorage.setItem(STORAGE_KEY_PACKS, JSON.stringify(prefs));
  } catch (e) {
    logger.error("Erro ao salvar preferências de packs:", e);
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

    // Migração: se for um array (formato antigo), converter para o novo formato
    if (Array.isArray(parsed)) {
      const migrated: PackPreferences = {};
      parsed.forEach((packId: string) => {
        migrated[packId] = true; // Todos os packs do array antigo eram habilitados
      });
      // Salvar no novo formato
      savePackPreferences(migrated);
      return migrated;
    }

    // Se já está no formato objeto, retornar diretamente
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as PackPreferences;
    }

    return {};
  } catch (e) {
    logger.error("Erro ao carregar preferências de packs:", e);
    return {};
  }
};

// Funções auxiliares para gerenciar dateRange no localStorage
const saveDateRange = (dateRange: { start?: string; end?: string }) => {
  try {
    localStorage.setItem(STORAGE_KEY_DATE_RANGE, JSON.stringify(dateRange));
  } catch (e) {
    logger.error("Erro ao salvar dateRange no localStorage:", e);
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
    logger.error("Erro ao carregar dateRange do localStorage:", e);
    return null;
  }
};

function ManagerPageContent() {
  type ManagerTab = "individual" | "por-anuncio" | "por-conjunto" | "por-campanha";
  const searchParams = useSearchParams();
  const router = useRouter();
  const [activeManagerTab, setActiveManagerTab] = useState<ManagerTab>("por-anuncio");
  const { packs, isClient: packsClient } = useClientPacks();
  const { isClient, authStatus, onboardingStatus, isAuthorized } = useAppAuthReady();

  // Ler filtros iniciais dos query params (vindos da busca global)
  const initialFilters = useMemo(() => {
    const filter = searchParams.get("filter");
    const value = searchParams.get("value");
    const tab = searchParams.get("tab");

    if (filter && value && tab) {
      // Validar que o tab corresponde ao tipo de filtro
      const validTabMap: Record<string, ManagerTab> = {
        ad_id: "individual",
        ad_name: "por-anuncio",
        adset_name: "por-conjunto",
        campaign_name: "por-campanha",
      };

      const expectedTab = validTabMap[filter];
      if (expectedTab && expectedTab === tab) {
        // Navegar para a aba correta
        if (activeManagerTab !== expectedTab) {
          setActiveManagerTab(expectedTab);
        }

        // Retornar filtro inicial
        return [{ id: filter, value }];
      }
    }

    return undefined;
  }, [searchParams, activeManagerTab]);

  // Limpar query params após aplicar filtros (opcional - manter comentado por enquanto para debug)
  // useEffect(() => {
  //   if (initialFilters && initialFilters.length > 0) {
  //     const params = new URLSearchParams(searchParams.toString());
  //     params.delete("filter");
  //     params.delete("value");
  //     params.delete("tab");
  //     router.replace(`/manager?${params.toString()}`);
  //   }
  // }, [initialFilters, searchParams, router]);
  // Manager agora é sempre agrupado por nome (ad_name) sobre a mesma base
  // de Ad Performance consumida também pela página de Insights.
  const [actionType, setActionType] = useState<string>(() => {
    if (typeof window === "undefined") return "";

    // Carregar do localStorage se existir
    try {
      const saved = localStorage.getItem(STORAGE_KEY_ACTION_TYPE);
      if (saved) {
        return saved;
      }
    } catch (e) {
      logger.error("Erro ao carregar actionType do localStorage:", e);
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
  const [serverAverages, setServerAverages] = useState<any | null>(null);
  const { criteria: validationCriteria } = useValidationCriteria();
  const [showTrends, setShowTrends] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const saved = localStorage.getItem("hookify-manager-show-trends");
      return saved !== "false"; // padrão é true (tendências)
    } catch (e) {
      logger.error("Erro ao carregar showTrends do localStorage:", e);
      return true;
    }
  });

  // Estado dos packs selecionados - derivado das preferências (apenas packs habilitados)
  const [selectedPackIds, setSelectedPackIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    const prefs = loadPackPreferences();
    // Retornar apenas os packs habilitados
    return new Set(
      Object.entries(prefs)
        .filter(([_, enabled]) => enabled)
        .map(([id]) => id),
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
      logger.error("Erro ao carregar usePackDates do localStorage:", e);
      return false;
    }
  });

  // endDate = limite superior selecionado no filtro
  const endDate = useMemo(() => dateRange.end, [dateRange.end]);

  // Pré-computar hasSheetIntegration para uso nos requests (evitar enviar leadscore_values quando desnecessário)
  const hasSheetIntegration = useMemo(
    () => selectedPackIds.size > 0 && packs.some((p) => selectedPackIds.has(p.id) && !!p.sheet_integration),
    [packs, selectedPackIds],
  );

  // Usar hook semântico para buscar performance agregada de anúncios
  // Janela fixa de 5 dias para sparkline (carregamento sob demanda)
  const SERIES_WINDOW = 5;
  const MAX_SERIES_GROUP_KEYS = 100;

  const [visibleSeriesKeys, setVisibleSeriesKeys] = useState<Record<"individual" | "por-anuncio" | "por-conjunto" | "por-campanha", string[]>>({
    individual: [],
    "por-anuncio": [],
    "por-conjunto": [],
    "por-campanha": [],
  });
  const visibleKeysDebounceRef = useRef<Partial<Record<"individual" | "por-anuncio" | "por-conjunto" | "por-campanha", ReturnType<typeof setTimeout>>>>({});
  const [seriesCacheByTab, setSeriesCacheByTab] = useState<Record<"individual" | "por-anuncio" | "por-conjunto" | "por-campanha", Record<string, any>>>({
    individual: {},
    "por-anuncio": {},
    "por-conjunto": {},
    "por-campanha": {},
  });

  const selectedPackIdsKey = useMemo(() => Array.from(selectedPackIds).sort().join("|"), [selectedPackIds]);

  const mergeSeriesCache = useCallback((tab: "individual" | "por-anuncio" | "por-conjunto" | "por-campanha", incoming: any) => {
    if (!incoming || typeof incoming !== "object") return;
    const entries = Object.entries(incoming);
    if (entries.length === 0) return;
    setSeriesCacheByTab((prev) => {
      const current = prev[tab] || {};
      let changed = false;
      const nextTabMap: Record<string, any> = { ...current };
      for (const [k, v] of entries) {
        if (!k) continue;
        if (nextTabMap[k] !== v) {
          nextTabMap[k] = v;
          changed = true;
        }
      }
      if (!changed) return prev;
      return { ...prev, [tab]: nextTabMap };
    });
  }, []);

  const handleVisibleGroupKeysChange = useCallback(
    (tab: "individual" | "por-anuncio" | "por-conjunto" | "por-campanha", keys: string[]) => {
      const normalized = Array.from(new Set((keys || []).map(String).filter(Boolean))).slice(0, MAX_SERIES_GROUP_KEYS);
      const previousTimer = visibleKeysDebounceRef.current[tab];
      if (previousTimer) clearTimeout(previousTimer);
      visibleKeysDebounceRef.current[tab] = setTimeout(() => {
        setVisibleSeriesKeys((prev) => {
          const current = prev[tab] || [];
          if (current.length === normalized.length && current.every((k, i) => k === normalized[i])) {
            return prev;
          }
          return { ...prev, [tab]: normalized };
        });
      }, 120);
    },
    [],
  );

  useEffect(() => {
    return () => {
      const timers = visibleKeysDebounceRef.current;
      (Object.keys(timers) as Array<"individual" | "por-anuncio" | "por-conjunto" | "por-campanha">).forEach((tab) => {
        const timer = timers[tab];
        if (timer) clearTimeout(timer);
      });
    };
  }, []);

  useEffect(() => {
    setSeriesCacheByTab({
      individual: {},
      "por-anuncio": {},
      "por-conjunto": {},
      "por-campanha": {},
    });
  }, [dateRange.start, dateRange.end, actionType, selectedPackIdsKey]);

  const managerRequest: RankingsRequest = useMemo(
    () => ({
      date_start: dateRange.start || "",
      date_stop: dateRange.end || "",
      group_by: "ad_name",
      action_type: actionType || undefined,
      limit: 10000,
      offset: 0,
      filters: {},
      pack_ids: Array.from(selectedPackIds),
      include_series: false,
      include_leadscore: hasSheetIntegration,
      series_window: SERIES_WINDOW,
      include_available_conversion_types: true,
    }),
    [dateRange.start, dateRange.end, selectedPackIds, actionType, hasSheetIntegration],
  );

  const { data: managerData, isLoading: loading, error: managerError } = useAdPerformance(managerRequest, isAuthorized && !!dateRange.start && !!dateRange.end);

  // Request individual (por ad_id) - buscar sob demanda ao abrir a aba Individual
  const managerRequestIndividual: RankingsRequest = useMemo(
    () => ({
      date_start: dateRange.start || "",
      date_stop: dateRange.end || "",
      group_by: "ad_id",
      action_type: actionType || undefined,
      limit: 10000,
      offset: 0,
      filters: {},
      pack_ids: Array.from(selectedPackIds),
      include_series: false,
      include_leadscore: hasSheetIntegration,
      series_window: SERIES_WINDOW,
      include_available_conversion_types: false,
    }),
    [dateRange.start, dateRange.end, selectedPackIds, actionType, hasSheetIntegration],
  );

  const shouldFetchIndividual = isAuthorized && !!dateRange.start && !!dateRange.end && activeManagerTab === "individual";
  const { data: managerDataIndividual, isLoading: loadingIndividual } = useAdPerformance(managerRequestIndividual, shouldFetchIndividual);

  // Request por conjunto (por adset_id) - buscar sob demanda ao abrir a aba Por conjunto
  const managerRequestAdset: RankingsRequest = useMemo(
    () => ({
      date_start: dateRange.start || "",
      date_stop: dateRange.end || "",
      group_by: "adset_id",
      action_type: actionType || undefined,
      limit: 10000,
      offset: 0,
      filters: {},
      pack_ids: Array.from(selectedPackIds),
      include_series: false,
      include_leadscore: hasSheetIntegration,
      series_window: SERIES_WINDOW,
      include_available_conversion_types: false,
    }),
    [dateRange.start, dateRange.end, selectedPackIds, actionType, hasSheetIntegration],
  );

  const shouldFetchAdset = isAuthorized && !!dateRange.start && !!dateRange.end && activeManagerTab === "por-conjunto";
  const { data: managerDataAdset, isLoading: loadingAdset } = useAdPerformance(managerRequestAdset, shouldFetchAdset);

  // Request por campanha (por campaign_id) - buscar sob demanda ao abrir a aba Por campanha
  const managerRequestCampaign: RankingsRequest = useMemo(
    () => ({
      date_start: dateRange.start || "",
      date_stop: dateRange.end || "",
      group_by: "campaign_id",
      action_type: actionType || undefined,
      limit: 10000,
      offset: 0,
      filters: {},
      pack_ids: Array.from(selectedPackIds),
      include_series: false,
      include_leadscore: hasSheetIntegration,
      series_window: SERIES_WINDOW,
      include_available_conversion_types: false,
    }),
    [dateRange.start, dateRange.end, selectedPackIds, actionType, hasSheetIntegration],
  );

  const shouldFetchCampaign = isAuthorized && !!dateRange.start && !!dateRange.end && activeManagerTab === "por-campanha";
  const { data: managerDataCampaign, isLoading: loadingCampaign } = useAdPerformance(managerRequestCampaign, shouldFetchCampaign);

  // Extrair dados do response
  const serverData = managerData?.data || null;
  const serverDataIndividual = managerDataIndividual?.data || null;
  const serverDataAdset = managerDataAdset?.data || null;
  const serverDataCampaign = managerDataCampaign?.data || null;
  const availableConversionTypes = managerData?.available_conversion_types || [];

  const seriesKeysAdName = useMemo(() => visibleSeriesKeys["por-anuncio"], [visibleSeriesKeys]);
  const seriesKeysIndividual = useMemo(() => visibleSeriesKeys.individual, [visibleSeriesKeys]);
  const seriesKeysAdset = useMemo(() => visibleSeriesKeys["por-conjunto"], [visibleSeriesKeys]);
  const seriesKeysCampaign = useMemo(() => visibleSeriesKeys["por-campanha"], [visibleSeriesKeys]);

  const managerSeriesRequest = useMemo(
    () => ({
      date_start: dateRange.start || "",
      date_stop: dateRange.end || "",
      group_by: "ad_name" as const,
      action_type: actionType || undefined,
      pack_ids: Array.from(selectedPackIds),
      filters: {},
      group_keys: seriesKeysAdName,
      window: SERIES_WINDOW,
    }),
    [dateRange.start, dateRange.end, actionType, selectedPackIds, seriesKeysAdName],
  );
  const managerSeriesRequestIndividual = useMemo(
    () => ({
      date_start: dateRange.start || "",
      date_stop: dateRange.end || "",
      group_by: "ad_id" as const,
      action_type: actionType || undefined,
      pack_ids: Array.from(selectedPackIds),
      filters: {},
      group_keys: seriesKeysIndividual,
      window: SERIES_WINDOW,
    }),
    [dateRange.start, dateRange.end, actionType, selectedPackIds, seriesKeysIndividual],
  );
  const managerSeriesRequestAdset = useMemo(
    () => ({
      date_start: dateRange.start || "",
      date_stop: dateRange.end || "",
      group_by: "adset_id" as const,
      action_type: actionType || undefined,
      pack_ids: Array.from(selectedPackIds),
      filters: {},
      group_keys: seriesKeysAdset,
      window: SERIES_WINDOW,
    }),
    [dateRange.start, dateRange.end, actionType, selectedPackIds, seriesKeysAdset],
  );
  const managerSeriesRequestCampaign = useMemo(
    () => ({
      date_start: dateRange.start || "",
      date_stop: dateRange.end || "",
      group_by: "campaign_id" as const,
      action_type: actionType || undefined,
      pack_ids: Array.from(selectedPackIds),
      filters: {},
      group_keys: seriesKeysCampaign,
      window: SERIES_WINDOW,
    }),
    [dateRange.start, dateRange.end, actionType, selectedPackIds, seriesKeysCampaign],
  );

  const shouldFetchSeriesAdName = showTrends && activeManagerTab === "por-anuncio" && seriesKeysAdName.length > 0;
  const shouldFetchSeriesIndividual = showTrends && activeManagerTab === "individual" && seriesKeysIndividual.length > 0;
  const shouldFetchSeriesAdset = showTrends && activeManagerTab === "por-conjunto" && seriesKeysAdset.length > 0;
  const shouldFetchSeriesCampaign = showTrends && activeManagerTab === "por-campanha" && seriesKeysCampaign.length > 0;

  const { data: managerSeriesData, isError: managerSeriesErrorAdName } = useAdPerformanceSeries(managerSeriesRequest, shouldFetchSeriesAdName);
  const { data: managerSeriesDataIndividual, isError: managerSeriesErrorIndividual } = useAdPerformanceSeries(managerSeriesRequestIndividual, shouldFetchSeriesIndividual);
  const { data: managerSeriesDataAdset, isError: managerSeriesErrorAdset } = useAdPerformanceSeries(managerSeriesRequestAdset, shouldFetchSeriesAdset);
  const { data: managerSeriesDataCampaign, isError: managerSeriesErrorCampaign } = useAdPerformanceSeries(managerSeriesRequestCampaign, shouldFetchSeriesCampaign);

  useEffect(() => {
    mergeSeriesCache("por-anuncio", (managerSeriesData as any)?.series_by_group);
  }, [managerSeriesData, mergeSeriesCache]);

  useEffect(() => {
    mergeSeriesCache("individual", (managerSeriesDataIndividual as any)?.series_by_group);
  }, [managerSeriesDataIndividual, mergeSeriesCache]);

  useEffect(() => {
    mergeSeriesCache("por-conjunto", (managerSeriesDataAdset as any)?.series_by_group);
  }, [managerSeriesDataAdset, mergeSeriesCache]);

  useEffect(() => {
    mergeSeriesCache("por-campanha", (managerSeriesDataCampaign as any)?.series_by_group);
  }, [managerSeriesDataCampaign, mergeSeriesCache]);

  const seriesByGroupAdName = seriesCacheByTab["por-anuncio"];
  const seriesByGroupIndividual = seriesCacheByTab.individual;
  const seriesByGroupAdset = seriesCacheByTab["por-conjunto"];
  const seriesByGroupCampaign = seriesCacheByTab["por-campanha"];
  const pendingSeriesKeysByTab = useMemo(() => {
    const buildPendingSet = (keys: string[], cache: Record<string, any>, shouldLoad: boolean): Set<string> => {
      if (!shouldLoad) return new Set<string>();
      return new Set(keys.filter((k) => !!k && !cache[k]));
    };

    return {
      "por-anuncio": buildPendingSet(seriesKeysAdName, seriesByGroupAdName, showTrends && activeManagerTab === "por-anuncio" && !managerSeriesErrorAdName),
      individual: buildPendingSet(seriesKeysIndividual, seriesByGroupIndividual, showTrends && activeManagerTab === "individual" && !managerSeriesErrorIndividual),
      "por-conjunto": buildPendingSet(seriesKeysAdset, seriesByGroupAdset, showTrends && activeManagerTab === "por-conjunto" && !managerSeriesErrorAdset),
      "por-campanha": buildPendingSet(seriesKeysCampaign, seriesByGroupCampaign, showTrends && activeManagerTab === "por-campanha" && !managerSeriesErrorCampaign),
    };
  }, [
    seriesKeysAdName,
    seriesKeysIndividual,
    seriesKeysAdset,
    seriesKeysCampaign,
    seriesByGroupAdName,
    seriesByGroupIndividual,
    seriesByGroupAdset,
    seriesByGroupCampaign,
    showTrends,
    activeManagerTab,
    managerSeriesErrorAdName,
    managerSeriesErrorIndividual,
    managerSeriesErrorAdset,
    managerSeriesErrorCampaign,
  ]);
  const seriesPrimingByTab = useMemo(() => {
    const isPriming = (tab: "individual" | "por-anuncio" | "por-conjunto" | "por-campanha", tabKeys: string[], tabError: boolean) =>
      showTrends && activeManagerTab === tab && !tabError && tabKeys.length === 0;

    return {
      "por-anuncio": isPriming("por-anuncio", seriesKeysAdName, managerSeriesErrorAdName),
      individual: isPriming("individual", seriesKeysIndividual, managerSeriesErrorIndividual),
      "por-conjunto": isPriming("por-conjunto", seriesKeysAdset, managerSeriesErrorAdset),
      "por-campanha": isPriming("por-campanha", seriesKeysCampaign, managerSeriesErrorCampaign),
    };
  }, [
    showTrends,
    activeManagerTab,
    seriesKeysAdName,
    seriesKeysIndividual,
    seriesKeysAdset,
    seriesKeysCampaign,
    managerSeriesErrorAdName,
    managerSeriesErrorIndividual,
    managerSeriesErrorAdset,
    managerSeriesErrorCampaign,
  ]);

  const uniqueConversionTypes = useMemo(() => {
    return availableConversionTypes;
  }, [availableConversionTypes]);

  // Carregar actionType do localStorage quando os tipos de conversão estiverem disponíveis
  useEffect(() => {
    if (uniqueConversionTypes.length === 0) return;

    // Se não há actionType selecionado, tentar carregar do localStorage ou usar o primeiro disponível
    if (!actionType) {
      try {
        const saved = localStorage.getItem(STORAGE_KEY_ACTION_TYPE);
        if (saved && uniqueConversionTypes.includes(saved)) {
          // Se a preferência salva existe e está disponível, usar ela
          setActionType(saved);
        } else {
          // Caso contrário, usar a primeira opção disponível
          setActionType(uniqueConversionTypes[0]);
        }
      } catch (e) {
        logger.error("Erro ao carregar actionType:", e);
        setActionType(uniqueConversionTypes[0]);
      }
    } else {
      // Se o actionType atual não está mais disponível, usar o primeiro disponível
      if (!uniqueConversionTypes.includes(actionType)) {
        setActionType(uniqueConversionTypes[0]);
      }
    }
  }, [uniqueConversionTypes, actionType]);

  // Handler para mudança de actionType com salvamento no localStorage
  const handleActionTypeChange = (value: string) => {
    setActionType(value);
    // Salvar no localStorage
    try {
      localStorage.setItem(STORAGE_KEY_ACTION_TYPE, value);
    } catch (e) {
      logger.error("Erro ao salvar actionType no localStorage:", e);
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
      logger.error("Erro ao salvar usePackDates no localStorage:", e);
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
    if (dateRange.start === calculateDateRangeFromPacks.start && dateRange.end === calculateDateRangeFromPacks.end) {
      return;
    }

    // Aplicar automaticamente o novo dateRange
    setDateRange(calculateDateRangeFromPacks);
    saveDateRange(calculateDateRangeFromPacks);
  }, [usePackDates, selectedPackIds, calculateDateRangeFromPacks]); // Monitora mudanças em selectedPackIds (quando packs são selecionados/deselecionados)

  // Atualizar serverAverages quando dados mudarem
  useEffect(() => {
    if (managerData && (managerData as any).averages) {
      setServerAverages((managerData as any).averages);
    }
  }, [managerData]);

  // Tratar erros
  useEffect(() => {
    if (managerError) {
      logger.error("Erro ao buscar manager:", managerError);
    }
  }, [managerError]);

  // Carregar e sincronizar preferências de packs quando packs estiverem disponíveis
  useEffect(() => {
    if (!packsClient || packs.length === 0) return;

    const allPackIds = new Set(packs.map((p) => p.id));
    const currentPrefs = loadPackPreferences();

    // Sincronizar preferências: adicionar novos packs, remover packs deletados
    let hasChanges = false;
    const newPrefs: PackPreferences = {};

    // 1. Adicionar novos packs e manter preferências existentes (multi-select)
    allPackIds.forEach((packId) => {
      if (packId in currentPrefs) {
        // Pack já existe: manter preferência existente
        newPrefs[packId] = currentPrefs[packId];
      } else {
        // Pack novo: habilitar por padrão, sem desabilitar os outros
        newPrefs[packId] = true;
        hasChanges = true;
      }
    });

    // 2. Remover packs que não existem mais (não adicionar ao newPrefs)
    Object.keys(currentPrefs).forEach((packId) => {
      if (!allPackIds.has(packId)) {
        hasChanges = true;
        // Não adicionar ao newPrefs (será removido automaticamente)
      }
    });

    // Salvar preferências atualizadas se houver mudanças
    if (hasChanges) {
      savePackPreferences(newPrefs);
    }

    // Atualizar estado com packs habilitados
    let enabledPackIds = new Set(
      Object.entries(hasChanges ? newPrefs : currentPrefs)
        .filter(([_, enabled]) => enabled)
        .map(([id]) => id),
    );

    // Garantir sempre pelo menos 1 pack quando há packs disponíveis
    if (enabledPackIds.size === 0 && allPackIds.size > 0) {
      const firstPackId = packs[0].id;
      const finalPrefs = hasChanges ? { ...newPrefs } : { ...currentPrefs };
      finalPrefs[firstPackId] = true;
      savePackPreferences(finalPrefs);
      enabledPackIds = new Set([firstPackId]);
    }

    setSelectedPackIds((prevSelected) => {
      // Se o estado anterior está vazio ou diferente, atualizar
      if (prevSelected.size !== enabledPackIds.size || !Array.from(enabledPackIds).every((id) => prevSelected.has(id))) {
        return enabledPackIds;
      }
      return prevSelected;
    });
  }, [packsClient, packs.length, packs.map((p) => p.id).join(",")]); // Reagir quando packs mudarem

  // Buscar ads dos packs selecionados usando cache
  const selectedPacks = packs.filter((p) => selectedPackIds.has(p.id));
  const { packsAdsMap } = usePacksAds(selectedPacks);

  // Handler para toggle de pack (multi-select, sempre pelo menos 1 pack)
  const handleTogglePack = (packId: string) => {
    const currentPrefs = loadPackPreferences();
    const isCurrentlySelected = currentPrefs[packId] ?? true;
    const enabledCount = Object.values(currentPrefs).filter((v) => v).length;

    // Garantir sempre pelo menos 1 pack: se clicar no único selecionado, não desmarcar
    if (isCurrentlySelected && enabledCount <= 1) {
      return;
    }

    const newPrefs: PackPreferences = { ...currentPrefs };
    newPrefs[packId] = !isCurrentlySelected;

    savePackPreferences(newPrefs);

    const enabledPackIds = new Set(
      Object.entries(newPrefs)
        .filter(([_, enabled]) => enabled)
        .map(([id]) => id),
    );
    setSelectedPackIds(enabledPackIds);
  };

  // Handler atômico para single-select de pack (evita race condition de múltiplos toggles no localStorage)
  const handleSetSinglePack = (packId: string) => {
    const currentPrefs = loadPackPreferences();
    const isCurrentlySelected = currentPrefs[packId] ?? false;
    const enabledCount = Object.values(currentPrefs).filter((v) => v).length;

    if (isCurrentlySelected && enabledCount <= 1) {
      return; // Não desmarcar o último pack
    }

    if (isCurrentlySelected) {
      // Desmarcar este pack
      const newPrefs: PackPreferences = { ...currentPrefs, [packId]: false };
      savePackPreferences(newPrefs);
      const enabledPackIds = new Set(
        Object.entries(newPrefs)
          .filter(([_, enabled]) => enabled)
          .map(([id]) => id),
      );
      setSelectedPackIds(enabledPackIds);
    } else {
      // Selecionar apenas este pack — operação atômica única
      const newPrefs: PackPreferences = {};
      Object.keys(currentPrefs).forEach((id) => {
        newPrefs[id] = id === packId;
      });
      savePackPreferences(newPrefs);
      setSelectedPackIds(new Set([packId]));
    }
  };

  // Handler para toggle de tendências/performance
  const handleShowTrendsChange = (checked: boolean) => {
    setShowTrends(checked);
    try {
      localStorage.setItem("hookify-manager-show-trends", checked.toString());
    } catch (e) {
      logger.error("Erro ao salvar showTrends no localStorage:", e);
    }
  };

  // Adaptar dados do servidor para a tabela existente (forma "ads" agregada)
  // Calcula results, cpr e page_conv localmente baseado no action_type selecionado
  // Backend já filtrou por pack_ids
  const adsForTable = useMemo(() => {
    // Processar apenas quando a aba "Por anúncio" estiver ativa
    if (activeManagerTab !== "por-anuncio") return [] as any[];
    if (!serverData || serverData.length === 0) return [] as any[];

    let mappedData = serverData.map((row: any): ManagerRow => {
      const groupKey = String(row?.group_key || row?.ad_name || row?.ad_id || "");
      const series = showTrends ? (seriesByGroupAdName[groupKey] || null) : null;
      const seriesLoading = showTrends && !managerSeriesErrorAdName && (!series && (seriesPrimingByTab["por-anuncio"] || pendingSeriesKeysByTab["por-anuncio"].has(groupKey)));
      // Calcular results baseado no action_type selecionado a partir de row.conversions
      const conversionsObj = row.conversions || {};
      const results = actionType ? Number(conversionsObj[actionType] || 0) : 0;

      // Calcular métricas derivadas localmente (apenas as que dependem de actionType)
      const lpv = Number(row.lpv || 0);
      const spend = Number(row.spend || 0);
      const page_conv = lpv > 0 ? results / lpv : 0;
      const cpr = results > 0 ? spend / results : 0;
      // cpm e website_ctr sempre vêm do backend
      const cpm = typeof row.cpm === "number" ? row.cpm : 0;

      // Calcular conversão geral (website_ctr * connect_rate * page_conv)
      const website_ctr = typeof row.website_ctr === "number" ? row.website_ctr : 0;
      const connect_rate = Number(row.connect_rate || 0);
      const overall_conversion = website_ctr * connect_rate * page_conv;

      // Spread leve: herda todos os campos do original (series, leadscore_values, etc. compartilham referência)
      // Apenas sobrescreve campos derivados que dependem de actionType
      // Series derivadas (cpr, page_conv, overall_conversion) são calculadas sob demanda pelo MetricCell
      return {
        ...row,
        lpv,
        spend,
        cpr,
        cpm,
        page_conv,
        overall_conversion,
        website_ctr,
        connect_rate,
        video_total_plays: Number(row.plays || 0),
        conversions: conversionsObj,
        series,
        series_loading: seriesLoading,
        creative: {},
      };
    });

    // Retornar todos os anúncios (backend já filtrou por pack_ids)
    return mappedData;
  }, [serverData, actionType, activeManagerTab, showTrends, seriesByGroupAdName, pendingSeriesKeysByTab, seriesPrimingByTab, managerSeriesErrorAdName]);

  const adsForIndividualTable = useMemo(() => {
    // Processar apenas quando a aba "Individual" estiver ativa
    if (activeManagerTab !== "individual") return [] as any[];
    if (!serverDataIndividual || serverDataIndividual.length === 0) return [] as any[];

    const mappedData = serverDataIndividual.map((row: any): ManagerRow => {
      const groupKey = String(row?.group_key || row?.ad_id || "");
      const series = showTrends ? (seriesByGroupIndividual[groupKey] || null) : null;
      const seriesLoading = showTrends && !managerSeriesErrorIndividual && (!series && (seriesPrimingByTab.individual || pendingSeriesKeysByTab.individual.has(groupKey)));
      const conversionsObj = row.conversions || {};
      const results = actionType ? Number(conversionsObj[actionType] || 0) : 0;
      const lpv = Number(row.lpv || 0);
      const spend = Number(row.spend || 0);
      const page_conv = lpv > 0 ? results / lpv : 0;
      const cpr = results > 0 ? spend / results : 0;
      const website_ctr = typeof row.website_ctr === "number" ? row.website_ctr : 0;
      const connect_rate = Number(row.connect_rate || 0);
      const overall_conversion = website_ctr * connect_rate * page_conv;

      return {
        ...row,
        lpv,
        spend,
        cpr,
        cpm: Number(row.cpm || 0),
        page_conv,
        overall_conversion,
        website_ctr,
        connect_rate,
        video_total_plays: Number(row.plays || 0),
        conversions: conversionsObj,
        series,
        series_loading: seriesLoading,
        creative: {},
      };
    });

    return mappedData;
  }, [serverDataIndividual, actionType, activeManagerTab, showTrends, seriesByGroupIndividual, pendingSeriesKeysByTab, seriesPrimingByTab, managerSeriesErrorIndividual]);

  const adsForAdsetTable = useMemo(() => {
    // Processar apenas quando a aba "Por conjunto" estiver ativa
    if (activeManagerTab !== "por-conjunto") return [] as any[];
    if (!serverDataAdset || serverDataAdset.length === 0) return [] as any[];

    const mappedData = serverDataAdset.map((row: any): ManagerRow => {
      const groupKey = String(row?.group_key || row?.adset_id || "");
      const series = showTrends ? (seriesByGroupAdset[groupKey] || null) : null;
      const seriesLoading = showTrends && !managerSeriesErrorAdset && (!series && (seriesPrimingByTab["por-conjunto"] || pendingSeriesKeysByTab["por-conjunto"].has(groupKey)));
      const conversionsObj = row.conversions || {};
      const results = actionType ? Number(conversionsObj[actionType] || 0) : 0;
      const lpv = Number(row.lpv || 0);
      const spend = Number(row.spend || 0);
      const page_conv = lpv > 0 ? results / lpv : 0;
      const cpr = results > 0 ? spend / results : 0;
      const website_ctr = typeof row.website_ctr === "number" ? row.website_ctr : 0;
      const connect_rate = Number(row.connect_rate || 0);
      const overall_conversion = website_ctr * connect_rate * page_conv;

      return {
        ...row,
        // Fallback para ad_name usado em busca na aba Por conjunto
        ad_name: row.ad_name || row.adset_name || row.adset_id,
        lpv,
        spend,
        cpr,
        cpm: Number(row.cpm || 0),
        page_conv,
        overall_conversion,
        website_ctr,
        connect_rate,
        video_total_plays: Number(row.plays || 0),
        conversions: conversionsObj,
        series,
        series_loading: seriesLoading,
        creative: {},
      };
    });

    return mappedData;
  }, [serverDataAdset, actionType, activeManagerTab, showTrends, seriesByGroupAdset, pendingSeriesKeysByTab, seriesPrimingByTab, managerSeriesErrorAdset]);

  const adsForCampaignTable = useMemo(() => {
    // Processar apenas quando a aba "Por campanha" estiver ativa
    if (activeManagerTab !== "por-campanha") return [] as any[];
    if (!serverDataCampaign || serverDataCampaign.length === 0) return [] as any[];

    const mappedData = serverDataCampaign.map((row: any): ManagerRow => {
      const groupKey = String(row?.group_key || row?.campaign_id || "");
      const series = showTrends ? (seriesByGroupCampaign[groupKey] || null) : null;
      const seriesLoading = showTrends && !managerSeriesErrorCampaign && (!series && (seriesPrimingByTab["por-campanha"] || pendingSeriesKeysByTab["por-campanha"].has(groupKey)));
      const conversionsObj = row.conversions || {};
      const results = actionType ? Number(conversionsObj[actionType] || 0) : 0;
      const lpv = Number(row.lpv || 0);
      const spend = Number(row.spend || 0);
      const page_conv = lpv > 0 ? results / lpv : 0;
      const cpr = results > 0 ? spend / results : 0;
      const website_ctr = typeof row.website_ctr === "number" ? row.website_ctr : 0;
      const connect_rate = Number(row.connect_rate || 0);
      const overall_conversion = website_ctr * connect_rate * page_conv;

      return {
        ...row,
        // Fallback para ad_name na aba Por campanha
        ad_name: row.ad_name || row.campaign_name || row.campaign_id,
        lpv,
        spend,
        cpr,
        cpm: Number(row.cpm || 0),
        page_conv,
        overall_conversion,
        website_ctr,
        connect_rate,
        video_total_plays: Number(row.plays || 0),
        conversions: conversionsObj,
        series,
        series_loading: seriesLoading,
        creative: {},
      };
    });

    return mappedData;
  }, [serverDataCampaign, actionType, activeManagerTab, showTrends, seriesByGroupCampaign, pendingSeriesKeysByTab, seriesPrimingByTab, managerSeriesErrorCampaign]);

  // Conjunto de anúncios que passam pelos critérios de validação globais
  // Usado apenas para cálculo de médias (baseline de anúncios "maduros")
  // Calcular apenas quando a aba "Por anúncio" estiver ativa (onde as médias são usadas)
  const [validatedManagerForAverages, validatedAveragesForAverages] = useMemo(() => {
    // Processar apenas quando a aba "Por anúncio" estiver ativa
    if (activeManagerTab !== "por-anuncio") {
      return [[], undefined] as [any[], any];
    }
    if (!serverData || serverData.length === 0) {
      return [[], undefined] as [any[], any];
    }

    // Enquanto critérios ainda não carregaram ou não existem, considerar todos como validados
    if (!validationCriteria || validationCriteria.length === 0) {
      const averagesFromAll = computeValidatedAveragesFromAdPerformance(serverData as any, actionType, uniqueConversionTypes);
      return [serverData, averagesFromAll] as [any[], any];
    }

    const validated = serverData.filter((ad: any) => {
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
  }, [serverData, validationCriteria, actionType, uniqueConversionTypes, activeManagerTab]);

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

  // Sempre renderizar o ManagerTable com os controles visíveis
  // O ManagerTable lida internamente com loading states via isLoading prop
  return (
    <PageContainer
      title="Otimize"
      description="Dados de performance dos seus anúncios"
      actions={
        <>
          <ToggleSwitch id="show-trends" checked={showTrends} onCheckedChange={handleShowTrendsChange} labelLeft="Médias" labelRight="Tendências" variant="minimal" />
          <FiltersDropdown expanded={true} dateRange={dateRange} onDateRangeChange={handleDateRangeChange} actionType={actionType} onActionTypeChange={handleActionTypeChange} actionTypeOptions={uniqueConversionTypes} packs={packs} selectedPackIds={selectedPackIds} onTogglePack={handleTogglePack} packsClient={packsClient} usePackDates={usePackDates} onUsePackDatesChange={handleUsePackDatesChange} dateRangeRequireConfirmation={true} packDatesRange={calculateDateRangeFromPacks ?? null} singlePackSelect={false} />
        </>
      }
    >
      <ManagerTable
        ads={adsForTable}
        groupByAdName
        activeTab={activeManagerTab}
        onTabChange={setActiveManagerTab}
        adsIndividual={adsForIndividualTable}
        isLoadingIndividual={loadingIndividual}
        adsAdset={adsForAdsetTable}
        isLoadingAdset={loadingAdset}
        adsCampaign={adsForCampaignTable}
        isLoadingCampaign={loadingCampaign}
        onVisibleGroupKeysChange={handleVisibleGroupKeysChange}
        actionType={actionType}
        endDate={endDate}
        dateStart={dateRange.start}
        dateStop={dateRange.end}
        availableConversionTypes={uniqueConversionTypes}
        showTrends={showTrends}
        hasSheetIntegration={hasSheetIntegration}
        isLoading={loading}
        initialFilters={initialFilters}
        averagesOverride={(() => {
          // Preferir sempre médias baseadas em anúncios validados; se não houver, usar médias brutas do backend como fallback
          const base = validatedAveragesForAverages || serverAverages || null;
          if (!base) return undefined;
          const per = (base as any).per_action_type || {};
          const perSel = actionType ? per[actionType] : undefined;

          // Se não houver entrada para o actionType (deveria ser raro agora), usar valores padrão (0)
          // Isso garante que a UI não quebre mesmo se houver alguma inconsistência
          const defaultPerSel = actionType && !perSel ? { cpr: 0, page_conv: 0, results: 0 } : perSel;

          return {
            hook: typeof base.hook === "number" ? base.hook : null,
            scroll_stop: typeof base.scroll_stop === "number" ? base.scroll_stop : null,
            ctr: typeof base.ctr === "number" ? base.ctr : null,
            website_ctr: typeof base.website_ctr === "number" ? base.website_ctr : null,
            connect_rate: typeof base.connect_rate === "number" ? base.connect_rate : null,
            cpm: typeof base.cpm === "number" ? base.cpm : null,
            cpr: defaultPerSel && typeof defaultPerSel.cpr === "number" ? defaultPerSel.cpr : null,
            page_conv: defaultPerSel && typeof defaultPerSel.page_conv === "number" ? defaultPerSel.page_conv : null,
          } as any;
        })()}
      />
    </PageContainer>
  );
}

export default function ManagerPage() {
  return (
    <Suspense fallback={<LoadingState label="Carregando..." />}>
      <ManagerPageContent />
    </Suspense>
  );
}

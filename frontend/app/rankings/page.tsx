"use client";

import { useMemo, useState, useEffect } from "react";
import { LoadingState, EmptyState } from "@/components/common/States";
import { useClientPacks } from "@/lib/hooks/useClientSession";
import { usePacksAds } from "@/lib/hooks/usePacksAds";
import { RankingsTable } from "@/components/rankings/RankingsTable";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api/endpoints";
import { RankingsRequest, RankingsResponse } from "@/lib/api/schemas";
import { formatDateLocal } from "@/lib/utils/dateFilters";
import { useAdPerformance } from "@/lib/api/hooks";
import { Skeleton } from "@/components/ui/skeleton";
import { useValidationCriteria } from "@/lib/hooks/useValidationCriteria";
import { useAppAuthReady } from "@/lib/hooks/useAppAuthReady";
import { evaluateValidationCriteria, aggregateMetricsForGroup, AdMetricsData } from "@/lib/utils/validateAdCriteria";
import { computeValidatedAveragesFromAdPerformance } from "@/lib/utils/validatedAverages";
import { PageSectionHeader } from "@/components/common/PageSectionHeader";
import { FiltersDropdown } from "@/components/common/FiltersDropdown";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";

const STORAGE_KEY_PACKS = "hookify-rankings-selected-packs";
const STORAGE_KEY_ACTION_TYPE = "hookify-rankings-action-type";
const STORAGE_KEY_DATE_RANGE = "hookify-rankings-date-range";
const STORAGE_KEY_USE_PACK_DATES = "hookify-rankings-use-pack-dates";

// Tipo para as preferências de packs no localStorage
// Estrutura: { [packId: string]: boolean } onde true = habilitado, false = desabilitado
type PackPreferences = Record<string, boolean>;

// Funções auxiliares para gerenciar preferências de packs
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

export default function RankingsPage() {
  const { packs, isClient: packsClient } = useClientPacks();
  const { isClient, authStatus, onboardingStatus, isAuthorized } = useAppAuthReady();
  // Ranking agora é sempre agrupado por nome (ad_name) sobre a mesma base
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
  const [serverAverages, setServerAverages] = useState<any | null>(null);
  const { criteria: validationCriteria } = useValidationCriteria();
  const [isValidationFilterEnabled, setIsValidationFilterEnabled] = useState(false);
  const [showTrends, setShowTrends] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const saved = localStorage.getItem("hookify-rankings-show-trends");
      return saved !== "false"; // padrão é true (tendências)
    } catch (e) {
      console.error("Erro ao carregar showTrends do localStorage:", e);
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

  // endDate = limite superior selecionado no filtro
  const endDate = useMemo(() => dateRange.end, [dateRange.end]);

  // Usar hook semântico para buscar performance agregada de anúncios
  const rankingsRequest: RankingsRequest = useMemo(
    () => ({
      date_start: dateRange.start || "",
      date_stop: dateRange.end || "",
      group_by: "ad_name",
      // Não enviar action_type - vamos calcular localmente baseado no selecionado
      limit: 1000,
      filters: {},
    }),
    [dateRange.start, dateRange.end]
  );

  const { data: rankingsData, isLoading: loading, error: rankingsError } = useAdPerformance(rankingsRequest, isAuthorized && !!dateRange.start && !!dateRange.end);

  // Extrair dados do response
  const serverData = rankingsData?.data || null;
  const availableConversionTypes = rankingsData?.available_conversion_types || [];

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
        console.error("Erro ao carregar actionType:", e);
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
  }, [usePackDates, calculateDateRangeFromPacks, selectedPackIds.size]); // Adicionar selectedPackIds.size para garantir atualização ao ativar/desativar packs

  // Atualizar serverAverages quando dados mudarem
  useEffect(() => {
    if (rankingsData && (rankingsData as any).averages) {
      setServerAverages((rankingsData as any).averages);
    }
  }, [rankingsData]);

  // Tratar erros
  useEffect(() => {
    if (rankingsError) {
      console.error("Erro ao buscar rankings:", rankingsError);
    }
  }, [rankingsError]);

  // Carregar e sincronizar preferências de packs quando packs estiverem disponíveis
  useEffect(() => {
    if (!packsClient || packs.length === 0) return;

    const allPackIds = new Set(packs.map((p) => p.id));
    const currentPrefs = loadPackPreferences();

    // Sincronizar preferências: adicionar novos packs, remover packs deletados
    let hasChanges = false;
    const newPrefs: PackPreferences = {};

    // 1. Adicionar novos packs (habilitados por padrão) e manter preferências existentes
    allPackIds.forEach((packId) => {
      if (packId in currentPrefs) {
        // Pack já existe, manter preferência (habilitado ou desabilitado)
        newPrefs[packId] = currentPrefs[packId];
      } else {
        // Pack novo, habilitar por padrão
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
    const enabledPackIds = new Set(
      Object.entries(hasChanges ? newPrefs : currentPrefs)
        .filter(([_, enabled]) => enabled)
        .map(([id]) => id)
    );

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

  // Função para verificar se um ranking pertence a algum pack selecionado
  const isRankingInSelectedPacks = useMemo(() => {
    return (ranking: any): boolean => {
      // Se nenhum pack está selecionado, não mostrar nada
      if (selectedPackIds.size === 0) return false;

      if (selectedPacks.length === 0) return false;

      // Verificar se o ranking corresponde a algum ad dos packs selecionados
      for (const pack of selectedPacks) {
        const packAds = packsAdsMap.get(pack.id) || [];
        if (packAds.length === 0) continue;

        // Verificar se o ranking corresponde a algum ad do pack
        const matches = packAds.some((ad: any) => {
          const rankingAdId = ranking.ad_id;
          const rankingAdName = ranking.ad_name;
          const rankingAccountId = ranking.account_id;

          const adId = ad.ad_id;
          const adName = ad.ad_name;
          const adAccountId = ad.account_id;

          // Se account_id estiver disponível, verificar primeiro
          if (rankingAccountId && adAccountId) {
            if (String(rankingAccountId).trim() !== String(adAccountId).trim()) {
              return false; // Diferentes accounts, não corresponde
            }
          }

          // Comparar por ID primeiro (mais preciso)
          if (rankingAdId && adId) {
            if (String(rankingAdId).trim() === String(adId).trim()) {
              return true;
            }
          }

          // Comparar por nome (fallback)
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

  // Handler para toggle de pack
  const handleTogglePack = (packId: string) => {
    const currentPrefs = loadPackPreferences();
    const newPrefs: PackPreferences = {
      ...currentPrefs,
      [packId]: !(currentPrefs[packId] ?? true), // Se não existe, assume true (padrão)
    };

    savePackPreferences(newPrefs);

    // Atualizar estado imediatamente com packs habilitados
    const enabledPackIds = new Set(
      Object.entries(newPrefs)
        .filter(([_, enabled]) => enabled)
        .map(([id]) => id)
    );
    setSelectedPackIds(enabledPackIds);
  };

  // Handler para toggle de tendências/performance
  const handleShowTrendsChange = (checked: boolean) => {
    setShowTrends(checked);
    try {
      localStorage.setItem("hookify-rankings-show-trends", checked.toString());
    } catch (e) {
      console.error("Erro ao salvar showTrends no localStorage:", e);
    }
  };

  // Conjunto bruto do backend filtrado por packs selecionados
  const filteredRankings = useMemo(() => {
    if (!serverData) return [];
    return serverData.filter((row: any) => isRankingInSelectedPacks(row));
  }, [serverData, isRankingInSelectedPacks]);

  // Adaptar dados do servidor para a tabela existente (forma "ads" agregada)
  // Calcula results, cpr e page_conv localmente baseado no action_type selecionado
  // E filtra por packs selecionados
  const adsForTable = useMemo(() => {
    if (!filteredRankings || filteredRankings.length === 0) return [] as any[];

    let mappedData = filteredRankings.map((row: any) => {
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

      // Usar objeto original de conversões (contém todos os tipos) - mais eficiente que criar array
      const actions = [{ action_type: "landing_page_view", value: lpv }];

      // Processar series para calcular cpr_series e page_conv_series dinamicamente (dependem de actionType)
      // cpm_series e website_ctr_series sempre vêm do backend
      let series = row.series;

      // Calcular cpr_series e page_conv_series (dependem de actionType)
      if (series && series.conversions && actionType) {
        // Calcular results por dia para o action_type selecionado
        const resultsSeries = series.conversions.map((dayConversions: Record<string, number>) => {
          return dayConversions[actionType] || 0;
        });

        // Calcular cpr_series e page_conv_series
        const spendSeries = series.spend || [];
        const lpvSeries = series.lpv || [];

        const page_conv_series = resultsSeries.map((resultsDay: number, idx: number) => {
          const lpvDay = lpvSeries[idx] || 0;
          return lpvDay > 0 ? resultsDay / lpvDay : null;
        });

        const cpr_series = resultsSeries.map((resultsDay: number, idx: number) => {
          const spendDay = spendSeries[idx] || 0;
          return resultsDay > 0 ? spendDay / resultsDay : null;
        });

        // Calcular série de overall_conversion (website_ctr * connect_rate * page_conv)
        const website_ctr_series = series.website_ctr || [];
        const connect_rate_series = series.connect_rate || [];
        const overall_conversion_series = page_conv_series.map((pageConvDay: number | null, idx: number) => {
          const websiteCtrDay = website_ctr_series[idx] ?? 0;
          const connectRateDay = connect_rate_series[idx] ?? 0;
          if (pageConvDay !== null && pageConvDay !== undefined && websiteCtrDay !== null && connectRateDay !== null) {
            return websiteCtrDay * connectRateDay * pageConvDay;
          }
          return null;
        });

        series = {
          ...series,
          cpr: cpr_series,
          page_conv: page_conv_series,
          overall_conversion: overall_conversion_series,
        } as any;
      }

      return {
        account_id: row.account_id,
        ad_id: row.ad_id,
        ad_name: row.ad_name,
        unique_id: row.unique_id,
        effective_status: row.effective_status || null,
        clicks: Number(row.clicks || 0),
        impressions: Number(row.impressions || 0),
        inline_link_clicks: Number(row.inline_link_clicks || 0),
        spend,
        video_total_plays: Number(row.plays || 0),
        hook: Number(row.hook || 0),
        ctr: Number(row.ctr || 0),
        connect_rate: Number(row.connect_rate || 0),
        page_conv,
        cpr,
        cpm,
        website_ctr: typeof row.website_ctr === "number" ? row.website_ctr : 0,
        overall_conversion,
        ad_count: Number(row.ad_count || 1),
        thumbnail: row.thumbnail || null, // Thumbnail do servidor
        // Preservar leadscore_values agregados para cálculo de MQL/CPMQL no frontend
        leadscore_values: Array.isArray(row.leadscore_values) ? row.leadscore_values : undefined,
        conversions: conversionsObj, // Objeto original contendo todos os tipos de conversão
        actions,
        series, // Séries com cpr e page_conv calculados dinamicamente, cpm e website_ctr do backend
        video_play_curve_actions: row.video_play_curve_actions || null, // Curva agregada do servidor (ponderada por plays)
        creative: {},
      };
    });

    // Já filtrado por packs em filteredRankings
    let filteredData = mappedData;

    // Aplicar filtro de validação se habilitado
    if (isValidationFilterEnabled && validationCriteria && validationCriteria.length > 0) {
      // Na visualização por ad_name (groupByAdName = true), agrupar e avaliar agregado
      // Na visualização por ad_id (groupByAdName = false), avaliar individualmente
      const groupByAdName = true; // Sempre true na página de rankings conforme linha 666

      if (groupByAdName) {
        // Agrupar por ad_name e avaliar agregado
        // Considera todas as métricas dos ad_ids mesmo que individualmente não atendam
        const groupedByAdName = new Map<string, typeof filteredData>();

        filteredData.forEach((ad) => {
          const key = ad.ad_name || ad.ad_id || "";
          if (!groupedByAdName.has(key)) {
            groupedByAdName.set(key, []);
          }
          groupedByAdName.get(key)!.push(ad);
        });

        // Avaliar cada grupo agregado e separar em validados e em teste
        const validatedAds: typeof filteredData = [];

        groupedByAdName.forEach((ads) => {
          // Agregar métricas do grupo (soma de todos os ad_ids do mesmo ad_name)
          const aggregatedMetrics = aggregateMetricsForGroup(ads as AdMetricsData[]);

          // Avaliar critérios contra métricas agregadas
          const isValid = evaluateValidationCriteria(validationCriteria, aggregatedMetrics, "AND");

          if (isValid) {
            // Se o grupo agregado atende, todos os ad_ids desse grupo são validados
            validatedAds.push(...ads);
          }
          // Se não atende, não adiciona (fica em teste - não exibido)
        });

        // Retornar apenas validados
        filteredData = validatedAds;
      } else {
        // Na visualização por ad_id, avaliar individualmente cada anúncio
        const validatedAds: typeof filteredData = [];

        filteredData.forEach((ad) => {
          const isValid = evaluateValidationCriteria(validationCriteria, ad as AdMetricsData, "AND");

          if (isValid) {
            validatedAds.push(ad);
          }
          // Se não atende, não adiciona (fica em teste - não exibido)
        });

        // Retornar apenas validados
        filteredData = validatedAds;
      }
    }

    return filteredData;
  }, [filteredRankings, actionType, isValidationFilterEnabled, validationCriteria]);

  // Conjunto de anúncios que passam pelos critérios de validação globais
  // Usado apenas para cálculo de médias (baseline de anúncios "maduros")
  const [validatedRankingsForAverages, validatedAveragesForAverages] = useMemo(() => {
    if (!filteredRankings || filteredRankings.length === 0) {
      return [[], undefined] as [any[], any];
    }

    // Enquanto critérios ainda não carregaram ou não existem, considerar todos como validados
    if (!validationCriteria || validationCriteria.length === 0) {
      const averagesFromAll = computeValidatedAveragesFromAdPerformance(filteredRankings as any, actionType, uniqueConversionTypes);
      return [filteredRankings, averagesFromAll] as [any[], any];
    }

    const validated = filteredRankings.filter((ad: any) => {
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
  }, [filteredRankings, validationCriteria, actionType, uniqueConversionTypes]);

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

  // Renderizar skeleton durante carregamento, mas mantendo filtros visíveis
  if (loading) {
    return (
      <div className="space-y-6">
        <PageSectionHeader
          title="Rankings"
          description="Análise detalhada de performance dos seus anúncios"
          actions={
            <>
              <ToggleSwitch id="show-trends" checked={showTrends} onCheckedChange={handleShowTrendsChange} label={showTrends ? "Tendências" : "Performance"} />
              <ToggleSwitch id="validation-filter" checked={isValidationFilterEnabled} onCheckedChange={setIsValidationFilterEnabled} label="Filtrar por critérios de validação" disabled={!validationCriteria || validationCriteria.length === 0} labelClassName={!validationCriteria || validationCriteria.length === 0 ? "text-muted-foreground" : "text-foreground"} helperText={(!validationCriteria || validationCriteria.length === 0) && "(Configure os critérios nas configurações)"} />
              <FiltersDropdown dateRange={dateRange} onDateRangeChange={handleDateRangeChange} actionType={actionType} onActionTypeChange={handleActionTypeChange} actionTypeOptions={uniqueConversionTypes} packs={packs} selectedPackIds={selectedPackIds} onTogglePack={handleTogglePack} packsClient={packsClient} usePackDates={usePackDates} onUsePackDatesChange={handleUsePackDatesChange} dateRangeLabel="Período (Data do Insight)" dateRangeRequireConfirmation={true} dateRangeDisabled={usePackDates} />
            </>
          }
        />

        {/* Skeleton da tabela */}
        <div className="w-full">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-y-4">
              <thead>
                <tr className="sticky top-0 z-10 text-text/80">
                  <th className="text-base font-normal py-4 text-left" style={{ width: 300 }}>
                    <div className="flex items-center justify-start gap-1">
                      <Skeleton className="h-4 w-24" />
                    </div>
                  </th>
                  <th className="text-base font-normal py-4 text-center" style={{ width: 140 }}>
                    <div className="flex items-center justify-center gap-1">
                      <Skeleton className="h-4 w-12" />
                    </div>
                  </th>
                  <th className="text-base font-normal py-4 text-center" style={{ width: 140 }}>
                    <div className="flex items-center justify-center gap-1">
                      <Skeleton className="h-4 w-12" />
                    </div>
                  </th>
                  <th className="text-base font-normal py-4 text-center" style={{ width: 140 }}>
                    <div className="flex items-center justify-center gap-1">
                      <Skeleton className="h-4 w-12" />
                    </div>
                  </th>
                  <th className="text-base font-normal py-4 text-center" style={{ width: 140 }}>
                    <div className="flex items-center justify-center gap-1">
                      <Skeleton className="h-4 w-12" />
                    </div>
                  </th>
                  <th className="text-base font-normal py-4 text-center" style={{ width: 140 }}>
                    <div className="flex items-center justify-center gap-1">
                      <Skeleton className="h-4 w-12" />
                    </div>
                  </th>
                  <th className="text-base font-normal py-4 text-center" style={{ width: 160 }}>
                    <div className="flex items-center justify-center gap-1">
                      <Skeleton className="h-4 w-20" />
                    </div>
                  </th>
                  <th className="text-base font-normal py-4 text-center" style={{ width: 140 }}>
                    <div className="flex items-center justify-center gap-1">
                      <Skeleton className="h-4 w-12" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5].map((i) => (
                  <tr key={i} className="bg-background">
                    <td className="p-4 text-left border-y border-l border-border rounded-l-md">
                      <div className="flex items-center gap-2">
                        <Skeleton className="w-14 h-14 rounded" />
                        <div className="min-w-0 flex-1 space-y-2">
                          <Skeleton className="h-4 w-48" />
                          <Skeleton className="h-3 w-32" />
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-center border-y border-border">
                      <Skeleton className="h-4 w-16 mx-auto" />
                    </td>
                    <td className="p-4 text-center border-y border-border">
                      <Skeleton className="h-4 w-16 mx-auto" />
                    </td>
                    <td className="p-4 text-center border-y border-border">
                      <Skeleton className="h-4 w-16 mx-auto" />
                    </td>
                    <td className="p-4 text-center border-y border-border">
                      <Skeleton className="h-4 w-16 mx-auto" />
                    </td>
                    <td className="p-4 text-center border-y border-border">
                      <Skeleton className="h-4 w-16 mx-auto" />
                    </td>
                    <td className="p-4 text-center border-y border-border">
                      <Skeleton className="h-4 w-20 mx-auto" />
                    </td>
                    <td className="p-4 text-center border-y border-r border-border rounded-r-md">
                      <Skeleton className="h-4 w-16 mx-auto" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  if (!serverData || serverData.length === 0) {
    return (
      <div className="space-y-6">
        <PageSectionHeader
          title="Rankings"
          description="Análise detalhada de performance dos seus anúncios"
          actions={
            <>
              <ToggleSwitch id="show-trends" checked={showTrends} onCheckedChange={handleShowTrendsChange} label={showTrends ? "Tendências" : "Performance"} />
              <ToggleSwitch id="validation-filter" checked={isValidationFilterEnabled} onCheckedChange={setIsValidationFilterEnabled} label="Filtrar por critérios de validação" disabled={!validationCriteria || validationCriteria.length === 0} labelClassName={!validationCriteria || validationCriteria.length === 0 ? "text-muted-foreground" : "text-foreground"} helperText={(!validationCriteria || validationCriteria.length === 0) && "(Configure os critérios nas configurações)"} />
              <FiltersDropdown dateRange={dateRange} onDateRangeChange={handleDateRangeChange} actionType={actionType} onActionTypeChange={handleActionTypeChange} actionTypeOptions={uniqueConversionTypes} packs={packs} selectedPackIds={selectedPackIds} onTogglePack={handleTogglePack} packsClient={packsClient} usePackDates={usePackDates} onUsePackDatesChange={handleUsePackDatesChange} dateRangeLabel="Período (Data do Insight)" dateRangeRequireConfirmation={true} dateRangeDisabled={usePackDates} />
            </>
          }
        />
        <EmptyState message="Sem dados no período selecionado." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageSectionHeader
        title="Rankings"
        description="Análise detalhada de performance dos seus anúncios"
        actions={
          <>
            <ToggleSwitch id="show-trends" checked={showTrends} onCheckedChange={handleShowTrendsChange} label={showTrends ? "Tendências" : "Performance"} />
            <ToggleSwitch id="validation-filter" checked={isValidationFilterEnabled} onCheckedChange={setIsValidationFilterEnabled} label="Filtrar por critérios de validação" disabled={!validationCriteria || validationCriteria.length === 0} labelClassName={!validationCriteria || validationCriteria.length === 0 ? "text-muted-foreground" : "text-foreground"} helperText={(!validationCriteria || validationCriteria.length === 0) && "(Configure os critérios nas configurações)"} />
            <FiltersDropdown dateRange={dateRange} onDateRangeChange={handleDateRangeChange} actionType={actionType} onActionTypeChange={handleActionTypeChange} actionTypeOptions={uniqueConversionTypes} packs={packs} selectedPackIds={selectedPackIds} onTogglePack={handleTogglePack} packsClient={packsClient} usePackDates={usePackDates} onUsePackDatesChange={handleUsePackDatesChange} dateRangeLabel="Período (Data do Insight)" dateRangeRequireConfirmation={true} dateRangeDisabled={usePackDates} />
          </>
        }
      />
      <RankingsTable
        ads={adsForTable}
        groupByAdName
        actionType={actionType}
        endDate={endDate}
        dateStart={dateRange.start}
        dateStop={dateRange.end}
        availableConversionTypes={uniqueConversionTypes}
        showTrends={showTrends}
        hasSheetIntegration={selectedPacks.some((p) => !!p.sheet_integration)}
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
    </div>
  );
}

"use client";

import { useMemo, useState, useEffect } from "react";
import { useRequireAuth } from "@/lib/hooks/useRequireAuth";
import { LoadingState, EmptyState } from "@/components/common/States";
import { useClientAuth, useClientPacks } from "@/lib/hooks/useClientSession";
import { usePacksAds } from "@/lib/hooks/usePacksAds";
import { RankingsTable } from "@/components/rankings/RankingsTable";
import { Card, CardContent } from "@/components/ui/card";
import { DateRangeFilter } from "@/components/common/DateRangeFilter";
import { ActionTypeFilter } from "@/components/common/ActionTypeFilter";
import { PackFilter } from "@/components/common/PackFilter";
import { api } from "@/lib/api/endpoints";
import { RankingsRequest, RankingsResponse } from "@/lib/api/schemas";
import { formatDateLocal } from "@/lib/utils/dateFilters";
import { useRankings } from "@/lib/api/hooks";
import { Skeleton } from "@/components/ui/skeleton";

const STORAGE_KEY_PACKS = "hookify-rankings-selected-packs";
const STORAGE_KEY_ACTION_TYPE = "hookify-rankings-action-type";

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

export default function RankingsPage() {
  const { isClient, isAuthenticated } = useClientAuth();
  const { packs, isClient: packsClient } = useClientPacks();
  const { status } = useRequireAuth("/login");
  // Ranking agora é sempre agrupado por nome (ad_name)
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
    // Inicializar com últimos 30 dias por padrão
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return {
      start: formatDateLocal(start),
      end: formatDateLocal(end),
    };
  });
  const [serverAverages, setServerAverages] = useState<any | null>(null);

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

  // endDate = limite superior selecionado no filtro
  const endDate = useMemo(() => dateRange.end, [dateRange.end]);

  // Usar hook useRankings para buscar dados
  const rankingsRequest: RankingsRequest = useMemo(() => ({
    date_start: dateRange.start || "",
    date_stop: dateRange.end || "",
    group_by: "ad_name",
    // Não enviar action_type - vamos calcular localmente baseado no selecionado
    limit: 1000,
    filters: {},
  }), [dateRange.start, dateRange.end]);

  const { 
    data: rankingsData, 
    isLoading: loading, 
    error: rankingsError 
  } = useRankings(
    rankingsRequest,
    isClient && status === "authorized" && !!dateRange.start && !!dateRange.end
  );

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

  // Adaptar dados do servidor para a tabela existente (forma "ads" agregada)
  // Calcula results, cpr e page_conv localmente baseado no action_type selecionado
  // E filtra por packs selecionados
  const adsForTable = useMemo(() => {
    if (!serverData) return [] as any[];

    let mappedData = serverData.map((row: any) => {
      // Calcular results baseado no action_type selecionado a partir de row.conversions
      const conversionsObj = row.conversions || {};
      const results = actionType ? Number(conversionsObj[actionType] || 0) : 0;

      // Calcular métricas derivadas localmente
      const lpv = Number(row.lpv || 0);
      const spend = Number(row.spend || 0);
      const impressions = Number(row.impressions || 0);
      const page_conv = lpv > 0 ? results / lpv : 0;
      const cpr = results > 0 ? spend / results : 0;
      const cpm = impressions > 0 ? (spend * 1000) / impressions : 0;

      // Usar objeto original de conversões (contém todos os tipos) - mais eficiente que criar array
      const actions = [{ action_type: "landing_page_view", value: lpv }];

      // Processar series para calcular cpr_series, page_conv_series e cpm_series dinamicamente
      let series = row.series;

      // Calcular cpm_series sempre que houver séries (não depende de actionType)
      if (series) {
        const spendSeries = series.spend || [];
        const impressionsSeries = series.impressions || [];

        // Calcular cpm_series se tivermos impressionsSeries do servidor
        if (impressionsSeries.length > 0 && spendSeries.length === impressionsSeries.length) {
          const cpm_series = spendSeries.map((spendDay: number, idx: number) => {
            const imprDay = impressionsSeries[idx] || 0;
            return imprDay > 0 ? (spendDay * 1000) / imprDay : null;
          });
          series = {
            ...series,
            cpm: cpm_series,
          };
        }
      }

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

        series = {
          ...series,
          cpr: cpr_series,
          page_conv: page_conv_series,
        };
      }

      return {
        account_id: row.account_id,
        ad_id: row.ad_id,
        ad_name: row.ad_name,
        unique_id: row.unique_id,
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
        ad_count: Number(row.ad_count || 1),
        thumbnail: row.thumbnail || null, // Thumbnail do servidor
        conversions: conversionsObj, // Objeto original contendo todos os tipos de conversão
        actions,
        series, // Séries com cpr e page_conv calculados dinamicamente
        video_play_curve_actions: row.video_play_curve_actions || null, // Curva agregada do servidor (ponderada por plays)
        creative: {},
      };
    });

    // Filtrar por packs selecionados
    const filteredData = mappedData.filter((ranking) => isRankingInSelectedPacks(ranking));

    return filteredData;
  }, [serverData, actionType, selectedPackIds, packs, isRankingInSelectedPacks]);

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

  // Renderizar skeleton durante carregamento, mas mantendo filtros visíveis
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="mb-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <DateRangeFilter label="Período (Data do Insight)" value={dateRange} onChange={setDateRange} requireConfirmation={true} />
          <ActionTypeFilter label="Evento de Conversão" value={actionType} onChange={handleActionTypeChange} options={uniqueConversionTypes} />
          {packsClient && packs.length > 0 && <PackFilter packs={packs} selectedPackIds={selectedPackIds} onTogglePack={handleTogglePack} />}
        </div>
        
        {/* Skeleton da tabela */}
        <div className="w-full">
          <div className="overflow-x-auto custom-scrollbar">
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
        <div className="mb-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <DateRangeFilter label="Período (Data do Insight)" value={dateRange} onChange={setDateRange} requireConfirmation={true} />
          <ActionTypeFilter label="Evento de Conversão" value={actionType} onChange={handleActionTypeChange} options={uniqueConversionTypes} />
          {packsClient && packs.length > 0 && <PackFilter packs={packs} selectedPackIds={selectedPackIds} onTogglePack={handleTogglePack} />}
        </div>
        <EmptyState message="Sem dados no período selecionado." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="mb-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <DateRangeFilter label="Período (Data do Insight)" value={dateRange} onChange={setDateRange} requireConfirmation={true} />
        <ActionTypeFilter label="Evento de Conversão" value={actionType} onChange={handleActionTypeChange} options={uniqueConversionTypes} />
        {packsClient && packs.length > 0 && <PackFilter packs={packs} selectedPackIds={selectedPackIds} onTogglePack={handleTogglePack} />}
      </div>
      <RankingsTable
        ads={adsForTable}
        groupByAdName
        actionType={actionType}
        endDate={endDate}
        dateStart={dateRange.start}
        dateStop={dateRange.end}
        availableConversionTypes={uniqueConversionTypes}
        averagesOverride={(() => {
          const base = serverAverages || null;
          if (!base) return undefined;
          const per = (base as any).per_action_type || {};
          const perSel = actionType ? per[actionType] : undefined;
          return {
            hook: typeof base.hook === 'number' ? base.hook : null,
            scroll_stop: typeof base.scroll_stop === 'number' ? base.scroll_stop : null,
            ctr: typeof base.ctr === 'number' ? base.ctr : null,
            connect_rate: typeof base.connect_rate === 'number' ? base.connect_rate : null,
            cpm: typeof base.cpm === 'number' ? base.cpm : null,
            cpr: perSel && typeof perSel.cpr === 'number' ? perSel.cpr : null,
            page_conv: perSel && typeof perSel.page_conv === 'number' ? perSel.page_conv : null,
          } as any;
        })()}
      />
    </div>
  );
}

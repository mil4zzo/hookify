"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useOnboardingGate } from "@/lib/hooks/useOnboardingGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingState, EmptyState } from "@/components/common/States";
import { useClientAuth, useClientPacks } from "@/lib/hooks/useClientSession";
import { MetricsCards } from "@/components/dashboard/MetricsCards";
import { RetentionChart } from "@/components/charts/RetentionChart";
import { AdData, aggregateAdsData } from "@/lib/utils/aggregation";
import { getAggregatedPackStatistics } from "@/lib/utils/adCounting";
import { DateRangeFilter } from "@/components/common/DateRangeFilter";
import { filterAdsByDateRange } from "@/lib/utils/dateFilters";
import { PageHeader } from "@/components/layout/PageHeader";
import { IconSettings, IconFilter, IconTableExport } from "@tabler/icons-react";
import { usePageConfig } from "@/lib/hooks/usePageConfig";
import { usePacksAds } from "@/lib/hooks/usePacksAds";
import { Switch } from "@/components/ui/switch";
import { GoogleSheetIntegrationDialog } from "@/components/ads/GoogleSheetIntegrationDialog";

const STORAGE_KEY_DATE_RANGE = "hookify-dashboard-date-range";
const STORAGE_KEY_USE_PACK_DATES = "hookify-dashboard-use-pack-dates";

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

export default function DashboardPage() {
  const pageConfig = usePageConfig();
  const router = useRouter();
  const [resultsColumn, setResultsColumn] = useState<string>("");
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [minImpressions, setMinImpressions] = useState<number>(3000);
  const [minSpend, setMinSpend] = useState<number>(0);
  const [selectedCampaigns, setSelectedCampaigns] = useState<string[]>([]);
  const [selectedAdsets, setSelectedAdsets] = useState<string[]>([]);
  const [selectedAds, setSelectedAds] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<{ start?: string; end?: string }>(() => {
    // Tentar carregar do localStorage primeiro
    const saved = loadDateRange();
    if (saved) {
      return saved;
    }
    // Se não houver salvo, inicializar vazio
    return {};
  });

  // Store hooks
  const { isAuthenticated, isClient } = useClientAuth();
  const { packs } = useClientPacks();
  const { authStatus, onboardingStatus } = useOnboardingGate("app");

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

  // Buscar ads de todos os packs usando cache IndexedDB
  const { allAds, isLoading: isLoadingAds } = usePacksAds(packs);

  // Guard centralizado cobre o redirecionamento

  // Função para calcular dateRange dos packs
  const calculateDateRangeFromPacks = useMemo(() => {
    if (packs.length === 0) return null;
    
    let minStart: string | null = null;
    let maxEnd: string | null = null;
    
    packs.forEach((pack) => {
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
  }, [packs]);

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

  // Atualizar dateRange quando packs mudarem (se usePackDates estiver ativo)
  useEffect(() => {
    if (usePackDates && calculateDateRangeFromPacks) {
      setDateRange(calculateDateRangeFromPacks);
      saveDateRange(calculateDateRangeFromPacks);
    }
  }, [usePackDates, calculateDateRangeFromPacks]);

  const filteredAdsByDate: AdData[] = useMemo(() => {
    return filterAdsByDateRange(allAds as any, dateRange) as any;
  }, [allAds, dateRange]);

  // Calculate statistics using centralized utility
  const packStats = getAggregatedPackStatistics(packs);

  // Extrair valores únicos de action_type dos arrays conversions e cost_per_conversion
  const uniqueConversionTypes = useMemo(() => {
    const types = new Set<string>();
    filteredAdsByDate.forEach((ad) => {
      ad.conversions?.forEach((conversion) => {
        types.add(conversion.action_type);
      });
    });
    return Array.from(types).sort();
  }, [filteredAdsByDate]);

  const uniqueCostPerConversionTypes = useMemo(() => {
    const types = new Set<string>();
    allAds.forEach((ad) => {
      ad.cost_per_conversion?.forEach((cost: { action_type: string; value: number }) => {
        types.add(cost.action_type);
      });
    });
    return Array.from(types).sort();
  }, [allAds]);

  // Opções para seleção de colunas baseadas nos dados carregados
  const conversionTypes = uniqueConversionTypes; // Para o dropdown "Evento de Conversão"

  const resultsColumns = conversionTypes.map((type) => `conversions.${type}`);

  // Definir valores padrão quando os dados estiverem disponíveis
  useEffect(() => {
    if (resultsColumns.length > 0 && !resultsColumn) {
      setResultsColumn(resultsColumns[0]);
    }
  }, [resultsColumns, resultsColumn]);

  // Listas únicas para filtros usando useMemo
  const uniqueCampaigns = useMemo(() => [...new Set(filteredAdsByDate.map((ad) => ad.campaign_name))], [filteredAdsByDate]);
  const uniqueAdsets = useMemo(() => [...new Set(filteredAdsByDate.map((ad) => ad.adset_name))], [filteredAdsByDate]);
  const uniqueAds = useMemo(() => [...new Set(filteredAdsByDate.map((ad) => ad.ad_name))], [filteredAdsByDate]);

  // Aplica filtros e recalcula dados agregados usando useMemo
  const aggregatedData = useMemo(() => {
    if (filteredAdsByDate.length === 0) {
      return null;
    }

    let filteredAds = filteredAdsByDate;

    // Aplicar filtros
    if (selectedCampaigns.length > 0) {
      filteredAds = filteredAds.filter((ad) => selectedCampaigns.includes(ad.campaign_name));
    }
    if (selectedAdsets.length > 0) {
      filteredAds = filteredAds.filter((ad) => selectedAdsets.includes(ad.adset_name));
    }
    if (selectedAds.length > 0) {
      filteredAds = filteredAds.filter((ad) => selectedAds.includes(ad.ad_name));
    }
    if (minImpressions > 0) {
      filteredAds = filteredAds.filter((ad) => ad.impressions >= minImpressions);
    }
    if (minSpend > 0) {
      filteredAds = filteredAds.filter((ad) => ad.spend >= minSpend);
    }

    // Agregar dados
    return aggregateAdsData(filteredAds);
  }, [filteredAdsByDate, selectedCampaigns, selectedAdsets, selectedAds, minImpressions, minSpend]);

  // Calcular valores dinâmicos para conversões selecionadas
  const { resultsValue, costValue } = useMemo(() => {
    if (!resultsColumn || !aggregatedData) {
      return { resultsValue: 0, costValue: 0 };
    }

    const actionType = resultsColumn.split(".").slice(1).join(".");

    // Aplicar os mesmos filtros que foram aplicados em aggregatedData
    let filteredAds = filteredAdsByDate;

    if (selectedCampaigns.length > 0) {
      filteredAds = filteredAds.filter((ad) => selectedCampaigns.includes(ad.campaign_name));
    }
    if (selectedAdsets.length > 0) {
      filteredAds = filteredAds.filter((ad) => selectedAdsets.includes(ad.adset_name));
    }
    if (selectedAds.length > 0) {
      filteredAds = filteredAds.filter((ad) => selectedAds.includes(ad.ad_name));
    }
    if (minImpressions > 0) {
      filteredAds = filteredAds.filter((ad) => ad.impressions >= minImpressions);
    }
    if (minSpend > 0) {
      filteredAds = filteredAds.filter((ad) => ad.spend >= minSpend);
    }

    // Calcular total de conversões do tipo selecionado (com dados filtrados)
    const resultsValue = filteredAds.reduce((sum, ad) => {
      const conversion = ad.conversions?.find((c) => c.action_type === actionType);
      return sum + (conversion?.value || 0);
    }, 0);

    // Calcular CPL = Total Spend / Total Results (ambos filtrados)
    // Proteção contra divisão por zero
    const costValue = resultsValue > 0 ? aggregatedData.spend / resultsValue : 0;

    return { resultsValue, costValue };
  }, [resultsColumn, filteredAdsByDate, aggregatedData, selectedCampaigns, selectedAdsets, selectedAds, minImpressions, minSpend]);

  // Modal de integração com Google Sheets
  const [isSheetsDialogOpen, setIsSheetsDialogOpen] = useState(false);

  // Client-side only rendering
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

  if (packs.length === 0) {
    return (
      <div>
        <EmptyState message="Nenhum pack carregado. Carregue packs de anúncios na página ADs Loader para visualizar o dashboard." />
      </div>
    );
  }

  if (!aggregatedData) {
    return (
      <div>
        <LoadingState label="Processando dados..." />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <PageHeader
        title={pageConfig?.title || "Dashboard"}
        description={`Resumo dos seus anúncios carregados (${packStats.uniqueAds} anúncios únicos de ${packStats.totalPacks} packs)`}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
              className="flex items-center gap-2"
            >
              <IconSettings className="w-4 h-4" />
              Opções Avançadas
            </Button>
            <Button
              variant="secondary"
              onClick={() => setIsSheetsDialogOpen(true)}
              className="flex items-center gap-2"
            >
              <IconTableExport className="w-4 h-4" />
              Integrar planilha
            </Button>
          </div>
        }
      />

      {/* Global Date Range Filter */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-2">
              <DateRangeFilter label="Período (Data do Insight)" value={dateRange} onChange={handleDateRangeChange} disabled={usePackDates} />
              {packs.length > 0 && (
                <div className="flex items-center gap-2 p-2 bg-card border border-border rounded-md">
                  <Switch
                    id="use-pack-dates"
                    checked={usePackDates}
                    onCheckedChange={handleUsePackDatesChange}
                  />
                  <label
                    htmlFor="use-pack-dates"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Usar datas dos packs
                  </label>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Modal de integração Google Sheets */}
      <GoogleSheetIntegrationDialog
        isOpen={isSheetsDialogOpen}
        onClose={() => setIsSheetsDialogOpen(false)}
      />

      {/* Advanced Options */}
      {showAdvancedOptions && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <IconFilter className="w-5 h-5" />
              Opções Avançadas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Settings */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Configurações</h3>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Evento de Conversão</label>
                  <Select value={resultsColumn} onValueChange={setResultsColumn}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {resultsColumns.map((col) => (
                        <SelectItem key={col} value={col}>
                          {col}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Custo por Conversão</label>
                  <div className="w-full h-10 px-3 py-2 border border-border bg-input text-text rounded-md flex items-center">
                    <span className="text-sm text-muted-foreground">{resultsColumn ? `cost_per_conversion.${resultsColumn.split(".").slice(1).join(".")}` : "Nenhum evento selecionado"}</span>
                  </div>
                </div>
              </div>

              {/* Filters */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Filtros</h3>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Campanhas</label>
                  <Select value={selectedCampaigns.join(",")} onValueChange={(value) => setSelectedCampaigns(value ? value.split(",") : [])}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione campanhas..." />
                    </SelectTrigger>
                    <SelectContent>
                      {uniqueCampaigns.map((campaign) => (
                        <SelectItem key={campaign} value={campaign}>
                          {campaign}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Adsets</label>
                  <Select value={selectedAdsets.join(",")} onValueChange={(value) => setSelectedAdsets(value ? value.split(",") : [])}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione adsets..." />
                    </SelectTrigger>
                    <SelectContent>
                      {uniqueAdsets.map((adset) => (
                        <SelectItem key={adset} value={adset}>
                          {adset}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Anúncios</label>
                  <Select value={selectedAds.join(",")} onValueChange={(value) => setSelectedAds(value ? value.split(",") : [])}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione anúncios..." />
                    </SelectTrigger>
                    <SelectContent>
                      {uniqueAds.map((ad) => (
                        <SelectItem key={ad} value={ad}>
                          {ad}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Min. Impressões</label>
                    <input type="number" value={minImpressions} onChange={(e) => setMinImpressions(Number(e.target.value))} className="w-full h-10 px-3 py-2 border border-border bg-input text-text rounded-md" min="0" step="500" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Min. Investimento</label>
                    <input type="number" value={minSpend} onChange={(e) => setMinSpend(Number(e.target.value))} className="w-full h-10 px-3 py-2 border border-border bg-input text-text rounded-md" min="0" step="5" />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Dashboard Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Metrics Cards */}
        <div className="lg:col-span-2">
          <MetricsCards data={aggregatedData} resultsValue={resultsValue} costValue={costValue} />
        </div>

        {/* Right Column - Retention Chart */}
        <div className="lg:col-span-1">
          <RetentionChart videoPlayCurve={aggregatedData.video_play_curve_actions} />
        </div>
      </div>

      {/* Summary Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Resumo dos Packs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {packs.map((pack) => {
              // Usar stats do pack (preferencialmente do backend)
              const uniqueAds = pack.stats?.uniqueAds || 0;
              return (
                <div key={pack.id} className="bg-border p-4 rounded-lg">
                  <h4 className="font-semibold">{pack.name}</h4>
                  <p className="text-sm text-muted-foreground">{uniqueAds} anúncios únicos</p>
                  <p className="text-sm text-muted-foreground">
                    {pack.date_start} - {pack.date_stop}
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

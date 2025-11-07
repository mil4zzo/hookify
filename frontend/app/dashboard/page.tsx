"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "@/lib/hooks/useRequireAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingState, EmptyState } from "@/components/common/States";
import { useClientAuth, useClientPacks } from "@/lib/hooks/useClientSession";
import { MetricsCards } from "@/components/dashboard/MetricsCards";
import { RetentionChart } from "@/components/charts/RetentionChart";
import { aggregateAdsData, AggregatedData, AdData } from "@/lib/utils/aggregation";
import { getAggregatedPackStatistics } from "@/lib/utils/adCounting";
import { DateRangeFilter } from "@/components/common/DateRangeFilter";
import { filterAdsByDateRange } from "@/lib/utils/dateFilters";
import { PageHeader } from "@/components/layout/PageHeader";
import { IconSettings, IconFilter } from "@tabler/icons-react";
import { usePageConfig } from "@/lib/hooks/usePageConfig";
import { usePacksAds } from "@/lib/hooks/usePacksAds";

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
  const [dateRange, setDateRange] = useState<{ start?: string; end?: string }>({});

  // Store hooks
  const { isAuthenticated, isClient } = useClientAuth();
  const { packs } = useClientPacks();
  const { status } = useRequireAuth("/login");

  // Buscar ads de todos os packs usando cache IndexedDB
  const { allAds, isLoading: isLoadingAds } = usePacksAds(packs);

  // Guard centralizado cobre o redirecionamento

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

  // Client-side only rendering
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
          <Button variant="outline" onClick={() => setShowAdvancedOptions(!showAdvancedOptions)} className="flex items-center gap-2">
            <IconSettings className="w-4 h-4" />
            Opções Avançadas
          </Button>
        }
      />

      {/* Global Date Range Filter */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <DateRangeFilter label="Período (Data do Insight)" value={dateRange} onChange={setDateRange} />
          </div>
        </CardContent>
      </Card>

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

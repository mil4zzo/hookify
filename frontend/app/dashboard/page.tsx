"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingState, ErrorState, EmptyState } from "@/components/common/States";
import { useClientAuth, useClientPacks } from "@/lib/hooks/useClientSession";
import { MetricsCards } from "@/components/dashboard/MetricsCards";
import { RetentionChart } from "@/components/charts/RetentionChart";
import { aggregateAdsData, AggregatedData, AdData } from "@/lib/utils/aggregation";
import { BarChart3, Settings, Filter } from "lucide-react";

export default function DashboardPage() {
  const [resultsColumn, setResultsColumn] = useState<string>("");
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [minImpressions, setMinImpressions] = useState<number>(3000);
  const [minSpend, setMinSpend] = useState<number>(0);
  const [selectedCampaigns, setSelectedCampaigns] = useState<string[]>([]);
  const [selectedAdsets, setSelectedAdsets] = useState<string[]>([]);
  const [selectedAds, setSelectedAds] = useState<string[]>([]);

  // Store hooks
  const { isAuthenticated, isClient } = useClientAuth();
  const { packs } = useClientPacks();

  // Coleta todos os anúncios dos packs usando useMemo para evitar recálculos desnecessários
  const allAds: AdData[] = useMemo(() => {
    return packs.reduce((acc: AdData[], pack) => {
      return [...acc, ...pack.ads];
    }, []);
  }, [packs]);

  // Extrair valores únicos de action_type dos arrays conversions e cost_per_conversion
  const uniqueConversionTypes = useMemo(() => {
    const types = new Set<string>();
    allAds.forEach((ad) => {
      ad.conversions?.forEach((conversion) => {
        types.add(conversion.action_type);
      });
    });
    return Array.from(types).sort();
  }, [allAds]);

  const uniqueCostPerConversionTypes = useMemo(() => {
    const types = new Set<string>();
    allAds.forEach((ad) => {
      ad.cost_per_conversion?.forEach((cost) => {
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
  const uniqueCampaigns = useMemo(() => [...new Set(allAds.map((ad) => ad.campaign_name))], [allAds]);
  const uniqueAdsets = useMemo(() => [...new Set(allAds.map((ad) => ad.adset_name))], [allAds]);
  const uniqueAds = useMemo(() => [...new Set(allAds.map((ad) => ad.ad_name))], [allAds]);

  // Aplica filtros e recalcula dados agregados usando useMemo
  const aggregatedData = useMemo(() => {
    if (allAds.length === 0) {
      return null;
    }

    let filteredAds = allAds;

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
  }, [allAds, selectedCampaigns, selectedAdsets, selectedAds, minImpressions, minSpend]);

  // Calcular valores dinâmicos para conversões selecionadas
  const { resultsValue, costValue } = useMemo(() => {
    if (!resultsColumn || !aggregatedData) {
      return { resultsValue: 0, costValue: 0 };
    }

    const actionType = resultsColumn.split(".").slice(1).join(".");

    // Aplicar os mesmos filtros que foram aplicados em aggregatedData
    let filteredAds = allAds;

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
  }, [resultsColumn, allAds, aggregatedData, selectedCampaigns, selectedAdsets, selectedAds, minImpressions, minSpend]);

  // Client-side only rendering
  if (!isClient) {
    return (
      <div className="container mx-auto px-4 py-8">
        <LoadingState label="Carregando..." />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="container mx-auto px-4 py-8">
        <EmptyState message="Você precisa estar logado para acessar o dashboard" />
      </div>
    );
  }

  if (packs.length === 0) {
    return (
      <div className="container mx-auto px-4 py-8">
        <EmptyState message="Nenhum pack carregado. Carregue packs de anúncios na página ADs Loader para visualizar o dashboard." />
      </div>
    );
  }

  if (!aggregatedData) {
    return (
      <div className="container mx-auto px-4 py-8">
        <LoadingState label="Processando dados..." />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold flex items-center gap-3">
              <BarChart3 className="w-10 h-10 text-brand" />
              Dashboard
            </h1>
            <p className="text-muted text-lg mt-2">
              Resumo dos seus anúncios carregados ({allAds.length} anúncios de {packs.length} packs)
            </p>
          </div>

          <Button variant="outline" onClick={() => setShowAdvancedOptions(!showAdvancedOptions)} className="flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Opções Avançadas
          </Button>
        </div>

        {/* Advanced Options */}
        {showAdvancedOptions && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Filter className="w-5 h-5" />
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
                    <div className="w-full h-10 px-3 py-2 border border-surface2 bg-gray-100 text-text rounded-md flex items-center">
                      <span className="text-sm text-muted">{resultsColumn ? `cost_per_conversion.${resultsColumn.split(".").slice(1).join(".")}` : "Nenhum evento selecionado"}</span>
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
                      <input type="number" value={minImpressions} onChange={(e) => setMinImpressions(Number(e.target.value))} className="w-full h-10 px-3 py-2 border border-surface2 bg-surface text-text rounded-md" min="0" step="500" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Min. Investimento</label>
                      <input type="number" value={minSpend} onChange={(e) => setMinSpend(Number(e.target.value))} className="w-full h-10 px-3 py-2 border border-surface2 bg-surface text-text rounded-md" min="0" step="5" />
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
              {packs.map((pack) => (
                <div key={pack.id} className="bg-surface2 p-4 rounded-lg">
                  <h4 className="font-semibold">{pack.name}</h4>
                  <p className="text-sm text-muted">{pack.ads.length} anúncios</p>
                  <p className="text-sm text-muted">
                    {pack.date_start} - {pack.date_stop}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

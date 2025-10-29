"use client";

import { useState, useEffect } from "react";
import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { LoadingState, ErrorState, EmptyState } from "@/components/common/States";
import { useMe, useAdAccounts } from "@/lib/api/hooks";
import { useClientAuth, useClientPacks, useClientAdAccounts } from "@/lib/hooks/useClientSession";
import { showSuccess, showError } from "@/lib/utils/toast";
import { api } from "@/lib/api/endpoints";
import { Calendar, Filter, Plus, Trash2, DollarSign, BarChart3, Target, Users, Eye, Download, ArrowUpDown, Code } from "lucide-react";
import { useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel, createColumnHelper, flexRender, ColumnDef } from "@tanstack/react-table";

import { FilterRule } from "@/lib/api/schemas";

interface PackFormData {
  name: string;
  adaccount_id: string;
  date_start: string;
  date_stop: string;
  level: "campaign" | "adset" | "ad";
  filters: FilterRule[];
}

interface Pack {
  id: string;
  name: string;
  adaccount_id: string;
  date_start: string;
  date_stop: string;
  level: "campaign" | "adset" | "ad";
  filters: FilterRule[];
  ads: any[]; // Dados formatados pelo backend
  created_at: string;
  updated_at: string;
}

const FILTER_FIELDS = [
  { label: "Campaign Name", value: "campaign.name" },
  { label: "Adset Name", value: "adset.name" },
  { label: "Ad Name", value: "ad.name" },
];

const FILTER_OPERATORS = ["CONTAIN", "EQUAL", "NOT_EQUAL", "NOT_CONTAIN", "STARTS_WITH", "ENDS_WITH"];

// TanStack Table column helper
const columnHelper = createColumnHelper<any>();

// Função para exportar dados para CSV
const exportToCSV = (data: any[], filename: string) => {
  if (!data || data.length === 0) return;

  const headers = ["Campaign ID", "Campaign Name", "Adset ID", "Adset Name", "Ad ID", "Ad Name", "Status", "Spend", "Impressions", "Clicks", "CTR", "CPC", "CPM", "Conversions", "Cost per Conversion"];

  const csvContent = [headers.join(","), ...data.map((ad) => [ad.campaign_id || "", `"${(ad.campaign_name || "").replace(/"/g, '""')}"`, ad.adset_id || "", `"${(ad.adset_name || "").replace(/"/g, '""')}"`, ad.ad_id || "", `"${(ad.ad_name || "").replace(/"/g, '""')}"`, ad.effective_status || "", ad.spend || 0, ad.impressions || 0, ad.clicks || 0, ad.ctr ? (ad.ctr * 100).toFixed(2) : 0, ad.cpc || 0, ad.cpm || 0, ad.conversions || 0, ad.cost_per_conversion || 0].join(","))].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `${filename}.csv`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// Função auxiliar para formatar cabeçalhos das colunas
const formatColumnHeader = (key: string): string => {
  return key
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

// Função auxiliar para formatar valores das células
const formatCellValue = (value: any, key: string, formatCurrency: (value: number) => string): React.ReactNode => {
  if (value === null || value === undefined) return <span>—</span>;

  // IDs - formatação monospace
  if (key.includes("_id") || key.includes("id")) {
    return <span className="font-mono text-xs">{String(value)}</span>;
  }

  // Status - cores especiais
  if (key.includes("status")) {
    const status = String(value);
    const colorClass = status === "ACTIVE" ? "bg-green-500/20 text-green-500" : status === "PAUSED" ? "bg-yellow-500/20 text-yellow-500" : "bg-red-500/20 text-red-500";
    return <span className={`px-2 py-1 rounded text-xs ${colorClass}`}>{status}</span>;
  }

  // Valores monetários
  if (key.includes("spend") || key.includes("cost") || key.includes("cpc") || key.includes("cpm")) {
    const numValue = Number(value);
    return <span className="text-right">{numValue ? formatCurrency(numValue) : "—"}</span>;
  }

  // Percentuais
  if (key.includes("ctr") || key.includes("rate") || key.includes("p50") || key.includes("retention")) {
    const numValue = Number(value);
    return <span className="text-right">{numValue ? `${(numValue * 100).toFixed(2)}%` : "—"}</span>;
  }

  // Números grandes (impressions, reach, clicks, etc.)
  if (typeof value === "number" && (key.includes("impressions") || key.includes("reach") || key.includes("clicks") || key.includes("plays"))) {
    return <span className="text-right">{value.toLocaleString()}</span>;
  }

  // Arrays - mostra conteúdo expandido para debug
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-xs text-gray-500">[]</span>;
    if (value.length <= 3) {
      return <span className="text-xs">{JSON.stringify(value)}</span>;
    }
    return (
      <span className="text-xs" title={JSON.stringify(value)}>
        [{value.length} items] {JSON.stringify(value.slice(0, 2))}...
      </span>
    );
  }

  // Objetos - mostra como JSON para debug
  if (typeof value === "object" && value !== null) {
    const jsonStr = JSON.stringify(value);
    if (jsonStr.length <= 100) {
      return <span className="text-xs font-mono">{jsonStr}</span>;
    }
    return (
      <span className="text-xs font-mono" title={jsonStr}>
        {jsonStr.substring(0, 100)}...
      </span>
    );
  }

  // Strings longas (como creative.body, creative.title)
  if (typeof value === "string" && value.length > 50) {
    return <span title={value}>{value.substring(0, 50)}...</span>;
  }

  // Padrão - string simples
  return <span>{String(value)}</span>;
};

// Função auxiliar para determinar tamanho da coluna
const getColumnSize = (key: string): number => {
  if (key.includes("_id")) return 120;
  if (key.includes("name")) return 200;
  if (key.includes("status")) return 100;
  if (key.includes("creative")) return 150;
  if (key.includes("retention")) return 120;
  if (key.includes("conversion")) return 150;
  return 100;
};

// Definição das colunas da tabela usando Smart Columns (Debug Mode - mostra todos os campos)
const createSmartColumns = (data: any[], formatCurrency: (value: number) => string): ColumnDef<any>[] => {
  if (!data || data.length === 0) return [];

  // Campos importantes que devem aparecer primeiro
  const priorityFields = ["campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name", "effective_status", "status", "spend", "impressions", "reach", "frequency", "clicks", "inline_link_clicks", "ctr", "website_ctr", "cpc", "cpm", "total_plays", "total_thruplays", "video_watched_p50", "conversions", "conversions.purchase", "conversions.initiate_checkout", "cost_per_conversion", "cost_per_conversion.purchase", "creative.call_to_action_type", "creative.object_type", "creative.body", "creative.title"];

  const allKeys = [...new Set(data.flatMap((item) => Object.keys(item)))];

  // Ordena: campos prioritários primeiro, depois TODOS os outros campos (debug mode)
  const sortedKeys = [...priorityFields.filter((key) => allKeys.includes(key)), ...allKeys.filter((key) => !priorityFields.includes(key))];

  return sortedKeys.map((key) => {
    return columnHelper.accessor(key, {
      header: formatColumnHeader(key),
      cell: (info) => formatCellValue(info.getValue(), key, formatCurrency),
      size: getColumnSize(key),
    });
  });
};

// Componente TanStack Table
const TanStackTableComponent = ({ data, formatCurrency }: { data: any[]; formatCurrency: (value: number) => string }) => {
  const columns = createSmartColumns(data, formatCurrency);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    enableSorting: true,
    enableFilters: true,
  });

  return (
    <div className="w-full">
      <table className="w-full text-sm border-collapse">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="bg-surface2">
              {headerGroup.headers.map((header) => (
                <th key={header.id} className="border border-surface2 p-2 text-left font-medium" style={{ width: header.getSize() }}>
                  {header.isPlaceholder ? null : (
                    <div className={`flex items-center gap-1 ${header.column.getCanSort() ? "cursor-pointer select-none hover:text-brand" : ""}`} onClick={header.column.getToggleSortingHandler()}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getCanSort() && <ArrowUpDown className="w-3 h-3" />}
                      {{
                        asc: " 🔼",
                        desc: " 🔽",
                      }[header.column.getIsSorted() as string] ?? null}
                    </div>
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-surface2/50">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="border border-surface2 p-2">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {data.length === 0 && <div className="text-center py-8 text-muted">Nenhum dado encontrado</div>}
    </div>
  );
};

export default function AdsLoaderPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [packToRemove, setPackToRemove] = useState<{ id: string; name: string; adsCount: number } | null>(null);
  const [previewPack, setPreviewPack] = useState<any>(null);
  const [debugInfo, setDebugInfo] = useState<string>("");
  const [jsonViewerPack, setJsonViewerPack] = useState<any>(null);
  const [formData, setFormData] = useState<PackFormData>({
    name: "",
    adaccount_id: "",
    date_start: new Date().toISOString().split("T")[0],
    date_stop: new Date().toISOString().split("T")[0],
    level: "ad",
    filters: [],
  });

  // Store hooks
  const { isAuthenticated, user, isClient } = useClientAuth();
  const { packs, addPack, removePack } = useClientPacks();
  const { adAccounts } = useClientAdAccounts();

  // API hooks
  const { data: me, isLoading: meLoading, error: meError } = useMe();
  const { data: adAccountsData, isLoading: adAccountsLoading, error: adAccountsError } = useAdAccounts();

  // Update pack name when packs change
  useEffect(() => {
    if (packs.length > 0) {
      setFormData((prev) => ({
        ...prev,
        name: `Pack ${packs.length + 1}`,
      }));
    }
  }, [packs.length]);

  const handleAddFilter = () => {
    setFormData((prev) => ({
      ...prev,
      filters: [...prev.filters, { field: "campaign.name", operator: "CONTAIN", value: "" }],
    }));
  };

  const handleRemoveFilter = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      filters: prev.filters.filter((_, i) => i !== index),
    }));
  };

  const handleFilterChange = (index: number, field: keyof FilterRule, value: string) => {
    setFormData((prev) => ({
      ...prev,
      filters: prev.filters.map((filter, i) => (i === index ? { ...filter, [field]: value } : filter)),
    }));
  };

  const validateForm = (): string | null => {
    if (!formData.name.trim()) {
      return "Nome do pack é obrigatório";
    }
    if (!formData.adaccount_id) {
      return "Selecione uma conta de anúncios";
    }
    if (!formData.date_start || !formData.date_stop) {
      return "Selecione o período de datas";
    }
    if (new Date(formData.date_start) > new Date(formData.date_stop)) {
      return "Data de início deve ser anterior à data de fim";
    }

    // Validate filters
    for (const filter of formData.filters) {
      if (!filter.value.trim()) {
        return "Todos os filtros devem ter um valor";
      }
    }

    return null;
  };

  const handleLoadPack = async () => {
    const validationError = validateForm();
    if (validationError) {
      showError({ message: validationError });
      return;
    }

    setIsLoading(true);
    try {
      // Start the async job
      const result = await api.facebook.startAdsJob({
        adaccount_id: formData.adaccount_id,
        date_start: formData.date_start,
        date_stop: formData.date_stop,
        level: formData.level,
        limit: 1000,
        filters: formData.filters,
      });

      if (!result.job_id) {
        throw new Error("Falha ao iniciar job de busca de anúncios");
      }

      // Poll for completion
      let completed = false;
      let attempts = 0;
      const maxAttempts = 150; // 5 minutes max

      while (!completed && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds

        try {
          const progress = await api.facebook.getJobProgress(result.job_id);
          const rawAds = Array.isArray((progress as any)?.data) ? (progress as any).data : Array.isArray((progress as any)?.data?.data) ? (progress as any).data.data : [];

          // Log detalhado para debug
          console.log("=== FRONTEND DEBUG - Progresso do Job ===");
          console.log("Status:", progress.status);
          console.log("Progress:", progress.progress);
          console.log("Message:", progress.message);
          console.log("Raw ads length:", rawAds.length);
          console.log("Raw ads sample:", rawAds.slice(0, 2));

          // Atualizar feedback visual
          setDebugInfo(`${progress.message || "Processando..."} | Anúncios coletados: ${rawAds.length}`);

          if (progress.status === "completed" && Array.isArray(rawAds)) {
            // Dados já vêm formatados do backend
            const formattedAds = rawAds as any[];

            // Evitar criar pack vazio
            if (!formattedAds || formattedAds.length === 0) {
              showError({ message: "Nenhum anúncio retornado para os parâmetros selecionados." });
              completed = true;
              break;
            }

            // Create pack
            const pack = {
              id: `pack_${Date.now()}`,
              name: formData.name.trim(),
              adaccount_id: formData.adaccount_id,
              date_start: formData.date_start,
              date_stop: formData.date_stop,
              level: formData.level,
              filters: formData.filters,
              ads: formattedAds, // Dados já formatados pelo backend
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };

            addPack(pack);
            showSuccess(`Pack "${formData.name}" criado com ${formattedAds.length} anúncios!`);

            // Reset form and close dialog
            setFormData((prev) => ({
              ...prev,
              name: `Pack ${packs.length + 2}`,
              filters: [],
            }));
            setIsDialogOpen(false);
            setDebugInfo(""); // Limpar debug info
            completed = true;
          } else if (progress.status === "failed" || progress.status === "error") {
            throw new Error(progress.message || "Job falhou");
          }
        } catch (error) {
          console.error("Error polling job progress:", error);
          throw error;
        }

        attempts++;
      }

      if (!completed) {
        throw new Error("Timeout: Job demorou mais que 5 minutos para completar");
      }
    } catch (error) {
      showError(error as any);
    } finally {
      setIsLoading(false);
      setDebugInfo(""); // Limpar debug info ao finalizar
    }
  };

  const handleRemovePack = (packId: string) => {
    const pack = packs.find((p) => p.id === packId);
    if (!pack) return;

    setPackToRemove({
      id: pack.id,
      name: pack.name,
      adsCount: pack.ads.length,
    });
  };

  const confirmRemovePack = () => {
    if (!packToRemove) return;

    removePack(packToRemove.id);
    showSuccess(`Pack "${packToRemove.name}" removido com sucesso!`);
    setPackToRemove(null);
  };

  const cancelRemovePack = () => {
    setPackToRemove(null);
  };

  const handlePreviewPack = (pack: any) => {
    setPreviewPack(pack);
  };

  const handleViewJson = (pack: any) => {
    setJsonViewerPack(pack);
  };

  const closePreview = () => {
    setPreviewPack(null);
  };

  const closeJsonViewer = () => {
    setJsonViewerPack(null);
  };

  const handleExportData = () => {
    if (previewPack?.ads) {
      exportToCSV(previewPack.ads, `${previewPack.name}_ads_data`);
      showSuccess(`Dados exportados para ${previewPack.name}_ads_data.csv`);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "USD",
    }).format(value);
  };

  const formatDate = (dateString: string) => {
    // Corrigir problema de timezone - usar apenas a data sem conversão de timezone
    const [year, month, day] = dateString.split("-");
    return `${day}/${month}/${year}`;
  };

  const getAccountName = (accountId: string) => {
    const account = Array.isArray(adAccountsData) ? adAccountsData.find((acc: any) => acc.id === accountId) : null;
    return account?.name || accountId;
  };

  const getFilterFieldLabel = (fieldValue: string) => {
    const field = FILTER_FIELDS.find((f) => f.value === fieldValue);
    return field ? field.label : fieldValue;
  };

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
        <EmptyState message="Você precisa estar logado para carregar packs de anúncios" />
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
              ADs Loader
            </h1>
            <p className="text-muted text-lg mt-2">Carregue seus packs de anúncios e combine-os para análise</p>
          </div>

          {/* User Profile */}
          {user && (
            <div className="flex items-center gap-3 bg-surface2 p-4 rounded-lg">
              {user.picture?.data?.url && <img src={user.picture.data.url} alt="Profile" className="w-12 h-12 rounded-full" />}
              <div>
                <p className="font-semibold">{user.name}</p>
                <p className="text-sm text-muted">{user.email}</p>
              </div>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-brand/20 rounded-lg">
                  <Target className="w-6 h-6 text-brand" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{packs.length}</p>
                  <p className="text-sm text-muted">Packs Carregados</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-500/20 rounded-lg">
                  <BarChart3 className="w-6 h-6 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{packs.reduce((total, pack) => total + pack.ads.length, 0)}</p>
                  <p className="text-sm text-muted">Total de Anúncios</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/20 rounded-lg">
                  <Users className="w-6 h-6 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{packs.reduce((total, pack) => total + new Set(pack.ads.map((ad) => ad.campaign_id)).size, 0)}</p>
                  <p className="text-sm text-muted">Campanhas</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-yellow-500/20 rounded-lg">
                  <DollarSign className="w-6 h-6 text-yellow-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{formatCurrency(packs.reduce((total, pack) => total + pack.ads.reduce((sum, ad) => sum + (ad.spend || 0), 0), 0))}</p>
                  <p className="text-sm text-muted">Investimento Total</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Load Pack Button */}
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-semibold">Packs de Anúncios</h2>
            <p className="text-muted">Gerencie seus packs carregados</p>
          </div>

          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="flex items-center gap-2">
                <Plus className="w-4 h-4" />
                Carregar Pack
              </Button>
            </DialogTrigger>

            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Carregar Pack de Anúncios</DialogTitle>
                <DialogDescription>Configure os parâmetros para carregar um novo pack de anúncios</DialogDescription>
              </DialogHeader>

              <div className="space-y-6">
                {/* Pack Name */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Nome do Pack</label>
                  <Input placeholder="Ex: Black Friday Campaign, Q4 Performance, etc." value={formData.name} onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))} />
                  <p className="text-xs text-muted">Dê um nome descritivo para identificar facilmente seu pack</p>
                </div>

                {/* Ad Account */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Conta de Anúncios</label>
                  <select value={formData.adaccount_id} onChange={(e) => setFormData((prev) => ({ ...prev, adaccount_id: e.target.value }))} className="w-full h-10 px-3 py-2 border border-surface2 bg-surface text-text rounded-md">
                    <option value="">Selecione uma conta...</option>
                    {Array.isArray(adAccountsData) &&
                      adAccountsData.map((account: any) => (
                        <option key={account.id} value={account.id}>
                          {account.name} - {account.id}
                        </option>
                      ))}
                  </select>
                </div>

                {/* Date Range */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Data Início</label>
                    <Input type="date" value={formData.date_start} onChange={(e) => setFormData((prev) => ({ ...prev, date_start: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Data Fim</label>
                    <Input type="date" value={formData.date_stop} onChange={(e) => setFormData((prev) => ({ ...prev, date_stop: e.target.value }))} />
                  </div>
                </div>

                {/* Level */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Nível</label>
                  <select value={formData.level} onChange={(e) => setFormData((prev) => ({ ...prev, level: e.target.value as any }))} className="w-full h-10 px-3 py-2 border border-surface2 bg-surface text-text rounded-md">
                    <option value="campaign">Campaign</option>
                    <option value="adset">Adset</option>
                    <option value="ad">Ad</option>
                  </select>
                </div>

                {/* Filters */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <Filter className="w-4 h-4" />
                      Filtros
                    </label>
                    <Button type="button" variant="outline" size="sm" onClick={handleAddFilter}>
                      <Plus className="w-4 h-4 mr-1" />
                      Adicionar Filtro
                    </Button>
                  </div>

                  {formData.filters.map((filter, index) => (
                    <div key={index} className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-4">
                        <select value={filter.field} onChange={(e) => handleFilterChange(index, "field", e.target.value)} className="w-full h-10 px-3 py-2 border border-surface2 bg-surface text-text rounded-md text-sm">
                          {FILTER_FIELDS.map((field) => (
                            <option key={field.value} value={field.value}>
                              {field.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-3">
                        <select value={filter.operator} onChange={(e) => handleFilterChange(index, "operator", e.target.value)} className="w-full h-10 px-3 py-2 border border-surface2 bg-surface text-text rounded-md text-sm">
                          {FILTER_OPERATORS.map((op) => (
                            <option key={op} value={op}>
                              {op.replace("_", " ")}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-4">
                        <Input placeholder="Valor..." value={filter.value} onChange={(e) => handleFilterChange(index, "value", e.target.value)} />
                      </div>
                      <div className="col-span-1">
                        <Button type="button" variant="outline" size="sm" onClick={() => handleRemoveFilter(index)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}

                  {formData.filters.length === 0 && <p className="text-sm text-muted text-center py-4">Nenhum filtro aplicado - todos os anúncios serão carregados</p>}
                </div>

                {/* Submit Button */}
                <Button onClick={handleLoadPack} disabled={isLoading} className="w-full" size="lg">
                  {isLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                      Carregando Anúncios...
                    </>
                  ) : (
                    <>
                      <BarChart3 className="w-4 h-4 mr-2" />
                      Carregar Pack
                    </>
                  )}
                </Button>

                {/* Debug Info */}
                {isLoading && debugInfo && (
                  <div className="mt-4 p-3 bg-surface2 rounded-lg">
                    <p className="text-sm text-muted">
                      <strong>Debug:</strong> {debugInfo}
                    </p>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Packs Grid */}
        {packs.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <BarChart3 className="w-16 h-16 text-muted mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">Nenhum Pack Carregado</h3>
              <p className="text-muted mb-6">Carregue seu primeiro pack de anúncios para começar a análise</p>
              <Button onClick={() => setIsDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Carregar Primeiro Pack
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {packs.map((pack) => (
              <Card key={pack.id} className="hover:shadow-lg transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{pack.name}</CardTitle>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => handlePreviewPack(pack)} title="Visualizar tabela">
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleViewJson(pack)} title="Ver JSON">
                        <Code className="w-4 h-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleRemovePack(pack.id)} title="Remover pack">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <CardDescription>
                    {formatDate(pack.date_start)} - {formatDate(pack.date_stop)}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-2xl font-bold text-brand">{new Set(pack.ads.map((ad) => ad.campaign_id)).size}</p>
                      <p className="text-xs text-muted">Campanhas</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-green-500">{new Set(pack.ads.map((ad) => ad.adset_id)).size}</p>
                      <p className="text-xs text-muted">Adsets</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-blue-500">{pack.ads.length}</p>
                      <p className="text-xs text-muted">Anúncios</p>
                    </div>
                  </div>

                  {/* Account */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Conta:</p>
                    <p className="text-sm text-muted">{getAccountName(pack.adaccount_id)}</p>
                  </div>

                  {/* Total Spent */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Investimento Total:</p>
                    <p className="text-lg font-bold text-yellow-500">{formatCurrency(pack.ads.reduce((sum, ad) => sum + (ad.spend || 0), 0))}</p>
                  </div>

                  {/* Level */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Nível:</p>
                    <span className="inline-block px-2 py-1 bg-surface2 rounded text-xs font-medium">{pack.level.toUpperCase()}</span>
                  </div>

                  {/* Filters */}
                  {pack.filters && pack.filters.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Filtros aplicados:</p>
                      <div className="space-y-1">
                        {pack.filters.map((filter: FilterRule, index: number) => (
                          <div key={index} className="text-xs text-muted bg-surface2 p-2 rounded">
                            <span className="font-medium">{getFilterFieldLabel(filter.field)}</span> {filter.operator.toLowerCase().replace("_", " ")} <span className="font-medium">"{filter.value}"</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Preview Modal */}
      <Dialog open={!!previewPack} onOpenChange={(open) => !open && closePreview()}>
        <DialogContent className="max-w-7xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5" />
              Preview: {previewPack?.name}
            </DialogTitle>
            <DialogDescription>Visualização completa dos dados formatados pelo sistema ({previewPack?.ads?.length || 0} anúncios)</DialogDescription>
          </DialogHeader>

          {previewPack && (
            <div className="overflow-auto max-h-[70vh]">
              <div className="bg-surface2 p-4 rounded-lg mb-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="font-medium text-muted">Período:</p>
                    <p>
                      {formatDate(previewPack.date_start)} - {formatDate(previewPack.date_stop)}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-muted">Conta:</p>
                    <p>{getAccountName(previewPack.adaccount_id)}</p>
                  </div>
                  <div>
                    <p className="font-medium text-muted">Nível:</p>
                    <p className="uppercase">{previewPack.level}</p>
                  </div>
                  <div>
                    <p className="font-medium text-muted">Total Investido:</p>
                    <p className="font-bold text-yellow-500">{formatCurrency(previewPack.ads.reduce((sum: number, ad: any) => sum + (ad.spend || 0), 0))}</p>
                  </div>
                </div>
              </div>

              {/* TanStack Table */}
              <div className="overflow-x-auto">
                <TanStackTableComponent data={previewPack.ads} formatCurrency={formatCurrency} />
              </div>
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={handleExportData} className="flex items-center gap-2">
              <Download className="w-4 h-4" />
              Exportar CSV
            </Button>
            <Button variant="outline" onClick={closePreview}>
              Fechar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* JSON Viewer Modal */}
      <Dialog open={!!jsonViewerPack} onOpenChange={(open) => !open && closeJsonViewer()}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Code className="w-5 h-5" />
              JSON Bruto: {jsonViewerPack?.name}
            </DialogTitle>
            <DialogDescription>Dados brutos do pack em formato JSON ({jsonViewerPack?.ads?.length || 0} anúncios)</DialogDescription>
          </DialogHeader>

          {jsonViewerPack && (
            <div className="overflow-auto max-h-[70vh]">
              <div className="bg-surface2 p-4 rounded-lg mb-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="font-medium text-muted">Período:</p>
                    <p>
                      {formatDate(jsonViewerPack.date_start)} - {formatDate(jsonViewerPack.date_stop)}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-muted">Nível:</p>
                    <p className="capitalize">{jsonViewerPack.level}</p>
                  </div>
                  <div>
                    <p className="font-medium text-muted">Anúncios:</p>
                    <p>{jsonViewerPack.ads?.length || 0}</p>
                  </div>
                  <div>
                    <p className="font-medium text-muted">Filtros:</p>
                    <p>{jsonViewerPack.filters?.length || 0}</p>
                  </div>
                </div>
              </div>

              <div className="bg-black rounded-lg p-4 overflow-auto">
                <pre className="text-green-400 text-xs font-mono whitespace-pre-wrap">{JSON.stringify(jsonViewerPack, null, 2)}</pre>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={closeJsonViewer}>
              Fechar
            </Button>
            <Button
              onClick={() => {
                if (jsonViewerPack) {
                  const blob = new Blob([JSON.stringify(jsonViewerPack, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `${jsonViewerPack.name}_raw_data.json`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  URL.revokeObjectURL(url);
                  showSuccess(`JSON exportado para ${jsonViewerPack.name}_raw_data.json`);
                }
              }}
            >
              <Download className="w-4 h-4 mr-2" />
              Exportar JSON
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <Dialog open={!!packToRemove} onOpenChange={(open) => !open && setPackToRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Remoção</DialogTitle>
            <DialogDescription>Tem certeza que deseja remover o pack "{packToRemove?.name}"?</DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="bg-surface2 p-4 rounded-lg">
              <p className="text-sm text-muted mb-2">Esta ação irá remover:</p>
              <ul className="text-sm space-y-1">
                <li>
                  • <strong>{packToRemove?.adsCount}</strong> anúncios
                </li>
                <li>• Todos os dados e métricas associados</li>
                <li>
                  • Esta ação <strong>não pode ser desfeita</strong>
                </li>
              </ul>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={cancelRemovePack}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmRemovePack}>
              <Trash2 className="w-4 h-4 mr-2" />
              Remover Pack
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

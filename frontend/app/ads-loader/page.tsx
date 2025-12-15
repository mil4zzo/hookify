"use client";

import { useState, useEffect, useRef } from "react";
import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Modal } from "@/components/common/Modal";
import { LoadingState, EmptyState } from "@/components/common/States";
import { DateRangeFilter, DateRangeValue } from "@/components/common/DateRangeFilter";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useMe, useAdAccountsDb, useInvalidatePackAds } from "@/lib/api/hooks";
import { GoogleSheetIntegrationDialog } from "@/components/ads/GoogleSheetIntegrationDialog";
import { useClientAuth, useClientPacks, useClientAdAccounts } from "@/lib/hooks/useClientSession";
import { useOnboardingGate } from "@/lib/hooks/useOnboardingGate";
import { showSuccess, showError, showWarning, showProgressToast, updateProgressToast, finishProgressToast } from "@/lib/utils/toast";
import { api } from "@/lib/api/endpoints";
import { IconCalendar, IconFilter, IconPlus, IconTrash, IconChartBar, IconEye, IconDownload, IconArrowsSort, IconCode, IconLoader2, IconCircleCheck, IconCircleX, IconCircleDot, IconInfoCircle, IconRotateClockwise, IconRefresh, IconDotsVertical, IconPencil, IconTableExport } from "@tabler/icons-react";
import { useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel, createColumnHelper, flexRender, ColumnDef } from "@tanstack/react-table";

import { FilterRule } from "@/lib/api/schemas";
import { AdsPack } from "@/lib/types";
import { getAggregatedPackStatistics, getAdStatistics } from "@/lib/utils/adCounting";
import { useFormatCurrency } from "@/lib/utils/currency";
import { PageHeader } from "@/components/layout/PageHeader";
import { usePageConfig } from "@/lib/hooks/usePageConfig";
import { getTodayLocal, formatDateLocal } from "@/lib/utils/dateFilters";
import { usePacksLoading } from "@/components/layout/PacksLoader";
import { Skeleton } from "@/components/ui/skeleton";
import { filterVideoAds } from "@/lib/utils/filterVideoAds";

const STORAGE_KEY_DATE_RANGE = "hookify-ads-loader-date-range";

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

interface PackFormData {
  name: string;
  adaccount_id: string;
  date_start: string;
  date_stop: string;
  level: "campaign" | "adset" | "ad";
  filters: FilterRule[];
  auto_refresh?: boolean;
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
  stats?: {
    // Stats agregados do pack (calculados no backend)
    totalAds: number;
    uniqueAds: number;
    uniqueCampaigns: number;
    uniqueAdsets: number;
    totalSpend: number;
    totalClicks: number;
    totalImpressions: number;
    totalReach: number;
    totalInlineLinkClicks: number;
    totalPlays: number;
    totalThruplays: number;
    ctr: number;
    cpm: number;
    frequency: number;
  };
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
            <tr key={headerGroup.id} className="bg-border">
              {headerGroup.headers.map((header) => (
                <th key={header.id} className="border border-border p-2 text-left font-medium" style={{ width: header.getSize() }}>
                  {header.isPlaceholder ? null : (
                    <div className={`flex items-center gap-1 ${header.column.getCanSort() ? "cursor-pointer select-none hover:text-brand" : ""}`} onClick={header.column.getToggleSortingHandler()}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getCanSort() && <IconArrowsSort className="w-3 h-3" />}
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
            <tr key={row.id} className="hover:bg-border/50">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="border border-border p-2">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {data.length === 0 && <div className="text-center py-8 text-muted-foreground">Nenhum dado encontrado</div>}
    </div>
  );
};

export default function AdsLoaderPage() {
  const pageConfig = usePageConfig();
  const formatCurrency = useFormatCurrency();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [packToRemove, setPackToRemove] = useState<{ id: string; name: string; adsCount: number } | null>(null);
  const [packToRefresh, setPackToRefresh] = useState<{ id: string; name: string } | null>(null);
  const [packToDisableAutoRefresh, setPackToDisableAutoRefresh] = useState<{ id: string; name: string } | null>(null);
  const [packToRename, setPackToRename] = useState<{ id: string; name: string } | null>(null);
  const [newPackName, setNewPackName] = useState<string>("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTogglingAutoRefresh, setIsTogglingAutoRefresh] = useState<string | null>(null);
  const [isSyncingSheetIntegration, setIsSyncingSheetIntegration] = useState<string | null>(null);
  const [previewPack, setPreviewPack] = useState<any>(null);
  const [debugInfo, setDebugInfo] = useState<string>("");
  const [progressDetails, setProgressDetails] = useState<any>(null);
  const [jsonViewerPack, setJsonViewerPack] = useState<any>(null);
  const [sheetIntegrationPack, setSheetIntegrationPack] = useState<any | null>(null);

  // Refs para controlar cancelamento do carregamento
  const isCancelledRef = useRef(false);
  const createdPackIdRef = useRef<string | null>(null);

  // Função auxiliar para obter "hoje - 2 dias" no formato YYYY-MM-DD
  const getTwoDaysAgoLocal = (): string => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    return formatDateLocal(twoDaysAgo);
  };

  // Carregar dateRange do localStorage ou usar valores padrão
  const getInitialDateRange = () => {
    const saved = loadDateRange();
    if (saved) {
      return {
        date_start: saved.start || getTwoDaysAgoLocal(),
        date_stop: saved.end || getTodayLocal(),
      };
    }
    return {
      date_start: getTwoDaysAgoLocal(),
      date_stop: getTodayLocal(),
    };
  };

  const initialDateRange = getInitialDateRange();

  // Função auxiliar para gerar nome do pack com formatação
  const getNextPackName = () => {
    const nextNumber = packs.length + 1;
    return `Pack ${nextNumber.toString().padStart(2, "0")}`;
  };

  const [formData, setFormData] = useState<PackFormData>({
    name: "", // Será atualizado pelo useEffect quando o modal abrir
    adaccount_id: "",
    date_start: initialDateRange.date_start,
    date_stop: initialDateRange.date_stop,
    level: "ad", // Sempre "ad" - mantido apenas para compatibilidade com tipos
    filters: [],
    auto_refresh: initialDateRange.date_stop === getTodayLocal(), // Ativado se a data final for hoje
  });

  // Store hooks
  const { isAuthenticated, user, isClient } = useClientAuth();
  const { packs, addPack, removePack, updatePack } = useClientPacks();
  const { adAccounts } = useClientAdAccounts();
  const { authStatus, onboardingStatus } = useOnboardingGate("app");
  const { invalidatePackAds, invalidateAdPerformance } = useInvalidatePackAds();
  const { isLoading: isLoadingPacks } = usePacksLoading();

  // API hooks
  const { data: me, isLoading: meLoading, error: meError } = useMe();
  // Carrega ad accounts do Supabase para preencher store (fallback quando /me não disponível)
  const { data: adAccountsFromDb, isLoading: adAccountsLoading } = useAdAccountsDb();
  const adAccountsData = (me?.adaccounts ?? adAccounts ?? adAccountsFromDb ?? []) as any[];

  // Calculate statistics using centralized utility
  const packStats = getAggregatedPackStatistics(packs);

  // Update pack name when packs change or modal opens
  useEffect(() => {
    if (isDialogOpen) {
      const nextNumber = packs.length + 1;
      const packName = `Pack ${nextNumber.toString().padStart(2, "0")}`;
      // Manter o dateRange salvo no localStorage ao abrir o modal
      const savedDateRange = loadDateRange();
      const today = getTodayLocal();
      const twoDaysAgo = getTwoDaysAgoLocal();
      setFormData((prev) => ({
        ...prev,
        name: packName,
        date_start: savedDateRange?.start || twoDaysAgo,
        date_stop: savedDateRange?.end || today,
        // Ativa automaticamente se a data final for hoje
        auto_refresh: (savedDateRange?.end || today) === getTodayLocal(),
      }));
    }
  }, [packs.length, isDialogOpen]);

  // Packs são carregados globalmente pelo PacksLoader - não precisa carregar aqui
  // Dados de integrações já vêm junto com os packs (via sheet_integration)

  // Handle opening dialog from URL parameter or custom event
  useEffect(() => {
    if (!isClient) return;

    // Check URL parameter
    const params = new URLSearchParams(window.location.search);
    if (params.get("openDialog") === "true") {
      setIsDialogOpen(true);
      // Remove parameter from URL without page reload
      const url = new URL(window.location.href);
      url.searchParams.delete("openDialog");
      window.history.replaceState({}, "", url.toString());
    }

    // Listen for custom event from Topbar
    const handleOpenDialog = () => {
      setIsDialogOpen(true);
    };

    window.addEventListener("openLoadPackDialog", handleOpenDialog);

    return () => {
      window.removeEventListener("openLoadPackDialog", handleOpenDialog);
    };
  }, [isClient]);

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

  const handleCancelLoadPack = async () => {
    // Marcar como cancelado
    isCancelledRef.current = true;

    // Se um pack foi criado, remover do store e do cache
    if (createdPackIdRef.current) {
      const packId = createdPackIdRef.current;

      // Remover do store
      removePack(packId);

      // Remover do cache IndexedDB
      try {
        const { removeCachedPackAds } = await import("@/lib/storage/adsCache");
        await removeCachedPackAds(packId).catch((error) => {
          console.error("Erro ao remover cache do pack cancelado:", error);
        });
      } catch (error) {
        console.error("Erro ao importar função de remoção de cache:", error);
      }

      // Tentar deletar do backend também (opcional, não bloqueia)
      try {
        await api.analytics.deletePack(packId, []).catch(() => {
          // Ignorar erros - pack pode não ter sido totalmente criado no backend
        });
      } catch (error) {
        // Ignorar erros
      }

      createdPackIdRef.current = null;
    }

    // Limpar estados
    setIsLoading(false);
    setDebugInfo("");
    setProgressDetails(null);

    // Fechar modal apenas se não estiver sendo chamado pelo onClose do modal
    // (evitar loop infinito)
    if (isDialogOpen) {
      setIsDialogOpen(false);
    }

    showWarning("Carregamento do pack cancelado. Todos os dados foram limpos.");
  };

  const handleLoadPack = async () => {
    const validationError = validateForm();
    if (validationError) {
      showError({ message: validationError });
      return;
    }

    // Resetar flags de cancelamento
    isCancelledRef.current = false;
    createdPackIdRef.current = null;

    setIsLoading(true);
    try {
      // Verificar se foi cancelado antes de iniciar
      if (isCancelledRef.current) {
        return;
      }

      // Garantir que sempre tenha um nome válido (evita condição de corrida)
      // Se o nome estiver vazio por algum motivo, usar o nome gerado automaticamente
      const packName = formData.name.trim() || getNextPackName();

      // Start the async job (sempre usa nível "ad")
      const result = await api.facebook.startAdsJob({
        adaccount_id: formData.adaccount_id,
        date_start: formData.date_start,
        date_stop: formData.date_stop,
        level: "ad",
        limit: 1000,
        filters: formData.filters,
        name: packName,
        auto_refresh: formData.auto_refresh || false,
        today_local: getTodayLocal(),
      });

      if (!result.job_id) {
        throw new Error("Falha ao iniciar job de busca de anúncios");
      }

      // Poll for completion
      let completed = false;
      let attempts = 0;
      const maxAttempts = 600; // 20 minutes max (600 * 2s = 1200s = 20min)

      while (!completed && attempts < maxAttempts) {
        // Verificar se foi cancelado antes de cada iteração
        if (isCancelledRef.current) {
          completed = true;
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds

        // Verificar novamente após o timeout
        if (isCancelledRef.current) {
          completed = true;
          break;
        }

        try {
          const progress = await api.facebook.getJobProgress(result.job_id);

          // Verificar se foi cancelado após a requisição
          if (isCancelledRef.current) {
            completed = true;
            break;
          }

          const rawAds = Array.isArray((progress as any)?.data) ? (progress as any).data : Array.isArray((progress as any)?.data?.data) ? (progress as any).data.data : [];
          const details = (progress as any)?.details || {};

          // Armazenar detalhes do progresso
          setProgressDetails(details);

          // Atualizar feedback visual com informações granulares
          let debugMessage = progress.message || "Processando...";

          if (details.stage) {
            const stage = details.stage;
            if (stage === "paginação") {
              debugMessage = `📄 Paginação: Página ${details.page_count || 0} | ${details.total_collected || 0} anúncios coletados`;
            } else if (stage === "enriquecimento") {
              const batchInfo = details.enrichment_total > 0 ? `Lote ${details.enrichment_batches || 0}/${details.enrichment_total}` : "Processando...";
              debugMessage = `🔍 Enriquecimento: ${batchInfo} | ${details.ads_enriched || 0} anúncios enriquecidos de ${details.ads_after_dedup || 0} únicos`;
            } else if (stage === "formatação") {
              debugMessage = `✨ Formatação: ${details.ads_formatted || 0} anúncios formatados`;
            } else if (stage === "completo") {
              debugMessage = `✅ ${progress.message || "Processando..."} | ${details.ads_formatted || rawAds.length} anúncios processados`;
            } else {
              debugMessage = `${progress.message || "Processando..."} | Anúncios coletados: ${rawAds.length}`;
            }
          } else {
            // Fallback para quando não há detalhes
            debugMessage = `${progress.message || "Processando..."} | Anúncios coletados: ${rawAds.length}`;
          }

          setDebugInfo(debugMessage);

          if (progress.status === "completed" && Array.isArray(rawAds)) {
            // Verificar se foi cancelado antes de processar
            if (isCancelledRef.current) {
              completed = true;
              break;
            }

            // Dados já vêm formatados do backend
            const formattedAds = rawAds as any[];

            // Verificar warnings do backend
            const warnings = (progress as any).warnings || [];
            if (warnings.length > 0) {
              warnings.forEach((warning: string) => {
                showWarning(warning);
              });
            }

            // Filtrar apenas ads de vídeo para exibição
            const videoAds = filterVideoAds(formattedAds);

            // Evitar criar pack vazio
            if (!videoAds || videoAds.length === 0) {
              showError({ message: "Nenhum anúncio de vídeo retornado para os parâmetros selecionados." });
              completed = true;
              break;
            }

            // Usar pack_id retornado pelo backend se disponível, senão usar ID local temporário
            const packId = (progress as any).pack_id || `pack_${Date.now()}`;

            // Armazenar packId para possível cancelamento futuro
            createdPackIdRef.current = packId;

            // Verificar se foi cancelado antes de criar o pack
            if (isCancelledRef.current) {
              completed = true;
              break;
            }

            // Calcular stats dos ads para incluir no pack (usar todos os ads, não apenas vídeos)
            const stats = getAdStatistics(formattedAds);

            // Create pack (sempre usa nível "ad")
            // IMPORTANTE: Não salvar ads no pack - eles são salvos no cache IndexedDB
            // Mas incluir stats para exibição na UI
            const pack = {
              id: packId,
              name: packName, // Usar o nome garantido (evita condição de corrida)
              adaccount_id: formData.adaccount_id,
              date_start: formData.date_start,
              date_stop: formData.date_stop,
              level: "ad" as const,
              filters: formData.filters,
              auto_refresh: formData.auto_refresh || false,
              ads: [], // Não salvar ads no store - usar cache IndexedDB
              stats: {
                totalAds: formattedAds.length,
                uniqueAds: stats.uniqueAds,
                uniqueCampaigns: stats.uniqueCampaigns,
                uniqueAdsets: stats.uniqueAdsets,
                totalSpend: stats.totalSpend,
                totalClicks: formattedAds.reduce((sum, ad) => sum + (ad.clicks || 0), 0),
                totalImpressions: formattedAds.reduce((sum, ad) => sum + (ad.impressions || 0), 0),
                totalReach: formattedAds.reduce((sum, ad) => sum + (ad.reach || 0), 0),
                totalInlineLinkClicks: formattedAds.reduce((sum, ad) => sum + (ad.inline_link_clicks || 0), 0),
                totalPlays: formattedAds.reduce((sum, ad) => sum + (ad.video_plays || 0), 0),
                totalThruplays: formattedAds.reduce((sum, ad) => sum + (ad.video_thruplay || 0), 0),
                ctr: stats.totalSpend > 0 ? (formattedAds.reduce((sum, ad) => sum + (ad.clicks || 0), 0) / formattedAds.reduce((sum, ad) => sum + (ad.impressions || 0), 1)) * 100 : 0,
                cpm: stats.totalSpend > 0 ? (stats.totalSpend / formattedAds.reduce((sum, ad) => sum + (ad.impressions || 0), 1)) * 1000 : 0,
                frequency: formattedAds.reduce((sum, ad) => sum + (ad.reach || 0), 0) > 0 ? formattedAds.reduce((sum, ad) => sum + (ad.impressions || 0), 0) / formattedAds.reduce((sum, ad) => sum + (ad.reach || 0), 1) : 0,
              },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };

            // Verificar novamente antes de adicionar ao store
            if (isCancelledRef.current) {
              completed = true;
              break;
            }

            addPack(pack);

            // Salvar ads no cache IndexedDB (separado do store)
            if (formattedAds.length > 0 && !isCancelledRef.current) {
              const { cachePackAds } = await import("@/lib/storage/adsCache");
              await cachePackAds(packId, formattedAds).catch((error) => {
                console.error("Erro ao salvar ads no cache:", error);
              });
            }

            // Se foi cancelado após salvar, limpar dados
            if (isCancelledRef.current) {
              await handleCancelLoadPack();
              return;
            }

            // Mostrar mensagem com total de ads e quantos são vídeos
            const totalAds = formattedAds.length;
            const videoAdsCount = videoAds.length;
            if (totalAds === videoAdsCount) {
              showSuccess(`Pack "${packName}" criado com ${videoAdsCount} anúncios de vídeo!`);
            } else {
              showSuccess(`Pack "${packName}" criado com ${videoAdsCount} anúncios de vídeo (de ${totalAds} total)!`);
            }

            // Reset form and close dialog
            setFormData((prev) => ({
              ...prev,
              name: getNextPackName(),
              filters: [],
              auto_refresh: false,
            }));
            setIsDialogOpen(false);
            setDebugInfo("");
            setProgressDetails(null); // Limpar debug info
            setProgressDetails(null); // Limpar detalhes
            completed = true;

            // Limpar refs após sucesso
            createdPackIdRef.current = null;
          } else if (progress.status === "failed" || progress.status === "error") {
            throw new Error(progress.message || "Job falhou");
          }
        } catch (error) {
          // Incrementar attempts mesmo em caso de erro para evitar loop infinito
          attempts++;

          // Se foi cancelado, não mostrar erro
          if (isCancelledRef.current) {
            completed = true;
            break;
          }

          // Melhorar tratamento de erro para exibir mensagens mais claras
          let errorMessage = "Erro ao verificar progresso do job";
          if (error instanceof Error) {
            errorMessage = error.message || errorMessage;
          } else if (typeof error === "object" && error !== null) {
            // Tentar extrair mensagem de erro do objeto
            const errorObj = error as any;
            errorMessage = errorObj.message || errorObj.error || errorObj.detail || errorMessage;
          }

          console.error("Error polling job progress:", error);

          // Verificar se é timeout HTTP (não é timeout do polling, apenas da requisição)
          const isHttpTimeout = errorMessage.includes("timeout") || errorMessage.includes("Timeout") || (typeof error === "object" && error !== null && (error as any).code === "ECONNABORTED");

          // Se for timeout HTTP, continuar polling (não é erro fatal)
          if (isHttpTimeout) {
            console.warn(`Timeout HTTP na requisição getJobProgress (tentativa ${attempts}/${maxAttempts}). Continuando polling...`);
            setDebugInfo(`Timeout na requisição, tentando novamente... (${attempts}/${maxAttempts})`);
            // Continuar loop sem lançar erro
            continue;
          }

          // Se o erro for vazio ou muito genérico, verificar se o job pode ter completado
          // mesmo com erro na requisição (timeout de rede, etc)
          if (!errorMessage || errorMessage === "{}" || errorMessage.trim() === "") {
            // Tentar uma última verificação antes de falhar
            try {
              const lastProgress = await api.facebook.getJobProgress(result.job_id);
              if (lastProgress.status === "completed") {
                // Job completou, processar normalmente
                const rawAds = Array.isArray((lastProgress as any)?.data) ? (lastProgress as any).data : Array.isArray((lastProgress as any)?.data?.data) ? (lastProgress as any).data.data : [];
                if (rawAds.length > 0) {
                  // Continuar processamento normalmente (sem incrementar attempts novamente)
                  continue;
                }
              }
            } catch (retryError) {
              // Se a retentativa também falhar, continuar polling (não é erro fatal)
              console.warn(`Erro ao tentar retry do getJobProgress (tentativa ${attempts}/${maxAttempts}). Continuando polling...`);
              continue;
            }
          }

          // Para erros não-fatais, continuar polling
          // Apenas lançar erro para erros realmente críticos
          if (attempts >= maxAttempts) {
            throw new Error(`Timeout: Job demorou mais que 20 minutos para completar (${attempts} tentativas)`);
          }

          // Para outros erros, continuar tentando
          console.warn(`Erro ao verificar progresso (tentativa ${attempts}/${maxAttempts}): ${errorMessage}. Continuando polling...`);
          continue;
        }

        // Incrementar attempts apenas quando não houve erro (ou quando o erro foi tratado com continue)
        attempts++;
      }

      if (!completed && !isCancelledRef.current) {
        throw new Error("Timeout: Job demorou mais que 20 minutos para completar");
      }
    } catch (error) {
      // Não mostrar erro se foi cancelado
      if (!isCancelledRef.current) {
        showError(error as any);
      }
    } finally {
      // Limpar refs ao finalizar
      if (isCancelledRef.current) {
        // Já foi limpo pelo handleCancelLoadPack
        isCancelledRef.current = false;
      } else {
        createdPackIdRef.current = null;
      }
      setIsLoading(false);
      setDebugInfo("");
      setProgressDetails(null); // Limpar debug info ao finalizar
    }
  };

  const handleRenamePack = (packId: string) => {
    const pack = packs.find((p) => p.id === packId);
    if (!pack) return;

    setPackToRename({
      id: pack.id,
      name: pack.name,
    });
    setNewPackName(pack.name);
  };

  const handleRemovePack = async (packId: string) => {
    const pack = packs.find((p) => p.id === packId);
    if (!pack) return;

    // Usar stats.uniqueAds (anúncios únicos) se disponível, senão buscar do backend
    let adsCount = pack.stats?.uniqueAds || 0;

    // Se não tem stats, buscar do backend (sem ads, apenas stats)
    if (adsCount === 0 && !pack.stats) {
      try {
        const response = await api.analytics.getPack(packId, false);
        if (response.success && response.pack?.stats) {
          adsCount = response.pack.stats.uniqueAds || 0;
        }
      } catch (error) {
        console.error("Erro ao buscar stats do pack:", error);
        // Usar 0 como fallback
        adsCount = 0;
      }
    }

    setPackToRemove({
      id: pack.id,
      name: pack.name,
      adsCount,
    });
  };

  const confirmRemovePack = async () => {
    if (!packToRemove || isDeleting) return;

    setIsDeleting(true);
    try {
      // Backend busca ad_ids automaticamente do pack - não precisa buscar aqui
      await api.analytics.deletePack(packToRemove.id, []);

      // Remover do estado local
      removePack(packToRemove.id);

      // Invalidar cache de ads do pack removido
      await invalidatePackAds(packToRemove.id);

      // Invalidar dados agregados (ad performance) para atualizar Rankings/Insights
      invalidateAdPerformance();

      showSuccess(`Pack "${packToRemove.name}" removido com sucesso!`);
      setPackToRemove(null);
    } catch (error) {
      console.error("Erro ao deletar pack do Supabase:", error);
      // Ainda remove do estado local mesmo se falhar no Supabase
      removePack(packToRemove.id);

      // Invalidar cache mesmo se falhar no servidor
      await invalidatePackAds(packToRemove.id).catch(() => {});

      // Invalidar dados agregados (ad performance) para atualizar Rankings/Insights
      invalidateAdPerformance();

      showError({ message: `Pack removido localmente, mas houve erro ao deletar do servidor: ${error}` });
      setPackToRemove(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const cancelRemovePack = () => {
    if (isDeleting) return; // Não permite cancelar durante a deleção
    setPackToRemove(null);
  };

  const confirmRenamePack = async () => {
    if (!packToRename || isRenaming) return;

    const trimmedName = newPackName.trim();
    if (!trimmedName) {
      showError({ message: "Nome do pack não pode ser vazio" });
      return;
    }

    if (trimmedName === packToRename.name) {
      // Nome não mudou, apenas fechar o modal
      setPackToRename(null);
      setNewPackName("");
      return;
    }

    setIsRenaming(true);
    try {
      await api.analytics.updatePackName(packToRename.id, trimmedName);

      // Atualizar pack no store local
      updatePack(packToRename.id, {
        name: trimmedName,
      } as Partial<AdsPack>);

      showSuccess(`Pack renomeado para "${trimmedName}"`);
      setPackToRename(null);
      setNewPackName("");
    } catch (error) {
      console.error("Erro ao renomear pack:", error);
      showError({ message: `Erro ao renomear pack: ${error}` });
    } finally {
      setIsRenaming(false);
    }
  };

  const cancelRenamePack = () => {
    if (isRenaming) return; // Não permite cancelar durante a renomeação
    setPackToRename(null);
    setNewPackName("");
  };

  const handlePreviewPack = async (pack: any) => {
    // Buscar ads do cache IndexedDB primeiro, depois do backend se necessário
    try {
      // Tentar cache primeiro
      const { getCachedPackAds } = await import("@/lib/storage/adsCache");
      const cachedResult = await getCachedPackAds(pack.id);

      let allAds = [];
      if (cachedResult.success && cachedResult.data && cachedResult.data.length > 0) {
        allAds = cachedResult.data;
      } else {
        // Se não tem cache, buscar do backend
        const response = await api.analytics.getPack(pack.id, true);
        if (response.success && response.pack?.ads) {
          allAds = response.pack.ads;
          // Salvar no cache para próximas vezes
          const { cachePackAds } = await import("@/lib/storage/adsCache");
          await cachePackAds(pack.id, allAds).catch(() => {});
        }
      }

      // Filtrar apenas ads de vídeo para exibição
      const ads = filterVideoAds(allAds);

      // Garantir que stats estejam completos
      // Se não tiver stats ou estiver incompleto, recalcular dos ads
      const essentialStatsKeys = ["totalSpend", "uniqueAds", "uniqueCampaigns", "uniqueAdsets"];
      const hasValidStats = pack.stats && typeof pack.stats === "object" && Object.keys(pack.stats).length > 0 && essentialStatsKeys.every((key) => key in pack.stats && pack.stats[key] !== null && pack.stats[key] !== undefined);

      let finalStats = pack.stats;
      if (!hasValidStats && ads.length > 0) {
        // Recalcular todos os stats dos ads usando a função utilitária
        const { getAdStatistics } = await import("@/lib/utils/adCounting");
        const calculated = getAdStatistics(ads as any[]);

        // Calcular métricas adicionais que não estão em getAdStatistics
        const totalClicks = ads.reduce((sum: number, ad: any) => sum + (ad.clicks || 0), 0);
        const totalImpressions = ads.reduce((sum: number, ad: any) => sum + (ad.impressions || 0), 0);
        const totalReach = ads.reduce((sum: number, ad: any) => sum + (ad.reach || 0), 0);

        finalStats = {
          ...calculated,
          totalClicks,
          totalImpressions,
          totalReach,
          totalInlineLinkClicks: ads.reduce((sum: number, ad: any) => sum + (ad.inline_link_clicks || 0), 0),
          totalPlays: ads.reduce((sum: number, ad: any) => sum + (ad.video_plays || 0), 0),
          totalThruplays: ads.reduce((sum: number, ad: any) => sum + (ad.video_thruplay || 0), 0),
          ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
          cpm: totalImpressions > 0 ? (calculated.totalSpend / totalImpressions) * 1000 : 0,
          frequency: totalReach > 0 ? totalImpressions / totalReach : 0,
        };
      }

      setPreviewPack({ ...pack, ads, stats: finalStats });
    } catch (error) {
      console.error("Erro ao carregar ads do pack para preview:", error);
      setPreviewPack(pack);
    }
  };

  const handleViewJson = async (pack: any) => {
    // Buscar ads do cache IndexedDB primeiro, depois do backend se necessário
    try {
      // Tentar cache primeiro
      const { getCachedPackAds } = await import("@/lib/storage/adsCache");
      const cachedResult = await getCachedPackAds(pack.id);

      if (cachedResult.success && cachedResult.data && cachedResult.data.length > 0) {
        // Usar cache se disponível
        setJsonViewerPack({ ...pack, ads: cachedResult.data });
        return;
      }

      // Se não tem cache, buscar do backend
      const response = await api.analytics.getPack(pack.id, true);
      if (response.success && response.pack?.ads) {
        const ads = response.pack.ads;
        // Salvar no cache para próximas vezes
        const { cachePackAds } = await import("@/lib/storage/adsCache");
        await cachePackAds(pack.id, ads).catch(() => {});
        setJsonViewerPack({ ...pack, ads });
      } else {
        setJsonViewerPack(pack);
      }
    } catch (error) {
      console.error("Erro ao carregar ads do pack para JSON viewer:", error);
      setJsonViewerPack(pack);
    }
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

  const formatDate = (dateString: string) => {
    // Corrigir problema de timezone - usar apenas a data sem conversão de timezone
    const [year, month, day] = dateString.split("-");
    return `${day}/${month}/${year}`;
  };

  const formatDateTime = (dateTimeString: string) => {
    if (!dateTimeString) return "N/A";
    try {
      // Formato esperado: ISO 8601 (ex: "2024-01-15T10:30:00Z" ou "2024-01-15T10:30:00.000Z")
      const date = new Date(dateTimeString);
      const day = String(date.getDate()).padStart(2, "0");
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const year = date.getFullYear();
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      return `${day}/${month}/${year} ${hours}:${minutes}`;
    } catch (error) {
      return "Data inválida";
    }
  };

  const getAccountName = (accountId: string) => {
    const account = Array.isArray(adAccountsData) ? adAccountsData.find((acc: any) => acc.id === accountId) : null;
    return account?.name || accountId;
  };

  const getFilterFieldLabel = (fieldValue: string) => {
    const field = FILTER_FIELDS.find((f) => f.value === fieldValue);
    return field ? field.label : fieldValue;
  };

  // Funções auxiliares para refresh de pack
  const calculateDaysBetween = (startDate: string, endDate: string): number => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays + 1; // +1 para incluir o dia final
  };

  const estimateCurrentDay = (progress: number, totalDays: number): number => {
    if (progress <= 0) return 1;
    if (progress >= 100) return totalDays;
    const estimatedDay = Math.ceil((progress / 100) * totalDays);
    return Math.max(1, Math.min(estimatedDay, totalDays));
  };

  const handleRefreshPack = (packId: string) => {
    const pack = packs.find((p) => p.id === packId);
    if (!pack) return;

    setPackToRefresh({
      id: pack.id,
      name: pack.name,
    });
  };

  const handleToggleAutoRefresh = (packId: string, newValue: boolean) => {
    const pack = packs.find((p) => p.id === packId);
    if (!pack) return;

    // Se está tentando desativar, mostrar modal de confirmação
    if (!newValue && pack.auto_refresh) {
      setPackToDisableAutoRefresh({
        id: pack.id,
        name: pack.name,
      });
      return;
    }

    // Se está ativando, fazer diretamente
    confirmToggleAutoRefresh(packId, newValue);
  };

  const cancelDisableAutoRefresh = () => {
    if (isTogglingAutoRefresh) return; // Não permite cancelar durante a atualização
    setPackToDisableAutoRefresh(null);
  };

  const confirmToggleAutoRefresh = async (packId: string, newValue: boolean) => {
    const pack = packs.find((p) => p.id === packId);
    if (!pack) return;

    setIsTogglingAutoRefresh(packId);
    try {
      await api.analytics.updatePackAutoRefresh(packId, newValue);

      // Atualizar pack no store local
      updatePack(packId, {
        auto_refresh: newValue,
      } as Partial<AdsPack>);

      showSuccess(`Auto-refresh ${newValue ? "ativado" : "desativado"} para o pack "${pack.name}"`);

      // Fechar modal se estiver aberto
      if (packToDisableAutoRefresh?.id === packId) {
        setPackToDisableAutoRefresh(null);
      }
    } catch (error) {
      console.error("Erro ao atualizar auto_refresh:", error);
      showError({ message: `Erro ao ${newValue ? "ativar" : "desativar"} auto-refresh: ${error}` });
    } finally {
      setIsTogglingAutoRefresh(null);
    }
  };

  const cancelRefreshPack = () => {
    if (isRefreshing) return; // Não permite cancelar durante o refresh
    setPackToRefresh(null);
  };

  const confirmRefreshPack = async () => {
    if (!packToRefresh || isRefreshing) return;

    setIsRefreshing(true);
    const packId = packToRefresh.id;
    const packName = packToRefresh.name;

    // Fechar modal imediatamente após confirmar
    setPackToRefresh(null);

    const toastId = `refresh-pack-${packId}`;

    // Mostrar toast imediatamente para feedback visual instantâneo
    showProgressToast(toastId, packName, 0, 1, "Inicializando...");

    try {
      // Iniciar refresh
      const refreshResult = await api.facebook.refreshPack(packId, getTodayLocal());

      if (!refreshResult.job_id) {
        finishProgressToast(toastId, false, `Erro ao iniciar atualização de "${packName}"`);
        setIsRefreshing(false);
        return;
      }

      // Calcular total de dias
      const dateRange = refreshResult.date_range;
      const totalDays = calculateDaysBetween(dateRange.since, dateRange.until);

      // Atualizar toast com informações reais
      updateProgressToast(toastId, packName, 1, totalDays);

      // Fazer polling do job
      let completed = false;
      let attempts = 0;
      const maxAttempts = 150; // 5 minutos máximo

      while (!completed && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Aguardar 2 segundos

        try {
          const progress = await api.facebook.getJobProgress(refreshResult.job_id);

          // Estimar dia atual baseado no progresso
          const currentDay = estimateCurrentDay(progress.progress || 0, totalDays);

          // Atualizar toast com progresso
          updateProgressToast(toastId, packName, currentDay, totalDays, progress.message || undefined);

          if (progress.status === "completed") {
            const adsCount = Array.isArray(progress.data) ? progress.data.length : 0;
            finishProgressToast(toastId, true, `"${packName}" atualizado com sucesso! ${adsCount > 0 ? `${adsCount} anúncios atualizados.` : ""}`);

            // Recarregar pack do backend para atualizar dados (sem precisar incluir ads - stats já tem tudo)
            try {
              const response = await api.analytics.listPacks(false); // Não precisa incluir ads - stats já tem tudo
              if (response.success && response.packs) {
                const updatedPack = response.packs.find((p: any) => p.id === packId);
                if (updatedPack) {
                  // Atualizar pack no store com stats (sem precisar dos ads)
                  updatePack(packId, {
                    stats: updatedPack.stats || {},
                    updated_at: updatedPack.updated_at || new Date().toISOString(),
                    auto_refresh: updatedPack.auto_refresh !== undefined ? updatedPack.auto_refresh : undefined,
                    // Não precisa atualizar ads - stats já contém tudo necessário para o card
                  } as Partial<AdsPack>);

                  // Invalidar cache de ads do pack (novos dados serão buscados sob demanda)
                  await invalidatePackAds(packId);
                }
              }

              // Invalidar dados agregados (ad performance) para atualizar Rankings/Insights
              invalidateAdPerformance();
            } catch (error) {
              console.error("Erro ao recarregar pack após refresh:", error);
              // Não bloquear sucesso do refresh se falhar ao recarregar
            }

            completed = true;
          } else if (progress.status === "failed" || progress.status === "error") {
            finishProgressToast(toastId, false, `Erro ao atualizar "${packName}": ${progress.message || "Erro desconhecido"}`);
            completed = true;
          }
        } catch (error) {
          console.error(`Erro ao verificar progresso do pack ${packId}:`, error);
          const lastKnownDay = attempts > 0 ? Math.min(attempts, totalDays) : 1;
          updateProgressToast(toastId, packName, lastKnownDay, totalDays, "Erro ao verificar progresso, tentando novamente...");
        }

        attempts++;
      }

      if (!completed) {
        finishProgressToast(toastId, false, `Timeout ao atualizar "${packName}" (demorou mais de 5 minutos)`);
      }
    } catch (error) {
      console.error(`Erro ao atualizar pack ${packId}:`, error);
      finishProgressToast(toastId, false, `Erro ao atualizar "${packName}": ${error instanceof Error ? error.message : "Erro desconhecido"}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSyncSheetIntegration = async (packId: string) => {
    const pack = packs.find((p) => p.id === packId);
    if (!pack || !pack.sheet_integration?.id) return;

    setIsSyncingSheetIntegration(packId);
    const toastId = `sync-sheet-${packId}`;

    try {
      showProgressToast(toastId, pack.name, 0, 1, "Iniciando sincronização...");

      const syncRes = await api.integrations.google.syncSheetIntegration(pack.sheet_integration.id);

      finishProgressToast(toastId, true, `Enriquecimento de ads atualizado com sucesso! ${syncRes.stats?.updated_rows || 0} registros atualizados.`);

      // Recarregar packs para atualizar last_synced_at
      try {
        const response = await api.analytics.listPacks(false);
        if (response.success && response.packs) {
          const updatedPack = response.packs.find((p: any) => p.id === packId);
          if (updatedPack?.sheet_integration) {
            updatePack(packId, {
              sheet_integration: updatedPack.sheet_integration,
            } as Partial<AdsPack>);
          }
        }
      } catch (error) {
        console.error("Erro ao recarregar pack após sincronização:", error);
        // Não bloquear sucesso da sincronização se falhar ao recarregar
      }

      // Invalidar cache de ads e dados agregados para refletir novos dados de enriquecimento
      await invalidatePackAds(packId);
      invalidateAdPerformance();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
      finishProgressToast(toastId, false, `Erro ao sincronizar planilha: ${errorMessage}`);
      showError({ message: `Erro ao sincronizar planilha: ${errorMessage}` });
    } finally {
      setIsSyncingSheetIntegration(null);
    }
  };

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

  return (
    <>
      <div className="space-y-8">
        {/* Page Header */}
        <PageHeader
          title="Packs de Anúncios"
          description="Gerencie seus packs carregados"
          actions={
            <Button className="flex items-center gap-2" onClick={() => setIsDialogOpen(true)}>
              <IconPlus className="w-4 h-4" />
              Carregar Pack
            </Button>
          }
        />

        {/* Packs Grid */}
        {isLoadingPacks ? (
          // Skeleton enquanto carrega packs
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader className="pb-3">
                  <Skeleton className="h-6 w-32 mb-2" />
                  <Skeleton className="h-4 w-48" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <Skeleton className="h-16" />
                    <Skeleton className="h-16" />
                    <Skeleton className="h-16" />
                  </div>
                  <Skeleton className="h-8 w-full" />
                  <div className="flex gap-2">
                    <Skeleton className="h-8 w-8" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : packs.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <IconChartBar className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">Nenhum Pack Carregado</h3>
              <p className="text-muted-foreground mb-6">Carregue seu primeiro pack de anúncios para começar a análise</p>
              <Button onClick={() => setIsDialogOpen(true)}>
                <IconPlus className="w-4 h-4 mr-2" />
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
                    <div className="flex items-center gap-2">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-2">
                              <Switch checked={pack.auto_refresh || false} onCheckedChange={(checked) => handleToggleAutoRefresh(pack.id, checked)} disabled={isTogglingAutoRefresh === pack.id || packToDisableAutoRefresh?.id === pack.id} className="data-[state=checked]:bg-green-500" onClick={(e) => e.stopPropagation()} />
                              <div className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${pack.auto_refresh ? "bg-green-500/20 text-green-500 border border-green-500/30" : "bg-muted text-muted-foreground border border-border"}`}>
                                <IconRefresh className={`w-3 h-3 ${pack.auto_refresh ? "animate-spin [animation-duration:3s]" : ""}`} />
                                <span>{pack.auto_refresh ? "Auto" : "Manual"}</span>
                              </div>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{pack.auto_refresh ? "Atualização automática ativada - clique no switch para desativar" : "Atualização manual - clique no switch para ativar"}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" disabled={isRefreshing}>
                            <IconDotsVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleRenamePack(pack.id)} disabled={isRenaming}>
                            <IconPencil className="w-4 h-4 mr-2" />
                            Renomear pack
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleRefreshPack(pack.id)} disabled={isRefreshing}>
                            <IconRotateClockwise className="w-4 h-4 mr-2" />
                            Atualizar pack
                          </DropdownMenuItem>
                          {pack.sheet_integration ? (
                            <DropdownMenuItem disabled className="opacity-100">
                              <IconTableExport className="w-4 h-4 mr-2 text-green-500" />
                              <div className="flex flex-col items-start">
                                <span className="text-xs font-medium text-green-500">Planilha conectada</span>
                                <span className="text-xs text-muted-foreground">
                                  {pack.sheet_integration.spreadsheet_name || "Planilha"} • {pack.sheet_integration.worksheet_title || "Aba"}
                                </span>
                              </div>
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => setSheetIntegrationPack(pack)}>
                              <IconTableExport className="w-4 h-4 mr-2" />
                              Enriquecer leadscore (Google Sheets)
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => handlePreviewPack(pack)}>
                            <IconEye className="w-4 h-4 mr-2" />
                            Visualizar tabela
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleViewJson(pack)}>
                            <IconCode className="w-4 h-4 mr-2" />
                            Ver JSON
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleRemovePack(pack.id)} className="text-red-500 focus:text-red-500 focus:bg-red-500/10">
                            <IconTrash className="w-4 h-4 mr-2" />
                            Remover pack
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <CardDescription>
                    {formatDate(pack.date_start)} - {formatDate(pack.date_stop)}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Última atualização */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Última atualização:</p>
                    <p className="text-sm text-muted-foreground">{formatDateTime(pack.updated_at)}</p>
                  </div>

                  {/* Stats */}
                  {(() => {
                    // Usar stats do pack se disponível (preferencialmente do backend)
                    // Se não tiver stats, mostra 0 (não calcula dos ads porque ads estão no cache)
                    const stats = pack.stats;
                    return (
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <p className="text-2xl font-bold text-brand">{stats?.uniqueCampaigns || 0}</p>
                          <p className="text-xs text-muted-foreground">Campanhas</p>
                        </div>
                        <div>
                          <p className="text-2xl font-bold text-green-500">{stats?.uniqueAdsets || 0}</p>
                          <p className="text-xs text-muted-foreground">Adsets</p>
                        </div>
                        <div>
                          <p className="text-2xl font-bold text-blue-500">{stats?.uniqueAds || 0}</p>
                          <p className="text-xs text-muted-foreground">Anúncios Únicos</p>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Account */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Conta:</p>
                    <p className="text-sm text-muted-foreground">{getAccountName(pack.adaccount_id)}</p>
                  </div>

                  {/* Total Spent */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Investimento Total:</p>
                    <p className="text-lg font-bold text-yellow-500">{formatCurrency(pack.stats?.totalSpend || 0)}</p>
                  </div>

                  {/* Filters */}
                  {pack.filters && pack.filters.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Filtros aplicados:</p>
                      <div className="space-y-1">
                        {pack.filters.map((filter: FilterRule, index: number) => (
                          <div key={index} className="text-xs text-muted-foreground bg-border p-2 rounded">
                            <span className="font-medium">{getFilterFieldLabel(filter.field)}</span> {filter.operator.toLowerCase().replace("_", " ")} <span className="font-medium">"{filter.value}"</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Sheet Integration Status */}
                  {pack.sheet_integration && (
                    <div className="space-y-2 pt-2 border-t border-border">
                      <div className="flex items-center gap-2">
                        <IconTableExport className="w-4 h-4 text-green-500" />
                        <p className="text-sm font-medium text-green-500">Planilha conectada</p>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground bg-green-500/10 border border-green-500/20 p-2 rounded">
                        <div className="flex-1">
                          <p className="font-medium">{pack.sheet_integration.spreadsheet_name || "Planilha desconhecida"}</p>
                          <p className="text-xs mt-1">Aba: {pack.sheet_integration.worksheet_title || "N/A"}</p>
                          {pack.sheet_integration.last_synced_at && <p className="text-xs mt-1 opacity-70">Última sincronização: {new Date(pack.sheet_integration.last_synced_at).toLocaleString("pt-BR")}</p>}
                        </div>
                        <Button variant="outline" size="icon" className="shrink-0 w-10 h-10 border-green-500/30 hover:bg-green-500/10 hover:border-green-500/50" onClick={() => handleSyncSheetIntegration(pack.id)} disabled={isSyncingSheetIntegration === pack.id}>
                          {isSyncingSheetIntegration === pack.id ? <IconLoader2 className="w-5 h-5 animate-spin" /> : <IconRefresh className="w-5 h-5" />}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Load Pack Modal */}
      <Modal
        isOpen={isDialogOpen}
        onClose={() => {
          if (isLoading) {
            // Se estiver carregando, cancelar ao invés de apenas fechar
            handleCancelLoadPack();
          } else {
            setIsDialogOpen(false);
          }
        }}
        size="2xl"
        padding="md"
        closeOnOverlayClick={!isLoading}
        closeOnEscape={!isLoading}
        showCloseButton={!isLoading}
      >
        <div className="space-y-1.5 mb-6">
          <h2 className="text-lg font-semibold leading-none tracking-tight">Carregar Pack de Anúncios</h2>
          <p className="text-sm text-muted-foreground">Configure os parâmetros para carregar um novo pack de anúncios</p>
        </div>

        <div className="space-y-6">
          {/* Pack Name */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Nome do Pack</label>
            <Input placeholder="Ex: Black Friday Campaign, Q4 Performance, etc." value={formData.name} onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))} />
            <p className="text-xs text-muted-foreground">Dê um nome descritivo para identificar facilmente seu pack</p>
          </div>

          {/* Ad Account */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Conta de Anúncios</label>
            {adAccountsLoading || meLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <IconLoader2 className="w-4 h-4 animate-spin" />
                Carregando contas de anúncios...
              </div>
            ) : Array.isArray(adAccountsData) && adAccountsData.length > 0 ? (
              <Select value={formData.adaccount_id} onValueChange={(value) => setFormData((prev) => ({ ...prev, adaccount_id: value }))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione uma conta de anúncios" />
                </SelectTrigger>
                <SelectContent>
                  {[...adAccountsData]
                    .sort((a: any, b: any) => {
                      // Ordenar primeiro por status (ativas primeiro, depois pausadas)
                      const statusA = a.account_status || 0;
                      const statusB = b.account_status || 0;

                      // Prioridade: 1 (ativo) > 2 (pausado) > outros
                      const priority = { 1: 0, 2: 1 };
                      const priorityA = priority[statusA as keyof typeof priority] ?? 2;
                      const priorityB = priority[statusB as keyof typeof priority] ?? 2;

                      if (priorityA !== priorityB) {
                        return priorityA - priorityB;
                      }

                      // Depois ordenar por nome (alfabética A-Z)
                      const nameA = (a.name || a.id || "").toLowerCase();
                      const nameB = (b.name || b.id || "").toLowerCase();
                      return nameA.localeCompare(nameB);
                    })
                    .map((account: any) => {
                      const accountStatus = account.account_status;
                      const accountName = account.name || account.id;
                      const displayText = `${accountName}${account.business_name ? ` • ${account.business_name}` : ""}`;

                      // Definir ícone e cor baseado no status
                      let StatusIcon;
                      let iconColor;
                      if (accountStatus === 1) {
                        // Ativo
                        StatusIcon = IconCircleCheck;
                        iconColor = "text-green-500";
                      } else if (accountStatus === 2) {
                        // Pausado
                        StatusIcon = IconCircleDot;
                        iconColor = "text-yellow-500";
                      } else if (accountStatus === 3) {
                        // Desativado
                        StatusIcon = IconCircleX;
                        iconColor = "text-red-500";
                      } else {
                        // Desconhecido
                        StatusIcon = IconCircleDot;
                        iconColor = "text-gray-500";
                      }

                      const isActive = accountStatus === 1;

                      return (
                        <SelectItem key={account.id} value={account.id} textValue={displayText}>
                          <div className={`flex items-center gap-2 w-full min-w-0 ${!isActive ? "opacity-50" : ""}`}>
                            <StatusIcon className={`w-4 h-4 flex-shrink-0 ${iconColor}`} />
                            <span className="font-medium text-sm truncate">{accountName}</span>
                            {account.business_name && <span className="text-sm text-muted-foreground truncate">• {account.business_name}</span>}
                          </div>
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex flex-col gap-2 p-4 border border-border rounded-md bg-muted/50">
                <p className="text-sm text-muted-foreground">Nenhuma conta de anúncios encontrada. Conecte sua conta do Facebook primeiro.</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsDialogOpen(false);
                    // Pode redirecionar para página de conexão se necessário
                  }}
                >
                  Conectar Facebook
                </Button>
              </div>
            )}
            {Array.isArray(adAccountsData) && adAccountsData.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {adAccountsData.length} {adAccountsData.length === 1 ? "conta disponível" : "contas disponíveis"}
              </p>
            )}
          </div>

          {/* Date Range */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Período</label>
              <div className="flex items-center gap-2">
                <label htmlFor="auto-refresh-switch" className={`text-sm font-medium flex items-center gap-2 ${formData.date_stop !== getTodayLocal() ? "text-muted-foreground cursor-not-allowed" : "cursor-pointer"}`}>
                  Manter atualizado
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <IconInfoCircle className={`w-4 h-4 ${formData.date_stop !== getTodayLocal() ? "text-muted-foreground" : "text-muted-foreground"}`} />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{formData.date_stop !== getTodayLocal() ? "Disponível apenas quando a data final é hoje." : "Quando ativado, o pack será atualizado automaticamente."}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </label>
                <Switch
                  id="auto-refresh-switch"
                  checked={formData.auto_refresh || false}
                  onCheckedChange={(checked: boolean) => {
                    if (formData.date_stop === getTodayLocal()) {
                      setFormData((prev) => ({
                        ...prev,
                        auto_refresh: checked,
                      }));
                    }
                  }}
                  disabled={formData.date_stop !== getTodayLocal()}
                />
              </div>
            </div>
            <DateRangeFilter
              value={{
                start: formData.date_start || undefined,
                end: formData.date_stop || undefined,
              }}
              onChange={(dateRange: DateRangeValue) => {
                const newDateStop = dateRange.end || "";
                const newDateStart = dateRange.start || "";
                // Salvar no localStorage
                saveDateRange({
                  start: newDateStart,
                  end: newDateStop,
                });
                setFormData((prev) => ({
                  ...prev,
                  date_start: newDateStart,
                  date_stop: newDateStop,
                  // Ativa automaticamente se a data final for hoje, desativa caso contrário
                  auto_refresh: newDateStop === getTodayLocal(),
                }));
              }}
              useModal={true}
              disableFutureDates={true}
              showLabel={false}
            />
          </div>

          {/* Filters */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium flex items-center gap-2">
                <IconFilter className="w-4 h-4" />
                Filtros
              </label>
              <Button type="button" variant="outline" size="sm" onClick={handleAddFilter}>
                <IconPlus className="w-4 h-4 mr-1" />
                Adicionar Filtro
              </Button>
            </div>

            {formData.filters.map((filter, index) => (
              <div key={index} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-4">
                  <Select value={filter.field} onValueChange={(value) => handleFilterChange(index, "field", value)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione o campo" />
                    </SelectTrigger>
                    <SelectContent>
                      {FILTER_FIELDS.map((field) => (
                        <SelectItem key={field.value} value={field.value}>
                          {field.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-3">
                  <Select value={filter.operator} onValueChange={(value) => handleFilterChange(index, "operator", value)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione o operador" />
                    </SelectTrigger>
                    <SelectContent>
                      {FILTER_OPERATORS.map((op) => (
                        <SelectItem key={op} value={op}>
                          {op.replace("_", " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-4">
                  <Input placeholder="Valor..." value={filter.value} onChange={(e) => handleFilterChange(index, "value", e.target.value)} />
                </div>
                <div className="col-span-1">
                  <Button type="button" variant="outline" size="sm" onClick={() => handleRemoveFilter(index)}>
                    <IconTrash className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Submit Button */}
          <div className="flex gap-3">
            <Button onClick={handleLoadPack} disabled={isLoading || !!validateForm()} className="flex-1" size="lg">
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Carregando Anúncios...
                </>
              ) : (
                <>
                  <IconChartBar className="w-4 h-4 mr-2" />
                  Carregar Pack
                </>
              )}
            </Button>
            {isLoading && (
              <Button onClick={handleCancelLoadPack} variant="outline" size="lg" className="shrink-0">
                <IconCircleX className="w-4 h-4" />
              </Button>
            )}
          </div>

          {/* Debug Info */}
          {isLoading && debugInfo && (
            <div className="mt-4 p-4 bg-border rounded-lg space-y-3">
              <div className="flex items-center gap-2">
                <IconLoader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                <p className="text-sm font-medium">Progresso do Carregamento</p>
              </div>
              <div className="text-sm text-muted-foreground space-y-1">
                <p className="font-medium">{debugInfo}</p>
                {progressDetails && (
                  <div className="mt-2 pt-2 border-t border-border/50 space-y-1 text-xs">
                    {progressDetails.stage && (
                      <p>
                        <strong>Etapa:</strong> {progressDetails.stage}
                      </p>
                    )}
                    {progressDetails.page_count > 0 && (
                      <p>
                        <strong>Páginas processadas:</strong> {progressDetails.page_count}
                      </p>
                    )}
                    {progressDetails.total_collected > 0 && (
                      <p>
                        <strong>Anúncios coletados:</strong> {progressDetails.total_collected}
                      </p>
                    )}
                    {progressDetails.ads_before_dedup > 0 && (
                      <p>
                        <strong>Anúncios antes da deduplicação:</strong> {progressDetails.ads_before_dedup}
                      </p>
                    )}
                    {progressDetails.ads_after_dedup > 0 && (
                      <p>
                        <strong>Anúncios únicos:</strong> {progressDetails.ads_after_dedup}
                      </p>
                    )}
                    {progressDetails.enrichment_total > 0 && (
                      <p>
                        <strong>Lotes de enriquecimento:</strong> {progressDetails.enrichment_batches || 0}/{progressDetails.enrichment_total}
                      </p>
                    )}
                    {progressDetails.ads_enriched > 0 && (
                      <p>
                        <strong>Anúncios enriquecidos:</strong> {progressDetails.ads_enriched}
                      </p>
                    )}
                    {progressDetails.ads_formatted > 0 && (
                      <p>
                        <strong>Anúncios formatados:</strong> {progressDetails.ads_formatted}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Preview Modal */}
      <Modal isOpen={!!previewPack} onClose={closePreview} size="full" className="max-w-7xl" padding="md">
        <div className="space-y-1.5 mb-6">
          <h2 className="text-lg font-semibold leading-none tracking-tight flex items-center gap-2">
            <IconEye className="w-5 h-5" />
            Preview: {previewPack?.name}
          </h2>
          <p className="text-sm text-muted-foreground">Visualização completa dos dados formatados pelo sistema ({previewPack?.ads?.length || 0} anúncios)</p>
        </div>

        {previewPack && (
          <div className="overflow-auto max-h-[70vh] custom-scrollbar">
            <div className="bg-border p-4 rounded-lg mb-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="font-medium text-muted-foreground">Período:</p>
                  <p>
                    {formatDate(previewPack.date_start)} - {formatDate(previewPack.date_stop)}
                  </p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">Conta:</p>
                  <p>{getAccountName(previewPack.adaccount_id)}</p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">Total Investido:</p>
                  <p className="font-bold text-yellow-500">{formatCurrency(previewPack.stats?.totalSpend ?? 0)}</p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">Anúncios:</p>
                  <p>{previewPack.ads?.length || 0}</p>
                </div>
              </div>
            </div>

            {/* TanStack Table */}
            <div className="overflow-x-auto custom-scrollbar">
              <TanStackTableComponent data={previewPack.ads} formatCurrency={formatCurrency} />
            </div>
          </div>
        )}

        <div className="flex justify-between mt-6">
          <Button variant="outline" onClick={handleExportData} className="flex items-center gap-2">
            <IconDownload className="w-4 h-4" />
            Exportar CSV
          </Button>
          <Button variant="outline" onClick={closePreview}>
            Fechar
          </Button>
        </div>
      </Modal>

      {/* JSON Viewer Modal */}
      <Modal isOpen={!!jsonViewerPack} onClose={closeJsonViewer} size="full" className="max-w-6xl" padding="md">
        <div className="space-y-1.5 mb-6">
          <h2 className="text-lg font-semibold leading-none tracking-tight flex items-center gap-2">
            <IconCode className="w-5 h-5" />
            JSON Bruto: {jsonViewerPack?.name}
          </h2>
          <p className="text-sm text-muted-foreground">Dados brutos do pack em formato JSON ({jsonViewerPack?.ads?.length || 0} anúncios)</p>
        </div>

        {jsonViewerPack && (
          <div className="overflow-auto max-h-[70vh] custom-scrollbar">
            <div className="bg-border p-4 rounded-lg mb-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="font-medium text-muted-foreground">Período:</p>
                  <p>
                    {formatDate(jsonViewerPack.date_start)} - {formatDate(jsonViewerPack.date_stop)}
                  </p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">Anúncios:</p>
                  <p>{jsonViewerPack.ads?.length || 0}</p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">Filtros:</p>
                  <p>{jsonViewerPack.filters?.length || 0}</p>
                </div>
              </div>
            </div>

            <div className="bg-black rounded-lg p-4 overflow-auto custom-scrollbar">
              <pre className="text-green-400 text-xs font-mono whitespace-pre-wrap">{JSON.stringify(jsonViewerPack, null, 2)}</pre>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
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
            <IconDownload className="w-4 h-4 mr-2" />
            Exportar JSON
          </Button>
        </div>
      </Modal>

      {/* Refresh Pack Confirmation Dialog */}
      <Modal isOpen={!!packToRefresh} onClose={() => !isRefreshing && cancelRefreshPack()} size="md" padding="md" closeOnOverlayClick={!isRefreshing} closeOnEscape={!isRefreshing} showCloseButton={!isRefreshing}>
        <div className="flex flex-col items-center gap-6 py-4">
          <h2 className="text-xl font-semibold text-text">Atualizar Pack?</h2>

          <p className="text-center text-sm text-text-muted">
            Deseja atualizar o pack <strong>"{packToRefresh?.name}"</strong>? Esta ação irá buscar novos dados desde a última atualização até hoje.
          </p>

          <div className="flex gap-4 w-full">
            <Button onClick={cancelRefreshPack} variant="outline" className="flex-1 flex items-center justify-center gap-2 border-red-500/50 hover:border-red-500 hover:bg-red-500/10 text-red-500" disabled={isRefreshing}>
              <IconCircleX className="h-5 w-5" />
              Não
            </Button>

            <Button onClick={confirmRefreshPack} className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white" disabled={isRefreshing}>
              {isRefreshing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Atualizando...
                </>
              ) : (
                <>
                  <IconCircleCheck className="h-5 w-5" />
                  Sim
                </>
              )}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Confirmation Dialog */}
      <Modal isOpen={!!packToRemove} onClose={() => !isDeleting && setPackToRemove(null)} size="md" padding="md" closeOnOverlayClick={!isDeleting} closeOnEscape={!isDeleting}>
        <div className="space-y-1.5 mb-6">
          <h2 className="text-lg font-semibold leading-none tracking-tight">{isDeleting ? "Deletando Pack..." : "Confirmar Remoção"}</h2>
          <p className="text-sm text-muted-foreground">{isDeleting ? `Deletando pack "${packToRemove?.name}" e todos os dados relacionados do servidor...` : `Tem certeza que deseja remover o pack "${packToRemove?.name}"?`}</p>
        </div>

        <div className="py-4">
          <div className="bg-border p-4 rounded-lg">
            <p className="text-sm text-muted-foreground mb-2">Esta ação irá remover:</p>
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

        <div className="flex justify-end gap-3 mt-6">
          <Button variant="outline" onClick={cancelRemovePack} disabled={isDeleting}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={confirmRemovePack} disabled={isDeleting}>
            {isDeleting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                Deletando...
              </>
            ) : (
              <>
                <IconTrash className="w-4 h-4 mr-2" />
                Remover Pack
              </>
            )}
          </Button>
        </div>
      </Modal>

      {/* Disable Auto-Refresh Confirmation Dialog */}
      <Modal isOpen={!!packToDisableAutoRefresh} onClose={() => !isTogglingAutoRefresh && cancelDisableAutoRefresh()} size="md" padding="md" closeOnOverlayClick={!isTogglingAutoRefresh} closeOnEscape={!isTogglingAutoRefresh} showCloseButton={!isTogglingAutoRefresh}>
        <div className="flex flex-col items-center gap-6 py-4">
          <h2 className="text-xl font-semibold text-text">Desativar Auto-Refresh?</h2>

          <p className="text-center text-sm text-text-muted">
            Deseja desativar a atualização automática do pack <strong>"{packToDisableAutoRefresh?.name}"</strong>? O pack não será mais atualizado automaticamente e você precisará atualizá-lo manualmente quando necessário.
          </p>

          <div className="flex gap-4 w-full">
            <Button onClick={cancelDisableAutoRefresh} variant="outline" className="flex-1 flex items-center justify-center gap-2 border-red-500/50 hover:border-red-500 hover:bg-red-500/10 text-red-500" disabled={!!isTogglingAutoRefresh}>
              <IconCircleX className="h-5 w-5" />
              Não
            </Button>

            <Button onClick={() => packToDisableAutoRefresh && confirmToggleAutoRefresh(packToDisableAutoRefresh.id, false)} className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white" disabled={!!isTogglingAutoRefresh}>
              {isTogglingAutoRefresh ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Desativando...
                </>
              ) : (
                <>
                  <IconCircleCheck className="h-5 w-5" />
                  Sim
                </>
              )}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Rename Pack Dialog */}
      <Modal isOpen={!!packToRename} onClose={() => !isRenaming && cancelRenamePack()} size="md" padding="md" closeOnOverlayClick={!isRenaming} closeOnEscape={!isRenaming} showCloseButton={!isRenaming}>
        <div className="space-y-1.5 mb-6">
          <h2 className="text-lg font-semibold leading-none tracking-tight">Renomear Pack</h2>
          <p className="text-sm text-muted-foreground">Altere o nome do pack "{packToRename?.name}"</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Novo Nome</label>
            <Input
              placeholder="Digite o novo nome do pack"
              value={newPackName}
              onChange={(e) => setNewPackName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isRenaming && newPackName.trim()) {
                  confirmRenamePack();
                }
              }}
              disabled={isRenaming}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">O nome não pode estar vazio</p>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <Button variant="outline" onClick={cancelRenamePack} disabled={isRenaming}>
            Cancelar
          </Button>
          <Button onClick={confirmRenamePack} disabled={isRenaming || !newPackName.trim() || newPackName.trim() === packToRename?.name}>
            {isRenaming ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                Renomeando...
              </>
            ) : (
              <>
                <IconPencil className="w-4 h-4 mr-2" />
                Renomear
              </>
            )}
          </Button>
        </div>
      </Modal>

      {/* Booster de planilha por pack (Google Sheets) */}
      <GoogleSheetIntegrationDialog
        isOpen={!!sheetIntegrationPack}
        onClose={() => {
          setSheetIntegrationPack(null);
          // Packs serão recarregados automaticamente pelo PacksLoader
          // e já virão com sheet_integration atualizado
        }}
        packId={sheetIntegrationPack?.id ?? null}
      />
    </>
  );
}

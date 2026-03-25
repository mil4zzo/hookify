"use client";

import { useState, useEffect } from "react";
import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StandardCard } from "@/components/common/StandardCard";
import { PackCard } from "@/components/packs/PackCard";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Modal } from "@/components/common/Modal";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { LoadingState, EmptyState } from "@/components/common/States";
import { DateRangeFilter, DateRangeValue } from "@/components/common/DateRangeFilter";
import { Switch } from "@/components/ui/switch";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useMe, useAdAccountsDb, useInvalidatePackAds } from "@/lib/api/hooks";
import { GoogleSheetIntegrationDialog } from "@/components/ads/GoogleSheetIntegrationDialog";
import { useClientAuth, useClientPacks, useClientAdAccounts } from "@/lib/hooks/useClientSession";
import { useOnboardingGate } from "@/lib/hooks/useOnboardingGate";
import { showSuccess, showError } from "@/lib/utils/toast";
import { api } from "@/lib/api/endpoints";
import { IconCalendar, IconFilter, IconPlus, IconTrash, IconChartBar, IconEye, IconDownload, IconArrowsSort, IconCode, IconLoader2, IconCircleCheck, IconCircleX, IconCircleDot, IconInfoCircle, IconRotateClockwise, IconRefresh, IconDotsVertical, IconPencil, IconTableExport, IconMicrophone } from "@tabler/icons-react";
import { useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel, createColumnHelper, flexRender, ColumnDef } from "@tanstack/react-table";

import { FilterRule } from "@/lib/api/schemas";
import { AdsPack } from "@/lib/types";
import { getAggregatedPackStatistics } from "@/lib/utils/adCounting";
import { useFormatCurrency } from "@/lib/utils/currency";
import { PageContainer } from "@/components/common/PageContainer";
import { PageActions } from "@/components/common/PageActions";
import { usePageConfig } from "@/lib/hooks/usePageConfig";
import { getTodayLocal, formatDateLocal } from "@/lib/utils/dateFilters";
import { subDays } from "date-fns";
import { useUpdatingPacksStore } from "@/lib/store/updatingPacks";
import { usePacksLoading } from "@/components/layout/PacksLoader";
import { Skeleton } from "@/components/ui/skeleton";
import { filterVideoAds } from "@/lib/utils/filterVideoAds";
import { usePackRefresh, type RefreshToggles } from "@/lib/hooks/usePackRefresh";
import { usePackCreation } from "@/lib/hooks/usePackCreation";
import { MetaIcon, GoogleSheetsIcon } from "@/components/icons";
import { logger } from "@/lib/utils/logger";

const STORAGE_KEY_DATE_RANGE = "hookify-packs-date-range";
const STORAGE_KEY_REFRESH_TOGGLES = "hookify:refresh-toggles";

const DEFAULT_REFRESH_TOGGLES: RefreshToggles = {
  meta: true,
  leadscore: true,
  transcription: false,
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
    const saved = localStorage.getItem(STORAGE_KEY_DATE_RANGE);
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

// Funções auxiliares para persistir preferências dos toggles de refresh
const loadRefreshToggles = (): RefreshToggles | null => {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY_REFRESH_TOGGLES);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (parsed && typeof parsed === "object" && "meta" in parsed && "leadscore" in parsed && "transcription" in parsed) {
      return {
        meta: Boolean(parsed.meta),
        leadscore: Boolean(parsed.leadscore),
        transcription: Boolean(parsed.transcription),
      };
    }
    return null;
  } catch (e) {
    logger.error("Erro ao carregar refresh toggles do localStorage:", e);
    return null;
  }
};

const saveRefreshToggles = (toggles: RefreshToggles) => {
  try {
    localStorage.setItem(STORAGE_KEY_REFRESH_TOGGLES, JSON.stringify(toggles));
  } catch (e) {
    logger.error("Erro ao salvar refresh toggles no localStorage:", e);
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
    const colorClass = status === "ACTIVE" ? "bg-success-20 text-success" : status === "PAUSED" ? "bg-warning-20 text-warning" : "bg-destructive-20 text-destructive";
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
    if (value.length === 0) return <span className="text-xs text-muted-foreground">[]</span>;
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

export default function PacksPage() {
  const pageConfig = usePageConfig();
  const formatCurrency = useFormatCurrency();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [packToRemove, setPackToRemove] = useState<{ id: string; name: string; adsCount: number } | null>(null);
  const [packToRefresh, setPackToRefresh] = useState<{ id: string; name: string } | null>(null);
  const [refreshType, setRefreshType] = useState<"since_last_refresh" | "full_period">("since_last_refresh");
  const [refreshToggles, setRefreshToggles] = useState<RefreshToggles>(() => loadRefreshToggles() ?? DEFAULT_REFRESH_TOGGLES);
  const [packToDisableAutoRefresh, setPackToDisableAutoRefresh] = useState<{ id: string; name: string } | null>(null);
  const [packToRename, setPackToRename] = useState<{ id: string; name: string } | null>(null);
  const [newPackName, setNewPackName] = useState<string>("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [isTogglingAutoRefresh, setIsTogglingAutoRefresh] = useState<string | null>(null);
  const { isPackUpdating } = useUpdatingPacksStore();
  const { refreshPack, isRefreshing, startTranscriptionOnly } = usePackRefresh();
  const { startCreation, cancelCreation, isCreating } = usePackCreation({
    onComplete: () => {
      setFormData((prev) => ({
        ...prev,
        name: getNextPackName(),
        filters: [],
        auto_refresh: false,
      }));
    },
  });
  const [previewPack, setPreviewPack] = useState<any>(null);
  const [jsonViewerPack, setJsonViewerPack] = useState<any>(null);
  const [sheetIntegrationPack, setSheetIntegrationPack] = useState<any | null>(null);

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
  const [packNameDuplicateError, setPackNameDuplicateError] = useState(false);

  // Store hooks
  const { isAuthenticated, user, isClient } = useClientAuth();
  const { packs, removePack, updatePack } = useClientPacks();
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

  // Para o modal de refresh: habilita botão Confirmar apenas se ao menos um processo estiver selecionado
  const refreshModalPack = packToRefresh ? packs.find((p) => p.id === packToRefresh.id) : null;
  const hasSheetIntegrationInModal = !!refreshModalPack?.sheet_integration?.id;
  const canConfirmRefresh = refreshToggles.meta || (refreshToggles.leadscore && hasSheetIntegrationInModal) || refreshToggles.transcription;

  // Update pack name when packs change or modal opens
  useEffect(() => {
    if (isDialogOpen) {
      setPackNameDuplicateError(false);
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

  const handleLoadPack = async () => {
    const validationError = validateForm();
    if (validationError) {
      showError({ message: validationError });
      return;
    }

    const packName = formData.name.trim() || getNextPackName();

    // Verificar nome duplicado
    const existingPack = packs.find((p) => p.name.trim().toLowerCase() === packName.toLowerCase());
    if (existingPack) {
      setPackNameDuplicateError(true);
      showError({ message: `Já existe um pack com o nome "${packName}"` });
      return;
    }

    try {
      const result = await startCreation({
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

      if (result) {
        // Job iniciado — fechar modal, o progresso segue no toast
        setIsDialogOpen(false);
      }
    } catch (error) {
      logger.error("packs/page: erro ao iniciar criação do pack", error);
      showError(error as any);
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
        logger.error("Erro ao buscar stats do pack:", error);
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

      // Invalidar dados agregados (ad performance) para atualizar Manager/Insights
      invalidateAdPerformance();

      showSuccess(`Pack "${packToRemove.name}" removido com sucesso!`);
      setPackToRemove(null);
    } catch (error) {
      logger.error("Erro ao deletar pack do Supabase:", error);
      // Ainda remove do estado local mesmo se falhar no Supabase
      removePack(packToRemove.id);

      // Invalidar cache mesmo se falhar no servidor
      await invalidatePackAds(packToRemove.id).catch(() => {});

      // Invalidar dados agregados (ad performance) para atualizar Manager/Insights
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

    // Verificar se já existe outro pack com o mesmo nome
    const existingPack = packs.find((p) => p.id !== packToRename.id && p.name.trim().toLowerCase() === trimmedName.toLowerCase());
    if (existingPack) {
      showError({ message: `Já existe um pack com o nome "${trimmedName}"` });
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
      logger.error("Erro ao renomear pack:", error);
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
        } else if (!response.success) {
          logger.error("packs/page: getPack retornou success:false ao carregar preview", { packId: pack.id, response });
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
      logger.error("Erro ao carregar ads do pack para preview:", error);
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
      logger.error("Erro ao carregar ads do pack para JSON viewer:", error);
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

  const handleRefreshPack = (packId: string) => {
    const pack = packs.find((p) => p.id === packId);
    if (!pack) return;

    setPackToRefresh({
      id: pack.id,
      name: pack.name,
    });
    // Resetar para opção padrão (desde última atualização)
    setRefreshType("since_last_refresh");
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
      logger.error("Erro ao atualizar auto_refresh:", error);
      showError({ message: `Erro ao ${newValue ? "ativar" : "desativar"} auto-refresh: ${error}` });
    } finally {
      setIsTogglingAutoRefresh(null);
    }
  };

  const cancelRefreshPack = () => {
    // Verifica se algum pack está atualizando
    const currentPackId = packToRefresh?.id;
    if (currentPackId && isRefreshing(currentPackId)) return; // Não permite cancelar durante o refresh
    setPackToRefresh(null);
    setRefreshType("since_last_refresh"); // Resetar para padrão
  };

  /**
   * Confirma e executa o refresh do pack usando o hook centralizado
   */
  const confirmRefreshPack = async () => {
    if (!packToRefresh) return;

    const packId = packToRefresh.id;
    const packName = packToRefresh.name;
    const pack = packs.find((p) => p.id === packId);
    const hasSheetIntegration = !!pack?.sheet_integration?.id;

    // Toggles efetivos: leadscore só conta se o pack tiver integração
    const effectiveToggles: RefreshToggles = {
      ...refreshToggles,
      leadscore: refreshToggles.leadscore && hasSheetIntegration,
    };

    // Persistir preferência dos toggles para a próxima abertura do modal
    saveRefreshToggles(refreshToggles);

    // Fechar modal imediatamente após confirmar
    setPackToRefresh(null);

    // Usar hook centralizado para refresh (processos independentes conforme toggles)
    await refreshPack({
      packId,
      packName,
      refreshType,
      sheetIntegrationId: pack?.sheet_integration?.id,
      toggles: effectiveToggles,
    });
  };

  const handleEditSheetIntegration = (pack: AdsPack) => {
    setSheetIntegrationPack(pack);
  };

  const handleDeleteSheetIntegration = async (pack: AdsPack) => {
    if (!pack.sheet_integration?.id) return;

    if (!confirm(`Tem certeza que deseja remover a integração de planilha do pack "${pack.name}"?`)) {
      return;
    }

    try {
      await api.integrations.google.deleteSheetIntegration(pack.sheet_integration.id);
      showSuccess("Integração removida com sucesso!");

      // Recarregar packs para atualizar dados
      try {
        const response = await api.analytics.listPacks(false);
        if (response.success && response.packs) {
          const updatedPack = response.packs.find((p: any) => p.id === pack.id);
          if (updatedPack) {
            updatePack(pack.id, {
              sheet_integration: updatedPack.sheet_integration || null,
            } as Partial<AdsPack>);
          }
        }
      } catch (error) {
        logger.error("Erro ao recarregar pack após deletar integração:", error);
      }
    } catch (error) {
      showError(error instanceof Error ? error : new Error("Erro ao remover integração"));
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
      <PageContainer
        title="Biblioteca"
        description="Gerencie seus Packs de anúncios."
        variant="standard"
        actions={
          <PageActions>
            <Button className="flex items-center gap-2" onClick={() => setIsDialogOpen(true)}>
              <IconPlus className="w-4 h-4" />
              Carregar Pack
            </Button>
          </PageActions>
        }
      >
        {/* Packs Grid */}
        {isLoadingPacks ? (
          // Skeleton enquanto carrega packs
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="relative inline-block w-full">
                {/* Cards decorativos atrás */}
                <div className="absolute inset-0 rounded-xl bg-card rotate-2 pointer-events-none" />
                <div className="absolute inset-0 rounded-xl bg-secondary rotate-1 pointer-events-none" />

                <StandardCard variant="default" padding="none" className="relative flex flex-col z-10 w-full overflow-hidden">
                  <div className="p-6 space-y-6 flex flex-col justify-between h-full relative z-10">
                    <div className="flex flex-col items-center gap-2">
                      {/* Header: Nome do pack */}
                      <div className="flex items-start justify-center">
                        <div className="flex flex-col items-center justify-center min-w-0">
                          <Skeleton className="h-7 w-32" />
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-center gap-2">
                      <div className="flex flex-col items-center">
                        {/* Date range skeleton */}
                        <Skeleton className="h-4 w-32" />
                      </div>
                      {/* Valor monetário em destaque */}
                      <div className="flex items-center justify-center gap-2">
                        <Skeleton className="h-9 w-32" />
                      </div>
                    </div>

                    {/* Métricas: Lista vertical com separadores */}
                    <div className="flex flex-col">
                      <div className="flex items-center justify-between py-2 border-b border-border">
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-4 w-8" />
                      </div>
                      <div className="flex items-center justify-between py-2 border-b border-border">
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-4 w-8" />
                      </div>
                      <div className="flex items-center justify-between py-2 border-b border-border">
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-4 w-8" />
                      </div>
                      <div className="flex items-center justify-between py-2">
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-4 w-8" />
                      </div>
                    </div>

                    {/* Footer: Toggles e última atualização */}
                    <div className="flex flex-col gap-2">
                      {/* Toggle Atualização automática */}
                      <div className="flex items-center justify-between w-full">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-5 w-10 rounded-full" />
                      </div>
                      {/* Toggle Leadscore */}
                      <div className="flex items-center justify-between w-full">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-5 w-10 rounded-full" />
                      </div>
                      {/* Última atualização Meta */}
                      <div className="flex items-center justify-between mt-3">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                      {/* Última atualização Leadscore (opcional) */}
                      <div className="flex items-center justify-between">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                  </div>
                </StandardCard>
              </div>
            ))}
          </div>
        ) : packs.length === 0 ? (
          <StandardCard variant="card" padding="lg">
            <CardContent className="p-12 text-center">
              <IconChartBar className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">Nenhum Pack Carregado</h3>
              <p className="text-muted-foreground mb-6">Carregue seu primeiro pack de anúncios para começar a análise</p>
              <Button onClick={() => setIsDialogOpen(true)}>
                <IconPlus className="w-4 h-4 mr-2" />
                Carregar Primeiro Pack
              </Button>
            </CardContent>
          </StandardCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {packs.map((pack) => (
              <PackCard key={pack.id} pack={pack} formatCurrency={formatCurrency} formatDate={formatDate} formatDateTime={formatDateTime} getAccountName={getAccountName} onRefresh={handleRefreshPack} onRemove={handleRemovePack} onToggleAutoRefresh={handleToggleAutoRefresh} onSetSheetIntegration={setSheetIntegrationPack} onEditSheetIntegration={handleEditSheetIntegration} onDeleteSheetIntegration={handleDeleteSheetIntegration} onTranscribeAds={(packId, packName) => startTranscriptionOnly(packId, packName)} isUpdating={isPackUpdating(pack.id)} isTogglingAutoRefresh={isTogglingAutoRefresh} packToDisableAutoRefresh={packToDisableAutoRefresh} />
            ))}
          </div>
        )}
      </PageContainer>

      {/* Load Pack Modal */}
      <Modal isOpen={isDialogOpen} onClose={() => setIsDialogOpen(false)} size="2xl" padding="md" closeOnOverlayClick closeOnEscape showCloseButton>
        <div className="space-y-1.5 mb-6">
          <h2 className="text-lg font-semibold leading-none tracking-tight">Carregar Pack de Anúncios</h2>
          <p className="text-sm text-muted-foreground">Configure os parâmetros para carregar um novo pack de anúncios</p>
        </div>

        <div className="space-y-6">
          {/* Pack Name */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Nome do Pack</label>
            <Input
              placeholder="Ex: Black Friday Campaign, Q4 Performance, etc."
              value={formData.name}
              onChange={(e) => {
                setPackNameDuplicateError(false);
                setFormData((prev) => ({ ...prev, name: e.target.value }));
              }}
              className={packNameDuplicateError ? "border-destructive focus-visible:ring-destructive" : undefined}
            />
            <p className={packNameDuplicateError ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{packNameDuplicateError ? "Já existe um pack com esse nome. Escolha outro." : "Dê um nome descritivo para identificar facilmente seu pack"}</p>
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

                      // Definir ícone e cor baseado no status
                      let StatusIcon;
                      let iconColor;
                      if (accountStatus === 1) {
                        // Ativo
                        StatusIcon = IconCircleCheck;
                        iconColor = "text-success";
                      } else if (accountStatus === 2) {
                        // Pausado
                        StatusIcon = IconCircleDot;
                        iconColor = "text-warning";
                      } else if (accountStatus === 3) {
                        // Desativado
                        StatusIcon = IconCircleX;
                        iconColor = "text-destructive";
                      } else {
                        // Desconhecido
                        StatusIcon = IconCircleDot;
                        iconColor = "text-muted-foreground";
                      }

                      const isActive = accountStatus === 1;

                      return (
                        <SelectItem key={account.id} value={account.id} textValue={accountName}>
                          <div className={`flex items-center gap-2 w-full min-w-0 ${!isActive ? "opacity-50" : ""}`}>
                            <StatusIcon className={`w-4 h-4 flex-shrink-0 ${iconColor}`} />
                            <span className="font-medium text-sm truncate">{accountName}</span>
                          </div>
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex flex-col gap-2 p-4 border border-border rounded-md bg-muted-50">
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
                <ToggleSwitch
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
                  labelLeft="Manter atualizado"
                  variant="minimal"
                  size="md"
                  labelClassName={formData.date_stop !== getTodayLocal() ? "text-muted-foreground cursor-not-allowed" : "cursor-pointer"}
                />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <IconInfoCircle className="w-4 h-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{formData.date_stop !== getTodayLocal() ? "Disponível apenas quando a data final é hoje." : "Quando ativado, o pack será atualizado automaticamente."}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
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
            <Button onClick={handleLoadPack} disabled={!!validateForm() || isCreating} className="flex-1" size="lg">
              <IconChartBar className="w-4 h-4 mr-2" />
              Carregar Pack
            </Button>
          </div>
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
          <div className="overflow-auto max-h-[70vh]">
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
                  <p className="font-bold text-warning">{formatCurrency(previewPack.stats?.totalSpend ?? 0)}</p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">Anúncios:</p>
                  <p>{previewPack.ads?.length || 0}</p>
                </div>
              </div>
            </div>

            {/* TanStack Table */}
            <div className="overflow-x-auto">
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
          <div className="overflow-auto max-h-[70vh]">
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

            <div className="bg-black rounded-lg p-4 overflow-auto">
              <pre className="text-success text-xs font-mono whitespace-pre-wrap">{JSON.stringify(jsonViewerPack, null, 2)}</pre>
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
      <Modal isOpen={!!packToRefresh} onClose={cancelRefreshPack} size="md" padding="md" closeOnOverlayClick closeOnEscape showCloseButton>
        <div className="flex flex-col gap-5 py-4">
          <div>
            <h2 className="text-xl font-semibold text-text mb-1">Atualizar Pack?</h2>
            <p className="text-sm text-text-muted">
              Deseja atualizar o pack <strong>"{packToRefresh?.name}"</strong>? Escolha o tipo de atualização:
            </p>
          </div>

          {/* Toggles: Meta, Leadscore, Transcrição */}
          {(() => {
            const pack = packToRefresh ? packs.find((p) => p.id === packToRefresh.id) : null;
            const hasSheetIntegration = !!pack?.sheet_integration?.id;
            return (
              <div className="w-full space-y-2">
                <div className="flex flex-col gap-3">
                  <ToggleSwitch id="refresh-toggle-meta" checked={refreshToggles.meta} onCheckedChange={(checked) => setRefreshToggles((prev) => ({ ...prev, meta: checked }))} label="Meta" variant="minimal" icon={<MetaIcon className="h-4 w-4 flex-shrink-0" />} />
                  <div className="flex items-center gap-2">
                    <ToggleSwitch id="refresh-toggle-leadscore" checked={hasSheetIntegration ? refreshToggles.leadscore : false} onCheckedChange={(checked) => setRefreshToggles((prev) => ({ ...prev, leadscore: checked }))} label="Leadscore (Google Sheets)" variant="minimal" icon={<GoogleSheetsIcon className="h-4 w-4 flex-shrink-0" />} disabled={!hasSheetIntegration} />
                    {!hasSheetIntegration && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help flex-shrink-0" />
                          </TooltipTrigger>
                          <TooltipContent>Ative o leadscore integrando uma planilha.</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                  <ToggleSwitch id="refresh-toggle-transcription" checked={refreshToggles.transcription} onCheckedChange={(checked) => setRefreshToggles((prev) => ({ ...prev, transcription: checked }))} label="Transcrição" variant="minimal" icon={<IconMicrophone className="h-4 w-4 flex-shrink-0 text-orange-500" />} />
                </div>
              </div>
            );
          })()}

          {/* Opções de período */}
          {(() => {
            const pack = refreshModalPack;
            const formatDateDisplay = (s: string) => {
              if (!s) return "";
              const [y, m, d] = s.split("-");
              return `${d}/${m}/${y}`;
            };
            const today = getTodayLocal();
            const sinceLastRange = pack?.last_refreshed_at ? `${formatDateDisplay(formatDateLocal(subDays(new Date(pack.last_refreshed_at + "T12:00:00"), 1)))} → ${formatDateDisplay(today)}` : "—";
            const fullPeriodRange = pack?.date_start && pack?.date_stop ? (pack.auto_refresh ? `${formatDateDisplay(pack.date_start)} → ${formatDateDisplay(today)}` : `${formatDateDisplay(pack.date_start)} → ${formatDateDisplay(pack.date_stop)}`) : "—";
            return (
              <div className="w-full space-y-2">
                <button type="button" onClick={() => setRefreshType("since_last_refresh")} className={`w-full p-3 rounded-lg border-2 text-left transition-all cursor-pointer ${refreshType === "since_last_refresh" ? "border-primary bg-primary-10" : "border-border hover:border-primary-50 bg-input-30"}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${refreshType === "since_last_refresh" ? "border-primary" : "border-border"}`}>{refreshType === "since_last_refresh" && <div className="w-2 h-2 rounded-full bg-primary" />}</div>
                    <div>
                      <div className="font-semibold text-text text-sm">Desde a última atualização</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{sinceLastRange}</div>
                    </div>
                  </div>
                </button>

                <button type="button" onClick={() => setRefreshType("full_period")} className={`w-full p-3 rounded-lg border-2 text-left transition-all cursor-pointer ${refreshType === "full_period" ? "border-primary bg-primary-10" : "border-border hover:border-primary-50 bg-input-30"}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${refreshType === "full_period" ? "border-primary" : "border-border"}`}>{refreshType === "full_period" && <div className="w-2 h-2 rounded-full bg-primary" />}</div>
                    <div>
                      <div className="font-semibold text-text text-sm">Todo o período</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{fullPeriodRange}</div>
                    </div>
                  </div>
                </button>
              </div>
            );
          })()}

          <div className="flex gap-4 w-full">
            <Button onClick={cancelRefreshPack} variant="destructiveOutline" className="flex-1 flex items-center justify-center gap-2">
              <IconCircleX className="h-5 w-5" />
              Cancelar
            </Button>

            <Button onClick={confirmRefreshPack} variant="success" className="flex-1 flex items-center justify-center gap-2" disabled={!canConfirmRefresh}>
              <IconCircleCheck className="h-5 w-5" />
              Confirmar
            </Button>
          </div>
        </div>
      </Modal>

      {/* Confirmation Dialog */}
      <ConfirmDialog isOpen={!!packToRemove} onClose={() => !isDeleting && setPackToRemove(null)} title={isDeleting ? "Deletando Pack..." : "Confirmar Remoção"} message={isDeleting ? `Excluindo os dados do pack "${packToRemove?.name}..."` : `Tem certeza que deseja remover o pack "${packToRemove?.name}"?`} onConfirm={confirmRemovePack} onCancel={cancelRemovePack} variant="destructive" confirmText="Remover Pack" isLoading={isDeleting} loadingText="Deletando..." layout="left-aligned" confirmIcon={<IconTrash className="w-4 h-4" />}>
        {!isDeleting && (
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
        )}
      </ConfirmDialog>

      {/* Disable Auto-Refresh Confirmation Dialog */}
      <ConfirmDialog isOpen={!!packToDisableAutoRefresh} onClose={() => !isTogglingAutoRefresh && cancelDisableAutoRefresh()} title="Desativar atualização automática?" message="Ao desativar você precisará lembrar de atualizá-lo manualmente quando necessário." onConfirm={() => packToDisableAutoRefresh && confirmToggleAutoRefresh(packToDisableAutoRefresh.id, false)} onCancel={cancelDisableAutoRefresh} confirmText="Desativar" isLoading={!!isTogglingAutoRefresh} />

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

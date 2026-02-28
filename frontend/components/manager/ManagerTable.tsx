"use client";

import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/common/Modal";
import { useFormatCurrency } from "@/lib/utils/currency";
import { AdInfoCard } from "@/components/ads/AdInfoCard";
import { AdDetailsDialog } from "@/components/ads/AdDetailsDialog";
import { VideoDialog } from "@/components/ads/VideoDialog";
import { createColumnHelper, getCoreRowModel, getSortedRowModel, getFilteredRowModel, useReactTable, ColumnFiltersState, SortingState, ColumnSizingState } from "@tanstack/react-table";
import type { ColumnDef } from "@tanstack/react-table";
import { IconSearch, IconPlus, IconFilter, IconCheck, IconIdBadge, IconDeviceTablet, IconBorderAll, IconFolder, IconPlayCardA, IconLayoutGrid, IconTable, IconArrowsHorizontal } from "@tabler/icons-react";
import { SparklineBars } from "@/components/common/SparklineBars";
import { MetricCard } from "@/components/common/MetricCard";
import { buildDailySeries } from "@/lib/utils/metricsTimeSeries";
import { api } from "@/lib/api/endpoints";
import { RankingsItem } from "@/lib/api/schemas";
import { useMqlLeadscore } from "@/lib/hooks/useMqlLeadscore";
import { useSettingsModalStore } from "@/lib/store/settingsModal";
import { useManagerAverages, type ManagerAverages } from "@/lib/hooks/useManagerAverages";
import { useFilteredAverages } from "@/lib/hooks/useFilteredAverages";
import { createManagerTableColumns } from "@/components/manager/managerTableColumns";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ColumnFilter, FilterValue, FilterOperator, TextFilterValue, TextFilterOperator } from "@/components/common/ColumnFilter";
import { Separator } from "@/components/common/Separator";
import { Input } from "@/components/ui/input";
import { TabbedContent, TabbedContentItem, type TabItem } from "@/components/common/TabbedContent";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AdsetDetailsDialog } from "@/components/ads/AdsetDetailsDialog";
import { MetricCell } from "@/components/manager/MetricCell";
import { AdNameCell } from "@/components/manager/AdNameCell";
import { FilterBar } from "@/components/manager/FilterBar";
import { ManagerColumnFilter, type ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import { DEFAULT_MANAGER_COLUMNS } from "@/components/manager/managerColumns";
import { TableContent } from "@/components/manager/TableContent";
import { MinimalTableContent } from "@/components/manager/MinimalTableContent";
import { useDebouncedSessionStorage } from "@/lib/hooks/useDebouncedSessionStorage";
import { logger } from "@/lib/utils/logger";

type Ad = RankingsItem;

interface ManagerTableProps {
  ads: Ad[];
  groupByAdName?: boolean;
  activeTab?: "individual" | "por-anuncio" | "por-conjunto" | "por-campanha";
  onTabChange?: (tab: "individual" | "por-anuncio" | "por-conjunto" | "por-campanha") => void;
  /** Dataset para a aba Individual (group_by=ad_id) */
  adsIndividual?: Ad[];
  /** Loading específico da aba Individual */
  isLoadingIndividual?: boolean;
  /** Dataset para a aba Por conjunto (group_by=adset_id) */
  adsAdset?: Ad[];
  /** Loading específico da aba Por conjunto */
  isLoadingAdset?: boolean;
  /** Dataset para a aba Por campanha (group_by=campaign_id) */
  adsCampaign?: Ad[];
  /** Loading específico da aba Por campanha */
  isLoadingCampaign?: boolean;
  actionType?: string;
  endDate?: string;
  dateStart?: string;
  dateStop?: string;
  availableConversionTypes?: string[];
  showTrends?: boolean;
  averagesOverride?: {
    hook: number | null;
    scroll_stop: number | null;
    ctr: number | null;
    website_ctr: number | null;
    connect_rate: number | null;
    cpm: number | null;
    cpr: number | null;
    page_conv: number | null;
  };
  /** Indica se há integração de planilha (Google Sheets) em pelo menos um dos packs selecionados */
  hasSheetIntegration?: boolean;
  /** Indica se os dados estão sendo carregados */
  isLoading?: boolean;
  /** Filtros iniciais a serem aplicados (ex: vindos de query params da URL) */
  initialFilters?: Array<{ id: string; value: any }>;
}

const columnHelper = createColumnHelper<Ad>();

const STORAGE_KEY_MANAGER_COLUMNS = "hookify-manager-columns";
const STORAGE_KEY_VIEW_MODE = "hookify-manager-view-mode";

// Tipo para o modo de visualização
type ViewMode = "detailed" | "minimal";

// SortIcon foi movido para `managerTableMetricColumns.tsx` junto do factory de colunas.

// ExpandedChildrenRow foi extraído para arquivo próprio em `frontend/components/manager/ExpandedChildrenRow.tsx`

export function ManagerTable({ ads, groupByAdName = true, activeTab, onTabChange, adsIndividual, isLoadingIndividual, adsAdset, isLoadingAdset, adsCampaign, isLoadingCampaign, actionType = "", endDate, dateStart, dateStop, availableConversionTypes = [], showTrends = true, averagesOverride, hasSheetIntegration = false, isLoading = false, initialFilters }: ManagerTableProps) {
  type ManagerTab = "individual" | "por-anuncio" | "por-conjunto" | "por-campanha";
  const initialTab = (activeTab ?? "por-anuncio") as ManagerTab;
  const [internalTab, setInternalTab] = useState<ManagerTab>(initialTab);
  const currentTab = (activeTab ?? internalTab) as ManagerTab;

  // Use debounced session storage to batch writes and reduce I/O
  const debouncedStorage = useDebouncedSessionStorage(500);

  const loadManagerColumns = useCallback((): Set<ManagerColumnType> => {
    if (typeof window === "undefined") return new Set<ManagerColumnType>(DEFAULT_MANAGER_COLUMNS);
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY_MANAGER_COLUMNS);
      if (!saved) return new Set<ManagerColumnType>(DEFAULT_MANAGER_COLUMNS);
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((col) => (DEFAULT_MANAGER_COLUMNS as readonly string[]).includes(col));
        if (valid.length === 0) return new Set<ManagerColumnType>(DEFAULT_MANAGER_COLUMNS);
        return new Set<ManagerColumnType>(valid as ManagerColumnType[]);
      }
      return new Set<ManagerColumnType>(DEFAULT_MANAGER_COLUMNS);
    } catch (e) {
      logger.error("Erro ao carregar colunas do Manager do sessionStorage:", e);
      return new Set<ManagerColumnType>(DEFAULT_MANAGER_COLUMNS);
    }
  }, []);

  const saveManagerColumns = useCallback(
    (columns: Set<ManagerColumnType>) => {
      if (typeof window === "undefined") return;
      debouncedStorage.setItem(STORAGE_KEY_MANAGER_COLUMNS, JSON.stringify(Array.from(columns)));
    },
    [debouncedStorage],
  );

  const [activeColumns, setActiveColumns] = useState<Set<ManagerColumnType>>(() => loadManagerColumns());

  // Estado para modo de visualização
  const loadViewMode = useCallback((): ViewMode => {
    if (typeof window === "undefined") return "detailed";
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY_VIEW_MODE);
      if (saved === "minimal" || saved === "detailed") {
        return saved;
      }
      return "detailed";
    } catch (e) {
      logger.error("Erro ao carregar modo de visualização:", e);
      return "detailed";
    }
  }, []);

  const [viewMode, setViewMode] = useState<ViewMode>(() => loadViewMode());

  const handleViewModeChange = useCallback(
    (mode: ViewMode) => {
      setViewMode(mode);
      if (typeof window !== "undefined") {
        debouncedStorage.setItem(STORAGE_KEY_VIEW_MODE, mode);
      }
    },
    [debouncedStorage],
  );

  // Função para resetar o tamanho das colunas para os valores padrão
  const handleResetColumnSizes = useCallback(() => {
    setColumnSizing({});
  }, []);

  // Remover automaticamente cpmql e mqls quando hasSheetIntegration for false
  useEffect(() => {
    if (!hasSheetIntegration) {
      setActiveColumns((prev) => {
        const hasCpmql = prev.has("cpmql");
        const hasMqls = prev.has("mqls");
        if (!hasCpmql && !hasMqls) {
          // Nada a fazer, já estão removidas
          return prev;
        }
        const next = new Set(prev);
        if (hasCpmql) next.delete("cpmql");
        if (hasMqls) next.delete("mqls");
        saveManagerColumns(next);
        return next;
      });
    }
  }, [hasSheetIntegration, saveManagerColumns]);

  const isColumnEnabled = useCallback(
    (columnId: ManagerColumnType) => {
      if (columnId === "cpmql" || columnId === "mqls") return hasSheetIntegration;
      return true;
    },
    [hasSheetIntegration],
  );

  const isColumnVisible = useCallback((columnId: ManagerColumnType) => activeColumns.has(columnId) && isColumnEnabled(columnId), [activeColumns, isColumnEnabled]);

  const handleToggleColumn = useCallback(
    (columnId: ManagerColumnType) => {
      setActiveColumns((prev) => {
        const next = new Set(prev);
        if (next.has(columnId)) {
          if (next.size <= 1) {
            // Garantir pelo menos 1 coluna selecionada (além de ad_name que é fixa)
            return prev;
          }
          next.delete(columnId);
        } else {
          next.add(columnId);
        }
        saveManagerColumns(next);
        return next;
      });
    },
    [saveManagerColumns],
  );
  const handleTabChange = (value: string) => {
    const next = value as ManagerTab;
    if (activeTab === undefined) {
      setInternalTab(next);
    }
    onTabChange?.(next);
  };

  // Por aba:
  // - individual: por ad_id (sem agrupamento por nome)
  // - por-anuncio: agrupado por nome (comportamento atual)
  // - por-conjunto: por adset_id (sem agrupamento por nome)
  const groupByAdNameEffective = currentTab === "por-anuncio";
  const adsEffective = currentTab === "individual" ? (adsIndividual ?? ads) : currentTab === "por-conjunto" ? (adsAdset ?? ads) : currentTab === "por-campanha" ? (adsCampaign ?? ads) : ads;
  const isLoadingEffective = currentTab === "individual" ? (isLoadingIndividual ?? isLoading) : currentTab === "por-conjunto" ? (isLoadingAdset ?? isLoading) : currentTab === "por-campanha" ? (isLoadingCampaign ?? isLoading) : isLoading;

  const [selectedAd, setSelectedAd] = useState<Ad | null>(null);
  const [selectedAdset, setSelectedAdset] = useState<{ adsetId: string; adsetName?: string | null } | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<{ videoId: string; actorId: string; title: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const hydratingTabRef = useRef<ManagerTab | null>(null);
  const expandedRef = useRef<Record<string, boolean>>({});

  // Manter referência estável/atualizada do estado de expansão.
  // Isso permite que `columns` não dependa diretamente de `expanded`, evitando recriações em hot paths (ex.: resize onChange).
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  const getFiltersStorageKey = (tab: ManagerTab) => `hookify-manager-filters:${tab}`;
  const getGlobalFilterStorageKey = (tab: ManagerTab) => `hookify-manager-global-filter:${tab}`;

  const loadColumnFilters = (tab: ManagerTab): ColumnFiltersState => {
    if (typeof window === "undefined") return [];
    try {
      const saved = sessionStorage.getItem(getFiltersStorageKey(tab));
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      logger.error("Erro ao carregar filtros do sessionStorage:", e);
      return [];
    }
  };

  const loadGlobalFilter = (tab: ManagerTab): string => {
    if (typeof window === "undefined") return "";
    try {
      return sessionStorage.getItem(getGlobalFilterStorageKey(tab)) || "";
    } catch (e) {
      logger.error("Erro ao carregar globalFilter do sessionStorage:", e);
      return "";
    }
  };

  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() => loadColumnFilters(initialTab));

  const [sorting, setSorting] = useState<SortingState>([{ id: "spend", desc: true }]);

  const [globalFilter, setGlobalFilter] = useState(() => loadGlobalFilter(initialTab));

  // Estado para gerenciar o tamanho das colunas
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});

  // Refs para evitar recriação das colunas durante mudanças de filtros (performance optimization)
  const columnFiltersRef = useRef<ColumnFiltersState>([]);
  const globalFilterRef = useRef<string>("");

  // Se o usuário ocultar colunas, remover filters/sorting dessas colunas para evitar estado "invisível"
  useEffect(() => {
    const enabledColumns = new Set<ManagerColumnType>();
    for (const col of activeColumns) {
      if (isColumnEnabled(col)) enabledColumns.add(col);
    }

    // Column filters: manter apenas os que ainda existem/estão visíveis
    setColumnFilters((prev) => prev.filter((f) => f.id === "ad_name" || enabledColumns.has(f.id as ManagerColumnType)));

    // Sorting: manter apenas sorting de colunas visíveis; se ficar vazio, escolher fallback visível
    setSorting((prev) => {
      const filtered = prev.filter((s) => s.id === "ad_name" || enabledColumns.has(s.id as ManagerColumnType));
      if (filtered.length > 0) return filtered;

      const fallbackOrder: Array<{ id: ManagerColumnType; desc: boolean }> = [
        { id: "spend", desc: true },
        { id: "results", desc: true },
        { id: "hook", desc: true },
        { id: "ctr", desc: true },
        { id: "website_ctr", desc: true },
        { id: "connect_rate", desc: true },
        { id: "page_conv", desc: true },
        { id: "cpm", desc: true },
        { id: "cpr", desc: false },
        { id: "cpmql", desc: false },
        { id: "mqls", desc: true },
      ];
      const next = fallbackOrder.find((c) => enabledColumns.has(c.id));
      return next ? [{ id: next.id, desc: next.desc }] : [{ id: "spend", desc: true }];
    });
  }, [activeColumns, isColumnEnabled]);

  // Salvar filtros no sessionStorage sempre que mudarem (debounced para reduzir I/O)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (hydratingTabRef.current === currentTab) return;
    debouncedStorage.setItem(getFiltersStorageKey(currentTab), JSON.stringify(columnFilters));
  }, [columnFilters, currentTab, debouncedStorage]);

  // Salvar globalFilter no sessionStorage sempre que mudar (debounced para reduzir I/O)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (hydratingTabRef.current === currentTab) return;
    debouncedStorage.setItem(getGlobalFilterStorageKey(currentTab), globalFilter);
  }, [globalFilter, currentTab, debouncedStorage]);

  // Rehidratar filtros e busca ao trocar de aba (persistência por aba)
  useEffect(() => {
    hydratingTabRef.current = currentTab;
    setColumnFilters(loadColumnFilters(currentTab));
    setGlobalFilter(loadGlobalFilter(currentTab));
    // Resetar expansão ao trocar de tab para evitar estados inconsistentes
    setExpanded({});
  }, [currentTab]);

  // Liberar persistência após hidratar o tab atual
  useEffect(() => {
    if (hydratingTabRef.current === currentTab) {
      hydratingTabRef.current = null;
    }
  }, [columnFilters, globalFilter, currentTab]);

  // Aplicar filtros iniciais (ex: vindos de query params da URL)
  const initialFiltersAppliedRef = useRef(false);
  useEffect(() => {
    if (initialFilters && initialFilters.length > 0 && !initialFiltersAppliedRef.current) {
      // Converter filtros iniciais para o formato esperado pelo TanStack Table
      const formattedFilters: ColumnFiltersState = initialFilters.map((filter) => {
        // Assumir que filtros de texto usam "contains" por padrão
        const textFilterValue: TextFilterValue = {
          operator: "contains",
          value: filter.value,
        };
        return {
          id: filter.id,
          value: textFilterValue,
        };
      });

      setColumnFilters(formattedFilters);
      initialFiltersAppliedRef.current = true;
    } else if (!initialFilters || initialFilters.length === 0) {
      // Resetar flag quando não há mais filtros iniciais
      initialFiltersAppliedRef.current = false;
    }
  }, [initialFilters]);

  // Os dados já vêm agregados do servidor quando pais; não re-agregar aqui
  // Aplicar filtro de busca pelo nome do anúncio
  const data = useMemo(() => {
    if (!adsEffective || !Array.isArray(adsEffective)) {
      return [];
    }
    if (!globalFilter || globalFilter.trim() === "") {
      return adsEffective;
    }
    const searchValue = globalFilter.toLowerCase().trim();
    return adsEffective.filter((ad) => {
      const adName = String((ad as RankingsItem)?.ad_name || "").toLowerCase();
      return adName.includes(searchValue);
    });
  }, [adsEffective, globalFilter]);
  const formatCurrency = useFormatCurrency();
  const { mqlLeadscoreMin } = useMqlLeadscore();

  // Stable formatters using useCallback to prevent column recreation
  const formatPct = useCallback((v: number) => (v != null && !isNaN(v) ? `${Number(v).toFixed(2)}%` : "—"), []);
  const formatNum = useCallback((v: number) => (v ? v.toLocaleString("pt-BR") : "—"), []);
  // formatUsd agora usa formatCurrency diretamente dentro dos cells para reatividade

  // Função helper para aplicar filtros numéricos
  const applyNumericFilter = useCallback((rowValue: number | null | undefined, filterValue: FilterValue | undefined): boolean => {
    // Importante: esta função precisa ser estável para não invalidar `columns` durante resize (onChange).
    if (!filterValue || filterValue.value === null || filterValue.value === undefined || isNaN(filterValue.value)) {
      return true; // Sem filtro, mostrar tudo
    }

    if (rowValue === null || rowValue === undefined || isNaN(rowValue) || !isFinite(rowValue)) {
      return false; // Valor inválido, não mostrar
    }

    const { operator, value: filterNum } = filterValue;

    switch (operator) {
      case ">":
        return rowValue > filterNum!;
      case "<":
        return rowValue < filterNum!;
      case ">=":
        return rowValue >= filterNum!;
      case "<=":
        return rowValue <= filterNum!;
      case "=":
        return Math.abs(rowValue - filterNum!) < 0.0001; // Tolerância para comparação de floats
      case "!=":
        return Math.abs(rowValue - filterNum!) >= 0.0001;
      default:
        return true;
    }
  }, []);

  const computedAverages = useManagerAverages({
    ads: adsEffective,
    actionType,
    hasSheetIntegration,
    mqlLeadscoreMin,
  });

  const averages = useMemo(() => {
    if (averagesOverride) {
      // Verificar inconsistências para métricas que dependem de actionType
      if (actionType) {
        // Se o actionType está selecionado mas não há média do servidor, pode ser um problema
        if (averagesOverride.cpr === null && computedAverages.cpr !== null) {
          logger.warn(`[ManagerTable] CPR média não retornada pelo servidor para actionType "${actionType}", usando cálculo local.`, { actionType, availableConversionTypes });
        }
        if (averagesOverride.page_conv === null && computedAverages.page_conv !== null) {
          logger.warn(`[ManagerTable] Page Conv média não retornada pelo servidor para actionType "${actionType}", usando cálculo local.`, { actionType, availableConversionTypes });
        }
      }

      return {
        count: computedAverages.count,
        spend: computedAverages.spend,
        impressions: computedAverages.impressions,
        clicks: computedAverages.clicks,
        inline_link_clicks: computedAverages.inline_link_clicks,
        lpv: computedAverages.lpv,
        plays: computedAverages.plays,
        results: computedAverages.results,
        hook: averagesOverride.hook,
        scroll_stop: averagesOverride.scroll_stop,
        ctr: averagesOverride.ctr,
        website_ctr: averagesOverride.website_ctr ?? computedAverages.website_ctr,
        connect_rate: averagesOverride.connect_rate,
        cpm: averagesOverride.cpm,
        // CPR e page_conv dependem do actionType, usar computedAverages como fallback se null
        // Mas logar quando isso acontecer para identificar problemas
        cpr: averagesOverride.cpr ?? computedAverages.cpr,
        page_conv: averagesOverride.page_conv ?? computedAverages.page_conv,
        // CPMQL e MQLs são calculados localmente e não vêm do servidor
        cpmql: computedAverages.cpmql,
        mqls: computedAverages.mqls,
      } as ManagerAverages;
    }
    return computedAverages;
  }, [computedAverages, averagesOverride, actionType, availableConversionTypes]);

  // Refs para armazenar as médias filtradas e função de formatação (para evitar dependência circular)
  const filteredAveragesRef = useRef<any>(null);
  const formatFilteredAverageRef = useRef<(metricId: string) => string>(() => "");

  const getRowKey = useCallback(
    (row: { original?: RankingsItem } | RankingsItem) => {
      const original = "original" in row ? row.original : row;
      if (!original) return "";
      const item = original as RankingsItem;
      if (groupByAdNameEffective) {
        return String(item.ad_name || item.ad_id);
      }
      if (currentTab === "por-campanha") {
        return String((item as any).campaign_id || item.unique_id || `${item.account_id}:${item.ad_id}`);
      }
      if (currentTab === "por-conjunto") {
        return String((item as any).adset_id || item.unique_id || `${item.account_id}:${item.ad_id}`);
      }
      return String(item.unique_id || `${item.account_id}:${item.ad_id}`);
    },
    [groupByAdNameEffective, currentTab],
  );

  // Funções estáveis para evitar recriação a cada render
  const handleSelectAd = useCallback((ad: RankingsItem) => {
    setSelectedAd(ad);
  }, []);

  const handleSelectAdset = useCallback((adset: React.SetStateAction<{ adsetId: string; adsetName?: string | null } | null>) => {
    setSelectedAdset(adset);
  }, []);

  const handleResetFilters = useCallback(() => {
    setColumnFilters([]);
  }, [setColumnFilters]);

  // Pre-aggregate 5-day daily series ending at provided endDate (fallback se não vier do servidor)
  const { byKey } = useMemo(() => {
    if (!endDate) return { byKey: new Map<string, any>() };
    // Verificar se os dados já vêm com séries do servidor
    const hasServerSeries = adsEffective.length > 0 && (adsEffective as any)[0]?.series;

    if (hasServerSeries) {
      // Construir mapa a partir das séries do servidor
      const map = new Map<string, any>();
      (adsEffective as any as RankingsItem[]).forEach((ad: RankingsItem) => {
        const key = getRowKey({ original: ad });
        if (ad.series) {
          map.set(key, { series: ad.series, axis: ad.series.axis });
        }
      });
      return { byKey: map };
    }
    // Fallback: calcular séries client-side
    return buildDailySeries(adsEffective as any, {
      groupBy: groupByAdNameEffective ? "ad_name" : "ad_id",
      actionType,
      endDate,
      dateField: "date",
      windowDays: 5,
    });
  }, [adsEffective, groupByAdNameEffective, actionType, endDate, getRowKey]);

  // Função helper para formatar a média de uma métrica
  const formatAverage = useMemo(
    () =>
      (metricId: string): string => {
        const metricMap: Record<string, keyof ManagerAverages> = {
          hook: "hook",
          cpr: "cpr",
          cpmql: "cpmql",
          spend: "spend",
          ctr: "ctr",
          website_ctr: "website_ctr",
          cpm: "cpm",
          connect_rate: "connect_rate",
          page_conv: "page_conv",
          results: "results",
          mqls: "mqls",
        };

        const metricKey = metricMap[metricId];
        if (!metricKey) return "";

        const avgValue = averages[metricKey];
        if (avgValue === null || avgValue === undefined || !Number.isFinite(avgValue)) {
          return "";
        }

        // Formatar baseado no tipo de métrica
        if (metricId === "hook" || metricId === "ctr" || metricId === "website_ctr" || metricId === "connect_rate" || metricId === "page_conv") {
          // Métricas em porcentagem (decimal 0-1)
          return formatPct(Number(avgValue) * 100);
        } else if (metricId === "results" || metricId === "mqls") {
          // Métricas absolutas (número inteiro)
          return Math.round(Number(avgValue)).toString();
        } else {
          // Métricas monetárias (cpr, cpmql, spend, cpm)
          return formatCurrency(Number(avgValue));
        }
      },
    [averages, formatPct, formatCurrency],
  );

  const { openSettings } = useSettingsModalStore();

  const columns = useMemo<ColumnDef<Ad, any>[]>(() => {
    return createManagerTableColumns({
      columnHelper: columnHelper as any,
      activeColumns,
      groupByAdNameEffective,
      byKey,
      expanded,
      expandedRef,
      setExpanded,
      currentTab,
      getRowKey,
      endDate,
      showTrends,
      averages,
      formatAverage,
      filteredAveragesRef,
      formatFilteredAverageRef,
      formatCurrency,
      formatPct,
      viewMode,
      hasSheetIntegration,
      mqlLeadscoreMin,
      actionType,
      applyNumericFilter,
      openSettings: openSettings as any,
      columnFiltersRef,
      globalFilterRef,
    });
  }, [activeColumns, groupByAdNameEffective, byKey, expanded, endDate, showTrends, averages, formatAverage, formatCurrency, formatPct, viewMode, hasSheetIntegration, mqlLeadscoreMin, getRowKey, applyNumericFilter, currentTab, openSettings]);

  // Handler que garante que sempre haja pelo menos uma ordenação
  const handleSortingChange = useCallback((updater: SortingState | ((old: SortingState) => SortingState)) => {
    setSorting((old) => {
      const newSorting = typeof updater === "function" ? updater(old) : updater;
      // Se o array de sorting ficar vazio, restaurar para o padrão (spend desc)
      if (!newSorting || newSorting.length === 0) {
        return [{ id: "spend", desc: true }];
      }
      return newSorting;
    });
  }, []);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    enableSorting: true,
    enableColumnFilters: true,
    columnResizeMode: "onEnd", // Atualiza apenas ao soltar o mouse (melhor performance)
    state: {
      columnFilters,
      sorting,
      columnSizing,
      columnVisibility: {
        adset_name_filter: false,
        campaign_name_filter: false,
      },
    },
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: handleSortingChange,
    onColumnSizingChange: setColumnSizing,
    initialState: {
      sorting: [{ id: "spend", desc: true }],
    },
    defaultColumn: {
      size: 100,
      minSize: 80,
    },
  });

  // Calcular médias dos dados filtrados (visíveis na tabela após aplicar filtros)
  const filteredAverages = useFilteredAverages({
    table: table as any,
    dataLength: data.length,
    columnFilters,
    globalFilter,
    actionType,
    hasSheetIntegration,
    mqlLeadscoreMin,
  });

  // Função helper para formatar a média filtrada de uma métrica
  const formatFilteredAverage = useMemo(
    () =>
      (metricId: string): string => {
        if (!filteredAverages) return "";

        const metricMap: Record<string, string> = {
          hook: "hook",
          cpr: "cpr",
          cpmql: "cpmql",
          spend: "spend",
          ctr: "ctr",
          website_ctr: "website_ctr",
          cpm: "cpm",
          connect_rate: "connect_rate",
          page_conv: "page_conv",
          results: "results",
          mqls: "mqls",
        };

        const metricKey = metricMap[metricId];
        if (!metricKey) return "";

        const avgValue = (filteredAverages as any)[metricKey];
        if (avgValue === null || avgValue === undefined || !Number.isFinite(avgValue)) {
          return "";
        }

        // Formatar baseado no tipo de métrica
        if (metricId === "hook" || metricId === "ctr" || metricId === "website_ctr" || metricId === "connect_rate" || metricId === "page_conv") {
          // Métricas em porcentagem (decimal 0-1)
          return formatPct(Number(avgValue) * 100);
        } else if (metricId === "results" || metricId === "mqls") {
          // Métricas absolutas (número inteiro)
          return Math.round(Number(avgValue)).toString();
        } else {
          // Métricas monetárias (cpr, cpmql, spend, cpm)
          return formatCurrency(Number(avgValue));
        }
      },
    [filteredAverages, formatPct, formatCurrency],
  );

  // Atualizar refs sincronamente (antes do render) para que os headers leiam valores atualizados
  // Não usar useEffect aqui pois ele roda APÓS render, causando valores desatualizados nos headers
  filteredAveragesRef.current = filteredAverages;
  formatFilteredAverageRef.current = formatFilteredAverage;
  columnFiltersRef.current = columnFilters;
  globalFilterRef.current = globalFilter;

  // Sincronizar filtros carregados do sessionStorage com as colunas da tabela
  useEffect(() => {
    columnFilters.forEach((filter) => {
      const column = table.getColumn(filter.id);
      if (column && filter.value) {
        const filterValue = filter.value as FilterValue;
        // Só atualizar se o valor da coluna for diferente do filtro
        const currentValue = column.getFilterValue() as FilterValue | undefined;
        if (!currentValue || currentValue.operator !== filterValue.operator || currentValue.value !== filterValue.value) {
          column.setFilterValue(filterValue);
        }
      }
    });
  }, [columnFilters, table]);

  // Mapeamento de colunas disponíveis para filtro
  const filterableColumns = useMemo(() => {
    // Coluna de nome (texto) baseada na aba atual
    const nameColumn = currentTab === "por-conjunto" ? { id: "ad_name", label: "Conjunto", isText: true } : currentTab === "por-campanha" ? { id: "ad_name", label: "Campanha", isText: true } : { id: "ad_name", label: "Anúncio", isText: true };

    const isEnabled = (id: ManagerColumnType) => {
      if (id === "cpmql" || id === "mqls") return hasSheetIntegration;
      return true;
    };
    const shouldShow = (id: ManagerColumnType) => activeColumns.has(id) && isEnabled(id);

    const cols: Array<{ id: string; label: string; isPercentage?: boolean; isText?: boolean; isStatus?: boolean }> = [];

    // Filtro de status disponível em todas as abas exceto "por-anuncio"
    if (currentTab !== "por-anuncio") {
      cols.push({ id: "status", label: "Status", isStatus: true });
    }

    cols.push(nameColumn);

    // Filtros de nome cruzados (adset_name e campaign_name) por aba
    if (currentTab === "individual" || currentTab === "por-anuncio") {
      cols.push({ id: "adset_name_filter", label: "Conjunto", isText: true });
      cols.push({ id: "campaign_name_filter", label: "Campanha", isText: true });
    } else if (currentTab === "por-conjunto") {
      cols.push({ id: "campaign_name_filter", label: "Campanha", isText: true });
    }
    // por-campanha: adset_name é null nessa aba, não adicionar filtro de conjunto

    if (shouldShow("hook")) cols.push({ id: "hook", label: "Hook", isPercentage: true });
    if (shouldShow("cpr")) cols.push({ id: "cpr", label: "CPR", isPercentage: false });
    if (shouldShow("cpmql")) cols.push({ id: "cpmql", label: "CPMQL", isPercentage: false });
    if (shouldShow("spend")) cols.push({ id: "spend", label: "Spend", isPercentage: false });
    if (shouldShow("ctr")) cols.push({ id: "ctr", label: "CTR", isPercentage: true });
    if (shouldShow("website_ctr")) cols.push({ id: "website_ctr", label: "Link CTR", isPercentage: true });
    if (shouldShow("cpm")) cols.push({ id: "cpm", label: "CPM", isPercentage: false });
    if (shouldShow("connect_rate")) cols.push({ id: "connect_rate", label: "Connect", isPercentage: true });
    if (shouldShow("page_conv")) cols.push({ id: "page_conv", label: "Page", isPercentage: true });
    if (shouldShow("results")) cols.push({ id: "results", label: "Results", isPercentage: false });
    if (shouldShow("mqls")) cols.push({ id: "mqls", label: "MQLs", isPercentage: false });

    return cols;
  }, [hasSheetIntegration, currentTab, activeColumns]);

  const tabs: TabItem[] = [
    { value: "individual", label: "Individual", icon: IconDeviceTablet },
    { value: "por-anuncio", label: "Por anúncio", icon: IconPlayCardA },
    { value: "por-conjunto", label: "Por conjunto", icon: IconBorderAll },
    { value: "por-campanha", label: "Por campanha", icon: IconFolder },
  ];

  const controls = (
    <>
      <div className="relative flex-1 min-w-0 max-w-sm">
        <IconSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input type="search" placeholder={currentTab === "por-conjunto" ? "Buscar por nome do conjunto..." : currentTab === "por-campanha" ? "Buscar por nome da campanha..." : "Buscar por nome do anúncio..."} value={globalFilter} onChange={(e) => setGlobalFilter(e.target.value)} className="pl-9 h-10" />
      </div>
      <div className="flex items-center gap-2">
        {/* Toggle de visualização */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={() => handleViewModeChange(viewMode === "detailed" ? "minimal" : "detailed")} className="h-10 px-3" aria-label={viewMode === "detailed" ? "Alternar para visualização minimal" : "Alternar para visualização detalhada"}>
                {viewMode === "detailed" ? <IconLayoutGrid className="h-4 w-4" /> : <IconTable className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">{viewMode === "detailed" ? "Visualização minimal" : "Visualização detalhada"}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div className="flex-shrink-0 w-[190px]">
          <ManagerColumnFilter activeColumns={activeColumns} onToggleColumn={handleToggleColumn} isColumnDisabled={(id) => !hasSheetIntegration && (id === "cpmql" || id === "mqls")} />
        </div>
        {/* Botão para resetar tamanho das colunas */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={handleResetColumnSizes} className="h-10 px-3" aria-label="Resetar tamanho das colunas" disabled={Object.keys(columnSizing).length === 0}>
                <IconArrowsHorizontal className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Resetar tamanho das colunas</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </>
  );

  const tableContentProps = useMemo(
    () => ({
      table,
      isLoadingEffective,
      getRowKey,
      expanded,
      setExpanded,
      groupByAdNameEffective,
      currentTab,
      setSelectedAd: handleSelectAd,
      setSelectedAdset: handleSelectAdset,
      dateStart,
      dateStop,
      actionType,
      formatCurrency,
      formatPct,
      columnFilters,
      setColumnFilters,
      activeColumns,
      hasSheetIntegration,
      mqlLeadscoreMin,
      sorting,
      dataLength: data.length,
      showTrends,
    }),
    [table, isLoadingEffective, getRowKey, expanded, setExpanded, groupByAdNameEffective, currentTab, handleSelectAd, handleSelectAdset, dateStart, dateStop, actionType, formatCurrency, formatPct, columnFilters, setColumnFilters, activeColumns, hasSheetIntegration, mqlLeadscoreMin, sorting, data.length, showTrends],
  );

  return (
    <div className="w-full h-full flex-1 flex flex-col min-h-0">
      <TabbedContent value={currentTab} onValueChange={handleTabChange} variant="with-controls" tabs={tabs} controls={controls} separatorAfterTabs={true}>
        <TabbedContentItem value="individual" variant="with-controls">
          <FilterBar columnFilters={columnFilters} setColumnFilters={setColumnFilters} filterableColumns={filterableColumns} table={table} />
          {viewMode === "minimal" ? <MinimalTableContent {...tableContentProps} /> : <TableContent {...tableContentProps} />}
        </TabbedContentItem>

        <TabbedContentItem value="por-anuncio" variant="with-controls">
          <FilterBar columnFilters={columnFilters} setColumnFilters={setColumnFilters} filterableColumns={filterableColumns} table={table} />
          {viewMode === "minimal" ? <MinimalTableContent {...tableContentProps} /> : <TableContent {...tableContentProps} />}
        </TabbedContentItem>

        <TabbedContentItem value="por-conjunto" variant="with-controls">
          <FilterBar columnFilters={columnFilters} setColumnFilters={setColumnFilters} filterableColumns={filterableColumns} table={table} />
          {viewMode === "minimal" ? <MinimalTableContent {...tableContentProps} /> : <TableContent {...tableContentProps} />}
        </TabbedContentItem>

        <TabbedContentItem value="por-campanha" variant="with-controls">
          <FilterBar columnFilters={columnFilters} setColumnFilters={setColumnFilters} filterableColumns={filterableColumns} table={table} />
          {viewMode === "minimal" ? <MinimalTableContent {...tableContentProps} /> : <TableContent {...tableContentProps} />}
        </TabbedContentItem>
      </TabbedContent>

      {/* Details Dialog */}
      <Modal isOpen={!!selectedAd} onClose={() => setSelectedAd(null)} size="4xl" padding="md">
        {selectedAd && <AdDetailsDialog ad={selectedAd} groupByAdName={groupByAdNameEffective} dateStart={dateStart} dateStop={dateStop} actionType={actionType} availableConversionTypes={availableConversionTypes} averages={averages} />}
      </Modal>

      {/* Adset Details Dialog */}
      <Modal isOpen={!!selectedAdset} onClose={() => setSelectedAdset(null)} size="4xl" padding="md">
        {selectedAdset && <AdsetDetailsDialog adsetId={selectedAdset.adsetId} adsetName={selectedAdset.adsetName} dateStart={dateStart} dateStop={dateStop} actionType={actionType} />}
      </Modal>

      {/* Video Dialog - Único para toda a tabela */}
      <VideoDialog
        open={videoOpen}
        onOpenChange={(open) => {
          setVideoOpen(open);
          if (!open) setSelectedVideo(null);
        }}
        videoId={selectedVideo?.videoId}
        actorId={selectedVideo?.actorId}
        title={selectedVideo?.title}
      />
    </div>
  );
}

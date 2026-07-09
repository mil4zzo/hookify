"use client";

import React, { useMemo, useState, useEffect, useCallback, useRef, startTransition, useDeferredValue } from "react";
import { Button } from "@/components/ui/button";
import { AppDialog } from "@/components/common/AppDialog";
import { useFormatCurrency } from "@/lib/utils/currency";
import dynamic from "next/dynamic";
import { AdInfoCard } from "@/components/ads/AdInfoCard";

const AdDetailsDialog = dynamic(() => import("@/components/ads/AdDetailsDialog").then((m) => m.AdDetailsDialog), { ssr: false });
import { createColumnHelper, getCoreRowModel, getSortedRowModel, getFilteredRowModel, useReactTable, ColumnFiltersState, SortingState, ColumnSizingState, RowSelectionState } from "@tanstack/react-table";
import type { ColumnDef } from "@tanstack/react-table";
import { IconPlus, IconFilter, IconCheck, IconIdBadge, IconDeviceTablet, IconBorderAll, IconFolder, IconPlayCardA, IconLoader2, IconDownload, IconPlayerPause, IconPlayerPlay, IconX, IconMaximize, IconMinimize, IconAdjustmentsHorizontal, IconChevronDown } from "@tabler/icons-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";
import { ManagerExportDialog } from "@/components/manager/ManagerExportDialog";
import { toast } from "sonner";
import { SparklineBars } from "@/components/common/SparklineBars";
import { api } from "@/lib/api/endpoints";
import { RankingsItem } from "@/lib/api/schemas";
import { useMqlLeadscore } from "@/lib/hooks/useMqlLeadscore";
import { useSettingsModalStore } from "@/lib/store/settingsModal";
import { useManagerAverages } from "@/lib/hooks/useManagerAverages";
import { useFilteredAverages } from "@/lib/hooks/useFilteredAverages";
import { createManagerTableColumns } from "@/components/manager/managerTableColumns";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ColumnFilter, FilterValue, FilterOperator, TextFilterValue, TextFilterOperator } from "@/components/common/ColumnFilter";
import { Separator } from "@/components/common/Separator";
import { TabbedContentItem, type TabItem } from "@/components/common/TabbedContent";
import { TabbedWorkspace, TableWorkspace } from "@/components/common/layout";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
const AdsetDetailsDialog = dynamic(() => import("@/components/ads/AdsetDetailsDialog").then((m) => m.AdsetDetailsDialog), { ssr: false });
import { MetricCell } from "@/components/manager/MetricCell";
import { SearchInputWithClear } from "@/components/common/SearchInputWithClear";
import { FilterBar } from "@/components/manager/FilterBar";
import { ManagerColumnFilter, type ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import { DEFAULT_MANAGER_COLUMNS, MANAGER_COLUMN_RENDER_ORDER, MANAGER_COLUMN_OPTIONS } from "@/components/manager/managerColumns";
import { TableContent } from "@/components/manager/TableContent";
import { MinimalTableContent } from "@/components/manager/MinimalTableContent";
import { ManagerDrillModal } from "@/components/manager/ManagerDrillModal";
import { useDrillState, type DrillKind } from "@/lib/manager/useDrillState";
import { useDebouncedSessionStorage } from "@/lib/hooks/useDebouncedSessionStorage";
import { logger } from "@/lib/utils/logger";
import { getColumnId } from "@/lib/utils/columnFilters";
import { buildGroupedMetricBaseSeries, formatManagerAverageValue, type ManagerAverages } from "@/lib/metrics";
import { getManagerFilterableColumns, getVisibleManagerColumns } from "@/components/manager/managerColumnPreferences";
import { useBulkAdStatusControl } from "@/lib/hooks/useAdStatusControl";
import { cn } from "@/lib/utils/cn";

type Ad = RankingsItem;

/** Referência estável para filtros vazios — evita que TanStack Table detecte "mudança" quando o array é [] em ambos os renders */
const EMPTY_FILTERS: ColumnFiltersState = [];

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
  selectedPackIds?: string[];
  endDate?: string;
  dateStart?: string;
  dateStop?: string;
  availableConversionTypes?: string[];
  showTrends?: boolean;
  /** Setter do toggle Médias/Tendências — permite hospedar o controle dentro do menu "Exibição". */
  onShowTrendsChange?: (checked: boolean) => void;
  averagesOverride?: {
    hook: number | null;
    hold_rate?: number | null;
    video_watched_p50?: number | null;
    video_watched_p75?: number | null;
    scroll_stop: number | null;
    ctr: number | null;
    website_ctr: number | null;
    connect_rate: number | null;
    cpm: number | null;
    cpr: number | null;
    cpc?: number | null;
    cplc?: number | null;
    page_conv: number | null;
  };
  /** Indica se há integração de planilha (Google Sheets) em pelo menos um dos packs selecionados */
  hasSheetIntegration?: boolean;
  /** Indica se os dados estão sendo carregados */
  isLoading?: boolean;
  /** Indica que a requisição da aba por-anuncio falhou (ex: timeout do RPC) */
  isError?: boolean;
  /** Filtros iniciais a serem aplicados (ex: vindos de query params da URL) */
  initialFilters?: Array<{ id: string; value: any }>;
  /** Callback para informar chaves de grupo visiveis no viewport da tabela atual. */
  onVisibleGroupKeysChange?: (tab: "individual" | "por-anuncio" | "por-conjunto" | "por-campanha", keys: string[]) => void;
}

const columnHelper = createColumnHelper<Ad>();

const STORAGE_KEY_MANAGER_COLUMNS = "hookify-manager-columns";
const STORAGE_KEY_VIEW_MODE = "hookify-manager-view-mode";
const STORAGE_KEY_COLOR_METRICS = "hookify-manager-color-metrics";

// Map vazio estável para byKey quando server series existem (evita re-criação de columns)
const EMPTY_SERIES_MAP = new Map<string, any>();

// Tipo para o modo de visualização
type ViewMode = "detailed" | "minimal";

const MANAGER_TABS: TabItem[] = [
  { value: "por-anuncio", label: "Criativos", icon: IconPlayCardA },
  { value: "por-campanha", label: "Por campanha", icon: IconFolder },
  { value: "por-conjunto", label: "Por conjunto", icon: IconBorderAll },
  { value: "individual", label: "Por anúncio", icon: IconDeviceTablet },
];

// SortIcon foi movido para `managerTableMetricColumns.tsx` junto do factory de colunas.

// ExpandedChildrenRow / CampaignChildrenRow são reusados como conteúdo do ManagerDrillModal.

export function ManagerTable({ ads, groupByAdName = true, activeTab, onTabChange, adsIndividual, isLoadingIndividual, adsAdset, isLoadingAdset, adsCampaign, isLoadingCampaign, actionType = "", selectedPackIds = [], endDate, dateStart, dateStop, availableConversionTypes = [], showTrends = true, onShowTrendsChange, averagesOverride, hasSheetIntegration = false, isLoading = false, isError = false, initialFilters, onVisibleGroupKeysChange }: ManagerTableProps) {
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
        const valid = parsed.filter((col) => (MANAGER_COLUMN_RENDER_ORDER as readonly string[]).includes(col));
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

  // Colorir o número das métricas pela distância da média (escala de 5 tons, igual aos sparklines).
  // Persistido em localStorage — preferência de exibição que deve valer entre sessões.
  const [colorMetricValue, setColorMetricValue] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(STORAGE_KEY_COLOR_METRICS) === "true";
    } catch (e) {
      return false;
    }
  });

  const handleColorMetricValueChange = useCallback((checked: boolean) => {
    setColorMetricValue(checked);
    try {
      localStorage.setItem(STORAGE_KEY_COLOR_METRICS, String(checked));
    } catch (e) {
      logger.error("Erro ao salvar preferência de colorir métricas:", e);
    }
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

  // Re-adicionar cpmql e mqls a activeColumns quando hasSheetIntegration passar a true (ex.: após packs carregarem)
  useEffect(() => {
    if (hasSheetIntegration) {
      setActiveColumns((prev) => {
        const needsCpmql = !prev.has("cpmql");
        const needsMqls = !prev.has("mqls");
        if (!needsCpmql && !needsMqls) return prev;
        const next = new Set(prev);
        if (needsCpmql) next.add("cpmql");
        if (needsMqls) next.add("mqls");
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

  // Bulk: seleciona todas as colunas habilitadas (ex: cpmql/mqls ficam de fora sem planilha)
  const handleSelectAllColumns = useCallback(() => {
    const next = new Set<ManagerColumnType>(MANAGER_COLUMN_OPTIONS.filter((column) => isColumnEnabled(column.id)).map((column) => column.id));
    saveManagerColumns(next);
    setActiveColumns(next);
  }, [isColumnEnabled, saveManagerColumns]);

  // Bulk: limpa a seleção (mesmo padrão do PackFilter — 0 é um estado válido)
  const handleDeselectAllColumns = useCallback(() => {
    const next = new Set<ManagerColumnType>();
    saveManagerColumns(next);
    setActiveColumns(next);
  }, [saveManagerColumns]);
  const handleTabChange = (value: string) => {
    const next = value as ManagerTab;
    if (activeTab === undefined) {
      setInternalTab(next);
    }
    setRowSelection({});
    onTabChange?.(next);
  };

  // Por aba:
  // - individual: por ad_id (sem agrupamento por nome)
  // - por-anuncio: agrupado por nome (comportamento atual)
  // - por-conjunto: por adset_id (sem agrupamento por nome)
  const groupByAdNameEffective = currentTab === "por-anuncio";
  const adsEffectiveRaw = currentTab === "individual" ? (adsIndividual ?? ads) : currentTab === "por-conjunto" ? (adsAdset ?? ads) : currentTab === "por-campanha" ? (adsCampaign ?? ads) : ads;
  // useDeferredValue permite que o React renderize a UI com os dados anteriores enquanto processa
  // os novos 2000+ items em background, evitando que a main thread trave por vários segundos.
  const adsEffective = useDeferredValue(adsEffectiveRaw);
  const isDeferredAdsPending = adsEffective !== adsEffectiveRaw;
  const isLoadingBase = currentTab === "individual" ? (isLoadingIndividual ?? isLoading) : currentTab === "por-conjunto" ? (isLoadingAdset ?? isLoading) : currentTab === "por-campanha" ? (isLoadingCampaign ?? isLoading) : isLoading;
  // Evita empty-state transitório: quando o fetch terminou e o dado bruto já chegou,
  // mas o valor deferido ainda não materializou as linhas na tabela.
  const shouldHoldLoadingForDeferred = !isLoadingBase && isDeferredAdsPending && adsEffective.length === 0 && adsEffectiveRaw.length > 0;
  // Mantém o comportamento anterior (loading guiado pelo fetch base), com exceção
  // do gap curto de defer acima para não piscar "Nenhum resultado".
  const isLoadingEffective = isLoadingBase || shouldHoldLoadingForDeferred;
  const [showSlowLoadingHint, setShowSlowLoadingHint] = useState(false);
  const slowLoadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (slowLoadingTimerRef.current) {
      clearTimeout(slowLoadingTimerRef.current);
      slowLoadingTimerRef.current = null;
    }

    if (!isLoadingEffective) {
      setShowSlowLoadingHint(false);
      return;
    }

    // Avoid noisy UI flashes; only show hint on sustained loading.
    slowLoadingTimerRef.current = setTimeout(() => {
      setShowSlowLoadingHint(true);
      slowLoadingTimerRef.current = null;
    }, 20000);

    return () => {
      if (slowLoadingTimerRef.current) {
        clearTimeout(slowLoadingTimerRef.current);
        slowLoadingTimerRef.current = null;
      }
    };
  }, [isLoadingEffective, currentTab]);

  const SLOW_LOADING_TOAST_ID = "manager-slow-loading";
  useEffect(() => {
    if (showSlowLoadingHint) {
      toast.loading(
        <div className="flex items-center gap-3">
          <IconLoader2 className="h-5 w-5 animate-spin flex-shrink-0 text-muted-foreground" />
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <span className="text-xs text-muted-foreground">Uau, muitos dados!</span>
            <span className="text-sm text-foreground">O carregamento pode demorar alguns minutos devido ao alto volume. Isso é ótimo, continue escalando!</span>
          </div>
        </div>,
        { id: SLOW_LOADING_TOAST_ID, duration: Infinity },
      );
    } else {
      toast.dismiss(SLOW_LOADING_TOAST_ID);
    }
    return () => { toast.dismiss(SLOW_LOADING_TOAST_ID); };
  }, [showSlowLoadingHint]);

  const [selectedAd, setSelectedAd] = useState<Ad | null>(null);
  const [selectedAdset, setSelectedAdset] = useState<{ adsetId: string; adsetName?: string | null } | null>(null);
  const hydratingTabRef = useRef<ManagerTab | null>(null);

  // Fullscreen: sobrepõe topbar/sidebar (z-40) com um overlay fixed z-50, dando toda a viewport à tabela.
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Dialogs/menus Radix abertos consomem o Escape primeiro — não sair do fullscreen junto.
      if (document.querySelector('[data-state="open"][role="dialog"], [data-state="open"][role="menu"], [data-state="open"][role="listbox"]')) return;
      setIsFullscreen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  // Drill state (URL-backed). Substitui a expansão inline por um modal único com breadcrumb.
  const drill = useDrillState();
  const drillPushRef = useRef(drill.push);
  const drillCloseRef = useRef(drill.close);
  useEffect(() => {
    drillPushRef.current = drill.push;
    drillCloseRef.current = drill.close;
  }, [drill.push, drill.close]);

  const handleOpenDrill = useCallback(
    (original: RankingsItem) => {
      const tabToKind: Record<ManagerTab, DrillKind | null> = {
        "por-anuncio": "adname",
        "por-conjunto": "adset",
        "por-campanha": "campaign",
        individual: null,
      };
      const kind = tabToKind[currentTab];
      if (!kind) return;
      let id = "";
      let name: string | null = null;
      if (kind === "campaign") {
        id = String((original as any).campaign_id || "").trim();
        name = String((original as any).campaign_name || (original as any).ad_name || "") || null;
      } else if (kind === "adset") {
        id = String((original as any).adset_id || "").trim();
        name = String((original as any).adset_name || (original as any).ad_name || "") || null;
      } else {
        id = String(original.ad_name || "").trim();
        name = id || null;
      }
      if (!id) return;
      drillPushRef.current({ kind, id, name });
    },
    [currentTab],
  );

  const getFiltersStorageKey = (tab: ManagerTab) => `hookify-manager-filters:${tab}`;
  const getGlobalFilterStorageKey = (tab: ManagerTab) => `hookify-manager-global-filter:${tab}`;

  // Filtro padrão para aba individual: Status = Ativo (reduz lag em packs grandes)
  const DEFAULT_INDIVIDUAL_FILTERS: ColumnFiltersState = [{ id: `status__default`, value: { selectedStatuses: ["ACTIVE"] } }];

  const loadColumnFilters = (tab: ManagerTab): ColumnFiltersState => {
    if (typeof window === "undefined") return [];
    try {
      const saved = sessionStorage.getItem(getFiltersStorageKey(tab));
      if (!saved) {
        // Aba individual: aplicar filtro de Status = Ativo por padrão
        if (tab === "individual") return DEFAULT_INDIVIDUAL_FILTERS;
        return [];
      }
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

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnFilters, setColumnFiltersRaw] = useState<ColumnFiltersState>(() => loadColumnFilters(initialTab));

  // Wrapper com startTransition: mudanças de filtro (especialmente remoção de status)
  // podem expor milhares de rows de uma vez. startTransition marca a atualização como
  // não-urgente, permitindo que React mantenha a UI responsiva durante o recálculo.
  const setColumnFilters: typeof setColumnFiltersRaw = useCallback(
    (updater) => {
      startTransition(() => {
        setColumnFiltersRaw(updater);
      });
    },
    [],
  );

  const [sorting, setSorting] = useState<SortingState>([{ id: "spend", desc: true }]);

  const [globalFilter, setGlobalFilter] = useState(() => loadGlobalFilter(initialTab));
  // Versão deferida para alimentar filtragem/médias pesadas; o input usa o valor urgente
  // para não perder caracteres durante digitação rápida.
  const deferredGlobalFilter = useDeferredValue(globalFilter);

  // Limpar seleção em lote quando o usuário filtra — evita "Pausar" atingir ads fora da vista.
  // Complementa o reset de handleTabChange (que cobre troca de aba). Functional update com
  // bailout: quando já está vazio (caso comum, ex: digitar na busca sem nada selecionado),
  // retorna a mesma ref → React pula o re-render.
  useEffect(() => {
    setRowSelection((prev) => (Object.keys(prev).length === 0 ? prev : {}));
  }, [columnFilters, globalFilter]);

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
    setColumnFilters((prev) => prev.filter((f) => getColumnId(f.id) === "ad_name" || enabledColumns.has(getColumnId(f.id) as ManagerColumnType)));

    // Sorting: manter apenas sorting de colunas visíveis; se ficar vazio, escolher fallback visível
    // status é coluna fixa (não está em activeColumns) nas abas individual / por-conjunto / por-campanha
    setSorting((prev) => {
      const filtered = prev.filter((s) => s.id === "ad_name" || s.id === "status" || enabledColumns.has(s.id as ManagerColumnType));
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
    // Fechar modal de drill ao trocar de tab — drill perde sentido em outra aba.
    drillCloseRef.current();
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
    if (!deferredGlobalFilter || deferredGlobalFilter.trim() === "") {
      return adsEffective;
    }
    const searchValue = deferredGlobalFilter.toLowerCase().trim();
    return adsEffective.filter((ad) => {
      const adName = String((ad as RankingsItem)?.ad_name || "").toLowerCase();
      return adName.includes(searchValue);
    });
  }, [adsEffective, deferredGlobalFilter]);
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

  // `computedAverages` representa a agregação local da tabela atual.
  // Quando `averagesOverride` existe, ele injeta a camada validada/alinhada ao backend
  // apenas para os headers globais, enquanto filtros continuam usando a agregação local.
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
        thruplays: computedAverages.thruplays,
        reach: computedAverages.reach,
        results: computedAverages.results,
        hook: averagesOverride.hook,
        hold_rate: averagesOverride.hold_rate ?? null,
        video_watched_p50: averagesOverride.video_watched_p50 ?? null,
        video_watched_p75: averagesOverride.video_watched_p75 ?? null,
        scroll_stop: averagesOverride.scroll_stop,
        frequency: computedAverages.frequency,
        ctr: averagesOverride.ctr,
        website_ctr: averagesOverride.website_ctr ?? computedAverages.website_ctr,
        connect_rate: averagesOverride.connect_rate,
        cpm: averagesOverride.cpm,
        // CPR e page_conv dependem do actionType, usar computedAverages como fallback se null
        // Mas logar quando isso acontecer para identificar problemas
        cpr: averagesOverride.cpr ?? computedAverages.cpr,
        cpc: computedAverages.cpc,
        cplc: computedAverages.cplc,
        page_conv: averagesOverride.page_conv ?? computedAverages.page_conv,
        // CPMQL e MQLs são calculados localmente e não vêm do servidor
        cpmql: computedAverages.cpmql,
        mqls: computedAverages.mqls,
        sumSpend: computedAverages.sumSpend,
        sumImpressions: computedAverages.sumImpressions,
        sumClicks: computedAverages.sumClicks,
        sumReach: computedAverages.sumReach,
        sumLpv: computedAverages.sumLpv,
        sumPlays: computedAverages.sumPlays,
        sumThruplays: computedAverages.sumThruplays,
        sumResults: computedAverages.sumResults,
        sumMqls: computedAverages.sumMqls,
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

  const handleVisibleRowKeysChange = useCallback(
    (keys: string[]) => onVisibleGroupKeysChange?.(currentTab, keys),
    [onVisibleGroupKeysChange, currentTab],
  );

  const handleResetFilters = useCallback(() => {
    setColumnFilters([]);
  }, [setColumnFilters]);

  // byKey Map: usado pelo MetricCell como fallback quando series não vêm do servidor.
  // Quando server series existem (caso padrão), retornamos Map vazio estável:
  // - MetricCell já acessa original.series diretamente (prioridade sobre byKey)
  // - Map vazio = referência estável = columns useMemo NÃO recria quando dados mudam
  // - Isso quebra a cascata: dados mudam → byKey estável → columns estáveis → table não reconstrói
  const { byKey } = useMemo(() => {
    if (!endDate) return { byKey: EMPTY_SERIES_MAP };
    if (adsEffective.length === 0) return { byKey: EMPTY_SERIES_MAP };
    const firstRow = (adsEffective as any)[0];
    if (firstRow && ('series_loading' in firstRow)) {
      return { byKey: EMPTY_SERIES_MAP };
    }
    return buildGroupedMetricBaseSeries(adsEffective as any, {
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
        return formatManagerAverageValue(metricId as any, averages, { currencyFormatter: formatCurrency });
      },
    [averages, formatCurrency],
  );

  const { openSettings } = useSettingsModalStore();
  const { bulkPause, bulkActivate, isLoading: isBulkLoading } = useBulkAdStatusControl();

  const selectedAdIds = useMemo(() => Object.keys(rowSelection), [rowSelection]);
  const selectedCount = selectedAdIds.length;

  // Refs para valores que mudam frequentemente mas NÃO devem invalidar columns (evita recriação de colunas pelo TanStack Table)
  const averagesRef = useRef(averages);
  const formatAverageRef = useRef(formatAverage);
  const formatCurrencyRef = useRef(formatCurrency);
  const actionTypeRef = useRef(actionType);

  const columns = useMemo<ColumnDef<Ad, any>[]>(() => {
    return createManagerTableColumns({
      columnHelper: columnHelper as any,
      activeColumns,
      groupByAdNameEffective,
      byKey,
      onOpenDrill: handleOpenDrill,
      currentTab,
      getRowKey,
      endDate,
      showTrends,
      averagesRef,
      formatAverageRef,
      filteredAveragesRef,
      formatFilteredAverageRef,
      formatCurrencyRef,
      formatPct,
      viewMode,
      colorMetricValue,
      hasSheetIntegration,
      mqlLeadscoreMin,
      actionTypeRef,
      applyNumericFilter,
      openSettings: openSettings as any,
      columnFiltersRef,
      globalFilterRef,
    });
  }, [activeColumns, groupByAdNameEffective, byKey, endDate, showTrends, formatPct, viewMode, colorMetricValue, hasSheetIntegration, mqlLeadscoreMin, getRowKey, applyNumericFilter, currentTab, openSettings, actionType, handleOpenDrill]);

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

  // Estado de filtros no formato da tabela (um por coluna); a tabela espera ids de coluna, não ids de instância
  const tableColumnFilters = useMemo(() => {
    const byColumn = new Map<string, unknown[]>();
    for (const filter of columnFilters) {
      if (!filter.value) continue;
      const colId = getColumnId(filter.id);
      const arr = byColumn.get(colId) ?? [];
      arr.push(filter.value);
      byColumn.set(colId, arr);
    }
    if (byColumn.size === 0) return EMPTY_FILTERS;
    return Array.from(byColumn.entries()).map(([id, values]) => ({
      id,
      value: values.length === 1 ? values[0] : values,
    }));
  }, [columnFilters]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    enableSorting: true,
    enableColumnFilters: true,
    enableRowSelection: currentTab === "individual",
    columnResizeMode: "onEnd", // Atualiza apenas ao soltar o mouse (melhor performance)
    getRowId: (row) => row.ad_id ?? "",
    state: {
      columnFilters: tableColumnFilters,
      sorting,
      columnSizing,
      rowSelection,
      columnVisibility: {
        adset_name_filter: false,
        campaign_name_filter: false,
      },
    },
    onColumnFiltersChange: () => {}, // Fonte de verdade é FilterBar; não sobrescrever estado com formato agregado
    onSortingChange: handleSortingChange,
    onColumnSizingChange: setColumnSizing,
    onRowSelectionChange: setRowSelection,
    initialState: {
      sorting: [{ id: "spend", desc: true }],
    },
    defaultColumn: {
      size: 100,
      minSize: 80,
      sortDescFirst: true, // primeiro clique nas colunas de métrica = seta para baixo (desc)
    },
  });

  // Calcular médias dos dados filtrados (visíveis na tabela após aplicar filtros)
  const filteredAverages = useFilteredAverages({
    table: table as any,
    dataLength: data.length,
    columnFilters,
    globalFilter: deferredGlobalFilter,
    actionType,
    hasSheetIntegration,
    mqlLeadscoreMin,
  });

  // Função helper para formatar a média filtrada de uma métrica
  const formatFilteredAverage = useMemo(
    () =>
      (metricId: string): string => {
        return formatManagerAverageValue(metricId as any, filteredAverages, { currencyFormatter: formatCurrency });
      },
    [filteredAverages, formatCurrency],
  );

  // Atualizar refs sincronamente (antes do render) para que os headers leiam valores atualizados
  // Não usar useEffect aqui pois ele roda APÓS render, causando valores desatualizados nos headers
  filteredAveragesRef.current = filteredAverages;
  formatFilteredAverageRef.current = formatFilteredAverage;
  columnFiltersRef.current = columnFilters;
  globalFilterRef.current = deferredGlobalFilter;
  averagesRef.current = averages;
  formatAverageRef.current = formatAverage;
  formatCurrencyRef.current = formatCurrency;
  actionTypeRef.current = actionType;

  // Modal de exportação (seleção de colunas + transcrições). A execução do CSV vive no dialog.
  const [isExportOpen, setIsExportOpen] = useState(false);

  // Mapeamento de colunas disponíveis para filtro
  const filterableColumns = useMemo(() => {
    const visibleColumns = getVisibleManagerColumns({ activeColumns, hasSheetIntegration });
    const nameColumn =
      currentTab === "por-conjunto"
        ? { id: "ad_name", label: "Conjunto", isText: true }
        : currentTab === "por-campanha"
          ? { id: "ad_name", label: "Campanha", isText: true }
          : { id: "ad_name", label: "Anúncio", isText: true };

    // "Ads ativos" só faz sentido em grupos com múltiplos anúncios (por-anúncio/por-conjunto/
    // por-campanha) — em "individual" cada linha já é um único ad, redundante com o filtro de Status.
    const activeCountColumn = { id: "active_count_filter", label: "Ads ativos" };

    const textColumns =
      currentTab === "individual"
        ? [nameColumn, { id: "adset_name_filter", label: "Conjunto", isText: true }, { id: "campaign_name_filter", label: "Campanha", isText: true }]
        : currentTab === "por-anuncio"
          ? [nameColumn, { id: "adset_name_filter", label: "Conjunto", isText: true }, { id: "campaign_name_filter", label: "Campanha", isText: true }, activeCountColumn]
          : currentTab === "por-conjunto"
            ? [nameColumn, { id: "campaign_name_filter", label: "Campanha", isText: true }, activeCountColumn]
            : [nameColumn, activeCountColumn];

    return getManagerFilterableColumns({
      visibleColumns,
      includeStatus: currentTab !== "por-anuncio",
      textColumns,
    });
  }, [hasSheetIntegration, currentTab, activeColumns]);

  const searchBar = useMemo(() => {
    const placeholder =
      currentTab === "por-conjunto"
        ? "Buscar por nome do conjunto..."
        : currentTab === "por-campanha"
          ? "Buscar por nome da campanha..."
          : "Buscar por nome do anúncio...";
    return (
      <SearchInputWithClear
        value={globalFilter}
        onChange={setGlobalFilter}
        placeholder={placeholder}
        wrapperClassName="w-full md:max-w-[min(20rem,100%)] md:flex-shrink-0"
        inputClassName="bg-background rounded-none border-b border-r-0 border-l-0 border-t-0 border-border h-10 w-full focus-visible:border-b-primary focus-visible:ring-0 focus-visible:ring-offset-0"
      />
    );
  }, [currentTab, globalFilter]);

  const filterBarItemLabel = currentTab === "por-conjunto" ? "conjuntos" : currentTab === "por-campanha" ? "campanhas" : "anúncios";
  const filterBarFilteredCount = table.getFilteredRowModel().rows.length;

  const controls = useMemo(
    () => (
      <>
        <div className="flex flex-wrap items-stretch justify-start gap-2 md:justify-end">
          {/* Colunas: controle mais usado, permanece dedicado e fora do menu */}
          <div className="w-full sm:w-[190px]">
            <ManagerColumnFilter activeColumns={activeColumns} onToggleColumn={handleToggleColumn} isColumnDisabled={(id) => !hasSheetIntegration && (id === "cpmql" || id === "mqls")} onSelectAll={handleSelectAllColumns} onDeselectAll={handleDeselectAllColumns} />
          </div>

          {/* Exibição: agrupa toggles de exibição e exportação (ações esporádicas) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="py-2 px-3 border border-input bg-background rounded-lg gap-2" aria-label="Opções de exibição">
                <IconAdjustmentsHorizontal className="h-4 w-4" />
                <span className="hidden text-sm sm:inline">Exibição</span>
                <IconChevronDown className="h-4 w-4 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {/* Toggles de exibição: switch à esquerda, label à direita */}
              <div className="px-2 py-1.5" onKeyDown={(e) => e.stopPropagation()}>
                <ToggleSwitch
                  id="menu-compact"
                  checked={viewMode === "minimal"}
                  onCheckedChange={(v) => handleViewModeChange(v ? "minimal" : "detailed")}
                  label="Compacta"
                  variant="minimal"
                  size="sm"
                  className="w-full justify-start"
                />
              </div>
              <div className="px-2 py-1.5" onKeyDown={(e) => e.stopPropagation()}>
                <ToggleSwitch
                  id="menu-show-trends"
                  checked={showTrends}
                  onCheckedChange={(v) => onShowTrendsChange?.(v)}
                  label="Tendências"
                  variant="minimal"
                  size="sm"
                  className="w-full justify-start"
                />
              </div>
              <div className="px-2 py-1.5" onKeyDown={(e) => e.stopPropagation()}>
                <ToggleSwitch
                  id="menu-color-metrics"
                  checked={colorMetricValue}
                  onCheckedChange={handleColorMetricValueChange}
                  label="Comparar com a média"
                  variant="minimal"
                  size="sm"
                  className="w-full justify-start"
                />
              </div>

              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setIsExportOpen(true)}>
                <IconDownload className="h-4 w-4 mr-2" />
                Exportar…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Fullscreen: ação espacial com feedback imediato, permanece fora do menu */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" onClick={() => setIsFullscreen((prev) => !prev)} className="py-2 px-3 border border-input bg-background rounded-lg" aria-label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"} aria-pressed={isFullscreen}>
                  {isFullscreen ? <IconMinimize className="h-4 w-4" /> : <IconMaximize className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">{isFullscreen ? "Sair da tela cheia (Esc)" : "Tela cheia"}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </>
    ),
    [viewMode, handleViewModeChange, showTrends, onShowTrendsChange, colorMetricValue, handleColorMetricValueChange, activeColumns, handleToggleColumn, handleSelectAllColumns, handleDeselectAllColumns, hasSheetIntegration, isFullscreen],
  );

  const tableContentProps = useMemo(
    () => ({
      table,
      isLoadingEffective,
      getRowKey,
      groupByAdNameEffective,
      currentTab,
      setSelectedAd: handleSelectAd,
      setSelectedAdset: handleSelectAdset,
      dateStart,
      dateStop,
      selectedPackIds,
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
      dataRef: data,
      showTrends,
      colorMetricValue,
      onVisibleRowKeysChange: handleVisibleRowKeysChange,
      isError: isError && currentTab === "por-anuncio",
      onOpenDrill: handleOpenDrill,
    }),
    [table, isLoadingEffective, isError, getRowKey, groupByAdNameEffective, currentTab, handleSelectAd, handleSelectAdset, dateStart, dateStop, selectedPackIds, actionType, formatCurrency, formatPct, columnFilters, setColumnFilters, activeColumns, hasSheetIntegration, mqlLeadscoreMin, sorting, data, adsEffectiveRaw, showTrends, colorMetricValue, handleVisibleRowKeysChange, handleOpenDrill],
  );
  return (
    <>
      {/* Em fullscreen, o wrapper vira overlay fixed acima do topbar/sidebar (z-40) e a tabela ganha a viewport inteira. */}
      <div className={cn(isFullscreen ? "fixed inset-0 z-50 flex flex-col overflow-hidden bg-background p-widget-default" : "flex min-h-0 min-w-0 flex-1 flex-col")}>
      <TabbedWorkspace
        value={currentTab}
        onValueChange={handleTabChange}
        variant="with-controls"
        tabs={MANAGER_TABS}
        controls={controls}
        tabsContainerClassName="flex-col items-stretch gap-3 md:flex-row md:items-center md:gap-4"
        tabsListClassName="w-full overflow-x-auto md:w-fit"
      >
        <TabbedContentItem value="individual" variant="with-controls">
          <TableWorkspace
            compact={viewMode === "detailed"}
            toolbar={
              <>
              {searchBar}
              <div className="flex-1 min-w-0">
                <FilterBar columnFilters={columnFilters} setColumnFilters={setColumnFilters} filterableColumns={filterableColumns} table={table} filteredCount={filterBarFilteredCount} totalCount={adsEffectiveRaw.length} itemLabel={filterBarItemLabel} />
              </div>
              {selectedCount > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-1.5 text-sm shrink-0">
                  <span className="text-muted-foreground font-medium">{selectedCount} selecionado{selectedCount !== 1 ? "s" : ""}</span>
                  <div className="h-4 w-px bg-border" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto py-0.5 px-2 text-xs gap-1"
                    disabled={isBulkLoading}
                    onClick={() => { bulkPause(selectedAdIds); setRowSelection({}); }}
                  >
                    {isBulkLoading ? <IconLoader2 className="h-3.5 w-3.5 animate-spin" /> : <IconPlayerPause className="h-3.5 w-3.5" />}
                    Pausar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto py-0.5 px-2 text-xs gap-1"
                    disabled={isBulkLoading}
                    onClick={() => { bulkActivate(selectedAdIds); setRowSelection({}); }}
                  >
                    {isBulkLoading ? <IconLoader2 className="h-3.5 w-3.5 animate-spin" /> : <IconPlayerPlay className="h-3.5 w-3.5" />}
                    Ativar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto py-0.5 px-1 text-muted-foreground"
                    disabled={isBulkLoading}
                    onClick={() => setRowSelection({})}
                    aria-label="Limpar seleção"
                  >
                    <IconX className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
              </>
            }
          >
            {viewMode === "minimal" ? <MinimalTableContent {...tableContentProps} /> : <TableContent {...tableContentProps} />}
          </TableWorkspace>
        </TabbedContentItem>

        <TabbedContentItem value="por-anuncio" variant="with-controls">
          <TableWorkspace
            compact={viewMode === "detailed"}
            toolbar={
              <>
              {searchBar}
              <div className="flex-1 min-w-0">
                <FilterBar columnFilters={columnFilters} setColumnFilters={setColumnFilters} filterableColumns={filterableColumns} table={table} filteredCount={filterBarFilteredCount} totalCount={adsEffectiveRaw.length} itemLabel={filterBarItemLabel} />
              </div>
              </>
            }
          >
            {viewMode === "minimal" ? <MinimalTableContent {...tableContentProps} /> : <TableContent {...tableContentProps} />}
          </TableWorkspace>
        </TabbedContentItem>

        <TabbedContentItem value="por-conjunto" variant="with-controls">
          <TableWorkspace
            compact={viewMode === "detailed"}
            toolbar={
              <>
              {searchBar}
              <div className="flex-1 min-w-0">
                <FilterBar columnFilters={columnFilters} setColumnFilters={setColumnFilters} filterableColumns={filterableColumns} table={table} filteredCount={filterBarFilteredCount} totalCount={adsEffectiveRaw.length} itemLabel={filterBarItemLabel} />
              </div>
              </>
            }
          >
            {viewMode === "minimal" ? <MinimalTableContent {...tableContentProps} /> : <TableContent {...tableContentProps} />}
          </TableWorkspace>
        </TabbedContentItem>

        <TabbedContentItem value="por-campanha" variant="with-controls">
          <TableWorkspace
            compact={viewMode === "detailed"}
            toolbar={
              <>
              {searchBar}
              <div className="flex-1 min-w-0">
                <FilterBar columnFilters={columnFilters} setColumnFilters={setColumnFilters} filterableColumns={filterableColumns} table={table} filteredCount={filterBarFilteredCount} totalCount={adsEffectiveRaw.length} itemLabel={filterBarItemLabel} />
              </div>
              </>
            }
          >
            {viewMode === "minimal" ? <MinimalTableContent {...tableContentProps} /> : <TableContent {...tableContentProps} />}
          </TableWorkspace>
        </TabbedContentItem>
      </TabbedWorkspace>
      </div>

      {/* Drill Modal — substitui a expansão inline (campanha → conjuntos → anúncios) */}
      <ManagerDrillModal
        dateStart={dateStart}
        dateStop={dateStop}
        selectedPackIds={selectedPackIds}
        actionType={actionType}
        formatCurrency={formatCurrency}
        formatPct={formatPct}
        activeColumns={activeColumns}
        hasSheetIntegration={hasSheetIntegration}
        mqlLeadscoreMin={mqlLeadscoreMin}
        onSelectAd={handleSelectAd}
      />

      {/* Details Dialog */}
      <AppDialog isOpen={!!selectedAd} onClose={() => setSelectedAd(null)} title="Detalhes do anúncio" size="5xl" padding="md" className="flex h-[90dvh] min-h-0 flex-col overflow-hidden" bodyClassName="flex min-h-0 flex-1 flex-col">
        {selectedAd && <AdDetailsDialog ad={selectedAd} groupByAdName={groupByAdNameEffective} dateStart={dateStart} dateStop={dateStop} actionType={actionType} packIds={selectedPackIds} availableConversionTypes={availableConversionTypes} averages={averages} />}
      </AppDialog>

      {/* Adset Details Dialog */}
      <AppDialog isOpen={!!selectedAdset} onClose={() => setSelectedAdset(null)} title="Detalhes do conjunto" size="4xl" padding="md">
        {selectedAdset && <AdsetDetailsDialog adsetId={selectedAdset.adsetId} adsetName={selectedAdset.adsetName} dateStart={dateStart} dateStop={dateStop} actionType={actionType} packIds={selectedPackIds} />}
      </AppDialog>

      {/* Export Dialog — seleção de colunas + transcrições */}
      <ManagerExportDialog
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        table={table}
        activeColumns={activeColumns}
        hasSheetIntegration={hasSheetIntegration}
        currentTab={currentTab}
        dateStart={dateStart}
        dateStop={dateStop}
      />
    </>
  );
}

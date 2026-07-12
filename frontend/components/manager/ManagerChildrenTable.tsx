"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconArrowsSort, IconFilter, IconLoader2, IconPlayerPause, IconPlayerPlay, IconX } from "@tabler/icons-react";
import type { ColumnFiltersState } from "@tanstack/react-table";
import type { RankingsChildrenItem } from "@/lib/api/schemas";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import { StatePanel } from "@/components/common/States";
import { SearchInputWithClear } from "@/components/common/SearchInputWithClear";
import { ThumbnailImage } from "@/components/common/ThumbnailImage";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FilterBar } from "@/components/manager/FilterBar";
import { StatusCell } from "@/components/manager/StatusCell";
import { useBulkEntityStatusControl, type AdEntityType } from "@/lib/hooks/useAdStatusControl";
import { getManagerFilterableColumns, getVisibleManagerColumns } from "@/components/manager/managerColumnPreferences";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";
import { applyRowFilters } from "@/lib/utils/applyRowFilters";
import { getFilteredColumnIds } from "@/lib/utils/columnFilters";
import { buildManagerComputedRow, compareManagerChildRows, formatManagerChildMetricValue, getManagerChildSortInitialDirection, type ManagerChildSortColumn } from "@/lib/metrics";

/** Tipo de filho renderizado: anúncios de um adset, variações de um ad name, ou adsets de uma campanha. */
export type ChildrenEntity = "ads" | "variations" | "adsets";

// Fallback estável quando o caller não passa setColumnFilters (nunca ocorre no drill modal, que
// sempre o fornece — existe só para manter a busca visível e o tipo do FilterBar satisfeito).
const NOOP_SET_COLUMN_FILTERS: React.Dispatch<React.SetStateAction<ColumnFiltersState>> = () => {};

type EntityConfig = {
  plural: string;
  nameHeader: string;
  nameSortKey: string;
  statusTab: "individual" | "por-conjunto";
  /** Entidade-alvo do pausar/ativar em massa (ads/variations=ad, adsets=adset). */
  bulkEntityType: AdEntityType;
  /** Id usado como chave de seleção E id enviado ao batch (ad_id ou adset_id). "" = não-selecionável. */
  selectionId: (child: any) => string;
  /** Campos usados pela busca textual */
  searchFields: (child: any) => string[];
  /** Mostra thumbnail + subtítulo de campanha na coluna de nome */
  richNameCell: boolean;
  /** Injeta ad_count: 1 nas linhas (não para adsets, que têm ad_count real) */
  addAdCount: boolean;
  textColumns: { id: string; label: string; isText: true }[];
  rowKey: (child: any) => string;
  nameTitle: (child: any) => string;
  colspanExtra: number;
  emptyForSearch: (term: string) => string;
  emptyForSearchAndFilters: (term: string) => string;
  emptyForFilters: string;
};

const ENTITY_CONFIG: Record<ChildrenEntity, EntityConfig> = {
  ads: {
    plural: "anúncios",
    nameHeader: "Anúncios",
    nameSortKey: "ad_id",
    statusTab: "individual",
    bulkEntityType: "ad",
    selectionId: (child) => String(child.ad_id || ""),
    searchFields: (child) => [String(child.ad_name || ""), String(child.ad_id || "")],
    richNameCell: true,
    addAdCount: true,
    textColumns: [
      { id: "ad_name", label: "Anúncio", isText: true },
      { id: "campaign_name_filter", label: "Campanha", isText: true },
    ],
    rowKey: (child) => String(child.ad_id),
    nameTitle: (child) => child.ad_name || "Sem nome",
    colspanExtra: 2,
    emptyForSearch: (term) => `Nenhum anúncio encontrado para "${term}".`,
    emptyForSearchAndFilters: (term) => `Nenhum anúncio encontrado para "${term}" com os filtros aplicados.`,
    emptyForFilters: "Nenhum anúncio corresponde aos filtros aplicados.",
  },
  variations: {
    plural: "variações",
    nameHeader: "Variações",
    nameSortKey: "ad_id",
    statusTab: "individual",
    bulkEntityType: "ad",
    selectionId: (child) => String(child.ad_id || ""),
    searchFields: (child) => [String(child.ad_name || ""), String(child.ad_id || "")],
    richNameCell: true,
    addAdCount: true,
    textColumns: [
      { id: "adset_name_filter", label: "Conjunto", isText: true },
      { id: "campaign_name_filter", label: "Campanha", isText: true },
    ],
    rowKey: (child) => String(child.ad_id),
    nameTitle: (child) => child.adset_name || "Sem nome",
    colspanExtra: 1,
    emptyForSearch: (term) => `Nenhuma variação encontrada para "${term}".`,
    emptyForSearchAndFilters: (term) => `Nenhuma variação encontrada para "${term}" com os filtros aplicados.`,
    emptyForFilters: "Nenhuma variação corresponde aos filtros aplicados.",
  },
  adsets: {
    plural: "conjuntos",
    nameHeader: "Conjuntos",
    nameSortKey: "adset_name",
    statusTab: "por-conjunto",
    bulkEntityType: "adset",
    selectionId: (child) => String(child.adset_id || ""),
    searchFields: (child) => [String(child.adset_name || ""), String(child.adset_id || "")],
    richNameCell: false,
    addAdCount: false,
    textColumns: [{ id: "adset_name_filter", label: "Conjunto", isText: true }],
    rowKey: (child) => String(child.adset_id || "") || String(child.adset_name || "") || String(child.ad_name || ""),
    nameTitle: (child) => child.adset_name || child.ad_name || "Sem nome",
    colspanExtra: 2,
    emptyForSearch: (term) => `Nenhum conjunto encontrado para "${term}".`,
    emptyForSearchAndFilters: (term) => `Nenhum conjunto encontrado para "${term}" com os filtros aplicados.`,
    emptyForFilters: "Nenhum conjunto corresponde aos filtros aplicados.",
  },
};

interface ManagerChildrenTableProps {
  childrenData?: RankingsChildrenItem[];
  isLoading?: boolean;
  isError?: boolean;
  adsetId?: string;
  /** Default: "ads" quando adsetId presente, senão "variations". "adsets" = filhos de campanha. */
  entity?: ChildrenEntity;
  actionType?: string;
  formatCurrency: (n: number) => string;
  formatPct: (v: number) => string;
  activeColumns: Set<ManagerColumnType>;
  hasSheetIntegration?: boolean;
  mqlLeadscoreMin?: number;
  columnFilters?: ColumnFiltersState;
  setColumnFilters?: React.Dispatch<React.SetStateAction<ColumnFiltersState>>;
  asContent?: boolean;
  /** Quando definido, cada linha vira clicável e dispara este callback. */
  onRowClick?: (child: RankingsChildrenItem) => void;
}

export function ManagerChildrenTable({
  childrenData,
  isLoading = false,
  isError = false,
  adsetId,
  entity,
  actionType,
  formatCurrency,
  formatPct,
  activeColumns,
  hasSheetIntegration = false,
  mqlLeadscoreMin = 0,
  columnFilters = [],
  setColumnFilters,
  asContent = false,
  onRowClick,
}: ManagerChildrenTableProps) {
  const resolvedEntity: ChildrenEntity = entity ?? (adsetId ? "ads" : "variations");
  const config = ENTITY_CONFIG[resolvedEntity];
  const [sortConfig, setSortConfig] = useState<{ column: string | null; direction: "asc" | "desc" }>({
    column: "spend",
    direction: "desc",
  });
  const [searchTerm, setSearchTerm] = useState("");

  // Seleção em massa (checkbox + shift), local a esta tabela (não usa TanStack). Chave = selectionId.
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const selectionAnchorRef = useRef<string | null>(null);
  const bulk = useBulkEntityStatusControl(config.bulkEntityType);
  // Resetar seleção ao trocar de nível no drill (nova lista de filhos) ou de tipo de entidade.
  useEffect(() => {
    setSelectedKeys(new Set());
    selectionAnchorRef.current = null;
  }, [childrenData, resolvedEntity]);

  const visibleColumns = useMemo(() => getVisibleManagerColumns({ activeColumns, hasSheetIntegration }), [activeColumns, hasSheetIntegration]);
  const childrenLabel = config.plural;

  const sortedData = useMemo(() => {
    if (!childrenData || childrenData.length === 0) {
      return [];
    }

    const dataWithCalculations = childrenData.map((child) => {
      let conversions = child.conversions || {};

      if (Object.keys(conversions).length === 0 && child.series?.conversions) {
        conversions = {};

        for (const dayConversions of child.series.conversions) {
          if (dayConversions && typeof dayConversions === "object") {
            for (const [conversionActionType, value] of Object.entries(dayConversions)) {
              if (!conversions[conversionActionType]) {
                conversions[conversionActionType] = 0;
              }
              conversions[conversionActionType] += Number(value || 0);
            }
          }
        }
      }
      return {
        ...buildManagerComputedRow(
          {
            ...child,
            conversions,
          },
          {
            actionType,
            mqlLeadscoreMin,
          },
        ),
        conversions,
        // adsets têm ad_count real vindo do backend — não sobrescrever
        ad_count: config.addAdCount ? 1 : Number((child as any).ad_count ?? 0),
      };
    });

    let filteredData = searchTerm.trim()
      ? dataWithCalculations.filter((child) => {
          const search = searchTerm.toLowerCase();
          return config.searchFields(child).some((field) => field.toLowerCase().includes(search));
        })
      : dataWithCalculations;

    if (columnFilters.length > 0) {
      filteredData = filteredData.filter((row) => applyRowFilters(row as Record<string, unknown>, columnFilters));
    }

    if (!sortConfig.column) {
      return filteredData;
    }

    return [...filteredData].sort((a, b) => {
      return compareManagerChildRows(a, b, sortConfig.column as ManagerChildSortColumn, sortConfig.direction);
    });
  }, [actionType, childrenData, columnFilters, hasSheetIntegration, mqlLeadscoreMin, searchTerm, sortConfig]);

  // Chaves selecionáveis na ordem visível atual (pós-filtro/sort) — base do select-all e do shift.
  const orderedSelectableKeys = useMemo(
    () => sortedData.map((c) => config.selectionId(c)).filter(Boolean),
    [sortedData, config],
  );
  const selectedCount = selectedKeys.size;
  const allSelected = orderedSelectableKeys.length > 0 && orderedSelectableKeys.every((k) => selectedKeys.has(k));
  const someSelected = selectedCount > 0 && !allSelected;

  const toggleOne = useCallback((key: string, checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const toggleAll = useCallback((checked: boolean) => {
    setSelectedKeys(checked ? new Set(orderedSelectableKeys) : new Set());
    selectionAnchorRef.current = null;
  }, [orderedSelectableKeys]);

  const handleRowCheckboxClick = useCallback(
    (e: React.MouseEvent, key: string) => {
      e.stopPropagation();
      const anchor = selectionAnchorRef.current;
      if (e.shiftKey && anchor && anchor !== key) {
        const anchorPos = orderedSelectableKeys.indexOf(anchor);
        const clickedPos = orderedSelectableKeys.indexOf(key);
        if (anchorPos !== -1 && clickedPos !== -1) {
          // Suprime o toggle nativo do Radix (checa defaultPrevented) — senão a linha clicada re-alterna.
          e.preventDefault();
          const [start, end] = anchorPos < clickedPos ? [anchorPos, clickedPos] : [clickedPos, anchorPos];
          const value = !selectedKeys.has(key);
          setSelectedKeys((prev) => {
            const next = new Set(prev);
            for (let i = start; i <= end; i++) {
              if (value) next.add(orderedSelectableKeys[i]);
              else next.delete(orderedSelectableKeys[i]);
            }
            return next;
          });
          return;
        }
      }
      selectionAnchorRef.current = key;
    },
    [orderedSelectableKeys, selectedKeys],
  );

  const bulkBar = selectedCount > 0 ? (
    <div className="flex h-control-default flex-shrink-0 items-center gap-2 rounded-lg border border-input bg-background px-3">
      <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">{selectedCount} selecionado{selectedCount !== 1 ? "s" : ""}</span>
      <div className="h-4 w-px bg-border" />
      <Button
        variant="ghost"
        size="sm"
        className="h-auto gap-1 px-2 py-0.5 text-xs hover:bg-destructive hover:text-destructive-foreground"
        disabled={bulk.isLoading}
        onClick={() => { bulk.bulkPause(Array.from(selectedKeys)); setSelectedKeys(new Set()); }}
      >
        {bulk.isLoading ? <IconLoader2 className="h-3.5 w-3.5 animate-spin" /> : <IconPlayerPause className="h-3.5 w-3.5" />}
        Pausar
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-auto gap-1 px-2 py-0.5 text-xs hover:bg-success hover:text-success-foreground"
        disabled={bulk.isLoading}
        onClick={() => { bulk.bulkActivate(Array.from(selectedKeys)); setSelectedKeys(new Set()); }}
      >
        {bulk.isLoading ? <IconLoader2 className="h-3.5 w-3.5 animate-spin" /> : <IconPlayerPlay className="h-3.5 w-3.5" />}
        Ativar
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-auto px-1 py-0.5 text-muted-foreground"
        disabled={bulk.isLoading}
        onClick={() => setSelectedKeys(new Set())}
        aria-label="Limpar seleção"
      >
        <IconX className="h-3.5 w-3.5" />
      </Button>
    </div>
  ) : null;

  const filterableColumns = useMemo(() => {
    return getManagerFilterableColumns({
      visibleColumns,
      includeStatus: true,
      textColumns: config.textColumns,
    });
  }, [config, visibleColumns]);

  // Colunas com filtro EFETIVO — sinalizadas com funil no header. Filtros de texto (nome/
  // campanha/conjunto) atuam sobre a coluna de nome desta tabela.
  const filteredColumnIds = useMemo(() => getFilteredColumnIds(columnFilters), [columnFilters]);
  const isNameColumnFiltered = config.textColumns.some((tc) => filteredColumnIds.has(tc.id));

  const filterIndicator = <IconFilter className="h-3 w-3 shrink-0 text-primary" aria-label="Coluna com filtro ativo" />;

  // +1 pela coluna de checkbox de seleção (à esquerda do Status).
  const colspan = visibleColumns.length + config.colspanExtra + 1;

  const handleSort = (column: string) => {
    setSortConfig((previous) => {
      if (previous.column === column) {
        return { column, direction: previous.direction === "asc" ? "desc" : "asc" };
      }

      return { column, direction: getManagerChildSortInitialDirection(column) };
    });
  };

  const renderCellValue = (child: any, columnId: ManagerColumnType) => {
    return formatManagerChildMetricValue(columnId, child, { currencyFormatter: formatCurrency });
  };

  const metricColumnClass = "cursor-pointer select-none px-4 py-3 text-center hover:text-brand";

  const loadingContent = (
    <StatePanel kind="loading" message={`Carregando ${childrenLabel}...`} framed={false} density="compact" align="left" />
  );

  const errorContent = (
    <StatePanel kind="error" message={`Erro ao carregar ${childrenLabel}.`} framed={false} density="compact" align="left" />
  );

  const emptyContent = (
    <StatePanel kind="empty" message={`Sem ${childrenLabel} no período.`} framed={false} density="compact" align="left" />
  );

  if (isLoading) {
    return asContent ? (
      loadingContent
    ) : (
      <tr className="bg-border">
        <td className="p-0" colSpan={colspan}>
          {loadingContent}
        </td>
      </tr>
    );
  }

  if (isError) {
    return asContent ? (
      errorContent
    ) : (
      <tr className="bg-border">
        <td className="p-0" colSpan={colspan}>
          {errorContent}
        </td>
      </tr>
    );
  }

  if (!childrenData || childrenData.length === 0) {
    return asContent ? (
      emptyContent
    ) : (
      <tr className="bg-border">
        <td className="p-0" colSpan={colspan}>
          {emptyContent}
        </td>
      </tr>
    );
  }

  const innerContent = (
    <div className={asContent ? "flex h-full min-h-0 flex-1 flex-col overflow-hidden" : undefined}>
      <div className="flex-shrink-0 px-4 py-3" role="region" aria-label="Busca e filtros da tabela expandida">
        {/* Mesmo layout de duas linhas da tabela principal: busca + contagem + Add filter + ações na
            1ª linha; chips de filtro em largura total na 2ª (renderizada pelo próprio FilterBar). */}
        <FilterBar
          columnFilters={columnFilters}
          setColumnFilters={setColumnFilters ?? NOOP_SET_COLUMN_FILTERS}
          filterableColumns={filterableColumns}
          filteredCount={sortedData.length}
          totalCount={childrenData.length || 0}
          itemLabel={childrenLabel}
          leadingSlot={
            <SearchInputWithClear
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Buscar por nome ou ID..."
              wrapperClassName="flex-shrink-0 w-72 max-w-[min(18rem,100%)]"
              size="sm"
              inputClassName="w-full text-xs"
            />
          }
          trailingSlot={bulkBar}
        />
      </div>

      {sortedData.length === 0 && (searchTerm.trim() || columnFilters.length > 0) ? (
        <div className="p-4">
          <StatePanel
            kind="empty"
            message={
              searchTerm.trim()
                ? columnFilters.length > 0
                  ? config.emptyForSearchAndFilters(searchTerm)
                  : config.emptyForSearch(searchTerm)
                : config.emptyForFilters
            }
            framed={false}
            density="compact"
          />
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            {searchTerm.trim() && (
              <button onClick={() => setSearchTerm("")} className="text-xs text-primary hover:underline">
                Limpar busca
              </button>
            )}
            {searchTerm.trim() && columnFilters.length > 0 && <span className="text-muted-foreground">·</span>}
            {columnFilters.length > 0 && setColumnFilters && (
              <button onClick={() => setColumnFilters([])} className="text-xs text-primary hover:underline">
                Limpar filtros
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className={asContent ? "min-h-0 flex-1 overflow-auto" : "overflow-x-auto"}>
          <table className="w-full border-collapse text-xs">
            <thead className={asContent ? "sticky top-0 z-sticky" : undefined}>
              <tr className="bg-card">
                <th className="w-10 px-2 py-4 text-center">
                  <div className="flex items-center justify-center">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={(v) => toggleAll(!!v)}
                      aria-label="Selecionar todos"
                      disabled={orderedSelectableKeys.length === 0}
                    />
                  </div>
                </th>
                <th className={`w-20 cursor-pointer select-none p-4 text-center hover:text-brand ${sortConfig.column === "status" ? "text-primary" : ""}${filteredColumnIds.has("status") ? " bg-primary-10" : ""}`} onClick={() => handleSort("status")}>
                  <div className="flex items-center justify-center gap-1">
                    Status
                    {filteredColumnIds.has("status") && filterIndicator}
                    <IconArrowsSort className="h-3 w-3" />
                  </div>
                </th>
                <th className={`cursor-pointer select-none p-4 text-left hover:text-brand ${sortConfig.column === config.nameSortKey ? "text-primary" : ""}${isNameColumnFiltered ? " bg-primary-10" : ""}`} onClick={() => handleSort(config.nameSortKey)}>
                  <div className="flex items-center gap-1">
                    {config.nameHeader}
                    {isNameColumnFiltered && filterIndicator}
                    <IconArrowsSort className="h-3 w-3" />
                  </div>
                </th>
                {visibleColumns.map((column) => (
                  <th key={column.id} className={`${metricColumnClass} ${sortConfig.column === column.id ? "text-primary" : ""}${filteredColumnIds.has(column.id) ? " bg-primary-10" : ""}`} onClick={() => handleSort(column.id)}>
                    <div className="flex items-center justify-center gap-1">
                      {column.name}
                      {filteredColumnIds.has(column.id) && filterIndicator}
                      <IconArrowsSort className="h-3 w-3" />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedData.map((child) => (
                <tr
                  key={config.rowKey(child)}
                  className={`bg-background border-b border-border hover:bg-muted ${onRowClick ? "cursor-pointer" : ""}`}
                  onClick={onRowClick ? () => onRowClick(child as RankingsChildrenItem) : undefined}
                >
                  <td className="px-2 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    {config.selectionId(child) ? (
                      <div className="flex items-center justify-center">
                        <Checkbox
                          checked={selectedKeys.has(config.selectionId(child))}
                          onCheckedChange={(v) => toggleOne(config.selectionId(child), !!v)}
                          onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
                          onClick={(e) => handleRowCheckboxClick(e, config.selectionId(child))}
                          aria-label="Selecionar linha"
                        />
                      </div>
                    ) : null}
                  </td>
                  <td className={`px-4 py-3 text-center${filteredColumnIds.has("status") ? " bg-primary-5" : ""}`} onClick={(e) => e.stopPropagation()}>
                    <StatusCell original={child} currentTab={config.statusTab} />
                  </td>
                  <td className={`px-4 py-3 text-left${isNameColumnFiltered ? " bg-primary-5" : ""}`}>
                    {config.richNameCell ? (
                      <div className="flex items-center gap-2">
                        <ThumbnailImage src={getAdThumbnail(child)} alt="thumb" size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium">{config.nameTitle(child)}</div>
                          <div className="flex items-center gap-2 truncate">
                            <span className="truncate text-xs text-muted-foreground">{child.campaign_name}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{config.nameTitle(child)}</div>
                      </div>
                    )}
                  </td>
                  {visibleColumns.map((column) => (
                    <td key={column.id} className={`p-2 text-center${filteredColumnIds.has(column.id) ? " bg-primary-5" : ""}`}>
                      {renderCellValue(child, column.id)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return asContent ? (
    innerContent
  ) : (
    <tr className="bg-card">
      <td className="p-0" colSpan={colspan}>
        {innerContent}
      </td>
    </tr>
  );
}

import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import { DEFAULT_MANAGER_COLUMNS, MANAGER_COLUMN_OPTIONS, MANAGER_COLUMN_RENDER_ORDER, type ManagerColumnOption } from "@/components/manager/managerColumns";
import { isManagerPercentageMetric } from "@/lib/metrics";

const STORAGE_KEY_MANAGER_COLUMNS = "hookify-manager-columns";

export const loadManagerColumnsPreference = (): Set<ManagerColumnType> => {
  if (typeof window === "undefined") {
    return new Set<ManagerColumnType>(DEFAULT_MANAGER_COLUMNS);
  }

  try {
    const saved = sessionStorage.getItem(STORAGE_KEY_MANAGER_COLUMNS);
    if (!saved) {
      return new Set<ManagerColumnType>(DEFAULT_MANAGER_COLUMNS);
    }

    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) {
      return new Set<ManagerColumnType>(DEFAULT_MANAGER_COLUMNS);
    }

    const valid = parsed.filter((column) => (MANAGER_COLUMN_RENDER_ORDER as readonly string[]).includes(column));
    if (valid.length === 0) {
      return new Set<ManagerColumnType>(DEFAULT_MANAGER_COLUMNS);
    }

    return new Set<ManagerColumnType>(valid as ManagerColumnType[]);
  } catch {
    return new Set<ManagerColumnType>(DEFAULT_MANAGER_COLUMNS);
  }
};

export const getVisibleManagerColumns = ({
  activeColumns,
  hasSheetIntegration = false,
}: {
  activeColumns: Set<ManagerColumnType>;
  hasSheetIntegration?: boolean;
}): ManagerColumnOption[] => {
  return MANAGER_COLUMN_RENDER_ORDER.filter((columnId) => isManagerMetricColumnVisible(columnId, { activeColumns, hasSheetIntegration })).map((columnId) => MANAGER_COLUMN_OPTIONS.find((column) => column.id === columnId)!);
};

export interface FilterableManagerColumn {
  id: string;
  label: string;
  isPercentage?: boolean;
  isText?: boolean;
  isStatus?: boolean;
}

export interface ManagerColumnVisibilityOptions {
  activeColumns: Set<ManagerColumnType>;
  hasSheetIntegration?: boolean;
}

export function isManagerMetricColumnVisible(
  columnId: ManagerColumnType,
  { activeColumns, hasSheetIntegration = false }: ManagerColumnVisibilityOptions,
): boolean {
  if (!activeColumns.has(columnId)) {
    return false;
  }

  if ((columnId === "cpmql" || columnId === "mqls") && !hasSheetIntegration) {
    return false;
  }

  return true;
}

export function getManagerFilterableColumns({
  visibleColumns,
  includeStatus = false,
  textColumns = [],
}: {
  visibleColumns: ManagerColumnOption[];
  includeStatus?: boolean;
  textColumns?: FilterableManagerColumn[];
}): FilterableManagerColumn[] {
  const columns: FilterableManagerColumn[] = [];

  if (includeStatus) {
    columns.push({ id: "status", label: "Status", isStatus: true });
  }

  columns.push(...textColumns);

  for (const column of visibleColumns) {
    columns.push({
      id: column.id,
      label: column.name,
      isPercentage: isManagerPercentageMetric(column.id),
    });
  }

  return columns;
}

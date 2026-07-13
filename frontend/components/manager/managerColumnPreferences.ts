import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import { DEFAULT_MANAGER_COLUMNS, MANAGER_COLUMN_OPTIONS, MANAGER_COLUMN_RENDER_ORDER, type ManagerColumnOption } from "@/components/manager/managerColumns";
import { isManagerRatioPercentMetric } from "@/lib/metrics";

/** Formato antigo (só visibilidade, em sessionStorage): string[] de colunas ativas. Migrado na leitura. */
const LEGACY_STORAGE_KEY_MANAGER_COLUMNS = "hookify-manager-columns";
/** Formato atual: { active, order } em localStorage — a ordem escolhida deve sobreviver à sessão. */
const STORAGE_KEY_MANAGER_COLUMN_PREFS = "hookify-manager-column-prefs";

export interface ManagerColumnPreferences {
  /** Colunas visíveis. */
  active: Set<ManagerColumnType>;
  /** Ordem de renderização — sempre completa (inclui as colunas ocultas, que guardam seu lugar). */
  order: ManagerColumnType[];
}

const isKnownManagerColumn = (value: unknown): value is ManagerColumnType => typeof value === "string" && (MANAGER_COLUMN_RENDER_ORDER as readonly string[]).includes(value);

/**
 * Sanitiza uma ordem vinda do storage: descarta ids desconhecidos e duplicados, e acrescenta ao
 * final as colunas que ainda não existiam quando a preferência foi salva. Assim uma métrica nova
 * aparece para o usuário sem invalidar a ordem que ele montou.
 */
export const normalizeManagerColumnOrder = (saved: unknown): ManagerColumnType[] => {
  const seen = new Set<ManagerColumnType>();
  const order: ManagerColumnType[] = [];

  if (Array.isArray(saved)) {
    for (const columnId of saved) {
      if (!isKnownManagerColumn(columnId) || seen.has(columnId)) continue;
      seen.add(columnId);
      order.push(columnId);
    }
  }

  for (const columnId of MANAGER_COLUMN_RENDER_ORDER) {
    if (!seen.has(columnId)) order.push(columnId);
  }

  return order;
};

const defaultManagerColumnPreferences = (): ManagerColumnPreferences => ({
  active: new Set<ManagerColumnType>(DEFAULT_MANAGER_COLUMNS),
  order: [...MANAGER_COLUMN_RENDER_ORDER],
});

const parseActiveColumns = (saved: unknown): Set<ManagerColumnType> | null => {
  if (!Array.isArray(saved)) return null;
  const valid = saved.filter(isKnownManagerColumn);
  return valid.length > 0 ? new Set<ManagerColumnType>(valid) : null;
};

export const loadManagerColumnPreferences = (): ManagerColumnPreferences => {
  if (typeof window === "undefined") return defaultManagerColumnPreferences();

  try {
    const raw = localStorage.getItem(STORAGE_KEY_MANAGER_COLUMN_PREFS);
    if (raw) {
      const parsed = JSON.parse(raw) as { active?: unknown; order?: unknown } | null;
      const active = parseActiveColumns(parsed?.active);
      if (active) {
        return { active, order: normalizeManagerColumnOrder(parsed?.order) };
      }
    }

    // Migração do formato antigo: aproveita a visibilidade já escolhida, ordem = padrão.
    const legacy = sessionStorage.getItem(LEGACY_STORAGE_KEY_MANAGER_COLUMNS);
    if (legacy) {
      const active = parseActiveColumns(JSON.parse(legacy));
      if (active) {
        return { active, order: [...MANAGER_COLUMN_RENDER_ORDER] };
      }
    }
  } catch {
    return defaultManagerColumnPreferences();
  }

  return defaultManagerColumnPreferences();
};

export const saveManagerColumnPreferences = (preferences: ManagerColumnPreferences): void => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_MANAGER_COLUMN_PREFS, JSON.stringify({ active: Array.from(preferences.active), order: preferences.order }));
  } catch {
    // Storage indisponível/cheio: a preferência é descartável, não vale derrubar a UI por isso.
  }
};

export const getVisibleManagerColumns = ({
  activeColumns,
  columnOrder,
  hasSheetIntegration = false,
}: {
  activeColumns: Set<ManagerColumnType>;
  /** Ordem escolhida pelo usuário. Ausente = ordem padrão de MANAGER_COLUMNS. */
  columnOrder?: readonly ManagerColumnType[];
  hasSheetIntegration?: boolean;
}): ManagerColumnOption[] => {
  const order = columnOrder && columnOrder.length > 0 ? columnOrder : MANAGER_COLUMN_RENDER_ORDER;
  return order
    .filter((columnId) => isManagerMetricColumnVisible(columnId, { activeColumns, hasSheetIntegration }))
    .map((columnId) => MANAGER_COLUMN_OPTIONS.find((column) => column.id === columnId))
    .filter((column): column is ManagerColumnOption => !!column);
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

  if ((columnId === "cpmql" || columnId === "mqls" || columnId === "leadscore_avg") && !hasSheetIntegration) {
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
    // Dimensões (Pack, Conta) filtram por texto — o valor da célula é um nome, não um número.
    if (column.isDimension) {
      columns.push({ id: column.id, label: column.name, isText: true });
      continue;
    }

    columns.push({
      id: column.id,
      label: column.name,
      // Apenas percentuais 0-1 (ratioPercent): o FilterBar divide o input por 100.
      // rawPercent (50%/75% View) já vive em 0-100 e compara direto.
      isPercentage: isManagerRatioPercentMetric(column.id),
    });
  }

  return columns;
}

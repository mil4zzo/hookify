import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import {
  DEFAULT_MANAGER_COLUMNS,
  MANAGER_COLUMN_OPTIONS,
  MANAGER_COLUMN_RENDER_ORDER,
  getManagerColumnOptions,
  getManagerColumnRenderOrder,
  type ManagerColumnOption,
} from "@/components/manager/managerColumns";
import { isManagerRatioPercentMetric } from "@/lib/metrics";
import { METRIC_DEFINITIONS, type MetricKey } from "@/lib/metrics/definitions";
import { isCustomColumnKey, resolveCustomColumn, type CustomColumnDef } from "@/lib/metrics/customColumns";
import { canonicalCustomColumnKey } from "@/lib/metrics/customColumnsRegistry";

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

const isKnownManagerColumn = (value: unknown, customIds: ReadonlySet<string>): value is ManagerColumnType =>
  typeof value === "string" && ((MANAGER_COLUMN_RENDER_ORDER as readonly string[]).includes(value) || customIds.has(value));

const customIdSet = (customColumns: ReadonlyArray<CustomColumnDef>): Set<string> => new Set(customColumns.map((def) => def.key));

/**
 * Chave salva → chave atual. Preferência gravada antes do agrupamento por arquivo +
 * cabeçalho guarda `custom:<vínculo>:faceta`; ela continua valendo para a coluna que
 * contém aquele vínculo (ver `resolveCustomColumn`).
 */
const canonicalColumnId = (id: unknown, customIds: ReadonlySet<string>, customColumns: ReadonlyArray<CustomColumnDef>): unknown => {
  if (typeof id !== "string" || !isCustomColumnKey(id) || customIds.has(id)) return id;
  return resolveCustomColumn(id, customColumns)?.key ?? id;
};

/**
 * Sanitiza uma ordem vinda do storage: descarta ids desconhecidos e duplicados, e acrescenta ao
 * final as colunas que ainda não existiam quando a preferência foi salva. Assim uma métrica nova
 * aparece para o usuário sem invalidar a ordem que ele montou.
 *
 * 140: uma coluna vinculada (`custom:`) só é conhecida se está em `customColumns` — a dos packs
 * selecionados AGORA. Chave de vínculo excluído (ou de pack fora da seleção) é descartada aqui
 * e volta ao fim da lista quando o pack voltar; a preferência salva não quebra a tabela.
 */
export const normalizeManagerColumnOrder = (saved: unknown, customColumns: ReadonlyArray<CustomColumnDef> = []): ManagerColumnType[] => {
  const customIds = customIdSet(customColumns);
  const seen = new Set<ManagerColumnType>();
  const order: ManagerColumnType[] = [];

  if (Array.isArray(saved)) {
    for (const savedId of saved) {
      const columnId = canonicalColumnId(savedId, customIds, customColumns);
      if (!isKnownManagerColumn(columnId, customIds) || seen.has(columnId)) continue;
      seen.add(columnId);
      order.push(columnId);
    }
  }

  for (const columnId of getManagerColumnRenderOrder(customColumns)) {
    if (!seen.has(columnId)) order.push(columnId);
  }

  return order;
};

const defaultManagerColumnPreferences = (customColumns: ReadonlyArray<CustomColumnDef> = []): ManagerColumnPreferences => ({
  active: new Set<ManagerColumnType>(DEFAULT_MANAGER_COLUMNS),
  order: getManagerColumnRenderOrder(customColumns),
});

const parseActiveColumns = (saved: unknown, customColumns: ReadonlyArray<CustomColumnDef>): Set<ManagerColumnType> | null => {
  if (!Array.isArray(saved)) return null;
  const customIds = customIdSet(customColumns);
  // Coluna vinculada ativa na preferência mas fora da seleção atual: fica guardada no
  // storage (não sobrescrevemos) e volta a aparecer quando o pack voltar.
  const valid = saved
    .map((id) => canonicalColumnId(id, customIds, customColumns))
    .filter((id): id is ManagerColumnType => isKnownManagerColumn(id, customIds));
  return valid.length > 0 ? new Set<ManagerColumnType>(valid) : null;
};

export const loadManagerColumnPreferences = (customColumns: ReadonlyArray<CustomColumnDef> = []): ManagerColumnPreferences => {
  if (typeof window === "undefined") return defaultManagerColumnPreferences(customColumns);

  try {
    const raw = localStorage.getItem(STORAGE_KEY_MANAGER_COLUMN_PREFS);
    if (raw) {
      const parsed = JSON.parse(raw) as { active?: unknown; order?: unknown } | null;
      const active = parseActiveColumns(parsed?.active, customColumns);
      if (active) {
        return { active, order: normalizeManagerColumnOrder(parsed?.order, customColumns) };
      }
    }

    // Migração do formato antigo: aproveita a visibilidade já escolhida, ordem = padrão.
    const legacy = sessionStorage.getItem(LEGACY_STORAGE_KEY_MANAGER_COLUMNS);
    if (legacy) {
      const active = parseActiveColumns(JSON.parse(legacy), customColumns);
      if (active) {
        return { active, order: getManagerColumnRenderOrder(customColumns) };
      }
    }
  } catch {
    return defaultManagerColumnPreferences(customColumns);
  }

  return defaultManagerColumnPreferences(customColumns);
};

/**
 * Chaves `custom:` salvas que a seleção atual não conhece. Ao gravar, elas são
 * preservadas do storage anterior: sem isto, abrir o Manager com outro pack apagaria a
 * escolha feita para o pack da planilha.
 */
const readStoredCustomKeys = (): { active: string[]; order: string[] } => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MANAGER_COLUMN_PREFS);
    if (!raw) return { active: [], order: [] };
    const parsed = JSON.parse(raw) as { active?: unknown; order?: unknown } | null;
    const pick = (list: unknown) => (Array.isArray(list) ? list.filter((id): id is string => isCustomColumnKey(id)) : []);
    return { active: pick(parsed?.active), order: pick(parsed?.order) };
  } catch {
    return { active: [], order: [] };
  }
};

export const saveManagerColumnPreferences = (preferences: ManagerColumnPreferences): void => {
  if (typeof window === "undefined") return;
  try {
    const stored = readStoredCustomKeys();
    const activeNow = new Set<string>(Array.from(preferences.active));
    const orderNow = new Set<string>(preferences.order);
    // Chaves vinculadas de OUTRA seleção sobrevivem; as desta seleção seguem a escolha atual.
    // Apelido antigo de uma coluna desta seleção também é "desta seleção": carregá-lo
    // adiante faria a coluna escondida agora voltar pela chave velha no próximo load.
    const knownNow = new Set<string>(preferences.order.filter((id) => isCustomColumnKey(id)));
    const isKnownNow = (id: string) => knownNow.has(id) || knownNow.has(canonicalCustomColumnKey(id));
    const carriedActive = stored.active.filter((id) => !isKnownNow(id) && !activeNow.has(id));
    const carriedOrder = stored.order.filter((id) => !isKnownNow(id) && !orderNow.has(id));
    localStorage.setItem(
      STORAGE_KEY_MANAGER_COLUMN_PREFS,
      JSON.stringify({ active: [...Array.from(preferences.active), ...carriedActive], order: [...preferences.order, ...carriedOrder] }),
    );
  } catch {
    // Storage indisponível/cheio: a preferência é descartável, não vale derrubar a UI por isso.
  }
};

export const getVisibleManagerColumns = ({
  activeColumns,
  columnOrder,
  hasSheetIntegration = false,
  hasLeadEconomics = false,
  customColumns = [],
}: {
  activeColumns: Set<ManagerColumnType>;
  /** Ordem escolhida pelo usuário. Ausente = ordem padrão de MANAGER_COLUMNS. */
  columnOrder?: readonly ManagerColumnType[];
  hasSheetIntegration?: boolean;
  /** Algum pack selecionado tem a economia do lead cadastrada. */
  hasLeadEconomics?: boolean;
  /** Colunas vinculadas da planilha nos packs selecionados (140). */
  customColumns?: ReadonlyArray<CustomColumnDef>;
}): ManagerColumnOption[] => {
  const options = getManagerColumnOptions(customColumns);
  const order = columnOrder && columnOrder.length > 0 ? columnOrder : options.map((c) => c.id);
  const customIds = customIdSet(customColumns);
  return order
    .filter((columnId) => isManagerMetricColumnVisible(columnId, { activeColumns, hasSheetIntegration, hasLeadEconomics, customColumnIds: customIds }))
    .map((columnId) => options.find((column) => column.id === columnId))
    .filter((column): column is ManagerColumnOption => !!column);
};

export interface FilterableManagerColumn {
  id: string;
  label: string;
  isPercentage?: boolean;
  isText?: boolean;
  isStatus?: boolean;
  isDate?: boolean;
  /** Filtro de tags: operador próprio + valor multi-tag. Ver FilterBar. */
  isTags?: boolean;
  options?: { value: string; label: string }[];
}

export interface ManagerColumnAvailabilityOptions {
  hasSheetIntegration?: boolean;
  /** Algum pack selecionado tem a economia do lead cadastrada. */
  hasLeadEconomics?: boolean;
}

/**
 * A coluna EXISTE nesta seleção de packs, ligada ou não pelo usuário? Regra única,
 * lida das definições das métricas — antes a lista das métricas de planilha estava
 * copiada à mão em três lugares (esta função, `ManagerTable.isColumnEnabled` e o
 * `ManagerExportDialog`), e toda métrica nova precisava lembrar dos três.
 *
 * Coluna vinculada (140) e dimensão não passam por aqui: a vinculada tem gate
 * próprio (o vínculo existir) e a dimensão não depende de planilha.
 */
export function isManagerColumnAvailable(columnId: ManagerColumnType, { hasSheetIntegration = false, hasLeadEconomics = false }: ManagerColumnAvailabilityOptions): boolean {
  if (isCustomColumnKey(columnId)) return true;
  const definition = METRIC_DEFINITIONS[columnId as MetricKey];
  if (!definition) return true;
  if (definition.requiresSheetIntegration && !hasSheetIntegration) return false;
  if (definition.requiresLeadEconomics && !hasLeadEconomics) return false;
  return true;
}

export interface ManagerColumnVisibilityOptions extends ManagerColumnAvailabilityOptions {
  activeColumns: Set<ManagerColumnType>;
  /** Chaves das colunas vinculadas conhecidas nesta seleção (140). Ausente = nenhuma. */
  customColumnIds?: ReadonlySet<string>;
}

export function isManagerMetricColumnVisible(
  columnId: ManagerColumnType,
  { activeColumns, hasSheetIntegration = false, hasLeadEconomics = false, customColumnIds }: ManagerColumnVisibilityOptions,
): boolean {
  if (!activeColumns.has(columnId)) {
    return false;
  }

  // 140: coluna vinculada só existe enquanto algum pack selecionado tem o vínculo.
  if (isCustomColumnKey(columnId)) {
    return !!customColumnIds && customColumnIds.has(columnId);
  }

  return isManagerColumnAvailable(columnId, { hasSheetIntegration, hasLeadEconomics });
}

export function getManagerFilterableColumns({
  visibleColumns,
  includeStatus = false,
  textColumns = [],
  tagOptions = [],
}: {
  visibleColumns: ManagerColumnOption[];
  includeStatus?: boolean;
  textColumns?: FilterableManagerColumn[];
  /** Vocabulário de tags do usuário. Vem do chamador porque é dado remoto. */
  tagOptions?: { value: string; label: string }[];
}): FilterableManagerColumn[] {
  const columns: FilterableManagerColumn[] = [];

  if (includeStatus) {
    columns.push({ id: "status", label: "Status", isStatus: true });
  }

  columns.push(...textColumns);

  for (const column of visibleColumns) {
    // Dimensões não filtram por número. Data (Criado em) tem editor de calendário; as demais
    // (Pack, Conta) filtram por texto — o valor da célula é um nome.
    if (column.isDimension) {
      // Tags não filtram por texto: casar por nome quebraria assim que a tag fosse
      // renomeada, e a pergunta real não é uma busca e sim como a linha se relaciona
      // com um conjunto de tags (ver TAG_FILTER_OPERATORS).
      // Sem vocabulário, o filtro não existe: quem não passa `tagOptions` é a tabela
      // de filhos, cujas linhas não carregam tags — oferecê-lo ali seria um filtro
      // que o usuário monta e que não filtra nada.
      if (column.id === "tags") {
        if (tagOptions.length > 0) {
          columns.push({ id: column.id, label: column.name, isTags: true, options: tagOptions });
        }
        continue;
      }
      columns.push(
        column.isDate
          ? { id: column.id, label: column.name, isDate: true }
          : { id: column.id, label: column.name, isText: true },
      );
      continue;
    }

    columns.push({
      id: column.id,
      label: column.name,
      // Apenas percentuais 0-1 (ratioPercent): o FilterBar divide o input por 100.
      // rawPercent (50%/75% View) já vive em 0-100 e compara direto.
      // 140: faceta % MQL de uma coluna leadscore também é ratioPercent.
      isPercentage: column.custom ? column.custom.facet === "mql_rate" : isManagerRatioPercentMetric(column.id),
    });
  }

  return columns;
}

/** Reexport para quem só precisa das fixas. */
export { MANAGER_COLUMN_OPTIONS };

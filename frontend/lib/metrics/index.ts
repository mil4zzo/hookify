import { METRIC_DEFINITION_LIST, METRIC_DEFINITIONS, type MetricDefinition, type MetricFormatKind, type MetricKey } from "./definitions";
import { formatMetricValueByKind as formatMetricValueByKindCore, type FormatMetricValueOptions } from "./formatMetricValueCore";
import { isCustomColumnKey } from "./customColumns";
import { getActiveCustomColumn } from "./customColumnsRegistry";

export type { MetricDefinition, MetricFormatKind, MetricKey, MetricPolarity } from "./definitions";
export { METRIC_DEFINITION_LIST, METRIC_DEFINITIONS } from "./definitions";
export { buildMetricSeriesFromSourceSeries, getMetricNumericValue, getMetricNumericValueOrNull, getResultsForActionType, type MetricValueContext, type MetricValueSource } from "./calculations";
export { buildManagerComputedRow, computeManagerAverages, formatManagerAverageValue, formatManagerMetricValue, getManagerMetricLabel, isManagerPercentageMetric, isManagerRatioPercentMetric, isManagerSummaryMetric, MANAGER_METRIC_KEYS, type ManagerAverages, type ManagerMetricKey } from "./manager";
export {
  compareManagerChildRows,
  formatManagerChildMetricValue,
  getManagerChildSortInitialDirection,
  getManagerMetricCurrentValue,
  getManagerMetricDeltaPresentation,
  getManagerMetricEmptyKind,
  getManagerMetricTrendPresentation,
  type GetManagerMetricPresentationOptions,
  type ManagerChildSortColumn,
  type ManagerMetricDeltaPresentation,
  type ManagerMetricEmptyKind,
  type ManagerSortDirection,
  type ManagerMetricTrendPresentation,
} from "./managerPresentation";
export {
  buildGroupedMetricBaseSeries,
  buildTimeSeriesAxis,
  getMetricSeriesAvailability,
  type BuildGroupedMetricBaseSeriesOptions,
  type GroupedMetricSeriesByKey,
  type GroupedMetricSeriesEntry,
  type MetricBaseSeries,
  type MetricSparklineKey,
  type MetricSeriesAvailability,
  type MetricSeriesPoint,
  type TimeSeriesGroupBy,
} from "./timeSeries";

export interface MetricTooltipContent {
  title: string;
  description?: string;
  technicalDescription?: string;
}

export type { FormatMetricValueOptions } from "./formatMetricValueCore";

export function resolveMetricKey(metricKey: string): MetricKey | null {
  if (metricKey in METRIC_DEFINITIONS) {
    return metricKey as MetricKey;
  }

  const definition = METRIC_DEFINITION_LIST.find((item) => item.aliases?.includes(metricKey));
  return definition?.key ?? null;
}

/**
 * A definição de uma métrica — a porta única por onde saem rótulo, formato,
 * polaridade e tooltip. Tudo que vem depois (`formatMetricValue`,
 * `getMetricDisplayLabel`, `isLowerBetterMetric`…) depende dela.
 *
 * 140: uma coluna vinculada da planilha (`custom:<id>:<faceta>`) não está em
 * `METRIC_DEFINITIONS` — ela nasce dos vínculos dos packs selecionados. A definição
 * é sintetizada a partir do registro ativo. Sem isto, quem formata devolvia travessão
 * mesmo com valor na linha: foi o que apareceu na primeira integração real.
 */
export function getMetricDefinition(metricKey: string): MetricDefinition | undefined {
  if (isCustomColumnKey(metricKey)) {
    const custom = getActiveCustomColumn(metricKey);
    if (!custom) return undefined;
    return {
      key: metricKey as unknown as MetricKey,
      label: custom.label,
      shortLabel: custom.shortLabel,
      polarity: custom.polarity,
      // `top` (categoria) é texto e não passa por formatador numérico; o decimal aqui
      // é só um valor de preenchimento para o tipo — a célula dela tem render próprio.
      formatKind: custom.formatKind === "text" ? "decimal" : custom.formatKind,
      technicalDescription: `Coluna "${custom.mapping.label}" da planilha vinculada.`,
    };
  }
  const canonicalKey = resolveMetricKey(metricKey);
  return canonicalKey ? METRIC_DEFINITIONS[canonicalKey] : undefined;
}

export function getMetricDisplayLabel(metricKey: string, options: { preferShortLabel?: boolean } = {}): string {
  const definition = getMetricDefinition(metricKey);
  if (!definition) return metricKey;

  if (options.preferShortLabel && definition.shortLabel) {
    return definition.shortLabel;
  }

  return definition.label;
}

export function getMetricTooltipContent(metricKey: string): MetricTooltipContent | undefined {
  const definition = getMetricDefinition(metricKey);
  if (!definition) return undefined;

  return {
    title: definition.label,
    description: definition.didacticDescription,
    technicalDescription: definition.technicalDescription,
  };
}

export function getMetricAverageTooltip(metricKey: string): string {
  return `${getMetricDisplayLabel(metricKey)} medio`;
}

export function getMetricFormatKind(metricKey: string): MetricFormatKind | undefined {
  return getMetricDefinition(metricKey)?.formatKind;
}

export function isPercentMetric(metricKey: string): boolean {
  const formatKind = getMetricFormatKind(metricKey);
  return formatKind === "ratioPercent" || formatKind === "rawPercent";
}

export function isLowerBetterMetric(metricKey: string): boolean {
  return getMetricDefinition(metricKey)?.polarity === "lower";
}

export function isHigherBetterMetric(metricKey: string): boolean {
  return getMetricDefinition(metricKey)?.polarity === "higher";
}

export function getMetricBetterDirection(metricKey: string): "higher" | "lower" {
  return isLowerBetterMetric(metricKey) ? "lower" : "higher";
}

export function formatMetricValue(metricKey: string, value: number, options: FormatMetricValueOptions = {}): string {
  const definition = getMetricDefinition(metricKey);
  if (!definition || !Number.isFinite(value)) {
    return "—";
  }

  return formatMetricValueByKindCore(value, definition.formatKind, options);
}

export function formatMetricValueByKind(value: number, formatKind: MetricFormatKind, options: FormatMetricValueOptions = {}): string {
  return formatMetricValueByKindCore(value, formatKind, options);
}

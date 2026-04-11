import {
  formatCurrency,
  formatLocaleDecimalNumber,
  formatLocaleInteger,
  formatLocaleRatioPercent,
  formatLocaleRawPercent,
} from "@/lib/utils/currency";
import type { MetricFormatKind } from "./definitions";

export interface FormatMetricValueOptions {
  currencyFormatter?: (value: number) => string;
}

export function formatMetricValueByKind(value: number, formatKind: MetricFormatKind, options: FormatMetricValueOptions = {}): string {
  if (!Number.isFinite(value)) {
    return "—";
  }

  switch (formatKind) {
    case "currency":
      return options.currencyFormatter ? options.currencyFormatter(value) : formatCurrency(value);
    case "ratioPercent":
      return formatLocaleRatioPercent(value);
    case "rawPercent":
      return formatLocaleRawPercent(value);
    case "integer":
      return formatLocaleInteger(value);
    case "decimal":
      return formatLocaleDecimalNumber(value, 2, 2);
    default:
      return value.toString();
  }
}

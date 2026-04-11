export type { MetricKey } from "@/lib/metrics";
export { isLowerBetterMetric } from "@/lib/metrics";

import { METRIC_DEFINITION_LIST } from "@/lib/metrics";

export const LOWER_IS_BETTER_METRICS = METRIC_DEFINITION_LIST.filter((metric) => metric.polarity === "lower").map((metric) => metric.key);

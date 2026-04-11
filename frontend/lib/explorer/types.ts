import type { RankingsItem } from "@/lib/api/schemas";
import type { SharedAdDetailModel } from "@/lib/ads/sharedAdDetail";
import type { MetricKey } from "@/lib/metrics";

export type ExplorerKanbanMetricKey = Extract<
  MetricKey,
  | "spend"
  | "cpm"
  | "scroll_stop"
  | "hook"
  | "hold_rate"
  | "video_watched_p50"
  | "website_ctr"
  | "connect_rate"
  | "page_conv"
  | "cpc"
  | "cpr"
  | "cpmql"
>;

export type ExplorerKanbanMetricOptionKey = ExplorerKanbanMetricKey | "score";

export type ExplorerSortDirection = "asc" | "desc";

export interface ExplorerSortState {
  metricKey: ExplorerKanbanMetricKey;
  direction: ExplorerSortDirection;
}

export interface ExplorerSignalItem {
  title: string;
  detail: string;
  tone: "neutral" | "positive" | "warning" | "critical";
}

export interface ExplorerStageCard {
  label: string;
  score: string;
  description: string;
  tone: "neutral" | "positive" | "warning" | "critical";
}

export interface ExplorerMetricCard {
  label: string;
  value: string;
  deltaDisplay?: string;
  subtitle?: string;
  subtitleInLabelRow?: boolean;
  averageDisplay?: string;
  averageTooltip?: string;
  series?: Array<number | null | undefined>;
  inverse?: boolean;
  formatFn?: (n: number) => string;
  valueRaw?: number | null;
  avgRaw?: number | null;
  better?: "higher" | "lower";
  packAverage?: number | null;
  colorMode?: "series" | "per-bar";
  disableSeriesFallback?: boolean;
}

export interface ExplorerMetricAverages {
  hook: number | null;
  hold_rate: number | null;
  video_watched_p50: number | null;
  scroll_stop: number | null;
  ctr: number | null;
  website_ctr: number | null;
  connect_rate: number | null;
  cpm: number | null;
  cpr: number | null;
  cpc: number | null;
  cpmql: number | null;
  page_conv: number | null;
}

export interface ExplorerPlaceholderPresentation {
  statusLabel: string;
  qualificationLabel: string;
  summary: string;
  insights: ExplorerSignalItem[];
  actions: ExplorerSignalItem[];
  retentionStage: ExplorerStageCard;
  funnelStage: ExplorerStageCard;
  resultsStage: ExplorerStageCard;
}

export interface ExplorerListCardData {
  ad_id?: string | null;
  ad_name?: string | null;
  thumbnail?: string | null;
  metricValue: number | null;
  metricFormatted: string;
  spend?: number;
  impressions?: number;
  effective_status?: string | null;
  hook?: number | null;
  hold_rate?: number | null;
  ctr?: number | null;
  website_ctr?: number | null;
  connect_rate?: number | null;
  cpm?: number | null;
  conversions?: Record<string, number>;
  leadscore_values?: number[];
  video_watched_p50?: number | null;
  [key: string]: any;
}

export interface ExplorerListItemViewModel {
  groupKey: string;
  adName: string;
  campaignName: string;
  accountLabel: string;
  searchableStatus: string | null;
  primaryMetricLabel: string;
  primaryMetricKey: ExplorerKanbanMetricKey;
  primaryMetricValue: number | null;
  primaryMetricFormatted: string;
  cardData: ExplorerListCardData;
}

export interface ExplorerDetailViewModel {
  groupKey: string;
  adName: string;
  campaignName: string;
  accountLabel: string;
  rawAd: RankingsItem;
  detail: SharedAdDetailModel;
}

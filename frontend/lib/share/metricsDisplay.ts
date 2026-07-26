import type { ShareItemMetrics, ShareMetricKey } from "./types";

// Apresentação das métricas na página pública. Espelha o modal de detalhamento
// (labels, seções, formatação e quais métricas têm média), mas sem nenhuma
// dependência autenticada — a página roda anônima, sem settings/store.

export const METRIC_LABELS: Record<ShareMetricKey, string> = {
  cpmql: "CPMQL",
  cpr: "CPR",
  cpc: "CPC",
  cpm: "CPM",
  ctr: "CTR",
  website_ctr: "Link CTR",
  connect_rate: "Connect Rate",
  page_conv: "Page Conv",
  scroll_stop: "Scroll Stop",
  hook: "Hook",
  hold_rate: "Hold Rate",
  video_watched_p50: "50% View",
  spend: "Spend",
  frequency: "Frequency",
  impressions: "Impressions",
  reach: "Reach",
  results: "Resultados",
  clicks: "Cliques",
  mql_count: "MQLs",
};

const CURRENCY_KEYS = new Set<ShareMetricKey>(["cpmql", "cpr", "cpc", "cpm", "spend"]);
// Frações 0–1 no snapshot (mesma escala da linha do Manager) — exibir ×100.
const FRACTION_PCT_KEYS = new Set<ShareMetricKey>([
  "ctr", "website_ctr", "connect_rate", "page_conv", "scroll_stop", "hook", "hold_rate",
]);

/** Métricas cujo valor MENOR é melhor — inverte a escala de cor. */
const LOWER_IS_BETTER = new Set<ShareMetricKey>(["cpmql", "cpr", "cpc", "cpm", "frequency"]);

export function isLowerBetter(key: ShareMetricKey): boolean {
  return LOWER_IS_BETTER.has(key);
}

export function formatShareMetric(key: ShareMetricKey, value: number, currency: string | null): string {
  if (CURRENCY_KEYS.has(key)) {
    try {
      return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(value);
    } catch {
      return value.toFixed(2);
    }
  }
  if (FRACTION_PCT_KEYS.has(key)) return `${(value * 100).toFixed(2)}%`;
  if (key === "video_watched_p50") return `${Math.round(value)}%`;
  if (key === "frequency") return value.toFixed(2);
  return Math.round(value).toLocaleString("pt-BR");
}

/** `+12.3%` / `-4.5%` — variação do valor sobre a média; null quando não dá para comparar. */
export function formatShareDelta(value: number | null | undefined, average: number | null | undefined): string | null {
  if (value == null || average == null) return null;
  if (!Number.isFinite(value) || !Number.isFinite(average) || average === 0) return null;
  const diff = value / average - 1;
  return `${diff >= 0 ? "+" : ""}${(diff * 100).toFixed(1)}%`;
}

export interface ShareMetricSection {
  title: string;
  cards: Array<{ key: ShareMetricKey; subtitleOf?: ShareMetricKey; subtitleLabel?: string }>;
}

/** As 4 seções do modal, na mesma ordem. */
export const SHARE_METRIC_SECTIONS: ShareMetricSection[] = [
  {
    title: "Resultados",
    cards: [
      { key: "cpmql", subtitleOf: "mql_count", subtitleLabel: "MQLs" },
      { key: "cpr", subtitleOf: "results", subtitleLabel: "resultados" },
      { key: "cpc", subtitleOf: "clicks", subtitleLabel: "cliques" },
      { key: "cpm" },
    ],
  },
  { title: "Funil", cards: [{ key: "ctr" }, { key: "website_ctr" }, { key: "connect_rate" }, { key: "page_conv" }] },
  { title: "Retenção", cards: [{ key: "scroll_stop" }, { key: "hook" }, { key: "hold_rate" }, { key: "video_watched_p50" }] },
  { title: "Visibilidade", cards: [{ key: "spend" }, { key: "frequency" }, { key: "impressions" }, { key: "reach" }] },
];

/** Card do destaque: encontra a config (subtítulo etc.) da métrica em qualquer seção. */
export function findMetricCardConfig(key: ShareMetricKey) {
  for (const section of SHARE_METRIC_SECTIONS) {
    const card = section.cards.find((c) => c.key === key);
    if (card) return card;
  }
  return { key };
}

/** Métricas presentes no snapshot deste criativo (esconde as indisponíveis). */
export function hasMetric(metrics: ShareItemMetrics, key: ShareMetricKey): boolean {
  return typeof metrics[key] === "number";
}

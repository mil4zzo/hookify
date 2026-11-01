import { METRIC_DEFINITIONS } from "@/lib/metrics/definitions";
import { SHARE_METRIC_KEYS, type ShareItemMetrics, type ShareMetricKey } from "./types";

// Apresentação das métricas na página pública. Espelha o modal de detalhamento
// (labels, seções, formatação e quais métricas têm média), mas sem nenhuma
// dependência autenticada — a página roda anônima, sem settings/store.

// Rótulos vêm das definições de métrica (uma fonte só para Manager, modal e link público);
// `mql_count` não é métrica do registro, é a contagem que vira legenda de outro cartão.
const SHARE_LABEL_EXCEPTIONS: Partial<Record<ShareMetricKey, string>> = { mql_count: "MQLs" };

export const METRIC_LABELS = Object.fromEntries(
  SHARE_METRIC_KEYS.map((key) => [key, SHARE_LABEL_EXCEPTIONS[key] ?? METRIC_DEFINITIONS[key as keyof typeof METRIC_DEFINITIONS].label]),
) as Record<ShareMetricKey, string>;

const CURRENCY_KEYS = new Set<ShareMetricKey>(["cpmql", "cpr", "cpc", "cpm", "spend", "cpl_ceiling", "cpl_actual"]);
// Frações 0–1 no snapshot (mesma escala da linha do Manager) — exibir ×100.
const FRACTION_PCT_KEYS = new Set<ShareMetricKey>([
  "ctr", "website_ctr", "connect_rate", "page_conv", "scroll_stop", "hook", "hold_rate", "lead_margin",
]);

/** Métricas cujo valor MENOR é melhor — inverte a escala de cor. */
const LOWER_IS_BETTER = new Set<ShareMetricKey>(["cpmql", "cpr", "cpc", "cpm", "frequency", "cpl_actual"]);

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

/** As 4 seções do modal, na mesma ordem, e a da economia do lead. */
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
  // Só aparece com a economia do lead cadastrada (sem ela, as duas vêm null e somem).
  // A cor segue a média do conjunto, como as outras — não a meta de margem do Manager,
  // que o link não carrega.
  { title: "Economia do lead", cards: [{ key: "cpl_ceiling" }, { key: "cpl_actual" }, { key: "leads_scored" }, { key: "lead_margin" }] },
];

/** Métricas presentes no snapshot deste criativo (esconde as indisponíveis). */
export function hasMetric(metrics: ShareItemMetrics, key: ShareMetricKey): boolean {
  return typeof metrics[key] === "number";
}

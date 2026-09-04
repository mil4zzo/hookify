// Tipos do compartilhamento público de criativos (stories) — /s/[token].
//
// Convenção de escala do snapshot: os valores seguem a MESMA semântica da linha
// do Manager (RankingsItem): ctr/website_ctr/connect_rate/page_conv/scroll_stop/
// hook/hold_rate são frações (0–1, exibir ×100); video_watched_p50 já é 0–100;
// monetárias na moeda de `currency`. O viewer replica a formatação do modal de
// detalhamento — não re-escale aqui.

export type ShareMediaType = "video" | "image";

export interface ShareItemMedia {
  type: ShareMediaType;
  /** Thumbnail do Supabase Storage — permanente. */
  thumbnail_url: string | null;
  /** Source da CDN da Meta — perecível; comparar video_expires_at com o relógio. */
  video_url: string | null;
  video_expires_at: string | null;
  /** Imagem em alta (permalink da Meta — efetivamente permanente). */
  image_url: string | null;
}

/** Chaves do snapshot — espelho das seções do modal de detalhamento. */
export const SHARE_METRIC_KEYS = [
  // Resultados
  "cpmql", "cpr", "cpc", "cpm",
  // Funil
  "ctr", "website_ctr", "connect_rate", "page_conv",
  // Retenção
  "scroll_stop", "hook", "hold_rate", "video_watched_p50",
  // Visibilidade
  "spend", "frequency", "impressions", "reach",
  // Contagens de contexto (subtítulos)
  "results", "clicks", "mql_count",
] as const;

export type ShareMetricKey = (typeof SHARE_METRIC_KEYS)[number];

export type ShareItemMetrics = Partial<Record<ShareMetricKey, number | null>>;

/** Máximo de métricas exibidas sem expandir o painel (espelho do backend). */
export const MAX_HIGHLIGHT_METRICS = 2;

/**
 * Métricas oferecidas como destaque, na ordem das seções do modal de
 * detalhamento. As de "Visibilidade" (spend/frequency/impressions/reach) não
 * têm média no modal e portanto aparecem sem cor/delta — igual lá.
 */
export const SHARE_HIGHLIGHT_OPTIONS: Array<{ key: ShareMetricKey; label: string }> = [
  { key: "spend", label: "Spend" },
  { key: "cpr", label: "CPR" },
  { key: "cpmql", label: "CPMQL" },
  { key: "cpc", label: "CPC" },
  { key: "cpm", label: "CPM" },
  { key: "ctr", label: "CTR" },
  { key: "website_ctr", label: "Link CTR" },
  { key: "connect_rate", label: "Connect Rate" },
  { key: "page_conv", label: "Page Conv" },
  { key: "scroll_stop", label: "Scroll Stop" },
  { key: "hook", label: "Hook" },
  { key: "hold_rate", label: "Hold Rate" },
  { key: "video_watched_p50", label: "50% View" },
  { key: "frequency", label: "Frequency" },
  { key: "impressions", label: "Impressions" },
  { key: "reach", label: "Reach" },
];

export interface ShareItem {
  ad_name: string;
  media: ShareItemMedia;
  metrics: ShareItemMetrics;
}

/** Resposta do GET /shares/public/{token} — payload allowlist, sem ids internos. */
export interface PublicShare {
  items: ShareItem[];
  date_start: string;
  date_stop: string;
  currency: string | null;
  /** Médias congeladas do conjunto — base da cor/delta. {} em shares legados. */
  averages: ShareItemMetrics;
  /** Até 2 métricas exibidas sem expandir o painel. [] = painel só sob toque. */
  highlight_metrics: ShareMetricKey[];
  created_at: string;
  expires_at: string | null;
}

export interface CreateSharePayload {
  date_start: string;
  date_stop: string;
  currency?: string | null;
  items: Array<{ ad_name: string; metrics: ShareItemMetrics }>;
  averages?: ShareItemMetrics;
  highlight_metrics?: ShareMetricKey[];
  /** Packs em contexto — o backend resolve a mídia no silo do DONO de cada um. */
  pack_ids?: string[];
}

export interface CreateShareResponse {
  id: string;
  token: string;
  expires_at: string;
}

export interface ShareSummary {
  id: string;
  token: string;
  date_start: string;
  date_stop: string;
  currency: string | null;
  view_count: number;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

/** Máximo de slides por link (espelho de MAX_SHARE_ITEMS no backend). */
export const MAX_SHARE_ITEMS = 20;

/** URL pública de um share a partir do token (origem atual do app). */
export function buildShareUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/s/${token}`;
}

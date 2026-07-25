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
  created_at: string;
  expires_at: string | null;
}

export interface CreateSharePayload {
  date_start: string;
  date_stop: string;
  currency?: string | null;
  items: Array<{ ad_name: string; metrics: ShareItemMetrics }>;
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

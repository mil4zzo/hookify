/**
 * Janela de atribuição do pack → recuo do refresh "desde a última atualização".
 *
 * POR QUE EXISTE
 * --------------
 * A Meta data a conversão pelo dia em que ela aconteceu, mas só a conta se o
 * clique que a originou estiver DENTRO da janela consultada. Um refresh que pede
 * "ontem → hoje" perde toda conversão de hoje cujo clique foi há 2..7 dias — e o
 * dia gravado nunca mais é relido. Por isso o backend recua pela janela de
 * atribuição da conta (migration 143: `packs.attribution_window_days`), e este
 * módulo reproduz a MESMA regra para o modal mostrar as datas que vão ser pedidas.
 *
 * Regra (espelho de routes/facebook.py):
 *   since = max(last_refreshed_at - recuo, date_start)
 *   recuo = attribution_window_days, ou 7 se o pack ainda não foi calibrado
 */
import { subDays } from "date-fns";
import { formatDateLocal } from "./dateFilters";

/** Teto atual da Meta (7 dias de clique) — usado por pack ainda não calibrado. */
export const DEFAULT_ATTRIBUTION_WINDOW_DAYS = 7;
/** Guarda contra valor patológico: espelho de MAX_ATTRIBUTION_WINDOW_DAYS no backend. */
export const MAX_ATTRIBUTION_WINDOW_DAYS = 28;

export interface RefreshWindowSource {
  last_refreshed_at?: string | null;
  date_start?: string | null;
  date_stop?: string | null;
  attribution_window_days?: number | null;
  attribution_setting?: string | null;
}

/** Recuo (dias) que o backend vai aplicar a este pack. */
export function lookbackDaysForPack(pack: RefreshWindowSource | null | undefined): number {
  const raw = pack?.attribution_window_days;
  const days = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : DEFAULT_ATTRIBUTION_WINDOW_DAYS;
  if (days < 1) return DEFAULT_ATTRIBUTION_WINDOW_DAYS;
  return Math.min(days, MAX_ATTRIBUTION_WINDOW_DAYS);
}

/**
 * Data inicial (YYYY-MM-DD) do refresh "desde a última atualização", exatamente
 * como o backend calcula. Âncora = last_refreshed_at, com fallback em date_stop
 * (packs legados). Retorna null sem âncora.
 */
export function sinceLastRefreshStart(pack: RefreshWindowSource | null | undefined): string | null {
  const anchor = (pack?.last_refreshed_at || pack?.date_stop || "").slice(0, 10);
  if (!anchor) return null;
  const lookback = lookbackDaysForPack(pack);
  // T12:00 evita que o fuso empurre a data para o dia anterior ao converter.
  let since = formatDateLocal(subDays(new Date(`${anchor}T12:00:00`), lookback));
  const start = (pack?.date_start || "").slice(0, 10);
  // Nunca antes do início do pack: o primeiro dia do período não leva recuo.
  if (start && since < start) since = start;
  return since;
}

/**
 * Rótulo curto da janela para a UI: "7d clique · 1d view".
 * Sem setting calibrado devolve null (a UI decide o placeholder).
 */
export function attributionWindowLabel(setting: string | null | undefined): string | null {
  if (!setting) return null;
  const parts: string[] = [];
  const click = setting.match(/(\d+)d_click/);
  const view = setting.match(/(\d+)d_view/);
  const ev = setting.match(/(\d+)d_ev/);
  if (click) parts.push(`${click[1]}d clique`);
  if (view) parts.push(`${view[1]}d view`);
  if (ev) parts.push(`${ev[1]}d engajamento`);
  return parts.length > 0 ? parts.join(" · ") : setting;
}

import { FormattedAd } from '@/lib/api/schemas'

export interface DateRange {
  start?: string
  end?: string
}

/**
 * Formata uma data para YYYY-MM-DD usando o fuso horário local do dispositivo.
 * Diferente de toISOString().split("T")[0], esta função respeita o fuso local.
 * 
 * @param date - Data a ser formatada
 * @returns String no formato YYYY-MM-DD no fuso local
 */
export function formatDateLocal(date: Date): string {
  // Pega ano, mês e dia no fuso local (não UTC)
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Retorna a data de hoje no formato YYYY-MM-DD usando fuso local.
 * 
 * @returns String no formato YYYY-MM-DD da data de hoje no fuso local
 */
export function getTodayLocal(): string {
  return formatDateLocal(new Date());
}

/**
 * Dia-calendário da criação do anúncio no Meta (`ads.meta_created_time`), em YYYY-MM-DD.
 *
 * O Meta devolve `created_time` no fuso da CONTA de anúncios; o Postgres guarda como
 * timestamptz (instante correto, offset normalizado para UTC). Reconvertendo para o fuso
 * local do navegador recupera-se o dia que o Gerenciador de Anúncios mostra — desde que
 * navegador e conta estejam no mesmo fuso, que é a mesma premissa que o resto do app já
 * faz com datas. Por isso NÃO fatiar a string ISO: `...T02:00Z` é dia anterior em BRT.
 */
export function metaCreatedLocalDate(isoTimestamp: string | null | undefined): string | null {
  if (!isoTimestamp) return null;
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatDateLocal(parsed);
}

/**
 * Returns true if date string (YYYY-MM-DD) is within [start, end] inclusive.
 * Empty bounds are treated as open interval.
 */
export function isWithinRange(date: string | undefined, { start, end }: DateRange): boolean {
  if (!date) return false
  const d = date
  if (start && d < start) return false
  if (end && d > end) return false
  return true
}

/**
 * Filters ads by date range using the "date" field provided by the backend.
 */
export function filterAdsByDateRange<T extends Partial<FormattedAd> & { date?: string }>(
  ads: T[],
  range: DateRange
): T[] {
  const { start, end } = range
  if (!start && !end) return ads
  return ads.filter((ad) => isWithinRange(ad.date, range))
}



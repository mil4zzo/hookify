import { FormattedAd } from "@/lib/api/schemas";
import { getHookAt, normalizeCurveToDecimal, safeDivide } from "@/lib/utils/metricsShared";

export type GroupBy = "ad_id" | "ad_name";

export type DailySeriesByKey = Map<
  string,
  {
    axis: string[];
    series: {
      hook: Array<number | null>;
      cpr: Array<number | null>;
      spend: Array<number | null>;
      ctr: Array<number | null>;
      connect_rate: Array<number | null>;
      page_conv: Array<number | null>;
      cpm: Array<number | null>;
    };
  }
>;

type BuildOptions = {
  groupBy: GroupBy;
  actionType?: string;
  endDate: string; // ISO string or YYYY-MM-DD
  dateField?: string; // defaults to 'date'
  windowDays?: number; // defaults to 5
};

const toDay = (s: string) => s.slice(0, 10);

function buildAxis(endDate: string, windowDays: number): string[] {
  
  // Parse da data sem conversão de fuso horário
  const [year, month, day] = endDate.split('-').map(Number);
  if (!year || !month || !day) {
    console.log("buildAxis > invalid date format");
    return [];
  }
  
  const axis: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const targetDay = day - i;
    const targetMonth = month;
    const targetYear = year;
    
    // Ajustar mês/ano se o dia for negativo
    let finalYear = targetYear;
    let finalMonth = targetMonth;
    let finalDay = targetDay;
    
    if (finalDay <= 0) {
      finalMonth -= 1;
      if (finalMonth <= 0) {
        finalMonth = 12;
        finalYear -= 1;
      }
      // Pegar o último dia do mês anterior usando Date apenas para isso
      const daysInPrevMonth = new Date(finalYear, finalMonth, 0).getDate();
      finalDay = daysInPrevMonth + finalDay;
    }
    
    const yyyy = finalYear;
    const mm = String(finalMonth).padStart(2, "0");
    const dd = String(finalDay).padStart(2, "0");
    axis.push(`${yyyy}-${mm}-${dd}`);
  }
  return axis;
}

export function buildDailySeries(
  ads: FormattedAd[] = [],
  { groupBy, actionType, endDate, dateField = "date", windowDays = 5 }: BuildOptions
): { byKey: DailySeriesByKey; axis: string[] } {
  const axis = buildAxis(endDate, windowDays);
  const indexByDay = new Map(axis.map((d, i) => [d, i] as const));

  console.log("buildDailySeries > axis", axis);
  console.log("buildDailySeries > indexByDay", indexByDay);

  type Acc = {
    impressions: number;
    clicks: number;
    inline_link_clicks: number;
    spend: number;
    results: number;
    lpv: number;
    plays: number;
    hook_weighted_sum: number;
  };

  const acc: Map<string, Acc[]> = new Map();

  for (const ad of ads as any[]) {
    const rawDate: string | undefined = ad?.[dateField];
    if (!rawDate) continue;
    const day = toDay(String(rawDate));
    const idx = indexByDay.get(day);
    if (idx == null) continue;

    const accountId = String(ad.account_id || "");
    const adId = String(ad.ad_id || "");
    const adName = String(ad.ad_name || "");
    if (groupBy === "ad_id" && !adId) continue;

    const key = groupBy === "ad_id" ? `${accountId}:${adId}` : String(adName || adId);

    const impressions = Number(ad.impressions || 0);
    const clicks = Number(ad.clicks || 0);
    const inlineLinkClicks = Number(ad.inline_link_clicks || 0);
    const spend = Number(ad.spend || 0);
    const plays = Number(ad.video_total_plays || 0);
    const curve = normalizeCurveToDecimal(ad.video_play_curve_actions);
    const hookValue = getHookAt(curve, 3);

    let results = 0;
    if (actionType) {
      const hit = (ad.conversions || []).find((c: any) => c.action_type === actionType);
      results = Number(hit?.value || 0);
    }

    const lpv = (ad.actions || []).find((a: any) => a.action_type === "landing_page_view")?.value || 0;

    if (!acc.has(key)) {
      acc.set(
        key,
        Array.from({ length: axis.length }, () => ({
          impressions: 0,
          clicks: 0,
          inline_link_clicks: 0,
          spend: 0,
          results: 0,
          lpv: 0,
          plays: 0,
          hook_weighted_sum: 0,
        }))
      );
    }
    const slot = acc.get(key)![idx];
    slot.impressions += impressions;
    slot.clicks += clicks;
    slot.inline_link_clicks += inlineLinkClicks;
    slot.spend += spend;
    slot.results += results;
    slot.lpv += lpv;
    slot.plays += plays;
    slot.hook_weighted_sum += hookValue * plays;
  }

  const byKey: DailySeriesByKey = new Map();
  for (const [key, rows] of acc.entries()) {
    const hook = rows.map((r) => (r.plays > 0 ? r.hook_weighted_sum / r.plays : null));
    const cpr = rows.map((r) => (r.results > 0 ? r.spend / r.results : null));
    const spend = rows.map((r) => (r.spend > 0 ? r.spend : null));
    const ctr = rows.map((r) => (r.impressions > 0 ? safeDivide(r.clicks, r.impressions) : null));
    const connect_rate = rows.map((r) => (r.inline_link_clicks > 0 ? safeDivide(r.lpv, r.inline_link_clicks) : null));
    const page_conv = rows.map((r) => (r.lpv > 0 ? safeDivide(r.results, r.lpv) : null));
    const cpm = rows.map((r) => (r.impressions > 0 ? (r.spend * 1000) / r.impressions : null));

    byKey.set(key, {
      axis,
      series: { hook, cpr, spend, ctr, connect_rate, page_conv, cpm },
    });
  }

  console.log("buildDailySeries > byKey", { byKey, axis });
  return { byKey, axis };
}



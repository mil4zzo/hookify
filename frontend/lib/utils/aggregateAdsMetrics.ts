import { FormattedAd } from '@/lib/api/schemas'
import { getHookAt, normalizeCurveToDecimal, safeDivide } from '@/lib/utils/metricsShared'

export interface AggregateOptions {
  groupBy: 'ad_id' | 'ad_name' | 'date'
  actionType?: string
}

export interface AggregatedAd {
  // identifiers
  unique_id?: string
  account_id?: string
  ad_id: string
  ad_name: string

  // sums
  impressions: number
  clicks: number
  inline_link_clicks: number
  spend: number
  results: number
  lpv: number // landing_page_views
  plays: number // video_total_plays

  // derived (all decimals 0..1 for rates)
  hook: number
  ctr: number
  connect_rate: number
  page_conv: number
  cpr: number // spend / results
  cpm: number // (spend * 1000) / impressions

  // meta
  thumbnail?: string
  ad_count: number

  // passthrough minimal (optional)
  [key: string]: any
}

export function aggregateAdsMetrics(
  ads: FormattedAd[] = [],
  opts: AggregateOptions
): AggregatedAd[] {
  const { groupBy, actionType } = opts
  const map = new Map<string, AggregatedAd & { hook_weighted_sum: number }>()

  for (const ad of ads) {
    const accountId = String(ad.account_id || '')
    const adId = String(ad.ad_id || '')
    const adName = String(ad.ad_name || '')
    const adDate = String((ad as any).date || '')

    if (groupBy === 'ad_id' && !adId) {
      // Skip items without ad_id when grouping by ID
      continue
    }

    let key: string
    if (groupBy === 'ad_id') key = `${accountId}:${adId}`
    else if (groupBy === 'ad_name') key = adName
    else key = adDate || `${accountId}:${adId}:${adName}`

    const impressions = Number(ad.impressions || 0)
    const clicks = Number(ad.clicks || 0)
    const inlineLinkClicks = Number(ad.inline_link_clicks || 0)
    const spend = Number(ad.spend || 0)
    const plays = Number(ad.video_total_plays || 0)
    
    // Se o ad já tem hook calculado (vindo do servidor), usar esse valor
    // Caso contrário, tentar calcular a partir da curva
    const existingHook = Number((ad as any).hook || 0)
    let hookValue = existingHook
    if (!existingHook && ad.video_play_curve_actions && ad.video_play_curve_actions.length > 0) {
      const curve = normalizeCurveToDecimal(ad.video_play_curve_actions)
      hookValue = getHookAt(curve, 3)
    }

    // results come from conversions[actionType]
    let results = 0
    if (actionType) {
      const hit = (ad.conversions || []).find((c) => c.action_type === actionType)
      results = Number(hit?.value || 0)
    }

    // landing page views
    const lpv = (ad.actions || []).find((a) => a.action_type === 'landing_page_view')?.value || 0

    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        unique_id: groupBy === 'ad_id' ? key : undefined,
        account_id: accountId,
        ad_id: adId,
        ad_name: adName,
        date: adDate,
        impressions,
        clicks,
        inline_link_clicks: inlineLinkClicks,
        spend,
        results,
        lpv,
        plays,
        hook: 0, // placeholder, will compute later
        ctr: 0,
        connect_rate: 0,
        page_conv: 0,
        cpr: 0,
        cpm: 0,
        thumbnail: ad.thumbnail as string || (ad.adcreatives_videos_thumbs?.[0] || ''),
        ad_count: 1,
        hook_weighted_sum: hookValue * plays,
      })
    } else {
      existing.impressions += impressions
      existing.clicks += clicks
      existing.inline_link_clicks += inlineLinkClicks
      existing.spend += spend
      existing.results += results
      existing.lpv += lpv
      existing.plays += plays
      existing.hook_weighted_sum += hookValue * plays
      existing.ad_count += 1
      if (!existing.thumbnail) {
        existing.thumbnail = ad.thumbnail as string || (ad.adcreatives_videos_thumbs?.[0] || '')
      }
    }
  }

  // finalize derived metrics
  const out: AggregatedAd[] = []
  for (const item of map.values()) {
    const ctr = safeDivide(item.clicks, item.impressions)
    const connectRate = safeDivide(item.lpv, item.inline_link_clicks)
    const pageConv = safeDivide(item.results, item.lpv)
    const hook = item.plays > 0 ? item.hook_weighted_sum / item.plays : 0
    const cpr = item.results > 0 ? item.spend / item.results : 0
    const cpm = item.impressions > 0 ? (item.spend * 1000) / item.impressions : 0

    out.push({
      ...item,
      ctr,
      connect_rate: connectRate,
      page_conv: pageConv,
      hook,
      cpr,
      cpm,
    })
  }

  return out
}




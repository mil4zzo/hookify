import { z } from 'zod'

// Facebook API Schemas - PRECISOS baseados nas respostas reais
export const FacebookUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  picture: z.object({
    data: z.object({
      url: z.string()
    }),
  }),
  adaccounts: z.array(z.lazy(() => FacebookAdAccountSchema)).optional(),
})

export const FacebookAdAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  account_status: z.number(), // 1=ativo, 2=pausado, 101=ativo com restrições
  user_tasks: z.array(z.string()).optional(), // ["DRAFT", "ANALYZE", "ADVERTISE", "MANAGE"]
  business: z.object({
    name: z.string(),
    id: z.string(),
  }).optional(),
  instagram_accounts: z.array(z.object({
    username: z.string(),
    id: z.string(),
  })).optional(),
})

// Formato normalizado compatível com o antigo dataformatter.py (Streamlit)
// Observação: campos dinâmicos derivados de actions/conversions são aceitos via .passthrough()
export const FormattedAdSchema = z.object({

  // ** GET ADS **
  // Identificadores e nomes
  account_id: z.string(),
  ad_id: z.string(),
  ad_name: z.string(),
  adset_id: z.string(),
  adset_name: z.string(),
  campaign_id: z.string(),
  campaign_name: z.string(),

  // Métricas inteiras
  clicks: z.number().int(),
  impressions: z.number().int(),
  inline_link_clicks: z.number().int(),
  reach: z.number().int(),
  video_total_plays: z.number().int(),
  video_total_thruplays: z.number().int(),
  video_watched_p50: z.number().int(),
  // Métricas decimais
  spend: z.number(),
  cpm: z.number(),
  ctr: z.number(),
  frequency: z.number(),
  website_ctr: z.number().optional(),

  // Arrays de métricas
  actions: z.array(z.object({
    action_type: z.string(),
    value: z.number(),
  })),
  conversions: z.array(z.object({
    action_type: z.string(),
    value: z.number(),
  })).optional(),
  cost_per_conversion: z.array(z.object({
    action_type: z.string(),
    value: z.number(),
  })).optional(),
  video_play_curve_actions: z.array(z.number()),

  // Creative
  creative: z.object({
    id: z.string().optional(),
    actor_id: z.string().optional(),
    object_type: z.string().optional(),
    status: z.string().optional(),
    thumbnail_url: z.string().optional(),
    effective_object_story_id: z.string().optional(),
    instagram_permalink_url: z.string().optional(),

    video_id: z.string().optional(),
    body: z.string().optional(),
    call_to_action_type: z.string().optional(),
    title: z.string().optional(),
  }),

  // Videos associados (asset_feed_spec)
  adcreatives_videos_ids: z.array(z.string()).optional(),
  adcreatives_videos_thumbs: z.array(z.string()).optional(),

  // Derivadas
  connect_rate: z.number().optional(),
  profile_ctr: z.number().optional(),

  // Organização
  from_pack: z.string().optional(),

  // Dia do insight (time_increment=1)
  date: z.string().optional(),
}).passthrough()


// Request Schemas
export const FilterRuleSchema = z.object({
  field: z.string(),
  operator: z.enum(['CONTAIN', 'EQUAL', 'NOT_EQUAL', 'NOT_CONTAIN', 'STARTS_WITH', 'ENDS_WITH']),
  value: z.string(),
})

export const GetAdsRequestSchema = z.object({
  adaccount_id: z.string(),
  date_start: z.string(),
  date_stop: z.string(),
  level: z.enum(['campaign', 'adset', 'ad']).default('ad'),
  limit: z.number().min(1).max(1000).default(100),
  filters: z.array(FilterRuleSchema).default([]),
  name: z.string().optional(), // Nome do pack
  auto_refresh: z.boolean().optional(), // Preferência de auto-refresh
  today_local: z.string().optional(), // Dia lógico do usuário (YYYY-MM-DD) para last_refreshed_at
})

export const GetVideoSourceRequestSchema = z.object({
  video_id: z.string(),
  actor_id: z.string(),
})

export const AuthTokenRequestSchema = z.object({
  code: z.string(),
  redirect_uri: z.string(),
})

// Response Schemas - PRECISOS baseados nas respostas reais
export const GetMeResponseSchema = FacebookUserSchema

// Backend retorna array direto de anúncios (insights enriquecidos)
export const GetAdsResponseSchema = z.array(FormattedAdSchema)

export const GetVideoSourceResponseSchema = z.object({
  video_id: z.string().optional(),
  source_url: z.string(),
  thumbnail_url: z.string().optional(),
  duration: z.number().optional(),
}).passthrough()

export const AuthTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number().nullable().optional(), // Pode ser null
  user_info: FacebookUserSchema.optional(), // Dados do usuário incluídos na resposta
})

export const AuthUrlResponseSchema = z.object({
  auth_url: z.string(),
})

// Type exports
export type FacebookUser = z.infer<typeof FacebookUserSchema>
export type FacebookAdAccount = z.infer<typeof FacebookAdAccountSchema>
export type FormattedAd = z.infer<typeof FormattedAdSchema>
export type FacebookVideoSource = z.infer<typeof GetVideoSourceResponseSchema>

export type FilterRule = z.infer<typeof FilterRuleSchema>
export type GetAdsRequest = z.infer<typeof GetAdsRequestSchema>
export type GetVideoSourceRequest = z.infer<typeof GetVideoSourceRequestSchema>
export type AuthTokenRequest = z.infer<typeof AuthTokenRequestSchema>

export type GetMeResponse = z.infer<typeof GetMeResponseSchema>
export type GetAdsResponse = z.infer<typeof GetAdsResponseSchema>
export type GetVideoSourceResponse = z.infer<typeof GetVideoSourceResponseSchema>
export type AuthTokenResponse = z.infer<typeof AuthTokenResponseSchema>
export type AuthUrlResponse = z.infer<typeof AuthUrlResponseSchema>

// ========== Analytics Schemas ==========
export const RankingsFiltersSchema = z.object({
  adaccount_ids: z.array(z.string()).optional(),
  campaign_name_contains: z.string().optional(),
  adset_name_contains: z.string().optional(),
  ad_name_contains: z.string().optional(),
})

export const RankingsRequestSchema = z.object({
  date_start: z.string(),
  date_stop: z.string(),
  group_by: z.enum(['ad_id', 'ad_name']).default('ad_id'),
  action_type: z.string().optional(),
  order_by: z.string().optional(),
  limit: z.number().optional(),
  filters: RankingsFiltersSchema.optional(),
})

export const RankingsItemSchema = z.object({
  unique_id: z.string().nullable().optional(),
  account_id: z.string().nullable().optional(),
  ad_id: z.string().nullable().optional(),
  ad_name: z.string().nullable().optional(),
  impressions: z.number(),
  clicks: z.number(),
  inline_link_clicks: z.number(),
  spend: z.number(),
  lpv: z.number(),
  plays: z.number(),
  hook: z.number(),
  video_watched_p50: z.number().optional(),
  ctr: z.number(),
  connect_rate: z.number(),
  conversions: z.record(z.string(), z.number()), // {action_type: total_value} para calcular results/cpr/page_conv no frontend
  ad_count: z.number(),
  thumbnail: z.string().nullable().optional(),
  video_play_curve_actions: z.array(z.number()).nullable().optional(), // Curva de retenção agregada (ponderada por plays)
  series: z
    .object({
      axis: z.array(z.string()),
      hook: z.array(z.number().nullable()),
      spend: z.array(z.number().nullable()),
      ctr: z.array(z.number().nullable()),
      connect_rate: z.array(z.number().nullable()),
      lpv: z.array(z.number().nullable()), // lpv por dia para calcular page_conv dinamicamente
      conversions: z.array(z.record(z.string(), z.number())), // conversions por dia para calcular results/cpr/page_conv dinamicamente
    })
    .nullable()
    .optional(),
})

export const RankingsResponseSchema = z.object({
  data: z.array(RankingsItemSchema),
  available_conversion_types: z.array(z.string()).optional(),
  averages: z
    .object({
      hook: z.number(),
      scroll_stop: z.number(),
      ctr: z.number(),
      connect_rate: z.number(),
      cpm: z.number(),
      per_action_type: z.record(
        z.string(),
        z.object({
          results: z.number(),
          cpr: z.number(),
          page_conv: z.number(),
        })
      ),
    })
    .optional(),
})

// Children (detalhe por ad_id)
// Reutilizado tanto para /rankings/ad-name/{ad_name}/children quanto para /rankings/ad-id/{ad_id}
export const RankingsChildrenItemSchema = z.object({
  account_id: z.string().nullable().optional(),
  ad_id: z.string(),
  ad_name: z.string().nullable().optional(),
  campaign_name: z.string().nullable().optional(),
  adset_name: z.string().nullable().optional(),
  impressions: z.number(),
  clicks: z.number(),
  inline_link_clicks: z.number(),
  spend: z.number(),
  lpv: z.number(),
  plays: z.number(),
  hook: z.number(),
  video_watched_p50: z.number().optional(),
  ctr: z.number(),
  connect_rate: z.number(),
  conversions: z.record(z.string(), z.number()),
  thumbnail: z.string().nullable().optional(),
  video_play_curve_actions: z.array(z.number()).nullable().optional(),
  series: z
    .object({
      axis: z.array(z.string()),
      hook: z.array(z.number().nullable()),
      spend: z.array(z.number().nullable()),
      ctr: z.array(z.number().nullable()),
      connect_rate: z.array(z.number().nullable()),
      lpv: z.array(z.number().nullable()),
      impressions: z.array(z.number().nullable()),
      conversions: z.array(z.record(z.string(), z.number())),
    })
    .nullable()
    .optional(),
})

export type RankingsItem = z.infer<typeof RankingsItemSchema>
export type RankingsChildrenItem = z.infer<typeof RankingsChildrenItemSchema>

export const AdCreativeResponseSchema = z.object({
  creative: z.object({
    id: z.string().optional(),
    actor_id: z.string().optional(),
    video_id: z.string().optional(),
    object_type: z.string().optional(),
    status: z.string().optional(),
    thumbnail_url: z.string().optional(),
    effective_object_story_id: z.string().optional(),
    instagram_permalink_url: z.string().optional(),
    body: z.string().optional(),
    call_to_action_type: z.string().optional(),
    title: z.string().optional(),
  }).passthrough(),
  adcreatives_videos_ids: z.array(z.string()),
})

export type AdCreativeResponse = z.infer<typeof AdCreativeResponseSchema>

export const DashboardRequestSchema = z.object({
  date_start: z.string(),
  date_stop: z.string(),
  adaccount_ids: z.array(z.string()).optional(),
})

export const DashboardResponseSchema = z.object({
  totals: z.object({
    spend: z.number(),
    impressions: z.number(),
    reach: z.number(),
    clicks: z.number(),
    inline_link_clicks: z.number(),
    video_total_plays: z.number(),
    video_total_thruplays: z.number(),
    lpv: z.number(),
    ctr: z.number(),
    cpm: z.number(),
    frequency: z.number(),
    website_ctr: z.number(),
    connect_rate: z.number(),
  }),
})

export type RankingsFilters = z.infer<typeof RankingsFiltersSchema>
export type RankingsRequest = z.infer<typeof RankingsRequestSchema>
export type RankingsResponse = z.infer<typeof RankingsResponseSchema>
export type DashboardRequest = z.infer<typeof DashboardRequestSchema>
export type DashboardResponse = z.infer<typeof DashboardResponseSchema>

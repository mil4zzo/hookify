import { z } from 'zod'

// Facebook API Schemas - PRECISOS baseados nas respostas reais
export const FacebookUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  picture: z.object({
    data: z.object({
      url: z.string(),
      height: z.number().optional(),
      width: z.number().optional(),
      is_silhouette: z.boolean().optional(),
    }),
  }).optional(),
})

export const FacebookAdAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  account_status: z.number(), // 1=ativo, 2=pausado, 101=ativo com restrições
  user_tasks: z.array(z.string()).optional(), // ["DRAFT", "ANALYZE", "ADVERTISE", "MANAGE"]
  business: z.object({
    name: z.string(),
    id: z.string(),
    picture: z.object({
      data: z.object({
        url: z.string(),
        height: z.number().optional(),
        width: z.number().optional(),
        is_silhouette: z.boolean().optional(),
      }),
    }).optional(),
  }).optional(),
  instagram_accounts: z.object({
    data: z.array(z.object({
      username: z.string(),
      id: z.string(),
    })),
    paging: z.object({
      cursors: z.object({
        before: z.string().optional(),
        after: z.string().optional(),
      }),
    }).optional(),
  }).optional(),
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

export const GetAdAccountsResponseSchema = z.array(FacebookAdAccountSchema) // Array direto, não objeto com 'data'

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
export type GetAdAccountsResponse = z.infer<typeof GetAdAccountsResponseSchema>
export type GetAdsResponse = z.infer<typeof GetAdsResponseSchema>
export type GetVideoSourceResponse = z.infer<typeof GetVideoSourceResponseSchema>
export type AuthTokenResponse = z.infer<typeof AuthTokenResponseSchema>
export type AuthUrlResponse = z.infer<typeof AuthUrlResponseSchema>

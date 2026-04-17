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
  ad_id: z.string().optional(),
  video_owner_page_id: z.string().optional(),
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
  video_owner_page_id: z.string().optional(),
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

// ========== Meta Status Update (pause/resume) ==========
export const UpdateEntityStatusRequestSchema = z.object({
  status: z.enum(["PAUSED", "ACTIVE"]),
})

export const UpdateEntityStatusResponseSchema = z.object({
  success: z.boolean(),
  entity_id: z.string(),
  entity_type: z.enum(["ad", "adset", "campaign"]),
  status: z.enum(["PAUSED", "ACTIVE"]),
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
export type UpdateEntityStatusRequest = z.infer<typeof UpdateEntityStatusRequestSchema>
export type UpdateEntityStatusResponse = z.infer<typeof UpdateEntityStatusResponseSchema>

// ========== Google Sheets Integration Schemas ==========

export const SpreadsheetItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  modified_time: z.string().nullable().optional(),
  web_view_link: z.string().nullable().optional(),
})

export const ListSpreadsheetsResponseSchema = z.object({
  spreadsheets: z.array(SpreadsheetItemSchema),
  next_page_token: z.string().nullable().optional(),
})

export const WorksheetItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  index: z.number(),
  sheet_type: z.string(),
})

export const ListWorksheetsResponseSchema = z.object({
  worksheets: z.array(WorksheetItemSchema),
})

export const GoogleConnectionSchema = z.object({
  id: z.string(),
  google_user_id: z.string().nullable().optional(),
  google_email: z.string().nullable().optional(),
  google_name: z.string().nullable().optional(),
  scopes: z.array(z.string()).nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const ListGoogleConnectionsResponseSchema = z.object({
  connections: z.array(GoogleConnectionSchema),
})

export const ColumnWithIndexSchema = z.object({
  name: z.string(),
  index: z.number(),
  label: z.string(),
})

export const SheetColumnsResponseSchema = z.object({
  columns: z.array(z.string()),
  duplicates: z.record(z.string(), z.array(z.number())).optional().default({}),
  sampleRows: z.array(z.array(z.string())).optional().default([]),
  columnsWithIndices: z.array(ColumnWithIndexSchema).optional().default([]),
})

export const SheetIntegrationRequestSchema = z.object({
  spreadsheet_id: z.string(),
  worksheet_title: z.string(),
  ad_id_column: z.string(),
  date_column: z.string(),
  date_format: z.enum(["DD/MM/YYYY", "MM/DD/YYYY"]),
  leadscore_column: z.string(),
  // Índices explícitos quando há headers duplicados (0-based)
  ad_id_column_index: z.number().optional().nullable(),
  date_column_index: z.number().optional().nullable(),
  leadscore_column_index: z.number().optional().nullable(),
  // Quando presente, a integração é específica daquele pack (booster por pack)
  pack_id: z.string().optional().nullable(),
  // ID da conexão Google específica a usar para esta integração
  connection_id: z.string().optional().nullable(),
})

export const SheetIntegrationSchema = z.object({
  id: z.string(),
  owner_id: z.string(),
  pack_id: z.string().nullable().optional(),
  spreadsheet_id: z.string(),
  worksheet_title: z.string(),
  ad_id_column: z.string(),
  date_column: z.string(),
  date_format: z.string().nullable().optional(),
  leadscore_column: z.string().nullable().optional(),
  spreadsheet_name: z.string().nullable().optional(),
  last_synced_at: z.string().nullable().optional(),
  last_sync_status: z.string().nullable().optional(),
  last_successful_sync_at: z.string().nullable().optional(),
}).passthrough()

export const SaveSheetIntegrationResponseSchema = z.object({
  integration: SheetIntegrationSchema,
})

export const SheetSyncStatsSchema = z.object({
  processed_rows: z.number(),
  updated_rows: z.number(),
  skipped_no_match: z.number(),
  skipped_invalid: z.number(),
  utilized_sheet_rows: z.number().optional(),
  skipped_sheet_rows: z.number().optional(),
  matched_unique_pairs: z.number().optional(),
  ids_not_found_count: z.number().optional(),
  ids_out_of_pack_count: z.number().optional(),
  total_update_queries: z.number().optional(),
  integration_status_updated: z.boolean().optional(),
})

export const SheetSyncJobProgressSchema = z.object({
  status: z.enum(["processing", "persisting", "completed", "failed", "cancelled"]),
  progress: z.number(),
  message: z.string(),
  details: z.record(z.any()).optional(),
  stats: z.object({
    rows_read: z.number().optional(),
    rows_processed: z.number().optional(),
    rows_updated: z.number().optional(),
    rows_skipped: z.number().optional(),
    unique_ad_date_pairs: z.number().optional(),
    total_update_queries: z.number().optional(),
  }).optional(),
  result_count: z.number().optional(),
})

export type SheetSyncJobProgress = z.infer<typeof SheetSyncJobProgressSchema>

export const SheetSyncResponseSchema = z.object({
  status: z.literal('ok'),
  stats: SheetSyncStatsSchema,
})

export type SpreadsheetItem = z.infer<typeof SpreadsheetItemSchema>
export type ListSpreadsheetsResponse = z.infer<typeof ListSpreadsheetsResponseSchema>
export type WorksheetItem = z.infer<typeof WorksheetItemSchema>
export type ListWorksheetsResponse = z.infer<typeof ListWorksheetsResponseSchema>
export type GoogleConnection = z.infer<typeof GoogleConnectionSchema>
export type ListGoogleConnectionsResponse = z.infer<typeof ListGoogleConnectionsResponseSchema>
export type SheetColumnsResponse = z.infer<typeof SheetColumnsResponseSchema>
export type SheetIntegrationRequest = z.infer<typeof SheetIntegrationRequestSchema>
export type SheetIntegration = z.infer<typeof SheetIntegrationSchema>
export type SaveSheetIntegrationResponse = z.infer<typeof SaveSheetIntegrationResponseSchema>
export type SheetSyncStats = z.infer<typeof SheetSyncStatsSchema>
export type SheetSyncResponse = z.infer<typeof SheetSyncResponseSchema>

// ========== Analytics Schemas ==========
// Estes schemas representam o snapshot agregado de performance de anúncios
// retornado pelo endpoint histórico `/analytics/rankings` (também exposto como
// `/analytics/ad-performance`). O nome "Rankings" é mantido por compatibilidade,
// mas em código novo prefira os aliases AdPerformance* exportados abaixo.
export const RankingsFiltersSchema = z.object({
  adaccount_ids: z.array(z.string()).optional(),
  campaign_name_contains: z.string().optional(),
  adset_name_contains: z.string().optional(),
  ad_name_contains: z.string().optional(),
})

export const RankingsRequestSchema = z.object({
  date_start: z.string(),
  date_stop: z.string(),
  group_by: z.enum(['ad_id', 'ad_name', 'adset_id', 'campaign_id']).default('ad_id'),
  action_type: z.string().optional(),
  order_by: z.string().optional(),
  limit: z.number().optional(),
  filters: RankingsFiltersSchema.optional(),
  pack_ids: z.array(z.string()).optional(),
  include_series: z.boolean().optional(),
  include_leadscore: z.boolean().optional(),
  series_window: z.number().optional(),
  offset: z.number().int().nonnegative().optional(),
  include_available_conversion_types: z.boolean().optional(),
})

// Schema centralizado para séries de métricas diárias (sparklines)
// Mantém compatibilidade com o backend (`analytics.get_rankings`, `get_rankings_children`,
// `get_ad_details`) e aceita campos extras futuros via .passthrough()
const RankingsSeriesSchema = z.object({
  axis: z.array(z.string()),
  hook: z.array(z.number().nullable()),
  scroll_stop: z.array(z.number().nullable()).optional(),
  hold_rate: z.array(z.number().nullable()).optional(),
  video_watched_p50: z.array(z.number().nullable()).optional(),
  spend: z.array(z.number().nullable()),
  clicks: z.array(z.number().nullable()).optional(),
  inline_link_clicks: z.array(z.number().nullable()).optional(),
  ctr: z.array(z.number().nullable()),
  connect_rate: z.array(z.number().nullable()),
  lpv: z.array(z.number().nullable()), // lpv por dia para calcular page_conv dinamicamente
  impressions: z.array(z.number().nullable()),
  cpm: z.array(z.number().nullable()),
  cpc: z.array(z.number().nullable()).optional(),
  cplc: z.array(z.number().nullable()).optional(),
  // CPMQL diário (calculado no backend usando leadscore_values por dia + mql_leadscore_min do usuário)
  // Opcional para manter compatibilidade com backends antigos.
  cpmql: z.array(z.number().nullable()).optional(),
  website_ctr: z.array(z.number().nullable()),
  conversions: z.array(z.record(z.string(), z.number())), // conversions por dia para calcular results/cpr/page_conv dinamicamente
}).passthrough();

export const RankingsItemSchema = z.object({
  group_key: z.string().nullable().optional(),
  unique_id: z.string().nullable().optional(),
  account_id: z.string().nullable().optional(),
  campaign_id: z.string().nullable().optional(),
  campaign_name: z.string().nullable().optional(),
  adset_id: z.string().nullable().optional(),
  adset_name: z.string().nullable().optional(),
  ad_id: z.string().nullable().optional(),
  ad_name: z.string().nullable().optional(),
  effective_status: z.string().nullable().optional(), // Status do anúncio (ACTIVE, PAUSED, ARCHIVED, etc.)
  active_count: z.number().nullable().optional(), // Quantidade de anúncios ativos no grupo (por anúncio / por conjunto)
  impressions: z.number(),
  clicks: z.number(),
  inline_link_clicks: z.number(),
  spend: z.number(),
  lpv: z.number(),
  plays: z.number(),
  video_total_thruplays: z.number().optional(), // Total de thruplays agregado
  hook: z.number(),
  hold_rate: z.number().optional(),
  video_watched_p50: z.number().optional(),
  ctr: z.number(),
  connect_rate: z.number(),
  cpm: z.number(),
  cpc: z.number().nullable().optional(),
  cplc: z.number().nullable().optional(),
  reach: z.number().optional(),
  frequency: z.number().optional(),
  leadscore_values: z.array(z.number()).optional(), // Array agregado de leadscore_values para calcular MQLs
  conversions: z.record(z.string(), z.number()), // {action_type: total_value} para calcular results/cpr/page_conv no frontend
  ad_count: z.number(),
  thumbnail: z.string().nullable().optional(),
  adcreatives_videos_thumbs: z.array(z.string()).nullable().optional(), // Array de thumbnails dos vídeos do adcreative
  video_play_curve_actions: z.array(z.number()).nullable().optional(), // Curva de retenção agregada (ponderada por plays)
  series: z
    .lazy(() => RankingsSeriesSchema)
    .nullable()
    .optional(),
})

export const RankingsResponseSchema = z.object({
  data: z.array(RankingsItemSchema),
  available_conversion_types: z.array(z.string()).optional(),
  averages: z
    .object({
      hook: z.number(),
      hold_rate: z.number().optional(),
      video_watched_p50: z.number().optional(),
      scroll_stop: z.number(),
      ctr: z.number(),
      website_ctr: z.number(),
      connect_rate: z.number(),
      cpm: z.number(),
      cpc: z.number().optional(),
      cplc: z.number().optional(),
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
  header_aggregates: z
    .object({
      sums: z
        .object({
          spend: z.number().optional(),
          results: z.number().optional(),
          mqls: z.number().nullable().optional(),
        })
        .optional(),
      weighted_averages: z
        .object({
          hook: z.number().optional(),
          scroll_stop: z.number().optional(),
          ctr: z.number().optional(),
          website_ctr: z.number().optional(),
          connect_rate: z.number().optional(),
          cpm: z.number().optional(),
          cpc: z.number().optional(),
          cplc: z.number().optional(),
          page_conv: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
  pagination: z
    .object({
      limit: z.number().int().nonnegative(),
      offset: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      has_more: z.boolean(),
    })
    .optional(),
})

export const RankingsSeriesRequestSchema = z.object({
  date_start: z.string(),
  date_stop: z.string(),
  group_by: z.enum(['ad_id', 'ad_name', 'adset_id', 'campaign_id']).default('ad_id'),
  action_type: z.string().optional(),
  pack_ids: z.array(z.string()).optional(),
  filters: RankingsFiltersSchema.optional(),
  group_keys: z.array(z.string()),
  window: z.number().int().min(1).max(30).optional(),
})

export const RankingsSeriesResponseSchema = z.object({
  series_by_group: z.record(z.string(), RankingsSeriesSchema),
  window: z.number().optional(),
})

export const RankingsRetentionRequestSchema = z.object({
  date_start: z.string(),
  date_stop: z.string(),
  group_by: z.enum(['ad_id', 'ad_name', 'adset_id', 'campaign_id']).default('ad_id'),
  pack_ids: z.array(z.string()).optional(),
  filters: RankingsFiltersSchema.optional(),
  group_key: z.string(),
})

export const RankingsRetentionResponseSchema = z.object({
  group_key: z.string(),
  video_play_curve_actions: z.array(z.number()),
})

// ===== Global Search (Sidebar) =====
export const GlobalSearchResultTypeSchema = z.enum(["ad_id", "ad_name", "adset_name", "campaign_name"])

export const GlobalSearchResultSchema = z.object({
  type: GlobalSearchResultTypeSchema,
  value: z.string(),
  label: z.string(),
  ad_id: z.string().nullable().optional(),
  ad_name: z.string().nullable().optional(),
  adset_name: z.string().nullable().optional(),
  campaign_name: z.string().nullable().optional(),
})

export const GlobalSearchResponseSchema = z.object({
  results: z.array(GlobalSearchResultSchema),
})

// Children (detalhe por ad_id)
// Reutilizado tanto para /rankings/ad-name/{ad_name}/children quanto para /rankings/ad-id/{ad_id}
export const RankingsChildrenItemSchema = z.object({
  account_id: z.string().nullable().optional(),
  ad_id: z.string(),
  ad_name: z.string().nullable().optional(),
  effective_status: z.string().nullable().optional(), // Status do anúncio (ACTIVE, PAUSED, ARCHIVED, etc.)
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
  cpm: z.number(),
  conversions: z.record(z.string(), z.number()),
  thumbnail: z.string().nullable().optional(),
  video_play_curve_actions: z.array(z.number()).nullable().optional(),
  series: z
    .lazy(() => RankingsSeriesSchema)
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

export type RankingsFilters = z.infer<typeof RankingsFiltersSchema>
export type RankingsRequest = z.infer<typeof RankingsRequestSchema>
export type RankingsResponse = z.infer<typeof RankingsResponseSchema>
export type RankingsSeriesRequest = z.infer<typeof RankingsSeriesRequestSchema>
export type RankingsSeriesResponse = z.infer<typeof RankingsSeriesResponseSchema>
export type RankingsRetentionRequest = z.infer<typeof RankingsRetentionRequestSchema>
export type RankingsRetentionResponse = z.infer<typeof RankingsRetentionResponseSchema>
export type GlobalSearchResultType = z.infer<typeof GlobalSearchResultTypeSchema>
export type GlobalSearchResult = z.infer<typeof GlobalSearchResultSchema>
export type GlobalSearchResponse = z.infer<typeof GlobalSearchResponseSchema>

// Aliases semânticos para futuras evoluções, mantendo compatibilidade com o nome antigo "Rankings"
export type AdPerformanceRequest = RankingsRequest;
export type AdPerformanceItem = RankingsItem;
export type AdPerformanceResponse = RankingsResponse;
export type AdDetailItem = RankingsChildrenItem;

// ========== Bulk Ads Upload ==========
export const AdsTreeAdSchema = z.object({
  ad_id: z.string(),
  ad_name: z.string().nullable().optional(),
  account_id: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
})

export const AdsTreeAdsetSchema = z.object({
  adset_id: z.string(),
  adset_name: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  ads: z.array(AdsTreeAdSchema),
})

export const AdsTreeCampaignSchema = z.object({
  campaign_id: z.string(),
  campaign_name: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  adsets: z.array(AdsTreeAdsetSchema),
})

export const AdsTreeResponseSchema = z.array(AdsTreeCampaignSchema)

export const FlatAdSchema = z.object({
  ad_id: z.string(),
  ad_name: z.string().nullable().optional(),
  account_id: z.string().nullable().optional(),
  adset_id: z.string(),
  adset_name: z.string().nullable().optional(),
  campaign_id: z.string(),
  campaign_name: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
})

export const AdsSearchResponseSchema = z.object({
  items: z.array(FlatAdSchema),
  next_offset: z.number().int().nullable(),
  has_more: z.boolean(),
})

export const AdCreativeDetailResponseSchema = z.object({
  creative: z.record(z.any()),
  body: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  call_to_action: z.string().nullable().optional(),
  link_url: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  video_url: z.string().nullable().optional(),
  format: z.string().nullable().optional(),
  family: z.string(),
  supports_bulk_clone: z.boolean(),
  supports_media_swap: z.boolean().optional().default(false),
  warnings: z.array(z.string()).default([]),
  media_slots: z.array(
    z.object({
      slot_key: z.string(),
      display_name: z.string(),
      media_type: z.enum(["image", "video"]),
      source: z.string(),
      label_name: z.string().nullable().optional(),
      rules_count: z.number().int(),
      placements_summary: z.array(z.string()).default([]),
      required: z.boolean().default(true),
      primary_placement: z.string().default(""),
      aspect_ratio: z.string().default(""),
      compatible_slot_keys: z.array(z.string()).default([]),
    }),
  ).default([]),
  is_multi_slot: z.boolean().default(false),
  slot_count: z.number().int().default(0),
})

export const BulkAdItemConfigSchema = z.object({
  file_index: z.number().int().min(0).optional(),
  bundle_id: z.string().optional(),
  bundle_name: z.string().nullable().optional(),
  slot_files: z.record(z.string(), z.number().int().min(0)).optional(),
  adset_id: z.string(),
  adset_name: z.string().nullable().optional(),
  ad_name: z.string(),
}).superRefine((value, ctx) => {
  const hasFileIndex = value.file_index !== undefined
  const hasSlotFiles = !!value.slot_files && Object.keys(value.slot_files).length > 0
  if (!hasFileIndex && !hasSlotFiles) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "file_index ou slot_files e obrigatorio" })
  }
  if (hasFileIndex && hasSlotFiles) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "file_index e slot_files sao mutuamente exclusivos" })
  }
  if (hasSlotFiles && !value.bundle_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "bundle_id e obrigatorio quando slot_files e enviado" })
  }
})

export const BulkAdConfigSchema = z.object({
  template_ad_id: z.string(),
  account_id: z.string(),
  status: z.enum(["ACTIVE", "PAUSED"]),
  bundle_strategy: z.enum(["legacy_single_file", "explicit_bundles"]).optional(),
  items: z.array(BulkAdItemConfigSchema).min(1).max(500),
})

export const BulkAdItemProgressSchema = z.object({
  id: z.string(),
  file_name: z.string(),
  file_index: z.number().int(),
  bundle_id: z.string().nullable().optional(),
  bundle_name: z.string().nullable().optional(),
  slot_files: z.record(z.string(), z.number().int()).nullable().optional(),
  is_multi_slot: z.boolean().nullable().optional(),
  adset_id: z.string().nullable().optional(),
  adset_name: z.string().nullable().optional(),
  ad_name: z.string(),
  status: z.string(),
  meta_ad_id: z.string().nullable().optional(),
  meta_creative_id: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
})

export const BulkAdProgressResponseSchema = z.object({
  job_id: z.string(),
  status: z.string(),
  progress: z.number(),
  message: z.string(),
  items: z.array(BulkAdItemProgressSchema),
  summary: z.object({
    total: z.number(),
    success: z.number(),
    error: z.number(),
    pending: z.number(),
  }),
})

export type AdsTreeAd = z.infer<typeof AdsTreeAdSchema>
export type AdsTreeAdset = z.infer<typeof AdsTreeAdsetSchema>
export type AdsTreeCampaign = z.infer<typeof AdsTreeCampaignSchema>
export type AdsTreeResponse = z.infer<typeof AdsTreeResponseSchema>
export type FlatAd = z.infer<typeof FlatAdSchema>
export type AdsSearchResponse = z.infer<typeof AdsSearchResponseSchema>
export type AdCreativeDetailResponse = z.infer<typeof AdCreativeDetailResponseSchema>
export type BulkAdItemConfig = z.infer<typeof BulkAdItemConfigSchema>
export type BulkAdConfig = z.infer<typeof BulkAdConfigSchema>
export type BulkAdItemProgress = z.infer<typeof BulkAdItemProgressSchema>
export type BulkAdProgressResponse = z.infer<typeof BulkAdProgressResponseSchema>

// ========== Campaign Bulk (Duplicar Campanha) ==========

export const CampaignAdsetConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string().nullable().optional(),
  targeting: z.record(z.any()).nullable().optional(),
  optimization_goal: z.string().nullable().optional(),
  billing_event: z.string().nullable().optional(),
  bid_amount: z.number().nullable().optional(),
  daily_budget: z.number().nullable().optional(),
  lifetime_budget: z.number().nullable().optional(),
  promoted_object: z.record(z.any()).nullable().optional(),
  attribution_spec: z.array(z.any()).nullable().optional(),
  destination_type: z.string().nullable().optional(),
  pacing_type: z.array(z.string()).nullable().optional(),
})

export const CampaignTemplateResponseSchema = z.object({
  campaign_id: z.string(),
  campaign_name: z.string(),
  campaign_objective: z.string().nullable().optional(),
  campaign_bid_strategy: z.string().nullable().optional(),
  campaign_daily_budget: z.number().nullable().optional(),
  campaign_lifetime_budget: z.number().nullable().optional(),
  campaign_budget_optimization: z.boolean().nullable().optional(),
  adsets: z.array(CampaignAdsetConfigSchema),
  ad_id: z.string(),
  ad_name: z.string(),
})

export const CampaignBulkItemConfigSchema = z.object({
  ad_name: z.string().min(1),
  campaign_name: z.string().optional(),        // override por item: nome final renderizado
  adset_name_template: z.string().optional(),  // override por item: template parcial do conjunto
  slot_media: z.record(z.string(), z.number().int().min(0)),
}).refine(
  (v) => Object.keys(v.slot_media).length > 0,
  { message: "slot_media deve conter ao menos um slot" }
)

export const CampaignBulkConfigSchema = z.object({
  template_ad_id: z.string(),
  account_id: z.string(),
  status: z.enum(["ACTIVE", "PAUSED"]),
  adset_ids: z.array(z.string()).min(1),
  campaign_name_template: z.string(),
  adset_name_template: z.string(),
  campaign_budget_override: z.number().int().optional(),
  items: z.array(CampaignBulkItemConfigSchema).min(1).max(100),
})

export const CampaignBulkItemProgressSchema = z.object({
  id: z.string(),
  ad_name: z.string(),
  slot_media: z.record(z.string(), z.number()).nullable().optional(),
  campaign_name_template: z.string().nullable().optional(),
  adset_name_template: z.string().nullable().optional(),
  status: z.string(),
  meta_creative_id: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
})

export const CampaignBulkProgressResponseSchema = z.object({
  job_id: z.string(),
  status: z.string(),
  progress: z.number(),
  message: z.string(),
  items: z.array(CampaignBulkItemProgressSchema),
  summary: z.object({
    total: z.number(),
    success: z.number(),
    error: z.number(),
    pending: z.number(),
  }),
})

export type CampaignAdsetConfig = z.infer<typeof CampaignAdsetConfigSchema>
export type CampaignTemplateResponse = z.infer<typeof CampaignTemplateResponseSchema>
export type CampaignBulkItemConfig = z.infer<typeof CampaignBulkItemConfigSchema>
export type CampaignBulkConfig = z.infer<typeof CampaignBulkConfigSchema>
export type CampaignBulkItemProgress = z.infer<typeof CampaignBulkItemProgressSchema>
export type CampaignBulkProgressResponse = z.infer<typeof CampaignBulkProgressResponseSchema>

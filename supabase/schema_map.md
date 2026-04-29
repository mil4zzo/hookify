# Schema Map — Hookify

Mapa compacto do schema do banco. **Fonte da verdade: `schema.sql`** (gerado via pg_dump).  
Este arquivo é gerado automaticamente por `supabase/generate_schema_map.py` — não edite manualmente.

**Quando usar este arquivo:** para saber quais colunas e tipos existem em cada tabela.  
**Quando usar `schema.sql`:** para detalhes de constraints, índices, RLS policies, funções/RPCs, triggers.

---

## Tabelas

### ad_accounts
Contas de anúncios do Meta vinculadas a um usuário.

| Coluna | Tipo | Flags |
|--------|------|-------|
| id | text | NOT NULL |
| user_id | uuid | NOT NULL |
| name | text |  |
| account_status | integer |  |
| user_tasks | text[] |  |
| business_id | text |  |
| business_name | text |  |
| instagram_accounts | jsonb |  |
| created_at | timestamp | DEFAULT |
| updated_at | timestamp | DEFAULT |
| connection_id | uuid |  |

---

### ad_metric_pack_map
Mapa de relacionamento entre métricas de anúncios e packs (tabela de junção).

| Coluna | Tipo | Flags |
|--------|------|-------|
| user_id | uuid | NOT NULL |
| pack_id | uuid | NOT NULL |
| ad_id | text | NOT NULL |
| metric_date | date | NOT NULL |
| created_at | timestamp | NOT NULL, DEFAULT |

---

### ad_metrics
Métricas diárias de performance de cada anúncio, importadas da Meta API.

| Coluna | Tipo | Flags |
|--------|------|-------|
| user_id | uuid | NOT NULL |
| ad_id | text | NOT NULL |
| account_id | text |  |
| campaign_id | text |  |
| campaign_name | text |  |
| adset_id | text |  |
| adset_name | text |  |
| ad_name | text |  |
| date | date | NOT NULL |
| clicks | integer |  |
| impressions | integer |  |
| inline_link_clicks | integer |  |
| reach | integer |  |
| video_total_plays | integer |  |
| video_total_thruplays | integer |  |
| video_watched_p50 | integer |  |
| spend | numeric |  |
| cpm | numeric |  |
| ctr | numeric |  |
| frequency | numeric |  |
| website_ctr | numeric |  |
| actions | jsonb |  |
| conversions | jsonb |  |
| cost_per_conversion | jsonb |  |
| video_play_curve_actions | jsonb |  |
| connect_rate | numeric |  |
| profile_ctr | numeric |  |
| raw_data | jsonb |  |
| created_at | timestamp | DEFAULT |
| updated_at | timestamp | DEFAULT |
| id | text | NOT NULL |
| hold_rate | numeric |  |
| leadscore_values | numeric[] |  |
| lpv | integer | NOT NULL, DEFAULT |
| hook_rate | numeric |  |
| scroll_stop_rate | numeric |  |

---

### ad_sheet_integrations
Integrações com Google Sheets para importar leadscores via planilha.

| Coluna | Tipo | Flags |
|--------|------|-------|
| id | uuid | NOT NULL, DEFAULT |
| owner_id | uuid | NOT NULL |
| spreadsheet_id | text | NOT NULL |
| worksheet_title | text | NOT NULL |
| match_strategy | text | NOT NULL, DEFAULT |
| ad_id_column | text | NOT NULL |
| date_column | text | NOT NULL |
| leadscore_column | text |  |
| last_synced_at | timestamp |  |
| last_sync_status | text |  |
| created_at | timestamp | DEFAULT |
| updated_at | timestamp | DEFAULT |
| date_format | text |  |
| pack_id | uuid |  |
| connection_id | uuid |  |
| last_successful_sync_at | timestamp |  |
| ad_id_column_index | integer |  |
| date_column_index | integer |  |
| leadscore_column_index | integer |  |
| spreadsheet_name | text |  |

---

### ad_transcriptions
Transcrições de áudio/vídeo dos criativos de anúncios via AssemblyAI.

| Coluna | Tipo | Flags |
|--------|------|-------|
| id | uuid | NOT NULL, DEFAULT |
| user_id | uuid | NOT NULL |
| ad_name | text | NOT NULL |
| status | text | NOT NULL, DEFAULT |
| full_text | text |  |
| timestamped_text | jsonb |  |
| metadata | jsonb |  |
| created_at | timestamp | DEFAULT |
| updated_at | timestamp | DEFAULT |
| ad_ids | text[] | DEFAULT |

---

### ads
Anúncios importados da Meta API com metadados do criativo.

| Coluna | Tipo | Flags |
|--------|------|-------|
| ad_id | text | NOT NULL |
| user_id | uuid | NOT NULL |
| account_id | text |  |
| campaign_id | text |  |
| campaign_name | text |  |
| adset_id | text |  |
| adset_name | text |  |
| ad_name | text |  |
| effective_status | text |  |
| creative | jsonb |  |
| creative_video_id | text |  |
| thumbnail_url | text |  |
| instagram_permalink_url | text |  |
| created_at | timestamp | DEFAULT |
| updated_at | timestamp | DEFAULT |
| pack_ids | uuid[] | DEFAULT |
| adcreatives_videos_ids | jsonb |  |
| adcreatives_videos_thumbs | jsonb |  |
| leadscore | numeric |  |
| thumb_storage_path | text |  |
| thumb_cached_at | timestamp |  |
| thumb_source_url | text |  |
| transcription_id | uuid |  |
| video_owner_page_id | text |  |
| primary_video_id | text |  |
| media_type | text | NOT NULL, DEFAULT |

---

### bulk_ad_items
Itens individuais de um job de criação em lote de anúncios no Meta.

| Coluna | Tipo | Flags |
|--------|------|-------|
| id | uuid | NOT NULL, DEFAULT |
| job_id | text | NOT NULL |
| user_id | uuid | NOT NULL |
| file_name | text | NOT NULL |
| file_index | integer | NOT NULL |
| adset_id | text | NOT NULL |
| adset_name | text |  |
| ad_name | text | NOT NULL |
| status | text | NOT NULL, DEFAULT |
| meta_ad_id | text |  |
| meta_creative_id | text |  |
| error_message | text |  |
| error_code | text |  |
| created_at | timestamp | DEFAULT |
| updated_at | timestamp | DEFAULT |
| bundle_id | text |  |
| bundle_name | text |  |
| slot_files | jsonb |  |
| is_multi_slot | boolean | NOT NULL, DEFAULT |
| campaign_name | text |  |
| slot_media | jsonb |  |
| error_details | jsonb |  |

---

### facebook_connections
Conexões OAuth do Facebook vinculadas a usuários.

| Coluna | Tipo | Flags |
|--------|------|-------|
| id | uuid | NOT NULL, DEFAULT |
| user_id | uuid | NOT NULL |
| facebook_user_id | text | NOT NULL |
| facebook_name | text |  |
| facebook_email | text |  |
| access_token | text | NOT NULL |
| refresh_token | text |  |
| expires_at | timestamp |  |
| scopes | text[] |  |
| is_primary | boolean | DEFAULT |
| created_at | timestamp | DEFAULT |
| updated_at | timestamp | DEFAULT |
| facebook_picture_url | text |  |
| status | text | DEFAULT |
| picture_storage_path | text |  |
| picture_cached_at | timestamp |  |
| picture_source_url | text |  |

---

### google_accounts
Contas Google OAuth vinculadas a usuários (para acesso ao Sheets).

| Coluna | Tipo | Flags |
|--------|------|-------|
| id | uuid | NOT NULL, DEFAULT |
| user_id | uuid | NOT NULL |
| access_token | text | NOT NULL |
| refresh_token | text |  |
| expires_at | timestamp |  |
| scopes | text[] |  |
| created_at | timestamp | DEFAULT |
| updated_at | timestamp | DEFAULT |
| google_user_id | text |  |
| google_email | text |  |
| google_name | text |  |
| is_primary | boolean | DEFAULT |

---

### jobs
Jobs assíncronos de longa duração (ex: criação em lote de anúncios).

| Coluna | Tipo | Flags |
|--------|------|-------|
| id | text | NOT NULL |
| user_id | uuid | NOT NULL |
| status | text | NOT NULL |
| progress | integer | DEFAULT |
| message | text |  |
| payload | jsonb |  |
| result_count | integer |  |
| created_at | timestamp | DEFAULT |
| updated_at | timestamp | DEFAULT |
| processing_owner | text |  |
| processing_claimed_at | timestamp |  |
| processing_lease_until | timestamp |  |
| processing_attempts | integer | NOT NULL, DEFAULT |

**Status válidos:** `pending`, `running`, `processing`, `persisting`, `meta_running`, `meta_completed`, `completed`, `failed`, `error`, `cancelled`

---

### meta_api_usage

| Coluna | Tipo | Flags |
|--------|------|-------|
| id | uuid | NOT NULL, DEFAULT |
| created_at | timestamp | NOT NULL, DEFAULT |
| user_id | uuid |  |
| route | text |  |
| service_name | text |  |
| ad_account_id | text |  |
| meta_endpoint | text |  |
| http_method | text |  |
| http_status | integer |  |
| response_ms | integer |  |
| call_count_pct | numeric |  |
| cputime_pct | numeric |  |
| total_time_pct | numeric |  |
| business_use_case_usage | jsonb |  |
| ad_account_usage | jsonb |  |
| page_route | text |  |
| regain_access_minutes | integer |  |

---

### packs
Agrupamentos de anúncios definidos pelo usuário para análise comparativa.

| Coluna | Tipo | Flags |
|--------|------|-------|
| id | uuid | NOT NULL, DEFAULT |
| user_id | uuid | NOT NULL |
| adaccount_id | text |  |
| name | text | NOT NULL |
| date_start | date | NOT NULL |
| date_stop | date | NOT NULL |
| level | text | NOT NULL |
| filters | jsonb | NOT NULL, DEFAULT |
| stats | jsonb |  |
| created_at | timestamp | DEFAULT |
| updated_at | timestamp | DEFAULT |
| auto_refresh | boolean | NOT NULL, DEFAULT |
| last_refreshed_at | date |  |
| refresh_status | text | DEFAULT |
| last_prompted_at | date |  |
| refresh_lock_until | timestamp |  |
| refresh_progress_json | jsonb |  |
| ad_ids | text[] | DEFAULT |
| sheet_integration_id | uuid |  |

---

### subscriptions

| Coluna | Tipo | Flags |
|--------|------|-------|
| id | uuid | NOT NULL, DEFAULT |
| user_id | uuid | NOT NULL |
| tier | text | NOT NULL, DEFAULT |
| source | text | DEFAULT |
| plan_id | text |  |
| granted_by | uuid |  |
| starts_at | timestamp | NOT NULL, DEFAULT |
| expires_at | timestamp |  |
| created_at | timestamp | NOT NULL, DEFAULT |
| updated_at | timestamp | NOT NULL, DEFAULT |

---

### user_preferences
Preferências e configurações personalizadas por usuário.

| Coluna | Tipo | Flags |
|--------|------|-------|
| user_id | uuid | NOT NULL |
| locale | text |  |
| timezone | text |  |
| currency | text |  |
| theme | text |  |
| default_adaccount_id | text | DEFAULT |
| created_at | timestamp | DEFAULT |
| updated_at | timestamp | DEFAULT |
| validation_criteria | jsonb | DEFAULT |
| mql_leadscore_min | numeric | DEFAULT |
| has_completed_onboarding | boolean | DEFAULT |
| niche | text |  |

---

*Gerado em: 2026-04-29 — via `supabase/generate_schema_map.py`*

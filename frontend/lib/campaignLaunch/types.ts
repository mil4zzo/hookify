// Duplicação de campanha com criativos novos — contrato com /campaign-launch
// (backend/app/routes/campaign_launch.py). Ver documentation/plano-duplicacao-de-campanha.md.
import type { AdCreativeDetailResponse } from "@/lib/api/schemas"

export type MediaSlot = AdCreativeDetailResponse["media_slots"][number]

export interface LaunchTemplateAdset {
  id: string
  name: string
  status?: string | null
  end_time?: string | null
  schedule_expired: boolean
  needs_end_date: boolean
  daily_budget: number | null
  lifetime_budget: number | null
  has_ads_transparency: boolean
  blocked_reason: string | null
  is_template_adset: boolean
}

export interface LaunchBudgetModel {
  level: "campaign" | "adset" | null
  field: "daily_budget" | "lifetime_budget" | null
  amount: number | null
}

export interface LaunchTemplate {
  ad_id: string
  ad_name: string
  account_id: string
  currency: string | null
  campaign: { id: string; name: string; objective?: string | null; status?: string | null; bid_strategy?: string | null }
  budget: LaunchBudgetModel
  adsets: LaunchTemplateAdset[]
  creative: AdCreativeDetailResponse
  requires_ads_transparency: boolean
  blocking_reasons: string[]
  warnings: string[]
}

export type LibraryMediaStatus = "uploading" | "processing" | "ready" | "error"

export interface LibraryMedia {
  id: string
  source: "upload" | "drive"
  file_name: string
  media_type: "image" | "video"
  size_bytes: number | null
  width: number | null
  height: number | null
  duration_ms: number | null
  status: LibraryMediaStatus
  bytes_sent: number
  error_message: string | null
  start_offset: number | null
  end_offset: number | null
}

export interface DriveFile {
  id: string
  name: string
  mime_type: string
  media_type: "image" | "video"
  size_bytes: number
  md5: string | null
  width: number | null
  height: number | null
  duration_ms: number | null
  thumbnail_url: string | null
  group: string | null
}

export interface LaunchItemProgress {
  id: string
  position: number
  ad_name: string
  campaign_name: string
  media: Record<string, string>
  status: "pending" | "running" | "success" | "error"
  step: string | null
  meta_campaign_id: string | null
  adsets: { source_adset_id: string; source_adset_name: string; adset_id: string | null; ad_id: string | null }[]
  error_message: string | null
  error_code: string | null
  error_category: "retryable" | "template_replaceable" | "auth" | "fatal" | null
}

export interface LaunchProgress {
  job_id: string
  status: "processing" | "completed" | "failed" | "cancelled" | string
  progress: number
  message: string
  created_at: string | null
  account_id: string | null
  launch_status: "ACTIVE" | "PAUSED"
  template: { ad_id: string; ad_name: string | null; campaign_name: string | null }
  summary: { total: number; success: number; error: number; pending: number }
  items: LaunchItemProgress[]
}

export interface LaunchRequest {
  template_ad_id: string
  adset_ids: string[]
  status: "ACTIVE" | "PAUSED"
  adset_name_template: string
  budget_amount: number | null
  end_date: string | null // yyyy-MM-dd
  items: { ad_name: string; campaign_name: string; media: Record<string, string> }[]
}

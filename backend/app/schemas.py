from pydantic import BaseModel, field_validator, model_validator
from typing import Dict, List, Union, Optional, Literal

class Filter(BaseModel):
    field: str
    operator: str
    value: str

# Schema compatível com o frontend
class AdsRequestFrontend(BaseModel):
    adaccount_id: str
    date_start: str
    date_stop: str
    level: str = "ad"
    filters: List[Filter] = []
    name: Optional[str] = None  # Nome do pack
    auto_refresh: Optional[bool] = False  # Preferência de auto-refresh

    # Dia lógico do usuário (YYYY-MM-DD) para carimbar last_refreshed_at na criação
    today_local: Optional[str] = None

class RefreshPackRequest(BaseModel):
    # Dia lógico do usuário (YYYY-MM-DD) que deve ser usado como until do range
    until_date: str
    # Tipo de atualização: 'since_last_refresh' (desde última atualização) ou 'full_period' (todo o período)
    refresh_type: str = "since_last_refresh"
    # Se True, pula o sync automático de Google Sheets (frontend controla independentemente)
    skip_sheets_sync: bool = False

class UpdateStatusRequest(BaseModel):
    """
    Request padrão para atualizar status de entidades do Meta (ad, adset, campaign).

    - PAUSED: pausa a entidade
    - ACTIVE: ativa a entidade
    """
    status: Literal["PAUSED", "ACTIVE"]


class BulkAdItem(BaseModel):
    file_index: Optional[int] = None
    bundle_id: Optional[str] = None
    bundle_name: Optional[str] = None
    slot_files: Optional[Dict[str, int]] = None
    adset_id: str
    adset_name: Optional[str] = None
    ad_name: str

    @field_validator("file_index")
    @classmethod
    def validate_file_index(cls, value: Optional[int]) -> Optional[int]:
        if value is not None and value < 0:
            raise ValueError("file_index must be >= 0")
        return value

    @field_validator("slot_files")
    @classmethod
    def validate_slot_files(cls, value: Optional[Dict[str, int]]) -> Optional[Dict[str, int]]:
        if value is None:
            return value
        if not value:
            raise ValueError("slot_files must not be empty")
        normalized: Dict[str, int] = {}
        for key, file_index in value.items():
            slot_key = str(key or "").strip()
            if not slot_key:
                raise ValueError("slot_files keys must be non-empty")
            if file_index < 0:
                raise ValueError("slot_files values must be >= 0")
            normalized[slot_key] = file_index
        return normalized

    @field_validator("ad_name")
    @classmethod
    def validate_ad_name(cls, value: str) -> str:
        normalized = str(value or "").strip()
        if not normalized:
            raise ValueError("ad_name must not be empty")
        return normalized

    @field_validator("bundle_id")
    @classmethod
    def validate_bundle_id(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = str(value or "").strip()
        if not normalized:
            raise ValueError("bundle_id must not be empty")
        return normalized

    @field_validator("bundle_name")
    @classmethod
    def validate_bundle_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = str(value or "").strip()
        if not normalized:
            raise ValueError("bundle_name must not be empty")
        return normalized

    @field_validator("adset_id")
    @classmethod
    def validate_adset_id(cls, value: str) -> str:
        normalized = str(value or "").strip()
        if not normalized:
            raise ValueError("adset_id must not be empty")
        return normalized

    @model_validator(mode="after")
    def validate_item_shape(self):
        if self.file_index is None and not self.slot_files:
            raise ValueError("either file_index or slot_files must be provided")
        if self.file_index is not None and self.slot_files:
            raise ValueError("file_index and slot_files are mutually exclusive")
        if self.slot_files and not self.bundle_id:
            raise ValueError("bundle_id is required when slot_files is provided")
        if self.slot_files and not self.bundle_name:
            self.bundle_name = self.bundle_id
        return self


class BulkAdConfig(BaseModel):
    template_ad_id: str
    account_id: str
    status: Literal["ACTIVE", "PAUSED"]
    bundle_strategy: Optional[Literal["legacy_single_file", "explicit_bundles"]] = None
    items: List[BulkAdItem]

    @field_validator("items")
    @classmethod
    def validate_items(cls, value: List[BulkAdItem]) -> List[BulkAdItem]:
        if not value:
            raise ValueError("items must not be empty")
        if len(value) > 500:
            raise ValueError("items must contain at most 500 combinations")
        return value


class CampaignBulkItem(BaseModel):
    ad_name: str
    feed_file_index: Optional[int] = None
    story_file_index: Optional[int] = None

    @field_validator("ad_name")
    @classmethod
    def validate_ad_name(cls, value: str) -> str:
        normalized = str(value or "").strip()
        if not normalized:
            raise ValueError("ad_name must not be empty")
        return normalized

    @model_validator(mode="after")
    def validate_has_at_least_one_slot(self):
        if self.feed_file_index is None and self.story_file_index is None:
            raise ValueError("at least one of feed_file_index or story_file_index must be provided")
        if self.feed_file_index is not None and self.feed_file_index < 0:
            raise ValueError("feed_file_index must be >= 0")
        if self.story_file_index is not None and self.story_file_index < 0:
            raise ValueError("story_file_index must be >= 0")
        return self


class CampaignBulkConfig(BaseModel):
    template_ad_id: str
    account_id: str
    status: Literal["ACTIVE", "PAUSED"]
    adset_ids: List[str]
    campaign_name_template: str
    adset_name_template: str
    campaign_budget_override: Optional[int] = None  # em centavos
    items: List[CampaignBulkItem]

    @field_validator("items")
    @classmethod
    def validate_items(cls, value: List[CampaignBulkItem]) -> List[CampaignBulkItem]:
        if not value:
            raise ValueError("items must not be empty")
        if len(value) > 100:
            raise ValueError("items must contain at most 100 campaigns")
        return value

    @field_validator("adset_ids")
    @classmethod
    def validate_adset_ids(cls, value: List[str]) -> List[str]:
        if not value:
            raise ValueError("adset_ids must not be empty")
        return value


class CampaignAdsetConfig(BaseModel):
    id: str
    name: str
    status: Optional[str] = None
    targeting: Optional[Dict] = None
    optimization_goal: Optional[str] = None
    billing_event: Optional[str] = None
    bid_amount: Optional[int] = None
    daily_budget: Optional[int] = None
    lifetime_budget: Optional[int] = None
    promoted_object: Optional[Dict] = None
    attribution_spec: Optional[List] = None
    destination_type: Optional[str] = None
    pacing_type: Optional[List] = None


class CampaignTemplateResponse(BaseModel):
    campaign_id: str
    campaign_name: str
    campaign_objective: Optional[str] = None
    campaign_bid_strategy: Optional[str] = None
    campaign_daily_budget: Optional[int] = None
    campaign_lifetime_budget: Optional[int] = None
    campaign_budget_optimization: Optional[bool] = None
    adsets: List[CampaignAdsetConfig]
    ad_id: str
    ad_name: str


class BulkAdRetryRequest(BaseModel):
    job_id: str
    item_ids: List[str]

    @field_validator("item_ids")
    @classmethod
    def validate_item_ids(cls, value: List[str]) -> List[str]:
        if not value:
            raise ValueError("item_ids must not be empty")
        return value

class VideoSourceRequest(BaseModel):
    video_id: Union[str, int]
    actor_id: str

class FacebookTokenRequest(BaseModel):
    code: str
    redirect_uri: str

class ErrorResponse(BaseModel):
    status: str
    message: str

class InitialSettingsRequest(BaseModel):
    language: str  # Ex: "pt-BR", "en-US", "es-ES"
    currency: str  # Ex: "BRL", "USD", "EUR"
    niche: Optional[str] = ""  # Texto livre para o nicho


# ===== Optional: Backend validation models (mirror of frontend FormattedAdSchema) ===== #
class ActionItem(BaseModel):
    action_type: str
    value: float

class CreativeModel(BaseModel):
    id: Optional[str] = None
    actor_id: Optional[str] = None
    object_type: Optional[str] = None
    status: Optional[str] = None
    thumbnail_url: Optional[str] = None
    effective_object_story_id: Optional[str] = None
    instagram_permalink_url: Optional[str] = None
    video_id: Optional[str] = None
    body: Optional[str] = None
    call_to_action_type: Optional[str] = None
    title: Optional[str] = None

class FormattedAdModel(BaseModel):
    # Identificadores
    account_id: str
    ad_id: str
    ad_name: str
    adset_id: str
    adset_name: str
    campaign_id: str
    campaign_name: str

    # Inteiros
    clicks: int
    impressions: int
    inline_link_clicks: int
    reach: int
    video_total_plays: int
    video_total_thruplays: int
    video_watched_p50: int

    # Floats
    spend: float
    cpm: float
    ctr: float
    frequency: float
    website_ctr: Optional[float] = None

    # Arrays
    actions: List[ActionItem]
    conversions: Optional[List[ActionItem]] = None
    cost_per_conversion: Optional[List[ActionItem]] = None
    video_play_curve_actions: List[int] = [0] * 22

    # Creative
    creative: CreativeModel

    # Videos associados
    adcreatives_videos_ids: Optional[List[str]] = None
    adcreatives_videos_thumbs: Optional[List[str]] = None

    # Derivadas
    connect_rate: Optional[float] = None
    profile_ctr: Optional[float] = None

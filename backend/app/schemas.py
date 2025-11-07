from pydantic import BaseModel
from typing import List, Union, Optional

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

class VideoSourceRequest(BaseModel):
    video_id: Union[str, int]
    actor_id: str

class FacebookTokenRequest(BaseModel):
    code: str
    redirect_uri: str

class ErrorResponse(BaseModel):
    status: str
    message: str


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

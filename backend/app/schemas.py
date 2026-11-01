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
    # Tipo de atualização: 'since_last_refresh' (desde última atualização),
    # 'full_period' (todo o período) ou 'window_edit' (edição do período do pack:
    # busca a fatia que o período novo pede e, no fim, troca as datas do pack).
    refresh_type: str = "since_last_refresh"
    # Só em 'window_edit': o período novo do pack (YYYY-MM-DD).
    date_start: Optional[str] = None
    date_stop: Optional[str] = None
    # Se True, pula o sync automático de Google Sheets (frontend controla independentemente)
    skip_sheets_sync: bool = False
    # Cadeia server-side (REFRESH_SERVER_CHAIN_ENABLED): pede que o BACKEND
    # dispare o sync do Leadscore após o Meta concluir. Independente de
    # skip_sheets_sync (que aciona o legado paralelo, morto em produção).
    chain_sheets_after_meta: bool = False
    sheet_integration_id: Optional[str] = None

class UpdateStatusRequest(BaseModel):
    """
    Request padrão para atualizar status de entidades do Meta (ad, adset, campaign).

    - PAUSED: pausa a entidade
    - ACTIVE: ativa a entidade
    """
    status: Literal["PAUSED", "ACTIVE"]
    # Contexto de pack (P3.3b-resto). NAO e escopo e nao autoriza sozinho: o
    # backend so o usa para PROPOR candidatos, e exige papel dono|editor no pack
    # MAIS a entidade pertencer aquele pack no silo do dono. Ausente => caminho
    # legado (silo do ator).
    pack_ids: Optional[List[str]] = None


class UpdateBudgetRequest(BaseModel):
    """
    Request para atualizar o orçamento de uma campanha (CBO) ou adset (ABO).

    Valores são int em SUBUNIDADE da moeda da conta (R$ 150,00 → 15000). Exatamente UM
    dos campos deve vir preenchido — daily e lifetime são mutuamente exclusivos na Meta,
    e o v1 não troca o tipo vigente (isso exigiria end_time/adset_budgets).
    """
    daily_budget: Optional[int] = None
    lifetime_budget: Optional[int] = None
    # Contexto de pack (P3.3b-resto). NAO e escopo e nao autoriza sozinho: o
    # backend so o usa para PROPOR candidatos, e exige papel dono|editor no pack
    # MAIS a entidade pertencer aquele pack no silo do dono. Ausente => caminho
    # legado (silo do ator).
    pack_ids: Optional[List[str]] = None

    @model_validator(mode="after")
    def _exactly_one_positive(self):
        provided = [v for v in (self.daily_budget, self.lifetime_budget) if v is not None]
        if len(provided) != 1:
            raise ValueError("informe exatamente um de daily_budget ou lifetime_budget")
        if provided[0] <= 0:
            raise ValueError("budget deve ser um inteiro positivo em subunidade da moeda")
        return self


class BatchStatusRequest(BaseModel):
    """Request para atualizar status de múltiplos anúncios em lote via Meta Batch API."""
    ad_ids: List[str]
    status: Literal["PAUSED", "ACTIVE"]
    # Contexto de pack (P3.3b-resto). NAO e escopo e nao autoriza sozinho: o
    # backend so o usa para PROPOR candidatos, e exige papel dono|editor no pack
    # MAIS a entidade pertencer aquele pack no silo do dono. Ausente => caminho
    # legado (silo do ator).
    pack_ids: Optional[List[str]] = None

    @field_validator("ad_ids")
    @classmethod
    def validate_ad_ids(cls, value: List[str]) -> List[str]:
        if not value:
            raise ValueError("ad_ids não pode ser vazio")
        if len(value) > 1000:
            raise ValueError("ad_ids deve conter no máximo 1000 ids por requisição")
        return [str(v).strip() for v in value if str(v).strip()]


class BatchEntityStatusRequest(BaseModel):
    """Request para atualizar status de múltiplos conjuntos/campanhas em lote via Meta Batch API."""
    ids: List[str]
    status: Literal["PAUSED", "ACTIVE"]
    # Contexto de pack (P3.3b-resto). NAO e escopo e nao autoriza sozinho: o
    # backend so o usa para PROPOR candidatos, e exige papel dono|editor no pack
    # MAIS a entidade pertencer aquele pack no silo do dono. Ausente => caminho
    # legado (silo do ator).
    pack_ids: Optional[List[str]] = None

    @field_validator("ids")
    @classmethod
    def validate_ids(cls, value: List[str]) -> List[str]:
        if not value:
            raise ValueError("ids não pode ser vazio")
        if len(value) > 1000:
            raise ValueError("ids deve conter no máximo 1000 ids por requisição")
        return [str(v).strip() for v in value if str(v).strip()]


class BatchBudgetRequest(BaseModel):
    """
    Ajuste de orçamento de vários conjuntos (ABO) ou campanhas (CBO) de uma vez.

    - percent: cada um sobe/desce `percent`% sobre o próprio valor VIGENTE (lido do Meta
      na hora). Vale para diário e total misturados.
    - delta:   soma `amount` (subunidade; negativo reduz) ao vigente de cada um.
    - fixed:   todos ficam com `amount` (subunidade).
    delta/fixed carregam dinheiro → exigem `budget_type`: quem tiver o outro tipo é pulado.
    """
    ids: List[str]
    mode: Literal["percent", "delta", "fixed"]
    percent: Optional[float] = None
    amount: Optional[int] = None
    budget_type: Optional[Literal["daily", "lifetime"]] = None
    # Contexto de pack (P3.3b-resto) — mesma semântica do UpdateBudgetRequest.
    pack_ids: Optional[List[str]] = None

    @field_validator("ids")
    @classmethod
    def validate_ids(cls, value: List[str]) -> List[str]:
        cleaned = [str(v).strip() for v in value if str(v).strip()]
        if not cleaned:
            raise ValueError("ids não pode ser vazio")
        # 3 viagens de Batch API por 50 ids; acima disso a requisição encosta no timeout do cliente.
        if len(cleaned) > 300:
            raise ValueError("ids deve conter no máximo 300 ids por requisição")
        return cleaned

    @model_validator(mode="after")
    def _validate_adjustment(self):
        if self.mode == "percent":
            if self.percent is None or self.percent == 0:
                raise ValueError("percent é obrigatório e diferente de zero")
            if self.percent <= -100:
                raise ValueError("percent deve ser maior que -100")
        else:
            if self.amount is None or self.budget_type is None:
                raise ValueError("amount e budget_type são obrigatórios em delta/fixed")
            if self.mode == "fixed" and self.amount <= 0:
                raise ValueError("amount deve ser positivo no valor fixo")
            if self.mode == "delta" and self.amount == 0:
                raise ValueError("amount deve ser diferente de zero")
        return self


class BatchBudgetItemResult(BaseModel):
    id: str
    # updated | unchanged | skipped | failed
    outcome: str
    # skipped: no_own_budget | type_mismatch · failed: read_failed | invalid_value | meta_error | unconfirmed | not_found
    reason: Optional[str] = None
    message: Optional[str] = None
    before_daily: Optional[int] = None
    before_lifetime: Optional[int] = None
    # Verdade RELIDA do Meta (null quando verified=False).
    daily_budget: Optional[int] = None
    lifetime_budget: Optional[int] = None
    verified: bool = True


class BatchBudgetResult(BaseModel):
    total: int
    items: List[BatchBudgetItemResult]


class BatchStatusResult(BaseModel):
    """Resultado da atualização de status em lote."""
    success: bool
    updated_ids: List[str]
    failed_ids: List[str]
    total: int
    # ad_id → motivo da pausa herdada ("adset" | "campaign"): ativados em lote que foram
    # bloqueados porque um pai está pausado (ativar o próprio ad não retomaria a entrega).
    blocked: Dict[str, str] = {}
    # ad_id → effective_status REAL relido do Meta após a escrita (verify). O frontend usa
    # isso para patchar o cache com a verdade em vez do status pedido (otimista).
    statuses: Dict[str, str] = {}


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
    # Default 0: registros antigos (pré-p75) podem não trazer o campo
    video_watched_p75: int = 0

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
    primary_video_id: Optional[str] = None
    media_type: Optional[str] = "unknown"
    adcreatives_videos_ids: Optional[List[str]] = None
    adcreatives_videos_thumbs: Optional[List[str]] = None

    # Data de criacao do ad no Meta (created_time do no Ad). Distinta de ads.created_at,
    # que e quando a linha entrou no nosso banco. Opcional: registros antigos nao tem.
    meta_created_time: Optional[str] = None

    # Derivadas
    connect_rate: Optional[float] = None
    profile_ctr: Optional[float] = None

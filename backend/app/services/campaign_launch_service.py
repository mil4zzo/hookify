"""Duplicação de campanha com criativos novos — job idempotente e retomável.

Um item = um criativo novo = uma campanha cópia da campanha do anúncio modelo,
com os conjuntos escolhidos copiados dentro e, em cada um, uma cópia do anúncio
modelo com a mídia trocada.

Cada id criado na Meta é gravado em `campaign_launch_items` NO MOMENTO em que a Meta
responde (checkpoint). Processar um item de novo — retomada após deploy, lease
expirado ou "tentar novamente" — pula o que já existe: a campanha nunca é copiada
duas vezes. Ver documentation/plano-duplicacao-de-campanha.md.

Ordem por item (tudo nasce PAUSADO; ativação no fim, de baixo para cima, para nada
veicular meio montado):
    mídias prontas → campanha (cópia + nome/orçamento) → para cada conjunto:
    conjunto (cópia + nome/agenda/orçamento) → anúncio (cópia do modelo com mídia
    nova; fallback criativo+anúncio manual) → ativação da campanha (se pedido)
"""
from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

from app.core.config import META_LAUNCH_GRAPH_BASE_URL
from app.core.supabase_client import get_supabase_service
from app.core.supabase_retry import with_postgrest_retry
from app.services import ad_media_library
from app.services.creative_media_swap import (
    BundleMediaRef,
    build_creative_create_params,
    build_creative_parameters,
)
from app.services.creative_template import CreativeTemplate
from app.services.graph_api import GraphAPI
from app.services.job_tracker import STATUS_COMPLETED, STATUS_PROCESSING, get_job_tracker
from app.services.meta_api_errors import (
    MetaAPIError,
    TokenExpiredError,
    derive_error_category,
    extract_data_or_raise,
)

logger = logging.getLogger(__name__)

ITEMS_TABLE = "campaign_launch_items"
JOB_TYPE = "campaign_launch"

AD_NAME_VAR = "{ad_name}"
INDEX_VAR = "{index}"
TEMPLATE_ADSET_NAME_VAR = "{template_adset_name}"

# Piso entre chamadas de escrita na Meta (backoff reativo de 429 vive no GraphAPI).
_META_WRITE_DELAY_SECONDS = 0.05
# POST /copies sem resposta: espera antes de procurar a cópia que a Meta pode ter criado.
_LOST_COPY_PROBE_DELAYS_SECONDS = (5, 20)
_LOST_COPY_WINDOW = timedelta(minutes=30)

# Subcode de "Transparência dos anúncios" ausente no conjunto (ver memória
# meta_adset_dsa_beneficiary_payor): marca a conta para a tela avisar antes.
_COMPLIANCE_SUBCODE = "3858495"
# /copies rejeita explore_home sem explore (meta_copies_stricter_than_create); na v26
# o "explore" não pode mais ser pedido, então o plano B cria o conjunto sem ele.
_EXPLORE_SUBCODE = "2490392"


class _Cancelled(Exception):
    pass


@dataclass
class LaunchContext:
    user_jwt: str
    user_id: str
    access_token: str
    job_id: str
    account_id: str


def interpolate_name(template: str, *, ad_name: str, index: int, template_adset_name: Optional[str] = None) -> str:
    result = str(template or "").replace(AD_NAME_VAR, ad_name).replace(INDEX_VAR, str(index))
    if template_adset_name is not None:
        result = result.replace(TEMPLATE_ADSET_NAME_VAR, template_adset_name)
    return result.strip()


def is_meta_datetime_in_past(raw: Any) -> bool:
    """True se raw (ISO ou epoch do Graph API) já passou em UTC."""
    dt = parse_meta_datetime(raw)
    return dt is not None and dt <= datetime.now(timezone.utc)


def parse_meta_datetime(raw: Any) -> Optional[datetime]:
    """ISO (offset com ou sem ':') ou epoch do Graph API → datetime em UTC; None se inválido."""
    if raw is None:
        return None
    try:
        if isinstance(raw, (int, float)):
            dt = datetime.fromtimestamp(float(raw), tz=timezone.utc)
        else:
            s = str(raw).strip()
            if not s:
                return None
            if s.isdigit():
                dt = datetime.fromtimestamp(int(s), tz=timezone.utc)
            else:
                # Graph API às vezes manda offset sem ':' (+0000)
                if len(s) >= 6 and s[-5] in "+-" and s[-4:].isdigit():
                    s = f"{s[:-5]}{s[-5]}{s[-4:-2]}:{s[-2:]}"
                dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, OSError, OverflowError):
        return None


def _copied_id(data: Dict[str, Any], *keys: str) -> Optional[str]:
    for key in keys:
        value = data.get(key)
        if value:
            return str(value)
    return None


# ── Repositório dos itens ────────────────────────────────────────────────────

def fetch_items(sb, job_id: str) -> List[Dict[str, Any]]:
    result = with_postgrest_retry(
        "campaign_launch_items.fetch",
        lambda: sb.table(ITEMS_TABLE).select("*").eq("job_id", job_id).order("position").execute(),
    )
    return result.data or []


def insert_items(sb, rows: List[Dict[str, Any]]) -> None:
    with_postgrest_retry(
        "campaign_launch_items.insert",
        lambda: sb.table(ITEMS_TABLE).insert(rows).execute(),
    )


def update_item(sb, item_id: str, patch: Dict[str, Any]) -> None:
    data = {**patch, "updated_at": datetime.now(timezone.utc).isoformat()}
    with_postgrest_retry(
        "campaign_launch_items.update",
        lambda: sb.table(ITEMS_TABLE).update(data).eq("id", item_id).execute(),
    )


def reset_failed_items(sb, job_id: str, item_ids: Optional[List[str]] = None) -> int:
    """'Tentar novamente': tudo que não terminou volta a pending, MANTENDO os checkpoints.
    Inclui pending/running: job que caiu inteiro (token expirado, erro fatal) os deixa assim."""
    items = [i for i in fetch_items(sb, job_id) if i.get("status") != "success"]
    if item_ids is not None:
        wanted = set(item_ids)
        items = [i for i in items if str(i["id"]) in wanted]
    for item in items:
        update_item(
            sb,
            str(item["id"]),
            {"status": "pending", "error_message": None, "error_code": None, "error_details": None},
        )
    return len(items)


def summarize(items: List[Dict[str, Any]]) -> Dict[str, int]:
    summary = {"total": len(items), "success": 0, "error": 0, "pending": 0}
    for item in items:
        status = item.get("status")
        if status == "success":
            summary["success"] += 1
        elif status == "error":
            summary["error"] += 1
        else:
            summary["pending"] += 1
    return summary


def public_item(item: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": item.get("id"),
        "position": item.get("position"),
        "ad_name": item.get("ad_name"),
        "campaign_name": item.get("campaign_name"),
        "media": item.get("media"),
        "status": item.get("status"),
        "step": item.get("step"),
        "meta_campaign_id": item.get("meta_campaign_id"),
        "adsets": [
            {
                "source_adset_id": a.get("source_adset_id"),
                "source_adset_name": a.get("source_adset_name"),
                "adset_id": a.get("adset_id"),
                "ad_id": a.get("ad_id"),
            }
            for a in (item.get("adsets") or [])
        ],
        "error_message": item.get("error_message"),
        "error_code": item.get("error_code"),
        "error_category": (
            derive_error_category(item.get("error_code")) if item.get("status") == "error" else None
        ),
    }


# ── Processador ──────────────────────────────────────────────────────────────

class CampaignLaunchProcessor:
    def __init__(self, context: LaunchContext, *, api: Optional[GraphAPI] = None, sb=None, tracker=None):
        self.context = context
        self.sb = sb or get_supabase_service()
        self.tracker = tracker or get_job_tracker(
            context.user_jwt,
            context.user_id,
            processing_owner=str(uuid.uuid4()),
            use_service_role=True,
        )
        self.api = api or GraphAPI(context.access_token, user_id=context.user_id, base_url=META_LAUNCH_GRAPH_BASE_URL)
        self._payload: Dict[str, Any] = {}
        self._template: Optional[CreativeTemplate] = None

    # API pública ----------------------------------------------------------

    def run(self) -> None:
        job_id = self.context.job_id
        if not self.tracker.try_claim_processing(job_id):
            logger.info("[CAMPAIGN_LAUNCH] claim_denied job_id=%s (outro worker está processando)", job_id)
            return
        t0 = time.monotonic()
        try:
            self._payload = self.tracker.get_payload(job_id) or {}
            self._template = CreativeTemplate.from_payload(self._payload.get("creative_template"))
            items = fetch_items(self.sb, job_id)
            total = len(items)
            for index, item in enumerate(items, start=1):
                if item.get("status") in ("success", "error"):
                    continue
                self._heartbeat(f"Criando campanha {index}/{total}...", index - 1, total)
                self._run_item(item, total=total)
            self._mark_completed()
            logger.info("[CAMPAIGN_LAUNCH] done job_id=%s duration_s=%.1f", job_id, time.monotonic() - t0)
        except _Cancelled:
            logger.info("[CAMPAIGN_LAUNCH] cancelled job_id=%s", job_id)
        except TokenExpiredError as exc:
            self.tracker.mark_failed(job_id, exc.message, error_code="token_expired")
        except Exception as exc:  # noqa: BLE001 — o job precisa terminar em estado final
            logger.exception("[CAMPAIGN_LAUNCH] fatal job_id=%s", job_id)
            self.tracker.mark_failed(job_id, str(exc), error_code="campaign_launch_failed")
        finally:
            self.tracker.release_processing_claim(job_id)

    # Item -----------------------------------------------------------------

    def _run_item(self, item: Dict[str, Any], *, total: int) -> None:
        item_id = str(item["id"])
        update_item(self.sb, item_id, {"status": "running"})
        try:
            self._process_item(item)
            update_item(self.sb, item_id, {"status": "success", "step": "done"})
        except (_Cancelled, TokenExpiredError):
            update_item(self.sb, item_id, {"status": "pending"})
            raise
        except MetaAPIError as exc:
            logger.warning(
                "[CAMPAIGN_LAUNCH] item_error job_id=%s item_id=%s code=%s msg=%s",
                self.context.job_id, item_id, exc.error_code, str(exc.message)[:500],
            )
            update_item(
                self.sb,
                item_id,
                {
                    "status": "error",
                    "error_message": exc.message[:2000],
                    "error_code": exc.error_code,
                    "error_details": exc.raw_error,
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("[CAMPAIGN_LAUNCH] item_unexpected job_id=%s item_id=%s", self.context.job_id, item_id)
            update_item(
                self.sb,
                item_id,
                {"status": "error", "error_message": str(exc)[:2000], "error_code": "unexpected_error"},
            )

    def _process_item(self, item: Dict[str, Any]) -> None:
        item_id = str(item["id"])
        position = int(item.get("position") or 0)
        ad_name = str(item["ad_name"])
        status = str(self._payload.get("status") or "PAUSED").upper()
        progress_args = (position, int(self._payload.get("total_items") or 1))

        # 1. Mídias prontas (vídeo processado e com capa própria)
        self._set_step(item_id, "media")
        media_map: Dict[str, str] = item.get("media") or {}
        rows = ad_media_library.wait_until_ready(
            self.sb,
            self.api,
            self.context.user_id,
            list(media_map.values()),
            heartbeat=lambda msg: self._heartbeat(msg, *progress_args),
        )
        bundle = BundleMediaRef(
            bundle_id=f"launch_{item_id[:8]}",
            slot_refs={
                slot_key: ad_media_library.media_ref_from_row(rows[media_id], index)
                for index, (slot_key, media_id) in enumerate(media_map.items())
            },
        )

        # 2. Campanha
        self._set_step(item_id, "campaign")
        campaign_id = item.get("meta_campaign_id")
        if not campaign_id:
            data = self._call(
                self._recovering_copy(
                    self.api.copy_campaign,
                    str(self._payload.get("template_campaign_name") or ""),
                    lambda: {str(i.get("meta_campaign_id")) for i in fetch_items(self.sb, self.context.job_id)},
                ),
                str(self._payload["template_campaign_id"]),
                {
                    "deep_copy": False,
                    "status_option": "PAUSED",
                    "rename_options": {"rename_strategy": "NO_RENAME"},
                },
            )
            campaign_id = _copied_id(data, "copied_campaign_id", "id")
            if not campaign_id:
                raise MetaAPIError(f"Cópia da campanha sem id: {json.dumps(data)[:300]}", "copy_response_missing_id")
            item["meta_campaign_id"] = campaign_id
            update_item(self.sb, item_id, {"meta_campaign_id": campaign_id})
        campaign_patch: Dict[str, Any] = {"name": item["campaign_name"]}
        campaign_patch.update(self._budget_patch("campaign"))
        self._call(self.api.update_campaign, campaign_id, campaign_patch)

        # 3. Conjuntos + anúncios
        adsets: List[Dict[str, Any]] = [dict(a) for a in (item.get("adsets") or [])]
        if not adsets:
            raise MetaAPIError("Nenhum conjunto selecionado para copiar.", "no_adsets_to_copy")
        for ordinal, entry in enumerate(adsets, start=1):
            self._heartbeat(f"{ad_name}: conjunto {ordinal}/{len(adsets)}...", *progress_args)
            self._set_step(item_id, f"adset:{ordinal}")
            if not entry.get("adset_id"):
                entry["adset_id"] = self._copy_adset(entry, campaign_id)
                update_item(self.sb, item_id, {"adsets": adsets})
            adset_patch: Dict[str, Any] = {
                "name": interpolate_name(
                    str(item.get("adset_name_template") or "{template_adset_name}"),
                    ad_name=ad_name,
                    index=ordinal,
                    template_adset_name=str(entry.get("source_adset_name") or ""),
                ),
            }
            end_override = self._payload.get("end_time_override")
            if is_meta_datetime_in_past(entry.get("source_end_time")):
                # Agenda do modelo já venceu: o conjunto copiado nasceria "concluído".
                # Sem data nova, roda sem fim; com data nova, só ela vale.
                adset_patch["start_time"] = ""
                adset_patch["end_time"] = end_override or ""
            elif end_override:
                adset_patch["end_time"] = end_override
            adset_patch.update(self._budget_patch("adset"))
            if status == "ACTIVE":
                adset_patch["status"] = "ACTIVE"
            self._call(self.api.update_adset, entry["adset_id"], adset_patch)

            self._set_step(item_id, f"ad:{ordinal}")
            if not entry.get("ad_id"):
                entry["ad_id"], entry["ad_path"] = self._create_ad(item, entry["adset_id"], bundle, status)
                update_item(self.sb, item_id, {"adsets": adsets})
            if entry.get("ad_path") == "copy":
                # Depois do checkpoint: renomear falhar não pode fazer o retry copiar o anúncio de novo.
                self._call(self.api.update_ad, entry["ad_id"], {"name": ad_name})

        # 4. Ativação (campanha por último: nada veicula meio montado)
        if status == "ACTIVE":
            self._set_step(item_id, "activate")
            self._call(self.api.update_campaign, campaign_id, {"status": "ACTIVE"})

    # Passos ---------------------------------------------------------------

    def _copy_adset(self, entry: Dict[str, Any], campaign_id: str) -> str:
        source_id = str(entry["source_adset_id"])
        params = {
            "campaign_id": campaign_id,
            "deep_copy": False,
            "status_option": "PAUSED",
            "rename_options": {"rename_strategy": "NO_RENAME"},
        }
        end_override = self._payload.get("end_time_override")
        if end_override:
            params["end_time"] = end_override  # /copies aceita end_time (SDK AdSet.create_copy)
        try:
            data = self._call(
                self._recovering_copy(
                    self.api.copy_adset,
                    str(entry.get("source_adset_name") or ""),
                    lambda: {str(a.get("adset_id")) for i in fetch_items(self.sb, self.context.job_id) for a in (i.get("adsets") or [])},
                ),
                source_id,
                params,
            )
        except MetaAPIError as exc:
            subcode = str(exc.subcode or "")
            if subcode == _COMPLIANCE_SUBCODE:
                self._flag_account_requires_transparency()
                raise MetaAPIError(
                    f"O conjunto '{entry.get('source_adset_name')}' não tem 'Transparência dos anúncios' "
                    "(beneficiário/pagador) preenchida, e esta conta exige. Preencha no conjunto modelo "
                    "pelo Gerenciador de Anúncios e tente de novo.",
                    "adset_missing_compliance",
                    subcode=exc.subcode,
                    raw_error=exc.raw_error,
                ) from exc
            blame = ((exc.raw_error or {}).get("error_data") or {}).get("blame_field_specs") or []
            explore = subcode == _EXPLORE_SUBCODE and any("instagram_positions" in (s or []) for s in blame)
            # v26, categorias especiais (habitação/emprego/financeiro): conjunto antigo sem o flag
            # explícito não é aceito; o plano B cria com o flag no valor que o modelo tinha.
            advantage = "advantage_audience" in json.dumps(exc.raw_error or {}).lower() or "advantage_audience" in str(exc.message).lower()
            if explore or advantage:
                data = self._create_adset_from_source(source_id, campaign_id)
            else:
                raise
        adset_id = _copied_id(data, "copied_adset_id", "id")
        if not adset_id:
            raise MetaAPIError(f"Cópia do conjunto sem id: {json.dumps(data)[:300]}", "adset_copy_missing_id")
        return adset_id

    _ADSET_FALLBACK_FIELDS = (
        "id,name,targeting,optimization_goal,billing_event,bid_amount,bid_strategy,"
        "daily_budget,lifetime_budget,promoted_object,attribution_spec,destination_type,"
        "frequency_control_specs,bid_constraints,pacing_type,start_time,end_time,"
        "dsa_beneficiary,dsa_payor,regional_regulated_categories,regional_regulation_identities"
    )
    _ADSET_PASSTHROUGH = (
        "optimization_goal", "billing_event", "bid_amount", "bid_strategy",
        "daily_budget", "lifetime_budget", "promoted_object", "attribution_spec",
        "destination_type", "frequency_control_specs", "bid_constraints",
        "pacing_type", "dsa_beneficiary", "dsa_payor",
        "regional_regulated_categories", "regional_regulation_identities",
    )

    def _create_adset_from_source(self, source_id: str, campaign_id: str) -> Dict[str, Any]:
        """Fallback do explore_home: cria o conjunto com o targeting normalizado.
        O conjunto modelo NUNCA é alterado — ele está rodando."""
        src = self._call(self.api.get_adset_fields, source_id, self._ADSET_FALLBACK_FIELDS)
        params: Dict[str, Any] = {
            "name": str(src.get("name") or f"adset-{source_id}"),
            "campaign_id": campaign_id,
            "status": "PAUSED",
        }
        for key in self._ADSET_PASSTHROUGH:
            if src.get(key) not in (None, "", []):
                params[key] = src[key]
        targeting = dict(src.get("targeting") or {})
        ig = list(targeting.get("instagram_positions") or [])
        if "explore" in ig:
            # v26 removeu o Feed do Explorar: pedir "explore" explicitamente dá erro.
            targeting["instagram_positions"] = [p for p in ig if p != "explore"]
        automation = dict(targeting.get("targeting_automation") or {})
        if "advantage_audience" not in automation:
            # Ausente no modelo = público não expandido; a v26 exige o valor explícito.
            automation["advantage_audience"] = 0
            targeting["targeting_automation"] = automation
        params["targeting"] = targeting
        if not is_meta_datetime_in_past(src.get("end_time")):
            for key in ("start_time", "end_time"):
                if src.get(key):
                    params[key] = src[key]
        if self._payload.get("end_time_override"):
            params["end_time"] = self._payload["end_time_override"]
        logger.info("[CAMPAIGN_LAUNCH] adset_fallback_create source=%s", source_id)
        return self._call(self.api.create_adset, f"act_{self.context.account_id}", params)

    def _create_ad(
        self,
        item: Dict[str, Any],
        adset_id: str,
        bundle: BundleMediaRef,
        status: str,
    ) -> tuple[str, str]:
        """Caminho principal: cópia do anúncio modelo trocando só a mídia.
        Fallback (validação mais estrita do /copies, erro 100): criativo + anúncio."""
        template = self._require_template()
        template_ad_id = str(self._payload["template_ad_id"])
        ad_name = str(item["ad_name"])
        item_view = {"ad_name": ad_name}
        try:
            data = self._call(
                self._recovering_copy(
                    self.api.copy_ad,
                    str(self._payload.get("template_ad_name") or ""),
                    lambda: {str(a.get("ad_id")) for i in fetch_items(self.sb, self.context.job_id) for a in (i.get("adsets") or [])},
                ),
                template_ad_id,
                {
                    "adset_id": adset_id,
                    "status_option": status,
                    "rename_options": {"rename_strategy": "NO_RENAME"},
                    "creative_parameters": build_creative_parameters(
                        item_view, template, bundle, template_creative=self._payload.get("template_creative") or {},
                    ),
                },
            )
            ad_id = _copied_id(data, "copied_ad_id", "id")
            if not ad_id:
                raise MetaAPIError(f"Cópia do anúncio sem id: {json.dumps(data)[:300]}", "ad_copy_missing_id")
            return ad_id, "copy"
        except MetaAPIError as exc:
            if exc.category in ("retryable", "auth") or str(exc.error_code) != "100":
                raise
            logger.info(
                "[CAMPAIGN_LAUNCH] ad_copy_fallback job_id=%s item_id=%s subcode=%s msg=%s",
                self.context.job_id, item.get("id"), exc.subcode, str(exc.message)[:300],
            )

        act_id = f"act_{self.context.account_id}"
        creative_id = item.get("meta_creative_id")
        if not creative_id:
            creative_params = build_creative_create_params(
                item_view,
                template,
                bundle,
                template_creative=self._payload.get("template_creative") or {},
            )
            creative = self._call(self.api.create_ad_creative, act_id, creative_params)
            creative_id = creative.get("id")
            if not creative_id:
                raise MetaAPIError("Meta não retornou creative_id", "creative_missing_id")
            item["meta_creative_id"] = str(creative_id)
            update_item(self.sb, str(item["id"]), {"meta_creative_id": str(creative_id)})

        ad_params: Dict[str, Any] = {
            "name": ad_name,
            "adset_id": adset_id,
            "creative": {"creative_id": str(creative_id)},
            "status": status,
        }
        template_ad = self._payload.get("template_ad_fields") or {}
        for key in ("tracking_specs", "conversion_domain"):
            if template_ad.get(key):
                ad_params[key] = template_ad[key]
        ad = self._call(self.api.create_ad, act_id, ad_params)
        ad_id = ad.get("id")
        if not ad_id:
            raise MetaAPIError("Meta não retornou ad_id", "ad_missing_id")
        return str(ad_id), "create"

    # Auxiliares -----------------------------------------------------------

    def _budget_patch(self, level: str) -> Dict[str, Any]:
        """Orçamento sobrescrito pelo usuário, no nível em que o modelo tem orçamento
        (CBO → campanha, ABO → cada conjunto) e no mesmo tipo (diário/total)."""
        override = self._payload.get("budget_override") or {}
        if override.get("level") != level or not override.get("field") or not override.get("amount"):
            return {}
        return {str(override["field"]): int(override["amount"])}

    def _flag_account_requires_transparency(self) -> None:
        try:
            with_postgrest_retry(
                "ad_accounts.requires_ads_transparency",
                lambda: self.sb.table("ad_accounts")
                .update({"requires_ads_transparency": True})
                .eq("user_id", self.context.user_id)
                .in_("id", [self.context.account_id, f"act_{self.context.account_id}"])
                .execute(),
            )
        except Exception:  # noqa: BLE001 — a flag é aviso, não pode esconder o erro real
            logger.warning("[CAMPAIGN_LAUNCH] flag_transparency_failed account=%s", self.context.account_id, exc_info=True)

    def _require_template(self) -> CreativeTemplate:
        if self._template is None or not self._template.media_slots:
            raise MetaAPIError("Modelo de criativo ausente no job. Inicie de novo.", "missing_creative_template")
        return self._template

    def _recovering_copy(
        self,
        copy_fn: Callable[..., Dict[str, Any]],
        source_name: str,
        taken_ids: Callable[[], set],
    ) -> Callable[..., Dict[str, Any]]:
        """Embrulha um POST /copies: se a Meta não respondeu (timeout, queda de conexão), a cópia
        pode ter sido criada mesmo assim. Antes de dar erro (e o retry copiar de novo), procura em
        GET /{modelo}/copies uma cópia recente com o nome do modelo (NO_RENAME) que nenhum item
        deste job já usa, e a adota."""

        def call(source_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
            result = copy_fn(source_id, params)
            if result.get("status") != "error" or not source_name:
                return result
            for delay in _LOST_COPY_PROBE_DELAYS_SECONDS:
                time.sleep(delay)
                found = self._find_lost_copy(source_id, source_name, taken_ids())
                if found:
                    logger.info("[CAMPAIGN_LAUNCH] lost_copy_adopted job_id=%s source=%s copy=%s", self.context.job_id, source_id, found)
                    return {"status": "success", "data": {"id": found}}
            return result

        return call

    def _find_lost_copy(self, source_id: str, source_name: str, taken: set) -> Optional[str]:
        result = self.api.get_copies(source_id)
        if result.get("status") != "success":
            return None
        cutoff = datetime.now(timezone.utc) - _LOST_COPY_WINDOW
        candidates = []
        for row in (result.get("data") or {}).get("data") or []:
            created = parse_meta_datetime(row.get("created_time"))
            if str(row.get("id")) not in taken and row.get("name") == source_name and created and created >= cutoff:
                candidates.append((created, str(row["id"])))
        return max(candidates)[1] if candidates else None

    def _call(self, fn: Callable[..., Dict[str, Any]], *args: Any) -> Dict[str, Any]:
        result = fn(*args)
        data = extract_data_or_raise(result, log_context=f"[CAMPAIGN_LAUNCH] job={self.context.job_id}")
        time.sleep(_META_WRITE_DELAY_SECONDS)
        return data

    def _set_step(self, item_id: str, step: str) -> None:
        update_item(self.sb, item_id, {"step": step})

    def _heartbeat(self, message: str, done: int, total: int) -> None:
        progress = int(min(99, max(1, (done / max(total, 1)) * 100)))
        if self.tracker.heartbeat(self.context.job_id, status=STATUS_PROCESSING, progress=progress, message=message) is False:
            raise _Cancelled()

    def _mark_completed(self) -> None:
        items = fetch_items(self.sb, self.context.job_id)
        summary = summarize(items)
        self.tracker.heartbeat(
            self.context.job_id,
            status=STATUS_COMPLETED,
            progress=100,
            message=f"Concluído: {summary['success']} campanha(s) criada(s), {summary['error']} com erro",
            result_count=summary["success"],
            details={"summary": summary},
        )


def start_in_background(context: LaunchContext) -> None:
    """Dispara o processador numa thread. O lease no banco garante um dono só."""

    def _run() -> None:
        try:
            CampaignLaunchProcessor(context).run()
        except Exception:  # noqa: BLE001
            logger.exception("[CAMPAIGN_LAUNCH] bootstrap_failed job_id=%s", context.job_id)

    threading.Thread(target=_run, daemon=True, name=f"campaign-launch-{context.job_id[:8]}").start()

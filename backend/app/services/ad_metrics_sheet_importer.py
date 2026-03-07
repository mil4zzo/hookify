from __future__ import annotations

import logging
import re
from collections import defaultdict
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from app.core.supabase_client import get_supabase_for_user
from app.services.google_sheets_service import fetch_all_rows, GoogleSheetsError
from app.services.google_errors import (
    GOOGLE_TOKEN_EXPIRED,
    GOOGLE_SHEETS_ERROR,
)

logger = logging.getLogger(__name__)


class AdMetricsImportCancelled(Exception):
    """Exceção lançada quando a importação é cancelada pelo usuário."""
    pass


class AdMetricsImportError(Exception):
    """Erro de importação de métricas de anúncios."""
    def __init__(self, message: str, code: str | None = None):
        super().__init__(message)
        self.message = message
        self.code = code


def _parse_date(value: str, date_format: str | None = None) -> str | None:
    """
    Converte a data da planilha para YYYY-MM-DD usando o formato especificado pelo usuário.
    
    Args:
        value: String com a data (pode conter hora, ex: "DD/MM/YYYY HH:mm")
        date_format: Formato esperado ('DD/MM/YYYY' ou 'MM/DD/YYYY')
    
    Retorna:
        Data no formato YYYY-MM-DD ou None se não conseguir parsear
    """
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None

    # Limpar caracteres invisíveis e espaços extras
    text = ' '.join(text.split())  # Normaliza espaços múltiplos em um único espaço
    
    # Extrair parte da data (antes do espaço se houver hora)
    date_part = text.split()[0] if " " in text else text
    
    # Mapear formatos do usuário para strptime
    format_map = {
        'DD/MM/YYYY': '%d/%m/%Y',
        'MM/DD/YYYY': '%m/%d/%Y',
    }
    
    # Se formato foi especificado, usar diretamente (muito mais rápido!)
    if date_format and date_format in format_map:
        fmt = format_map[date_format]
        
        # Se tem hora, tentar formatos com hora primeiro
        if " " in text:
            # Tentar formatos com hora: "DD/MM/YYYY HH:mm" ou "DD/MM/YYYY HH:mm:ss"
            # Também tentar com separador de hora diferente (ex: "17:06" ou "17.06")
            for time_suffix in [" %H:%M", " %H:%M:%S", " %H.%M", " %H.%M.%S"]:
                try:
                    dt = datetime.strptime(text, fmt + time_suffix)
                    return dt.strftime("%Y-%m-%d")
                except ValueError:
                    continue
        
        # Tentar apenas a data (sem hora)
        try:
            # Pegar apenas os primeiros 10 caracteres (DD/MM/YYYY ou MM/DD/YYYY)
            if len(date_part) >= 10:
                dt = datetime.strptime(date_part[:10], fmt)
            else:
                dt = datetime.strptime(date_part, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            logger.warning(f"[AD_METRICS_IMPORT] Erro ao parsear data '{text}' com formato '{date_format}'")
            # DEBUG: Logar mais detalhes para ajudar no debug
            logger.debug(f"[AD_METRICS_IMPORT] DEBUG - date_part: '{date_part}', len: {len(date_part)}, fmt: '{fmt}'")
            return None
    
    # Fallback: se não tiver formato especificado, tentar formatos comuns
    # (isso não deveria acontecer se o usuário configurou corretamente)
    formats_to_try = [
        '%d/%m/%Y',  # DD/MM/YYYY
        '%m/%d/%Y',  # MM/DD/YYYY
        '%Y-%m-%d',  # YYYY-MM-DD
    ]
    
    if " " in text:
        for fmt in formats_to_try:
            for time_suffix in [" %H:%M", " %H:%M:%S", " %H.%M", " %H.%M.%S"]:
                try:
                    dt = datetime.strptime(text, fmt + time_suffix)
                    return dt.strftime("%Y-%m-%d")
                except ValueError:
                    continue
    
    for fmt in formats_to_try:
        try:
            if len(date_part) >= 10:
                dt = datetime.strptime(date_part[:10], fmt)
            else:
                dt = datetime.strptime(date_part, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    
    return None


def _to_float_or_none(value: str | None) -> float | None:
    """
    Converte string para float ou retorna None.
    Suporta formatos europeu (1.000,50) e americano (1,000.50).
    """
    if value is None:
        return None
    text = str(value).strip().replace(" ", "")
    if text == "":
        return None
    text = text.lstrip("$€£R$")
    last_comma = text.rfind(",")
    last_period = text.rfind(".")
    if last_comma >= 0 and last_period >= 0:
        if last_comma > last_period:
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif last_comma >= 0:
        parts = text.split(",")
        if len(parts) == 2 and len(parts[1]) == 3 and len(parts[0]) <= 3:
            text = text.replace(",", "")
        else:
            text = text.replace(",", ".")
    elif last_period >= 0:
        parts = text.split(".")
        if len(parts) == 2 and len(parts[1]) == 3 and len(parts[0]) <= 3:
            text = text.replace(".", "")
    try:
        return float(text)
    except ValueError:
        return None


def _sanitize_ad_id(ad_id: str | None) -> str | None:
    """Remove caracteres inválidos e valida formato do ad_id."""
    if not ad_id:
        return None
    cleaned = str(ad_id).strip()
    if not cleaned:
        return None
    return cleaned


def _validate_numeric(value: float | None, min_val: float | None = None, max_val: float | None = None) -> float | None:
    """Valida e limita valores numéricos."""
    if value is None:
        return None
    if min_val is not None and value < min_val:
        logger.debug(f"Valor {value} abaixo do mínimo {min_val}, usando None")
        return None
    if max_val is not None and value > max_val:
        logger.debug(f"Valor {value} acima do máximo {max_val}, usando None")
        return None
    return value


def _load_sheet_config(sb: Any, integration_id: str, user_id: str) -> Dict[str, Any]:
    """Carrega configuração da integração em ad_sheet_integrations."""
    res = (
        sb.table("ad_sheet_integrations")
        .select(
            "id, spreadsheet_id, worksheet_title, ad_id_column, date_column, "
            "leadscore_column, cpr_max_column, date_format, pack_id, connection_id, "
            "ad_id_column_index, date_column_index, leadscore_column_index, cpr_max_column_index"
        )
        .eq("id", integration_id)
        .eq("owner_id", user_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise AdMetricsImportError("Configuração de integração não encontrada.")
    return res.data[0]


def _fetch_and_parse_sheet(
    user_jwt: str,
    user_id: str,
    spreadsheet_id: str,
    worksheet_title: str,
    connection_id: Optional[str],
) -> tuple[List[str], List[List[str]], Dict[str, int]]:
    """Busca dados da planilha e retorna headers, rows e name_to_idx."""
    headers, rows = fetch_all_rows(
        user_jwt=user_jwt,
        user_id=user_id,
        spreadsheet_id=spreadsheet_id,
        worksheet_title=worksheet_title,
        connection_id=connection_id,
    )
    if not headers:
        raise AdMetricsImportError("Planilha sem header (linha 1 vazia).")
    name_to_idx: Dict[str, int] = {}
    for idx, h in enumerate(headers):
        key = str(h).strip()
        if key and key not in name_to_idx:
            name_to_idx[key] = idx
    return headers, rows, name_to_idx


def _parse_and_aggregate_rows(
    rows: List[List[str]],
    ad_id_idx: Optional[int],
    date_idx: Optional[int],
    leadscore_idx: Optional[int],
    cpr_max_idx: Optional[int],
    date_format: str,
    check_cancelled: Optional[Callable[[], bool]],
) -> tuple[Dict[tuple[str, str], Dict[str, Any]], int, int]:
    """Parse e agrega linhas por (ad_id, date). Retorna aggregated_data, processed, skipped_invalid."""
    aggregated_data = defaultdict(lambda: {'leadscore_values': [], 'cpr_max': None, 'row_count': 0})
    processed = 0
    skipped_invalid = 0

    def safe_get(values: List[str], idx: int | None) -> str | None:
        if idx is None:
            return None
        if idx < 0 or idx >= len(values):
            return None
        return values[idx]

    for row in rows:
        processed += 1
        if processed % 1000 == 0:
            logger.info(f"[AD_METRICS_IMPORT] Processadas {processed}/{len(rows)} linhas...")
            if check_cancelled and check_cancelled():
                raise AdMetricsImportCancelled("Importação cancelada pelo usuário")

        ad_id_raw = safe_get(row, ad_id_idx)
        date_raw = safe_get(row, date_idx)
        leadscore_raw = safe_get(row, leadscore_idx)
        cpr_max_raw = safe_get(row, cpr_max_idx)

        ad_id = _sanitize_ad_id(ad_id_raw)
        if not ad_id:
            skipped_invalid += 1
            continue

        date_norm = _parse_date(date_raw or "", date_format)
        if not date_norm:
            if skipped_invalid < 10:
                logger.warning(f"[AD_METRICS_IMPORT] DEBUG - Falha ao parsear data: '{date_raw}'")
            skipped_invalid += 1
            continue

        if not re.match(r'^\d{4}-\d{2}-\d{2}$', date_norm):
            skipped_invalid += 1
            continue

        leadscore_val = _validate_numeric(_to_float_or_none(leadscore_raw), min_val=0)
        cpr_max_val = _validate_numeric(_to_float_or_none(cpr_max_raw), min_val=0)
        if leadscore_val is None and cpr_max_val is None:
            skipped_invalid += 1
            continue

        key = (ad_id, date_norm)
        aggregated_data[key]['row_count'] += 1
        if leadscore_val is not None:
            aggregated_data[key]['leadscore_values'].append(leadscore_val)
        if cpr_max_val is not None:
            current_max = aggregated_data[key]['cpr_max']
            if current_max is None or cpr_max_val > current_max:
                aggregated_data[key]['cpr_max'] = cpr_max_val

    return aggregated_data, processed, skipped_invalid


def _build_final_data_and_groups(
    aggregated_data: Dict[tuple[str, str], Dict[str, Any]],
) -> tuple[Dict[str, Dict[str, Any]], Dict[tuple, List[str]]]:
    """Constrói final_data e updates_by_values para o RPC."""
    final_data: Dict[str, Dict[str, Any]] = {}
    for (ad_id, date), agg in aggregated_data.items():
        metric_id = f"{date}-{ad_id}"
        leadscore_values = agg['leadscore_values'] if agg['leadscore_values'] else None
        if leadscore_values:
            leadscore_values = [round(v, 6) for v in leadscore_values]
        final_data[metric_id] = {
            'id': metric_id,
            'ad_id': ad_id,
            'date': date,
            'leadscore_values': leadscore_values,
            'cpr_max': agg['cpr_max'],
            'lead_count': agg['row_count'],
        }

    updates_by_values: Dict[tuple, List[str]] = defaultdict(list)
    for metric_id, data in final_data.items():
        leadscore_vals = data.get('leadscore_values')
        leadscore_key = tuple(leadscore_vals) if leadscore_vals else None
        value_key = (
            leadscore_key,
            round(data['cpr_max'], 6) if data['cpr_max'] is not None else None,
        )
        updates_by_values[value_key].append(metric_id)

    rpc_updates = []
    for (leadscore_key, cpr_max), ids_batch in updates_by_values.items():
        update_item: Dict[str, Any] = {"ids": ids_batch}
        if leadscore_key is not None:
            update_item["leadscore_values"] = list(leadscore_key)
        if cpr_max is not None:
            update_item["cpr_max"] = float(cpr_max)
        rpc_updates.append(update_item)

    return final_data, updates_by_values, rpc_updates


def _execute_batch_update(
    sb: Any,
    user_id: str,
    pack_id: Optional[str],
    rpc_updates: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Executa RPC batch_update_ad_metrics_enrichment e retorna o resultado."""
    result = sb.rpc(
        "batch_update_ad_metrics_enrichment",
        {
            "p_user_id": user_id,
            "p_updates": rpc_updates,
            "p_pack_id": pack_id,
        },
    ).execute()
    if not result.data:
        raise AdMetricsImportError("RPC de atualização não retornou dados.")
    rpc_result = result.data
    if rpc_result.get("status") == "error":
        raise AdMetricsImportError(
            f"Erro na atualização em lote: {rpc_result.get('error_message', 'Erro desconhecido')}"
        )
    return rpc_result


def _update_integration_status(
    sb: Any,
    integration_id: str,
    user_id: str,
) -> None:
    """Atualiza last_sync_status da integracao. Falha propaga excecao."""
    from datetime import datetime as dt, timezone as tz

    now_iso = dt.now(tz.utc).isoformat(timespec="seconds")
    sb.table("ad_sheet_integrations").update(
        {
            "last_synced_at": now_iso,
            "last_successful_sync_at": now_iso,
            "last_sync_status": "success",
            "updated_at": now_iso,
        }
    ).eq("id", integration_id).eq("owner_id", user_id).execute()


def run_ad_metrics_sheet_import(
    user_jwt: str,
    user_id: str,
    integration_id: str,
    check_cancelled: Optional[Callable[[], bool]] = None,
    on_stage_change: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """
    Lê a planilha configurada em ad_sheet_integrations e aplica enriquecimento em ad_metrics.

    Estratégia:
    1. Ler planilha (cada linha = 1 lead)
    2. Agregar leads por (ad_id, date) → array de leadscores [24, 100, 80, 19]
    3. Construir IDs: f"{date}-{ad_id}" (chave primária de ad_metrics)
    4. Agrupar por valores similares e enviar tudo ao RPC batch_update_ad_metrics_enrichment
       O filtro de pack (quando aplicável) é aplicado diretamente no WHERE do UPDATE.
    """
    sb = get_supabase_for_user(user_jwt)

    cfg = _load_sheet_config(sb, integration_id, user_id)
    spreadsheet_id = cfg.get("spreadsheet_id")
    worksheet_title = cfg.get("worksheet_title")
    ad_id_col_name = cfg.get("ad_id_column")
    date_col_name = cfg.get("date_column")
    leadscore_col_name = cfg.get("leadscore_column")
    cpr_max_col_name = cfg.get("cpr_max_column")
    date_format = cfg.get("date_format")
    pack_id = cfg.get("pack_id")
    connection_id = cfg.get("connection_id")
    ad_id_col_idx = cfg.get("ad_id_column_index")
    date_col_idx = cfg.get("date_column_index")
    leadscore_col_idx = cfg.get("leadscore_column_index")
    cpr_max_col_idx = cfg.get("cpr_max_column_index")

    if not date_format or date_format not in ("DD/MM/YYYY", "MM/DD/YYYY"):
        raise AdMetricsImportError(
            "Formato de data não configurado ou inválido. "
            "Por favor, configure o formato de data no passo de seleção de colunas."
        )
    if not spreadsheet_id or not worksheet_title:
        raise AdMetricsImportError("Configuração de planilha inválida.")

    if on_stage_change:
        on_stage_change("lendo_planilha")
    try:
        headers, rows, name_to_idx = _fetch_and_parse_sheet(
            user_jwt, user_id, spreadsheet_id, worksheet_title, connection_id
        )
    except GoogleSheetsError as e:
        error_message = e.message if hasattr(e, 'message') else str(e)
        error_code = getattr(e, 'code', None)
        if error_code == GOOGLE_TOKEN_EXPIRED:
            raise AdMetricsImportError(
                f"Token do Google expirado ou revogado. Por favor, reconecte sua conta Google. ({error_message})",
                code=GOOGLE_TOKEN_EXPIRED,
            )
        raise AdMetricsImportError(error_message, code=error_code)
    except Exception as e:
        logger.exception("[AD_METRICS_IMPORT] Erro inesperado ao ler planilha")
        raise AdMetricsImportError("Erro ao ler planilha do Google.") from e

    if check_cancelled and check_cancelled():
        logger.info("[AD_METRICS_IMPORT] ⛔ Importação cancelada pelo usuário após ler planilha")
        raise AdMetricsImportCancelled("Importação cancelada pelo usuário")

    def col_idx(col_name: str | None, explicit_index: int | None) -> int | None:
        """Usa índice explícito quando definido (headers duplicados), senão resolve por nome."""
        if explicit_index is not None:
            return explicit_index
        return name_to_idx.get(str(col_name).strip()) if col_name else None

    ad_id_idx = col_idx(ad_id_col_name, cfg.get("ad_id_column_index"))
    date_idx = col_idx(date_col_name, cfg.get("date_column_index"))
    leadscore_idx = col_idx(leadscore_col_name, cfg.get("leadscore_column_index"))
    cpr_max_idx = col_idx(cpr_max_col_name, cfg.get("cpr_max_column_index"))
    if ad_id_idx is None or date_idx is None:
        raise AdMetricsImportError(
            "Colunas de ad_id ou data não encontradas no header da planilha."
        )
    if leadscore_idx is None and cpr_max_idx is None:
        raise AdMetricsImportError(
            "Nenhuma coluna de Leadscore ou CPR max configurada."
        )

    if on_stage_change:
        on_stage_change("processando_dados")
    aggregated_data, processed, skipped_invalid = _parse_and_aggregate_rows(
        rows, ad_id_idx, date_idx, leadscore_idx, cpr_max_idx, date_format, check_cancelled
    )

    if not aggregated_data:
        logger.warning("[AD_METRICS_IMPORT] Nenhum dado válido para processar após agregação")
        return {
            "processed_rows": processed,
            "unique_ad_date_pairs": 0,
            "leads_aggregated": 0,
            "updated_rows": 0,
            "skipped_no_match": 0,
            "skipped_invalid": skipped_invalid,
        }

    unique_ad_ids_set = set(ad_id for ad_id, _ in aggregated_data.keys())
    unique_dates_set = set(date for _, date in aggregated_data.keys())
    final_data, updates_by_values, rpc_updates = _build_final_data_and_groups(aggregated_data)

    logger.info(f"[AD_METRICS_IMPORT] {len(final_data)} IDs únicos gerados para atualização")
    logger.info(f"[AD_METRICS_IMPORT] Estatísticas de agregação:")
    logger.info(f"[AD_METRICS_IMPORT]   - Ad IDs únicos na planilha: {len(unique_ad_ids_set)}")
    logger.info(f"[AD_METRICS_IMPORT]   - Datas únicas na planilha: {len(unique_dates_set)}")
    if unique_dates_set:
        logger.info(f"[AD_METRICS_IMPORT]   - Range de datas: {min(unique_dates_set)} até {max(unique_dates_set)}")
    if pack_id:
        logger.info(f"[AD_METRICS_IMPORT] Integração vinculada ao pack_id={pack_id} — filtro será aplicado no RPC")

    if check_cancelled and check_cancelled():
        logger.info("[AD_METRICS_IMPORT] ⛔ Importação cancelada pelo usuário antes de iniciar atualizações")
        raise AdMetricsImportCancelled("Importação cancelada pelo usuário")

    if on_stage_change:
        on_stage_change("persistindo")
    try:
        rpc_result = _execute_batch_update(sb, user_id, pack_id, rpc_updates)
    except Exception as e:
        raise AdMetricsImportError(f"Falha ao executar atualização em lote: {e}")
    if rpc_result.get("status") == "error":
        raise AdMetricsImportError(
            f"Erro na atualização em lote: {rpc_result.get('error_message', 'Erro desconhecido')}"
        )

    total_updated = rpc_result.get("total_rows_updated", 0)
    total_groups_processed = rpc_result.get("total_groups_processed", 0)
    total_ids_sent = rpc_result.get("total_ids_sent", len(final_data))
    ids_not_found_count = rpc_result.get("ids_not_found_count")
    ids_out_of_pack_count = rpc_result.get("ids_out_of_pack_count")
    if ids_not_found_count is not None and ids_out_of_pack_count is not None:
        skipped_no_match = ids_not_found_count + ids_out_of_pack_count
    else:
        skipped_no_match = len(final_data) - total_updated

    logger.info(
        "[AD_METRICS_IMPORT] RPC concluido: %d grupos, %d atualizados, %d sem match (not_found=%s, out_of_pack=%s)",
        total_groups_processed, total_updated, skipped_no_match, ids_not_found_count, ids_out_of_pack_count,
    )

    # Estatísticas finais
    stats = {
        "processed_rows": processed,
        "unique_ad_date_pairs": len(final_data),
        "leads_aggregated": sum(len(agg['leadscore_values']) for agg in aggregated_data.values()),
        "updated_rows": total_updated,
        "skipped_no_match": skipped_no_match,
        "ids_not_found_count": ids_not_found_count,
        "ids_out_of_pack_count": ids_out_of_pack_count,
        "total_update_queries": total_groups_processed,
        "skipped_invalid": skipped_invalid,
    }

    # Atualizar status da integracao - falha e critica, interrompe e notifica usuario
    from datetime import datetime as dt, timezone as tz

    now_iso = dt.now(tz.utc).isoformat(timespec="seconds")
    try:
        sb.table("ad_sheet_integrations").update(
            {
                "last_synced_at": now_iso,
                "last_successful_sync_at": now_iso,
                "last_sync_status": "success",
                "updated_at": now_iso,
            }
        ).eq("id", integration_id).eq("owner_id", user_id).execute()
        stats["integration_status_updated"] = True
    except Exception as e:
        logger.error(
            "[AD_METRICS_IMPORT] Falha crítica ao atualizar status da integração %s: %s",
            integration_id,
            e,
        )
        stats["integration_status_updated"] = False
        raise AdMetricsImportError(
            f"Atualização de leadscore concluída, mas falha ao persistir status da integração. "
            f"Por favor, tente novamente. Detalhe: {e}"
        ) from e

    logger.info(
        "[AD_METRICS_IMPORT] Concluido: %d processadas, %d atualizadas, %d sem match, %d invalidas",
        processed, total_updated, skipped_no_match, skipped_invalid,
    )
    logger.debug("[AD_METRICS_IMPORT] Stats detalhadas: %s", stats)

    return stats



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
    """Converte string para float ou retorna None."""
    if value is None:
        return None
    text = str(value).strip()
    if text == "":
        return None
    try:
        return float(text.replace(",", "."))
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


def run_ad_metrics_sheet_import(
    user_jwt: str,
    user_id: str,
    integration_id: str,
    check_cancelled: Optional[Callable[[], bool]] = None,
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
    processed = 0
    skipped_invalid = 0
    aggregated_data = defaultdict(lambda: {'leadscore_values': [], 'cpr_max': None, 'row_count': 0})
    final_data: Dict[str, Dict[str, Any]] = {}
    total_updated = 0
    unique_ad_ids_set: set = set()
    unique_dates_set: set = set()
    sb = get_supabase_for_user(user_jwt)

    # Buscar configuração da integração
    res = (
        sb.table("ad_sheet_integrations")
        .select(
            "id, spreadsheet_id, worksheet_title, ad_id_column, date_column, "
            "leadscore_column, cpr_max_column, date_format, pack_id, connection_id"
        )
        .eq("id", integration_id)
        .eq("owner_id", user_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise AdMetricsImportError("Configuração de integração não encontrada.")

    cfg = res.data[0]

    spreadsheet_id = cfg.get("spreadsheet_id")
    worksheet_title = cfg.get("worksheet_title")
    ad_id_col_name = cfg.get("ad_id_column")
    date_col_name = cfg.get("date_column")
    leadscore_col_name = cfg.get("leadscore_column")
    cpr_max_col_name = cfg.get("cpr_max_column")
    date_format = cfg.get("date_format")
    pack_id = cfg.get("pack_id")
    connection_id = cfg.get("connection_id")
    
    # Validar que o formato de data foi configurado
    if not date_format or date_format not in ("DD/MM/YYYY", "MM/DD/YYYY"):
        raise AdMetricsImportError(
            "Formato de data não configurado ou inválido. "
            "Por favor, configure o formato de data no passo de seleção de colunas."
        )

    if not spreadsheet_id or not worksheet_title:
        raise AdMetricsImportError("Configuração de planilha inválida.")

    # 1. Buscar dados da planilha
    try:
        headers, rows = fetch_all_rows(
            user_jwt=user_jwt,
            user_id=user_id,
            spreadsheet_id=spreadsheet_id,
            worksheet_title=worksheet_title,
            connection_id=connection_id,
        )
    except GoogleSheetsError as e:
        error_message = e.message if hasattr(e, 'message') else str(e)
        # Preservar código do erro se disponível
        error_code = getattr(e, 'code', None)
        if error_code == GOOGLE_TOKEN_EXPIRED:
            raise AdMetricsImportError(
                f"Token do Google expirado ou revogado. Por favor, reconecte sua conta Google. ({error_message})",
                code=GOOGLE_TOKEN_EXPIRED
            )
        raise AdMetricsImportError(error_message, code=error_code)
    except Exception as e:
        logger.exception("[AD_METRICS_IMPORT] Erro inesperado ao ler planilha")
        raise AdMetricsImportError("Erro ao ler planilha do Google.") from e

    # ✅ VERIFICAR CANCELAMENTO após ler planilha
    if check_cancelled and check_cancelled():
        logger.info("[AD_METRICS_IMPORT] ⛔ Importação cancelada pelo usuário após ler planilha")
        raise AdMetricsImportCancelled("Importação cancelada pelo usuário")

    if not headers:
        raise AdMetricsImportError("Planilha sem header (linha 1 vazia).")

    # Mapear nome -> índice
    name_to_idx: Dict[str, int] = {}
    for idx, h in enumerate(headers):
        key = str(h).strip()
        if key and key not in name_to_idx:
            name_to_idx[key] = idx

    def col_idx(col_name: str | None) -> int | None:
        if not col_name:
            return None
        return name_to_idx.get(str(col_name).strip())

    ad_id_idx = col_idx(ad_id_col_name)
    date_idx = col_idx(date_col_name)
    leadscore_idx = col_idx(leadscore_col_name)
    cpr_max_idx = col_idx(cpr_max_col_name)

    if ad_id_idx is None or date_idx is None:
        raise AdMetricsImportError(
            "Colunas de ad_id ou data não encontradas no header da planilha."
        )
    if leadscore_idx is None and cpr_max_idx is None:
        raise AdMetricsImportError(
            "Nenhuma coluna de Leadscore ou CPR max configurada."
        )

    # 2. Parse e agregação por (ad_id, date)
    # Estrutura: {(ad_id, date): {'leadscore_values': List[float], 'cpr_max': float}}
    # Nota: aggregated_data, processed e skipped_invalid já foram inicializados no início da função
    # Resetar para garantir valores corretos
    aggregated_data.clear()
    processed = 0
    skipped_invalid = 0

    def safe_get(values: List[str], idx: int | None) -> str | None:
        if idx is None:
            return None
        if idx < 0 or idx >= len(values):
            return None
        return values[idx]

    logger.info(f"[AD_METRICS_IMPORT] Iniciando processamento de {len(rows)} linhas da planilha")

    for row in rows:
        processed += 1

        # Log de progresso a cada 1000 linhas
        if processed % 1000 == 0:
            logger.info(f"[AD_METRICS_IMPORT] Processadas {processed}/{len(rows)} linhas...")
            # ✅ VERIFICAR CANCELAMENTO a cada 1000 linhas
            if check_cancelled and check_cancelled():
                logger.info(f"[AD_METRICS_IMPORT] ⛔ Importação cancelada pelo usuário após processar {processed} linhas")
                raise AdMetricsImportCancelled("Importação cancelada pelo usuário")

        # Parse dos valores
        ad_id_raw = safe_get(row, ad_id_idx)
        date_raw = safe_get(row, date_idx)
        leadscore_raw = safe_get(row, leadscore_idx)
        cpr_max_raw = safe_get(row, cpr_max_idx)

        # Sanitizar e validar ad_id
        ad_id = _sanitize_ad_id(ad_id_raw)
        if not ad_id:
            skipped_invalid += 1
            continue

        # Parse e validar data usando o formato configurado pelo usuário
        date_norm = _parse_date(date_raw or "", date_format)
        if not date_norm:
            # DEBUG: Logar algumas amostras de datas que falharam
            if skipped_invalid < 10:  # Logar apenas as primeiras 10 para não poluir
                logger.warning(f"[AD_METRICS_IMPORT] DEBUG - Falha ao parsear data: '{date_raw}' (formato configurado: '{date_format}')")
            skipped_invalid += 1
            continue

        # Validar formato de data (YYYY-MM-DD)
        if not re.match(r'^\d{4}-\d{2}-\d{2}$', date_norm):
            logger.warning(f"[AD_METRICS_IMPORT] Data com formato inválido: {date_norm}, pulando linha")
            skipped_invalid += 1
            continue

        # Parse e validar valores numéricos
        leadscore_val = _validate_numeric(_to_float_or_none(leadscore_raw), min_val=0)
        cpr_max_val = _validate_numeric(_to_float_or_none(cpr_max_raw), min_val=0)

        # Se não tem leadscore nem cpr_max, não tem o que agregar
        if leadscore_val is None and cpr_max_val is None:
            skipped_invalid += 1
            continue

        # Agregar por (ad_id, date)
        key = (ad_id, date_norm)

        # Contar toda linha válida (independente de ter leadscore ou cpr_max)
        aggregated_data[key]['row_count'] += 1

        # Agregar leadscore em array (preserva valores individuais)
        if leadscore_val is not None:
            aggregated_data[key]['leadscore_values'].append(leadscore_val)

        # Para CPR max: usar o maior valor (ou pode ser média, dependendo da regra de negócio)
        if cpr_max_val is not None:
            current_max = aggregated_data[key]['cpr_max']
            if current_max is None or cpr_max_val > current_max:
                aggregated_data[key]['cpr_max'] = cpr_max_val

    logger.info(f"[AD_METRICS_IMPORT] Processamento concluído: {processed} linhas processadas, {len(aggregated_data)} pares (ad_id, date) únicos")
    
    # Calcular estatísticas de agregação para o resumo final
    unique_ad_ids_set = set(ad_id for ad_id, _ in aggregated_data.keys())
    unique_dates_set = set(date for _, date in aggregated_data.keys())

    # 3. Calcular médias finais e construir IDs
    final_data: Dict[str, Dict[str, Any]] = {}

    for (ad_id, date), agg in aggregated_data.items():
        # Construir ID: "{date}-{ad_id}" (chave primária de ad_metrics)
        metric_id = f"{date}-{ad_id}"

        # Salvar array de leadscores (preserva valores individuais)
        # Permite calcular média correta, soma, contagem, etc. quando há múltiplas datas
        leadscore_values = agg['leadscore_values'] if agg['leadscore_values'] else None
        # Arredondar valores para 6 casas decimais (precisão suficiente)
        if leadscore_values:
            leadscore_values = [round(v, 6) for v in leadscore_values]

        final_data[metric_id] = {
            'id': metric_id,
            'ad_id': ad_id,
            'date': date,
            'leadscore_values': leadscore_values,
            'cpr_max': agg['cpr_max'],
            'lead_count': agg['row_count']  # Total de linhas da planilha agregadas neste par
        }

    if not final_data:
        logger.warning("[AD_METRICS_IMPORT] Nenhum dado válido para processar após agregação")
        return {
            'processed_rows': processed,
            'unique_ad_date_pairs': 0,
            'leads_aggregated': 0,
            'updated_rows': 0,
            'skipped_no_match': 0,
            'skipped_invalid': skipped_invalid,
        }

    logger.info(f"[AD_METRICS_IMPORT] {len(final_data)} IDs únicos gerados para atualização")

    # Estatísticas de agregação para o resumo final
    logger.info(f"[AD_METRICS_IMPORT] Estatísticas de agregação:")
    logger.info(f"[AD_METRICS_IMPORT]   - Ad IDs únicos na planilha: {len(unique_ad_ids_set)}")
    logger.info(f"[AD_METRICS_IMPORT]   - Datas únicas na planilha: {len(unique_dates_set)}")
    if unique_dates_set:
        logger.info(f"[AD_METRICS_IMPORT]   - Range de datas: {min(unique_dates_set)} até {max(unique_dates_set)}")
        logger.info(f"[AD_METRICS_IMPORT]   - Total teórico máximo (se todos ad_ids em todas datas): {len(unique_ad_ids_set) * len(unique_dates_set)}")
        logger.info(f"[AD_METRICS_IMPORT]   - Total real de pares únicos: {len(aggregated_data)}")
    
    # 4. Agrupar por valores similares para compactar o payload do RPC
    # Cada grupo = 1 UPDATE no banco; IDs com mesmos valores vão no mesmo grupo.
    if pack_id:
        logger.info(f"[AD_METRICS_IMPORT] Integração vinculada ao pack_id={pack_id} — filtro será aplicado no RPC")

    logger.info(f"[AD_METRICS_IMPORT] ===== INICIANDO ATUALIZAÇÕES =====")
    logger.info(f"[AD_METRICS_IMPORT] {len(final_data)} registros serão enviados para o RPC")

    # ✅ VERIFICAR CANCELAMENTO antes de iniciar updates
    if check_cancelled and check_cancelled():
        logger.info("[AD_METRICS_IMPORT] ⛔ Importação cancelada pelo usuário antes de iniciar atualizações")
        raise AdMetricsImportCancelled("Importação cancelada pelo usuário")

    updates_by_values = defaultdict(list)
    for metric_id, data in final_data.items():
        # Agrupar por valores similares
        # Para arrays, usar tupla dos valores para comparação (ou None se vazio)
        leadscore_vals = data.get('leadscore_values')
        # Converter array para tupla para usar como chave de dict (arrays não são hashable)
        leadscore_key = tuple(leadscore_vals) if leadscore_vals else None
        value_key = (
            leadscore_key,
            round(data['cpr_max'], 6) if data['cpr_max'] is not None else None
        )
        updates_by_values[value_key].append(metric_id)

    logger.info(f"[AD_METRICS_IMPORT] Agrupados em {len(updates_by_values)} grupos por valores similares (leadscore_values, cpr_max)")
    logger.info(f"[AD_METRICS_IMPORT] Usando batch update via RPC: {len(updates_by_values)} grupos em uma única transação")

    # Preparar dados para RPC (todos os updates em um array JSON)
    rpc_updates = []
    for (leadscore_key, cpr_max), ids_batch in updates_by_values.items():
        update_item: Dict[str, Any] = {"ids": ids_batch}
        if leadscore_key is not None:
            update_item["leadscore_values"] = list(leadscore_key)
        if cpr_max is not None:
            update_item["cpr_max"] = float(cpr_max)
        rpc_updates.append(update_item)

    # Executar RPC — falhas propagam como AdMetricsImportError (job marcado como failed)
    try:
        result = sb.rpc(
            "batch_update_ad_metrics_enrichment",
            {
                "p_user_id": user_id,
                "p_updates": rpc_updates,
                "p_pack_id": pack_id,
            }
        ).execute()
    except Exception as e:
        raise AdMetricsImportError(f"Falha ao executar atualização em lote: {e}")

    if not result.data:
        raise AdMetricsImportError("RPC de atualização não retornou dados.")

    rpc_result = result.data
    if rpc_result.get("status") == "error":
        raise AdMetricsImportError(
            f"Erro na atualização em lote: {rpc_result.get('error_message', 'Erro desconhecido')}"
        )

    total_updated = rpc_result.get("total_rows_updated", 0)
    total_groups_processed = rpc_result.get("total_groups_processed", 0)
    logger.info(f"[AD_METRICS_IMPORT] ✓ RPC concluído: {total_groups_processed} grupos, {total_updated} registros atualizados")

    skipped_no_match = len(final_data) - total_updated

    logger.info(f"[AD_METRICS_IMPORT] ===== ATUALIZAÇÕES CONCLUÍDAS =====")
    logger.info(f"[AD_METRICS_IMPORT] Total de registros atualizados: {total_updated}")
    logger.info(f"[AD_METRICS_IMPORT] Total de registros sem match (não existiam ou fora do pack): {skipped_no_match}")

    # Estatísticas finais
    stats = {
        "processed_rows": processed,
        "unique_ad_date_pairs": len(final_data),
        "leads_aggregated": sum(len(agg['leadscore_values']) for agg in aggregated_data.values()),
        "updated_rows": total_updated,
        "skipped_no_match": skipped_no_match,
        "skipped_invalid": skipped_invalid,
    }

    # Atualizar status da integração
    try:
        from datetime import datetime as dt

        now_iso = dt.utcnow().isoformat(timespec="seconds") + "Z"
        sb.table("ad_sheet_integrations").update(
            {
                "last_synced_at": now_iso,
                "last_successful_sync_at": now_iso,
                "last_sync_status": "success",
                "updated_at": now_iso,
            }
        ).eq("id", integration_id).eq("owner_id", user_id).execute()
    except Exception as e:
        logger.warning(
            "[AD_METRICS_IMPORT] Falha ao atualizar status da integração %s: %s",
            integration_id,
            e,
        )

    # ===== RESUMO FINAL CONSOLIDADO =====
    # Este resumo será sempre exibido, mesmo que haja erros anteriores
    logger.info("")
    logger.info("")
    logger.info("=" * 100)
    logger.info("[AD_METRICS_IMPORT] " + "=" * 84)
    logger.info("[AD_METRICS_IMPORT] " + " " * 30 + "RESUMO FINAL DA IMPORTAÇÃO" + " " * 30)
    logger.info("[AD_METRICS_IMPORT] " + "=" * 84)
    logger.info("")
    logger.info("[AD_METRICS_IMPORT] 📊 ESTATÍSTICAS DA PLANILHA:")
    logger.info(f"[AD_METRICS_IMPORT]   • Linhas processadas: {processed:,}")
    logger.info(f"[AD_METRICS_IMPORT]   • Linhas inválidas/puladas: {skipped_invalid:,}")
    logger.info(f"[AD_METRICS_IMPORT]   • Total de leads agregados: {sum(len(agg['leadscore_values']) for agg in aggregated_data.values()):,}")
    logger.info("")
    logger.info("[AD_METRICS_IMPORT] 🔑 AGRUPAMENTO POR (ad_id, date):")
    logger.info(f"[AD_METRICS_IMPORT]   • Pares únicos (ad_id, date) após agregação: {len(final_data):,}")
    logger.info(f"[AD_METRICS_IMPORT]   • Ad IDs únicos na planilha: {len(unique_ad_ids_set):,}")
    logger.info(f"[AD_METRICS_IMPORT]   • Datas únicas na planilha: {len(unique_dates_set):,}")
    if unique_dates_set:
        logger.info(f"[AD_METRICS_IMPORT]   • Range de datas: {min(unique_dates_set)} até {max(unique_dates_set)}")
        max_theoretical = len(unique_ad_ids_set) * len(unique_dates_set)
        logger.info(f"[AD_METRICS_IMPORT]   • Máximo teórico (todos ad_ids × todas datas): {max_theoretical:,}")
        logger.info(f"[AD_METRICS_IMPORT]   • Real encontrado: {len(aggregated_data):,} ({len(aggregated_data)/max_theoretical*100:.1f}% do máximo teórico)")
    logger.info("")
    logger.info("[AD_METRICS_IMPORT] ✏️  ATUALIZAÇÕES NO BANCO (via RPC):")
    logger.info(f"[AD_METRICS_IMPORT]   • Pares (ad_id, date) enviados ao RPC: {len(final_data):,}")
    logger.info(f"[AD_METRICS_IMPORT]   • Registros atualizados com sucesso: {total_updated:,}")
    logger.info(f"[AD_METRICS_IMPORT]   • Sem match (não existiam ou fora do pack): {skipped_no_match:,}")
    logger.info(f"[AD_METRICS_IMPORT]   • Grupos de valores similares: {len(updates_by_values):,}")
    if len(final_data) > 0:
        logger.info(f"[AD_METRICS_IMPORT]   • Taxa de match: {total_updated/len(final_data)*100:.1f}%")
    logger.info("")
    logger.info("[AD_METRICS_IMPORT] " + "=" * 84)
    logger.info("=" * 100)
    logger.info("")
    logger.info("")
    
    logger.info("[AD_METRICS_IMPORT] Import concluído. Stats detalhadas: %s", stats)
    
    # Logar stats também em formato JSON para facilitar análise
    logger.info("")
    logger.info("[AD_METRICS_IMPORT] 📋 Stats em formato JSON para análise:")
    import json
    logger.info(json.dumps(stats, indent=2, ensure_ascii=False))
    logger.info("")
    
    return stats



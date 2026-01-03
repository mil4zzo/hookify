"""Validação de contratos para endpoints de Analytics.

Este módulo define validadores reutilizáveis que garantem que as respostas
dos endpoints de Analytics seguem o contrato esperado:
- Campos essenciais presentes
- Valores não-negativos onde aplicável
- Ratios consistentes com seus numeradores/denominadores
"""

from typing import Any, Dict, List, Optional
import math


# Tolerância para comparação de floats (ratios)
EPSILON = 1e-6


class ContractValidationError(Exception):
    """Exceção levantada quando uma validação de contrato falha."""
    
    def __init__(self, message: str, field: Optional[str] = None, value: Any = None):
        super().__init__(message)
        self.field = field
        self.value = value
        self.message = message


def safe_float_eq(a: float, b: float, epsilon: float = EPSILON) -> bool:
    """Compara dois floats com tolerância epsilon."""
    return abs(a - b) < epsilon


def require_non_negative(field: str, value: Any, allow_zero: bool = True) -> None:
    """Valida que um campo numérico é não-negativo.
    
    Args:
        field: Nome do campo (para mensagem de erro)
        value: Valor a validar
        allow_zero: Se True, permite zero; se False, exige > 0
    
    Raises:
        ContractValidationError: Se o valor for negativo (ou zero se allow_zero=False)
    """
    if value is None:
        return  # Campos opcionais podem ser None
    
    try:
        num_val = float(value)
        if num_val < 0:
            raise ContractValidationError(
                f"Campo '{field}' deve ser não-negativo, mas recebeu {num_val}",
                field=field,
                value=value
            )
        if not allow_zero and num_val == 0:
            raise ContractValidationError(
                f"Campo '{field}' deve ser positivo, mas recebeu {num_val}",
                field=field,
                value=value
            )
    except (ValueError, TypeError):
        raise ContractValidationError(
            f"Campo '{field}' deve ser numérico, mas recebeu {type(value).__name__}: {value}",
            field=field,
            value=value
        )


def validate_ratio_consistency(
    ratio_name: str,
    ratio_value: Optional[float],
    numerator: Optional[float],
    denominator: Optional[float],
    multiplier: float = 1.0,
    epsilon: float = EPSILON
) -> None:
    """Valida que um ratio é consistente com seu numerador/denominador.
    
    Args:
        ratio_name: Nome do ratio (para mensagem de erro)
        ratio_value: Valor do ratio retornado
        numerator: Numerador esperado
        denominator: Denominador esperado
        multiplier: Multiplicador opcional (ex: 1000 para CPM)
        epsilon: Tolerância para comparação
    
    Raises:
        ContractValidationError: Se o ratio não for consistente
    """
    if ratio_value is None:
        return  # Ratios opcionais podem ser None
    
    if numerator is None or denominator is None:
        return  # Se numerador/denominador não estão disponíveis, não validamos
    
    try:
        ratio_float = float(ratio_value)
        num_float = float(numerator)
        den_float = float(denominator)
        
        if den_float > 0:
            expected = (num_float / den_float) * multiplier
            if not safe_float_eq(ratio_float, expected, epsilon):
                raise ContractValidationError(
                    f"Ratio '{ratio_name}' inconsistente: esperado {expected:.6f}, recebido {ratio_float:.6f} "
                    f"(numerator={num_float}, denominator={den_float}, multiplier={multiplier})",
                    field=ratio_name,
                    value=ratio_value
                )
        else:
            # Se denominador é 0, o ratio deve ser 0
            if not safe_float_eq(ratio_float, 0.0, epsilon):
                raise ContractValidationError(
                    f"Ratio '{ratio_name}' deve ser 0 quando denominator=0, mas recebeu {ratio_float}",
                    field=ratio_name,
                    value=ratio_value
                )
    except (ValueError, TypeError) as e:
        raise ContractValidationError(
            f"Erro ao validar ratio '{ratio_name}': valores não numéricos",
            field=ratio_name,
            value=ratio_value
        ) from e


def validate_base_fields(item: Dict[str, Any], required_fields: List[str]) -> None:
    """Valida que campos base essenciais estão presentes e são não-negativos.
    
    Args:
        item: Item a validar
        required_fields: Lista de campos que devem estar presentes
    
    Raises:
        ContractValidationError: Se algum campo obrigatório estiver ausente ou negativo
    """
    for field in required_fields:
        if field not in item:
            raise ContractValidationError(
                f"Campo obrigatório '{field}' ausente no item",
                field=field
            )
        require_non_negative(field, item[field])


def validate_rankings_item(item: Dict[str, Any]) -> List[str]:
    """Valida um item individual da lista 'data' em respostas de rankings.
    
    Args:
        item: Item a validar
    
    Returns:
        Lista de erros encontrados (vazia se tudo OK)
    
    Raises:
        ContractValidationError: Se houver erro crítico
    """
    errors = []
    
    # Campos base obrigatórios (sempre presentes em items de rankings)
    base_fields = ["impressions", "clicks", "inline_link_clicks", "spend", "lpv"]
    
    try:
        validate_base_fields(item, base_fields)
    except ContractValidationError as e:
        errors.append(str(e))
    
    # Validar ratios se presentes
    impressions = item.get("impressions", 0)
    clicks = item.get("clicks", 0)
    inline_link_clicks = item.get("inline_link_clicks", 0)
    spend = item.get("spend", 0)
    lpv = item.get("lpv", 0)
    
    # CTR
    if "ctr" in item:
        try:
            validate_ratio_consistency("ctr", item.get("ctr"), clicks, impressions)
        except ContractValidationError as e:
            errors.append(str(e))
    
    # Website CTR
    if "website_ctr" in item:
        try:
            validate_ratio_consistency("website_ctr", item.get("website_ctr"), inline_link_clicks, impressions)
        except ContractValidationError as e:
            errors.append(str(e))
    
    # Connect Rate
    if "connect_rate" in item:
        try:
            validate_ratio_consistency("connect_rate", item.get("connect_rate"), lpv, inline_link_clicks)
        except ContractValidationError as e:
            errors.append(str(e))
    
    # CPM
    if "cpm" in item:
        try:
            validate_ratio_consistency("cpm", item.get("cpm"), spend, impressions, multiplier=1000.0)
        except ContractValidationError as e:
            errors.append(str(e))
    
    # Page Conv (se houver results disponível)
    if "page_conv" in item and "results" in item:
        # page_conv = results / lpv
        results = item.get("results", 0)
        try:
            validate_ratio_consistency("page_conv", item.get("page_conv"), results, lpv)
        except ContractValidationError as e:
            errors.append(str(e))
    
    return errors


def validate_rankings_response(resp: Dict[str, Any]) -> List[str]:
    """Valida a estrutura completa de uma resposta de rankings.
    
    Args:
        resp: Resposta completa do endpoint
    
    Returns:
        Lista de erros encontrados (vazia se tudo OK)
    """
    errors = []
    
    # Validar estrutura top-level
    if "data" not in resp:
        errors.append("Campo 'data' ausente na resposta")
        return errors  # Sem data, não podemos continuar
    
    if not isinstance(resp["data"], list):
        errors.append(f"Campo 'data' deve ser uma lista, mas recebeu {type(resp['data']).__name__}")
        return errors
    
    # Validar items individuais
    for idx, item in enumerate(resp["data"]):
        if not isinstance(item, dict):
            errors.append(f"Item {idx} em 'data' deve ser um dict, mas recebeu {type(item).__name__}")
            continue
        
        item_errors = validate_rankings_item(item)
        for err in item_errors:
            errors.append(f"Item {idx}: {err}")
    
    # Validar averages se presente
    if "averages" in resp:
        avg_errors = validate_averages(resp["averages"])
        for err in avg_errors:
            errors.append(f"Averages: {err}")
    
    return errors


def validate_averages(averages: Dict[str, Any]) -> List[str]:
    """Valida o bloco 'averages' de uma resposta de rankings.
    
    Nota: averages_base não contém os campos base (impressions, clicks, etc.),
    apenas os ratios calculados. Portanto, validamos apenas:
    - Estrutura correta
    - Ratios não-negativos (quando presentes)
    - Consistência de page_conv em per_action_type (quando results e lpv disponíveis)
    
    Args:
        averages: Bloco averages a validar
    
    Returns:
        Lista de erros encontrados (vazia se tudo OK)
    """
    errors = []
    
    if not isinstance(averages, dict):
        errors.append(f"'averages' deve ser um dict, mas recebeu {type(averages).__name__}")
        return errors
    
    # Validar que ratios são não-negativos (quando presentes)
    ratio_fields = ["ctr", "website_ctr", "connect_rate", "cpm", "hook", "hold_rate", "scroll_stop"]
    for ratio_field in ratio_fields:
        if ratio_field in averages:
            try:
                require_non_negative(f"averages.{ratio_field}", averages[ratio_field])
            except ContractValidationError as e:
                errors.append(str(e))
    
    # Validar per_action_type se presente
    if "per_action_type" in averages:
        per_action = averages["per_action_type"]
        if not isinstance(per_action, dict):
            errors.append(f"'averages.per_action_type' deve ser um dict, mas recebeu {type(per_action).__name__}")
        else:
            for action_type, action_data in per_action.items():
                if not isinstance(action_data, dict):
                    errors.append(f"'averages.per_action_type[{action_type}]' deve ser um dict")
                    continue
                
                # Validar que results é não-negativo
                if "results" in action_data:
                    try:
                        require_non_negative(f"averages.per_action_type[{action_type}].results", action_data["results"])
                    except ContractValidationError as e:
                        errors.append(str(e))
                
                # Validar que cpr é não-negativo
                if "cpr" in action_data:
                    try:
                        require_non_negative(f"averages.per_action_type[{action_type}].cpr", action_data["cpr"])
                    except ContractValidationError as e:
                        errors.append(str(e))
                
                # Validar que page_conv é não-negativo
                if "page_conv" in action_data:
                    try:
                        require_non_negative(f"averages.per_action_type[{action_type}].page_conv", action_data["page_conv"])
                    except ContractValidationError as e:
                        errors.append(str(e))
                    
                    # Se temos results e podemos inferir lpv do contexto (não disponível em averages_base),
                    # não validamos consistência aritmética aqui, apenas não-negatividade
    
    return errors


def validate_detail_response(resp: Dict[str, Any]) -> List[str]:
    """Valida uma resposta de endpoint de detalhes (ad-id, adset-id).
    
    Args:
        resp: Resposta completa do endpoint
    
    Returns:
        Lista de erros encontrados (vazia se tudo OK)
    """
    errors = []
    
    # Campos base obrigatórios
    base_fields = ["impressions", "clicks", "inline_link_clicks", "spend", "lpv"]
    
    try:
        validate_base_fields(resp, base_fields)
    except ContractValidationError as e:
        errors.append(str(e))
    
    # Validar ratios
    impressions = resp.get("impressions", 0)
    clicks = resp.get("clicks", 0)
    inline_link_clicks = resp.get("inline_link_clicks", 0)
    spend = resp.get("spend", 0)
    lpv = resp.get("lpv", 0)
    
    # CTR
    if "ctr" in resp:
        try:
            validate_ratio_consistency("ctr", resp.get("ctr"), clicks, impressions)
        except ContractValidationError as e:
            errors.append(str(e))
    
    # Website CTR
    if "website_ctr" in resp:
        try:
            validate_ratio_consistency("website_ctr", resp.get("website_ctr"), inline_link_clicks, impressions)
        except ContractValidationError as e:
            errors.append(str(e))
    
    # Connect Rate
    if "connect_rate" in resp:
        try:
            validate_ratio_consistency("connect_rate", resp.get("connect_rate"), lpv, inline_link_clicks)
        except ContractValidationError as e:
            errors.append(str(e))
    
    # CPM
    if "cpm" in resp:
        try:
            validate_ratio_consistency("cpm", resp.get("cpm"), spend, impressions, multiplier=1000.0)
        except ContractValidationError as e:
            errors.append(str(e))
    
    return errors


def validate_history_item(item: Dict[str, Any]) -> List[str]:
    """Valida um item individual de uma resposta de history.
    
    Args:
        item: Item a validar
    
    Returns:
        Lista de erros encontrados (vazia se tudo OK)
    """
    errors = []
    
    # Campos obrigatórios em history
    required_fields = ["date", "impressions", "clicks", "inline_link_clicks", "spend", "lpv"]
    
    for field in required_fields:
        if field not in item:
            errors.append(f"Campo obrigatório '{field}' ausente no item de history")
        elif field != "date":
            try:
                require_non_negative(field, item[field])
            except ContractValidationError as e:
                errors.append(str(e))
    
    # Validar ratios
    impressions = item.get("impressions", 0)
    clicks = item.get("clicks", 0)
    inline_link_clicks = item.get("inline_link_clicks", 0)
    spend = item.get("spend", 0)
    lpv = item.get("lpv", 0)
    
    # CTR
    if "ctr" in item:
        try:
            validate_ratio_consistency("ctr", item.get("ctr"), clicks, impressions)
        except ContractValidationError as e:
            errors.append(str(e))
    
    # Website CTR
    if "website_ctr" in item:
        try:
            validate_ratio_consistency("website_ctr", item.get("website_ctr"), inline_link_clicks, impressions)
        except ContractValidationError as e:
            errors.append(str(e))
    
    # Connect Rate
    if "connect_rate" in item:
        try:
            validate_ratio_consistency("connect_rate", item.get("connect_rate"), lpv, inline_link_clicks)
        except ContractValidationError as e:
            errors.append(str(e))
    
    # CPM
    if "cpm" in item:
        try:
            validate_ratio_consistency("cpm", item.get("cpm"), spend, impressions, multiplier=1000.0)
        except ContractValidationError as e:
            errors.append(str(e))
    
    return errors


def validate_history_response(resp: Dict[str, Any]) -> List[str]:
    """Valida uma resposta de endpoint de history.
    
    Args:
        resp: Resposta completa do endpoint
    
    Returns:
        Lista de erros encontrados (vazia se tudo OK)
    """
    errors = []
    
    if "data" not in resp:
        errors.append("Campo 'data' ausente na resposta")
        return errors
    
    if not isinstance(resp["data"], list):
        errors.append(f"Campo 'data' deve ser uma lista, mas recebeu {type(resp['data']).__name__}")
        return errors
    
    for idx, item in enumerate(resp["data"]):
        if not isinstance(item, dict):
            errors.append(f"Item {idx} em 'data' deve ser um dict, mas recebeu {type(item).__name__}")
            continue
        
        item_errors = validate_history_item(item)
        for err in item_errors:
            errors.append(f"Item {idx}: {err}")
    
    return errors


def validate_dashboard_response(resp: Dict[str, Any]) -> List[str]:
    """Valida uma resposta de endpoint de dashboard.
    
    Args:
        resp: Resposta completa do endpoint
    
    Returns:
        Lista de erros encontrados (vazia se tudo OK)
    """
    errors = []
    
    if "totals" not in resp:
        errors.append("Campo 'totals' ausente na resposta")
        return errors
    
    totals = resp["totals"]
    if not isinstance(totals, dict):
        errors.append(f"Campo 'totals' deve ser um dict, mas recebeu {type(totals).__name__}")
        return errors
    
    # Validar campos base
    base_fields = ["impressions", "clicks", "inline_link_clicks", "spend", "lpv"]
    
    try:
        validate_base_fields(totals, base_fields)
    except ContractValidationError as e:
        errors.append(str(e))
    
    # Validar ratios
    impressions = totals.get("impressions", 0)
    clicks = totals.get("clicks", 0)
    inline_link_clicks = totals.get("inline_link_clicks", 0)
    spend = totals.get("spend", 0)
    lpv = totals.get("lpv", 0)
    
    # CTR
    if "ctr" in totals:
        try:
            validate_ratio_consistency("totals.ctr", totals.get("ctr"), clicks, impressions)
        except ContractValidationError as e:
            errors.append(str(e))
    
    # Website CTR
    if "website_ctr" in totals:
        try:
            validate_ratio_consistency("totals.website_ctr", totals.get("website_ctr"), inline_link_clicks, impressions)
        except ContractValidationError as e:
            errors.append(str(e))
    
    # Connect Rate
    if "connect_rate" in totals:
        try:
            validate_ratio_consistency("totals.connect_rate", totals.get("connect_rate"), lpv, inline_link_clicks)
        except ContractValidationError as e:
            errors.append(str(e))
    
    # CPM
    if "cpm" in totals:
        try:
            validate_ratio_consistency("totals.cpm", totals.get("cpm"), spend, impressions, multiplier=1000.0)
        except ContractValidationError as e:
            errors.append(str(e))
    
    return errors


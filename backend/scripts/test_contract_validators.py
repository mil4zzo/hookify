"""Testes unitários para os validadores de contrato.

Este script testa a lógica de validação sem precisar de um backend rodando.
"""

import sys
import os

# Adicionar o diretório raiz do backend ao path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.contracts.analytics_contracts import (
    validate_rankings_response,
    validate_rankings_item,
    validate_detail_response,
    validate_history_response,
    validate_dashboard_response,
    validate_averages,
    ContractValidationError,
    safe_float_eq,
    require_non_negative,
    validate_ratio_consistency,
)


IS_WINDOWS = sys.platform == "win32"
OK_SYMBOL = "[OK]" if IS_WINDOWS else "✓"
FAIL_SYMBOL = "[FAIL]" if IS_WINDOWS else "✗"

def test_safe_float_eq():
    """Testa a função safe_float_eq."""
    assert safe_float_eq(0.1 + 0.2, 0.3) == True
    assert safe_float_eq(1.0, 1.0) == True
    assert safe_float_eq(1.0, 1.0000001) == True  # Dentro do epsilon
    assert safe_float_eq(1.0, 1.1) == False
    print(f"{OK_SYMBOL} safe_float_eq: OK")


def test_require_non_negative():
    """Testa a função require_non_negative."""
    # Casos válidos
    require_non_negative("test", 0)
    require_non_negative("test", 1)
    require_non_negative("test", 100.5)
    
    # Casos inválidos
    try:
        require_non_negative("test", -1)
        assert False, "Deveria ter levantado exceção"
    except ContractValidationError:
        pass
    
    try:
        require_non_negative("test", -0.1)
        assert False, "Deveria ter levantado exceção"
    except ContractValidationError:
        pass
    
    print(f"{OK_SYMBOL} require_non_negative: OK")


def test_validate_ratio_consistency():
    """Testa a função validate_ratio_consistency."""
    # Casos válidos
    validate_ratio_consistency("ctr", 0.05, 10, 200)  # 10/200 = 0.05
    validate_ratio_consistency("cpm", 50.0, 10, 200, multiplier=1000.0)  # (10/200)*1000 = 50
    
    # Caso com denominador zero
    validate_ratio_consistency("ctr", 0.0, 10, 0)
    
    # Casos inválidos
    try:
        validate_ratio_consistency("ctr", 0.1, 10, 200)  # Deveria ser 0.05
        assert False, "Deveria ter levantado exceção"
    except ContractValidationError:
        pass
    
    try:
        validate_ratio_consistency("ctr", 0.05, 10, 0)  # Denominador zero mas ratio não é 0
        assert False, "Deveria ter levantado exceção"
    except ContractValidationError:
        pass
    
    print(f"{OK_SYMBOL} validate_ratio_consistency: OK")


def test_validate_rankings_item():
    """Testa a validação de um item de rankings."""
    # Item válido
    valid_item = {
        "ad_id": "123",
        "ad_name": "Test Ad",
        "impressions": 1000,
        "clicks": 50,
        "inline_link_clicks": 30,
        "spend": 10.5,
        "lpv": 20,
        "ctr": 0.05,  # 50/1000
        "website_ctr": 0.03,  # 30/1000
        "connect_rate": 0.666666,  # 20/30 ≈ 0.666667
        "cpm": 10.5,  # (10.5/1000)*1000
    }
    
    errors = validate_rankings_item(valid_item)
    assert len(errors) == 0, f"Item válido gerou erros: {errors}"
    
    # Item com ratio inconsistente
    invalid_item = {
        "impressions": 1000,
        "clicks": 50,
        "inline_link_clicks": 30,
        "spend": 10.5,
        "lpv": 20,
        "ctr": 0.1,  # Deveria ser 0.05
    }
    
    errors = validate_rankings_item(invalid_item)
    assert len(errors) > 0, "Item inválido não gerou erros"
    assert any("ctr" in err.lower() for err in errors)
    
    # Item com valor negativo
    negative_item = {
        "impressions": -100,
        "clicks": 50,
        "inline_link_clicks": 30,
        "spend": 10.5,
        "lpv": 20,
    }
    
    errors = validate_rankings_item(negative_item)
    assert len(errors) > 0, "Item com valor negativo não gerou erros"
    assert any("impressions" in err.lower() for err in errors)
    
    print(f"{OK_SYMBOL} validate_rankings_item: OK")


def test_validate_rankings_response():
    """Testa a validação de uma resposta completa de rankings."""
    # Resposta válida
    valid_response = {
        "data": [
            {
                "ad_id": "123",
                "impressions": 1000,
                "clicks": 50,
                "inline_link_clicks": 30,
                "spend": 10.5,
                "lpv": 20,
                "ctr": 0.05,
                "website_ctr": 0.03,
                "connect_rate": 0.666666,
                "cpm": 10.5,
            }
        ],
        "available_conversion_types": ["action:lead"],
        "averages": {
            "ctr": 0.05,
            "website_ctr": 0.03,
            "connect_rate": 0.666666,
            "cpm": 10.5,
        }
    }
    
    errors = validate_rankings_response(valid_response)
    assert len(errors) == 0, f"Resposta válida gerou erros: {errors}"
    
    # Resposta sem campo 'data'
    invalid_response = {
        "available_conversion_types": []
    }
    
    errors = validate_rankings_response(invalid_response)
    assert len(errors) > 0, "Resposta sem 'data' não gerou erros"
    assert any("data" in err.lower() for err in errors)
    
    print(f"{OK_SYMBOL} validate_rankings_response: OK")


def test_validate_detail_response():
    """Testa a validação de uma resposta de detalhes."""
    valid_response = {
        "ad_id": "123",
        "ad_name": "Test Ad",
        "impressions": 1000,
        "clicks": 50,
        "inline_link_clicks": 30,
        "spend": 10.5,
        "lpv": 20,
        "ctr": 0.05,
        "website_ctr": 0.03,
        "connect_rate": 0.666666,
        "cpm": 10.5,
    }
    
    errors = validate_detail_response(valid_response)
    assert len(errors) == 0, f"Resposta válida gerou erros: {errors}"
    
    print(f"{OK_SYMBOL} validate_detail_response: OK")


def test_validate_history_response():
    """Testa a validação de uma resposta de histórico."""
    valid_response = {
        "data": [
            {
                "date": "2025-01-01",
                "impressions": 1000,
                "clicks": 50,
                "inline_link_clicks": 30,
                "spend": 10.5,
                "lpv": 20,
                "ctr": 0.05,
                "connect_rate": 0.666666,
                "cpm": 10.5,
            }
        ]
    }
    
    errors = validate_history_response(valid_response)
    assert len(errors) == 0, f"Resposta válida gerou erros: {errors}"
    
    print(f"{OK_SYMBOL} validate_history_response: OK")


def test_validate_dashboard_response():
    """Testa a validação de uma resposta de dashboard."""
    valid_response = {
        "totals": {
            "impressions": 10000,
            "clicks": 500,
            "inline_link_clicks": 300,
            "spend": 105.0,
            "lpv": 200,
            "ctr": 0.05,
            "website_ctr": 0.03,
            "connect_rate": 0.666666,
            "cpm": 10.5,
        }
    }
    
    errors = validate_dashboard_response(valid_response)
    assert len(errors) == 0, f"Resposta válida gerou erros: {errors}"
    
    print(f"{OK_SYMBOL} validate_dashboard_response: OK")


def test_validate_averages():
    """Testa a validação do bloco averages."""
    valid_averages = {
        "ctr": 0.05,
        "website_ctr": 0.03,
        "connect_rate": 0.666666,
        "cpm": 10.5,
        "hook": 0.5,
        "hold_rate": 0.7,
        "per_action_type": {
            "action:lead": {
                "results": 10,
                "cpr": 10.5,
                "page_conv": 0.5,
            }
        }
    }
    
    errors = validate_averages(valid_averages)
    assert len(errors) == 0, f"Averages válido gerou erros: {errors}"
    
    # Averages com valor negativo
    invalid_averages = {
        "ctr": -0.05,
    }
    
    errors = validate_averages(invalid_averages)
    assert len(errors) > 0, "Averages com valor negativo não gerou erros"
    
    print(f"{OK_SYMBOL} validate_averages: OK")


def run_all_tests():
    """Executa todos os testes."""
    print("\n" + "="*60)
    print("Executando Testes Unitários dos Validadores de Contrato")
    print("="*60 + "\n")
    
    tests = [
        test_safe_float_eq,
        test_require_non_negative,
        test_validate_ratio_consistency,
        test_validate_rankings_item,
        test_validate_rankings_response,
        test_validate_detail_response,
        test_validate_history_response,
        test_validate_dashboard_response,
        test_validate_averages,
    ]
    
    passed = 0
    failed = 0
    
    for test_func in tests:
        try:
            test_func()
            passed += 1
        except Exception as e:
            print(f"{FAIL_SYMBOL} {test_func.__name__}: FALHOU - {e}")
            failed += 1
            import traceback
            traceback.print_exc()
    
    print("\n" + "="*60)
    print(f"Resultado: {passed} passaram, {failed} falharam")
    print("="*60 + "\n")
    
    return failed == 0


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)


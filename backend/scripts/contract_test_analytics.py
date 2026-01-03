"""Runner de testes de contrato para endpoints de Analytics.

Este script executa testes de integração que validam o contrato dos endpoints
de Analytics, garantindo que:
- Campos essenciais estão presentes
- Valores são não-negativos onde aplicável
- Ratios são consistentes com seus numeradores/denominadores

Uso:
    export ACCESS_TOKEN="seu_token_aqui"
    export BASE_URL="http://localhost:8000"  # opcional
    python backend/scripts/contract_test_analytics.py

Ou defina ACCESS_TOKEN no arquivo .env na raiz do backend.
"""

import os
import sys
import requests
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional

# Tentar carregar .env se disponível
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Adicionar o diretório raiz do backend ao path para importar módulos
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.contracts.analytics_contracts import (
    validate_rankings_response,
    validate_detail_response,
    validate_history_response,
    validate_dashboard_response,
)


# Detectar se estamos no Windows e usar caracteres ASCII simples
IS_WINDOWS = sys.platform == "win32"

class Colors:
    """Códigos ANSI para cores no terminal."""
    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    RESET = "\033[0m"
    BOLD = "\033[1m"


def print_success(msg: str):
    """Imprime mensagem de sucesso."""
    symbol = "[OK]" if IS_WINDOWS else "✓"
    print(f"{Colors.GREEN}{symbol}{Colors.RESET} {msg}")


def print_error(msg: str):
    """Imprime mensagem de erro."""
    symbol = "[ERRO]" if IS_WINDOWS else "✗"
    print(f"{Colors.RED}{symbol}{Colors.RESET} {msg}")


def print_warning(msg: str):
    """Imprime mensagem de aviso."""
    symbol = "[AVISO]" if IS_WINDOWS else "⚠"
    print(f"{Colors.YELLOW}{symbol}{Colors.RESET} {msg}")


def print_info(msg: str):
    """Imprime mensagem informativa."""
    symbol = "[INFO]" if IS_WINDOWS else "ℹ"
    print(f"{Colors.BLUE}{symbol}{Colors.RESET} {msg}")


def print_section(title: str):
    """Imprime título de seção."""
    print(f"\n{Colors.BOLD}{Colors.BLUE}{'='*60}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}{title}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}{'='*60}{Colors.RESET}\n")


class ContractTestRunner:
    """Runner para testes de contrato de endpoints de Analytics."""
    
    def __init__(self, base_url: str, access_token: str):
        self.base_url = base_url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {access_token}"}
        self.errors: List[str] = []
        self.warnings: List[str] = []
        self.tested_endpoints: List[str] = []
    
    def make_request(self, method: str, endpoint: str, **kwargs) -> Optional[Dict[str, Any]]:
        """Faz uma requisição HTTP e retorna a resposta JSON.
        
        Args:
            method: Método HTTP (GET, POST, etc.)
            endpoint: Endpoint relativo (ex: "/analytics/rankings")
            **kwargs: Argumentos adicionais para requests
        
        Returns:
            Resposta JSON ou None se houver erro
        """
        url = f"{self.base_url}{endpoint}"
        
        try:
            if method.upper() == "GET":
                response = requests.get(url, headers=self.headers, **kwargs)
            elif method.upper() == "POST":
                response = requests.post(url, headers=self.headers, **kwargs)
            else:
                raise ValueError(f"Método HTTP não suportado: {method}")
            
            response.raise_for_status()
            return response.json()
        
        except requests.exceptions.RequestException as e:
            error_msg = f"Erro ao chamar {method} {endpoint}: {e}"
            if hasattr(e, "response") and e.response is not None:
                try:
                    error_detail = e.response.json()
                    error_msg += f" - {error_detail}"
                except:
                    error_msg += f" - Status: {e.response.status_code}, Body: {e.response.text[:200]}"
            
            self.errors.append(error_msg)
            print_error(error_msg)
            return None
    
    def test_rankings(self) -> Optional[Dict[str, Any]]:
        """Testa o endpoint POST /analytics/rankings.
        
        Returns:
            Resposta do endpoint ou None se falhar
        """
        print_section("Testando POST /analytics/rankings")
        
        # Calcular datas (últimos 7 dias)
        date_stop = datetime.now().strftime("%Y-%m-%d")
        date_start = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        
        payload = {
            "date_start": date_start,
            "date_stop": date_stop,
            "group_by": "ad_id",
            "limit": 25
        }
        
        print_info(f"Payload: {payload}")
        
        resp = self.make_request("POST", "/analytics/rankings", json=payload)
        
        if resp is None:
            return None
        
        self.tested_endpoints.append("POST /analytics/rankings")
        
        # Validar contrato
        errors = validate_rankings_response(resp)
        
        if errors:
            for err in errors:
                self.errors.append(f"POST /analytics/rankings: {err}")
                print_error(err)
            return None
        
        print_success("Contrato validado com sucesso")
        
        # Verificar se há dados
        data = resp.get("data", [])
        if not data:
            self.warnings.append("POST /analytics/rankings retornou lista vazia")
            print_warning("Resposta contém lista vazia (pode ser esperado se não houver dados)")
            return None
        
        print_success(f"Resposta contém {len(data)} items")
        
        return resp
    
    def test_ad_performance(self) -> Optional[Dict[str, Any]]:
        """Testa o endpoint POST /analytics/ad-performance (alias de /rankings).
        
        Returns:
            Resposta do endpoint ou None se falhar
        """
        print_section("Testando POST /analytics/ad-performance")
        
        date_stop = datetime.now().strftime("%Y-%m-%d")
        date_start = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        
        payload = {
            "date_start": date_start,
            "date_stop": date_stop,
            "group_by": "ad_id",
            "limit": 10
        }
        
        print_info(f"Payload: {payload}")
        
        resp = self.make_request("POST", "/analytics/ad-performance", json=payload)
        
        if resp is None:
            return None
        
        self.tested_endpoints.append("POST /analytics/ad-performance")
        
        errors = validate_rankings_response(resp)
        
        if errors:
            for err in errors:
                self.errors.append(f"POST /analytics/ad-performance: {err}")
                print_error(err)
            return None
        
        print_success("Contrato validado com sucesso")
        return resp
    
    def test_ad_details(self, ad_id: str) -> bool:
        """Testa o endpoint GET /analytics/rankings/ad-id/{ad_id}.
        
        Args:
            ad_id: ID do anúncio a testar
        
        Returns:
            True se passou, False caso contrário
        """
        print_section(f"Testando GET /analytics/rankings/ad-id/{ad_id}")
        
        date_stop = datetime.now().strftime("%Y-%m-%d")
        date_start = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        
        params = {
            "date_start": date_start,
            "date_stop": date_stop
        }
        
        print_info(f"Params: {params}")
        
        resp = self.make_request("GET", f"/analytics/rankings/ad-id/{ad_id}", params=params)
        
        if resp is None:
            return False
        
        self.tested_endpoints.append(f"GET /analytics/rankings/ad-id/{ad_id}")
        
        errors = validate_detail_response(resp)
        
        if errors:
            for err in errors:
                self.errors.append(f"GET /analytics/rankings/ad-id/{ad_id}: {err}")
                print_error(err)
            return False
        
        print_success("Contrato validado com sucesso")
        return True
    
    def test_ad_history(self, ad_id: str) -> bool:
        """Testa o endpoint GET /analytics/rankings/ad-id/{ad_id}/history.
        
        Args:
            ad_id: ID do anúncio a testar
        
        Returns:
            True se passou, False caso contrário
        """
        print_section(f"Testando GET /analytics/rankings/ad-id/{ad_id}/history")
        
        date_stop = datetime.now().strftime("%Y-%m-%d")
        date_start = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        
        params = {
            "date_start": date_start,
            "date_stop": date_stop
        }
        
        print_info(f"Params: {params}")
        
        resp = self.make_request("GET", f"/analytics/rankings/ad-id/{ad_id}/history", params=params)
        
        if resp is None:
            return False
        
        self.tested_endpoints.append(f"GET /analytics/rankings/ad-id/{ad_id}/history")
        
        errors = validate_history_response(resp)
        
        if errors:
            for err in errors:
                self.errors.append(f"GET /analytics/rankings/ad-id/{ad_id}/history: {err}")
                print_error(err)
            return False
        
        print_success("Contrato validado com sucesso")
        
        data = resp.get("data", [])
        if data:
            print_success(f"Resposta contém {len(data)} pontos de histórico")
        
        return True
    
    def test_ad_name_children(self, ad_name: str) -> bool:
        """Testa o endpoint GET /analytics/rankings/ad-name/{ad_name}/children.
        
        Args:
            ad_name: Nome do anúncio a testar
        
        Returns:
            True se passou, False caso contrário
        """
        print_section(f"Testando GET /analytics/rankings/ad-name/{ad_name}/children")
        
        date_stop = datetime.now().strftime("%Y-%m-%d")
        date_start = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        
        params = {
            "date_start": date_start,
            "date_stop": date_stop
        }
        
        print_info(f"Params: {params}")
        
        # URL encode ad_name
        import urllib.parse
        encoded_name = urllib.parse.quote(ad_name, safe="")
        
        resp = self.make_request("GET", f"/analytics/rankings/ad-name/{encoded_name}/children", params=params)
        
        if resp is None:
            return False
        
        self.tested_endpoints.append(f"GET /analytics/rankings/ad-name/{ad_name}/children")
        
        errors = validate_rankings_response(resp)
        
        if errors:
            for err in errors:
                self.errors.append(f"GET /analytics/rankings/ad-name/{ad_name}/children: {err}")
                print_error(err)
            return False
        
        print_success("Contrato validado com sucesso")
        return True
    
    def test_ad_name_history(self, ad_name: str) -> bool:
        """Testa o endpoint GET /analytics/rankings/ad-name/{ad_name}/history.
        
        Args:
            ad_name: Nome do anúncio a testar
        
        Returns:
            True se passou, False caso contrário
        """
        print_section(f"Testando GET /analytics/rankings/ad-name/{ad_name}/history")
        
        date_stop = datetime.now().strftime("%Y-%m-%d")
        date_start = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        
        params = {
            "date_start": date_start,
            "date_stop": date_stop
        }
        
        print_info(f"Params: {params}")
        
        # URL encode ad_name
        import urllib.parse
        encoded_name = urllib.parse.quote(ad_name, safe="")
        
        resp = self.make_request("GET", f"/analytics/rankings/ad-name/{encoded_name}/history", params=params)
        
        if resp is None:
            return False
        
        self.tested_endpoints.append(f"GET /analytics/rankings/ad-name/{ad_name}/history")
        
        errors = validate_history_response(resp)
        
        if errors:
            for err in errors:
                self.errors.append(f"GET /analytics/rankings/ad-name/{ad_name}/history: {err}")
                print_error(err)
            return False
        
        print_success("Contrato validado com sucesso")
        return True
    
    def test_adset_details(self, adset_id: str) -> bool:
        """Testa o endpoint GET /analytics/rankings/adset-id/{adset_id}.
        
        Args:
            adset_id: ID do adset a testar
        
        Returns:
            True se passou, False caso contrário
        """
        print_section(f"Testando GET /analytics/rankings/adset-id/{adset_id}")
        
        date_stop = datetime.now().strftime("%Y-%m-%d")
        date_start = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        
        params = {
            "date_start": date_start,
            "date_stop": date_stop
        }
        
        print_info(f"Params: {params}")
        
        resp = self.make_request("GET", f"/analytics/rankings/adset-id/{adset_id}", params=params)
        
        if resp is None:
            return False
        
        self.tested_endpoints.append(f"GET /analytics/rankings/adset-id/{adset_id}")
        
        errors = validate_detail_response(resp)
        
        if errors:
            for err in errors:
                self.errors.append(f"GET /analytics/rankings/adset-id/{adset_id}: {err}")
                print_error(err)
            return False
        
        print_success("Contrato validado com sucesso")
        return True
    
    def test_dashboard(self) -> bool:
        """Testa o endpoint POST /analytics/dashboard.
        
        Returns:
            True se passou, False caso contrário
        """
        print_section("Testando POST /analytics/dashboard")
        
        date_stop = datetime.now().strftime("%Y-%m-%d")
        date_start = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        
        payload = {
            "date_start": date_start,
            "date_stop": date_stop
        }
        
        print_info(f"Payload: {payload}")
        
        resp = self.make_request("POST", "/analytics/dashboard", json=payload)
        
        if resp is None:
            return False
        
        self.tested_endpoints.append("POST /analytics/dashboard")
        
        errors = validate_dashboard_response(resp)
        
        if errors:
            for err in errors:
                self.errors.append(f"POST /analytics/dashboard: {err}")
                print_error(err)
            return False
        
        print_success("Contrato validado com sucesso")
        return True
    
    def run_all(self) -> int:
        """Executa todos os testes de contrato.
        
        Returns:
            Código de saída (0 = sucesso, 1 = falha)
        """
        print_section("Iniciando Testes de Contrato de Analytics")
        print_info(f"Base URL: {self.base_url}")
        print_info(f"Token: {self.headers['Authorization'][:30]}...")
        
        # 1. Testar rankings (endpoint principal)
        rankings_resp = self.test_rankings()
        
        # 2. Testar ad-performance (alias)
        self.test_ad_performance()
        
        # 3. Se rankings retornou dados, testar endpoints dependentes
        if rankings_resp and rankings_resp.get("data"):
            first_item = rankings_resp["data"][0]
            ad_id = first_item.get("ad_id")
            ad_name = first_item.get("ad_name")
            adset_id = first_item.get("adset_id")
            
            if ad_id:
                self.test_ad_details(ad_id)
                self.test_ad_history(ad_id)
            
            if ad_name:
                self.test_ad_name_children(ad_name)
                self.test_ad_name_history(ad_name)
            
            if adset_id:
                self.test_adset_details(adset_id)
        
        # 4. Testar dashboard
        self.test_dashboard()
        
        # Resumo final
        print_section("Resumo dos Testes")
        print_info(f"Endpoints testados: {len(self.tested_endpoints)}")
        for endpoint in self.tested_endpoints:
            print_success(f"  {endpoint}")
        
        if self.warnings:
            print_warning(f"Avisos: {len(self.warnings)}")
            for warning in self.warnings:
                print_warning(f"  {warning}")
        
        if self.errors:
            print_error(f"Erros encontrados: {len(self.errors)}")
            for error in self.errors:
                print_error(f"  {error}")
            return 1
        
        print_success("Todos os testes de contrato passaram!")
        return 0


def main():
    """Função principal."""
    # Ler variáveis de ambiente
    access_token = os.getenv("ACCESS_TOKEN")
    base_url = os.getenv("BASE_URL", "http://localhost:8000")
    
    if not access_token:
        print_error("Variável de ambiente ACCESS_TOKEN não encontrada")
        print_info("Defina ACCESS_TOKEN antes de executar:")
        print_info("  export ACCESS_TOKEN='seu_token_aqui'")
        print_info("  python backend/scripts/contract_test_analytics.py")
        sys.exit(1)
    
    # Executar testes
    runner = ContractTestRunner(base_url, access_token)
    exit_code = runner.run_all()
    
    sys.exit(exit_code)


if __name__ == "__main__":
    main()


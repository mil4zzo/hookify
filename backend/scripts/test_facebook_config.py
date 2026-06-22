#!/usr/bin/env python3
"""
Script para testar a configuração do Facebook OAuth
"""
import os
import requests
from pathlib import Path
from dotenv import load_dotenv

# Carregar .env
backend_dir = Path(__file__).parent
env_path = backend_dir / ".env"
load_dotenv(env_path)

FACEBOOK_CLIENT_ID = os.getenv("FACEBOOK_CLIENT_ID")
FACEBOOK_CLIENT_SECRET = os.getenv("FACEBOOK_CLIENT_SECRET")
FACEBOOK_TOKEN_URL = os.getenv("FACEBOOK_TOKEN_URL", "https://graph.facebook.com/v24.0/oauth/access_token")

def test_facebook_config():
    print("=== Teste de Configuração Facebook OAuth ===")
    print(f"CLIENT_ID: {FACEBOOK_CLIENT_ID}")
    print(f"CLIENT_SECRET: {'*' * len(FACEBOOK_CLIENT_SECRET) if FACEBOOK_CLIENT_SECRET else 'NÃO CONFIGURADO'}")
    print(f"TOKEN_URL: {FACEBOOK_TOKEN_URL}")
    
    if not FACEBOOK_CLIENT_ID or not FACEBOOK_CLIENT_SECRET:
        print("❌ CLIENT_ID ou CLIENT_SECRET não configurados!")
        return False
    
    print("✅ Configuração básica OK")
    
    # Testar URL de callback comum
    test_redirect_uri = "http://localhost:3000/callback"
    print(f"\n=== Teste de URL de Callback ===")
    print(f"Redirect URI: {test_redirect_uri}")
    
    # Simular uma requisição com código inválido para ver a resposta
    params = {
        'client_id': FACEBOOK_CLIENT_ID,
        'client_secret': FACEBOOK_CLIENT_SECRET,
        'redirect_uri': test_redirect_uri,
        'code': 'INVALID_CODE_FOR_TEST'
    }
    
    try:
        response = requests.get(FACEBOOK_TOKEN_URL, params=params)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.text}")
        
        if response.status_code == 400:
            data = response.json()
            if 'error' in data:
                error = data['error']
                print(f"Erro Facebook: {error.get('message', 'Unknown error')}")
                print(f"Tipo: {error.get('type', 'Unknown type')}")
                print(f"Código: {error.get('code', 'Unknown code')}")
                
                # Verificar se é erro de redirect_uri
                if 'redirect_uri' in error.get('message', '').lower():
                    print("❌ PROBLEMA: URL de callback não configurada no app do Facebook!")
                    print("Solução: Adicione 'http://localhost:3000/callback' nas URLs válidas do app")
                    return False
    except Exception as e:
        print(f"Erro na requisição: {e}")
        return False
    
    return True

if __name__ == "__main__":
    test_facebook_config()

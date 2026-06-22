import requests
import json
import os
from dotenv import load_dotenv

def test_api():
    """Test all API endpoints with a real access token."""
    load_dotenv()
    
    token = os.getenv("ACCESS_TOKEN")
    if not token:
        print("❌ ACCESS_TOKEN não encontrado no .env")
        return
    
    base_url = "http://localhost:8000"
    headers = {"Authorization": f"Bearer {token}"}
    
    print("🧪 Testando API do Hookify Backend...")
    print(f"Base URL: {base_url}")
    print(f"Token: {token[:20]}...")
    print()
    
    # Test 1: Health check
    print("1️⃣ Testando health check...")
    try:
        response = requests.get(f"{base_url}/health")
        print(f"   Status: {response.status_code}")
        print(f"   Response: {response.json()}")
    except Exception as e:
        print(f"   ❌ Erro: {e}")
    print()
    
    # Test 2: /facebook/me
    print("2️⃣ Testando /facebook/me...")
    try:
        response = requests.get(f"{base_url}/facebook/me", headers=headers)
        print(f"   Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"   Nome: {data.get('name', 'N/A')}")
            print(f"   Email: {data.get('email', 'N/A')}")
        else:
            print(f"   ❌ Erro: {response.text}")
    except Exception as e:
        print(f"   ❌ Erro: {e}")
    print()
    
    # Test 3: /facebook/adaccounts
    print("3️⃣ Testando /facebook/adaccounts...")
    try:
        response = requests.get(f"{base_url}/facebook/adaccounts", headers=headers)
        print(f"   Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"   Contas encontradas: {len(data)}")
            if data:
                print(f"   Primeira conta: {data[0].get('name', 'N/A')} ({data[0].get('id', 'N/A')})")
        else:
            print(f"   ❌ Erro: {response.text}")
    except Exception as e:
        print(f"   ❌ Erro: {e}")
    print()
    
    # Test 4: /facebook/ads (com dados reais se disponível)
    print("4️⃣ Testando /facebook/ads...")
    try:
        # Primeiro, vamos pegar uma conta para testar
        accounts_response = requests.get(f"{base_url}/facebook/adaccounts", headers=headers)
        if accounts_response.status_code == 200:
            accounts = accounts_response.json()
            if accounts:
                act_id = accounts[0]["id"]
                payload = {
                    "act_id": act_id,
                    "time_range": {
                        "since": "2024-12-29",
                        "until": "2025-01-05"
                    },
                    "filters": []
                }
                
                response = requests.post(f"{base_url}/facebook/ads", 
                                       headers={**headers, "Content-Type": "application/json"},
                                       json=payload)
                print(f"   Status: {response.status_code}")
                if response.status_code == 200:
                    data = response.json()
                    print(f"   Anúncios retornados: {len(data)}")
                    if data:
                        print(f"   Primeiro anúncio: {data[0].get('ad_name', 'N/A')}")
                else:
                    print(f"   ❌ Erro: {response.text}")
            else:
                print("   ⚠️ Nenhuma conta de anúncio disponível para teste")
        else:
            print("   ❌ Não foi possível obter contas para teste")
    except Exception as e:
        print(f"   ❌ Erro: {e}")
    print()
    
    print("✅ Teste concluído!")

if __name__ == "__main__":
    test_api()

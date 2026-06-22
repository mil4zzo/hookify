import requests
import json
import os
from dotenv import load_dotenv

def test_oauth_endpoint():
    """Test the OAuth token exchange endpoint."""
    load_dotenv()
    
    base_url = "http://localhost:8000"
    
    print("🧪 Testando endpoint OAuth do Backend...")
    print(f"Base URL: {base_url}")
    print()
    
    # Test 1: Health check
    print("1️⃣ Testando health check...")
    try:
        response = requests.get(f"{base_url}/health")
        print(f"   Status: {response.status_code}")
        print(f"   Response: {response.json()}")
    except Exception as e:
        print(f"   ❌ Erro: {e}")
        return
    print()
    
    # Test 2: OAuth endpoint (sem código real)
    print("2️⃣ Testando /facebook/auth/token (sem código válido)...")
    try:
        payload = {
            "code": "invalid_code_for_testing",
            "redirect_uri": "http://localhost:8501/?callback"
        }
        
        response = requests.post(
            f"{base_url}/facebook/auth/token",
            headers={"Content-Type": "application/json"},
            json=payload,
            timeout=30
        )
        
        print(f"   Status: {response.status_code}")
        if response.status_code == 400:
            print("   ✅ Endpoint funcionando (erro esperado para código inválido)")
            print(f"   Response: {response.json()}")
        else:
            print(f"   ⚠️ Status inesperado: {response.text}")
            
    except Exception as e:
        print(f"   ❌ Erro: {e}")
    print()
    
    # Test 3: Verificar configuração
    print("3️⃣ Verificando configuração...")
    try:
        # Tentar fazer uma chamada que requer configuração
        response = requests.get(f"{base_url}/facebook/me", 
                              headers={"Authorization": "Bearer invalid_token"})
        print(f"   Status: {response.status_code}")
        if response.status_code == 401:
            print("   ✅ Endpoint protegido funcionando")
        else:
            print(f"   Response: {response.text}")
    except Exception as e:
        print(f"   ❌ Erro: {e}")
    print()
    
    print("✅ Teste concluído!")
    print()
    print("💡 Para testar com código real:")
    print("   1. Configure FACEBOOK_CLIENT_ID e FACEBOOK_CLIENT_SECRET no backend/.env")
    print("   2. Faça login no Streamlit com use_remote_api=true")
    print("   3. Observe os logs do backend durante o processo")

if __name__ == "__main__":
    test_oauth_endpoint()

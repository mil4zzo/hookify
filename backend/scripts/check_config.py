import os
import sys
from pathlib import Path

# Adicionar o diretório backend ao path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv

def check_backend_config():
    """Verificar se a configuração do backend está correta."""
    print("🔍 Verificando configuração do backend...")
    
    # Carregar .env
    env_path = backend_dir / ".env"
    if not env_path.exists():
        print("❌ Arquivo backend/.env não encontrado!")
        print("💡 Crie o arquivo backend/.env com:")
        print("""
FACEBOOK_CLIENT_ID=1013320407465551
FACEBOOK_CLIENT_SECRET=aff296e102fc1692b97c6c859f314963
FACEBOOK_TOKEN_URL=https://graph.facebook.com/v20.0/oauth/access_token
""")
        return False
    
    load_dotenv(env_path)
    
    # Verificar variáveis
    client_id = os.getenv("FACEBOOK_CLIENT_ID")
    client_secret = os.getenv("FACEBOOK_CLIENT_SECRET")
    token_url = os.getenv("FACEBOOK_TOKEN_URL")
    
    print(f"FACEBOOK_CLIENT_ID: {'✅' if client_id else '❌'} {client_id or 'Não definido'}")
    print(f"FACEBOOK_CLIENT_SECRET: {'✅' if client_secret else '❌'} {client_secret[:10] + '...' if client_secret else 'Não definido'}")
    print(f"FACEBOOK_TOKEN_URL: {'✅' if token_url else '❌'} {token_url or 'Não definido'}")
    
    if not all([client_id, client_secret, token_url]):
        print("\n❌ Configuração incompleta!")
        return False
    
    print("\n✅ Configuração OK!")
    return True

if __name__ == "__main__":
    check_backend_config()

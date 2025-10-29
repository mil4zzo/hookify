# backend/scripts/smoke_graph.py (versão corrigida)
import os
import sys
import json
from pathlib import Path

# Adicionar o diretório backend ao path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
from app.services.graph_api import GraphAPI
from app.services.dataformatter import format_ads_data

if __name__ == "__main__":
    # Carregar .env do diretório backend
    env_path = backend_dir / ".env"
    load_dotenv(env_path)
    
    token = os.getenv("ACCESS_TOKEN")
    if not token:
        raise SystemExit("Defina ACCESS_TOKEN no .env para o smoke test.")

    api = GraphAPI(token)

    print("→ /me")
    me = api.get_account_info()
    print(json.dumps(me, indent=2)[:500], "...\n")

    print("→ /adaccounts")
    accounts = api.get_adaccounts()
    if accounts.get("status") != "success":
        raise SystemExit(f"Erro: {accounts}")
    adaccounts = accounts["data"]
    print(f"Encontradas {len(adaccounts)} contas.")

    if not adaccounts:
        raise SystemExit("Sem contas para testar.")

    act_id = adaccounts[0]["id"]
    tr = {"since": "2024-12-29", "until": "2025-01-05"}
    print(f"→ /ads act_id={act_id} time_range={tr}")
    ads = api.get_ads(act_id, tr, [])
    if isinstance(ads, dict) and ads.get("status") != None:
        raise SystemExit(f"Erro get_ads: {ads}")

    print(f"Retornados {len(ads)} registros de anúncios.")
    df = format_ads_data(ads)
    print("DF colunas:", len(df.columns), "Linhas:", len(df))
    print(df.head(1).to_dict(orient="records"))
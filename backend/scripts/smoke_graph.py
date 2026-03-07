# backend/scripts/smoke_graph.py (versão corrigida)
import os
import sys
import json
from pathlib import Path

# Adicionar o diretório backend ao path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
from app.services.graph_api import GraphAPI, GraphAPIError

if __name__ == "__main__":
    # Carregar .env do diretório backend
    env_path = backend_dir / ".env"
    load_dotenv(env_path)
    
    token = os.getenv("ACCESS_TOKEN")
    if not token:
        raise SystemExit("Defina ACCESS_TOKEN no .env para o smoke test.")

    api = GraphAPI(token)

    print("→ /me (unificado)")
    me = api.get_account_info()
    print(json.dumps(me, indent=2)[:500], "...\n")

    if me.get("status") != "success":
        raise SystemExit(f"Erro em /me: {me}")
    adaccounts = (me.get("data", {}) or {}).get("adaccounts", [])
    print(f"Encontradas {len(adaccounts)} contas.")

    if not adaccounts:
        raise SystemExit("Sem contas para testar.")

    act_id = adaccounts[0]["id"]
    tr = {"since": "2024-12-29", "until": "2025-01-05"}
    print(f"→ start_ads_job act_id={act_id} time_range={tr}")
    try:
        job_id = api.start_ads_job(act_id, tr, [])
        print(f"Job iniciado com sucesso: report_run_id={job_id}")
    except GraphAPIError as e:
        raise SystemExit(f"Erro start_ads_job: {e.status} - {e.message}")
"""
Spike: validar empiricamente o response shape de POST /{campaign_id}/copies.

O que valida (perguntas que a doc do Meta nao responde claramente):
  1. Sync vs async — `copy_campaign(deep_copy=true)` retorna `id` direto, ou
     `async_session_id`, ou ambos? Em quais condicoes?
  2. Estrutura do AsyncSession.result — formato exato apos "Job Completed".
  3. Campo `source_adset` (e `source_ad`) populados em adsets/ads copiados?
  4. Tempo medio de copia (start->Job Completed).

Uso:
  cd backend
  set TEMPLATE_CAMPAIGN_ID=120214012345
  set ACCESS_TOKEN=EAA...
  py -3 scripts/spike_campaign_copy.py

Apos rodar: deletar a campanha de teste manualmente no Ads Manager.
NAO deixa nada em producao alem de uma campanha PAUSED.
"""
import json
import os
import sys
import time
from pathlib import Path

backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
from app.services.graph_api import GraphAPI


def _pretty(obj):
    return json.dumps(obj, indent=2, ensure_ascii=False, default=str)


def main() -> int:
    load_dotenv(backend_dir / ".env")
    token = os.getenv("ACCESS_TOKEN")
    template_campaign_id = os.getenv("TEMPLATE_CAMPAIGN_ID")
    if not token or not template_campaign_id:
        print("Faltam ACCESS_TOKEN e/ou TEMPLATE_CAMPAIGN_ID no .env ou env vars.")
        return 1

    api = GraphAPI(token)

    print(f"\n=== STEP 1: POST /{template_campaign_id}/copies ===\n")
    t0 = time.monotonic()
    copy_resp = api.copy_campaign(
        template_campaign_id,
        {"deep_copy": True, "status_option": "PAUSED"},
    )
    print(f"raw status field: {copy_resp.get('status')}")
    print(f"raw response data:\n{_pretty(copy_resp.get('data'))}")
    if copy_resp.get("status") != "success":
        print(f"FALHOU: {copy_resp}")
        return 1

    data = copy_resp.get("data") or {}
    direct_id = data.get("id") or data.get("copied_campaign_id")
    async_session_id = data.get("async_session_id") or (
        data.get("async_session") or {}
    ).get("id")
    ad_object_ids = data.get("ad_object_ids") or data.get("ad_object_id_map")

    print(f"\nshape detectado:")
    print(f"  direct_id = {direct_id}")
    print(f"  async_session_id = {async_session_id}")
    print(f"  ad_object_ids presente? {bool(ad_object_ids)}")
    if ad_object_ids:
        print(f"  ad_object_ids amostra:\n{_pretty(ad_object_ids)[:1000]}")

    new_campaign_id = direct_id

    if async_session_id and not direct_id:
        print(f"\n=== STEP 2: polling AsyncSession {async_session_id} ===\n")
        sleep_seconds = 2.0
        max_wait = 600
        started = time.monotonic()
        while time.monotonic() - started < max_wait:
            session_resp = api.get_async_session(async_session_id)
            sd = session_resp.get("data") or {}
            status = str(sd.get("status") or "").strip()
            pct = sd.get("percent_completed")
            print(f"  t={int(time.monotonic()-started)}s status={status!r} pct={pct}")
            if status.lower() in {"job completed", "completed"}:
                print(f"\nfull final session payload:\n{_pretty(sd)}")
                result = sd.get("result")
                if isinstance(result, str):
                    try:
                        result = json.loads(result)
                    except Exception:
                        pass
                if isinstance(result, dict):
                    new_campaign_id = (
                        result.get("copied_campaign_id")
                        or result.get("id")
                        or result.get("new_campaign_id")
                    )
                    print(f"\nresult.keys={list(result.keys())}")
                    print(f"new_campaign_id resolvido = {new_campaign_id}")
                break
            if status.lower() in {"job failed", "failed", "job skipped"}:
                print(f"\nFALHOU async: {_pretty(sd)}")
                return 1
            time.sleep(sleep_seconds)
            sleep_seconds = min(sleep_seconds * 1.5, 10.0)
        else:
            print(f"timeout {max_wait}s aguardando async session")
            return 1

    elapsed = int(time.monotonic() - t0)
    print(f"\n=== copy total elapsed = {elapsed}s ===")

    if not new_campaign_id:
        print("nao consegui resolver new_campaign_id — verifique o payload acima.")
        return 1

    print(f"\n=== STEP 3: GET /{new_campaign_id}/adsets?fields=...source_adset ===\n")
    adsets_resp = api.list_campaign_adsets_with_source(new_campaign_id)
    print(_pretty(adsets_resp.get("data")))

    adsets = (adsets_resp.get("data") or {}).get("data") or []
    print(f"\n{len(adsets)} adset(s) copiados. Mapeamento source -> copied:")
    for a in adsets:
        src = (a.get("source_adset") or {}).get("id") if isinstance(a.get("source_adset"), dict) else a.get("source_adset")
        print(f"  source={src}  ->  copied={a.get('id')}  name={a.get('name')!r}  end_time={a.get('end_time')!r}")

    if adsets:
        first_adset_id = adsets[0]["id"]
        print(f"\n=== STEP 4: GET /{first_adset_id}/ads?fields=...source_ad ===\n")
        ads_resp = api.list_adset_ads_with_source(first_adset_id)
        print(_pretty(ads_resp.get("data")))

    print(f"\n=== FIM. Lembre de DELETAR a campanha {new_campaign_id} no Ads Manager ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())

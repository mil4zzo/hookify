"""Teste de ESCRITA contra a Meta real, numa versão escolhida (padrão v26.0).

Roda o código de produção da duplicação de campanha (load_launch_template +
CampaignLaunchProcessor) com tudo PAUSADO, relê o que foi criado, confere a
fidelidade ao modelo, exercita status e orçamento na campanha de teste e APAGA a
campanha criada no fim (--keep para manter). Nada é gravado no banco do Hookify:
itens do job e mídias ficam em memória.

    venv/Scripts/python.exe scripts/meta_write_smoke.py --email voce@x.com --account act_123 [--version v26.0] [--keep]

Parte de documentation/plano-upgrade-graph-api-v26.md (seção 6, teste 4).
"""
from __future__ import annotations

import argparse
import copy
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import meta_version_diff as diff  # noqa: E402  (token do usuário)
from app.routes import campaign_launch as route  # noqa: E402
from app.services import ad_media_library, campaign_launch_service as svc  # noqa: E402
from app.services.graph_api import GraphAPI  # noqa: E402

PREFIX = "[HOOKIFY TESTE v26 — pode apagar]"


class MemoryTracker:
    def __init__(self, payload: Dict[str, Any]):
        self.payload, self.failed = payload, []

    def try_claim_processing(self, job_id): return True
    def release_processing_claim(self, job_id): return True
    def get_payload(self, job_id): return self.payload
    def heartbeat(self, job_id, **kw): return True
    def mark_failed(self, job_id, message, error_code=None): self.failed.append(message)


def check(results: List[str], ok: bool, label: str) -> None:
    results.append(("OK   " if ok else "FALHA") + " " + label)


def find_template(user: Dict[str, Any], api: GraphAPI, act: str):
    ads = (api._handle_graph_request(method="GET", path=f"{act}/ads", operation_name="smoke.ads",
           params={"fields": "id,effective_status,creative{video_id,image_hash,asset_feed_spec{videos,images}}",
                   "effective_status": '["ACTIVE"]', "limit": 50}).get("data") or {}).get("data") or []
    for ad in ads:
        try:
            t = route.load_launch_template(user, ad["id"], api)
        except Exception as exc:  # noqa: BLE001 — modelo inválido, tenta o próximo
            print(f"  modelo {ad['id']} descartado: {str(exc)[:120]}")
            continue
        if not t.blocking_reasons and len(t.creative_template.media_slots) == 1 and t.adsets:
            return t, ads
        print(f"  modelo {ad['id']} descartado: {t.blocking_reasons or 'multi-slot'}")
    raise SystemExit("nenhum anúncio ativo serve de modelo nesta conta")


def pick_media(api: GraphAPI, template, ads: List[Dict[str, Any]], act: str) -> Dict[str, Any]:
    kind = template.creative_template.media_slots[0].media_type
    old_ids = {template.template_creative.get("video_id"), template.template_creative.get("image_hash")}
    for ad in ads:
        c = ad.get("creative") or {}
        vids = [v.get("video_id") for v in ((c.get("asset_feed_spec") or {}).get("videos") or [])] + [c.get("video_id")]
        imgs = [i.get("hash") for i in ((c.get("asset_feed_spec") or {}).get("images") or [])] + [c.get("image_hash")]
        for v in (vids if kind == "video" else []):
            if v and v not in old_ids:
                row = {"id": "smoke-media", "account_id": act.replace("act_", ""), "file_name": "smoke.mp4",
                       "media_type": "video", "video_id": v}
                row["thumbnail_hash"] = ad_media_library._store_thumbnail(api, row)  # caminho real da capa
                return row
        for h in (imgs if kind == "image" else []):
            if h and h not in old_ids:
                return {"id": "smoke-media", "account_id": act.replace("act_", ""), "file_name": "smoke.jpg",
                        "media_type": "image", "image_hash": h}
    raise SystemExit("não achei outra mídia do mesmo tipo do modelo na conta")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", required=True)
    ap.add_argument("--account", required=True)
    ap.add_argument("--version", default="v26.0")
    ap.add_argument("--keep", action="store_true")
    ap.add_argument("--force-fallback", action="store_true", help="simula recusa da cópia do anúncio (testa o plano B)")
    args = ap.parse_args()

    user_id, token = diff.user_token(args.email)
    base = f"https://graph.facebook.com/{args.version}/"
    api = GraphAPI(token, user_id=user_id, base_url=base)
    act = args.account if args.account.startswith("act_") else f"act_{args.account}"
    user = {"user_id": user_id, "token": "smoke"}

    # O script não tem JWT de usuário: troca só as checagens de posse (o token já é do dono).
    route._assert_entity_belongs_to_user = lambda **kw: None
    route._account_api = lambda u, a: (api, None)
    route.META_LAUNCH_GRAPH_BASE_URL = base

    print(f"versão {args.version} · conta {act}\nprocurando anúncio ativo para modelo...")
    t, ads = find_template(user, api, act)
    media = pick_media(api, t, ads, act)
    source_adset = next(a for a in t.adsets if a["is_template_adset"] and not a["blocked_reason"]) if any(
        a["is_template_adset"] for a in t.adsets) else t.adsets[0]
    print(f"modelo: anúncio {t.ad_id} · campanha '{t.campaign.get('name')}' · conjunto '{source_adset['name']}'"
          f" · mídia nova {media.get('video_id') or media.get('image_hash')}\n")

    slot = t.creative_template.media_slots[0].slot_key
    item = {"id": "smoke-item", "position": 1, "ad_name": f"{PREFIX} anúncio",
            "campaign_name": f"{PREFIX} {t.campaign.get('name')}"[:400],
            "adset_name_template": f"{PREFIX} {{template_adset_name}}", "media": {slot: "smoke-media"},
            "status": "pending", "meta_campaign_id": None, "meta_creative_id": None,
            "adsets": [{"source_adset_id": source_adset["id"], "source_adset_name": source_adset["name"],
                        "source_end_time": source_adset.get("end_time")}]}
    store = {item["id"]: item}
    svc.fetch_items = lambda sb, job_id: [copy.deepcopy(i) for i in store.values()]
    svc.update_item = lambda sb, item_id, patch: store[item_id].update(copy.deepcopy(patch))
    ad_media_library.wait_until_ready = lambda *a, **k: {"smoke-media": media}

    payload = {"type": svc.JOB_TYPE, "template_ad_id": t.ad_id, "template_campaign_id": str(t.campaign["id"]),
               "account_id": act.replace("act_", ""), "status": "PAUSED", "total_items": 1, "budget_override": None,
               "creative_template": t.creative_template.to_payload(), "template_creative": t.template_creative,
               "template_ad_fields": t.template_ad_fields}
    tracker = MemoryTracker(payload)
    ctx = svc.LaunchContext(user_jwt="smoke", user_id=user_id, access_token=token, job_id="smoke", account_id=act.replace("act_", ""))
    if args.force_fallback:
        api.copy_ad = lambda *a, **k: {"status": "http_error", "error": {"code": 100, "message": "simulado pelo smoke"}}
    svc.CampaignLaunchProcessor(ctx, api=api, sb=object(), tracker=tracker).run()

    done = store["smoke-item"]
    results: List[str] = []
    campaign_id = done.get("meta_campaign_id")
    check(results, done["status"] == "success", f"duplicação terminou: {done['status']} {done.get('error_message') or ''}")
    if not campaign_id:
        print("\n".join(results)); return
    new_adset = (done["adsets"][0] or {})
    print(f"criado: campanha {campaign_id} · conjunto {new_adset.get('adset_id')} · anúncio {new_adset.get('ad_id')} "
          f"(caminho: {new_adset.get('ad_path')})")
    try:
        g = lambda path, fields: api._handle_graph_request(method="GET", path=path, operation_name="smoke.read", params={"fields": fields}).get("data") or {}  # noqa: E731
        camp = g(campaign_id, "status,effective_status,name")
        check(results, camp.get("status") == "PAUSED", f"campanha pausada ({camp.get('status')})")
        if new_adset.get("adset_id"):
            ads_ = g(new_adset["adset_id"], "status,name,targeting{instagram_positions,messenger_positions,publisher_platforms}")
            check(results, ads_.get("status") == "PAUSED", f"conjunto pausado ({ads_.get('status')})")
            check(results, ads_.get("name", "").startswith(PREFIX), "nome do conjunto interpolado")
        if new_adset.get("ad_id"):
            new_ad = g(new_adset["ad_id"], "status,name,creative{body,title,call_to_action_type,url_tags,object_story_spec,asset_feed_spec,video_id,image_hash,contextual_multi_ads,degrees_of_freedom_spec,media_sourcing_spec}")
            tpl = t.template_creative
            nc = new_ad.get("creative") or {}
            check(results, new_ad.get("status") == "PAUSED", f"anúncio pausado ({new_ad.get('status')})")
            for f in ("body", "title", "call_to_action_type", "url_tags"):
                if tpl.get(f):
                    check(results, nc.get(f) == tpl.get(f), f"criativo.{f} igual ao modelo")
            new_media = str(nc)
            mid = media.get("video_id") or media.get("image_hash")
            check(results, mid in new_media, "mídia nova no criativo")
            feats = lambda c: {k: v.get("enroll_status") for k, v in (((c.get("degrees_of_freedom_spec") or {}).get("creative_features_spec")) or {}).items()}  # noqa: E731
            tf, nf = feats(tpl), feats(nc)
            changed = {k: (tf.get(k), nf.get(k)) for k in set(tf) | set(nf) if tf.get(k) != nf.get(k)}
            check(results, not changed, f"melhorias Advantage+ iguais ao modelo ({len(tf)} recursos){' — diferem: ' + str(changed)[:300] if changed else ''}")
            check(results, (nc.get("contextual_multi_ads") or {}).get("enroll_status") == (tpl.get("contextual_multi_ads") or {}).get("enroll_status"),
                  f"multi-anunciante igual ao modelo ({(nc.get('contextual_multi_ads') or {}).get('enroll_status')})")
            if tpl.get("media_sourcing_spec"):
                check(results, mid in str(nc.get("media_sourcing_spec")), "mídia flexível aponta para a mídia nova")
            old_mid = tpl.get("video_id") or tpl.get("image_hash")
            if old_mid and old_mid != mid:
                check(results, old_mid not in new_media, "mídia do modelo NÃO está no criativo novo")
            # Status: o pipeline real (escreve → relê) no anúncio de teste
            st = api.update_ad_status(new_adset["ad_id"], "PAUSED")
            check(results, st.get("status") == "success", f"escrita de status do anúncio ({st.get('status')})")
        # Orçamento: sobe 1 unidade e volta, onde o modelo guarda orçamento
        level, field = t.budget.get("level"), t.budget.get("field")
        target = campaign_id if level == "campaign" else new_adset.get("adset_id")
        if level and target and field:
            current = api.get_entity_budget_config(target, level)
            before = current.get(field)
            if before:
                up = api.update_entity_budget(target, level, **{field: int(before) + 100})
                back = api.update_entity_budget(target, level, **{field: int(before)})
                check(results, up.get("status") == "success" and back.get("status") == "success",
                      f"orçamento {level}.{field} {before}→{int(before)+100}→{before} ({up.get('status')}/{back.get('status')})")
    finally:
        if not args.keep:
            r = requests.delete(base + campaign_id, params={"access_token": token}, timeout=30)
            check(results, r.ok, f"campanha de teste apagada (HTTP {r.status_code})")
        else:
            results.append(f"MANTIDA campanha {campaign_id} (--keep)")
    print("\n" + "\n".join(results))
    if any(r.startswith("FALHA") for r in results):
        sys.exit(1)


if __name__ == "__main__":
    main()

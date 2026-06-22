"""Smoke test: valida resolução de mídia de posts SHARE via Page Token.

Hipótese: o enricher requisita effective_object_story_id{attachments} com token
de conta de anúncios, que não tem permissão de leitura do post — a Meta devolve
só o ID string. Com Page Access Token (/me/accounts) a expansão deve funcionar.

100% read-only — zero writes na Meta, zero writes no DB.

Usage:
  py scripts/test_share_attachments.py                     # Igor por default
  py scripts/test_share_attachments.py --user-id <prefix>  # outro usuário
  py scripts/test_share_attachments.py --max-pages 3       # limitar batch
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
load_dotenv(backend_dir / ".env")

import requests
from app.core.config import META_GRAPH_BASE_URL, ENCRYPTION_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
from app.core.supabase_client import get_supabase_service
from app.services.token_encryption import decrypt_token

GRAPH_BASE = META_GRAPH_BASE_URL.rstrip("/")
REQUEST_TIMEOUT = 15
ATTACHMENT_FIELDS = "media_type,media,target,type,subattachments,url,title,description"
STORY_FIELDS = f"attachments{{{ATTACHMENT_FIELDS}}}"

_all_checks: List[bool] = []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _graph_get(
    url: str,
    params: Dict[str, str],
    label: str,
) -> Tuple[Optional[Dict], Dict]:
    """GET to Meta Graph API. Returns (data_or_None, rate_limit_headers)."""
    try:
        resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
        headers = {
            k: resp.headers.get(k)
            for k in ("x-business-use-case-usage", "x-app-usage", "x-page-usage", "x-ad-account-usage")
            if resp.headers.get(k)
        }
        data = resp.json()
        if "error" in data:
            err = data["error"]
            print(
                f"  [ERR] {label}: error {err.get('code')} "
                f"subcode={err.get('error_subcode')} -- "
                f"{str(err.get('message',''))[:120]}"
            )
            return None, headers
        return data, headers
    except Exception as exc:
        print(f"  [EXC] {label}: exception {exc}")
        return None, {}


def _check(label: str, condition: bool, detail: str = "") -> bool:
    status = "PASS" if condition else "FAIL"
    icon  = "+" if condition else "-"
    suffix = f" -- {detail}" if detail else ""
    print(f"  [{status}] {icon} {label}{suffix}")
    _all_checks.append(condition)
    return condition


def _extract_creative_field(ad: Dict, field: str) -> Optional[str]:
    creative = ad.get("creative") or {}
    if isinstance(creative, str):
        try:
            creative = json.loads(creative)
        except Exception:
            return None
    return (creative.get(field) or None) if isinstance(creative, dict) else None


def _story_id(ad: Dict) -> Optional[str]:
    return _extract_creative_field(ad, "effective_object_story_id")


def _actor_id(ad: Dict) -> Optional[str]:
    return _extract_creative_field(ad, "actor_id")


def _fetch_attachments(
    story_id: str,
    token: str,
    label: str,
) -> Tuple[List[Dict], Dict]:
    """Returns (attachment_items, rate_headers)."""
    url = f"{GRAPH_BASE}/{story_id}"
    data, headers = _graph_get(url, {"access_token": token, "fields": STORY_FIELDS}, label)
    if not data:
        return [], headers
    items = (data.get("attachments") or {}).get("data") or []
    return items, headers


def _first_media_type_and_target(items: List[Dict]) -> Tuple[Optional[str], Optional[str]]:
    if not items:
        return None, None
    first = items[0]
    media_type = first.get("media_type") or first.get("type")
    target_id = (first.get("target") or {}).get("id")
    return media_type, target_id


# ---------------------------------------------------------------------------
# Etapa 0 — Credenciais
# ---------------------------------------------------------------------------

def load_credentials(user_prefix: str) -> Tuple[str, str]:
    missing = [v for v in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ENCRYPTION_KEY") if not os.getenv(v)]
    if missing:
        raise SystemExit(f"[FATAL] Variáveis faltando em backend/.env: {', '.join(missing)}")

    sb = get_supabase_service()
    rows = (
        sb.table("facebook_connections")
        .select("user_id,access_token,expires_at,facebook_name,status")
        .execute()
        .data
    ) or []

    conn = next((r for r in rows if str(r.get("user_id", "")).startswith(user_prefix)), None)
    if not conn:
        raise SystemExit(
            f"[FATAL] Nenhuma facebook_connection para user_id prefix={user_prefix!r}.\n"
            f"        Conexões disponíveis: {[str(r.get('user_id',''))[:8] for r in rows]}"
        )

    user_id = conn["user_id"]
    token = decrypt_token(conn["access_token"])
    name = conn.get("facebook_name", "?")
    expires = conn.get("expires_at", "?")
    print(f"  Conexão: {name}  user={user_id[:8]}...  expires={expires}")
    return user_id, token


def validate_token(token: str) -> Dict:
    data, _ = _graph_get(f"{GRAPH_BASE}/me", {"access_token": token, "fields": "id,name"}, "/me")
    if not data:
        raise SystemExit(
            "[FATAL] Token expirado ou inválido (erro 190).\n"
            "        Ação: Igor precisa fazer login novamente no app (/login -> conectar Facebook)."
        )
    return data


# ---------------------------------------------------------------------------
# Etapa 1 — Amostragem
# ---------------------------------------------------------------------------

def sample_cases(user_id: str) -> Dict[str, List[Dict]]:
    sb = get_supabase_service()
    fields = "ad_id,ad_name,media_type,primary_video_id,creative,instagram_permalink_url"
    base = [("user_id", "eq", user_id), ("creative->>object_type", "eq", "SHARE")]

    def q(extra: List[Tuple], limit: int) -> List[Dict]:
        qb = sb.table("ads").select(fields)
        for col, op, val in base + extra:
            qb = qb.filter(col, op, val)
        return (qb.limit(limit).execute().data or [])

    return {
        "A_ground_truth": q([("primary_video_id", "not.is", "null"), ("media_type", "eq", "video")], 3),
        "B_video_no_id":  q([("primary_video_id", "is",     "null"), ("media_type", "eq", "video")], 5),
        "C_image":        q([("media_type", "eq", "image")],                                          5),
        "D_unknown":      q([("media_type", "eq", "unknown")],                                        3),
        "E_instagram":    q([("instagram_permalink_url", "not.is", "null")],                          3),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--user-id",   default="c08d94e8", help="Prefixo do user_id (default: Igor)")
    parser.add_argument("--max-pages", type=int, default=3, help="Máx. páginas no check batch (default: 3)")
    args = parser.parse_args()

    report: Dict[str, Any] = {
        "meta": {"timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "user_prefix": args.user_id},
        "checks": {},
        "raw": {},
    }

    # -----------------------------------------------------------------------
    # ETAPA 0 — Credenciais
    # -----------------------------------------------------------------------
    print("\n" + "="*60)
    print("ETAPA 0 — Credenciais")
    print("="*60)
    user_id, user_token = load_credentials(args.user_id)
    me = validate_token(user_token)
    print(f"  Token válido: id={me['id']}  name={me.get('name','?')}")
    report["meta"]["fb_user"] = me
    _check("Token do usuário válido", True, f"fb_user_id={me['id']}")

    # -----------------------------------------------------------------------
    # ETAPA 1 — Amostragem
    # -----------------------------------------------------------------------
    print("\n" + "="*60)
    print("ETAPA 1 — Amostragem DB")
    print("="*60)
    cases = sample_cases(user_id)
    for name, ads in cases.items():
        print(f"  {name}: {len(ads)} ads")
        _check(f"Amostra {name} não vazia", bool(ads), f"{len(ads)} ads")
    report["raw"]["cases_summary"] = {k: len(v) for k, v in cases.items()}

    case_a = cases["A_ground_truth"]
    case_b = cases["B_video_no_id"]
    case_c = cases["C_image"]

    # -----------------------------------------------------------------------
    # CHECK 1 — /me/accounts
    # -----------------------------------------------------------------------
    print("\n" + "="*60)
    print("CHECK 1 — /me/accounts (cobertura de páginas)")
    print("="*60)
    acc_data, _ = _graph_get(
        f"{GRAPH_BASE}/me/accounts",
        {"access_token": user_token, "fields": "id,name,access_token", "limit": "200"},
        "/me/accounts",
    )
    pages_raw = (acc_data or {}).get("data") or []
    page_token_map = {p["id"]: p["access_token"] for p in pages_raw if p.get("id") and p.get("access_token")}
    page_name_map  = {p["id"]: p.get("name", "?")  for p in pages_raw if p.get("id")}
    print(f"  {len(page_token_map)} paginas acessiveis:")
    for pid, pname in page_name_map.items():
        marker = "[token ok]" if pid in page_token_map else "[sem token]"
        print(f"    * {pid} -- {pname}  {marker}")
    report["raw"]["pages"] = pages_raw
    _check("Pelo menos 1 página em /me/accounts", len(page_token_map) > 0, f"{len(page_token_map)} páginas")

    # -----------------------------------------------------------------------
    # CHECK 2 — Controle negativo (user token)
    # -----------------------------------------------------------------------
    print("\n" + "="*60)
    print("CHECK 2 — Controle negativo: user token em story SHARE")
    print("="*60)
    if not case_a:
        print("  SKIP — sem caso A (SHARE com primary_video_id)")
        report["raw"]["check2"] = {"skipped": True}
    else:
        ad_a0 = case_a[0]
        sid_a = _story_id(ad_a0)
        actor_a = _actor_id(ad_a0)
        known_vid = ad_a0.get("primary_video_id")
        print(f"  story_id={sid_a}  actor={actor_a}  known_video_id={known_vid}")
        items_neg, hdrs_neg = _fetch_attachments(sid_a, user_token, "user_token/attachments")
        print(f"  Attachments com user token: {len(items_neg)} itens")
        report["raw"]["check2"] = {"story_id": sid_a, "attachments": items_neg, "headers": hdrs_neg}
        _check(
            "Controle negativo: 0 attachments com user token (documenta causa raiz)",
            len(items_neg) == 0,
            f"got {len(items_neg)} itens",
        )

    # -----------------------------------------------------------------------
    # CHECK 3 — CRITÉRIO CENTRAL: page token + ground truth
    # -----------------------------------------------------------------------
    print("\n" + "="*60)
    print("CHECK 3 — CRITÉRIO CENTRAL: page token + ground truth")
    print("="*60)
    check3_pass = False
    if not case_a:
        print("  SKIP — sem caso A")
        report["raw"]["check3"] = {"skipped": True}
    else:
        check3_report: Dict[str, Any] = {}
        for ad in case_a:
            sid   = _story_id(ad)
            actor = _actor_id(ad)
            known = ad.get("primary_video_id")
            page_tok = page_token_map.get(actor or "")
            print(f"\n  Testando: story={sid}  actor={actor}  known={known}")

            if not page_tok:
                print(f"  SKIP — página {actor} não está em /me/accounts")
                check3_report[sid or "?"] = {"skipped": True, "reason": f"page {actor} not administered"}
                _check(f"Check 3 [{sid[:20] if sid else '?'}]: page token encontrado", False, f"actor {actor} not in pages")
                continue

            items_pg, hdrs_pg = _fetch_attachments(sid, page_tok, f"page_token/{sid[:20] if sid else '?'}")
            mt_pg, target_pg = _first_media_type_and_target(items_pg)
            print(f"  Attachments (page token): {len(items_pg)} itens")
            for i, item in enumerate(items_pg):
                sub_count = len((item.get("subattachments") or {}).get("data") or [])
                print(
                    f"    [{i}] type={item.get('type')}  media_type={item.get('media_type')}  "
                    f"target.id={item.get('target',{}).get('id')}  "
                    f"subattachments={sub_count}  url={str(item.get('url',''))[:60]}"
                )

            match_known = bool(target_pg) and target_pg == known
            check3_report[sid or "?"] = {
                "attachments": items_pg,
                "headers": hdrs_pg,
                "known_video_id": known,
                "target_from_attachment": target_pg,
                "media_type": mt_pg,
                "match_known_video_id": match_known,
            }
            passed = bool(items_pg) and bool(mt_pg)
            if passed:
                check3_pass = True
            _check(f"Check 3a [{sid[:20] if sid else '?'}]: attachments não vazios", bool(items_pg))
            _check(f"Check 3b [{sid[:20] if sid else '?'}]: media_type presente", bool(mt_pg), f"={mt_pg}")
            _check(f"Check 3c [{sid[:20] if sid else '?'}]: target.id == known primary_video_id", match_known, f"target={target_pg}  known={known}")

        report["raw"]["check3"] = check3_report

    # -----------------------------------------------------------------------
    # CHECK 4 — Recuperação de video_id (caso B)
    # -----------------------------------------------------------------------
    print("\n" + "="*60)
    print("CHECK 4 — Recuperação de video_id (caso B: SHARE video sem primary_video_id)")
    print("="*60)
    check4_results: List[Dict] = []
    if not case_b:
        print("  SKIP — sem caso B")
    else:
        for ad in case_b[:3]:
            sid   = _story_id(ad)
            actor = _actor_id(ad)
            if not sid or not actor:
                continue
            page_tok = page_token_map.get(actor)
            if not page_tok:
                print(f"  {sid}: página {actor} não administrada — SKIP")
                continue
            items_b, _ = _fetch_attachments(sid, page_tok, f"case_b/{sid[:20]}")
            mt_b, target_b = _first_media_type_and_target(items_b)
            accessible = False
            if target_b:
                vid_data, _ = _graph_get(
                    f"{GRAPH_BASE}/{target_b}",
                    {"access_token": page_tok, "fields": "id,description"},
                    f"/{target_b}/probe",
                )
                accessible = bool(vid_data)
            print(f"  story={sid}  ->  media_type={mt_b}  target_id={target_b}  accessible={accessible}")
            check4_results.append({
                "story_id": sid, "media_type": mt_b,
                "recovered_video_id": target_b, "accessible": accessible,
            })

    report["raw"]["check4"] = check4_results
    if check4_results:
        _check(
            "Check 4: pelo menos 1 video_id recuperado e acessível",
            any(r.get("accessible") for r in check4_results),
            f"{sum(1 for r in check4_results if r.get('accessible'))}/{len(check4_results)} acessíveis",
        )
    else:
        print("  SKIP — nenhum caso B com página administrada")

    # -----------------------------------------------------------------------
    # CHECK 5 — Imagem via attachments (caso C)
    # -----------------------------------------------------------------------
    print("\n" + "="*60)
    print("CHECK 5 — Imagem via attachments (caso C)")
    print("="*60)
    check5_results: List[Dict] = []
    if not case_c:
        print("  SKIP — sem caso C")
    else:
        for ad in case_c[:3]:
            sid   = _story_id(ad)
            actor = _actor_id(ad)
            if not sid or not actor:
                continue
            page_tok = page_token_map.get(actor)
            if not page_tok:
                print(f"  {sid}: página {actor} não administrada — SKIP")
                continue
            items_c, _ = _fetch_attachments(sid, page_tok, f"case_c/{sid[:20]}")
            mt_c, target_c = _first_media_type_and_target(items_c)
            media_node = (items_c[0].get("media") or {}) if items_c else {}
            img_url = (media_node.get("image") or {}).get("src")
            print(f"  story={sid}  ->  media_type={mt_c}  img_url={str(img_url or '')[:80]}")
            check5_results.append({"story_id": sid, "media_type": mt_c, "image_url": img_url, "target_id": target_c})

    report["raw"]["check5"] = check5_results
    if check5_results:
        _check("Check 5a: media_type=photo via page token", any(r.get("media_type") == "photo" for r in check5_results))
        _check("Check 5b: image URL presente nos attachments", any(r.get("image_url") for r in check5_results))
    else:
        print("  SKIP — nenhum caso C com página administrada")

    # -----------------------------------------------------------------------
    # CHECK 6 — Batch GET por página
    # -----------------------------------------------------------------------
    print("\n" + "="*60)
    print("CHECK 6 — Batch GET (ids= ) por página")
    print("="*60)
    page_to_stories: Dict[str, set] = defaultdict(set)
    for ads_list in cases.values():
        for ad in ads_list:
            actor = _actor_id(ad)
            sid   = _story_id(ad)
            if actor and sid and page_token_map.get(actor):
                page_to_stories[actor].add(sid)

    batch_pages = list(page_to_stories.items())[:args.max_pages or len(page_to_stories)]
    batch6_results: List[Dict] = []

    for page_id, story_ids_set in batch_pages:
        story_list = list(story_ids_set)[:50]
        page_tok = page_token_map[page_id]
        ids_param = ",".join(story_list)
        batch_data, batch_hdrs = _graph_get(
            GRAPH_BASE,
            {"ids": ids_param, "fields": STORY_FIELDS, "access_token": page_tok},
            f"batch/{page_id[:10]}",
        )
        if batch_data:
            print(f"  page={page_id}  requested={len(story_list)}  received={len(batch_data)}")
            for sid, sdata in list(batch_data.items())[:3]:
                if not isinstance(sdata, dict):
                    continue
                items_batch = (sdata.get("attachments") or {}).get("data") or []
                mt_batch, tid_batch = _first_media_type_and_target(items_batch)
                print(f"    {sid}: media_type={mt_batch}  target={tid_batch}")
            batch6_results.append({
                "page_id": page_id,
                "stories_requested": len(story_list),
                "responses_received": len(batch_data),
                "headers": batch_hdrs,
            })
        else:
            batch6_results.append({"page_id": page_id, "stories_requested": len(story_list), "responses_received": 0})

    report["raw"]["check6"] = batch6_results
    if batch6_results:
        _check(
            "Check 6: batch GET funciona com page token",
            any(r.get("responses_received", 0) > 0 for r in batch6_results),
            f"{len(batch6_results)} páginas testadas",
        )
    else:
        print("  SKIP — nenhuma página com histórias para batch")

    # -----------------------------------------------------------------------
    # CHECK 7 — Página não administrada
    # -----------------------------------------------------------------------
    print("\n" + "="*60)
    print("CHECK 7 — Página não administrada (erro documentado)")
    print("="*60)
    all_actors_in_sample = {_actor_id(ad) for ads_list in cases.values() for ad in ads_list} - {None}
    non_admin_actors = [a for a in all_actors_in_sample if a not in page_token_map]

    if non_admin_actors:
        test_actor = non_admin_actors[0]
        test_story = next(
            (_story_id(ad) for ads_list in cases.values() for ad in ads_list if _actor_id(ad) == test_actor and _story_id(ad)),
            None,
        )
        if test_story:
            print(f"  Testando: actor={test_actor} (não administrada)  story={test_story}")
            items_na, hdrs_na = _fetch_attachments(test_story, user_token, f"non_admin/{test_actor[:10]}")
            print(f"  Resultado com user token: {len(items_na)} itens")
            report["raw"]["check7"] = {
                "actor": test_actor, "story_id": test_story,
                "items": items_na, "headers": hdrs_na,
            }
            _check(
                "Check 7: comportamento documentado (esperado: 0 itens com user token)",
                True,
                f"got {len(items_na)} itens",
            )
        else:
            print("  SKIP — sem story_id para página não administrada")
            report["raw"]["check7"] = {"skipped": True}
    else:
        print("  SKIP — todas as páginas nas amostras são administradas")
        report["raw"]["check7"] = {"skipped": True, "reason": "all sample pages administered"}
        _check("Check 7: N/A — cobertura total de páginas nas amostras", True)

    # -----------------------------------------------------------------------
    # CHECK 8 — Rate limit headers
    # -----------------------------------------------------------------------
    print("\n" + "="*60)
    print("CHECK 8 — Rate limit headers")
    print("="*60)
    rl_headers: Dict = {}
    for raw_key in ("check3", "check6"):
        raw = report["raw"].get(raw_key) or {}
        if isinstance(raw, dict):
            for v in raw.values():
                if isinstance(v, dict):
                    rl_headers.update(v.get("headers") or {})
        elif isinstance(raw, list):
            for item in raw:
                rl_headers.update((item or {}).get("headers") or {})
    if rl_headers:
        print(f"  Headers capturados: {json.dumps(rl_headers, indent=4)}")
    else:
        print("  Nenhum header de rate limit (normal para volume baixo)")
    report["raw"]["check8_rate_headers"] = rl_headers
    _check("Check 8: rate limit headers (informativo)", True, f"headers={list(rl_headers.keys()) or 'nenhum'}")

    # -----------------------------------------------------------------------
    # CHECK 9 — Subattachments (carrossel/álbum)
    # -----------------------------------------------------------------------
    print("\n" + "="*60)
    print("CHECK 9 — Subattachments (carrossel/álbum)")
    print("="*60)
    sub_item_found: Optional[Dict] = None

    # Procurar subattachments no que já foi coletado no check 3
    check3_raw = report["raw"].get("check3") or {}
    for sid_key, sid_data in check3_raw.items():
        if isinstance(sid_data, dict):
            for item in (sid_data.get("attachments") or []):
                if item.get("subattachments"):
                    sub_item_found = item
                    break
        if sub_item_found:
            break

    # Se não encontrou, varrer caso B explicitamente
    if not sub_item_found:
        for ad in case_b[:5]:
            sid   = _story_id(ad)
            actor = _actor_id(ad)
            if not sid or not actor or not page_token_map.get(actor):
                continue
            items_ch9, _ = _fetch_attachments(sid, page_token_map[actor], f"check9/{sid[:20]}")
            for item in items_ch9:
                if item.get("subattachments"):
                    sub_item_found = item
                    break
            if sub_item_found:
                break

    if sub_item_found:
        subs = (sub_item_found.get("subattachments") or {}).get("data") or []
        print(f"  Carrossel/álbum encontrado: {len(subs)} subattachments")
        for s in subs[:5]:
            print(f"    • type={s.get('type')}  media_type={s.get('media_type')}  target={s.get('target',{}).get('id')}")
        report["raw"]["check9_subattachments"] = sub_item_found
        _check("Check 9: subattachments documentados", True, f"{len(subs)} itens")
    else:
        print("  Nenhum carrossel/álbum encontrado nas amostras — informativo, não é falha")
        report["raw"]["check9_subattachments"] = None
        _check("Check 9: N/A — sem carrossel nas amostras", True, "informativo")

    # -----------------------------------------------------------------------
    # RESUMO FINAL
    # -----------------------------------------------------------------------
    print("\n" + "="*60)
    print("RESUMO FINAL")
    print("="*60)
    passes = sum(_all_checks)
    fails  = len(_all_checks) - passes
    print(f"  PASS: {passes}/{len(_all_checks)}   FAIL: {fails}/{len(_all_checks)}")

    # Veredicto GO / PARCIAL / NO-GO baseado no check 3
    ch3_raw = report["raw"].get("check3") or {}
    any_attachments   = any(isinstance(v, dict) and v.get("attachments") for v in ch3_raw.values())
    any_target_match  = any(
        isinstance(v, dict) and v.get("match_known_video_id")
        for v in ch3_raw.values()
    )
    if any_attachments and any_target_match:
        verdict = "GO"
        verdict_detail = (
            "Page token resolve attachments + target.id == primary_video_id conhecido. "
            "Fix no enricher APROVADO."
        )
    elif any_attachments:
        verdict = "PARCIAL"
        verdict_detail = (
            "Attachments retornados mas target.id não bate com primary_video_id. "
            "Investigar shape da resposta antes de implementar."
        )
    else:
        verdict = "NO-GO"
        verdict_detail = (
            "Attachments vazio mesmo com page token. "
            "Investigar App Review / scopes (pages_read_engagement, pages_read_user_content)."
        )

    print(f"\n  VEREDICTO: {verdict}")
    print(f"  {verdict_detail}")
    report["verdict"] = {"result": verdict, "detail": verdict_detail, "passes": passes, "fails": fails}

    # -----------------------------------------------------------------------
    # Salvar relatório JSON
    # -----------------------------------------------------------------------
    out_dir = backend_dir / "scripts" / "debug_output"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "share_attachments_report.json"
    with open(out_file, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2, ensure_ascii=False, default=str)
    print(f"\n  Relatório salvo em: {out_file}")
    print("="*60 + "\n")


if __name__ == "__main__":
    main()

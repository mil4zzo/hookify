#!/usr/bin/env python
"""
Teste DIFERENCIAL da migration 162 (Manager em pedaços).

Compara, para os mesmos cenários do diferencial da 161, as LINHAS que o navegador
monta a partir de:

  ANTES   fetch_manager_rankings_v161 (um JSON só, com envelope)
  DEPOIS  fetch_manager_rankings_v162 (uma linha por pedaço), juntada como o
          PostgREST junta uma função SETOF json: `coalesce(json_agg(v), '[]')`

Critério: igualdade exata — linhas, ordem, campos de topo e números (float do
json.loads, que é como o navegador os vê; as razões viraram float8 e têm de dar o
MESMO float). Diferenças esperadas, e só elas:
  - `adcreatives_videos_thumbs` saiu (URLs da Meta; a tela só desenha Storage);
  - `thumb_storage_path` só vai quando não há prefixo do Storage (com prefixo, o
    caminho já está em `thumbnail`).
Cada cenário roda com o prefixo real e sem prefixo (a rota de filhos de campanha).

    py backend/scripts/diff_manager_v162.py                 # laboratório
    py backend/scripts/diff_manager_v162.py --filter ad_id --verbose
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))
sys.path.insert(0, str(AQUI.parent))

import diff_manager_v161 as D  # noqa: E402
import diff_rankings_rollup as R  # noqa: E402
from app.routes import analytics as A  # noqa: E402
from app.services.manager_columns import as_row_payload  # noqa: E402
from app.services.thumbnail_cache import DEFAULT_BUCKET, public_storage_prefix  # noqa: E402

SEP = D.SEP
OLD = "public.fetch_manager_rankings_v161"
NEW = "public.fetch_manager_rankings_v162"


def linhas(texto: str) -> dict:
    return A._normalize_rankings_rpc_response(as_row_payload(json.loads(texto)))


def esperado_da_v161(texto: str, com_prefixo: bool) -> dict:
    out = linhas(texto)
    for row in out.get("data") or []:
        row.pop("adcreatives_videos_thumbs", None)
        if com_prefixo:
            row.pop("thumb_storage_path", None)
    return out


def sql_do_cenario(s: dict, prefixo: str | None) -> str:
    custom = "true" if s.get("include_custom") else "false"
    extra = ", " + custom + ", " + R.q(prefixo)
    claims = json.dumps({"sub": s["actor"], "role": "authenticated"})
    return "\n".join([
        "begin transaction isolation level repeatable read read only;",
        "set local statement_timeout = 0;",
        f"set local request.jwt.claims = {R.q(claims)};",
        "select " + R.q(s["id"])
        + f" || {R.q(SEP)} || {R.call_sql(OLD, s, extra)}::text"
        + f" || {R.q(SEP)} || (select coalesce(json_agg(v), '[]')::text from {R.call_sql(NEW, s, extra)} v);",
        "rollback;",
    ])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=os.environ.get("DIFF_URL", D.LAB))
    ap.add_argument("--filter", default=None)
    ap.add_argument("--only", default=None)
    ap.add_argument("--jobs", type=int, default=3)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    psql = R.find_psql()
    prefixo_real = public_storage_prefix(DEFAULT_BUCKET) or "https://exemplo.supabase.co/storage/v1/object/public/ad-thumbs/"
    meta = R.discover(psql, args.url)
    campanhas = json.loads(R.run_sql(psql, args.url, D.CAMPANHAS_SQL).strip())
    base = D.cenarios(meta, campanhas)
    if args.filter:
        base = [s for s in base if args.filter in s["id"]]
    if args.only:
        base = [s for s in base if s["actor"].startswith(args.only)]
    scen = [(s, prefixo_real) for s in base] + [(s, None) for s in base]
    print(f"{len(scen)} execuções ({len(base)} cenários x com/sem prefixo)", flush=True)

    def rodar(item):
        s, prefixo = item
        out = R.run_sql(psql, args.url, sql_do_cenario(s, prefixo)).strip()
        sid, antes, depois = out.split(SEP)
        a = esperado_da_v161(antes, prefixo is not None)
        b = linhas(depois)
        rotulo = f"{sid} [{'com' if prefixo else 'sem'} prefixo]"
        return rotulo, len(a.get("data") or []), D.comparar(a, b), len(antes), len(depois)

    falhas = linhas_total = bytes_antes = bytes_depois = 0
    with ThreadPoolExecutor(max_workers=args.jobs) as ex:
        for rotulo, n, difs, ba, bd in ex.map(rodar, scen):
            linhas_total += n
            bytes_antes += ba
            bytes_depois += bd
            if difs:
                falhas += 1
                print(f"DIVERGE {rotulo} ({n} linhas)")
                for d in difs:
                    print("   ", d)
            elif args.verbose:
                print(f"ok      {rotulo} ({n} linhas)")

    print(f"\n{len(scen)} execuções, {linhas_total} linhas comparadas, {falhas} divergentes; "
          f"bytes {bytes_antes/1e6:.1f} MB -> {bytes_depois/1e6:.1f} MB")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())

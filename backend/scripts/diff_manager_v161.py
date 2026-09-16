#!/usr/bin/env python
"""
Teste DIFERENCIAL da migration 161 (Manager em colunas).

Compara a RESPOSTA HTTP que o frontend recebia com a que passa a receber:

  ANTES   fetch_manager_rankings_core_v2 (v155 + invólucro)
          -> _normalize_rankings_rpc_response
          -> hidratação Python da rota (miniatura do Storage, transcrição, mídia)
          -> status_resolved
  DEPOIS  fetch_manager_rankings_v161 (colunas)
          -> rows_from_columns (o mesmo que o navegador faz)
          -> _normalize_rankings_rpc_response

Critério: IGUALDADE EXATA, linha a linha, campo a campo, na mesma ordem — e os
campos de topo (averages, header_aggregates, pagination, names, tipos de conversão)
também. Os números são comparados como o navegador os vê (float do json.loads), que
é como a rota antiga os devolvia.

    py backend/scripts/diff_manager_v161.py                      # laboratório
    py backend/scripts/diff_manager_v161.py --url "<prod>" --only 'c08d94e8'  # produção, um usuário
    py backend/scripts/diff_manager_v161.py --filter ad_id --verbose

Cada cenário roda numa transação só-leitura com os claims do ator, como o PostgREST.
Os cenários vêm do diferencial do rollup (todas as abas, eventos, ordenações,
filtros por nome/conta/campanha, paginação, packs compartilhados), com o limite do
Manager (10 mil) — acima dele a v155 corta, e a comparação linha a linha perderia o
sentido. O caso sem corte é conferido à parte: `row_count` = `pagination.total`.

SABOTAGENS (15-16/09): ver o README dos testes (seção 161).
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

import diff_rankings_rollup as R  # noqa: E402
from app.routes import analytics as A  # noqa: E402
from app.services.manager_columns import as_row_payload  # noqa: E402
from app.services.thumbnail_cache import DEFAULT_BUCKET, public_storage_prefix  # noqa: E402

SEP = "\x1f"
OLD = "public.fetch_manager_rankings_core_v2"
NEW = "public.fetch_manager_rankings_v161"
LAB = "postgresql://hookify_lab@127.0.0.1:5432/hookify_lab"
LIMITE_MANAGER = 10000


def http_antes(texto: str) -> dict:
    """O que a rota antiga devolvia, com o código da própria rota."""
    primary = A._normalize_rankings_rpc_response(json.loads(texto))
    rows = primary.get("data") or []
    # sb=None de propósito: com a v155 toda linha já traz as chaves, então nenhuma
    # hidratação deveria ir ao banco. Se alguma for, estoura aqui — e isso é achado.
    A._hydrate_storage_thumbnails_for_rankings_rows(sb=None, user_id=["x"], rows=rows)
    A._hydrate_transcription_flags_for_rankings_rows(sb=None, user_id=["x"], rows=rows)
    A._hydrate_media_type_for_rankings_rows(sb=None, user_id=["x"], rows=rows)
    for row in rows:
        if isinstance(row, dict):
            status = row.get("effective_status")
            row["status_resolved"] = bool(str(status).strip()) if status is not None else False
    return primary


def http_depois(texto: str) -> dict:
    return A._normalize_rankings_rpc_response(as_row_payload(json.loads(texto)))


def comparar(a: dict, b: dict, limite: int = 25) -> list[str]:
    difs: list[str] = []
    if set(a) != set(b):
        difs.append(f"chaves de topo: só antes={sorted(set(a) - set(b))} só depois={sorted(set(b) - set(a))}")
    for k in sorted(set(a) & set(b)):
        if k != "data" and a[k] != b[k]:
            difs.append(f"topo.{k}: antes={str(a[k])[:300]} depois={str(b[k])[:300]}")
    da, db = a.get("data") or [], b.get("data") or []
    if len(da) != len(db):
        difs.append(f"linhas: antes={len(da)} depois={len(db)}")
    for i, (x, y) in enumerate(zip(da, db)):
        if x == y:
            continue
        if set(x) != set(y):
            difs.append(f"linha {i} [{x.get('group_key')}] chaves: só antes={sorted(set(x) - set(y))} só depois={sorted(set(y) - set(x))}")
        for f in sorted(set(x) & set(y)):
            if x[f] != y[f]:
                difs.append(f"linha {i} [{x.get('group_key')}] {f}: antes={x[f]!r:.200} depois={y[f]!r:.200}")
        if len(difs) >= limite:
            difs.append("…")
            break
    return difs


def sql_do_cenario(s: dict, prefixo: str | None) -> str:
    custom = "true" if s.get("include_custom") else "false"
    claims = json.dumps({"sub": s["actor"], "role": "authenticated"})
    return "\n".join([
        "begin transaction isolation level repeatable read read only;",
        "set local statement_timeout = 0;",
        f"set local request.jwt.claims = {R.q(claims)};",
        "select " + R.q(s["id"])
        + f" || {R.q(SEP)} || {R.call_sql(OLD, s, ', ' + custom)}::text"
        + f" || {R.q(SEP)} || {R.call_sql(NEW, s, ', ' + custom + ', ' + R.q(prefixo))}::text;",
        "rollback;",
    ])


CAMPANHAS_SQL = r"""
select coalesce(json_agg(x), '[]')::text from (
  select user_id, pack_id, campaign_id from (
    select d.user_id, d.pack_id, d.campaign_id,
           row_number() over (partition by d.user_id order by sum(d.spend) desc) as rk
    from public.ad_performance_daily d
    where d.campaign_id is not null
    group by d.user_id, d.pack_id, d.campaign_id
  ) t where rk <= 2
) x;
"""


def cenarios(meta: dict, campanhas: list[dict]) -> list[dict]:
    base = R.build_scenarios(meta)
    out = []
    for s in base:
        s = dict(s)
        s.setdefault("limit", LIMITE_MANAGER)
        out.append(s)
        # colunas vinculadas (140) ligadas: outro ramo da função
        if s["id"].endswith("|none") and "|all|" in s["id"]:
            out.append(dict(s, id=s["id"] + "|custom", include_custom=True))
    # Filtro por campanha COM linhas (o do rollup usa uma campanha qualquer do ator e
    # pode voltar vazio). É o uso real: filhos de uma campanha, por conjunto.
    packs = {p["id"]: p for p in meta["packs"]}
    for c in campanhas:
        p = packs.get(c["pack_id"])
        if not p:
            continue
        for g in ("adset_id", "ad_name", "ad_id"):
            out.append(dict(
                id=f"{c['user_id'][:8]}|pack:{p['id'][:8]}|{g}|campanha:{c['campaign_id']}",
                actor=c["user_id"], packs=[p["id"]], ds=p["ds"], de=p["de"], group_by=g,
                action=meta["top_key"].get(p["id"]), campaign_id=c["campaign_id"], limit=LIMITE_MANAGER,
            ))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=os.environ.get("DIFF_URL", LAB))
    ap.add_argument("--filter", default=None, help="substring do id do cenário")
    ap.add_argument("--only", default=None, help="prefixo do user_id (8 chars)")
    ap.add_argument("--jobs", type=int, default=3)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    psql = R.find_psql()
    prefixo = public_storage_prefix(DEFAULT_BUCKET)
    meta = R.discover(psql, args.url)
    campanhas = json.loads(R.run_sql(psql, args.url, CAMPANHAS_SQL).strip())
    scen = cenarios(meta, campanhas)
    if args.filter:
        scen = [s for s in scen if args.filter in s["id"]]
    if args.only:
        scen = [s for s in scen if s["actor"].startswith(args.only)]
    print(f"{len(scen)} cenários | prefixo da miniatura: {prefixo!r}", flush=True)

    def rodar(s: dict):
        out = R.run_sql(psql, args.url, sql_do_cenario(s, prefixo)).strip()
        sid, antes, depois = out.split(SEP)
        a, b = http_antes(antes), http_depois(depois)
        return sid, len(a.get("data") or []), (a.get("pagination") or {}).get("total"), comparar(a, b)

    falhas = 0
    linhas_total = 0
    com_linhas = 0
    with ThreadPoolExecutor(max_workers=args.jobs) as ex:
        for sid, n, total, difs in ex.map(rodar, scen):
            linhas_total += n
            com_linhas += 1 if n else 0
            if difs:
                falhas += 1
                print(f"DIVERGE {sid} ({n} linhas)")
                for d in difs:
                    print("   ", d)
            elif args.verbose:
                print(f"ok      {sid} ({n} linhas de {total})")

    print(f"\n{len(scen)} cenários, {com_linhas} com linhas, {linhas_total} linhas comparadas, {falhas} divergentes")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())

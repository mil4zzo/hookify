#!/usr/bin/env python
"""
Teste DIFERENCIAL da migration 170 (métrica de vídeo não se aplica a imagem).

Compara, nos mesmos cenários do diferencial da 161/162, as LINHAS montadas a partir de:

  ANTES   fetch_manager_rankings_v162 (sem a regra)
  DEPOIS  fetch_manager_rankings_v170 (com a regra)

Aqui a igualdade exata NÃO é o critério — a mudança É o objetivo. O critério é um
CONTRATO, e qualquer coisa fora dele é divergência:

  R1. o conjunto de linhas não muda — EXCETO quando a página é ordenada por métrica
      de vídeo: aí mudar o ranking é o objetivo (no laboratório, o 1º lugar em hook
      era o ADNI90, uma imagem com 1 play). Nesses cenários o teste checa quem entrou
      e quem saiu e exige que os dois lados sejam legítimos: quem sai é imagem ou
      perdeu posição, quem entra é vídeo;
  R2. tudo que não é métrica de vídeo é idêntico (gasto, impressões, cliques, LPV,
      resultados, CPR, nomes, status, miniatura, ordem das linhas…);
  R3. plays e thruplays nunca AUMENTAM (só sai contribuição, nunca entra);
  R4. linha de anúncio/nome marcada `image` fica com as sete métricas de vídeo em 0;
  R5. no grão do anúncio, quem NÃO é `image` (vídeo ou formato desconhecido) fica
      byte a byte igual nos NÚMEROS — a regra não encosta em quem tem certeza de vídeo
      nem em quem não tem certeza nenhuma. O RÓTULO `media_type` é a exceção: a 170 o
      mudou de propósito (era o do NOME, passou a ser o da VARIAÇÃO), e aqui ele é
      conferido contra `public.ads` — não apenas tolerado;
  R6. o ENVELOPE (totais do cabeçalho, médias, paginação, tipos de conversão, nomes)
      só muda no que é métrica de vídeo. Até 20/09 este diferencial comparava apenas
      as linhas: se a regra tivesse mexido no gasto total ou no total da paginação,
      ele teria dito "0 fora do contrato".

    py backend/scripts/diff_manager_v170.py                 # laboratório
    py backend/scripts/diff_manager_v170.py --filter ad_id --verbose
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
OLD = "public.fetch_manager_rankings_v162"
NEW = "public.fetch_manager_rankings_v170"

# Os sete campos que a regra pode mexer, com o nome que chega ao navegador.
VIDEO = ("plays", "video_total_thruplays", "hook", "hold_rate", "scroll_stop",
         "video_watched_p50", "video_watched_p75")
CONTAGEM = ("plays", "video_total_thruplays")     # essas só podem diminuir
ORDEM_DE_VIDEO = {"hook", "hold_rate", "scroll_stop", "plays", "thruplays",
                  "video_watched_p50", "video_watched_p75"}


def linhas(texto: str) -> dict:
    return A._normalize_rankings_rpc_response(as_row_payload(json.loads(texto)))


def sql_do_cenario(s: dict, prefixo: str | None) -> str:
    custom = "true" if s.get("include_custom") else "false"
    extra = ", " + custom + ", " + R.q(prefixo)
    claims = json.dumps({"sub": s["actor"], "role": "authenticated"})
    agg = "select coalesce(json_agg(v), '[]')::text from {call} v"
    return "\n".join([
        "begin transaction isolation level repeatable read read only;",
        "set local statement_timeout = 0;",
        f"set local request.jwt.claims = {R.q(claims)};",
        "select " + R.q(s["id"])
        + f" || {R.q(SEP)} || (" + agg.format(call=R.call_sql(OLD, s, extra)) + ")"
        + f" || {R.q(SEP)} || (" + agg.format(call=R.call_sql(NEW, s, extra)) + ");",
        "rollback;",
    ])


def num(v):
    return float(v) if isinstance(v, (int, float)) else None


def chave(r: dict) -> str:
    return r.get("group_key") or r.get("ad_id")


MIDIA_SQL = """
select coalesce(json_agg(json_build_array(a.ad_id, a.media_type)), '[]')::text
from public.ads a
where a.user_id = any(array[{owners}]::uuid[]) and a.pack_ids && array[{packs}]::uuid[]
"""


def midia_por_anuncio(psql, url, s: dict) -> dict:
    """Formato de cada variação, direto de `public.ads` — a verdade contra a qual o
    rótulo da linha é conferido no grão do anúncio."""
    owners = ", ".join(R.q(o) for o in {s["actor"], *(s.get("owners") or [])})
    packs = ", ".join(R.q(p) for p in (s.get("packs") or []))
    if not packs:
        return {}
    bruto = R.run_sql(psql, url, MIDIA_SQL.format(owners=owners, packs=packs)).strip()
    return {ad: mt for ad, mt in json.loads(bruto or "[]")}


# Campos do cabeçalho que a regra PODE mexer (a média ponderada de vídeo desce dos
# mesmos números das linhas). O resto do envelope tem de ficar idêntico.
CABECALHO_VIDEO = {"hook", "hold_rate", "scroll_stop", "video_watched_p50", "video_watched_p75",
                   "plays", "thruplays", "video_total_thruplays"}


def comparar_envelope(a: dict, b: dict) -> list[str]:
    """R6: tudo fora de `data` — cabeçalho, médias, paginação, nomes, overlap."""
    fora = []
    for bloco in sorted(set(a) | set(b)):
        if bloco == "data":
            continue
        x, y = a.get(bloco), b.get(bloco)
        if isinstance(x, dict) and isinstance(y, dict):
            for sub in sorted(set(x) | set(y)):
                sx, sy = x.get(sub), y.get(sub)
                if isinstance(sx, dict) and isinstance(sy, dict):
                    for campo in sorted(set(sx) | set(sy)):
                        if campo in CABECALHO_VIDEO:
                            continue
                        if sx.get(campo) != sy.get(campo):
                            fora.append(f"R6: {bloco}.{sub}.{campo}: {sx.get(campo)!r} -> {sy.get(campo)!r}")
                elif sub not in CABECALHO_VIDEO and sx != sy:
                    fora.append(f"R6: {bloco}.{sub}: {sx!r} -> {sy!r}")
        elif x != y:
            fora.append(f"R6: {bloco} mudou: {str(x)[:60]!r} -> {str(y)[:60]!r}")
    return fora


def comparar(a: dict, b: dict, grao: str, ordem: str, midia: dict | None = None) -> tuple[list[str], int]:
    """As regras R1..R5. Devolve (violações, linhas que entraram/sairam da pagina)."""
    ra, rb = a.get("data") or [], b.get("data") or []
    fora = []
    if len(ra) != len(rb):
        return [f"R1: {len(ra)} linhas antes, {len(rb)} depois"], 0
    fora += comparar_envelope(a, b)
    da, db = {chave(r): r for r in ra}, {chave(r): r for r in rb}
    trocadas = len(set(da) ^ set(db)) // 2
    if ordem not in ORDEM_DE_VIDEO and [chave(r) for r in ra] != [chave(r) for r in rb]:
        # ordenado por gasto/CPR/CTR/resultados: a ORDEM não pode mudar
        i = next(i for i, (x, y) in enumerate(zip(ra, rb)) if chave(x) != chave(y))
        fora.append(f"R1: ordem mudou sem ser ranking de video (ordem={ordem}): "
                    f"linha {i} era {chave(ra[i])} e virou {chave(rb[i])}")
    if set(da) != set(db):
        if ordem not in ORDEM_DE_VIDEO:
            fora.append(f"R1: a pagina mudou sem ser ranking de video (ordem={ordem}): "
                        f"sairam {sorted(set(da) - set(db))[:3]}, entraram {sorted(set(db) - set(da))[:3]}")
        else:
            # ranking de video: quem SAI tem de ser imagem ou ter perdido posicao; quem
            # ENTRA nao pode ser imagem (imagem nunca sobe num ranking de video)
            entraram = [db[k] for k in set(db) - set(da)]
            imagem_entrou = [chave(r) for r in entraram if r.get("media_type") == "image"]
            if imagem_entrou:
                fora.append(f"R1: imagem ENTROU num ranking de video: {imagem_entrou[:3]}")
    for k in set(da) & set(db):
        x, y = da[k], db[k]
        kx = k
        for campo in set(x) | set(y):
            if campo in VIDEO:
                continue
            if campo in ("row_order", "rank"):
                continue                     # posicao muda quando o ranking muda (R1)
            if campo == "media_type" and grao == "ad_id":
                real = (midia or {}).get(kx)
                if real is not None and y.get(campo) != real:
                    fora.append(f"R5: {kx}.media_type deveria ser o da variacao ({real}), veio {y.get(campo)!r}")
                continue
            if x.get(campo) != y.get(campo):
                fora.append(f"R2: {kx}.{campo}: {x.get(campo)!r} -> {y.get(campo)!r}")
        for campo in CONTAGEM:
            vx, vy = num(x.get(campo)), num(y.get(campo))
            if vx is not None and vy is not None and vy > vx:
                fora.append(f"R3: {kx}.{campo} AUMENTOU: {vx} -> {vy}")
        if x.get("media_type") == "image":
            sobrou = {c: y.get(c) for c in VIDEO if num(y.get(c)) not in (0.0, None)}
            if sobrou:
                fora.append(f"R4: {kx} e imagem e ainda tem metrica de video: {sobrou}")
        if grao == "ad_id" and y.get("media_type") != "image":
            dif = {c: (x.get(c), y.get(c)) for c in VIDEO if x.get(c) != y.get(c)}
            if dif:
                fora.append(f"R5: {kx} ({x.get('media_type')}) mudou sem ser imagem: {dif}")
        if len(fora) > 12:
            fora.append("... (cortado)")
            break
    return fora, trocadas


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
        a, b = linhas(antes), linhas(depois)
        grao = (s.get("group_by") or s.get("grain") or "").strip()
        midia = midia_por_anuncio(psql, args.url, s) if grao == "ad_id" else None
        difs, trocadas = comparar(a, b, grao, (s.get("order_by") or "spend").strip(), midia)
        # quanto a regra mexeu: linhas presentes nos dois lados com métrica de vídeo diferente
        da = {chave(r): r for r in a.get("data") or []}
        db = {chave(r): r for r in b.get("data") or []}
        mexidas = sum(1 for k in set(da) & set(db) if any(da[k].get(c) != db[k].get(c) for c in VIDEO))
        return (f"{sid} [{'com' if prefixo else 'sem'} prefixo]", len(da), difs, mexidas, trocadas)

    falhas = linhas_total = mexidas_total = trocadas_total = 0
    with ThreadPoolExecutor(max_workers=args.jobs) as ex:
        for rotulo, n, difs, mexidas, trocadas in ex.map(rodar, scen):
            linhas_total += n
            mexidas_total += mexidas
            trocadas_total += trocadas
            if difs:
                falhas += 1
                print(f"DIVERGE {rotulo} ({n} linhas)")
                for d in difs:
                    print("   ", d)
            elif args.verbose:
                print(f"ok      {rotulo} ({n} linhas, {mexidas} com metrica de video corrigida"
                      + (f", {trocadas} trocaram de pagina no ranking)" if trocadas else ")"))

    print(f"\n{len(scen)} execuções, {linhas_total} linhas comparadas, {falhas} fora do contrato; "
          f"{mexidas_total} linhas tiveram métrica de vídeo corrigida e "
          f"{trocadas_total} entraram/saíram de página em ranking de vídeo")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())

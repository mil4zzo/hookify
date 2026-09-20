#!/usr/bin/env python
"""
Teste DIFERENCIAL da migration 171 (série e detalhe seguem a regra de imagem).

  SÉRIE    fetch_manager_performance_series_v145  ×  ..._v171   (sparkline do Manager)
  DETALHE  fetch_entity_performance_v158          ×  ..._v171   (modal: totais, série, curva)

Como na 170, igualdade exata não é o critério — a mudança é o objetivo. O contrato:

  R1. o conjunto de grupos e o eixo de dias não mudam;
  R2. tudo que não é métrica de vídeo é idêntico, dia a dia;
  R3. plays e thruplays nunca aumentam;
  R4. grupo SEM nenhuma variação de imagem fica idêntico (a regra não encosta em quem
      é vídeo nem em quem não tem formato definido);
  R5. grupo cujas variações são TODAS imagem: razão de vídeo vem nula e contagem zerada
      — e, no detalhe, sem curva de retenção.

    py backend/scripts/diff_series_v171.py            # laboratório
    py backend/scripts/diff_series_v171.py --packs 3 --nomes 10
"""
from __future__ import annotations

import argparse
import json
import sys

import psycopg

DSN = "host=127.0.0.1 port=5432 dbname=hookify_lab user=hookify_lab password=lab_hookify_2026"

RAZOES_VIDEO = ("hook", "hold_rate", "scroll_stop", "video_watched_p50", "video_watched_p75")
CONTAGENS_VIDEO = ("plays", "thruplays")
VIDEO = RAZOES_VIDEO + CONTAGENS_VIDEO
TOTAIS_VIDEO = ("plays", "thruplays", "hook_wsum", "scroll_stop_wsum", "hold_rate_wsum",
                "video_watched_p50_wsum", "video_watched_p75_wsum")


def num(v):
    return float(v) if isinstance(v, (int, float)) else None


def cenarios(cur, quantos):
    cur.execute("""
        select p.user_id, p.id, p.date_start, p.date_stop, p.name, count(*) as linhas
        from public.packs p
        join public.ad_performance_daily d on d.pack_id = p.id and d.user_id = p.user_id
        group by 1, 2, 3, 4, 5 order by count(*) desc limit %s""", (quantos,))
    return cur.fetchall()


def claims(cur, user_id):
    cur.execute("select set_config('request.jwt.claims', %s, false)",
                (json.dumps({"sub": str(user_id), "role": "authenticated"}),))


def composicao(cur, user_id, pack, grain):
    """Para cada grupo: tem variação de imagem? tem variação que NÃO é imagem?"""
    chave = "a.ad_id" if grain == "ad_id" else "coalesce(nullif(a.ad_name, ''), a.ad_id)"
    cur.execute(f"""
        select {chave} as g,
               bool_or(a.media_type = 'image') as tem_imagem,
               bool_or(a.media_type is distinct from 'image') as tem_outro
        from public.ads a
        where a.user_id = %s and a.pack_ids @> array[%s]::uuid[]
        group by 1""", (user_id, pack))
    return {g: (img, outro) for g, img, outro in cur.fetchall()}


def serie(cur, fn, user_id, pack, ds, de, grain, chaves):
    cur.execute(f"select public.{fn}(%s::uuid, %s::date, %s::date, %s, array[%s]::uuid[],"
                f" null, null, null, null, null, %s::text[], 30)",
                (user_id, ds, de, grain, pack, chaves))
    return (cur.fetchone()[0] or {}).get("series_by_group") or {}


def detalhe(cur, fn, user_id, pack, ds, de, nome):
    cur.execute(f"select public.{fn}(%s::uuid, %s::date, %s::date, 'ad_name', %s, array[%s]::uuid[],"
                f" 'entity', true, 30, false)", (user_id, ds, de, nome, pack))
    grupos = (cur.fetchone()[0] or {}).get("groups") or []
    return grupos[0] if grupos else {}


def confere_serie(antes, depois, comp):
    fora = []
    if set(antes) != set(depois):
        return [f"R1: grupos diferem ({len(set(antes) ^ set(depois))})"]
    for g, a in antes.items():
        b = depois[g]
        if a.get("axis") != b.get("axis"):
            fora.append(f"R1: {g}: eixo de dias mudou")
            continue
        tem_imagem, tem_outro = comp.get(g, (False, True))
        for campo in set(a) | set(b):
            if campo in VIDEO:
                continue
            if a.get(campo) != b.get(campo):
                fora.append(f"R2: {g}.{campo} mudou fora do vídeo")
        for campo in CONTAGENS_VIDEO:
            for i, (x, y) in enumerate(zip(a.get(campo) or [], b.get(campo) or [])):
                if num(x) is not None and num(y) is not None and num(y) > num(x):
                    fora.append(f"R3: {g}.{campo} dia {i} AUMENTOU: {x} -> {y}")
        if not tem_imagem:
            dif = [c for c in VIDEO if a.get(c) != b.get(c)]
            if dif:
                fora.append(f"R4: {g} nao tem imagem e mudou: {dif}")
        elif not tem_outro:
            for campo in RAZOES_VIDEO:
                if any(v is not None for v in (b.get(campo) or [])):
                    fora.append(f"R5: {g} e so imagem e a razao {campo} nao veio nula")
            for campo in CONTAGENS_VIDEO:
                if any(num(v) for v in (b.get(campo) or [])):
                    fora.append(f"R5: {g} e so imagem e {campo} nao zerou")
        if len(fora) > 10:
            fora.append("... (cortado)")
            break
    return fora


def confere_detalhe(a, b, nome, tem_imagem, tem_outro):
    fora = []
    # Os DIAS do modal (o gráfico do detalhe) — até 20/09 este diferencial só olhava os
    # totais e a curva: a 171 reescreveu o CTE diário e ninguém conferia o gasto dia a dia.
    dias_a = {d.get("date"): d for d in (a.get("days") or []) if isinstance(d, dict)}
    dias_b = {d.get("date"): d for d in (b.get("days") or []) if isinstance(d, dict)}
    if set(dias_a) != set(dias_b):
        fora.append(f"R1: {nome}: dias diferem ({len(set(dias_a) ^ set(dias_b))})")
    for dia in sorted(set(dias_a) & set(dias_b)):
        x, y = dias_a[dia], dias_b[dia]
        for campo in set(x) | set(y):
            if campo in TOTAIS_VIDEO:
                continue
            if x.get(campo) != y.get(campo):
                fora.append(f"R2: {nome} dia {dia}.{campo} mudou fora do vídeo: {x.get(campo)} -> {y.get(campo)}")
        if not tem_imagem:
            dif = [c for c in TOTAIS_VIDEO if x.get(c) != y.get(c)]
            if dif:
                fora.append(f"R4: {nome} dia {dia} nao tem imagem e mudou: {dif}")
        elif not tem_outro:
            sobrou = {c: y.get(c) for c in TOTAIS_VIDEO if num(y.get(c))}
            if sobrou:
                fora.append(f"R5: {nome} dia {dia} e so imagem e ainda tem: {sobrou}")
        if len(fora) > 10:
            fora.append("... (cortado)")
            break
    ta, tb = a.get("totals") or {}, b.get("totals") or {}
    for campo in set(ta) | set(tb):
        if campo in TOTAIS_VIDEO:
            continue
        if ta.get(campo) != tb.get(campo):
            fora.append(f"R2: {nome}.totals.{campo} mudou fora do vídeo: {ta.get(campo)} -> {tb.get(campo)}")
    for campo in ("plays", "thruplays"):
        x, y = num(ta.get(campo)), num(tb.get(campo))
        if x is not None and y is not None and y > x:
            fora.append(f"R3: {nome}.totals.{campo} AUMENTOU: {x} -> {y}")
    if not tem_imagem:
        dif = [c for c in TOTAIS_VIDEO if ta.get(c) != tb.get(c)]
        if dif or (a.get("curve_wsum") != b.get("curve_wsum")):
            fora.append(f"R4: {nome} nao tem imagem e mudou: {dif or 'curva'}")
    elif not tem_outro:
        sobrou = {c: tb.get(c) for c in TOTAIS_VIDEO if num(tb.get(c))}
        if sobrou:
            fora.append(f"R5: {nome} e so imagem e ainda tem: {sobrou}")
        if isinstance(b.get("curve_wsum"), list) and b["curve_wsum"]:
            fora.append(f"R5: {nome} e so imagem e ainda tem curva de retencao")
    return fora


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--packs", type=int, default=6)
    ap.add_argument("--nomes", type=int, default=12, help="nomes por pack no teste do detalhe")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    falhas = grupos_total = mexidos = nomes_total = 0
    with psycopg.connect(DSN, autocommit=True) as conn, conn.cursor() as cur:
        cur.execute("set statement_timeout = '300s'")
        for user_id, pack, ds, de, nome_pack, linhas in cenarios(cur, args.packs):
            claims(cur, user_id)
            for grain in ("ad_name", "ad_id"):
                comp = composicao(cur, user_id, pack, grain)
                # As chaves PEDIDAS primeiro as que tem variacao de IMAGEM com play: e onde
                # a regra age. Sem isso o diferencial escolhe 400 grupos quaisquer e passa
                # ileso por nao exercitar nada (foi o que aconteceu na 1a rodada: 4 grupos).
                chave = "d.ad_id" if grain == "ad_id" else "coalesce(nullif(d.ad_name, ''), d.ad_id)"
                cur.execute(f"""
                    select {chave} as g,
                           max(case when a.media_type = 'image' and d.plays > 0 then 1 else 0 end) as tem_espurio
                    from public.ad_performance_daily d
                    join public.ads a on a.user_id = d.user_id and a.ad_id = d.ad_id
                    where d.user_id = %s and d.pack_id = %s and d.date between %s and %s
                    group by 1 order by 2 desc, 1 limit 400""", (user_id, pack, ds, de))
                linhas_chave = cur.fetchall()
                chaves = [g for g, _ in linhas_chave]
                com_espurio = sum(1 for _, e in linhas_chave if e)
                a = serie(cur, "fetch_manager_performance_series_v145", user_id, pack, ds, de, grain, chaves)
                b = serie(cur, "fetch_manager_performance_series_v171", user_id, pack, ds, de, grain, chaves)
                difs = confere_serie(a, b, comp)
                grupos_total += len(a)
                mexidos += sum(1 for g in a if any(a[g].get(c) != b.get(g, {}).get(c) for c in VIDEO))
                rotulo = f"{nome_pack[:26]:26s} serie/{grain}"
                if difs:
                    falhas += 1
                    print(f"DIVERGE {rotulo} ({len(a)} grupos)")
                    for d in difs:
                        print("   ", d)
                elif args.verbose:
                    print(f"ok      {rotulo} ({len(a)} grupos, {com_espurio} com play espurio de imagem)")

            # DETALHE: os nomes com imagem primeiro (é onde a regra age), depois os maiores
            comp = composicao(cur, user_id, pack, "ad_name")
            cur.execute("""select coalesce(nullif(d.ad_name, ''), d.ad_id) g, sum(d.spend) s
                           from public.ad_performance_daily d
                           where d.user_id = %s and d.pack_id = %s and d.date between %s and %s
                           group by 1 order by 2 desc limit 200""", (user_id, pack, ds, de))
            candidatos = [g for g, _ in cur.fetchall()]
            so_imagem = [g for g in candidatos if comp.get(g, (False, True))[0]]
            alvos = (so_imagem + candidatos)[:args.nomes]
            for nome in alvos:
                tem_imagem, tem_outro = comp.get(nome, (False, True))
                x = detalhe(cur, "fetch_entity_performance_v158", user_id, pack, ds, de, nome)
                y = detalhe(cur, "fetch_entity_performance_v171", user_id, pack, ds, de, nome)
                nomes_total += 1
                difs = confere_detalhe(x, y, nome, tem_imagem, tem_outro)
                if difs:
                    falhas += 1
                    print(f"DIVERGE {nome_pack[:26]} detalhe/{nome[:30]}")
                    for d in difs:
                        print("   ", d)

    print(f"\n{grupos_total} grupos de série e {nomes_total} detalhes comparados; "
          f"{falhas} fora do contrato; {mexidos} grupos tiveram métrica de vídeo corrigida")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())

"""Porte da fetch_manager_performance_series_v131 (sparklines) para ad_metrics com
pack na chave. Gera fetch_manager_performance_series_v145 sobre as tabelas REAIS
(ad_performance_daily / ad_metrics ja re-chaveadas pela migration 145).

Mesma disciplina dos outros geradores: cada troca e contada, silencio nao passa,
e nenhuma referencia antiga pode sobrar em codigo.

O QUE TROCA
  keys/pack     fonte = ad_performance_daily (tem a chave de 4 colunas), sem o mapa
                e sem GROUP BY: com o bloqueio de selecao nenhum anuncio-dia se
                repete entre os packs selecionados. Carrega pack_id.
  keys/legado   "sem selecao" = o silo inteiro; GROUP BY (ad, dia) fica — o dedup
                sobrevive onde o bloqueio nao alcanca.
  sel           join no rollup pela PK de 4 colunas.
  EXISTS        filtro por nome de campanha/conjunto pela chave de 4 colunas.

Uso:
  python supabase/tests/port_series_v131_para_pack.py <series_v131.sql> <saida.sql>
"""
import io
import re
import sys

src, dst = sys.argv[1], sys.argv[2]
s = io.open(src, encoding="utf-8").read()


def must(count, what):
    if count == 0:
        sys.exit(f"PORTE FALHOU: nenhuma ocorrencia de {what}")
    print(f"  {what}: {count}x")


s, c = re.subn(r"CREATE FUNCTION public\.fetch_manager_performance_series_v131\(",
               "CREATE OR REPLACE FUNCTION public.fetch_manager_performance_series_v145(", s)
must(c, "cabecalho")

old = """    select
      apm.ad_id,
      apm.metric_date as date,
      (array_agg(apm.user_id order by (apm.user_id = p_user_id), apm.user_id))[1] as user_id
    from unnest(v_owners) as o(owner_id)
    join public.ad_metric_pack_map apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.metric_date >= v_axis_start
     and apm.metric_date <= v_date_stop
    where p_pack_ids is not null
    group by apm.ad_id, apm.metric_date

    union all

    select am.ad_id, am.date, am.user_id
    from public.ad_metrics am
    where p_pack_ids is null
      and am.user_id = p_user_id
      and am.date >= v_axis_start
      and am.date <= v_date_stop"""
new = """    select
      apm.ad_id,
      apm.date as date,
      apm.user_id,
      apm.pack_id
    from unnest(v_owners) as o(owner_id)
    join public.ad_performance_daily apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.date >= v_axis_start
     and apm.date <= v_date_stop
    where p_pack_ids is not null

    union all

    -- Sem selecao = o silo inteiro. Um anuncio-dia em dois packs sao duas linhas:
    -- o GROUP BY devolve uma, com um pack deterministico para o join seguinte.
    select am.ad_id, am.date, p_user_id as user_id,
           (array_agg(am.pack_id order by am.pack_id))[1] as pack_id
    from public.ad_performance_daily am
    where p_pack_ids is null
      and am.user_id = p_user_id
      and am.date >= v_axis_start
      and am.date <= v_date_stop
    group by am.ad_id, am.date"""
must(s.count(old), "keys (pack + legado)")
s = s.replace(old, new, 1)

s, c = re.subn(r"join public\.ad_performance_daily d\s+on d\.user_id = k\.user_id\s+and d\.ad_id = k\.ad_id\s+and d\.date = k\.date",
               "join public.ad_performance_daily d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date", s)
must(c, "sel: join no rollup")

s, c = re.subn(r"from public\.ad_metrics am\s+where am\.user_id = k\.user_id and am\.ad_id = k\.ad_id and am\.date = k\.date",
               "from public.ad_metrics am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date", s)
must(c, "EXISTS filtro por nome")

# Completude: o mapa nao pode sobrar em codigo; ad_metrics/rollup SAO as tabelas-alvo
# agora, entao o que se confere e que todo join neles carrega pack_id.
left = [ln for ln in s.splitlines() if "ad_metric_pack_map" in ln and not ln.lstrip().startswith("--")]
joins_sem_pack = [ln for ln in s.splitlines()
                  if re.search(r"(ad_performance_daily|public\.ad_metrics)\b", ln)
                  and not ln.lstrip().startswith("--")
                  and "pack_id" not in ln
                  and not re.search(r"^\s*(from|join) public\.(ad_performance_daily|ad_metrics) \w+\s*$", ln)]
print(f"  referencias ao mapa em codigo (deve ser 0): {len(left)}")
print(f"  joins sem pack_id na mesma linha (conferir manualmente se > 0): {len(joins_sem_pack)}")
for ln in joins_sem_pack:
    print("    " + ln.strip())
if left:
    sys.exit("PORTE INCOMPLETO")
io.open(dst, "w", encoding="utf-8", newline="").write(s)
print(f"  gerado {dst}")

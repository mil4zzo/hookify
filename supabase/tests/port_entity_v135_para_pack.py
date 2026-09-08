"""Porte MECANICO da fetch_entity_performance_v135 (rotas de detalhe) para tabelas
com pack na chave. Gera `lab_entity_v2`. Instrumento do diferencial, nao a
implementacao final — mesma filosofia do port_v142_para_pack.py.

E a RPC onde o ganho de leitura da re-chaveagem de fato mora: hoje ela parte de
ad_metrics filtrando por ad_name/adset_id (os indices user_name_date_ad, 99 MB,
e user_adset_date — 445 e 21 usos em producao) e depois pergunta ao mapa se o
anuncio-dia esta na selecao. Com o pack na linha, o prefixo (user, pack) da PK
e mais seletivo que qualquer indice por nome, e o mapa sai do caminho.

O QUE TROCA
  keys          fonte = rollup_v2 (tem ad_name/adset_id), prefixo do pack na PK,
                sem EXISTS no mapa; carrega pack_id.
  dedup         fica (rede de seguranca; obrigatorio no caminho sem selecao,
                onde um anuncio-dia em 2 packs aparece 2x); carrega pack_id.
  packs_by_ad   (134) sem a segunda visita ao mapa: array_agg do pack da linha.
  rows_         rollup por (user, pack, ad, date).
  representante join em lab_ad_metrics_v2 com pack = any(selecao) — exato sem
                sobreposicao; a implementacao real poe o pack na codificacao.
  curve         join em lab_ad_metrics_v2 pela PK de 4 colunas (rows_ ja carrega
                pack_id via d.*).

Uso:
  python supabase/tests/port_entity_v135_para_pack.py <entity_v135.sql> <saida.sql>
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


s, c = re.subn(r"CREATE FUNCTION public\.fetch_entity_performance_v135\(",
               "CREATE OR REPLACE FUNCTION public.lab_entity_v2(", s)
must(c, "cabecalho")

old = """    select am.user_id, am.ad_id, am.date
    from unnest(v_owners) as o(owner_id)
    join public.ad_metrics am
      on am.user_id = o.owner_id
     and am.date >= v_date_start
     and am.date <= v_date_stop
     and (
       (v_entity = 'ad_id' and am.ad_id = p_entity_id)
       or (v_entity = 'ad_name' and am.ad_name = p_entity_id)
       or (v_entity = 'adset_id' and am.adset_id = p_entity_id)
     )
    where p_pack_ids is null
       or exists (
         select 1 from public.ad_metric_pack_map apm
         where apm.user_id = am.user_id
           and apm.ad_id = am.ad_id
           and apm.metric_date = am.date
           and apm.pack_id = any(p_pack_ids)
       )"""
new = """    select am.user_id, am.pack_id, am.ad_id, am.date
    from unnest(v_owners) as o(owner_id)
    join public.lab_rollup_v2 am
      on am.user_id = o.owner_id
     and am.date >= v_date_start
     and am.date <= v_date_stop
     and (
       (v_entity = 'ad_id' and am.ad_id = p_entity_id)
       or (v_entity = 'ad_name' and am.ad_name = p_entity_id)
       or (v_entity = 'adset_id' and am.adset_id = p_entity_id)
     )
    where p_pack_ids is null
       or am.pack_id = any(p_pack_ids)"""
must(s.count(old), "keys")
s = s.replace(old, new, 1)

old = "    select k.user_id, k.ad_id, k.date\n    from (\n      select k.*, row_number() over (partition by k.ad_id, k.date"
must(s.count(old), "dedup carrega pack_id")
s = s.replace(old, "    select k.user_id, k.pack_id, k.ad_id, k.date\n    from (\n      select k.*, row_number() over (partition by k.ad_id, k.date", 1)

old = """        array_agg(distinct apm.pack_id) filter (where apm.pack_id is not null),
        array[]::uuid[]
      ) as pack_ids
    from dedup d
    join public.ad_metric_pack_map apm
      on apm.user_id = d.user_id
     and apm.ad_id = d.ad_id
     and apm.metric_date = d.date
     and (p_pack_ids is null or apm.pack_id = any(p_pack_ids))
    group by d.ad_id"""
new = """        array_agg(distinct d.pack_id),
        array[]::uuid[]
      ) as pack_ids
    from dedup d
    group by d.ad_id"""
must(s.count(old), "packs_by_ad sem o mapa")
s = s.replace(old, new, 1)

s, c = re.subn(r"join public\.ad_performance_daily d\s+on d\.user_id = k\.user_id\s+and d\.ad_id = k\.ad_id\s+and d\.date = k\.date",
               "join public.lab_rollup_v2 d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date", s)
must(c, "rows_ no rollup")

s, c = re.subn(r"left join public\.ad_metrics am\s+on am\.user_id = g\.rep_user_id\s+and am\.ad_id = g\.rep_ad_id\s+and am\.date = g\.rep_date",
               "left join public.lab_ad_metrics_v2 am on am.user_id = g.rep_user_id and (p_pack_ids is null or am.pack_id = any(p_pack_ids)) and am.ad_id = g.rep_ad_id and am.date = g.rep_date", s)
must(c, "join do representante")

s, c = re.subn(r"join public\.ad_metrics am\s+on am\.user_id = r\.user_id\s+and am\.ad_id = r\.ad_id\s+and am\.date = r\.date",
               "join public.lab_ad_metrics_v2 am on am.user_id = r.user_id and am.pack_id = r.pack_id and am.ad_id = r.ad_id and am.date = r.date", s)
must(c, "join da curva")

left = [ln for ln in s.splitlines()
        if re.search(r"ad_metric_pack_map|ad_performance_daily|public\.ad_metrics\b", ln)
        and not ln.lstrip().startswith("--")]
print(f"  referencias antigas restantes em codigo (deve ser 0): {len(left)}")
for ln in left:
    print("    " + ln.strip())
if left:
    sys.exit("PORTE INCOMPLETO")
io.open(dst, "w", encoding="utf-8", newline="").write(s)
print(f"  gerado {dst}")

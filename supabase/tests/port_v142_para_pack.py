"""Porte MECANICO da fetch_manager_performance_base_v142 para tabelas com pack na chave.

Gera `lab_manager_v2` (funcao de laboratorio) a partir do texto da v142 extraido
do schema.sql. Nao e a implementacao final — e o instrumento do diferencial: se
`lab_manager_v2` devolve JSON IDENTICO ao da v142 sobre os dados de producao, o
porte esta certo e a cronometragem dele e significativa.

O QUE TROCA (e por que so isso)
  keys/pack    fonte = rollup_v2 (index-only na PK), MESMO group by e MESMO
               vencedor cross-silo; ganha `pack_id` = o pack da linha vencedora.
  keys/legado  "sem selecao" = o silo inteiro, uma linha por anuncio-dia. O
               dedup SOBREVIVE aqui de proposito: o bloqueio governa selecoes,
               nao o caminho sem selecao.
  sel          carrega k.pack_id para os joins seguintes.
  joins        rollup por (user, pack, ad, date) — a PK de 4 colunas.
  EXISTS       filtro por nome de campanha/conjunto, mesma chave de 4 colunas.
  representante sem o pack na codificacao (fica para a implementacao real), o
               join fecha com pack = any(selecao): exato sem sobreposicao, que e
               o invariante que o bloqueio garante.

VARIANTE --simples (a candidata real)
  O ramo por pack de `keys` perde o GROUP BY: com o bloqueio de selecao, nenhum
  anuncio-dia se repete entre os packs selecionados, entao agrupar e trabalho
  morto (vencedor cross-silo, x_cross_silo, bit_or) sobre grupos de 1 linha.
  Medido no lab (jit=off, VACUUM antes, sessao limpa): fiel 1,52-1,55 s,
  simples 1,38-1,41 s, v142 1,59 s — JSON identico nos tres. Sai como
  `lab_manager_v2s`.

Uso:
  python supabase/tests/port_v142_para_pack.py <v142.sql> <saida.sql> [--simples]
"""
import io
import re
import sys

src, dst = sys.argv[1], sys.argv[2]
simples = "--simples" in sys.argv[3:]
s = io.open(src, encoding="utf-8").read()


def must(count, what):
    if count == 0:
        sys.exit(f"PORTE FALHOU: nenhuma ocorrencia de {what}")
    print(f"  {what}: {count}x")


s, c = re.subn(
    r"CREATE FUNCTION public\.fetch_manager_performance_base_v142\(",
    "CREATE OR REPLACE FUNCTION public.lab_manager_v2(", s)
must(c, "cabecalho")

old = """      bit_or(set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, apm.pack_id) - 1, 1)) as pack_mask
    from unnest(v_owners) as o(owner_id)
    join public.ad_metric_pack_map apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.metric_date >= v_date_start
     and apm.metric_date <= v_date_stop
    where p_pack_ids is not null
    group by apm.ad_id, apm.metric_date"""
new = """      bit_or(set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, apm.pack_id) - 1, 1)) as pack_mask,
      (array_agg(apm.pack_id order by (apm.user_id = p_user_id), apm.user_id))[1] as pack_id
    from unnest(v_owners) as o(owner_id)
    join public.lab_rollup_v2 apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.date >= v_date_start
     and apm.date <= v_date_stop
    where p_pack_ids is not null
    group by apm.ad_id, apm.date"""
must(s.count(old), "keys/ramo pack")
s = s.replace(old, new, 1)
s, c = re.subn(r"apm\.metric_date as date,", "apm.date as date,", s)
must(c, "keys/metric_date")

if simples:
    # Sem sobreposicao na selecao (invariante do bloqueio), cada grupo do GROUP BY
    # tem 1 linha: vencedor = a propria linha, x_cross_silo = false, bit_or = o bit.
    old = """    select
      apm.ad_id,
      apm.date as date,
      (array_agg(apm.user_id order by (apm.user_id = p_user_id), apm.user_id))[1] as user_id,
      (min(apm.user_id::text) is distinct from max(apm.user_id::text)) as x_cross_silo,
      bit_or(set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, apm.pack_id) - 1, 1)) as pack_mask,
      (array_agg(apm.pack_id order by (apm.user_id = p_user_id), apm.user_id))[1] as pack_id
    from unnest(v_owners) as o(owner_id)
    join public.lab_rollup_v2 apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.date >= v_date_start
     and apm.date <= v_date_stop
    where p_pack_ids is not null
    group by apm.ad_id, apm.date"""
    new = """    select
      apm.ad_id,
      apm.date as date,
      apm.user_id,
      false as x_cross_silo,
      set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, apm.pack_id) - 1, 1) as pack_mask,
      apm.pack_id
    from unnest(v_owners) as o(owner_id)
    join public.lab_rollup_v2 apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.date >= v_date_start
     and apm.date <= v_date_stop
    where p_pack_ids is not null"""
    must(s.count(old), "keys/ramo pack (--simples)")
    s = s.replace(old, new, 1).replace("FUNCTION public.lab_manager_v2(", "FUNCTION public.lab_manager_v2s(", 1)

old = """    select
      am.ad_id,
      am.date,
      am.user_id,
      false as x_cross_silo,
      coalesce(pm.pack_mask, repeat('0', v_n_packs)::varbit) as pack_mask
    from public.ad_metrics am
    left join lateral (
      select bit_or(set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, apm.pack_id) - 1, 1)) as pack_mask
      from public.ad_metric_pack_map apm
      where apm.user_id = am.user_id and apm.ad_id = am.ad_id and apm.metric_date = am.date
        and apm.pack_id = any(v_pack_universe)
    ) pm on true
    where p_pack_ids is null
      and am.user_id = p_user_id
      and am.date >= v_date_start
      and am.date <= v_date_stop"""
new = """    select
      am.ad_id,
      am.date,
      p_user_id as user_id,
      false as x_cross_silo,
      coalesce(bit_or(set_bit(repeat('0', v_n_packs)::varbit, array_position(v_pack_universe, am.pack_id) - 1, 1)), repeat('0', v_n_packs)::varbit) as pack_mask,
      -- Postgres nao tem min(uuid): "um pack qualquer, deterministico" via array_agg ordenado.
      (array_agg(am.pack_id order by am.pack_id))[1] as pack_id
    from public.lab_rollup_v2 am
    where p_pack_ids is null
      and am.user_id = p_user_id
      and am.date >= v_date_start
      and am.date <= v_date_stop
    group by am.ad_id, am.date"""
must(s.count(old), "keys/ramo legado")
s = s.replace(old, new, 1)

old = "      k.pack_mask,\n      case\n        when v_group_by = 'ad_id' then d.ad_id"
must(s.count(old), "sel/pack_id")
s = s.replace(old, "      k.pack_mask,\n      k.pack_id,\n      case\n        when v_group_by = 'ad_id' then d.ad_id", 1)

s, c = re.subn(
    r"join public\.ad_performance_daily d\s+on d\.user_id = k\.user_id\s+and d\.ad_id = k\.ad_id\s+and d\.date = k\.date",
    "join public.lab_rollup_v2 d on d.user_id = k.user_id and d.pack_id = k.pack_id and d.ad_id = k.ad_id and d.date = k.date", s)
must(c, "joins no rollup")

s, c = re.subn(
    r"from public\.ad_metrics am\s+where am\.user_id = k\.user_id and am\.ad_id = k\.ad_id and am\.date = k\.date",
    "from public.lab_ad_metrics_v2 am where am.user_id = k.user_id and am.pack_id = k.pack_id and am.ad_id = k.ad_id and am.date = k.date", s)
must(c, "EXISTS filtro por nome")

s, c = re.subn(
    r"left join public\.ad_metrics am\s+on am\.user_id = g\.rep_user_id\s+and am\.ad_id = g\.rep_ad_id\s+and am\.date = g\.rep_date",
    "left join public.lab_ad_metrics_v2 am on am.user_id = g.rep_user_id and am.pack_id = any(coalesce(p_pack_ids, v_pack_universe)) and am.ad_id = g.rep_ad_id and am.date = g.rep_date", s)
must(c, "join do representante")

# Completude: nenhuma referencia antiga pode sobrar em CODIGO. Comentarios ficam
# (a v142 cita "ad_performance_daily, migration 129" em prosa na CTE 2).
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

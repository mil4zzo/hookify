"""Monta supabase/migrations/145_ad_metrics_por_pack.sql a partir do template.

Os corpos das RPCs vivas sao GERADOS: extraidos do schema.sql e portados pelos
scripts port_*_para_pack.py (que contam cada troca e recusam referencia antiga
em codigo). Este montador so faz o que nao cabe neles: extrai, renomeia para as
tabelas e nomes reais, ajusta os wrappers, copia os GRANTs e cola no template.

Uso (a partir da raiz do repo):
  python supabase/tests/gerar_migration_145.py

Depois: validar no lab (lab_145_antes.sql -> migration -> lab_145_depois.sql).
"""
import io
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCHEMA = os.path.join(ROOT, "supabase", "schema.sql")
TESTS = os.path.join(ROOT, "supabase", "tests")
TEMPLATE = os.path.join(ROOT, "supabase", "migrations", "145_ad_metrics_por_pack.template.sql")
OUT = os.path.join(ROOT, "supabase", "migrations", "145_ad_metrics_por_pack.sql")

schema = io.open(SCHEMA, encoding="utf-8").read()
work = tempfile.mkdtemp(prefix="mig145_")


def extract(name):
    """Corpo inteiro de CREATE FUNCTION public.<name>( ate o $$; que fecha."""
    m = list(re.finditer(rf"^CREATE FUNCTION public\.{re.escape(name)}\(", schema, re.M))
    if len(m) != 1:
        sys.exit(f"esperava 1 definicao de {name}, achei {len(m)}")
    start = m[0].start()
    end = schema.index("\n$$;\n", start) + len("\n$$;\n")
    body = schema[start:end]
    print(f"  extraida {name}: {body.count(chr(10))} linhas")
    return body


def port(script, src_text, *flags):
    src = os.path.join(work, script + ".in.sql")
    dst = os.path.join(work, script + ".out.sql")
    io.open(src, "w", encoding="utf-8", newline="").write(src_text)
    r = subprocess.run([sys.executable, os.path.join(TESTS, script), src, dst, *flags],
                       capture_output=True, text=True)
    print(r.stdout.rstrip())
    if r.returncode != 0:
        sys.exit(f"{script} falhou:\n{r.stderr}")
    return io.open(dst, encoding="utf-8").read()


def must_replace(text, old, new, what, count=1):
    n = text.count(old)
    if n != count:
        sys.exit(f"{what}: esperava {count} ocorrencia(s) de {old!r}, achei {n}")
    return text.replace(old, new)


def grants_for(old_name, new_name):
    """As linhas GRANT/REVOKE do schema para a funcao antiga, com o nome novo.
    A assinatura e identica (os portes nao mudam parametros)."""
    lines = [ln for ln in schema.splitlines()
             if re.match(rf"^(GRANT|REVOKE) .* ON FUNCTION public\.{re.escape(old_name)}\(", ln)]
    if not lines:
        sys.exit(f"nenhum GRANT para {old_name} no schema.sql")
    out = [f"ALTER FUNCTION public.{new_name}({sig(old_name)}) OWNER TO postgres;"]
    out += [ln.replace(f"public.{old_name}(", f"public.{new_name}(") for ln in lines]
    return "\n".join(out)


def sig(name):
    """Tipos dos parametros, a partir do ALTER FUNCTION ... OWNER do dump."""
    m = re.search(rf"^ALTER FUNCTION public\.{re.escape(name)}\((.*)\) OWNER TO postgres;$", schema, re.M)
    if not m:
        sys.exit(f"sem ALTER FUNCTION OWNER para {name}")
    return m.group(1)


print("=== extraindo e portando ===")
base = port("port_v142_para_pack.py", extract("fetch_manager_performance_base_v142"), "--simples")
base = must_replace(base, "public.lab_manager_v2s(", "public.fetch_manager_performance_base_v145(", "base: nome")
base = base.replace("public.lab_rollup_v2", "public.ad_performance_daily").replace("public.lab_ad_metrics_v2", "public.ad_metrics")

entity = port("port_entity_v135_para_pack.py", extract("fetch_entity_performance_v135"))
entity = must_replace(entity, "public.lab_entity_v2(", "public.fetch_entity_performance_v145(", "entity: nome")
entity = entity.replace("public.lab_rollup_v2", "public.ad_performance_daily").replace("public.lab_ad_metrics_v2", "public.ad_metrics")

series = port("port_series_v131_para_pack.py", extract("fetch_manager_performance_series_v131"))

for txt, what in ((base, "base"), (entity, "entity"), (series, "series")):
    if "lab_" in txt:
        sys.exit(f"{what}: sobrou nome de laboratorio")

# retention_v2: substituicao unica, o ramo dirigido pelo mapa vira filtro por pack.
ret = extract("fetch_manager_rankings_retention_v2")
ret = must_replace(ret, "CREATE FUNCTION public.fetch_manager_rankings_retention_v2(",
                   "CREATE OR REPLACE FUNCTION public.fetch_manager_rankings_retention_v2(", "retention: cabecalho")
ret = must_replace(ret, """    select am.*
    from unnest(v_owners) as o(owner_id)
    join public.ad_metric_pack_map apm
      on apm.user_id = o.owner_id
     and apm.pack_id = any(p_pack_ids)
     and apm.metric_date >= v_date_start
     and apm.metric_date <= v_date_stop
    join public.ad_metrics am
      on am.user_id = apm.user_id
     and am.ad_id = apm.ad_id
     and am.date = apm.metric_date
    where p_pack_ids is not null""", """    select am.*
    from unnest(v_owners) as o(owner_id)
    join public.ad_metrics am
      on am.user_id = o.owner_id
     and am.pack_id = any(p_pack_ids)
     and am.date >= v_date_start
     and am.date <= v_date_stop
    where p_pack_ids is not null""", "retention: ramo por pack")
if "ad_metric_pack_map" in "\n".join(l for l in ret.splitlines() if not l.lstrip().startswith("--")):
    sys.exit("retention: sobrou referencia ao mapa em codigo")
print("  retention_v2: ramo por pack trocado; distinct on (ad_id, date) mantido")

# wrappers: so o nome da base muda
core = extract("fetch_manager_rankings_core_v2")
core = must_replace(core, "CREATE FUNCTION public.fetch_manager_rankings_core_v2(", "CREATE OR REPLACE FUNCTION public.fetch_manager_rankings_core_v2(", "core_v2: cabecalho")
core = must_replace(core, "public.fetch_manager_performance_base_v142(", "public.fetch_manager_performance_base_v145(", "core_v2: chamada da base")
serw = extract("fetch_manager_rankings_series_v2")
serw = must_replace(serw, "CREATE FUNCTION public.fetch_manager_rankings_series_v2(", "CREATE OR REPLACE FUNCTION public.fetch_manager_rankings_series_v2(", "series_v2: cabecalho")
serw = must_replace(serw, "public.fetch_manager_performance_series_v131(", "public.fetch_manager_performance_series_v145(", "series_v2: chamada da serie")

grants = "\n".join([
    grants_for("fetch_manager_performance_base_v142", "fetch_manager_performance_base_v145"),
    grants_for("fetch_manager_performance_series_v131", "fetch_manager_performance_series_v145"),
    grants_for("fetch_entity_performance_v135", "fetch_entity_performance_v145"),
])
comments = "\n".join([
    "COMMENT ON FUNCTION public.fetch_manager_performance_base_v145(" + sig("fetch_manager_performance_base_v142") + ") IS 'Manager (145): base da v142 sobre ad_metrics/ad_performance_daily com pack na chave. keys sem GROUP BY no ramo por pack (o bloqueio de selecao garante 1 pack por anuncio-dia); o ramo sem selecao mantem o dedup. JSON identico a v142 no diferencial.';",
    "COMMENT ON FUNCTION public.fetch_manager_performance_series_v145(" + sig("fetch_manager_performance_series_v131") + ") IS 'Serie diaria do Manager (145): a v131 sobre a chave com pack.';",
    "COMMENT ON FUNCTION public.fetch_entity_performance_v145(" + sig("fetch_entity_performance_v135") + ") IS 'Detalhe de uma entidade (145): a v135 sobre a chave com pack; packs_by_ad sem a segunda visita ao mapa.';",
])

drops_path = os.path.join(TESTS, "drops_145.sql")
if not os.path.exists(drops_path):
    sys.exit(f"faltou {drops_path} (gerado pelo catalogo do lab; ver README)")
drops = io.open(drops_path, encoding="utf-8").read().strip()
if drops.count("DROP FUNCTION") != 17:
    sys.exit(f"drops_145.sql deveria ter 17 DROPs, tem {drops.count('DROP FUNCTION')}")

print("=== montando ===")
tpl = io.open(TEMPLATE, encoding="utf-8").read()
for marker, body in (("-- @@BASE_V145@@", base), ("-- @@SERIES_V145@@", series), ("-- @@ENTITY_V145@@", entity),
                     ("-- @@RETENTION_V2@@", ret), ("-- @@CORE_V2@@", core), ("-- @@SERIES_V2@@", serw),
                     ("-- @@GRANTS_V145@@", grants + "\n" + comments), ("-- @@DROPS@@", drops)):
    tpl = must_replace(tpl, marker, body.rstrip() + "\n", f"marcador {marker}")
# Marcador = linha inteira "-- @@NOME@@". (A prosa do cabecalho cita "@@...@@";
# procurar qualquer "@@" abortava a montagem sem motivo.)
left_markers = re.findall(r"^-- @@\w+@@\s*$", tpl, re.M)
if left_markers:
    sys.exit("marcador sem substituicao: " + str(left_markers))
# nada de laboratorio na migration: os ARTEFATOS, nao o prefixo (o cabecalho
# cita os scripts lab_145_antes/depois de proposito).
for bad in ("lab_rollup_v2", "lab_ad_metrics_v2", "lab_manager_v2", "lab_entity_v2", "lab_key_v2",
            "lab_derive_row_v2", "lab_rollup_apply_v2", "hookify_lab"):
    if bad in tpl:
        sys.exit(f"migration contem {bad!r}")
io.open(OUT, "w", encoding="utf-8", newline="").write(tpl)
print(f"  {OUT}: {tpl.count(chr(10))} linhas")

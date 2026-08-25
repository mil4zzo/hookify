#!/usr/bin/env python
"""
Guarda-chuva do `plan_cache_mode` — gate de CI / pre-deploy.

O QUE ISTO PROTEGE
------------------
RPCs com parametros opcionais (`p_x is null or ...`) so sao rapidas com CUSTOM
plan. O PL/pgSQL cacheia o plano por sessao e, a partir da ~6a execucao na MESMA
conexao, o planner pode adotar o GENERIC plan -- que usa seletividade default e
escolhe um plano catastrofico (medido: 860 ms -> 233.814 ms, ~270x, depois
`57014 statement timeout`). Como o PostgREST mantem conexoes persistentes, o
sintoma e lentidao INTERMITENTE que some quando a query e testada isolada.

O fix e `ALTER FUNCTION ... SET plan_cache_mode = force_custom_plan`.

POR QUE UM GATE, E NAO SO A MIGRATION
-------------------------------------
A correcao ja tinha sido aplicada uma vez, mas o habito de versionar a base em
`_base_vNNN` fez a config **se perder em silencio**: a `fetch_manager_rankings_series_v2`
ficou meses sem protecao e so apareceu na auditoria de 2026-08-24, depois de
contribuir para as queries de 16-18 s que esgotaram o pool e precederam o crash
do Postgres. Migration corrige o passado; gate impede o futuro.

CONTRATO
--------
`public.check_plan_cache_mode_gaps()` deve retornar **zero linhas**.
Qualquer linha = funcao em risco sem a config => este script sai com codigo 1.

USO
---
    py backend/scripts/check_plan_cache_mode.py

Le `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` do ambiente (ou de backend/.env
quando rodado localmente). Em CI, vem dos secrets do repositorio.

CODIGOS DE SAIDA
----------------
    0  nenhuma lacuna -- pode seguir
    1  LACUNA ENCONTRADA -- corrigir antes de mergear/deployar
    2  credenciais ausentes/invalidas (gate nao pode opinar -> nao finge que passou)
    3  falha ao falar com o banco
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    import httpx
except ImportError:
    print("ERRO: httpx nao instalado. Rode: pip install -r backend/requirements.txt")
    sys.exit(2)

RPC_NAME = "check_plan_cache_mode_gaps"
TIMEOUT_S = 30.0


def _load_local_env() -> None:
    """Carrega backend/.env quando rodando na maquina do dev.

    Em CI as vars vem do ambiente e este passo nao encontra arquivo -- tudo bem.
    Nao sobrescreve o que ja existe no ambiente (CI tem precedencia).
    """
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = value.strip().strip('"').strip("'")


def main() -> int:
    _load_local_env()

    url = (os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()

    if not url or not key:
        print("ERRO: SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY ausentes.")
        print()
        print("Este gate NAO passa em silencio quando nao consegue checar --")
        print("um alarme que sempre passa e pior que nenhum alarme.")
        print()
        print("Em CI: configure os secrets do repositorio.")
        print("Local: preencha backend/.env")
        return 2

    endpoint = f"{url}/rest/v1/rpc/{RPC_NAME}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    try:
        resp = httpx.post(endpoint, headers=headers, json={}, timeout=TIMEOUT_S)
    except Exception as exc:
        print(f"ERRO: falha ao contatar o banco: {type(exc).__name__}: {exc}")
        return 3

    if resp.status_code == 404:
        print(f"ERRO: a funcao public.{RPC_NAME}() nao existe no banco.")
        print("Aplique a migration 120_plan_cache_mode_guardrail.sql.")
        return 3

    if resp.status_code != 200:
        print(f"ERRO: banco respondeu HTTP {resp.status_code}: {resp.text[:400]}")
        return 3

    try:
        gaps = resp.json()
    except Exception:
        print(f"ERRO: resposta nao e JSON: {resp.text[:400]}")
        return 3

    if not isinstance(gaps, list):
        print(f"ERRO: formato inesperado na resposta: {gaps!r}")
        return 3

    if not gaps:
        print("OK: nenhuma RPC em risco sem plan_cache_mode=force_custom_plan.")
        return 0

    print("=" * 78)
    print(f"FALHOU: {len(gaps)} funcao(oes) em risco SEM plan_cache_mode=force_custom_plan")
    print("=" * 78)
    print()
    for gap in gaps:
        nome = gap.get("funcao") if isinstance(gap, dict) else str(gap)
        print(f"  - {nome}")
    print()
    print("POR QUE ISTO BLOQUEIA: funcao com parametro opcional sem essa config")
    print("degrada ~270x a partir da 6a execucao na mesma conexao do PostgREST e")
    print("vira statement timeout (57014) intermitente em producao.")
    print()
    print("COMO CORRIGIR: numa migration nova, para cada funcao acima:")
    print()
    for gap in gaps:
        nome = gap.get("funcao") if isinstance(gap, dict) else str(gap)
        print(f"  alter function {nome} set plan_cache_mode = force_custom_plan;")
    print()
    print("Se a funcao foi recriada a partir de uma versao anterior, lembre de")
    print("herdar o ALTER junto -- e assim que a config se perde em silencio.")
    return 1


if __name__ == "__main__":
    sys.exit(main())

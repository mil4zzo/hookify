# -*- coding: utf-8 -*-
"""Guardas globais da suite.

O registro de autoria (P3.5) e fire-and-forget: `log_pack_action` empurra um
insert para um ThreadPoolExecutor e segue. Isso e certo em producao e perigoso
em teste — qualquer rota instrumentada que a suite exercite tentaria escrever no
Supabase REAL, com dados de fixture. A primeira execucao provou: as chamadas
sairam de fato e so nao gravaram porque os uuids falsos ('guest-9') foram
recusados pelo Postgres. Com um uuid valido teriam entrado.

O fixture abaixo intercepta a camada de persistencia e guarda as linhas em
memoria, para que um teste possa inspecionar o que SERIA gravado.
"""
import pytest

from app.services import pack_action_log


@pytest.fixture(autouse=True)
def _no_real_action_log(monkeypatch):
    """Nenhum insert real de pack_action_log durante a suite."""
    captured = []

    def _fake_submit(fn, *args, **kwargs):
        # Executa sincronamente ate a borda do banco, sem tocar no banco: o
        # caminho de montagem da linha CONTINUA sendo exercitado.
        if args:
            captured.append(args[0])
        return None

    monkeypatch.setattr(pack_action_log._persist_pool, "submit", _fake_submit)
    return captured

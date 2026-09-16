"""
O banco desiste antes do cliente — o invariante em forma de teste.

CONTEXTO (2026-09-15)
---------------------
Quando o backend desiste de esperar antes do banco, a consulta CONTINUA rodando
lá dentro, sem ninguém para ler o resultado — a "consulta órfã". Medido em
produção: um cliente que desiste em 0,15 s de uma leitura de ~3 s deixa o banco
trabalhando por mais de 1 s depois.

Estava assim em 15/09, antes da migration 159:

    caminho                    teto do banco   teto do cliente   resultado
    -------------------------- --------------- ----------------- ---------
    Manager /rankings          30 s            35 s              ok
    detalhe / variações        30 s            15 s              ÓRFÃ
    detect_pack_conflicts      25 s (função)   15 s              ÓRFÃ
    refresh (service_role)      8 s            15 s              ok

As duas linhas desalinhadas eram exatamente as duas que deram problema.

Este arquivo prova o LADO DO BACKEND do invariante (o lado do banco vive na
migration 159, que carrega a própria prova). Vale para todo caminho que monta
cliente, inclusive os que passam um valor próprio.

SABOTAGEM (feita em 15/09)
--------------------------
Voltar `POSTGREST_TIMEOUT_SECONDS` para 15.0 faz
`test_teto_padrao_acima_do_banco` falhar. Voltar o piso de
`_coerce_postgrest_timeout` para `max(1.0, ...)` faz
`test_valor_pequeno_de_quem_chama_nao_inverte_a_ordem` falhar. Conferido.
"""

import unittest

from httpx import Timeout

from app.core import config
from app.core import supabase_client


class TestOrdemDosTempos(unittest.TestCase):
    def test_teto_padrao_acima_do_banco(self) -> None:
        self.assertGreater(
            supabase_client.POSTGREST_TIMEOUT_SECONDS,
            config.DB_READ_STATEMENT_TIMEOUT_SECONDS,
            "o cliente tem de esperar mais que o banco, senão sobra consulta órfã",
        )

    def test_teto_do_manager_acima_do_banco(self) -> None:
        # Este vem do .env da VPS, que o repositório não controla — por isso o
        # piso está no código e não só no arquivo de ambiente. A função do Manager
        # tem teto próprio no banco (164), maior que o do papel.
        self.assertGreater(
            config.ANALYTICS_MANAGER_POSTGREST_TIMEOUT_SECONDS,
            config.MANAGER_STATEMENT_TIMEOUT_SECONDS,
        )
        self.assertGreater(config.MANAGER_STATEMENT_TIMEOUT_SECONDS, config.DB_READ_STATEMENT_TIMEOUT_SECONDS)

    def test_env_pequeno_nao_inverte_a_ordem_do_manager(self) -> None:
        import importlib
        import os
        os.environ["ANALYTICS_MANAGER_POSTGREST_TIMEOUT_SECONDS"] = "30"
        try:
            self.assertGreaterEqual(
                importlib.reload(config).ANALYTICS_MANAGER_POSTGREST_TIMEOUT_SECONDS,
                config.MIN_MANAGER_READ_TIMEOUT_SECONDS,
            )
        finally:
            del os.environ["ANALYTICS_MANAGER_POSTGREST_TIMEOUT_SECONDS"]
            importlib.reload(config)

    def test_constante_bate_com_a_migration(self) -> None:
        # O banco manda (migration 164); a constante é o espelho que o backend usa
        # para garantir a ordem. Mudou um, muda o outro.
        import re
        from pathlib import Path
        sql = (Path(__file__).resolve().parents[2] / "supabase" / "migrations" / "164_manager_espera_40s.sql").read_text(encoding="utf-8")
        valores = set(re.findall(r"SET statement_timeout TO '(\d+)s'", sql))
        self.assertEqual(valores, {str(int(config.MANAGER_STATEMENT_TIMEOUT_SECONDS))})

    def test_valor_pequeno_de_quem_chama_nao_inverte_a_ordem(self) -> None:
        # Alguém pedindo "espere só 3 s" recriaria a consulta órfã em silêncio.
        self.assertGreaterEqual(
            supabase_client._coerce_postgrest_timeout(3.0),
            config.MIN_POSTGREST_READ_TIMEOUT_SECONDS,
        )

    def test_valor_invalido_cai_no_padrao(self) -> None:
        self.assertEqual(
            supabase_client._coerce_postgrest_timeout("nao é número"),  # type: ignore[arg-type]
            supabase_client.POSTGREST_TIMEOUT_SECONDS,
        )
        self.assertEqual(
            supabase_client._coerce_postgrest_timeout(None),
            supabase_client.POSTGREST_TIMEOUT_SECONDS,
        )


class TestOrcamentoPorFase(unittest.TestCase):
    """Um número só viraria teto de tudo — inclusive esperar 25 s para abrir conexão."""

    def test_monta_timeout_granular(self) -> None:
        t = supabase_client._postgrest_timeout(25.0)
        self.assertIsInstance(t, Timeout)
        self.assertEqual(t.read, 25.0)
        self.assertEqual(t.connect, supabase_client._CONNECT_TIMEOUT_SECONDS)
        self.assertEqual(t.write, supabase_client._WRITE_TIMEOUT_SECONDS)
        self.assertEqual(t.pool, supabase_client._POOL_TIMEOUT_SECONDS)

    def test_conectar_nao_herda_o_teto_de_leitura(self) -> None:
        t = supabase_client._postgrest_timeout(25.0)
        self.assertLess(t.connect, t.read)


if __name__ == "__main__":
    unittest.main()

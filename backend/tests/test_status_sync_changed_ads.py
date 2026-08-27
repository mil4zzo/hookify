"""
Sync de status on-focus: grava SÓ o que mudou e devolve quantos mudaram.

O QUE ISTO TRAVA (fase 2 do cache, 2026-08-26)
----------------------------------------------
Antes, `_write_local_statuses` reescrevia effective_status de TODOS os ads do pack a cada
sync (write amplification: 414 UPDATEs em três recargas, medido na migration 127) e o
endpoint não sabia dizer se algo tinha mudado — então o frontend invalidava o cache dos
rankings sempre que sincronizava, mesmo sem mudança nenhuma, e ia ao banco de novo.

Agora o UPDATE carrega `or(effective_status.is.null, effective_status.neq.<valor>)`:
linha igual não é tocada, e a contagem das tocadas vira `changed_ads` na resposta. O
frontend só refaz a busca pesada quando `changed_ads > 0`.
"""
import unittest
from unittest import mock

from app.routes import facebook


class _Query:
    def __init__(self, linhas, registro):
        self._linhas = linhas          # ad_id -> effective_status | None
        self._registro = registro
        self.payload = None
        self.filtros = {}

    def update(self, payload):
        self.payload = payload
        return self

    def eq(self, coluna, valor):
        self.filtros[coluna] = valor
        return self

    def in_(self, coluna, valores):
        self.filtros[coluna] = list(valores)
        return self

    def or_(self, expr):
        self.filtros["or"] = expr
        return self

    def execute(self):
        self._registro.append(dict(self.filtros))
        novo = self.payload["effective_status"]
        alvo = self.filtros.get("ad_id", [])
        expr = self.filtros.get("or", "")
        # Semântica do PostgREST: sem o `or`, casa tudo; com ele, só NULL ou diferente.
        so_diferentes = "effective_status.is.null" in expr and f"effective_status.neq.{novo}" in expr
        tocadas = []
        for ad_id in alvo:
            atual = self._linhas.get(ad_id)
            if so_diferentes and atual is not None and atual == novo:
                continue
            self._linhas[ad_id] = novo
            tocadas.append({"ad_id": ad_id})
        return type("Res", (), {"data": tocadas})()


class _FakeSB:
    def __init__(self, linhas):
        self.linhas = dict(linhas)
        self.registro = []

    def table(self, nome):
        assert nome == "ads"
        return _Query(self.linhas, self.registro)


class TestWriteLocalStatusesChangedOnly(unittest.TestCase):
    def _run(self, sb, statuses):
        with mock.patch.object(facebook, "_sb_for", return_value=sb), \
             mock.patch.object(facebook, "with_postgrest_retry", side_effect=lambda _label, fn: fn()):
            return facebook._write_local_statuses(user_jwt=None, user_id="u1", statuses=statuses)

    def test_nada_mudou_devolve_zero_e_nao_toca_linha(self):
        sb = _FakeSB({"a1": "ACTIVE", "a2": "PAUSED"})
        changed = self._run(sb, {"a1": "ACTIVE", "a2": "PAUSED"})
        self.assertEqual(changed, 0)
        self.assertEqual(sb.linhas, {"a1": "ACTIVE", "a2": "PAUSED"})

    def test_conta_so_as_que_mudaram_inclusive_null(self):
        sb = _FakeSB({"a1": "ACTIVE", "a2": "ACTIVE", "a3": None})
        changed = self._run(sb, {"a1": "ACTIVE", "a2": "PAUSED", "a3": "ACTIVE"})
        self.assertEqual(changed, 2)
        self.assertEqual(sb.linhas, {"a1": "ACTIVE", "a2": "PAUSED", "a3": "ACTIVE"})

    def test_update_carrega_o_filtro_de_diferenca(self):
        sb = _FakeSB({"a1": "ACTIVE"})
        self._run(sb, {"a1": "PAUSED"})
        self.assertEqual(len(sb.registro), 1)
        self.assertEqual(sb.registro[0]["or"], "effective_status.is.null,effective_status.neq.PAUSED")
        self.assertEqual(sb.registro[0]["user_id"], "u1")

    def test_in_process_e_vazio_sao_ignorados(self):
        sb = _FakeSB({"a1": "ACTIVE"})
        changed = self._run(sb, {"a1": "IN_PROCESS", "a2": None, "a3": ""})
        self.assertEqual(changed, 0)
        self.assertEqual(sb.registro, [])

    def test_sabotagem_sem_filtro_de_diferenca_contaria_tudo(self):
        # Prova de que o teste distingue: um fake que ignora o `or` contaria as 2 linhas.
        sb = _FakeSB({"a1": "ACTIVE", "a2": "ACTIVE"})
        original = _Query.execute

        def execute_sem_filtro(self):
            self.filtros.pop("or", None)
            return original(self)

        with mock.patch.object(_Query, "execute", execute_sem_filtro):
            changed = self._run(sb, {"a1": "ACTIVE", "a2": "ACTIVE"})
        self.assertEqual(changed, 2)


if __name__ == "__main__":
    unittest.main()

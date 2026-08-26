"""
TTL do sync de status on-focus: reserva no BANCO, não na memória do processo.

O BUG QUE ISTO TRAVA (medido em 2026-08-26)
--------------------------------------------
O guarda de 5 minutos por pack vivia num dict de processo protegido por
`threading.Lock`. O backend sobe com `uvicorn --workers 4`: cada worker tinha o
próprio dicionário vazio, então cada recarga da página caía num worker diferente
e sincronizava DE NOVO.

Custo observado em três recargas seguidas do Manager:
    UPDATE ads SET effective_status ......... 414 chamadas, 35,3 s
    SELECT campaign_id, adset_id FROM ads ... 352 chamadas, 11,9 s

Esse trabalho disputa slots de banco e locks nas MESMAS linhas de `ads` que a
consulta do Manager está lendo ao lado — recarregar deixava a página mais LENTA
(10 s -> 17 s), porque os syncs se acumulavam.

`threading.Lock` só ordena threads DENTRO de um processo. O que ordena workers é
o UPDATE condicional, atômico por linha, no banco.
"""

import re
import unittest
from datetime import datetime, timedelta, timezone

from app.routes import facebook


class _Query:
    def __init__(self, tabela, op, payload, registro, linhas):
        self.tabela, self.op, self.payload = tabela, op, payload
        self._registro, self._linhas = registro, linhas
        self.filtros = {}
        self._limite = None

    def select(self, _campos):
        self.op = "select"
        return self

    def update(self, payload):
        self.op = "update"
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

    def limit(self, n):
        self._limite = n
        return self

    def execute(self):
        self._registro.append(
            {"tabela": self.tabela, "op": self.op, "payload": self.payload,
             "filtros": dict(self.filtros), "limite": self._limite}
        )
        # Simula o filtro de elegibilidade: só volta quem está fora do TTL.
        corte = None
        expr = self.filtros.get("or") or ""
        m = re.search(r"last_status_sync_at\.lt\.(\S+)", expr)
        if m:
            corte = datetime.fromisoformat(m.group(1))
        alvo = self.filtros.get("id")
        dados = []
        for pid, quando in self._linhas.items():
            if alvo is not None and pid not in alvo:
                continue
            if corte is not None and quando is not None and quando >= corte:
                continue  # ainda dentro do TTL
            dados.append({"id": pid})
        if self._limite is not None:
            dados = dados[: self._limite]
        # UPDATE também grava, para o teste poder observar o efeito
        if self.op == "update":
            novo = self.payload.get("last_status_sync_at")
            for r in dados:
                self._linhas[r["id"]] = datetime.fromisoformat(novo) if novo else None
        return type("Res", (), {"data": dados})()


class _FakeSB:
    """Banco falso com uma tabela `packs` e a coluna last_status_sync_at."""

    def __init__(self, linhas):
        self.linhas = dict(linhas)  # pack_id -> datetime | None
        self.registro = []

    def table(self, nome):
        return _Query(nome, "select", None, self.registro, self.linhas)


def _agora():
    return datetime.now(timezone.utc)


class TestReservaDeSlot(unittest.TestCase):
    def test_pack_nunca_sincronizado_ganha_o_slot(self):
        sb = _FakeSB({"p1": None, "p2": None})
        ganhos = facebook._reservar_slots_de_status_sync(sb, ["p1", "p2"], 20)
        self.assertEqual(ganhos, {"p1", "p2"})
        # e a marca ficou gravada, para o próximo worker enxergar
        self.assertIsNotNone(sb.linhas["p1"])

    def test_pack_dentro_do_ttl_nao_ganha(self):
        sb = _FakeSB({"p1": _agora() - timedelta(seconds=60)})
        self.assertEqual(facebook._reservar_slots_de_status_sync(sb, ["p1"], 20), set())

    def test_pack_fora_do_ttl_ganha(self):
        sb = _FakeSB({"p1": _agora() - timedelta(seconds=600)})
        self.assertEqual(facebook._reservar_slots_de_status_sync(sb, ["p1"], 20), {"p1"})

    def test_a_marca_atravessa_workers(self):
        """O ponto do conserto: worker A reserva, worker B enxerga e pula.

        Antes, cada worker tinha o próprio dicionário e B sincronizava de novo —
        era isso que fazia recarregar a página disparar sync toda vez.
        """
        sb = _FakeSB({"p1": None})
        worker_a = facebook._reservar_slots_de_status_sync(sb, ["p1"], 20)
        worker_b = facebook._reservar_slots_de_status_sync(sb, ["p1"], 20)
        self.assertEqual(worker_a, {"p1"})
        self.assertEqual(worker_b, set(), "o 2o worker precisa enxergar a reserva do 1o")

    def test_respeita_o_teto_por_request(self):
        sb = _FakeSB({f"p{i}": None for i in range(30)})
        self.assertEqual(len(facebook._reservar_slots_de_status_sync(sb, list(sb.linhas), 20)), 20)

    def test_reserva_e_condicional_no_update(self):
        """O UPDATE tem de repetir o filtro de elegibilidade.

        É ele que resolve a corrida entre workers: sem o filtro no passo 2, dois
        workers que listassem o mesmo candidato reservariam ambos, e o trabalho
        aconteceria em dobro — exatamente o que o lock em memória não impedia
        entre processos.
        """
        sb = _FakeSB({"p1": None})
        facebook._reservar_slots_de_status_sync(sb, ["p1"], 20)
        updates = [r for r in sb.registro if r["op"] == "update"]
        self.assertEqual(len(updates), 1)
        self.assertIn("last_status_sync_at", updates[0]["filtros"].get("or", ""))

    def test_lista_vazia_nao_toca_no_banco(self):
        sb = _FakeSB({})
        self.assertEqual(facebook._reservar_slots_de_status_sync(sb, [], 20), set())
        self.assertEqual(facebook._reservar_slots_de_status_sync(sb, ["p1"], 0), set())
        self.assertEqual(sb.registro, [])


class TestLiberacaoDeSlot(unittest.TestCase):
    def test_falha_libera_para_retry(self):
        sb = _FakeSB({"p1": _agora()})
        facebook._liberar_slot_de_status_sync(sb, "p1")
        upd = [r for r in sb.registro if r["op"] == "update"]
        self.assertEqual(len(upd), 1)
        self.assertIsNone(upd[0]["payload"]["last_status_sync_at"])
        # e o pack volta a ser elegível imediatamente
        self.assertEqual(facebook._reservar_slots_de_status_sync(sb, ["p1"], 20), {"p1"})

    def test_falha_ao_liberar_nao_propaga(self):
        # Best-effort: não pode transformar falha de sync em erro de resposta.
        class _Explode:
            def table(self, _n):
                raise RuntimeError("banco fora")

        facebook._liberar_slot_de_status_sync(_Explode(), "p1")  # não deve levantar


if __name__ == "__main__":
    unittest.main()

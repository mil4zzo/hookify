"""
Testes do teto de concorrencia de banco e da ordem determinista de lock.

Ambos existem por causa do incidente de 2026-08-24: o backend (4 workers x 40
threads = ate 160 operacoes) afogou um banco de ~45 conexoes uteis, gerando
`53300 remaining connection slots`, deadlock (40P01) e crash do Postgres.
"""
import threading
import time

import pytest

from app.core import db_concurrency
from app.core.db_concurrency import DBConcurrencyTimeout, db_slot
from app.services import supabase_repo


class TestDbSlot:
    """O semaforo de `app/core/db_concurrency.py`."""

    def test_nunca_ultrapassa_o_teto(self, monkeypatch):
        """Com N threads e limite L, o pico em voo nunca passa de L."""
        limite = 3
        monkeypatch.setattr(db_concurrency, "_semaphore", threading.BoundedSemaphore(limite))
        monkeypatch.setattr(db_concurrency, "_in_flight", 0)
        monkeypatch.setattr(db_concurrency, "_peak_in_flight", 0)

        def carga():
            with db_slot("teste"):
                time.sleep(0.05)

        threads = [threading.Thread(target=carga) for _ in range(12)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert db_concurrency._peak_in_flight <= limite
        assert db_concurrency._in_flight == 0, "todo slot deve ser devolvido"

    def test_reentrante_na_mesma_thread(self, monkeypatch):
        """Aninhar db_slot NAO pode consumir 2 slots.

        Sem reentrancia, N threads segurando 1 slot e esperando o 2o travam o
        backend inteiro (deadlock de semaforo). O slot e da operacao mais externa.
        """
        monkeypatch.setattr(db_concurrency, "_semaphore", threading.BoundedSemaphore(1))
        monkeypatch.setattr(db_concurrency, "_in_flight", 0)

        with db_slot("externo"):
            assert db_concurrency._in_flight == 1
            with db_slot("aninhado"):
                assert db_concurrency._in_flight == 1, "aninhado nao pode pegar outro slot"
            assert db_concurrency._in_flight == 1
        assert db_concurrency._in_flight == 0

    def test_falha_rapido_quando_saturado(self, monkeypatch):
        """Saturou: erra em vez de enfileirar thread parada indefinidamente."""
        monkeypatch.setattr(db_concurrency, "_semaphore", threading.BoundedSemaphore(1))
        monkeypatch.setattr(db_concurrency, "DB_SLOT_ACQUIRE_TIMEOUT_S", 0.2)

        segurando = threading.Event()
        liberar = threading.Event()

        def hog():
            with db_slot("hog"):
                segurando.set()
                liberar.wait(timeout=5)

        t = threading.Thread(target=hog)
        t.start()
        assert segurando.wait(timeout=2)

        try:
            with pytest.raises(DBConcurrencyTimeout):
                with db_slot("estourado"):
                    pass
        finally:
            liberar.set()
            t.join()

    def test_slot_devolvido_mesmo_com_excecao(self, monkeypatch):
        monkeypatch.setattr(db_concurrency, "_semaphore", threading.BoundedSemaphore(1))
        monkeypatch.setattr(db_concurrency, "_in_flight", 0)

        with pytest.raises(ValueError):
            with db_slot("explode"):
                raise ValueError("boom")

        assert db_concurrency._in_flight == 0
        with db_slot("depois"):  # nao deve travar
            pass


class _FakeQuery:
    """Grava a sequencia de ids pedida em cada UPDATE."""

    def __init__(self, registro):
        self._registro = registro
        self._payload = None

    def update(self, payload):
        self._payload = payload
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def in_(self, id_column, ids):
        self._registro.append((id_column, list(ids)))
        return self

    def execute(self):
        return type("Res", (), {"data": []})()


class _FakeClient:
    def __init__(self):
        self.updates = []

    def table(self, _name):
        return _FakeQuery(self.updates)


class TestWriteParentStatusesOrdering:
    """Ordem determinista de lock (anti-deadlock 40P01)."""

    def _run(self, mapping):
        fake = _FakeClient()
        supabase_repo.write_parent_statuses(
            None,
            "user-1",
            {"campaigns": mapping, "adsets": {}},
            sb_client=fake,
            skip_present_check=True,
        )
        return fake.updates

    def test_ids_saem_ordenados(self):
        updates = self._run({"c3": "ACTIVE", "c1": "ACTIVE", "c2": "ACTIVE"})
        assert updates, "deveria ter gerado ao menos um UPDATE"
        for _col, ids in updates:
            assert ids == sorted(ids), f"ids fora de ordem: {ids}"

    def test_ordem_independe_da_ordem_de_entrada(self):
        """Duas ordens de entrada diferentes -> a MESMA sequencia de locks.

        E isto que torna o deadlock aritmeticamente impossivel entre caminhos
        concorrentes: com ordem total consistente nao existe ciclo de espera.
        A ordem de entrada vem do edge do Meta e varia entre chamadas.
        """
        a = self._run({"c9": "ACTIVE", "c1": "PAUSED", "c5": "ACTIVE", "c3": "PAUSED"})
        b = self._run({"c3": "PAUSED", "c5": "ACTIVE", "c9": "ACTIVE", "c1": "PAUSED"})
        assert a == b


class TestWriteLocalStatusesOrdering:
    """Irma de write_parent_statuses: grava nas MESMAS linhas de `ads`.

    O sync on-focus dispara as duas em paralelo para ate 20 packs. Sem ordem
    total consistente entre elas, duas transacoes pegam os locks em ordem oposta
    e se abracam (40P01). A correcao original cobriu so a irma em supabase_repo;
    esta ficou meses sem ela.
    """

    def _run(self, statuses, monkeypatch):
        from app.routes import facebook

        fake = _FakeClient()
        monkeypatch.setattr(facebook, "_sb_for", lambda _jwt: fake)
        facebook._write_local_statuses(user_jwt=None, user_id="u1", statuses=statuses)
        return fake.updates

    def test_ids_saem_ordenados(self, monkeypatch):
        updates = self._run({"a3": "ACTIVE", "a1": "ACTIVE", "a2": "ACTIVE"}, monkeypatch)
        assert updates, "deveria ter gerado ao menos um UPDATE"
        for _col, ids in updates:
            assert ids == sorted(ids), f"ids fora de ordem: {ids}"

    def test_ordem_independe_da_ordem_de_entrada(self, monkeypatch):
        a = self._run({"a9": "ACTIVE", "a1": "PAUSED", "a5": "ACTIVE", "a3": "PAUSED"}, monkeypatch)
        b = self._run({"a3": "PAUSED", "a5": "ACTIVE", "a9": "ACTIVE", "a1": "PAUSED"}, monkeypatch)
        assert a == b

    def test_in_process_continua_nao_sendo_persistido(self, monkeypatch):
        """Guarda de regressao: o sort nao pode ter mexido no filtro transitorio."""
        updates = self._run({"a1": "IN_PROCESS", "a2": "PAUSED"}, monkeypatch)
        gravados = [i for _col, ids in updates for i in ids]
        assert gravados == ["a2"], "IN_PROCESS nunca pode ser persistido"


class TestTetoNoPontoUnico:
    """O teto tem de valer POR CONSTRUCAO, nao por lembrar de embrulhar.

    Medido em 2026-08-24: 262 `.execute()` no backend, 78 embrulhados -- ~184
    furavam a fila. Interceptar no cliente HTTP do Supabase fecha o buraco para
    todo codigo, inclusive o que ainda nao existe.
    """

    def _cliente(self, registro):
        import httpx
        from app.core.supabase_client import _SlottedHTTPXClient

        def handler(request):
            registro.append(db_concurrency._in_flight)
            return httpx.Response(200, json=[])

        return _SlottedHTTPXClient(transport=httpx.MockTransport(handler))

    def test_chamada_crua_ao_postgrest_pega_slot(self, monkeypatch):
        """Sem with_postgrest_retry, sem db_slot no call site: ainda assim conta."""
        monkeypatch.setattr(db_concurrency, "_in_flight", 0)
        registro = []
        c = self._cliente(registro)
        c.get("https://x.supabase.co/rest/v1/ads?select=id")
        assert registro == [1], "a chamada ao PostgREST tinha de estar ocupando um slot"
        assert db_concurrency._in_flight == 0, "slot devolvido ao fim"

    def test_storage_nao_consome_slot_de_banco(self, monkeypatch):
        """Upload de miniatura compartilha o mesmo cliente httpx, mas nao e banco."""
        monkeypatch.setattr(db_concurrency, "_in_flight", 0)
        registro = []
        c = self._cliente(registro)
        c.get("https://x.supabase.co/storage/v1/object/thumbs/a.jpg")
        assert registro == [0], "Storage nao pode disputar slot de banco"

    def test_saturado_bloqueia_ate_chamada_crua(self, monkeypatch):
        """Com os slots ocupados, uma chamada crua falha em vez de furar a fila.

        O slot precisa ser segurado por OUTRA thread: na mesma thread a
        reentrancia (proposital) tornaria a aquisicao aninhada um no-op, e o
        teste passaria a medir reentrancia em vez de saturacao.
        """
        monkeypatch.setattr(db_concurrency, "_semaphore", threading.BoundedSemaphore(1))
        monkeypatch.setattr(db_concurrency, "DB_SLOT_ACQUIRE_TIMEOUT_S", 0.2)

        segurando = threading.Event()
        liberar = threading.Event()

        def hog():
            with db_slot("ocupando_o_unico_slot"):
                segurando.set()
                liberar.wait(timeout=5)

        t = threading.Thread(target=hog)
        t.start()
        assert segurando.wait(timeout=2)
        try:
            c = self._cliente([])
            with pytest.raises(DBConcurrencyTimeout):
                c.get("https://x.supabase.co/rest/v1/ads?select=id")
        finally:
            liberar.set()
            t.join()

    def test_fabrica_realmente_usa_o_cliente_com_slot(self, monkeypatch):
        """Guarda de fiacao: adianta pouco a classe existir se a fabrica nao a usa."""
        import app.core.supabase_client as sc

        monkeypatch.setattr(sc, "SUPABASE_URL", "https://x.supabase.co")
        monkeypatch.setattr(sc, "SUPABASE_ANON_KEY", "chave-anon")
        client = sc.get_supabase_for_user("jwt-fake")
        assert isinstance(client.postgrest.session, sc._SlottedHTTPXClient)

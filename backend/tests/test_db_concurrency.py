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
    """Grava a sequencia de ids pedida em cada UPDATE/UPSERT."""

    def __init__(self, registro):
        self._registro = registro
        self._payload = None

    def update(self, payload):
        self._payload = payload
        return self

    def upsert(self, linhas, on_conflict=None):
        # Numa escrita em lote a ordem das LINHAS e a ordem de aquisicao de lock.
        self._registro.append(("upsert", [l["entity_id"] for l in linhas]))
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
    """Ordem determinista de lock (anti-deadlock 40P01).

    Antes cobria `write_parent_statuses`, que gravava as colunas denormalizadas
    de `ads`. Essa funcao foi removida no passo 3 da migracao do read-path (sem
    leitor desde a migration 122). A INVARIANTE nao mudou, so a tabela: agora as
    escritas concorrentes disputam linhas de `parent_entities`, e o sync
    on-focus continua disparando varios caminhos em paralelo.
    """

    def _run(self, mapping):
        fake = _FakeClient()
        supabase_repo.write_parent_entity_statuses(
            None,
            "user-1",
            {"campaigns": mapping, "adsets": {}},
            sb_client=fake,
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
    """Escrita de effective_status por AD (nao de pai): segue em `ads`.

    O sync on-focus dispara varios caminhos em paralelo para ate 20 packs. Sem
    ordem total consistente entre eles, duas transacoes pegam os locks em ordem
    oposta e se abracam (40P01). A correcao original cobriu so a irma em
    supabase_repo; esta ficou meses sem ela.
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
        """Storage tem cliente proprio, mas o filtro por path e o que garante isso."""
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
        # Precisa ter FORMATO de JWT: o construtor do supabase-py valida a
        # chave por regex antes de montar o cliente. Uma string qualquer aqui
        # faria o teste morrer na validacao, sem chegar a checar a fiacao.
        monkeypatch.setattr(sc, "SUPABASE_ANON_KEY", "cabeca.corpo.assinatura")
        client = sc.get_supabase_for_user("jwt-fake")
        assert isinstance(client.postgrest.session, sc._SlottedHTTPXClient)

    def test_service_client_tambem_nasce_com_slot(self, monkeypatch):
        """O service client e o caminho de TODA rota; se ele quebra, o app cai.

        Guarda escrita depois de um outage: a versao anterior injetava a sessao
        via `ClientOptions(httpx_client=...)`, campo que nao existe no
        supabase-py. Como so o cliente de usuario tinha teste, o service client
        -- usado por praticamente todas as rotas -- estourava TypeError em
        producao sem nada vermelho aqui.
        """
        import app.core.supabase_client as sc

        monkeypatch.setattr(sc, "SUPABASE_URL", "https://x.supabase.co")
        monkeypatch.setattr(sc, "SUPABASE_SERVICE_ROLE_KEY", "cabeca.corpo.assinatura")
        monkeypatch.setattr(sc, "_service_client", None)
        client = sc.get_supabase_service()
        assert isinstance(client.postgrest.session, sc._SlottedHTTPXClient)

    def test_postgrest_recriado_apos_evento_de_auth_continua_com_slot(self, monkeypatch):
        """`Client` zera `_postgrest` em TOKEN_REFRESHED e recria pela fabrica.

        E por isso que a interceptacao esta na fabrica, e nao numa troca de
        `client.postgrest.session` feita uma vez apos a construcao: aquela
        sessao seria descartada aqui, em silencio.
        """
        import app.core.supabase_client as sc

        monkeypatch.setattr(sc, "SUPABASE_URL", "https://x.supabase.co")
        monkeypatch.setattr(sc, "SUPABASE_ANON_KEY", "cabeca.corpo.assinatura")
        client = sc.get_supabase_for_user("jwt-fake")
        client._postgrest = None  # o que o supabase-py faz no evento de auth
        assert isinstance(client.postgrest.session, sc._SlottedHTTPXClient)


class TestSubCotaDeBackground:
    """Trabalho de background nao pode tomar todos os slots das telas.

    Efeito colateral criado quando o teto passou a valer para TODAS as chamadas:
    o background entrou na mesma fila, e ele e muito mais paralelo (transcricao
    20 threads, miniaturas ate 16). Sem cota, um refresh ocupa os 8 slots por
    minutos e a tela do usuario espera ate estourar -- a protecao contra
    sobrecarga viraria a causa da indisponibilidade.
    """

    def _configurar(self, monkeypatch, geral, background):
        monkeypatch.setattr(db_concurrency, "_semaphore", threading.BoundedSemaphore(geral))
        monkeypatch.setattr(
            db_concurrency, "_background_semaphore", threading.BoundedSemaphore(background)
        )
        monkeypatch.setattr(db_concurrency, "DB_BACKGROUND_MAX_CONCURRENT_CALLS", background)
        monkeypatch.setattr(db_concurrency, "DB_SLOT_ACQUIRE_TIMEOUT_S", 0.2)

    def test_background_nao_ocupa_alem_da_sub_cota(self, monkeypatch):
        """Com geral=4 e background=2, o background para em 2 mesmo havendo slot livre."""
        self._configurar(monkeypatch, geral=4, background=2)
        prontos = threading.Semaphore(0)
        liberar = threading.Event()

        def segurador():
            with db_slot("job_background"):
                prontos.release()
                liberar.wait(timeout=5)

        ts = [threading.Thread(target=segurador) for _ in range(2)]
        for th in ts:
            th.start()
        assert prontos.acquire(timeout=2) and prontos.acquire(timeout=2)

        try:
            # A thread principal do teste tambem conta como background (sem rota
            # no contexto). Ha 2 slots gerais livres, mas a sub-cota esta cheia.
            with pytest.raises(DBConcurrencyTimeout):
                with db_slot("terceiro_background"):
                    pass
        finally:
            liberar.set()
            for th in ts:
                th.join()

    def test_tela_alcanca_slot_que_background_nao_alcanca(self, monkeypatch):
        """A diferenca geral - background fica RESERVADA para requisicao interativa."""
        from app.core.request_context import current_route

        self._configurar(monkeypatch, geral=2, background=1)
        segurando = threading.Event()
        liberar = threading.Event()

        def background():
            with db_slot("job_background"):
                segurando.set()
                liberar.wait(timeout=5)

        t = threading.Thread(target=background)
        t.start()
        assert segurando.wait(timeout=2)
        try:
            # Simula thread que serve uma request: contexto tem rota.
            token = current_route.set("/analytics/rankings")
            try:
                with db_slot("tela_do_usuario"):
                    pass  # nao pode levantar: o 2o slot e dela
            finally:
                current_route.reset(token)
        finally:
            liberar.set()
            t.join()

    def test_sub_cota_devolvida_quando_o_slot_geral_falha(self, monkeypatch):
        """Se o geral nega, a sub-cota nao pode ficar retida (vazaria a cota)."""
        self._configurar(monkeypatch, geral=1, background=2)
        segurando = threading.Event()
        liberar = threading.Event()

        def ocupa_o_geral():
            from app.core.request_context import current_route

            token = current_route.set("/interativa")
            try:
                with db_slot("segura_o_geral"):
                    segurando.set()
                    liberar.wait(timeout=5)
            finally:
                current_route.reset(token)

        t = threading.Thread(target=ocupa_o_geral)
        t.start()
        assert segurando.wait(timeout=2)
        try:
            with pytest.raises(DBConcurrencyTimeout):
                with db_slot("background_sem_geral"):
                    pass
            livre_antes = db_concurrency._background_semaphore.acquire(timeout=0.5)
            assert livre_antes, "sub-cota ficou retida apos falha no slot geral"
            db_concurrency._background_semaphore.release()
        finally:
            liberar.set()
            t.join()

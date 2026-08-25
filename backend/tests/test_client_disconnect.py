"""
Testes do corte de trabalho quando o navegador desliga.

LICAO QUE ORIGINOU ESTE ARQUIVO NA FORMA ATUAL
----------------------------------------------
A primeira versao destes testes montava um app com **um** middleware. A producao
(`main.py`) tem **dois** BaseHTTPMiddleware + CORS. A deteccao funcionava com um
e falhava em silencio com dois -- entao 10 testes passavam com a feature 100%
morta em producao.

Por isso todo teste de deteccao aqui monta a pilha na MESMA forma do `main.py`
(`_app_forma_de_producao`) e dirige o app via ASGI cru, que e a unica maneira de
simular `http.disconnect`. `TestClient` nao consegue desconectar no meio.
"""
import asyncio
import logging
from unittest import mock

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

from app.core import client_disconnect
from app.core.client_disconnect import (
    ClientDisconnectMiddleware,
    ClientGone,
    abort_if_client_gone,
    client_is_gone,
    current_liveness,
)


def _rodar(coro):
    """Roda `coro` sem deixar a thread SEM loop corrente.

    `asyncio.run()` zera o loop corrente ao terminar. Outros testes da suite ainda
    usam o padrao antigo `asyncio.get_event_loop()`, que quebra nesse estado -- a
    poluicao apareceria como falha em `test_tier_dependency.py`, longe daqui e sem
    relacao aparente. Deixar um loop utilizavel mantem a suite independente da
    ordem de execucao.
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()
        asyncio.set_event_loop(asyncio.new_event_loop())


def _app_forma_de_producao(trabalho: dict, n_base_middlewares: int = 2):
    """Monta a pilha exatamente como `main.py`.

    n_base_middlewares=2 e a producao. O parametro existe so para o teste que
    demonstra por que 1 middleware nao serve como cobertura.
    """
    app = FastAPI()

    @app.get("/rankings")
    def rankings():  # SINCRONA de proposito: e o caso nao-interrompivel
        trabalho.setdefault("etapas", []).append("rpc_principal")
        for _ in range(40):  # simula trabalho longo, checando entre as etapas
            try:
                abort_if_client_gone("hidratacao")
            except ClientGone:
                raise
            import time

            time.sleep(0.005)
        trabalho["etapas"].append("hidratacao")
        return {"ok": True}

    # Espelha `_set_request_context`: trata ClientGone -> 499
    @app.middleware("http")
    async def _ctx(request: Request, call_next):
        try:
            return await call_next(request)
        except ClientGone as gone:
            trabalho["status"] = 499
            return JSONResponse(status_code=499, content={"detail": "Client Closed Request",
                                                          "stage": gone.stage})
        except Exception:
            trabalho["status"] = 500
            return JSONResponse(status_code=500, content={"detail": "Internal Server Error"})

    if n_base_middlewares >= 2:
        # Espelha o rate_limit_middleware: e ESTE empilhamento que quebrava a
        # deteccao baseada em Request.is_disconnected().
        @app.middleware("http")
        async def _rate(request: Request, call_next):
            return await call_next(request)

    app.add_middleware(CORSMiddleware, allow_origins=["https://hookifyads.com"])
    app.add_middleware(ClientDisconnectMiddleware)  # por ultimo = mais externo
    return app


async def _dirigir(app, *, desconectar_apos: float | None):
    """Chama o app via ASGI cru. `desconectar_apos=None` = cliente fica."""
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
        "method": "GET", "path": "/rankings", "raw_path": b"/rankings",
        "query_string": b"", "root_path": "", "headers": [(b"host", b"t")],
        "client": ("1.2.3.4", 1), "server": ("t", 80), "scheme": "http",
    }
    respostas = []

    async def receive():
        if desconectar_apos is None:
            await asyncio.sleep(3600)  # cliente presente: nada chega
        await asyncio.sleep(desconectar_apos)
        return {"type": "http.disconnect"}

    async def send(message):
        if message.get("type") == "http.response.start":
            respostas.append(message["status"])

    await asyncio.wait_for(app(scope, receive, send), timeout=10)
    return respostas


class TestDeteccaoNaFormaDeProducao:
    """O teste que a primeira versao nao tinha -- e que teria pego o no-op."""

    def test_desconexao_no_meio_corta_o_trabalho(self):
        trabalho = {}
        app = _app_forma_de_producao(trabalho)
        _rodar(_dirigir(app, desconectar_apos=0.02))

        assert trabalho.get("status") == 499, "cancelamento deve virar 499, nao 500"
        assert trabalho["etapas"] == ["rpc_principal"], "a hidratacao NAO podia rodar"

    def test_cliente_presente_completa_sem_falso_positivo(self):
        trabalho = {}
        app = _app_forma_de_producao(trabalho)
        _rodar(_dirigir(app, desconectar_apos=None))

        assert trabalho.get("status") is None, "nao deveria ter havido erro"
        assert trabalho["etapas"] == ["rpc_principal", "hidratacao"]

    def test_um_middleware_nao_serve_de_cobertura(self):
        """Documenta por que a forma importa.

        Com UM middleware a deteccao tambem funciona -- e foi exatamente por isso
        que o bug passou. Este teste existe para deixar explicito que passar aqui
        NAO substitui o teste de 2 middlewares acima.
        """
        trabalho = {}
        app = _app_forma_de_producao(trabalho, n_base_middlewares=1)
        _rodar(_dirigir(app, desconectar_apos=0.02))
        assert trabalho.get("status") == 499


class TestFailSafe:
    """Na duvida, o cliente esta presente -- errar para o lado do desperdicio."""

    def test_sem_estado_no_contexto_nao_cancela(self):
        """Job de background / script: nao ha request, o trabalho deve seguir."""
        assert current_liveness.get() is None
        assert client_is_gone() is False
        abort_if_client_gone("qualquer")  # nao pode levantar

    def test_kill_switch_desliga_a_deteccao(self, monkeypatch):
        from app.core.client_disconnect import _Liveness

        monkeypatch.setattr(client_disconnect, "CLIENT_DISCONNECT_ABORT_ENABLED", False)
        estado = _Liveness()
        estado.disconnected = True
        token = current_liveness.set(estado)
        try:
            assert client_is_gone() is False, "com a flag off, nunca cancela"
        finally:
            current_liveness.reset(token)


class TestMetricas:
    """Sem isto, 'detector quebrado' e 'ninguem desconecta' sao indistinguiveis."""

    def test_conta_checagens_e_abortos_por_etapa(self, monkeypatch):
        from app.core.client_disconnect import _Liveness

        monkeypatch.setattr(client_disconnect, "_checks", 0)
        monkeypatch.setattr(client_disconnect, "_aborts", 0)
        monkeypatch.setattr(client_disconnect, "_aborts_by_stage", {})

        estado = _Liveness()
        token = current_liveness.set(estado)
        try:
            client_is_gone()                      # 1 checagem, sem abort
            estado.disconnected = True
            with pytest.raises(ClientGone):
                abort_if_client_gone("etapa_x")   # 1 checagem + 1 abort
        finally:
            current_liveness.reset(token)

        s = client_disconnect.get_stats()
        assert s["checks"] == 2
        assert s["aborts"] == 1
        assert s["aborts_by_stage"] == {"etapa_x": 1}


class TestContratoDaExcecao:
    """Trava decisoes que ja custaram investigacao."""

    def test_client_gone_e_exception_nao_baseexception(self):
        """NAO trocar para BaseException.

        Testado empiricamente: o BaseHTTPMiddleware do Starlette 0.48 perde
        BaseException que sobe da rota e devolve `RuntimeError: No response
        returned.` -> 500, em vez do 499.
        """
        assert issubclass(ClientGone, Exception)

    def test_stage_fica_disponivel_para_o_log(self):
        with pytest.raises(ClientGone) as exc:
            raise ClientGone("rankings:transcricao")
        assert exc.value.stage == "rankings:transcricao"


class TestGuardasNaRotaDeAnalytics:
    """ClientGone precisa ATRAVESSAR os `except Exception` do caminho de analytics.

    Duas camadas engoliriam o cancelamento: o wrapper de retry e o handler da
    rota. Sem as guardas, o cancelamento viraria 500 e -- pior -- o wrapper
    poderia RE-EXECUTAR a query que acabamos de cancelar.
    """

    def _req(self):
        from app.routes.analytics import RankingsRequest

        return RankingsRequest(
            date_start="2026-08-01", date_stop="2026-08-24",
            group_by="ad_name", pack_ids=["11111111-1111-1111-1111-111111111111"],
        )

    def test_wrapper_core_nao_re_tenta_e_propaga(self, monkeypatch):
        from app.routes import analytics

        chamadas = {"n": 0}

        def _fake(req, user, sb):
            chamadas["n"] += 1
            raise ClientGone("rankings:rpc_principal")

        monkeypatch.setattr(analytics, "_get_rankings_core_v2_rpc", _fake)
        with pytest.raises(ClientGone):
            analytics._get_rankings_core_v2_rpc_with_retry(
                self._req(), {"user_id": "u1", "token": "t"}, object(), max_attempts=3,
            )
        assert chamadas["n"] == 1, "cancelamento nao pode ser re-tentado"

    def test_wrapper_series_nao_re_tenta_e_propaga(self, monkeypatch):
        from app.routes import analytics
        from app.routes.analytics import RankingsSeriesRequest

        chamadas = {"n": 0}

        def _fake(req, user, sb):
            chamadas["n"] += 1
            raise ClientGone("series:rpc")

        monkeypatch.setattr(analytics, "_get_rankings_series_v2_rpc", _fake)
        req = RankingsSeriesRequest(
            date_start="2026-08-01", date_stop="2026-08-24", group_by="ad_name",
            pack_ids=["11111111-1111-1111-1111-111111111111"], group_keys=["x"],
        )
        with pytest.raises(ClientGone):
            analytics._get_rankings_series_v2_rpc_with_retry(
                req, {"user_id": "u1", "token": "t"}, object(), max_attempts=3,
            )
        assert chamadas["n"] == 1

    def test_retry_do_postgrest_nao_engole_cancelamento(self):
        """`with_postgrest_retry` embrulha ESCRITAS: retry de cancelamento seria grave."""
        from app.core.supabase_retry import with_postgrest_retry

        chamadas = {"n": 0}

        def _fn():
            chamadas["n"] += 1
            raise ClientGone("escrita_qualquer")

        with pytest.raises(ClientGone):
            with_postgrest_retry("teste", _fn, attempts=4)
        assert chamadas["n"] == 1, "NAO pode re-tentar uma escrita cancelada"

    def test_handlers_das_rotas_tem_guarda(self):
        """Backstop estrutural: cada handler que vira 500 precisa da guarda acima."""
        import inspect
        from app.routes import analytics

        src = inspect.getsource(analytics)
        for detalhe in (
            "Erro ao consultar analytics agregados.",
            "Erro ao consultar series do Manager.",
            "Erro ao consultar retencao do Manager.",
        ):
            antes = src[: src.index(detalhe)]
            assert "except ClientGone" in antes[-900:], (
                f"handler de '{detalhe}' perdeu a guarda except ClientGone"
            )


class _FakePaginacao:
    """Cliente falso que devolve N paginas cheias e conta quantas foram pedidas."""

    def __init__(self, paginas: int, page_size: int = 1000):
        self.paginas = paginas
        self.page_size = page_size
        self.pedidas = 0

    # --- API minima do query builder do Supabase ---
    def table(self, _t):
        return self

    def select(self, _s):
        return self

    def range(self, _a, _b):
        return self

    def execute(self):
        self.pedidas += 1
        cheia = self.pedidas <= self.paginas
        linhas = [{"i": n} for n in range(self.page_size if cheia else 0)]
        return type("Res", (), {"data": linhas})()


class TestCorteNaPaginacaoDosDrills:
    """As 8 telas de detalhe desembocam nos lacos de paginacao.

    Um checkpoint no topo do laco cobre todas de uma vez -- o ganho e cortar a
    CAUDA: parar na pagina 2 em vez de varrer as 10 restantes para o lixo.
    """

    def _paginar(self, fake):
        from app.routes.analytics import _fetch_all_paginated

        return _fetch_all_paginated(fake, "ad_metrics", "i", lambda q: q)

    def test_cliente_presente_varre_todas_as_paginas(self):
        fake = _FakePaginacao(paginas=3)
        linhas = self._paginar(fake)
        assert fake.pedidas == 4, "3 cheias + 1 vazia que encerra"
        assert len(linhas) == 3000

    def test_desconexao_corta_no_meio_da_paginacao(self):
        from app.core.client_disconnect import _Liveness

        estado = _Liveness()
        token = current_liveness.set(estado)
        try:
            fake = _FakePaginacao(paginas=10)
            # Desliga depois da 1a pagina: o laco nao pode pedir a 3a.
            original = fake.execute

            def execute_e_desliga():
                res = original()
                if fake.pedidas >= 1:
                    estado.disconnected = True
                return res

            fake.execute = execute_e_desliga
            with pytest.raises(ClientGone):
                self._paginar(fake)
            assert fake.pedidas == 1, f"parou tarde: {fake.pedidas} paginas varridas"
        finally:
            current_liveness.reset(token)

    def test_background_nao_e_cortado(self):
        """Job de background (sem request no contexto) varre tudo, mesmo teto ligado."""
        assert current_liveness.get() is None
        fake = _FakePaginacao(paginas=3)
        linhas = self._paginar(fake)
        assert len(linhas) == 3000


class TestOptInDoHelperCompartilhado:
    """O helper de `supabase_repo` e usado por ~38 chamadores, alguns em ESCRITA.

    Por isso o cancelamento la e opt-in: abortar uma leitura no meio de
    "grava -> le -> grava" deixaria estado parcial no banco.
    """

    def _paginar(self, fake, **kw):
        from app.services.supabase_repo import _fetch_all_paginated

        return _fetch_all_paginated(fake, "ad_metrics", "i", lambda q: q, **kw)

    def test_por_padrao_nao_cancela_mesmo_desconectado(self):
        from app.core.client_disconnect import _Liveness

        estado = _Liveness()
        estado.disconnected = True
        token = current_liveness.set(estado)
        try:
            fake = _FakePaginacao(paginas=2)
            linhas = self._paginar(fake)  # sem cancellable -> default False
            assert len(linhas) == 2000, "default tem de ser NAO cancelavel"
        finally:
            current_liveness.reset(token)

    def test_com_opt_in_cancela(self):
        from app.core.client_disconnect import _Liveness

        estado = _Liveness()
        estado.disconnected = True
        token = current_liveness.set(estado)
        try:
            with pytest.raises(ClientGone):
                self._paginar(_FakePaginacao(paginas=2), cancellable=True)
        finally:
            current_liveness.reset(token)

    def test_drills_ligam_o_opt_in(self):
        """Backstop: se alguem remover o cancellable=True, o ganho some calado."""
        import inspect
        from app.routes import analytics

        src = inspect.getsource(analytics)
        assert src.count("cancellable=True") == 7, (
            "os 7 drills precisam passar cancellable=True para fetch_pack_metrics_rows"
        )


class TestFallbackDeColunaAusente:
    """O cancelamento nao pode ser confundido com 'coluna lpv ausente'.

    Sem a guarda, o bloco de fallback re-executaria a consulta inteira que
    acabamos de cancelar -- o dobro do trabalho em vez de zero.
    """

    def test_fallback_de_lpv_continua_funcionando(self):
        from app.services import supabase_repo as R

        chamadas = []

        def fake_fetch(sb, table, select, filters, *a, **kw):
            if table == "ad_metric_pack_map":
                # Indice de pertinencia: usa `metric_date`, nao `date`.
                return [{"ad_id": "A", "metric_date": "2026-01-01"}]
            chamadas.append(select)
            if "lpv" in select:
                raise Exception('column "lpv" does not exist')
            return [{"ad_id": "A", "date": "2026-01-01", "user_id": "o1"}]

        with mock.patch.object(R, "resolve_pack_owner_map", return_value={"p1": "o1"}), \
             mock.patch.object(R, "get_supabase_service", return_value=object()), \
             mock.patch.object(R, "_fetch_all_paginated", side_effect=fake_fetch):
            out = R.fetch_pack_metrics_rows(
                "o1", ["p1"], "2026-01-01", "2026-01-31",
                "ad_id,date,lpv", "ad_id,date", None, log_tag="teste",
            )
        assert out, "o fallback tinha de devolver linhas"
        assert any("lpv" in c for c in chamadas) and any("lpv" not in c for c in chamadas)

    def test_cancelamento_nao_dispara_o_fallback(self):
        from app.services import supabase_repo as R

        chamadas = []

        def fake_fetch(sb, table, select, filters, *a, **kw):
            if table == "ad_metric_pack_map":
                return [{"ad_id": "A", "metric_date": "2026-01-01"}]
            chamadas.append(select)
            raise ClientGone("paginacao:ad_metrics")

        with mock.patch.object(R, "resolve_pack_owner_map", return_value={"p1": "o1"}), \
             mock.patch.object(R, "get_supabase_service", return_value=object()), \
             mock.patch.object(R, "_fetch_all_paginated", side_effect=fake_fetch):
            with pytest.raises(ClientGone):
                R.fetch_pack_metrics_rows(
                    "o1", ["p1"], "2026-01-01", "2026-01-31",
                    "ad_id,date,lpv", "ad_id,date", None, log_tag="teste",
                )
        assert len(chamadas) == 1, "nao pode re-executar a consulta cancelada"

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

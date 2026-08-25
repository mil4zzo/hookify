"""
Testes do corte de trabalho quando o navegador desliga.

Contexto: rota sincrona roda em thread do pool e nao pode ser interrompida pelo
framework. O cancelamento e cooperativo -- a rota pergunta "o cliente ainda esta
ai?" em pontos seguros. Ver app/core/client_disconnect.py.
"""
import logging

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app.core import client_disconnect
from app.core.client_disconnect import (
    ClientGone,
    abort_if_client_gone,
    client_is_gone,
    current_request,
)


class _FakeRequest:
    """Minimo que `client_is_gone` consome do Request."""

    def __init__(self, disconnected: bool) -> None:
        self._disconnected = disconnected

    async def is_disconnected(self) -> bool:
        return self._disconnected


def _build_app(fake_request):
    """App que espelha a forma do main.py: middleware seta o contextvar e trata ClientGone."""
    app = FastAPI()

    @app.middleware("http")
    async def _ctx(request: Request, call_next):
        token = current_request.set(fake_request)
        try:
            return await call_next(request)
        except ClientGone as gone:
            return JSONResponse(status_code=499, content={"detail": "Client Closed Request",
                                                          "stage": gone.stage})
        except Exception:
            return JSONResponse(status_code=500, content={"detail": "Internal Server Error"})
        finally:
            current_request.reset(token)

    trabalho = {"etapas": []}

    # Rota SINCRONA de proposito: e o caso que nao pode ser interrompido de fora.
    @app.get("/rankings")
    def rankings():
        trabalho["etapas"].append("rpc_principal")
        abort_if_client_gone("hidratacao")
        trabalho["etapas"].append("hidratacao")
        return {"ok": True}

    return app, trabalho


class TestFailSafe:
    """Na duvida, o cliente esta presente -- errar para o lado do desperdicio."""

    def test_sem_request_no_contexto_nao_cancela(self):
        """Job de background / script: nao ha request, o trabalho deve seguir."""
        assert current_request.get() is None
        assert client_is_gone() is False
        abort_if_client_gone("qualquer")  # nao pode levantar

    def test_kill_switch_desliga_a_deteccao(self, monkeypatch):
        monkeypatch.setattr(client_disconnect, "CLIENT_DISCONNECT_ABORT_ENABLED", False)
        token = current_request.set(_FakeRequest(disconnected=True))
        try:
            assert client_is_gone() is False, "com a flag off, nunca cancela"
        finally:
            current_request.reset(token)

    def test_erro_na_deteccao_assume_conectado(self, monkeypatch):
        class Explode:
            async def is_disconnected(self):
                raise RuntimeError("canal quebrado")

        token = current_request.set(Explode())
        try:
            assert client_is_gone() is False
        finally:
            current_request.reset(token)


class TestCorteEndToEnd:
    """Contextvar -> thread do pool -> ponte anyio -> raise -> middleware -> 499."""

    def test_cliente_presente_completa_o_trabalho(self):
        app, trabalho = _build_app(_FakeRequest(disconnected=False))
        resp = TestClient(app, raise_server_exceptions=False).get("/rankings")
        assert resp.status_code == 200
        assert trabalho["etapas"] == ["rpc_principal", "hidratacao"]

    def test_cliente_desligado_corta_a_hidratacao(self, caplog):
        app, trabalho = _build_app(_FakeRequest(disconnected=True))
        with caplog.at_level(logging.INFO):
            resp = TestClient(app, raise_server_exceptions=False).get("/rankings")
        assert resp.status_code == 499, "cancelamento nao pode virar 500"
        assert resp.json()["stage"] == "hidratacao"
        assert trabalho["etapas"] == ["rpc_principal"], "a hidratacao NAO pode ter rodado"


class TestContratoDaExcecao:
    """Trava decisoes que ja custaram investigacao."""

    def test_client_gone_e_exception_nao_baseexception(self):
        """NAO trocar para BaseException.

        Testado empiricamente: o BaseHTTPMiddleware do Starlette 0.48 perde
        BaseException que sobe da rota e devolve `RuntimeError: No response
        returned.` -> 500, em vez do 499. Com Exception, o `except ClientGone`
        do middleware funciona. Este teste existe para que a "melhoria" nao
        seja reintroduzida.
        """
        # Classe que herda BaseException DIRETAMENTE nao e subclasse de Exception --
        # e essa a diferenca que quebrava o middleware. Uma assercao basta.
        assert issubclass(ClientGone, Exception)

    def test_stage_fica_disponivel_para_o_log(self):
        with pytest.raises(ClientGone) as exc:
            raise ClientGone("rankings:transcricao")
        assert exc.value.stage == "rankings:transcricao"


class TestGuardasNaRotaDeAnalytics:
    """ClientGone precisa ATRAVESSAR os `except Exception` do caminho de analytics.

    A rota de rankings tem duas camadas que engoliriam o cancelamento:
      1. o wrapper de retry (`except Exception` -> decide se re-tenta)
      2. o handler da rota (`except Exception` -> HTTPException 500)
    Sem as guardas `except ClientGone: raise`, o cancelamento viraria um 500 e,
    pior, o wrapper poderia RE-EXECUTAR a query que acabamos de cancelar.
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

    def test_handlers_das_rotas_tem_guarda(self):
        """Backstop estrutural: cada handler que vira 500 precisa da guarda acima.

        Se alguem remover um `except ClientGone: raise`, o cancelamento volta a
        ser reportado como erro de servidor (e a ir para o Sentry).
        """
        import inspect
        from app.routes import analytics

        src = inspect.getsource(analytics)
        for detalhe in (
            "Erro ao consultar analytics agregados.",
            "Erro ao consultar series do Manager.",
            "Erro ao consultar retencao do Manager.",
        ):
            antes = src[: src.index(detalhe)]
            trecho = antes[-900:]
            assert "except ClientGone" in trecho, (
                f"handler de '{detalhe}' perdeu a guarda except ClientGone"
            )

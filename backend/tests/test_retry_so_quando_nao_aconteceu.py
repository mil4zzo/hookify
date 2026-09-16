"""
Repetir só quando o trabalho NÃO aconteceu — contagem de tentativas por erro.

CONTEXTO (2026-09-15)
---------------------
`with_postgrest_retry` repetia também em `ReadTimeout`, porque a lista de
exceções citava `httpx.TimeoutException` — a classe-MÃE de ReadTimeout. No
incidente de 14/09 ("Erro ao carregar variações."), uma consulta de 18 s contra
um teto de cliente de 15 s virou 4 tentativas de 15 s: 1 minuto de espera para o
usuário e até 4 cópias da mesma consulta rodando no banco ao mesmo tempo.

Medido em produção em 15/09: quando o cliente desiste, a consulta CONTINUA no
banco (cliente desistindo em 0,15 s de uma leitura de ~3 s deixa o banco
trabalhando por mais de 1 s depois). Repetir não cancela nada: só empilha carga.

O QUE ESTE ARQUIVO PROVA
------------------------
Para cada classe de falha, QUANTAS vezes a função é chamada. É a contagem que
importa: um teste que só olhasse "levantou a exceção?" passaria igual com o bug,
já que depois de 4 tentativas a exceção sobe do mesmo jeito.

SABOTAGEM (feita em 15/09, tem de continuar valendo)
----------------------------------------------------
Devolver `httpx.TimeoutException` para `_NOMES_REPETIVEIS` em supabase_retry.py
faz `test_read_timeout_nao_repete` falhar com 4 chamadas em vez de 1. Conferido.
"""

import unittest

import httpx

from app.core import supabase_retry
from app.core.supabase_retry import with_postgrest_retry
from app.core.client_disconnect import ClientGone


class _APIErrorLike(Exception):
    """Mesma forma de postgrest.APIError (.code / .details)."""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code
        self.details = {}


def _conta_tentativas(exc_factory, attempts: int = 4):
    """Roda até esgotar e devolve quantas vezes fn() foi de fato chamada."""
    chamadas = [0]

    def fn():
        chamadas[0] += 1
        raise exc_factory()

    try:
        with_postgrest_retry("op", fn, attempts=attempts, base_delay=0.001)
    except BaseException:
        pass
    return chamadas[0]


class TestNaoRepeteQuandoOBancoEstaTrabalhando(unittest.TestCase):
    def test_read_timeout_nao_repete(self) -> None:
        # O pedido chegou; o banco ESTÁ trabalhando. Repetir soma uma cópia.
        self.assertEqual(_conta_tentativas(lambda: httpx.ReadTimeout("read")), 1)

    def test_write_timeout_nao_repete(self) -> None:
        self.assertEqual(_conta_tentativas(lambda: httpx.WriteTimeout("write")), 1)

    def test_statement_timeout_do_banco_nao_repete(self) -> None:
        # 57014: o banco desistiu sozinho. Repetir cai na mesma conexão e
        # re-executa a mesma consulta.
        self.assertEqual(_conta_tentativas(lambda: _APIErrorLike("57014", "canceling statement")), 1)

    def test_erro_de_negocio_nao_repete(self) -> None:
        self.assertEqual(_conta_tentativas(lambda: ValueError("coluna inexistente")), 1)

    def test_client_gone_nao_repete(self) -> None:
        # O usuário foi embora: repetir gasta banco por ninguém.
        self.assertEqual(_conta_tentativas(lambda: ClientGone("saiu")), 1)


class TestRepeteQuandoNaoAconteceu(unittest.TestCase):
    def test_connect_error_repete_ate_o_limite(self) -> None:
        self.assertEqual(_conta_tentativas(lambda: httpx.ConnectError("recusou")), 4)

    def test_connect_timeout_repete(self) -> None:
        self.assertEqual(_conta_tentativas(lambda: httpx.ConnectTimeout("nao abriu")), 4)

    def test_pool_timeout_repete(self) -> None:
        # Nem saiu do cliente: não há nada rodando no banco.
        self.assertEqual(_conta_tentativas(lambda: httpx.PoolTimeout("sem conexao livre")), 4)

    def test_remote_protocol_error_repete(self) -> None:
        self.assertEqual(_conta_tentativas(lambda: httpx.RemoteProtocolError("http2 drop")), 4)

    def test_read_error_repete(self) -> None:
        self.assertEqual(_conta_tentativas(lambda: httpx.ReadError("conexao morreu")), 4)

    def test_deadlock_repete(self) -> None:
        # O Postgres desfez a transação inteira antes de responder: nada gravado.
        self.assertEqual(_conta_tentativas(lambda: _APIErrorLike("40P01", "deadlock detected")), 4)

    def test_recupera_no_meio_do_caminho(self) -> None:
        chamadas = [0]

        def instavel():
            chamadas[0] += 1
            if chamadas[0] < 3:
                raise httpx.ConnectError("recusou")
            return "ok"

        self.assertEqual(with_postgrest_retry("op", instavel, attempts=4, base_delay=0.001), "ok")
        self.assertEqual(chamadas[0], 3)


class TestAListaNaoPodeArrastarAClasseMae(unittest.TestCase):
    """A regressão de 14/09 entrou por herança, não por alguém escrever ReadTimeout.

    Estes testes olham a própria lista, para que voltar a citar a classe-mãe
    falhe aqui com uma mensagem que explica o porquê — e não só lá em cima como
    "contei 4, esperava 1".
    """

    def test_classe_mae_de_timeout_fora_da_lista(self) -> None:
        repetiveis = supabase_retry._transient_httpx_exceptions()
        self.assertNotIn(
            httpx.TimeoutException,
            repetiveis,
            "httpx.TimeoutException é a classe-mãe de ReadTimeout: listá-la traz o "
            "ReadTimeout de volta por herança, que foi a causa do incidente de 14/09.",
        )

    def test_nenhum_timeout_de_leitura_ou_escrita_na_lista(self) -> None:
        repetiveis = supabase_retry._transient_httpx_exceptions()
        for proibida in (httpx.ReadTimeout, httpx.WriteTimeout):
            self.assertFalse(
                any(issubclass(proibida, c) for c in repetiveis),
                f"{proibida.__name__} casaria com a lista de repetíveis",
            )

    def test_classificador_barra_por_nome_mesmo_se_a_lista_falhar(self) -> None:
        # Cinto e suspensório: mesmo que alguém volte a pôr a classe-mãe na
        # lista, o barramento por nome exato segura o ReadTimeout.
        self.assertFalse(
            supabase_retry._e_repetivel(httpx.ReadTimeout("x"), (httpx.TimeoutException,))
        )


class TestSegundoMecanismoNoManager(unittest.TestCase):
    """`analytics._is_transient_analytics_rpc_error` — o outro caminho de retry.

    As RPCs do Manager (core, série, retenção) não passam por
    `with_postgrest_retry`: têm retry próprio. Ele classificava por TEXTO antes
    de olhar o tipo, e o marcador `"Timeout"` casava com qualquer timeout —
    ReadTimeout inclusive. Depois ainda listava `httpx.TimeoutException`, a
    classe-mãe. Duas portas para o mesmo erro, nas consultas mais pesadas do app.

    SABOTAGEM (feita em 15/09): devolver `"Timeout"` à lista de marcadores de
    texto faz `test_timeout_serializado_em_texto_nao_e_transitorio` falhar.

    Vale registrar POR QUE é esse o teste com dentes, e não o óbvio: a primeira
    sabotagem passou ilesa. Como o classificador barra pelo nome exato da classe
    antes de olhar o texto, um `httpx.ReadTimeout` de verdade é pego pelo nome e
    a linha sabotada nunca chega a rodar. Quem exercita o caminho do texto é o
    erro que chega SERIALIZADO numa Exception genérica — que é como boa parte
    dos erros do PostgREST chega até aqui (é assim que `_is_deadlock` acha o
    40P01). Teste que não passa pela linha alterada não prova a linha.
    """

    def setUp(self) -> None:
        from app.routes import analytics

        self.classificar = analytics._is_transient_analytics_rpc_error

    def test_read_timeout_nao_e_transitorio(self) -> None:
        self.assertFalse(self.classificar(httpx.ReadTimeout("timed out")))

    def test_timeout_exception_mae_nao_e_transitorio(self) -> None:
        self.assertFalse(self.classificar(httpx.TimeoutException("timed out")))

    def test_statement_timeout_por_codigo_nao_e_transitorio(self) -> None:
        self.assertFalse(self.classificar(_APIErrorLike("57014", "canceling statement")))

    def test_statement_timeout_por_texto_nao_e_transitorio(self) -> None:
        # Chega assim quando o erro vem serializado, sem `.code`.
        self.assertFalse(self.classificar(RuntimeError("{'code': '57014', 'message': 'canceling statement due to statement timeout'}")))

    def test_timeout_serializado_em_texto_nao_e_transitorio(self) -> None:
        # O caso que a checagem por TIPO não pega: o erro chega embrulhado numa
        # Exception genérica, com o timeout só na mensagem. É assim que boa parte
        # dos erros do PostgREST chega aqui — `_is_deadlock` acha o 40P01 desse
        # jeito, por substring. Com o marcador `"Timeout"` na lista de texto,
        # ESTE caso voltava a ser repetido.
        self.assertFalse(self.classificar(RuntimeError("ReadTimeout: The read operation timed out")))
        self.assertFalse(self.classificar(RuntimeError("httpx.ReadTimeout")))

    def test_queda_de_conexao_e_transitoria(self) -> None:
        self.assertTrue(self.classificar(httpx.ConnectError("recusou")))
        self.assertTrue(self.classificar(httpx.RemoteProtocolError("http2 drop")))
        self.assertTrue(self.classificar(httpx.PoolTimeout("sem conexao livre")))

    def test_texto_de_queda_de_conexao_e_transitorio(self) -> None:
        self.assertTrue(self.classificar(RuntimeError("connection reset by peer")))

    def test_erro_de_negocio_nao_e_transitorio(self) -> None:
        self.assertFalse(self.classificar(ValueError("coluna inexistente")))


if __name__ == "__main__":
    unittest.main()

"""
`_fetch_present_parent_ids` le o escopo do inventario de UMA chamada a RPC.

O QUE ISTO TRAVA (migration 149, 2026-09-09)
--------------------------------------------
Antes, isto paginava a tabela `ads` inteira do usuario (46.581 linhas de mil em mil)
para aproveitar duas colunas. Medido em producao, era o MAIOR consumidor do banco:
175.008 chamadas e 5.011 s em 14 dias. E o `.range()` do PostgREST vira LIMIT/OFFSET,
entao cada pagina custava mais que a anterior (2 ms na primeira, 59 ms na quadragesima).

Agora e `present_parent_ids(p_user_id)`, que agrega no servidor e devolve dois arrays.
A equivalencia do RESULTADO esta provada no lado SQL, contra todo silo real do
laboratorio, em `supabase/tests/149_escopo_de_pais.test.sql`. Aqui se trava o lado
Python: a forma da chamada e a traducao da resposta em conjuntos.

POR QUE NAO FILTRAR PELOS IDS QUE O CHAMADOR JA TEM
---------------------------------------------------
Seria mais barato ainda, e e a primeira ideia de qualquer um. Nao da: o PostgREST
devolveria uma linha por ANUNCIO (nao por campanha) e o teto silencioso de 1.000 linhas
cortaria a resposta sem erro — campanhas sumiriam do escopo e ficariam com orcamento e
status por gravar. Com a agregacao no servidor nao ha linha para truncar. O teste SQL
trava isso com um silo de 1.200 campanhas.
"""
import unittest
from unittest import mock

from app.services import supabase_repo


class _Rpc:
    def __init__(self, data):
        self._data = data

    def execute(self):
        return type("Res", (), {"data": self._data})()


class _FakeSB:
    def __init__(self, data):
        self._data = data
        self.chamadas = []
        self.tabelas_tocadas = []

    def rpc(self, nome, params):
        self.chamadas.append((nome, dict(params)))
        return _Rpc(self._data)

    def table(self, nome):
        # Nenhuma tabela deve ser tocada por este caminho.
        self.tabelas_tocadas.append(nome)
        raise AssertionError(f"tabela `{nome}` tocada — o escopo vem da RPC (149)")


def _run(sb, user_id="u1"):
    with mock.patch.object(supabase_repo, "with_postgrest_retry", side_effect=lambda _l, fn: fn()):
        return supabase_repo._fetch_present_parent_ids(sb, user_id)


class TestFetchPresentParentIds(unittest.TestCase):
    def test_arrays_viram_conjuntos(self):
        sb = _FakeSB([{"campaign_ids": ["c1", "c2"], "adset_ids": ["a1"]}])
        campanhas, conjuntos = _run(sb)
        self.assertEqual(campanhas, {"c1", "c2"})
        self.assertEqual(conjuntos, {"a1"})

    def test_uma_unica_chamada_com_o_silo(self):
        sb = _FakeSB([{"campaign_ids": [], "adset_ids": []}])
        _run(sb, "silo-x")
        self.assertEqual(sb.chamadas, [("present_parent_ids", {"p_user_id": "silo-x"})])

    def test_nao_toca_em_nenhuma_tabela(self):
        # A varredura de `ads` nao pode voltar por nenhuma porta.
        sb = _FakeSB([{"campaign_ids": ["c1"], "adset_ids": ["a1"]}])
        _run(sb)
        self.assertEqual(sb.tabelas_tocadas, [])

    def test_silo_vazio_devolve_conjuntos_vazios(self):
        sb = _FakeSB([{"campaign_ids": [], "adset_ids": []}])
        self.assertEqual(_run(sb), (set(), set()))

    def test_null_no_lugar_do_array_nao_explode(self):
        # A RPC usa coalesce e nunca devolve NULL, mas o chamador nao pode depender
        # disso para nao quebrar: `None` vira conjunto vazio, nao TypeError.
        sb = _FakeSB([{"campaign_ids": None, "adset_ids": None}])
        self.assertEqual(_run(sb), (set(), set()))

    def test_resposta_sem_linhas_nao_explode(self):
        self.assertEqual(_run(_FakeSB([])), (set(), set()))
        self.assertEqual(_run(_FakeSB(None)), (set(), set()))

    def test_vazio_e_espaco_sao_descartados_como_antes(self):
        # O codigo antigo filtrava valor "falsy" (`if r.get("campaign_id")`), o que
        # descartava string vazia. A RPC so descarta NULL, entao o filtro fica aqui:
        # hoje nao ha nenhuma vazia em producao (medido), mas o contrato nao muda.
        sb = _FakeSB([{"campaign_ids": ["c1", "", "  ", None, "c2"], "adset_ids": [""]}])
        campanhas, conjuntos = _run(sb)
        self.assertEqual(campanhas, {"c1", "c2"})
        self.assertEqual(conjuntos, set())

    def test_ids_nao_texto_viram_texto(self):
        # O chamador compara com `str(entity_id)`; um id numerico tem de casar.
        sb = _FakeSB([{"campaign_ids": [123, "c2"], "adset_ids": [456]}])
        campanhas, conjuntos = _run(sb)
        self.assertEqual(campanhas, {"123", "c2"})
        self.assertEqual(conjuntos, {"456"})

    def test_duplicatas_colapsam(self):
        sb = _FakeSB([{"campaign_ids": ["c1", "c1", " c1 "], "adset_ids": []}])
        self.assertEqual(_run(sb)[0], {"c1"})

    def test_passa_pelo_retry_do_postgrest(self):
        # Queda transitoria de HTTP/2 contra o Supabase e rotina (69 em 10 h, medido).
        # Esta chamada tem de estar dentro do helper de retry, como a varredura estava.
        sb = _FakeSB([{"campaign_ids": ["c1"], "adset_ids": []}])
        with mock.patch.object(
            supabase_repo, "with_postgrest_retry", side_effect=lambda _l, fn: fn()
        ) as retry:
            supabase_repo._fetch_present_parent_ids(sb, "u1")
        retry.assert_called_once()
        self.assertEqual(retry.call_args[0][0], "present_parent_ids")


if __name__ == "__main__":
    unittest.main()

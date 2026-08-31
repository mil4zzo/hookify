"""
`include_parent_ids` e OPT-IN, e o passthrough de `names` nao pode ser esquecido.

CONTEXTO (medido no laboratorio, migration 136)
-----------------------------------------------
`campaign_ids`/`adset_ids` na linha mais o dicionario `names` na raiz existem para
uma pergunta que a tela nao conseguia fazer direito: "me mostre os criativos da
campanha X". Antes, a linha so trazia a campanha do REPRESENTANTE do grupo, e o
filtro escondia todo criativo cuja maior entrega estivesse em outra campanha - 390
de 1.739 criativos (22%) na conta principal.

Custa, porque um criativo colapsa dezenas de anuncios. Em bytes COMPRIMIDOS:

    criativos | 36 packs | 13 meses : 224 kB -> 373 kB  (+67%)
    criativos | 36 packs | 30 dias  :  85 kB -> 115 kB  (+35%)
    anuncios / conjuntos / campanhas:                    (+6%)

Por isso o default e False: quem nao filtra por campanha (Explorer; Plano/GOLD/
Insights quando o criterio nao cita campanha) nao paga. Este teste trava o default
no lado barato - esquecer o campo passa a ser leve, e o caminho caro exige pedido
explicito. E o mesmo desenho de `include_available_conversion_types`, cujo default
True fez o app pagar por meses sem ninguem escrever True em lugar nenhum.
"""

import unittest

from app.routes.analytics import RankingsRequest, _normalize_rankings_rpc_response


class TestParentIdsOptIn(unittest.TestCase):
    def _req(self, **extra):
        return RankingsRequest(date_start="2026-07-07", date_stop="2026-08-17", **extra)

    def test_default_e_desligado(self):
        # Se este teste falhar porque alguem ligou o default: o custo medido esta no
        # docstring acima. Preferir ligar no caller especifico (Manager, Boards).
        self.assertFalse(self._req().include_parent_ids)

    def test_pode_ser_ligado_explicitamente(self):
        self.assertTrue(self._req(include_parent_ids=True).include_parent_ids)

    def test_outros_include_mantem_o_proprio_default(self):
        # Guarda contra troca em massa: mexer nestes muda o que a tela recebe.
        req = self._req()
        self.assertTrue(req.include_series)
        self.assertTrue(req.include_leadscore)
        self.assertFalse(req.include_available_conversion_types)


class TestNamesPassthrough(unittest.TestCase):
    """`_normalize_rankings_rpc_response` e uma WHITELIST.

    O dicionario de nomes chega do banco e morreria aqui, em silencio - a tela
    mostraria o id cru no seletor de Campanha e nenhuma regra sobre "Nome da
    campanha" funcionaria. Foi exatamente o que ja aconteceu com `overlap`.
    """

    def test_names_passa(self):
        payload = {
            "data": [],
            "names": {"campaigns": {"120": "BLACK FRIDAY"}, "adsets": {"456": "Publico frio"}},
        }
        out = _normalize_rankings_rpc_response(payload)
        self.assertEqual(out["names"]["campaigns"]["120"], "BLACK FRIDAY")
        self.assertEqual(out["names"]["adsets"]["456"], "Publico frio")

    def test_sem_names_a_chave_nao_e_inventada(self):
        # Com o gate desligado a RPC nao devolve `names`. Inventar `{}` aqui faria a
        # tela achar que o dicionario veio vazio (todos os nomes ausentes) em vez de
        # "nao pedi" - e a regra de nome seria avaliada em vez de ignorada.
        out = _normalize_rankings_rpc_response({"data": []})
        self.assertNotIn("names", out)

    def test_names_de_tipo_errado_e_descartado(self):
        for lixo in ([], "texto", 42, None):
            with self.subTest(lixo=lixo):
                self.assertNotIn("names", _normalize_rankings_rpc_response({"data": [], "names": lixo}))

    def test_o_resto_da_whitelist_continua_de_pe(self):
        payload = {
            "data": [{"group_key": "a"}],
            "averages": {"hook": 0.3},
            "pagination": {"total": 1},
            "overlap": {"rows": 2},
            "available_conversion_types": ["action:purchase"],
            "chave_desconhecida": "deve sumir",
        }
        out = _normalize_rankings_rpc_response(payload)
        self.assertEqual(out["averages"], {"hook": 0.3})
        self.assertEqual(out["pagination"], {"total": 1})
        self.assertEqual(out["overlap"], {"rows": 2})
        self.assertEqual(out["available_conversion_types"], ["action:purchase"])
        self.assertNotIn("chave_desconhecida", out)


if __name__ == "__main__":
    unittest.main()

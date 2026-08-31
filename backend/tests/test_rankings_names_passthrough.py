"""
`names` e uma chave da WHITELIST - e whitelist esquece em silencio.

`_normalize_rankings_rpc_response` copia campo a campo o que a RPC devolve. O
dicionario id -> nome de campanhas e conjuntos (migration 136/137) chega do banco e
morreria ali sem este passthrough: a tela mostraria o id cru no seletor de Campanha e
nenhuma regra sobre "Nome da campanha" funcionaria - sem erro, so sem efeito. Foi
exatamente o que ja aconteceu com `overlap`.

HISTORICO DO ARQUIVO
   Nasceu tambem para travar `include_parent_ids` como opt-in (default False). A
   medicao que motivava o opt-in foi refeita no tamanho REAL do Manager (ate 10.000
   linhas, nao 500) e ficou bem menor: +29 kB numa carga de 30 dias, +197 kB em 13
   meses, comprimidos. O idealizador decidiu ligar sempre e o parametro saiu inteiro
   (migration 137) - padroniza o contrato e as telas que hoje nao filtram por campanha
   provavelmente vao filtrar. O que sobrou aqui e o que continua valendo.
"""

import unittest

from app.routes.analytics import _normalize_rankings_rpc_response


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

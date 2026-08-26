"""
`available_conversion_types` e OPT-IN, nao opt-out.

CONTEXTO (EXPLAIN das RPCs do Manager, 2026-08-25)
--------------------------------------------------
Pedir para a RPC calcular a lista de eventos de conversao expande ~70 tipos a
partir do jsonb, linha a linha. Medido com EXPLAIN ANALYZE sobre dados reais:

    3 packs  /  64k linhas   ->  3,4 s contra 2,6 s   (+0,8 s)
    30 packs / 119k linhas   -> 10-17 s contra 6,9-7,6 s   (+3 a +9 s)

A lista ja existe materializada em `packs.conversion_types` (union incremental no
refresh) justamente para nao pagar isso no read-path.

O default era `True`. Por isso `useAdPerformancePipeline` e `useExplorerData`
pagaram o custo por meses **sem ninguem escrever `True` em lugar nenhum** — bastava
nao setar o campo. Este teste trava o default no lado barato: esquecer o campo
passa a ser rapido, e o caminho caro exige um pedido explicito.
"""

import unittest

from app.routes.analytics import RankingsRequest


class TestConversionTypesOptIn(unittest.TestCase):
    def _req(self, **extra):
        return RankingsRequest(date_start="2026-07-07", date_stop="2026-08-17", **extra)

    def test_default_e_desligado(self):
        # Se este teste falhar porque alguem voltou o default para True: o custo
        # medido esta no docstring acima. Preferir passar True no caller especifico.
        self.assertFalse(self._req().include_available_conversion_types)

    def test_pode_ser_ligado_explicitamente(self):
        # O caminho caro continua disponivel — so deixou de ser o silencioso.
        self.assertTrue(
            self._req(include_available_conversion_types=True).include_available_conversion_types
        )

    def test_outros_include_mantem_o_proprio_default(self):
        # Guarda contra troca em massa: `include_series` e `include_leadscore` sao
        # baratos e seguem ligados por padrao. Mexer neles muda o que a tela recebe.
        req = self._req()
        self.assertTrue(req.include_series)
        self.assertTrue(req.include_leadscore)


if __name__ == "__main__":
    unittest.main()

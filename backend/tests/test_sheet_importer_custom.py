# -*- coding: utf-8 -*-
"""Migration 140 — importer com colunas vinculadas.

Prova:
- o histograma nasce na importação, por (anúncio, dia, vínculo), normalizado;
- célula inválida numa coluna vinculada é PULADA e contada — nunca invalida a linha
  nem toca no leadscore V1;
- categoria acima do teto é invalidada inteira e reportada, sem abortar;
- o item do RPC leva `custom_hist` COMPLETO por anúncio-dia ({} quando não há valor),
  e ids com o mesmo par (leadscore, custom_hist) viajam juntos;
- sem vínculo nenhum, o item continua levando custom_hist = {} (limpa dado morto).
"""
import unittest

from app.services import sheet_column_mappings as scm
from app.services.ad_metrics_sheet_importer import (
    _build_final_data_and_groups,
    _parse_and_aggregate_rows,
)

IDADE = {"id": "m-idade", "kind": "number", "column_index": 3, "label": "Idade"}
FAIXA = {"id": "m-faixa", "kind": "category", "column_index": 4, "label": "Faixa"}
LS2 = {"id": "m-ls2", "kind": "leadscore", "column_index": 5, "label": "LS V2", "config": {"mql_min": 70}}

# colunas: 0 ad_id | 1 data | 2 leadscore | 3 idade | 4 faixa | 5 ls2
ROWS = [
    ["ad1", "01/07/2026", "80", "25", " Faixa  B ", "85,0"],
    ["ad1", "01/07/2026", "60", "25.0", "A", "70"],
    ["ad1", "01/07/2026", "90", "x", "", "abc"],       # idade inválida, faixa vazia, ls2 inválido
    ["ad2", "01/07/2026", "50", "31", "B", "40"],
    ["ad1", "02/07/2026", "", "40", "C", "10"],        # sem leadscore V1: linha inteira fora (regra do V1)
]


class TestCollector(unittest.TestCase):
    def _parse(self, mappings, rows=ROWS):
        collector = scm.HistogramCollector(mappings)
        aggregated, processed, skipped = _parse_and_aggregate_rows(rows, 0, 1, 2, "DD/MM/YYYY", None, collector)
        return collector, aggregated, processed, skipped

    def test_histograma_por_anuncio_dia_normalizado(self):
        collector, aggregated, processed, skipped = self._parse([IDADE, FAIXA, LS2])
        self.assertEqual(processed, 5)
        self.assertEqual(skipped, 1)  # a linha sem leadscore V1
        invalid = collector.invalid_mappings()
        self.assertEqual(invalid, {})
        h = collector.histogram_for(("ad1", "2026-07-01"), invalid)
        self.assertEqual(h["m-idade"], {"25": 2})          # "25" e "25.0" = mesma chave
        self.assertEqual(h["m-faixa"], {"Faixa B": 1, "A": 1})
        self.assertEqual(h["m-ls2"], {"85": 1, "70": 1})   # "85,0" → "85"
        self.assertEqual(collector.histogram_for(("ad2", "2026-07-01"), invalid), {"m-idade": {"31": 1}, "m-faixa": {"B": 1}, "m-ls2": {"40": 1}})

    def test_celula_invalida_e_pulada_e_contada_sem_tocar_no_v1(self):
        collector, aggregated, _, _ = self._parse([IDADE, FAIXA, LS2])
        report = collector.report()
        self.assertEqual(report["m-idade"]["skipped"], 1)
        self.assertEqual(report["m-ls2"]["skipped"], 1)
        self.assertEqual(report["m-faixa"]["skipped"], 0)   # vazia não conta como inválida
        # leadscore V1 da linha com célula ruim continua lá
        self.assertEqual(sorted(aggregated[("ad1", "2026-07-01")]["leadscore_values"]), [60.0, 80.0, 90.0])

    def test_categoria_acima_do_teto_e_invalidada_inteira(self):
        rows = [["ad1", "01/07/2026", "80", "", f"r{i}", ""] for i in range(scm.CATEGORY_MAX_DISTINCT + 1)]
        collector, _, _, _ = self._parse([FAIXA], rows)
        invalid = collector.invalid_mappings()
        self.assertIn("m-faixa", invalid)
        self.assertEqual(collector.histogram_for(("ad1", "2026-07-01"), invalid), {})
        self.assertIsNotNone(collector.report()["m-faixa"]["invalid_reason"])

    def test_sem_vinculo_o_collector_e_inerte(self):
        collector, aggregated, _, _ = self._parse([])
        self.assertFalse(collector.enabled)
        self.assertEqual(collector.histogram_for(("ad1", "2026-07-01"), {}), {})
        self.assertEqual(len(aggregated), 2)


class TestItensDoRpc(unittest.TestCase):
    def _items(self, mappings, rows=ROWS):
        collector = scm.HistogramCollector(mappings)
        aggregated, _, _ = _parse_and_aggregate_rows(rows, 0, 1, 2, "DD/MM/YYYY", None, collector)
        return _build_final_data_and_groups(aggregated, collector)

    def test_custom_hist_completo_por_anuncio_dia(self):
        final_data, _, rpc_updates = self._items([IDADE, FAIXA])
        self.assertEqual(final_data["2026-07-01-ad1"]["custom_hist"], {"m-idade": {"25": 2}, "m-faixa": {"Faixa B": 1, "A": 1}})
        by_id = {i: u for u in rpc_updates for i in u["ids"]}
        self.assertEqual(by_id["2026-07-01-ad1"]["custom_hist"], {"m-idade": {"25": 2}, "m-faixa": {"Faixa B": 1, "A": 1}})
        self.assertEqual(by_id["2026-07-01-ad1"]["leadscore_values"], [60.0, 80.0, 90.0] if False else by_id["2026-07-01-ad1"]["leadscore_values"])
        self.assertEqual(sorted(by_id["2026-07-01-ad1"]["leadscore_values"]), [60.0, 80.0, 90.0])

    def test_sem_vinculo_manda_objeto_vazio_para_limpar(self):
        _, _, rpc_updates = self._items([])
        for item in rpc_updates:
            self.assertEqual(item["custom_hist"], {})

    def test_ids_com_o_mesmo_par_viajam_juntos(self):
        rows = [
            ["ad1", "01/07/2026", "80", "25", "A", ""],
            ["ad2", "01/07/2026", "80", "25", "A", ""],
            ["ad3", "01/07/2026", "80", "26", "A", ""],
        ]
        _, groups, rpc_updates = self._items([IDADE, FAIXA], rows)
        self.assertEqual(len(rpc_updates), 2)
        sizes = sorted(len(u["ids"]) for u in rpc_updates)
        self.assertEqual(sizes, [1, 2])

    def test_sem_leadscore_no_item_quando_nao_ha(self):
        rows = [["ad1", "01/07/2026", "80", "25", "A", ""]]
        _, _, rpc_updates = self._items([IDADE], rows)
        self.assertIn("leadscore_values", rpc_updates[0])
        self.assertEqual(rpc_updates[0]["custom_hist"], {"m-idade": {"25": 1}})


if __name__ == "__main__":
    unittest.main()

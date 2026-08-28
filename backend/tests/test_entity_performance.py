# -*- coding: utf-8 -*-
"""O agregador único das telas de detalhe (migration 133).

Trava o contrato entre o payload da RPC `fetch_entity_performance_v133` (totais e
dias já com somas ponderadas, conversões {chave: valor}, leads {score: qtd}) e o
formato que as 7 rotas sempre devolveram. A equivalência com as rotas antigas sobre
dados reais é provada por `backend/scripts/diff_entity_routes.py`; aqui ficam as
regras que o diferencial não isola: MQL indefinido ≠ zero, série nula do filho sem
dia no eixo, conversões sem prefixo no conjunto, curva ponderada por índice, 403.

SABOTAGENS PROVADAS (2026-08-27): trocar `count_mql` para devolver 0 sem corte
→ falha `test_mql_sem_corte_e_indefinido`; remover o `series_null_when_empty`
→ falha `test_filho_sem_dia_no_eixo_tem_series_nula`; somar plays de todas as
linhas na curva → falha `test_curva_pondera_so_quem_tem_o_indice`.
"""
import unittest
from unittest import mock

from fastapi import HTTPException

from app.routes import analytics as A
from app.services import entity_performance as EP


def _group(**over):
    g = {
        "group_key": "N1",
        "ad_count": 2,
        "user_id": "u1",
        "ad_id": "a1",
        "ad_name": "N1",
        "account_id": "act_1",
        "campaign_id": "c1",
        "campaign_name": "Camp",
        "adset_id": "s1",
        "adset_name": "Set",
        "effective_status": "ACTIVE",
        "thumb_storage_path": "thumbs/u1/x.webp",
        "curve_wsum": [1000.0, 500.0, 250.0],
        "curve_psum": [10, 10, 5],
        "totals": {
            "impressions": 1000, "clicks": 50, "inline_link_clicks": 40, "spend": 12.5, "lpv": 20,
            "plays": 100, "thruplays": 30, "hook_wsum": 40.0, "scroll_stop_wsum": 60.0,
            "hold_rate_wsum": 25.0, "video_watched_p50_wsum": 2550.0, "video_watched_p75_wsum": 1250.0,
            "reach": 400,
            "conversions": {"conversion:lead": 11.0, "action:landing_page_view": 20.0},
            "leads": {"80": 2, "40": 1},
        },
        "days": [
            {"date": "2026-01-05", "impressions": 600, "clicks": 30, "inline_link_clicks": 24, "spend": 7.5,
             "lpv": 12, "plays": 60, "thruplays": 18, "hook_wsum": 24.0, "scroll_stop_wsum": 36.0,
             "hold_rate_wsum": 15.0, "video_watched_p50_wsum": 1530.0, "video_watched_p75_wsum": 750.0,
             "reach": 240, "conversions": {"conversion:lead": 6.0}, "leads": {"80": 2}},
        ],
    }
    g.update(over)
    return g


class TestNumeros(unittest.TestCase):
    def test_totais_e_razoes_com_as_formulas_do_manager(self):
        t = EP.totals_of(_group())
        d = EP.derived_of(t)
        self.assertEqual(t["impressions"], 1000)
        self.assertEqual(t["conversions"], {"conversion:lead": 11, "action:landing_page_view": 20})
        self.assertEqual(t["leadscore_values"], [40.0, 80.0, 80.0])
        self.assertAlmostEqual(d["ctr"], 0.05)
        self.assertAlmostEqual(d["hook"], 0.4)
        self.assertAlmostEqual(d["scroll_stop"], 0.6)
        self.assertEqual(d["video_watched_p50"], 26)  # round(25.5) half-even = 26? 25.5 -> 26 (Python: 26)
        self.assertAlmostEqual(d["cpm"], 12.5)
        self.assertAlmostEqual(d["frequency"], 2.5)

    def test_frequencia_sem_reach_e_nula(self):
        g = _group()
        g["totals"]["reach"] = 0
        self.assertIsNone(EP.derived_of(EP.totals_of(g))["frequency"])

    def test_conversoes_sem_prefixo_do_conjunto(self):
        self.assertEqual(
            EP.plain_conversions_of({"conversion:lead": 11.0, "action:landing_page_view": 20.0, "conversion:": 3}),
            {"lead": 11},
        )

    def test_mql_sem_corte_e_indefinido(self):
        self.assertIsNone(EP.count_mql({"80": 2}, None))
        self.assertEqual(EP.count_mql({"80": 2, "40": 1}, 50.0), 2)
        self.assertEqual(EP.count_mql({}, 50.0), 0)

    def test_curva_pondera_so_quem_tem_o_indice(self):
        # índice 2: só 5 plays chegaram lá → 250/5 = 50, não 250/10
        self.assertEqual(EP.curve_of(_group()), [100, 50, 50])
        self.assertIsNone(EP.curve_of(_group(curve_wsum=None, curve_psum=None)))


class TestSerieEHistorico(unittest.TestCase):
    def test_serie_de_5_dias_com_mql_disponivel(self):
        axis = EP.axis_5_days("2026-01-05")
        s = EP.series_of(_group(), axis, 50.0)
        self.assertEqual(s["axis"][-1], "2026-01-05")
        self.assertAlmostEqual(s["hook"][-1], 0.4)
        self.assertEqual(s["mqls"][-1], 2)
        self.assertAlmostEqual(s["cpmql"][-1], 3.75)
        self.assertEqual(s["conversions"][-1], {"conversion:lead": 6})
        self.assertIsNone(s["hook"][0])  # dia sem dado

    def test_serie_sem_corte_nao_afirma_mql(self):
        s = EP.series_of(_group(), EP.axis_5_days("2026-01-05"), None)
        self.assertEqual(s["mqls"], [None] * 5)
        self.assertEqual(s["cpmql"], [None] * 5)
        self.assertAlmostEqual(s["leadscore_avg"][-1], 80.0)  # a média não depende do corte

    def test_historico_um_por_dia_com_zeros(self):
        rows = EP.history_rows(_group(), EP.axis_date_range("2026-01-04", "2026-01-05"), None)
        self.assertEqual([r["date"] for r in rows], ["2026-01-04", "2026-01-05"])
        self.assertEqual(rows[0]["impressions"], 0)
        self.assertIsNone(rows[0]["mqls"])
        self.assertEqual(rows[1]["impressions"], 600)
        self.assertAlmostEqual(rows[1]["frequency"], 2.5)
        self.assertEqual(rows[1]["conversions"], {"conversion:lead": 6})


class _Sb:
    def __init__(self, payload=None, error=None):
        self.payload, self.error, self.params = payload, error, None

    def rpc(self, _name, params):
        self.params = params
        return self

    def execute(self):
        if self.error:
            raise self.error
        return type("Res", (), {"data": self.payload})()


class _PgError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


class TestRotas(unittest.TestCase):
    USER = {"user_id": "u1", "token": "t"}

    def _patch(self, sb):
        return mock.patch.object(A, "get_supabase_for_user", return_value=sb)

    def test_filho_sem_dia_no_eixo_tem_series_nula(self):
        g2 = _group(group_key="a2", ad_id="a2", days=[])
        sb = _Sb({"mql_leadscore_min": None, "groups": [_group(group_key="a1"), g2]})
        with self._patch(sb):
            out = A.get_rankings_children("N1", "2026-01-01", "2026-01-05", None, True, ["p1"], self.USER)
        by_id = {r["ad_id"]: r for r in out["data"]}
        self.assertIsNotNone(by_id["a1"]["series"])
        self.assertIsNone(by_id["a2"]["series"])  # contrato historico do filho por ad_name
        self.assertEqual(sb.params["p_group_by"], "ad_id")
        self.assertEqual(sb.params["p_series_days"], 5)

    def test_filho_do_conjunto_sempre_tem_series(self):
        sb = _Sb({"mql_leadscore_min": None, "groups": [_group(group_key="a2", ad_id="a2", days=[])]})
        with self._patch(sb):
            out = A.get_adset_children("s1", "2026-01-01", "2026-01-05", None, True, ["p1"], self.USER)
        self.assertIsNotNone(out["data"][0]["series"])
        self.assertEqual(out["data"][0]["ad_count"], 1)
        self.assertIsNone(out["data"][0]["unique_id"])

    def test_detalhe_404_quando_nao_ha_grupo(self):
        with self._patch(_Sb({"mql_leadscore_min": None, "groups": []})):
            with self.assertRaises(HTTPException) as cm:
                A.get_ad_details("1", "2026-01-01", "2026-01-05", ["p1"], self.USER)
        self.assertEqual(cm.exception.status_code, 404)

    def test_pack_inacessivel_vira_403(self):
        with self._patch(_Sb(error=_PgError("42501"))):
            with self.assertRaises(HTTPException) as cm:
                A.get_ad_name_details("N1", "2026-01-01", "2026-01-05", True, ["p1"], self.USER)
        self.assertEqual(cm.exception.status_code, 403)

    def test_detalhe_do_conjunto_conversoes_sem_prefixo(self):
        with self._patch(_Sb({"mql_leadscore_min": 50, "groups": [_group()]})):
            out = A.get_adset_details("s1", "2026-01-01", "2026-01-05", ["p1"], self.USER)
        self.assertEqual(out["conversions"], {"lead": 11})
        self.assertEqual(out["series"]["conversions"][-1], {"lead": 6})  # a série também sem prefixo
        self.assertEqual(out["ad_name"], "Set")
        self.assertIsNone(out["thumbnail"])

    def test_historico_manda_o_periodo_inteiro(self):
        sb = _Sb({"mql_leadscore_min": None, "groups": [_group()]})
        with self._patch(sb):
            out = A.get_ad_history("a1", "2026-01-03", "2026-01-05", None, self.USER)
        self.assertEqual(len(out["data"]), 3)
        self.assertIsNone(sb.params["p_series_days"])
        self.assertIsNone(sb.params["p_pack_ids"])  # ramo legado: None, nao lista vazia


if __name__ == "__main__":
    unittest.main()

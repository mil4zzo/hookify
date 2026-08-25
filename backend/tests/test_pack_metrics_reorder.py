# -*- coding: utf-8 -*-
"""Reordenacao attr-first de fetch_pack_metrics_rows (drill).

Trava o contrato do caminho atributo-primeiro: candidatos de ad_metrics buscados
por ATRIBUTO sao filtrados pela pertinencia ao pack (composto {date}-{ad_id} em
ad_metric_pack_map), com dedup cross-silo. Regressao aqui = numero do drill
descolando do numero da tabela. (Equivalencia com a impl. antiga foi validada
ao vivo contra o banco real: 1692 e 447 linhas, saida identica.)
"""
import unittest
from unittest import mock

from app.services import supabase_repo as R


class TestAttrFirstReorder(unittest.TestCase):
    def _run(self, candidates, membership, owner_map):
        # **kwargs absorve parametros opcionais do helper (ex.: `cancellable`)
        # sem afrouxar o que este teste verifica: quais linhas voltam.
        def fake_fetch(sb, table, select, filters, *args, **kwargs):
            if table == "ad_metrics":
                return list(candidates)
            if table == "ad_metric_pack_map":
                return list(membership)
            return []

        with mock.patch.object(R, "resolve_pack_owner_map", return_value=owner_map), \
             mock.patch.object(R, "get_supabase_service", return_value=object()), \
             mock.patch.object(R, "_fetch_all_paginated", side_effect=fake_fetch):
            return R.fetch_pack_metrics_rows(
                "actor-1", ["pack-1"], "2026-01-01", "2026-01-31",
                "ad_id,date", None, {"adset_id": "AS1"}, log_tag="test",
            )

    def test_filtra_por_pertinencia_ao_pack(self):
        # 3 candidatos do dono batendo o atributo; so 2 compostos estao no pack.
        cand = [
            {"ad_id": "A", "date": "2026-01-01", "user_id": "owner-1"},
            {"ad_id": "A", "date": "2026-01-02", "user_id": "owner-1"},  # fora do pack
            {"ad_id": "B", "date": "2026-01-01", "user_id": "owner-1"},
        ]
        member = [
            {"ad_id": "A", "metric_date": "2026-01-01"},
            {"ad_id": "B", "metric_date": "2026-01-01"},
        ]
        out = self._run(cand, member, {"pack-1": "owner-1"})
        got = sorted((r["ad_id"], r["date"]) for r in out)
        self.assertEqual(got, [("A", "2026-01-01"), ("B", "2026-01-01")])

    def test_candidato_fora_do_pack_e_descartado(self):
        cand = [{"ad_id": "Z", "date": "2026-01-05", "user_id": "owner-1"}]
        out = self._run(cand, [], {"pack-1": "owner-1"})
        self.assertEqual(out, [])

    def test_sem_pack_acessivel_retorna_vazio(self):
        out = self._run([{"ad_id": "A", "date": "2026-01-01", "user_id": "o"}], [], {})
        self.assertEqual(out, [])

    def test_dedup_cross_silo_vence_dono_do_pack(self):
        # Mesmo (ad_id,date) em dois silos: vence o que NAO e o ator (dono do pack).
        cand = [
            {"ad_id": "A", "date": "2026-01-01", "user_id": "actor-1"},
            {"ad_id": "A", "date": "2026-01-01", "user_id": "owner-2"},
        ]
        member = [{"ad_id": "A", "metric_date": "2026-01-01"}]
        out = self._run(cand, member, {"pack-1": "actor-1", "pack-2": "owner-2"})
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["user_id"], "owner-2")


if __name__ == "__main__":
    unittest.main()

"""
`upsert_parent_entities` grava SÓ os pais que mudaram e devolve quantos foram.

O QUE ISTO TRAVA (fase 2 do cache, 2026-08-27)
----------------------------------------------
O sync on-focus (a cada 5 min por pack) regravava TODOS os conjuntos/campanhas no
escopo mesmo quando nada tinha mudado — e, sem contagem, o frontend refazia a busca das
visões de conjunto/campanha depois de cada sync, jogando fora o cache restaurado do disco.

Agora: lê as linhas atuais, compara os campos que o read-path usa (status, orçamento,
modo, conta, campanha-pai), faz upsert só das diferentes e devolve a contagem. O
endpoint soma isso em `changed_parents`; o frontend só refaz a busca se > 0.
"""
import unittest
from unittest import mock

from app.services import supabase_repo


class _Query:
    def __init__(self, table, db, registro):
        self.table, self.db, self.registro = table, db, registro
        self.op, self.payload, self.filtros = "select", None, {}

    def select(self, campos):
        self.op = "select"
        self.payload = campos
        return self

    def upsert(self, rows, on_conflict=None):
        self.op = "upsert"
        self.payload = rows
        return self

    def eq(self, col, val):
        self.filtros[col] = val
        return self

    def in_(self, col, vals):
        self.filtros[col] = list(vals)
        return self

    def range(self, a, b):
        self.filtros["range"] = (a, b)
        return self

    def execute(self):
        if self.op == "select":
            if self.table == "ads":
                # inventário: pais presentes
                a, b = self.filtros.get("range", (0, 999))
                return type("Res", (), {"data": self.db["ads"][a : b + 1]})()
            ids = set(self.filtros.get("entity_id", []))
            rows = [dict(r, entity_id=eid) for eid, r in self.db["parent_entities"].items() if eid in ids]
            return type("Res", (), {"data": rows})()
        # upsert: grava e registra
        self.registro.append([dict(r) for r in self.payload])
        for r in self.payload:
            self.db["parent_entities"][r["entity_id"]] = {k: v for k, v in r.items() if k != "entity_id"}
        return type("Res", (), {"data": []})()


class _FakeSB:
    def __init__(self, ads, parents):
        self.db = {"ads": ads, "parent_entities": dict(parents)}
        self.registro = []

    def table(self, nome):
        return _Query(nome, self.db, self.registro)


ADS = [{"campaign_id": "c1", "adset_id": "s1"}, {"campaign_id": "c2", "adset_id": "s2"}]


def _entities(c1_status="ACTIVE", c1_daily=1000, s1_status="ACTIVE", c2=True):
    campaigns = {"c1": {"daily_budget": c1_daily, "lifetime_budget": None, "budget_mode": "cbo", "effective_status": c1_status, "account_id": "act_1"}}
    if c2:
        campaigns["c2"] = {"daily_budget": None, "lifetime_budget": None, "budget_mode": "abo", "effective_status": "PAUSED", "account_id": "act_1"}
    adsets = {"s1": {"daily_budget": None, "lifetime_budget": None, "campaign_id": "c1", "effective_status": s1_status, "account_id": "act_1"}}
    return {"campaigns": campaigns, "adsets": adsets}


def _stored():
    return {
        "c1": {"level": "campaign", "account_id": "act_1", "campaign_id": None, "daily_budget": 1000, "lifetime_budget": None, "budget_mode": "cbo", "effective_status": "ACTIVE"},
        "c2": {"level": "campaign", "account_id": "act_1", "campaign_id": None, "daily_budget": None, "lifetime_budget": None, "budget_mode": "abo", "effective_status": "PAUSED"},
        "s1": {"level": "adset", "account_id": "act_1", "campaign_id": "c1", "daily_budget": None, "lifetime_budget": None, "budget_mode": None, "effective_status": "ACTIVE"},
    }


class TestUpsertParentEntitiesChangedOnly(unittest.TestCase):
    def _run(self, sb, entities):
        with mock.patch.object(supabase_repo, "with_postgrest_retry", side_effect=lambda _l, fn: fn()):
            return supabase_repo.upsert_parent_entities(None, "u1", entities, sb_client=sb)

    def test_nada_mudou_nao_grava_e_devolve_zero(self):
        sb = _FakeSB(ADS, _stored())
        self.assertEqual(self._run(sb, _entities()), 0)
        self.assertEqual(sb.registro, [])

    def test_status_de_um_pai_mudou_grava_so_ele(self):
        sb = _FakeSB(ADS, _stored())
        self.assertEqual(self._run(sb, _entities(s1_status="PAUSED")), 1)
        gravados = [r["entity_id"] for r in sb.registro[0]]
        self.assertEqual(gravados, ["s1"])
        self.assertEqual(sb.db["parent_entities"]["s1"]["effective_status"], "PAUSED")

    def test_orcamento_mudou_conta_como_mudanca(self):
        sb = _FakeSB(ADS, _stored())
        self.assertEqual(self._run(sb, _entities(c1_daily=2500)), 1)
        self.assertEqual([r["entity_id"] for r in sb.registro[0]], ["c1"])

    def test_pai_novo_conta_como_mudanca(self):
        stored = _stored()
        stored.pop("c2")
        sb = _FakeSB(ADS, stored)
        self.assertEqual(self._run(sb, _entities()), 1)
        self.assertEqual([r["entity_id"] for r in sb.registro[0]], ["c2"])

    def test_budget_como_string_do_meta_nao_e_falsa_mudanca(self):
        # PostgREST devolve bigint como int; o Meta manda str. 1000 == "1000".
        sb = _FakeSB(ADS, _stored())
        self.assertEqual(self._run(sb, _entities(c1_daily="1000")), 0)

    def test_escopo_continua_valendo(self):
        # Pai sem ads importados nunca entra, mudado ou não.
        ents = _entities()
        ents["campaigns"]["c99"] = dict(ents["campaigns"]["c1"])
        sb = _FakeSB(ADS, _stored())
        self.assertEqual(self._run(sb, ents), 0)

    def test_sabotagem_sem_comparacao_gravaria_todos(self):
        sb = _FakeSB(ADS, _stored())
        with mock.patch.object(supabase_repo, "_parent_row_differs", return_value=True):
            self.assertEqual(self._run(sb, _entities()), 3)
        self.assertEqual(len(sb.registro[0]), 3)


if __name__ == "__main__":
    unittest.main()

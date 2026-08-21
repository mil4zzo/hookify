# -*- coding: utf-8 -*-
"""Re-attach e cancel de job para CONVIDADO (P3.3b-resto).

Um job disparado pelo convidado num pack compartilhado vive no silo do DONO — a
listagem por silo do ator nao o enxerga e, apos um reload, o toast de progresso
sumia. O par que resolve: `payload.actor_id` (QUEM disparou) + grant no pack do
job (ainda pode ve-lo). O silo sai sempre do JOB, nunca do cliente.
"""
import unittest
from unittest import mock

from fastapi import HTTPException

from app.services.pack_access import PackAccess


class _Resp:
    def __init__(self, data):
        self.data = data


class _Q:
    """Encadeamento PostgREST que registra os filtros aplicados."""

    def __init__(self, rows_for):
        self._rows_for = rows_for
        self.filters = {}

    def select(self, *a, **k):
        return self

    def eq(self, col, val):
        self.filters[("eq", col)] = val
        return self

    def neq(self, col, val):
        self.filters[("neq", col)] = val
        return self

    def in_(self, col, vals):
        self.filters[("in", col)] = list(vals)
        return self

    def gte(self, col, val):
        return self

    def order(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    def execute(self):
        return _Resp(self._rows_for(self.filters))


class _Sb:
    def __init__(self, rows_for):
        self._rows_for = rows_for

    def table(self, name):
        return _Q(lambda f: self._rows_for(name, f))


class TestActiveJobsGuest(unittest.TestCase):
    ACTOR = "guest-9"

    def _list(self, *, own, foreign, gate=None):
        from app.routes import facebook as FB

        def svc_rows(table, filters):
            # so responde a consulta de silo ALHEIO (tem neq user_id)
            return foreign if ("neq", "user_id") in filters else []

        own_sb = _Sb(lambda t, f: own if t == "jobs" else [])
        svc_sb = _Sb(svc_rows)
        gate_mock = mock.Mock(side_effect=gate) if gate else mock.Mock(
            return_value=PackAccess(role="viewer", owner_id="owner-1")
        )

        with mock.patch.object(FB, "get_supabase_for_user", return_value=own_sb), \
             mock.patch.object(FB, "get_supabase_service", return_value=svc_sb), \
             mock.patch.object(FB, "assert_pack_role", gate_mock):
            res = FB.list_active_jobs(user={"token": "jwt", "user_id": self.ACTOR})
        return res, gate_mock

    def test_job_do_convidado_em_silo_do_dono_aparece(self):
        res, gate = self._list(
            own=[],
            foreign=[{
                "id": "job-1", "status": "processing", "progress": 40, "message": "m",
                "user_id": "owner-1",
                "payload": {"type": "pack_refresh", "pack_id": "pack-1",
                            "pack_name": "P", "actor_id": self.ACTOR},
            }],
        )
        ids = [j["job_id"] for j in res["jobs"]]
        self.assertEqual(ids, ["job-1"])
        gate.assert_called_once_with(self.ACTOR, "pack-1", roles=("dono", "editor", "viewer"))

    def test_grant_revogado_some_da_lista(self):
        res, gate = self._list(
            own=[],
            foreign=[{
                "id": "job-1", "status": "processing", "progress": 0, "message": None,
                "user_id": "owner-1",
                "payload": {"type": "pack_refresh", "pack_id": "pack-1", "actor_id": self.ACTOR},
            }],
            gate=HTTPException(status_code=404, detail="Pack nao encontrado"),
        )
        self.assertEqual(res["jobs"], [])

    def test_job_alheio_sem_pack_e_ignorado(self):
        res, gate = self._list(
            own=[],
            foreign=[{
                "id": "job-1", "status": "processing", "progress": 0, "message": None,
                "user_id": "owner-1", "payload": {"type": "x", "actor_id": self.ACTOR},
            }],
        )
        self.assertEqual(res["jobs"], [])
        gate.assert_not_called()

    def test_jobs_proprios_continuam(self):
        res, _ = self._list(
            own=[{"id": "meu", "status": "running", "progress": 1, "message": None,
                  "payload": {"type": "pack_refresh", "pack_id": "p"}}],
            foreign=[],
        )
        self.assertEqual([j["job_id"] for j in res["jobs"]], ["meu"])


class TestCancelJobsBatchSilo(unittest.TestCase):
    ACTOR = "guest-9"

    def _cancel(self, rows, *, gate_ok=True):
        from app.routes import facebook as FB

        svc = _Sb(lambda t, f: rows if t == "jobs" else [])
        gate = (mock.Mock(return_value=PackAccess(role="editor", owner_id="owner-1"))
                if gate_ok else mock.Mock(side_effect=HTTPException(status_code=403, detail="x")))
        trackers = {}

        def _mk(jwt, silo, use_service_role=False):
            tr = mock.Mock()
            tr.cancel_jobs_batch.side_effect = lambda ids, reason: len(ids)
            trackers[silo] = (tr, jwt, use_service_role)
            return tr

        with mock.patch.object(FB, "get_supabase_service", return_value=svc), \
             mock.patch.object(FB, "assert_pack_role", gate), \
             mock.patch.object(FB, "get_job_tracker", side_effect=_mk):
            res = FB.cancel_jobs_batch(
                {"job_ids": [r["id"] for r in rows], "reason": "r"},
                user={"token": "jwt", "user_id": self.ACTOR},
            )
        return res, trackers, gate

    def test_cancela_job_que_ele_disparou_em_silo_alheio(self):
        rows = [{"id": "j1", "user_id": "owner-1",
                 "payload": {"actor_id": self.ACTOR, "pack_id": "pack-1"}}]
        res, trackers, gate = self._cancel(rows)
        self.assertEqual(res["cancelled_count"], 1)
        tr, jwt, svc_role = trackers["owner-1"]
        self.assertIsNone(jwt)          # service role no silo do dono
        self.assertTrue(svc_role)
        gate.assert_not_called()        # disparou => nao precisa de papel

    def test_editor_cancela_job_de_outro_no_pack_dele(self):
        rows = [{"id": "j1", "user_id": "owner-1",
                 "payload": {"actor_id": "outro", "pack_id": "pack-1"}}]
        res, trackers, gate = self._cancel(rows)
        self.assertEqual(res["cancelled_count"], 1)
        gate.assert_called_once_with(self.ACTOR, "pack-1", roles=("dono", "editor"))

    def test_viewer_nao_cancela_job_alheio(self):
        rows = [{"id": "j1", "user_id": "owner-1",
                 "payload": {"actor_id": "outro", "pack_id": "pack-1"}}]
        res, trackers, gate = self._cancel(rows, gate_ok=False)
        self.assertEqual(res["cancelled_count"], 0)
        self.assertEqual(trackers, {})

    def test_job_proprio_usa_jwt_do_ator(self):
        rows = [{"id": "j1", "user_id": self.ACTOR, "payload": {}}]
        res, trackers, gate = self._cancel(rows)
        self.assertEqual(res["cancelled_count"], 1)
        tr, jwt, svc_role = trackers[self.ACTOR]
        self.assertEqual(jwt, "jwt")
        self.assertFalse(svc_role)


if __name__ == "__main__":
    unittest.main()

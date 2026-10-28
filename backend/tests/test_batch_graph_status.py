"""
Status em lote (pausar/ativar em massa) sobre o laço único de Batch API (`_batch_graph`).

Só o `requests.post` é simulado: o parse real da resposta da Meta roda. O caso que motivou a
unificação: um 502/504 do proxy da Meta chega com corpo HTML, e o `.json()` solto dentro do
`except HTTPError` derrubava o lote inteiro em 500 em vez de marcar o chunk como falho.
"""

import json
import time
import unittest

import requests

import app.services.graph_api as mod
from app.services.graph_api import GraphAPI, _http_error_json


class _Resp:
    def __init__(self, payload=None, status=200, text=None):
        self._payload = payload
        self.status_code = status
        self.content = (text if text is not None else json.dumps(payload)).encode()
        self.text = text if text is not None else json.dumps(payload)

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.exceptions.HTTPError(f"{self.status_code}", response=self)


def _item(code, body):
    return {"code": code, "body": json.dumps(body)}


class _PatchedPost(unittest.TestCase):
    def setUp(self):
        self.responses = []
        self.sent = []
        self._orig_post, self._orig_log = mod.requests.post, mod.log_meta_usage

        def fake_post(*_a, data=None, **_k):
            self.sent.append([b["relative_url"] for b in json.loads(data["batch"])])
            return self.responses.pop(0)

        mod.requests.post = fake_post
        mod.log_meta_usage = lambda *a, **k: None
        self.api = GraphAPI(access_token="tok", user_id="u1")

    def tearDown(self):
        mod.requests.post, mod.log_meta_usage = self._orig_post, self._orig_log


class TestHttpErrorJson(unittest.TestCase):
    def test_html_body_and_empty_body_become_empty_dict(self):
        html = requests.exceptions.HTTPError("502", response=_Resp(status=502, text="<html>Bad Gateway</html>"))
        empty = requests.exceptions.HTTPError("500", response=_Resp(status=500, text=""))
        none = requests.exceptions.HTTPError("x", response=None)
        self.assertEqual(_http_error_json(html), {})
        self.assertEqual(_http_error_json(empty), {})
        self.assertEqual(_http_error_json(none), {})

    def test_json_body_is_returned(self):
        err = requests.exceptions.HTTPError("400", response=_Resp({"error": {"code": 190}}, status=400))
        self.assertEqual(_http_error_json(err)["error"]["code"], 190)


class TestBatchGetEffectiveStatus(_PatchedPost):
    def test_reads_ok_items_and_leaves_failures_absent(self):
        self.responses = [_Resp([
            _item(200, {"effective_status": "campaign_paused"}),
            _item(400, {"error": {"code": 100, "message": "bad"}}),
            None,
        ])]
        out = self.api.batch_get_effective_status(["a", "b", "c"])
        self.assertEqual(out, {"status": "success", "statuses": {"a": "CAMPAIGN_PAUSED"}})

    def test_html_502_is_fail_open_not_a_crash(self):
        ids = [f"ad{i}" for i in range(51)]
        self.responses = [
            _Resp(status=502, text="<html>Bad Gateway</html>"),
            _Resp([_item(200, {"effective_status": "ACTIVE"})]),
        ]
        out = self.api.batch_get_effective_status(ids)
        self.assertEqual(out["status"], "success")
        self.assertEqual(out["statuses"], {"ad50": "ACTIVE"})  # 1º chunk ausente, 2º lido

    def test_auth_error_propagates(self):
        self.responses = [_Resp([_item(400, {"error": {"code": 190, "message": "expired"}})])]
        out = self.api.batch_get_effective_status(["a"])
        self.assertEqual(out["status"], "auth_error")
        self.assertNotIn("results", out)

    def test_deadline_stops_between_chunks(self):
        ids = [f"ad{i}" for i in range(60)]
        self.responses = [_Resp([_item(200, {"effective_status": "ACTIVE"})] * 50)]
        out = self.api.batch_get_effective_status(ids, deadline=time.monotonic() - 1)
        self.assertEqual(out, {"status": "success", "statuses": {}})
        self.assertEqual(self.sent, [])  # nem o 1º chunk sai com o prazo vencido


class TestBatchWriteStatus(_PatchedPost):
    def test_splits_updated_and_failed(self):
        self.responses = [_Resp([_item(200, {"success": True}), _item(400, {"error": {"code": 100}}), None])]
        out = self.api._batch_write_status(["a", "b", "c"], "PAUSED")
        self.assertEqual(out, {"status": "success", "updated_ids": ["a"], "failed_ids": ["b", "c"]})
        self.assertEqual(self.sent, [["a", "b", "c"]])

    def test_html_502_marks_chunk_failed_instead_of_raising(self):
        self.responses = [_Resp(status=502, text="<html>Bad Gateway</html>")]
        out = self.api._batch_write_status(["a", "b"], "ACTIVE")
        self.assertEqual(out, {"status": "success", "updated_ids": [], "failed_ids": ["a", "b"]})

    def test_auth_error_propagates(self):
        self.responses = [_Resp({"error": {"code": 190, "message": "expired"}}, status=400)]
        self.assertEqual(self.api._batch_write_status(["a"], "PAUSED")["status"], "auth_error")


if __name__ == "__main__":
    unittest.main()

"""fetch_ig_media_types: imagem×vídeo de mídias do Instagram via Batch API.

`GET /?ids=` na raiz foi removido na v26 (erro #100); a função pede um GET por id
dentro de um lote. Diferencial real contra a forma antiga (v24, 158 mídias): idêntico.
"""
from __future__ import annotations

from app.services import graph_api as graph_api_module
from app.services.ads_enricher import AdsEnricher


def _enricher() -> AdsEnricher:
    e = AdsEnricher.__new__(AdsEnricher)
    e.access_token = "tok"
    e.base_url = "https://graph.facebook.com/v26.0/"
    e._ensure_not_cancelled = lambda *_: True
    return e


def test_uses_batch_one_get_per_id_and_classifies(monkeypatch):
    sent = []

    def fake_batch(self, items, operation_name, **kw):
        sent.extend(items)
        bodies = {
            "1": {"ok": True, "body": {"media_type": "VIDEO"}},
            "2": {"ok": True, "body": {"media_type": "IMAGE"}},
            "3": {"ok": True, "body": {"media_type": "CAROUSEL_ALBUM", "children": {"data": [{"media_type": "VIDEO"}]}}},
            "4": {"ok": False, "body": {}, "error": {"code": 100}},
        }
        return {"status": "success", "results": {i: bodies[i] for i, _ in items}}

    monkeypatch.setattr(graph_api_module.GraphAPI, "_batch_graph", fake_batch)
    out = _enricher().fetch_ig_media_types(["1", "2", "3", "4"])

    assert out == {"1": "video", "2": "image", "3": "video"}
    assert [i for i, _ in sent] == ["1", "2", "3", "4"]
    assert all(item["relative_url"].startswith(f"{i}?fields=") and "ids=" not in item["relative_url"] for i, item in sent)


def test_never_raises(monkeypatch):
    def boom(self, items, operation_name, **kw):
        raise RuntimeError("rede caiu")

    monkeypatch.setattr(graph_api_module.GraphAPI, "_batch_graph", boom)
    assert _enricher().fetch_ig_media_types(["1"]) == {}

# -*- coding: utf-8 -*-
"""Sync de planilha em massa: N packs ligados ao mesmo arquivo leem o arquivo UMA vez.

O que este arquivo prova:
- duas importações com o mesmo `sheet_cache` e o mesmo (arquivo, aba, conexão) fazem
  uma leitura da planilha e uma conferência de nome no Drive; aba diferente lê de novo;
- o job em massa roda as integrações em série com o MESMO cache, e a falha de uma vira
  resultado "failed" daquela, sem derrubar as outras.
"""
from app.services import ad_metrics_sheet_importer as imp
from app.services import google_sheet_sync_job as job


CFG_BASE = {
    "spreadsheet_id": "arq-1",
    "spreadsheet_name": "EI.31",
    "worksheet_title": "DADOS",
    "ad_id_column": "AD",
    "date_column": "DATA",
    "leadscore_column": "LS",
    "date_format": "DD/MM/YYYY",
    "connection_id": "conn-1",
    "column_mappings": [],
}


def _patch_importer(monkeypatch, configs):
    calls = {"read": 0, "drive": 0}

    def fake_fetch(user_jwt, user_id, spreadsheet_id, worksheet_title, connection_id):
        calls["read"] += 1
        return ["AD", "DATA", "LS"], [], {"AD": 0, "DATA": 1, "LS": 2}

    def fake_name(**kwargs):
        calls["drive"] += 1
        return "EI.31"

    monkeypatch.setattr(imp, "get_supabase_for_user", lambda jwt: object())
    monkeypatch.setattr(imp, "_load_sheet_config", lambda sb, integration_id, user_id: dict(configs[integration_id]))
    monkeypatch.setattr(imp, "_fetch_and_parse_sheet", fake_fetch)
    monkeypatch.setattr(imp, "get_spreadsheet_name", fake_name)
    monkeypatch.setattr(imp, "_classify_sync_outcome", lambda *a, **k: {"sync_outcome": "empty"})
    monkeypatch.setattr(imp, "_persist_integration_status", lambda *a, **k: None)
    return calls


def test_mesmo_arquivo_e_aba_le_uma_vez(monkeypatch):
    configs = {
        "i1": {**CFG_BASE, "pack_id": "p1"},
        "i2": {**CFG_BASE, "pack_id": "p2"},
        "i3": {**CFG_BASE, "pack_id": "p3", "worksheet_title": "OUTRA"},
    }
    calls = _patch_importer(monkeypatch, configs)
    cache = {}
    for integration_id in ("i1", "i2", "i3"):
        imp.run_ad_metrics_sheet_import("jwt", "owner-1", integration_id, sheet_cache=cache)
    assert calls["read"] == 2, "i1 e i2 dividem a leitura; i3 é outra aba"
    assert calls["drive"] == 1, "o nome do arquivo é conferido uma vez"


def test_sem_cache_cada_importacao_le(monkeypatch):
    configs = {"i1": {**CFG_BASE, "pack_id": "p1"}, "i2": {**CFG_BASE, "pack_id": "p2"}}
    calls = _patch_importer(monkeypatch, configs)
    for integration_id in ("i1", "i2"):
        imp.run_ad_metrics_sheet_import("jwt", "owner-1", integration_id)
    assert calls["read"] == 2


class _FakeTracker:
    def __init__(self):
        self.heartbeats = []
        self.completed = None
        self.failed = None

    def get_job(self, job_id):
        return {"status": "processing"}

    def heartbeat(self, job_id, **kwargs):
        self.heartbeats.append(kwargs)
        return True

    def mark_completed(self, job_id, pack_id, result_count=0, details=None):
        self.completed = {"result_count": result_count, "details": details}

    def mark_failed(self, job_id, message, error_code=None, details=None):
        self.failed = message


def test_job_em_massa_em_serie_com_o_mesmo_cache_e_falha_isolada(monkeypatch):
    tracker = _FakeTracker()
    caches = []
    marked_failed = []

    def fake_import(user_jwt, user_id, integration_id, check_cancelled=None, sheet_cache=None, **kwargs):
        caches.append(id(sheet_cache))
        if integration_id == "i2":
            raise imp.AdMetricsImportError("coluna de leadscore não encontrada")
        return {"updated_rows": 10, "sync_outcome": "success"}

    monkeypatch.setattr(job, "get_job_tracker", lambda *a, **k: tracker)
    monkeypatch.setattr(job, "run_ad_metrics_sheet_import", fake_import)
    monkeypatch.setattr(job, "_mark_integration_failed", lambda jwt, uid, iid: marked_failed.append(iid))

    items = [{"integration_id": f"i{n}", "pack_id": f"p{n}"} for n in (1, 2, 3)]
    out = job.process_bulk_sync_job("jwt", "owner-1", "job-1", items)

    assert out["success"] is True
    assert len(set(caches)) == 1, "todas as importações dividem o mesmo cache"
    results = {r["pack_id"]: r for r in tracker.completed["details"]["bulk_results"]}
    assert results["p1"]["status"] == "completed"
    assert results["p2"]["status"] == "failed"
    assert "leadscore" in results["p2"]["error"]
    assert results["p3"]["status"] == "completed", "a falha do p2 não para o p3"
    assert marked_failed == ["i2"]
    assert tracker.completed["result_count"] == 20

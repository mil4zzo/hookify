"""Classificação do desfecho do sync de planilha (sucesso / aviso / vazia).

O caso que originou isto: uma planilha vinculada ao pack errado rodou por dias
devolvendo "Importação concluída com sucesso! Nenhuma atualização necessária.".
Nada quebrou, nada entrou, e ninguém foi avisado. Os testes abaixo travam as
três saídas e, principalmente, o diagnóstico de janelas disjuntas.
"""
import pytest

from app.services.ad_metrics_sheet_importer import _classify_sync_outcome, _br


class _FakePacksTable:
    """Devolve a janela do pack; conta as leituras para provar a preguiça."""

    def __init__(self, window, counter):
        self._window = window
        self._counter = counter

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        self._counter["reads"] += 1

        class _Res:
            data = [
                {
                    "date_start": self._window[0],
                    "date_stop": self._window[1],
                    "name": "Pack de teste",
                }
            ] if self._window else []

        return _Res()


class _FakeSB:
    def __init__(self, window=("2026-07-07", "2026-08-17")):
        self.counter = {"reads": 0}
        self._window = window

    def table(self, name):
        assert name == "packs"
        return _FakePacksTable(self._window, self.counter)


def _classify(sb, **kw):
    base = dict(
        total_updated=0,
        unique_pairs=6337,
        sheet_date_min="2026-08-25",
        sheet_date_max="2026-09-07",
        ids_not_found_count=60,
        ids_out_of_pack_count=6277,
    )
    base.update(kw)
    return _classify_sync_outcome(sb, "user-1", "pack-1", **base)


def test_caso_real_janelas_disjuntas():
    """Planilha 25/08–07/09 x pack 07/07–17/08: nenhum dia em comum."""
    sb = _FakeSB()
    out = _classify(sb)
    assert out["sync_outcome"] == "no_match"
    assert out["outcome_reason"] == "date_range_disjoint"
    # A mensagem precisa carregar as DUAS janelas — é ela que diz ao usuário
    # o que fazer. Uma mensagem genérica não resolveria nada.
    assert "25/08/2026" in out["outcome_message"]
    assert "07/09/2026" in out["outcome_message"]
    assert "07/07/2026" in out["outcome_message"]
    assert "17/08/2026" in out["outcome_message"]
    assert out["pack_date_start"] == "2026-07-07"


def test_datas_cruzam_mas_anuncios_sao_de_outro_pack():
    """Sobreposição de datas afasta o diagnóstico de período."""
    sb = _FakeSB()
    out = _classify(sb, sheet_date_min="2026-07-10", sheet_date_max="2026-08-10")
    assert out["sync_outcome"] == "no_match"
    assert out["outcome_reason"] == "ads_out_of_pack"


def test_sobreposicao_de_um_unico_dia_ainda_e_sobreposicao():
    """Borda: planilha começa exatamente no último dia do pack."""
    sb = _FakeSB()
    out = _classify(sb, sheet_date_min="2026-08-17", sheet_date_max="2026-09-07")
    assert out["outcome_reason"] == "ads_out_of_pack"


def test_ids_nao_encontrados_domina():
    sb = _FakeSB()
    out = _classify(sb, ids_not_found_count=6277, ids_out_of_pack_count=60)
    assert out["outcome_reason"] == "ids_not_found"
    assert "coluna de ID" in out["outcome_message"]


def test_sucesso_nao_classifica_nem_consulta_o_pack():
    """Caminho feliz não paga pela consulta de diagnóstico."""
    sb = _FakeSB()
    out = _classify(sb, total_updated=1)
    assert out["sync_outcome"] == "success"
    assert out["outcome_message"] is None
    assert sb.counter["reads"] == 0


def test_planilha_vazia_e_info_nao_alarme():
    sb = _FakeSB()
    out = _classify(sb, unique_pairs=0, ids_not_found_count=0, ids_out_of_pack_count=0)
    assert out["sync_outcome"] == "empty"
    assert out["outcome_reason"] == "empty_sheet"


def test_pack_sem_janela_legivel_ainda_avisa():
    """Se a leitura do pack falhar, o aviso continua — só perde o detalhe."""
    sb = _FakeSB(window=None)
    out = _classify(sb)
    assert out["sync_outcome"] == "no_match"
    assert out["outcome_reason"] == "ads_out_of_pack"


def test_br_formata_e_nao_quebra():
    assert _br("2026-08-25") == "25/08/2026"
    assert _br(None) == "None"


# --------------------------------------------------------------------------
# Renomeacao da planilha na origem
# --------------------------------------------------------------------------

class _FakeIntegrationsTable:
    def __init__(self, sink):
        self._sink = sink

    def update(self, payload):
        self._sink["payload"] = payload
        return self

    def eq(self, *_a, **_k):
        return self

    def execute(self):
        self._sink["writes"] = self._sink.get("writes", 0) + 1
        if self._sink.get("raise_on_write"):
            raise RuntimeError("banco fora do ar")

        class _Res:
            data = []

        return _Res()


class _FakeSBIntegrations:
    def __init__(self):
        self.sink = {}

    def table(self, name):
        assert name == "ad_sheet_integrations"
        return _FakeIntegrationsTable(self.sink)


def _cfg(name="Planilha antiga"):
    return {
        "spreadsheet_id": "sheet-1",
        "spreadsheet_name": name,
        "connection_id": "conn-1",
    }


def _run_rename(monkeypatch, current_name, cfg=None, boom=False):
    import app.services.ad_metrics_sheet_importer as mod

    def fake_get_name(**_kw):
        if boom:
            raise RuntimeError("Drive fora do ar")
        return current_name

    monkeypatch.setattr(mod, "get_spreadsheet_name", fake_get_name)
    sb = _FakeSBIntegrations()
    cfg = cfg if cfg is not None else _cfg()
    old = mod._refresh_spreadsheet_name(sb, "jwt", "user-1", "integ-1", cfg)
    return old, sb, cfg


def test_renomeada_devolve_o_nome_antigo_e_grava_o_novo(monkeypatch):
    old, sb, cfg = _run_rename(monkeypatch, "Planilha NOVA")
    assert old == "Planilha antiga"
    assert sb.sink["payload"] == {"spreadsheet_name": "Planilha NOVA"}
    # A config em memória segue para o resto do sync já com o nome certo.
    assert cfg["spreadsheet_name"] == "Planilha NOVA"


def test_mesmo_nome_nao_escreve_no_banco(monkeypatch):
    """O caso comum. Escrever aqui seria tocar o banco sem nada ter mudado."""
    old, sb, _ = _run_rename(monkeypatch, "Planilha antiga")
    assert old is None
    assert sb.sink.get("writes") is None


def test_nome_ausente_nao_apaga_o_guardado(monkeypatch):
    """404/sem acesso devolve None: o nome guardado ainda é a melhor informação."""
    old, sb, cfg = _run_rename(monkeypatch, None)
    assert old is None
    assert sb.sink.get("writes") is None
    assert cfg["spreadsheet_name"] == "Planilha antiga"


def test_falha_no_drive_nunca_derruba_o_sync(monkeypatch):
    old, sb, _ = _run_rename(monkeypatch, None, boom=True)
    assert old is None
    assert sb.sink.get("writes") is None


def test_falha_ao_gravar_ainda_reporta_a_renomeacao(monkeypatch):
    """Detectou mas não conseguiu persistir: o usuário precisa saber mesmo assim."""
    import app.services.ad_metrics_sheet_importer as mod

    monkeypatch.setattr(mod, "get_spreadsheet_name", lambda **_k: "Planilha NOVA")
    sb = _FakeSBIntegrations()
    sb.sink["raise_on_write"] = True
    cfg = _cfg()
    old = mod._refresh_spreadsheet_name(sb, "jwt", "user-1", "integ-1", cfg)
    assert old == "Planilha antiga"
    # Não mentir: a gravação falhou, então a config em memória não avança.
    assert cfg["spreadsheet_name"] == "Planilha antiga"


def test_sem_spreadsheet_id_nao_chama_o_drive(monkeypatch):
    import app.services.ad_metrics_sheet_importer as mod

    called = {"n": 0}

    def _spy(**_k):
        called["n"] += 1
        return "x"

    monkeypatch.setattr(mod, "get_spreadsheet_name", _spy)
    assert mod._refresh_spreadsheet_name(_FakeSBIntegrations(), "jwt", "u", "i", {}) is None
    assert called["n"] == 0

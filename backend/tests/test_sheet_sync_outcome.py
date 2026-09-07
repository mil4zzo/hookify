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

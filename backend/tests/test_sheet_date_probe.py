"""Prova do formato de data e janela real da coluna (sonda do wizard).

A dedução do formato é uma prova por contradição, não um palpite — e é
exatamente por isso que ela pode preencher o seletor sozinha. Estes testes
travam as quatro saídas, com atenção especial ao "não sei": um falso positivo
aqui treinaria o usuário a ignorar o aviso.
"""
from app.services.sheet_date_probe import analyze_date_column, DD_MM, MM_DD


def test_um_unico_dia_maior_que_12_ja_prova_dd_mm():
    """Basta UMA linha com o primeiro componente > 12: só dia passa de 12."""
    out = analyze_date_column(["01/02/2026", "03/04/2026", "25/08/2026"])
    assert out["format_verdict"] == DD_MM
    assert out["resolved_format"] == DD_MM


def test_um_unico_dia_maior_que_12_na_segunda_posicao_prova_mm_dd():
    out = analyze_date_column(["01/02/2026", "08/25/2026"])
    assert out["format_verdict"] == MM_DD


def test_ambiguo_quando_toda_data_cai_ate_o_dia_12():
    """O caso em que a prova não fecha — e o seletor tem de ficar neutro."""
    out = analyze_date_column(["05/03/2026", "01/02/2026", "12/11/2026"])
    assert out["format_verdict"] == "ambiguous"
    assert out["resolved_format"] is None
    # Sem formato decidido não se calcula janela: com o formato errado o min/max
    # sairia deslocado e enganaria mais do que ajudaria.
    assert out["date_min"] is None


def test_evidencia_dos_dois_lados_e_conflito_nao_maioria():
    """Coluna com 25/08 E 08/25 não é 'quase DD/MM': não é nenhum dos dois."""
    out = analyze_date_column(["25/08/2026"] * 50 + ["08/25/2026"])
    assert out["format_verdict"] == "conflicting"
    assert out["resolved_format"] is None


def test_iso_nao_e_lido_e_devolve_amostra_do_problema():
    out = analyze_date_column(["2026-08-25", "2026-09-07"])
    assert out["format_verdict"] == "unreadable"
    assert "2026-08-25" in out["unparseable_samples"]


def test_outro_separador_tambem_cai_em_ilegivel():
    """O parser do sync só aceita barra; a sonda precisa dizer o mesmo."""
    out = analyze_date_column(["25-08-2026", "26.08.2026"])
    assert out["format_verdict"] == "unreadable"


def test_coluna_vazia_e_diferente_de_coluna_ilegivel():
    assert analyze_date_column([])["format_verdict"] == "empty"
    assert analyze_date_column(["", "   "])["format_verdict"] == "empty"


def test_janela_usa_o_formato_provado_e_ignora_hora():
    out = analyze_date_column(["25/08/2026 17:06", "07/09/2026", "30/08/2026 09:15:00"])
    assert out["resolved_format"] == DD_MM
    assert out["date_min"] == "2026-08-25"
    assert out["date_max"] == "2026-09-07"
    assert out["readable_cells"] == 3


def test_celulas_ilegiveis_no_meio_nao_derrubam_a_janela():
    out = analyze_date_column(["25/08/2026", "não informado", "", "07/09/2026"])
    assert out["resolved_format"] == DD_MM
    assert out["non_empty_cells"] == 3
    assert out["readable_cells"] == 2
    assert out["date_min"] == "2026-08-25"


def test_valores_fora_de_faixa_nao_viram_evidencia():
    """'99/99/2026' não prova nada — só ruído."""
    out = analyze_date_column(["99/99/2026", "01/02/2026"])
    assert out["format_verdict"] == "ambiguous"

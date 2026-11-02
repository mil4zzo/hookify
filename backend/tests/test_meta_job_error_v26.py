"""v26: relatório assíncrono que falhou traz o erro no TOPO (error_code/error_message),
e `?fields=error_message` vira campo de verdade. O retry de GK depende da mensagem."""
from app.services.gk_retry import is_gk_error
from app.services.meta_job_client import _extract_meta_error_fields, _parse_error_envelope

GK = "(#100) Your request must pass GK plr_beta"


def test_top_level_v26_fields_are_read():
    status = {"async_status": "Job Failed", "error_code": 100, "error_subcode": 1504018, "error_message": GK}
    fields = _extract_meta_error_fields(status)
    assert (fields["code"], fields["subcode"], fields["message"]) == (100, 1504018, GK)
    assert is_gk_error(_parse_error_envelope({"id": "r1", "error_message": GK}))


def test_v24_envelope_still_wins():
    env = {"error": {"code": 3, "message": "(#3) envelope"}, "error_message": "topo"}
    assert _parse_error_envelope(env)["message"] == "(#3) envelope"

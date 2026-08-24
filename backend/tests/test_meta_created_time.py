"""Testes da data de criacao do anuncio NO META (ads.meta_created_time, migration 115).

O ponto sensivel nao e ler o campo — o inventario ja o traz — e sim NAO PERDE-LO:
o edge /ads omite ARCHIVED e DELETED, entao esses anuncios chegam pelo /insights sem
linha de inventario. Sem hidratacao (refresh) e sem o trigger (sync completo), cada
sincronizacao apagaria a data justamente dos anuncios mais antigos.
"""
from unittest.mock import patch

from app.services.ads_enricher import AdsEnricher
from app.services.dataformatter import format_ads_for_api


def _enricher() -> AdsEnricher:
    return AdsEnricher(access_token="test-token")


def _enrich_offline(enricher: AdsEnricher, raw, status_details, **kwargs):
    """Roda enrich() sem tocar a rede: os fetches que sobram no caminho viram no-op.

    O batch de status por no (ads ausentes do inventario) e importado dentro da funcao,
    entao o patch precisa ser no modulo de origem.
    """
    enricher.fetch_details = lambda *a, **kw: []
    enricher.fetch_parent_entities = lambda *a, **kw: {}
    with patch("app.services.graph_api.GraphAPI") as graph_cls:
        graph_cls.return_value.batch_get_effective_status.return_value = {"status": "error", "statuses": {}}
        return enricher.enrich("act_1", raw, status_details=status_details, **kwargs)


def test_inventario_popula_meta_created_time():
    raw = [{"ad_id": "111", "ad_name": "A"}]
    inventory = [{"id": "111", "effective_status": "ACTIVE", "created_time": "2026-08-03T14:22:11-0300"}]

    result = _enrich_offline(_enricher(), raw, inventory)

    assert result["success"] is True
    assert result["data"][0]["meta_created_time"] == "2026-08-03T14:22:11-0300"


def test_ad_fora_do_inventario_nao_ganha_data():
    """Sem linha de inventario e sem valor no banco, o campo simplesmente nao existe —
    e o upsert manda NULL, que o trigger transforma em no-op."""
    raw = [{"ad_id": "111", "ad_name": "A"}, {"ad_id": "222", "ad_name": "B"}]
    inventory = [{"id": "111", "effective_status": "ACTIVE", "created_time": "2026-08-03T14:22:11-0300"}]

    result = _enrich_offline(_enricher(), raw, inventory)

    by_id = {ad["ad_id"]: ad for ad in result["data"]}
    assert by_id["111"]["meta_created_time"] == "2026-08-03T14:22:11-0300"
    assert by_id["222"].get("meta_created_time") is None


def test_refresh_hidrata_data_ja_persistida_de_ad_arquivado():
    """ARCHIVED nao volta no /ads: a data tem que vir do que ja esta no banco."""
    raw = [{"ad_id": "999", "ad_name": "ARQUIVADO"}]
    existing = {"999": {"ad_id": "999", "effective_status": "ARCHIVED", "meta_created_time": "2026-03-10T09:00:00-0300"}}

    result = _enrich_offline(_enricher(), raw, [], is_refresh=True, existing_ads_map=existing)

    assert result["data"][0]["meta_created_time"] == "2026-03-10T09:00:00-0300"


def test_valor_fresco_do_inventario_vence_o_do_banco():
    raw = [{"ad_id": "111", "ad_name": "A"}]
    existing = {"111": {"ad_id": "111", "meta_created_time": "2020-01-01T00:00:00-0300"}}
    inventory = [{"id": "111", "effective_status": "ACTIVE", "created_time": "2026-08-03T14:22:11-0300"}]

    result = _enrich_offline(_enricher(), raw, inventory, is_refresh=True, existing_ads_map=existing)

    assert result["data"][0]["meta_created_time"] == "2026-08-03T14:22:11-0300"


def test_format_ads_for_api_repassa_o_campo():
    formatted = format_ads_for_api(
        [{"ad_id": "111", "ad_name": "A", "meta_created_time": "2026-08-03T14:22:11-0300"}],
        "act_1",
    )
    assert formatted[0]["meta_created_time"] == "2026-08-03T14:22:11-0300"


def test_format_ads_for_api_sem_o_campo_devolve_none():
    formatted = format_ads_for_api([{"ad_id": "111", "ad_name": "A"}], "act_1")
    assert formatted[0]["meta_created_time"] is None

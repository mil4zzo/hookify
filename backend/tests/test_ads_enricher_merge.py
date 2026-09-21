"""Testes do merge_details do AdsEnricher: indexação por ad_id com fallback por nome.

Contexto: a dedup por nome faz com que só um representante por nome seja fetched.
O representante deve receber o próprio creative (por id); homônimos (mesmo nome,
ad_id diferente) herdam por nome — comportamento documentado e aceito.
"""
from app.services.ads_enricher import AdsEnricher


def _enricher() -> AdsEnricher:
    return AdsEnricher(access_token="test-token")


def test_representative_gets_creative_by_id_and_homonym_inherits_by_name():
    raw = [
        {"ad_id": "111", "ad_name": "ADNV116"},
        {"ad_id": "222", "ad_name": "ADNV116"},  # homônimo não-fetched
    ]
    details = [
        {"id": "111", "name": "ADNV116", "creative": {"id": "cr1", "effective_instagram_media_id": "igm1"}},
    ]
    merged = _enricher().merge_details(raw, details)
    assert merged[0]["creative"]["effective_instagram_media_id"] == "igm1"
    assert merged[1]["creative"]["effective_instagram_media_id"] == "igm1"


def test_id_match_takes_precedence_over_name_collision():
    """Se dois details homônimos existem, o lookup por ad_id devolve o creative certo
    para cada um — o mapa por nome (last-write-wins) não contamina o representante."""
    raw = [
        {"ad_id": "111", "ad_name": "X"},
        {"ad_id": "222", "ad_name": "X"},
    ]
    details = [
        {"id": "111", "name": "X", "creative": {"id": "cr1", "video_id": "v1"}},
        {"id": "222", "name": "X", "creative": {"id": "cr2", "video_id": "v2"}},
    ]
    merged = _enricher().merge_details(raw, details)
    assert merged[0]["creative"]["id"] == "cr1"
    assert merged[1]["creative"]["id"] == "cr2"


def test_ad_without_detail_keeps_existing_creative():
    raw = [{"ad_id": "999", "ad_name": "SEM-DETAIL", "creative": {"id": "hydrated", "video_id": "v9"}}]
    details = [{"id": "111", "name": "OUTRO", "creative": {"id": "cr1"}}]
    merged = _enricher().merge_details(raw, details)
    assert merged[0]["creative"]["id"] == "hydrated"


def test_asset_feed_subset_injected_into_creative():
    """adcreatives.asset_feed_spec alimenta resolve_primary_video_id/resolve_media_type
    via subset enxuto injetado no creative (sem inflar o JSONB com o spec completo)."""
    details = [
        {
            "id": "111",
            "name": "X",
            "creative": {"id": "cr1"},
            "adcreatives": {
                "data": [
                    {
                        "asset_feed_spec": {
                            "videos": [{"video_id": "v1", "thumbnail_url": "t1", "adlabels": ["ruido"]}],
                            "images": [{"hash": "h1", "url": "u1"}],
                        },
                        "object_story_spec": {"page_id": "p1"},
                    }
                ]
            },
        },
    ]
    raw = [{"ad_id": "111", "ad_name": "X"}]
    merged = _enricher().merge_details(raw, details)
    creative = merged[0]["creative"]
    assert creative["asset_feed_spec"]["videos"] == [{"video_id": "v1", "thumbnail_url": "t1"}]
    assert creative["asset_feed_spec"]["images"] == [{"hash": "h1", "url": "u1"}]
    assert merged[0]["primary_video_id"] == "v1"
    assert merged[0]["video_owner_page_id"] == "p1"
    assert merged[0]["adcreatives_videos_ids"] == ["v1"]


def test_asset_feed_subset_does_not_overwrite_existing_spec():
    details = [
        {
            "id": "111",
            "name": "X",
            "creative": {"id": "cr1", "asset_feed_spec": {"videos": [{"video_id": "original"}]}},
            "adcreatives": {"data": [{"asset_feed_spec": {"videos": [{"video_id": "outro"}]}}]},
        },
    ]
    raw = [{"ad_id": "111", "ad_name": "X"}]
    merged = _enricher().merge_details(raw, details)
    assert merged[0]["creative"]["asset_feed_spec"]["videos"][0]["video_id"] == "original"


def test_row_without_name_and_id_is_left_untouched():
    raw = [{"adcreatives_videos_ids": ["preexistente"]}]
    details = [{"id": "111", "name": "X", "creative": {"id": "cr1"}}]
    merged = _enricher().merge_details(raw, details)
    assert merged[0]["adcreatives_videos_ids"] == ["preexistente"]


def test_own_creative_takes_precedence_over_source_ad():
    """Bug do "shift" de mídia (2026-07-06): cópia que trocou a mídia depois da
    duplicação NÃO pode herdar o creative/adcreatives do source_ad — a identidade
    da mídia vem sempre do próprio ad."""
    details = [
        {
            "id": "216",
            "name": "ADNV216",
            "source_ad_id": "215",
            "creative": {"id": "cr216", "effective_instagram_media_id": "igm216"},
            "adcreatives": {
                "data": [
                    {
                        "asset_feed_spec": {"videos": [{"video_id": "v216", "thumbnail_url": "t216"}]},
                        "object_story_spec": {"page_id": "p216"},
                    }
                ]
            },
            "source_ad": {
                "id": "215",
                "creative": {"id": "cr215", "effective_instagram_media_id": "igm215"},
                "adcreatives": {
                    "data": [
                        {
                            "asset_feed_spec": {"videos": [{"video_id": "v215", "thumbnail_url": "t215"}]},
                            "object_story_spec": {"page_id": "p215"},
                        }
                    ]
                },
            },
        },
    ]
    raw = [{"ad_id": "216", "ad_name": "ADNV216"}]
    merged = _enricher().merge_details(raw, details)
    assert merged[0]["creative"]["id"] == "cr216"
    assert merged[0]["creative"]["effective_instagram_media_id"] == "igm216"
    assert merged[0]["primary_video_id"] == "v216"
    assert merged[0]["adcreatives_videos_ids"] == ["v216"]
    assert merged[0]["adcreatives_videos_thumbs"] == ["t216"]
    assert merged[0]["video_owner_page_id"] == "p216"


def test_source_ad_is_fallback_when_detail_has_no_own_data():
    """Sem creative E sem adcreatives próprios, o source_ad ainda cobre (legado)."""
    details = [
        {
            "id": "333",
            "name": "SO-SOURCE",
            "source_ad": {
                "id": "999",
                "creative": {"id": "cr-src", "video_id": "v-src"},
                "adcreatives": {
                    "data": [{"asset_feed_spec": {"videos": [{"video_id": "v-src", "thumbnail_url": "t-src"}]}}]
                },
            },
        },
    ]
    raw = [{"ad_id": "333", "ad_name": "SO-SOURCE"}]
    merged = _enricher().merge_details(raw, details)
    assert merged[0]["creative"]["id"] == "cr-src"
    assert merged[0]["primary_video_id"] == "v-src"


def test_video_without_video_id_does_not_contribute_thumb():
    """Entrada de asset_feed sem video_id não pode empurrar thumb — senão thumbs[0]
    deixa de corresponder ao primeiro vídeo real do ad."""
    details = [
        {
            "id": "111",
            "name": "X",
            "creative": {"id": "cr1"},
            "adcreatives": {
                "data": [
                    {
                        "asset_feed_spec": {
                            "videos": [
                                {"thumbnail_url": "t-fantasma"},  # sem video_id
                                {"video_id": "v1", "thumbnail_url": "t1"},
                            ]
                        }
                    }
                ]
            },
        },
    ]
    raw = [{"ad_id": "111", "ad_name": "X"}]
    merged = _enricher().merge_details(raw, details)
    assert merged[0]["adcreatives_videos_ids"] == ["v1"]
    assert merged[0]["adcreatives_videos_thumbs"] == ["t1"]


# ---------------------------------------------------------------------------
# Copy e headline do criativo DINAMICO (20/09)
#
# O criativo dinamico deixa `creative.body`/`title` vazios e poe N variacoes de texto
# em `asset_feed_spec.bodies[].text` / `.titles[].text`. Medido em producao: 43.607 dos
# 46.086 anuncios "sem copy" sao assim — o texto chegava na mesma resposta da Meta e o
# subset enxuto o descartava. Estes testes travam o contrario.
# ---------------------------------------------------------------------------

def _detalhe_dinamico(bodies, titles=None, descriptions=None):
    spec = {"videos": [{"video_id": "v1", "thumbnail_url": "t1"}],
            "bodies": [{"text": b} for b in bodies]}
    if titles is not None:
        spec["titles"] = [{"text": t} for t in titles]
    if descriptions is not None:
        spec["descriptions"] = [{"text": d} for d in descriptions]
    return [{"id": "111", "name": "X", "creative": {"id": "cr1"},
             "adcreatives": {"data": [{"asset_feed_spec": spec}]}}]


def test_copy_dinamica_e_guardada_como_lista():
    """As N copies e N headlines sobrevivem ao subset enxuto, na forma da Meta."""
    details = _detalhe_dinamico(
        ["Se voce ainda acredita que poupanca e investimento", "Segunda copy", "Terceira copy"],
        titles=["Semana do Investidor", "Quero minha vaga"],
        descriptions=["Vagas limitadas"],
    )
    merged = _enricher().merge_details([{"ad_id": "111", "ad_name": "X"}], details)
    spec = merged[0]["creative"]["asset_feed_spec"]
    assert [b["text"] for b in spec["bodies"]] == [
        "Se voce ainda acredita que poupanca e investimento", "Segunda copy", "Terceira copy"]
    assert [t["text"] for t in spec["titles"]] == ["Semana do Investidor", "Quero minha vaga"]
    assert [d["text"] for d in spec["descriptions"]] == ["Vagas limitadas"]
    # a midia continua onde estava — o texto entra ao lado, nao no lugar
    assert spec["videos"] == [{"video_id": "v1", "thumbnail_url": "t1"}]


def test_copy_dinamica_descarta_vazio_e_repetido():
    """Texto em branco nao vira variacao; duplicata nao conta duas vezes."""
    details = _detalhe_dinamico(["Uma copy", "   ", "Uma copy", "Outra"])
    merged = _enricher().merge_details([{"ad_id": "111", "ad_name": "X"}], details)
    assert [b["text"] for b in merged[0]["creative"]["asset_feed_spec"]["bodies"]] == ["Uma copy", "Outra"]


def test_copy_dinamica_tem_teto_por_chave():
    """Teto de 10 por chave: o JSONB de `ads` nao pode crescer sem limite."""
    details = _detalhe_dinamico([f"copy {i}" for i in range(25)])
    merged = _enricher().merge_details([{"ad_id": "111", "ad_name": "X"}], details)
    bodies = merged[0]["creative"]["asset_feed_spec"]["bodies"]
    assert len(bodies) == 10
    assert bodies[0]["text"] == "copy 0"


def test_anuncio_so_com_texto_ganha_spec():
    """Sem video e sem imagem no spec, o texto sozinho ainda precisa ser gravado —
    senao o criativo dinamico de imagem unica continua sem copy."""
    details = [{"id": "111", "name": "X", "creative": {"id": "cr1"},
                "adcreatives": {"data": [{"asset_feed_spec": {"bodies": [{"text": "So texto"}]}}]}}]
    merged = _enricher().merge_details([{"ad_id": "111", "ad_name": "X"}], details)
    assert merged[0]["creative"]["asset_feed_spec"]["bodies"] == [{"text": "So texto"}]


def test_copy_estatica_nao_e_tocada():
    """Anuncio com copy propria (`creative.body`) nao ganha lista nenhuma."""
    details = [{"id": "111", "name": "X", "creative": {"id": "cr1", "body": "Copy unica"},
                "adcreatives": {"data": [{"asset_feed_spec": {"videos": [{"video_id": "v1"}]}}]}}]
    merged = _enricher().merge_details([{"ad_id": "111", "ad_name": "X"}], details)
    assert merged[0]["creative"]["body"] == "Copy unica"
    assert "bodies" not in merged[0]["creative"]["asset_feed_spec"]


# ---------------------------------------------------------------------------
# Gatilho de recoleta: sem ele, parar de descartar so vale para anuncio NOVO
# ---------------------------------------------------------------------------

def test_gatilho_pega_dinamico_sem_texto():
    """Criativo dinamico (tem spec) sem body e sem bodies: e o caso a recoletar."""
    from app.services.ads_enricher import _sem_copy_conhecida
    assert _sem_copy_conhecida({"creative": {"asset_feed_spec": {"videos": [{"video_id": "v1"}]}}})


def test_gatilho_solta_quem_ja_tem_texto():
    """Depois da recoleta o anuncio sai do conjunto — senao entraria em todo refresh."""
    from app.services.ads_enricher import _sem_copy_conhecida
    assert not _sem_copy_conhecida(
        {"creative": {"asset_feed_spec": {"videos": [], "bodies": [{"text": "ja tenho"}]}}})


def test_gatilho_ignora_copy_estatica():
    from app.services.ads_enricher import _sem_copy_conhecida
    assert not _sem_copy_conhecida({"creative": {"body": "Copy unica"}})


def test_gatilho_ignora_criativo_sem_spec():
    """669 anuncios em producao nao tem body NEM spec: recoletar nao traria nada e eles
    entrariam em todo refresh para sempre."""
    from app.services.ads_enricher import _sem_copy_conhecida
    assert not _sem_copy_conhecida({"creative": {"id": "cr1"}})
    assert not _sem_copy_conhecida({})

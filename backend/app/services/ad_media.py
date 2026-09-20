from __future__ import annotations

from typing import Any, Dict, Iterable, Optional


MEDIA_TYPE_VIDEO = "video"
MEDIA_TYPE_IMAGE = "image"
MEDIA_TYPE_UNKNOWN = "unknown"


def _first_non_empty(values: Iterable[Any]) -> Optional[str]:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return None


def resolve_primary_video_id(ad: Dict[str, Any]) -> Optional[str]:
    creative = ad.get("creative") or {}
    adcreatives_videos_ids = ad.get("adcreatives_videos_ids") or []
    object_story_spec = creative.get("object_story_spec") or {}
    asset_feed_spec = creative.get("asset_feed_spec") or {}

    asset_feed_video_ids = []
    if isinstance(asset_feed_spec, dict):
        videos = asset_feed_spec.get("videos") or []
        if isinstance(videos, list):
            asset_feed_video_ids = [video.get("video_id") for video in videos if isinstance(video, dict)]

    candidates = [
        *(adcreatives_videos_ids if isinstance(adcreatives_videos_ids, list) else []),
        ad.get("primary_video_id"),
        ad.get("creative_video_id"),
        creative.get("video_id"),
        (object_story_spec.get("video_data") or {}).get("video_id") if isinstance(object_story_spec, dict) else None,
        (object_story_spec.get("link_data") or {}).get("video_id") if isinstance(object_story_spec, dict) else None,
        *asset_feed_video_ids,
    ]
    return _first_non_empty(candidates)


# Quanto de play, PROPORCIONALMENTE às impressões, faz um anúncio ser vídeo — e a partir
# de quanta entrega a métrica tem direito a opinar. Medido na cópia de produção de 19/09,
# no grão em que a decisão acontece (a linha de UM DIA, que é o que a ingestão enxerga),
# usando como verdade quem não depende de métrica nenhuma (`primary_video_id` = vídeo
# certo; `media_type = 'image'` só pode ter vindo de campo de imagem de verdade):
#
#            linhas-dia   menor   mediana   maior
#   vídeo      41.248     23,7%    97,2%   121,2%
#   imagem        364      0,0%     1,4%    12,1%
#
# Entre 12,1% e 23,7% não existe ninguém: o corte de 20% separa 41.248 de 41.248 vídeos
# e 0 de 364 dias de imagem.
#
# O PISO DE ENTREGA saiu da mesma medição, por faixa (a razão de um dia minúsculo não
# significa nada — 1 play em 4 impressões já dá 25%):
#
#   impressões no dia   imagens com play   maior razão   passariam no corte de 20%
#   menos de 10                3              25,0%              2  <- inseguro
#   10 a 29                   16              15,4%              0     (margem curta)
#   30 a 99                   70              10,8%              0
#   100 ou mais              364              12,1%              0
#
# Piso 30: nenhuma imagem passa de lá para cima, com folga de ~2×.
#
# E ABAIXO DO PISO? Ali a regra antiga continua valendo ("tem play, é vídeo"), de
# propósito. Medido: os únicos 7 anúncios da base classificados SÓ pela métrica são 6 com
# 1 a 8 impressões (razão de 85% a 100% — vídeos de verdade) e 1 com 96%. Trocar a regra
# antiga por "não opino" nessa faixa teria custo observável (6 anúncios deixariam de ser
# reconhecidos) e benefício hipotético: nesta base, TODA imagem com play espúrio foi
# classificada por campo de imagem, nunca pela métrica. E um anúncio com 8 impressões não
# tem número que distorça ranking nenhum. Então a proporção entra onde ela distingue, e
# onde não distingue nada muda.
MIN_IMPRESSOES_PARA_DECIDIR_POR_METRICA = 30
RAZAO_MINIMA_DE_PLAYS = 0.20


def _has_video_play_evidence(ad: Dict[str, Any]) -> bool:
    """Plays em PROPORÇÃO às impressões: o único sinal de métrica com vão limpo.

    A Meta às vezes manda plays num anúncio de imagem (na cópia de produção, 82 anúncios
    e 453 linhas-dia com curva). "Tem play, logo é vídeo" classificava esses como vídeo
    quando nenhum campo de imagem aparecia no criativo — e um play bastava.

    Abaixo do piso de entrega a função NÃO opina (devolve False): a decisão cai no degrau
    seguinte, que preserva a classificação anterior. Isso é de mão única — a métrica só
    consegue concluir "é vídeo", nunca "é imagem" —, então tornar a regra mais exigente
    só pode errar para menos: no pior caso o anúncio fica `unknown` até ter entrega de
    verdade, nunca vira imagem por engano.

    NÃO usamos a curva de retenção (video_play_curve_actions): ela aparece em 82 de 82
    imagens com play — é inútil como sinal de formato."""
    try:
        plays = float(ad.get("video_total_plays") or 0)
        impressions = float(ad.get("impressions") or 0)
    except (TypeError, ValueError):
        return False
    if plays <= 0:
        return False
    if impressions < MIN_IMPRESSOES_PARA_DECIDIR_POR_METRICA:
        # Sem entrega que permita distinguir: fica como era antes (qualquer play indica
        # vídeo). Nessa faixa a imagem com play espúrio é indistinguível do vídeo real —
        # e nenhum dos dois tem número que valha alguma coisa.
        return True
    return plays >= RAZAO_MINIMA_DE_PLAYS * impressions


def resolve_structural_media_type(ad: Dict[str, Any], primary_video_id: Optional[str] = None) -> Optional[str]:
    """Tipo derivável APENAS de sinais estruturais (o asset está presente no payload):
    video_id (clássico ou asset_feed) ou campos de imagem (image_hash/url, photo_data,
    asset_feed images). Retorna None quando a estrutura não determina o tipo — caso dos
    ads SHARE single-asset, cuja mídia só existe como effective_instagram_media_id.

    Serve tanto à classificação (resolve_media_type) quanto ao gate do enricher, que só
    dispara o lookup do igm para ads cujo tipo estrutural é None (evita chamadas redundantes
    para clássicos e SHARE multi-asset, que já vêm categorizados)."""
    if primary_video_id or resolve_primary_video_id(ad):
        return MEDIA_TYPE_VIDEO

    creative = ad.get("creative") or {}
    object_story_spec = creative.get("object_story_spec") or {}
    asset_feed_spec = creative.get("asset_feed_spec") or {}

    # thumbnail_url e thumb_storage_path existem em todos os ads (inclusive vídeo) —
    # não são indicadores confiáveis de imagem
    image_candidates = [
        creative.get("image_url"),
        creative.get("image_hash"),
    ]

    if isinstance(object_story_spec, dict):
        photo_data = object_story_spec.get("photo_data") or {}
        link_data = object_story_spec.get("link_data") or {}
        if isinstance(photo_data, dict):
            image_candidates.extend([photo_data.get("image_hash"), photo_data.get("url")])
        if isinstance(link_data, dict):
            image_candidates.extend([link_data.get("image_hash"), link_data.get("picture")])

    if isinstance(asset_feed_spec, dict):
        images = asset_feed_spec.get("images") or []
        if isinstance(images, list):
            for image in images:
                if isinstance(image, dict):
                    image_candidates.extend([image.get("hash"), image.get("url")])

    if _first_non_empty(image_candidates):
        return MEDIA_TYPE_IMAGE

    return None


def resolve_media_type(ad: Dict[str, Any], primary_video_id: Optional[str] = None) -> str:
    # ig_media_type is set from effective_instagram_media_id lookup (authoritative; only "video"/"image" accepted)
    ig_media_type = str(ad.get("ig_media_type") or "").strip().lower()
    if ig_media_type in (MEDIA_TYPE_VIDEO, MEDIA_TYPE_IMAGE):
        return ig_media_type

    # Sinais estruturais (asset presente) têm precedência sobre evidência de métrica —
    # uma imagem pode registrar plays/curva espúrios em casos raros
    structural = resolve_structural_media_type(ad, primary_video_id)
    if structural:
        return structural

    if _has_video_play_evidence(ad):
        return MEDIA_TYPE_VIDEO

    # Sem evidência nova: preservar classificação definitiva anterior (vinda do DB via
    # enricher) em vez de regredir para unknown — dias sem delivery não apagam o tipo
    preserved = str(ad.get("media_type") or "").strip().lower()
    if preserved in (MEDIA_TYPE_VIDEO, MEDIA_TYPE_IMAGE):
        return preserved

    return MEDIA_TYPE_UNKNOWN

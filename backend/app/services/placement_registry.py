"""
Registro de posicionamentos da Meta Ads API (v24.0).

Serve como camada de enriquecimento: nome legível, dimensões e relações de
compatibilidade (quais posicionamentos podem compartilhar a mesma mídia).

Posicionamentos desconhecidos não bloqueiam o fluxo — são tratados como
slots genéricos pelo chamador.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class PlacementInfo:
    display_name: str
    aspect_ratio: str
    min_width: int
    min_height: int
    recommended_width: int
    recommended_height: int
    # Ordenado por prioridade: o primeiro é a fonte preferencial de auto-fill
    compatible_with: list[tuple[str, str]] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Registry: (publisher_platform, position) → PlacementInfo
# ---------------------------------------------------------------------------
REGISTRY: dict[tuple[str, str], PlacementInfo] = {
    # ── Facebook Feed-like ──────────────────────────────────────────────────
    ("facebook", "feed"): PlacementInfo(
        display_name="Facebook Feed",
        aspect_ratio="1:1 / 1.91:1 / 4:5",
        min_width=600,
        min_height=315,
        recommended_width=1080,
        recommended_height=1080,
        compatible_with=[
            ("instagram", "stream"),
            ("facebook", "right_hand_column"),
            ("facebook", "marketplace"),
            ("facebook", "search"),
            ("facebook", "profile_feed"),
            ("facebook", "video_feeds"),
            ("facebook", "notification"),
            ("instagram", "explore"),
            ("instagram", "explore_home"),
            ("instagram", "profile_feed"),
            ("instagram", "ig_search"),
            ("audience_network", "classic"),
        ],
    ),
    ("facebook", "right_hand_column"): PlacementInfo(
        display_name="Facebook Coluna Direita",
        aspect_ratio="1.91:1",
        min_width=600,
        min_height=314,
        recommended_width=1200,
        recommended_height=628,
        compatible_with=[
            ("facebook", "feed"),
            ("instagram", "stream"),
        ],
    ),
    ("facebook", "marketplace"): PlacementInfo(
        display_name="Facebook Marketplace",
        aspect_ratio="1:1",
        min_width=600,
        min_height=600,
        recommended_width=1080,
        recommended_height=1080,
        compatible_with=[
            ("facebook", "feed"),
            ("instagram", "stream"),
        ],
    ),
    ("facebook", "video_feeds"): PlacementInfo(
        display_name="Facebook Video Feeds",
        aspect_ratio="1:1 / 4:5",
        min_width=600,
        min_height=600,
        recommended_width=1080,
        recommended_height=1080,
        compatible_with=[
            ("facebook", "feed"),
            ("instagram", "stream"),
        ],
    ),
    ("facebook", "search"): PlacementInfo(
        display_name="Facebook Search",
        aspect_ratio="1:1 / 1.91:1",
        min_width=600,
        min_height=315,
        recommended_width=1080,
        recommended_height=1080,
        compatible_with=[
            ("facebook", "feed"),
            ("instagram", "stream"),
        ],
    ),
    ("facebook", "profile_feed"): PlacementInfo(
        display_name="Facebook Profile Feed",
        aspect_ratio="1:1",
        min_width=600,
        min_height=600,
        recommended_width=1080,
        recommended_height=1080,
        compatible_with=[
            ("facebook", "feed"),
        ],
    ),
    ("facebook", "notification"): PlacementInfo(
        display_name="Facebook Notification",
        aspect_ratio="1:1",
        min_width=600,
        min_height=600,
        recommended_width=1080,
        recommended_height=1080,
        compatible_with=[
            ("facebook", "feed"),
        ],
    ),
    # ── Facebook Stories / Reels ────────────────────────────────────────────
    ("facebook", "story"): PlacementInfo(
        display_name="Facebook Stories",
        aspect_ratio="9:16",
        min_width=500,
        min_height=889,
        recommended_width=1080,
        recommended_height=1920,
        compatible_with=[
            ("instagram", "story"),
            ("facebook", "facebook_reels"),
            ("instagram", "reels"),
            ("facebook", "facebook_reels_overlay"),
            ("instagram", "profile_reels"),
            ("messenger", "story"),
        ],
    ),
    ("facebook", "facebook_reels"): PlacementInfo(
        display_name="Facebook Reels",
        aspect_ratio="9:16",
        min_width=500,
        min_height=889,
        recommended_width=1080,
        recommended_height=1920,
        compatible_with=[
            ("instagram", "reels"),
            ("facebook", "story"),
            ("instagram", "story"),
            ("facebook", "facebook_reels_overlay"),
            ("instagram", "profile_reels"),
            ("messenger", "story"),
        ],
    ),
    ("facebook", "facebook_reels_overlay"): PlacementInfo(
        display_name="Facebook Reels Overlay",
        aspect_ratio="9:16",
        min_width=500,
        min_height=889,
        recommended_width=1080,
        recommended_height=1920,
        compatible_with=[
            ("facebook", "facebook_reels"),
            ("instagram", "reels"),
            ("facebook", "story"),
            ("instagram", "story"),
            ("instagram", "profile_reels"),
        ],
    ),
    # ── Facebook In-stream (standalone) ────────────────────────────────────
    ("facebook", "instream_video"): PlacementInfo(
        display_name="Facebook In-stream Video",
        aspect_ratio="16:9",
        min_width=1280,
        min_height=720,
        recommended_width=1920,
        recommended_height=1080,
        compatible_with=[],
    ),
    # ── Instagram Feed-like ─────────────────────────────────────────────────
    ("instagram", "stream"): PlacementInfo(
        display_name="Instagram Feed",
        aspect_ratio="1:1 / 1.91:1 / 4:5",
        min_width=600,
        min_height=315,
        recommended_width=1080,
        recommended_height=1080,
        compatible_with=[
            ("facebook", "feed"),
            ("facebook", "right_hand_column"),
            ("facebook", "marketplace"),
            ("facebook", "search"),
            ("instagram", "explore"),
            ("instagram", "explore_home"),
            ("instagram", "profile_feed"),
            ("instagram", "ig_search"),
            ("audience_network", "classic"),
        ],
    ),
    ("instagram", "explore"): PlacementInfo(
        display_name="Instagram Explore",
        aspect_ratio="1:1 / 4:5",
        min_width=600,
        min_height=600,
        recommended_width=1080,
        recommended_height=1080,
        compatible_with=[
            ("instagram", "stream"),
            ("facebook", "feed"),
        ],
    ),
    ("instagram", "explore_home"): PlacementInfo(
        display_name="Instagram Explore Home",
        aspect_ratio="1:1",
        min_width=600,
        min_height=600,
        recommended_width=1080,
        recommended_height=1080,
        compatible_with=[
            ("instagram", "stream"),
            ("facebook", "feed"),
        ],
    ),
    ("instagram", "profile_feed"): PlacementInfo(
        display_name="Instagram Profile Feed",
        aspect_ratio="1:1",
        min_width=600,
        min_height=600,
        recommended_width=1080,
        recommended_height=1080,
        compatible_with=[
            ("instagram", "stream"),
            ("facebook", "feed"),
        ],
    ),
    ("instagram", "ig_search"): PlacementInfo(
        display_name="Instagram Search",
        aspect_ratio="1:1",
        min_width=600,
        min_height=600,
        recommended_width=1080,
        recommended_height=1080,
        compatible_with=[
            ("instagram", "stream"),
            ("facebook", "feed"),
        ],
    ),
    # ── Instagram Stories / Reels ───────────────────────────────────────────
    ("instagram", "story"): PlacementInfo(
        display_name="Instagram Stories",
        aspect_ratio="9:16",
        min_width=500,
        min_height=889,
        recommended_width=1080,
        recommended_height=1920,
        compatible_with=[
            ("facebook", "story"),
            ("facebook", "facebook_reels"),
            ("instagram", "reels"),
            ("facebook", "facebook_reels_overlay"),
            ("instagram", "profile_reels"),
            ("messenger", "story"),
        ],
    ),
    ("instagram", "reels"): PlacementInfo(
        display_name="Instagram Reels",
        aspect_ratio="9:16",
        min_width=500,
        min_height=889,
        recommended_width=1080,
        recommended_height=1920,
        compatible_with=[
            ("facebook", "facebook_reels"),
            ("instagram", "story"),
            ("facebook", "story"),
            ("instagram", "profile_reels"),
            ("facebook", "facebook_reels_overlay"),
            ("messenger", "story"),
        ],
    ),
    ("instagram", "profile_reels"): PlacementInfo(
        display_name="Instagram Profile Reels",
        aspect_ratio="9:16",
        min_width=500,
        min_height=889,
        recommended_width=1080,
        recommended_height=1920,
        compatible_with=[
            ("instagram", "reels"),
            ("facebook", "facebook_reels"),
            ("instagram", "story"),
            ("facebook", "story"),
        ],
    ),
    # ── Messenger ───────────────────────────────────────────────────────────
    ("messenger", "story"): PlacementInfo(
        display_name="Messenger Stories",
        aspect_ratio="9:16",
        min_width=500,
        min_height=889,
        recommended_width=1080,
        recommended_height=1920,
        compatible_with=[
            ("instagram", "story"),
            ("facebook", "story"),
            ("instagram", "reels"),
            ("facebook", "facebook_reels"),
        ],
    ),
    ("messenger", "sponsored_messages"): PlacementInfo(
        display_name="Messenger Sponsored Messages",
        aspect_ratio="1.91:1",
        min_width=600,
        min_height=314,
        recommended_width=1200,
        recommended_height=628,
        compatible_with=[],
    ),
    # ── Audience Network ────────────────────────────────────────────────────
    ("audience_network", "classic"): PlacementInfo(
        display_name="Audience Network",
        aspect_ratio="1:1 / 1.91:1",
        min_width=600,
        min_height=315,
        recommended_width=1080,
        recommended_height=1080,
        compatible_with=[
            ("facebook", "feed"),
            ("instagram", "stream"),
        ],
    ),
    ("audience_network", "rewarded_video"): PlacementInfo(
        display_name="Audience Network Rewarded Video",
        aspect_ratio="16:9",
        min_width=1280,
        min_height=720,
        recommended_width=1920,
        recommended_height=1080,
        compatible_with=[],
    ),
}


def lookup(publisher_platform: str, position: str) -> Optional[PlacementInfo]:
    """Retorna o PlacementInfo para um posicionamento, ou None se desconhecido."""
    return REGISTRY.get((publisher_platform, position))


def format_unknown(position: str) -> str:
    """Formata um posicionamento desconhecido para exibição legível.

    Ex: 'instagram_left_column' → 'Instagram Left Column'
    """
    return position.replace("_", " ").title()

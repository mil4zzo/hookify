"""
Serviço de transcrição speech-to-text via AssemblyAI.

Responsável por:
- Submeter áudio ao AssemblyAI
- Fazer polling até conclusão
- Retornar resultado estruturado
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import requests

from app.core.config import ASSEMBLYAI_API_KEY

logger = logging.getLogger(__name__)

ASSEMBLYAI_BASE_URL = "https://api.assemblyai.com/v2"
DEFAULT_TIMEOUT_S = 600
DEFAULT_POLL_INTERVAL_S = 5


@dataclass(frozen=True)
class TranscriptionResult:
    success: bool
    full_text: Optional[str] = None
    timestamped_words: Optional[List[Dict[str, Any]]] = field(default=None)
    language_code: Optional[str] = None
    audio_duration_seconds: Optional[float] = None
    assemblyai_id: Optional[str] = None
    error: Optional[str] = None


def _get_headers() -> Dict[str, str]:
    if not ASSEMBLYAI_API_KEY:
        raise RuntimeError("ASSEMBLYAI_API_KEY não configurada")
    return {
        "Authorization": ASSEMBLYAI_API_KEY,
        "Content-Type": "application/json",
    }


def _submit_to_assemblyai(audio_url: str) -> str:
    """POST /v2/transcript — submete áudio e retorna transcript_id.

    A API AssemblyAI exige speech_models e audio_url (OpenAPI TranscriptParams).
    Usamos universal-2 (99 idiomas, bom desempenho).
    """
    payload = {
        "audio_url": audio_url,
        "speech_models": ["universal-2"],
        "language_detection": True,
    }
    resp = requests.post(
        f"{ASSEMBLYAI_BASE_URL}/transcript",
        json=payload,
        headers=_get_headers(),
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    transcript_id = data.get("id")
    if not transcript_id:
        raise ValueError("AssemblyAI não retornou transcript id")
    logger.info(f"[TRANSCRIPTION] Submetido: id={transcript_id}")
    return transcript_id


def _poll_until_done(
    transcript_id: str,
    timeout_s: int = DEFAULT_TIMEOUT_S,
    interval_s: int = DEFAULT_POLL_INTERVAL_S,
) -> Dict[str, Any]:
    """GET /v2/transcript/{id} — polling até completed/error ou timeout."""
    url = f"{ASSEMBLYAI_BASE_URL}/transcript/{transcript_id}"
    headers = _get_headers()
    deadline = time.monotonic() + timeout_s

    while time.monotonic() < deadline:
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        status = data.get("status")

        if status == "completed":
            logger.info(f"[TRANSCRIPTION] Concluído: id={transcript_id}")
            return data
        if status == "error":
            error_msg = data.get("error", "Erro desconhecido no AssemblyAI")
            logger.warning(f"[TRANSCRIPTION] Falha: id={transcript_id} error={error_msg}")
            raise RuntimeError(error_msg)

        time.sleep(interval_s)

    raise TimeoutError(
        f"Polling expirou após {timeout_s}s para transcript {transcript_id}"
    )


def transcribe_video(
    audio_url: str,
    timeout_s: int = DEFAULT_TIMEOUT_S,
    poll_interval_s: int = DEFAULT_POLL_INTERVAL_S,
) -> TranscriptionResult:
    """Fluxo completo: submit + poll. Retorna resultado estruturado."""
    try:
        transcript_id = _submit_to_assemblyai(audio_url)
        data = _poll_until_done(transcript_id, timeout_s, poll_interval_s)

        words = data.get("words") or []
        timestamped = [
            {
                "text": w.get("text", ""),
                "start": w.get("start"),
                "end": w.get("end"),
                "confidence": w.get("confidence"),
            }
            for w in words
        ]

        duration_ms = data.get("audio_duration")
        duration_s = (duration_ms / 1000.0) if isinstance(duration_ms, (int, float)) else None

        return TranscriptionResult(
            success=True,
            full_text=data.get("text"),
            timestamped_words=timestamped if timestamped else None,
            language_code=data.get("language_code"),
            audio_duration_seconds=duration_s,
            assemblyai_id=transcript_id,
        )
    except Exception as e:
        logger.warning(f"[TRANSCRIPTION] Erro na transcrição: {e}")
        return TranscriptionResult(
            success=False,
            assemblyai_id=None,
            error=str(e),
        )

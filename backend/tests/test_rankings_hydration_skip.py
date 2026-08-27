"""
As hidratações da rota /rankings NÃO vão ao banco quando a linha já traz o dado.

MEDIDO EM 2026-08-27 (cenário real, 397 linhas): a RPC volta em 1,2 s e a rota levava
4,5-7,5 s na tela. A diferença eram três rodadas de hidratação via PostgREST — a de tipo
de mídia sozinha: 15 requisições e 13.764 linhas de `ads` (todas as cópias de cada
criativo) para carimbar "vídeo/imagem" em 397 linhas: 8,5 s fria, 2,2 s quente. A de
miniatura consultava `ads` por um caminho que 396 das 397 linhas já traziam.

A migration 132 põe `media_type`, `has_transcription` e o `thumb_storage_path` (com
fallback para qualquer cópia) na própria RPC. Estes testes travam o contrato do backend:
linha COM a chave → zero requisições; linha SEM a chave (RPC antiga) → comportamento de
antes. E a sabotagem prova que o teste distingue.
"""
import unittest
from unittest import mock

from app.routes import analytics as A


class _Q:
    def __init__(self, contador, dados):
        self._c, self._dados = contador, dados
        self.filtros = {}

    def select(self, _): return self
    def in_(self, col, vals): self.filtros[col] = list(vals); return self
    def eq(self, col, val): self.filtros[col] = val; return self
    def order(self, _): return self
    def range(self, a, b): return self

    def execute(self):
        self._c["req"] += 1
        return type("Res", (), {"data": self._dados(self.filtros)})()


class _SB:
    def __init__(self, dados):
        self.contador = {"req": 0}
        self._dados = dados

    def table(self, _nome):
        return _Q(self.contador, self._dados)


def _sb_ads(rows_ads):
    """Fake do PostgREST para `ads` (por ad_id ou ad_name) e `ad_transcriptions`."""
    def dados(filtros):
        if "ad_id" in filtros:
            return [r for r in rows_ads if r["ad_id"] in filtros["ad_id"]]
        if "ad_name" in filtros:
            return [r for r in rows_ads if r["ad_name"] in filtros["ad_name"]]
        return []
    return _SB(dados)


class TestThumbnails(unittest.TestCase):
    def test_linha_com_thumb_storage_path_nao_consulta(self):
        sb = _sb_ads([{"ad_id": "a1", "thumb_storage_path": "x/y.jpg"}])
        rows = [{"ad_id": "a1", "thumbnail": "https://cdn.meta/old.jpg", "thumb_storage_path": "x/y.jpg"}]
        with mock.patch.object(A, "build_public_storage_url", side_effect=lambda b, p: f"https://sb/storage/v1/object/public/{b}/{p}"):
            stats = A._hydrate_storage_thumbnails_for_rankings_rows(sb=sb, user_id=["u1"], rows=rows)
        self.assertEqual(sb.contador["req"], 0)
        self.assertIn("/storage/v1/object/public/", rows[0]["thumbnail"])
        self.assertEqual(stats["overridden"], 1)

    def test_linha_com_chave_nula_nao_consulta_e_mantem_thumbnail(self):
        sb = _sb_ads([{"ad_id": "a1", "thumb_storage_path": "x/y.jpg"}])  # o banco ate teria, mas a linha e a fonte
        rows = [{"ad_id": "a1", "thumbnail": "https://cdn.meta/old.jpg", "thumb_storage_path": None}]
        A._hydrate_storage_thumbnails_for_rankings_rows(sb=sb, user_id=["u1"], rows=rows)
        self.assertEqual(sb.contador["req"], 0)
        self.assertEqual(rows[0]["thumbnail"], "https://cdn.meta/old.jpg")

    def test_linha_sem_a_chave_consulta_como_antes(self):
        sb = _sb_ads([{"ad_id": "a1", "thumb_storage_path": "x/y.jpg"}])
        rows = [{"ad_id": "a1", "thumbnail": "https://cdn.meta/old.jpg"}]
        with mock.patch.object(A, "build_public_storage_url", side_effect=lambda b, p: f"https://sb/storage/v1/object/public/{b}/{p}"):
            A._hydrate_storage_thumbnails_for_rankings_rows(sb=sb, user_id=["u1"], rows=rows)
        self.assertEqual(sb.contador["req"], 1)
        self.assertIn("/storage/v1/object/public/", rows[0]["thumbnail"])


class TestMediaType(unittest.TestCase):
    def test_linhas_com_media_type_nao_consultam(self):
        sb = _sb_ads([{"ad_name": "N1", "media_type": "video"}])
        rows = [{"ad_name": "N1", "media_type": "video"}, {"ad_name": "N2", "media_type": None}]
        self.assertEqual(A._hydrate_media_type_for_rankings_rows(sb=sb, user_id=["u1"], rows=rows), 0)
        self.assertEqual(sb.contador["req"], 0)

    def test_linha_sem_a_chave_consulta_e_carimba(self):
        sb = _sb_ads([{"ad_name": "N1", "media_type": "image"}, {"ad_name": "N1", "media_type": "video"}])
        rows = [{"ad_name": "N1"}]
        with mock.patch.object(A.supabase_repo, "_fetch_all_paginated", side_effect=lambda sb_, t, c, f: sb_.table(t).execute().data if not f(sb_.table(t)) else f(sb_.table(t)).execute().data):
            n = A._hydrate_media_type_for_rankings_rows(sb=sb, user_id=["u1"], rows=rows)
        self.assertEqual(n, 1)
        self.assertEqual(rows[0]["media_type"], "video")  # video > image entre as copias
        self.assertGreaterEqual(sb.contador["req"], 1)

    def test_sabotagem_ignorar_a_chave_consultaria(self):
        sb = _sb_ads([{"ad_name": "N1", "media_type": "video"}])
        rows = [{"ad_name": "N1", "media_type": "video"}]
        with mock.patch.object(A.supabase_repo, "_fetch_all_paginated", side_effect=lambda sb_, t, c, f: f(sb_.table(t)).execute().data):
            # simula a versao antiga: hidrata todas as linhas
            A._hydrate_media_type_for_rankings_rows(sb=sb, user_id=["u1"], rows=[{k: v for k, v in r.items() if k != "media_type"} for r in rows])
        self.assertEqual(sb.contador["req"], 1)


class TestTranscription(unittest.TestCase):
    def test_linhas_com_has_transcription_nao_consultam(self):
        sb = _sb_ads([{"ad_name": "N1"}])
        rows = [{"ad_name": "N1", "has_transcription": True}, {"ad_name": "N2", "has_transcription": False}]
        self.assertEqual(A._hydrate_transcription_flags_for_rankings_rows(sb=sb, user_id=["u1"], rows=rows), 0)
        self.assertEqual(sb.contador["req"], 0)
        self.assertEqual(rows[1]["has_transcription"], False)

    def test_linha_sem_a_chave_consulta_e_marca(self):
        sb = _sb_ads([{"ad_name": "N1"}])
        rows = [{"ad_name": "N1"}, {"ad_name": "N3"}]
        n = A._hydrate_transcription_flags_for_rankings_rows(sb=sb, user_id=["u1"], rows=rows)
        self.assertEqual(n, 1)
        self.assertEqual(sb.contador["req"], 1)
        self.assertTrue(rows[0]["has_transcription"])
        self.assertNotIn("has_transcription", rows[1])


if __name__ == "__main__":
    unittest.main()

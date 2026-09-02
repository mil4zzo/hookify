# -*- coding: utf-8 -*-
"""A ROTA de export de midia, executada de ponta a ponta.

POR QUE ESTE ARQUIVO EXISTE. O refactor que dividiu o lote por silo foi validado
com testes do RESOLVEDOR (`resolve_entity_pack_groups`) e com um diferencial
contra o banco real — e ainda assim quebrou o export para todo mundo. O corpo da
funcao ficou indentado um nivel a mais, virando corpo do `if not ad_names:`; a
funcao caia direto no final e estourava `UnboundLocalError: representatives`.

Nada disso apareceu porque:
  - o codigo continua sintaticamente valido (py_compile passa);
  - o diferencial chamava `supabase_repo` direto, nunca a rota;
  - os testes cobriam a peca ao REDOR da que foi mexida.

A licao: quando o refactor MOVE corpo de funcao, o teste tem de EXECUTAR a
funcao movida. Estes testes chamam `_resolve_media_for_silo` e a rota inteira.
"""
import unittest
from unittest import mock

from app.routes import facebook as FB


def _ad_row(name, video_id="v1"):
    return {
        "ad_id": f"ad-{name}",
        "ad_name": name,
        "account_id": "act_1",
        "primary_video_id": video_id,
        "media_type": "video",
        "video_owner_page_id": "",
        "video_source_url": None,
        "video_source_expires_at": None,
        "image_source_url": None,
        "image_source_expires_at": None,
        "creative": {},
    }


class TestResolveMediaForSilo(unittest.TestCase):
    """Chama a funcao movida. Sem isto, a indentacao errada passa despercebida."""

    def test_resolve_um_silo_devolve_url_por_nome(self):
        rows = [_ad_row("ad-a"), _ad_row("ad-b", "v2")]
        with mock.patch.object(FB.supabase_repo, "get_ads_video_fields_by_names", return_value=rows), \
             mock.patch.object(FB, "resolve_video_source_cached",
                               side_effect=lambda *a, **k: {"url": f"https://cdn/{k['video_id']}.mp4"}), \
             mock.patch.object(FB, "resolve_image_sources_batch", return_value={}):
            out = FB._resolve_media_for_silo(
                api=mock.Mock(), user_jwt=None, user_id="owner-1",
                ad_names=["ad-a", "ad-b"], user={"user_id": "actor", "token": "t"},
            )

        self.assertEqual(set(out), {"ad-a", "ad-b"})
        self.assertTrue(all(v.get("url") for v in out.values()))

    def test_lista_vazia_devolve_vazio_sem_tocar_no_banco(self):
        with mock.patch.object(FB.supabase_repo, "get_ads_video_fields_by_names") as repo:
            out = FB._resolve_media_for_silo(
                api=mock.Mock(), user_jwt=None, user_id="owner-1",
                ad_names=[], user={"user_id": "actor", "token": "t"},
            )
        self.assertEqual(out, {})
        repo.assert_not_called()

    def test_nome_sem_midia_volta_com_motivo_e_nao_some(self):
        with mock.patch.object(FB.supabase_repo, "get_ads_video_fields_by_names", return_value=[]), \
             mock.patch.object(FB, "resolve_image_sources_batch", return_value={}):
            out = FB._resolve_media_for_silo(
                api=mock.Mock(), user_jwt=None, user_id="owner-1",
                ad_names=["fantasma"], user={"user_id": "actor", "token": "t"},
            )
        self.assertIn("fantasma", out)
        self.assertIsNone(out["fantasma"]["url"])
        self.assertTrue(out["fantasma"]["error"])


class TestRotaDeExport(unittest.TestCase):
    """A rota inteira — o caminho que o usuario percorre."""

    USER = {"user_id": "actor-1", "token": "jwt"}

    def _silo(self, owner, names, guest):
        return FB._MediaSilo(mock.Mock(), None if guest else "jwt", owner, tuple(names))

    def test_export_de_pack_compartilhado_resolve_no_silo_do_dono(self):
        rows = [_ad_row("ad-a"), _ad_row("ad-b", "v2")]
        with mock.patch.object(FB, "_media_batch_silos",
                               return_value=[self._silo("owner-1", ["ad-a", "ad-b"], True)]), \
             mock.patch.object(FB.supabase_repo, "get_ads_video_fields_by_names", return_value=rows), \
             mock.patch.object(FB, "resolve_video_source_cached",
                               side_effect=lambda *a, **k: {"url": f"https://cdn/{k['video_id']}.mp4"}), \
             mock.patch.object(FB, "resolve_image_sources_batch", return_value={}):
            resp = FB.get_media_source_urls_batch(
                body={"ad_names": ["ad-a", "ad-b"], "pack_ids": ["p1"]}, user=self.USER,
            )

        self.assertEqual(resp["resolved"], 2)
        self.assertEqual(resp["failed"], 0)
        self.assertTrue(resp["results"]["ad-a"]["url"])
        # `_from_cache` e detalhe interno de contagem; nao vaza na resposta.
        self.assertNotIn("_from_cache", resp["results"]["ad-a"])

    def test_lote_atravessando_dois_donos_soma_os_dois(self):
        por_silo = {
            "actor-1": [_ad_row("meu")],
            "owner-1": [_ad_row("dele", "v9")],
        }

        def _repo(_jwt, user_id, names):
            return [r for r in por_silo.get(user_id, []) if r["ad_name"] in names]

        with mock.patch.object(FB, "_media_batch_silos", return_value=[
                    self._silo("actor-1", ["meu"], False),
                    self._silo("owner-1", ["dele"], True),
                ]), \
             mock.patch.object(FB.supabase_repo, "get_ads_video_fields_by_names", side_effect=_repo), \
             mock.patch.object(FB, "resolve_video_source_cached",
                               side_effect=lambda *a, **k: {"url": "https://cdn/x.mp4"}), \
             mock.patch.object(FB, "resolve_image_sources_batch", return_value={}):
            resp = FB.get_media_source_urls_batch(
                body={"ad_names": ["meu", "dele"], "pack_ids": ["p1", "p2"]}, user=self.USER,
            )

        self.assertEqual(resp["resolved"], 2, "um dos silos nao foi consultado")

    def test_nome_que_nenhum_silo_reconhece_conta_como_falha(self):
        with mock.patch.object(FB, "_media_batch_silos", return_value=[]):
            resp = FB.get_media_source_urls_batch(
                body={"ad_names": ["orfao"], "pack_ids": ["p1"]}, user=self.USER,
            )
        self.assertEqual(resp["resolved"], 0)
        self.assertEqual(resp["failed"], 1)
        self.assertIn("orfao", resp["results"])

    def test_body_vazio_nao_explode(self):
        self.assertEqual(
            FB.get_media_source_urls_batch(body={"ad_names": []}, user=self.USER)["failed"], 0
        )


if __name__ == "__main__":
    unittest.main()

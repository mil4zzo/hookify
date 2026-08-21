# -*- coding: utf-8 -*-
"""Autorizacao de ESCRITA por entidade em pack compartilhado (P3.3b-resto).

O contexto de pack vem do CLIENTE e por isso nao autoriza nada sozinho. Estes
testes travam as duas condicoes que autorizam de fato:
  (a) papel dono|editor no pack (viewer nao propoe silo);
  (b) a entidade existir NAQUELE pack DENTRO do silo do dono.
Regressao aqui = escrever com a credencial do dono em entidade que nao e do pack.
"""
import unittest
from unittest import mock

from fastapi import HTTPException

from app.services import pack_access as PA


class _Resp:
    def __init__(self, data):
        self.data = data


class _AdsQuery:
    """Encadeamento .select().eq().in_().overlaps().execute() da tabela ads."""

    def __init__(self, rows_by_owner, column):
        self._rows_by_owner = rows_by_owner
        self._column = column
        self._owner = None
        self._ids = []
        self._packs = []

    def select(self, *a, **k):
        return self

    def eq(self, col, val):
        if col == "user_id":
            self._owner = val
        return self

    def in_(self, col, vals):
        self._ids = list(vals)
        return self

    def overlaps(self, col, vals):
        self._packs = list(vals)
        return self

    def execute(self):
        out = []
        for owner, entries in self._rows_by_owner.items():
            if owner != self._owner:
                continue
            for value, packs in entries:
                if value in self._ids and set(packs) & set(self._packs):
                    out.append({self._column: value})
        return _Resp(out)


def _sb(access_rows, rows_by_owner, column):
    sb = mock.Mock()
    sb.rpc.return_value.execute.return_value = _Resp(access_rows)
    sb.table.side_effect = lambda name: _AdsQuery(rows_by_owner, column)
    return sb


class TestResolveEntityWriteScope(unittest.TestCase):
    ACTOR = "actor-1"
    OWNER = "owner-2"

    def _call(self, access_rows, rows_by_owner, *, entity_type="ad", ids=("AD1",), packs=("pack-1",), column="ad_id"):
        with mock.patch.object(PA, "get_supabase_service", return_value=_sb(access_rows, rows_by_owner, column)):
            return PA.resolve_entity_pack_scope(self.ACTOR, entity_type, list(ids), list(packs))

    def test_sem_pack_ids_e_caminho_legado(self):
        self.assertIsNone(self._call([], {}, packs=()))

    def test_viewer_nao_propoe_silo(self):
        rows = [{"pack_id": "pack-1", "owner_id": self.OWNER, "role": "viewer"}]
        self.assertIsNone(self._call(rows, {self.OWNER: [("AD1", ["pack-1"])]}))

    def test_editor_com_entidade_no_pack_resolve_silo_do_dono(self):
        rows = [{"pack_id": "pack-1", "owner_id": self.OWNER, "role": "editor"}]
        scope = self._call(rows, {self.OWNER: [("AD1", ["pack-1"])]})
        self.assertIsNotNone(scope)
        self.assertEqual(scope.owner_id, self.OWNER)
        self.assertTrue(scope.is_guest)
        self.assertEqual(scope.allowed_ids, ("AD1",))

    def test_entidade_fora_do_pack_nao_autoriza(self):
        # Papel OK, mas o ad pertence a outro pack do dono -> None (nao escreve).
        rows = [{"pack_id": "pack-1", "owner_id": self.OWNER, "role": "editor"}]
        self.assertIsNone(self._call(rows, {self.OWNER: [("AD1", ["pack-OUTRO"])]}))

    def test_entidade_inexistente_no_silo_do_dono(self):
        rows = [{"pack_id": "pack-1", "owner_id": self.OWNER, "role": "editor"}]
        self.assertIsNone(self._call(rows, {self.OWNER: [("AD-OUTRO", ["pack-1"])]}))

    def test_silo_do_proprio_ator_vence(self):
        rows = [
            {"pack_id": "pack-1", "owner_id": self.ACTOR, "role": "dono"},
            {"pack_id": "pack-2", "owner_id": self.OWNER, "role": "editor"},
        ]
        scope = self._call(
            rows,
            {self.ACTOR: [("AD1", ["pack-1"])], self.OWNER: [("AD1", ["pack-2"])]},
            packs=("pack-1", "pack-2"),
        )
        self.assertEqual(scope.owner_id, self.ACTOR)
        self.assertFalse(scope.is_guest)

    def test_dois_donos_estrangeiros_e_409(self):
        rows = [
            {"pack_id": "pack-1", "owner_id": "own-A", "role": "editor"},
            {"pack_id": "pack-2", "owner_id": "own-B", "role": "editor"},
        ]
        with self.assertRaises(HTTPException) as ctx:
            self._call(
                rows,
                {"own-A": [("AD1", ["pack-1"])], "own-B": [("AD1", ["pack-2"])]},
                packs=("pack-1", "pack-2"),
            )
        self.assertEqual(ctx.exception.status_code, 409)

    def test_bulk_filtra_ids_fora_do_pack(self):
        rows = [{"pack_id": "pack-1", "owner_id": self.OWNER, "role": "editor"}]
        scope = self._call(
            rows,
            {self.OWNER: [("AD1", ["pack-1"]), ("AD9", ["pack-OUTRO"])]},
            ids=("AD1", "AD9"),
        )
        self.assertEqual(scope.allowed_ids, ("AD1",))

    def test_adset_usa_coluna_adset_id(self):
        rows = [{"pack_id": "pack-1", "owner_id": self.OWNER, "role": "editor"}]
        scope = self._call(
            rows, {self.OWNER: [("AS1", ["pack-1"])]},
            entity_type="adset", ids=("AS1",), column="adset_id",
        )
        self.assertEqual(scope.owner_id, self.OWNER)


class TestWriteContext(unittest.TestCase):
    """O GraphAPI e montado no handler (nao via Depends) — senao o convidado sem
    Meta conectado levaria 403 ANTES do corpo da rota."""

    def _ctx(self, scope, *, silo_token="owner-tok", actor_token="actor-tok"):
        from app.routes import facebook as FB

        with mock.patch.object(FB, "resolve_entity_pack_scope", return_value=scope), \
             mock.patch.object(FB, "get_facebook_token_for_silo", return_value=silo_token), \
             mock.patch.object(FB, "get_facebook_token_for_user", return_value=actor_token), \
             mock.patch.object(FB, "GraphAPI", lambda tok, user_id=None: mock.Mock(token=tok, uid=user_id)):
            return FB._resolve_entity_write_context(
                user={"user_id": "actor-1", "token": "jwt"},
                entity_type="ad", entity_ids=["AD1"], pack_ids=["pack-1"],
            )

    def test_convidado_usa_credencial_e_silo_do_dono(self):
        scope = PA.EntityWriteScope(
            owner_id="owner-2", is_guest=True, role="editor",
            pack_ids=("pack-1",), allowed_ids=("AD1",),
        )
        ctx = self._ctx(scope)
        self.assertTrue(ctx.is_guest)
        self.assertIsNone(ctx.user_jwt)          # service role
        self.assertEqual(ctx.user_id, "owner-2")  # silo do dono
        self.assertEqual(ctx.api.token, "owner-tok")
        self.assertEqual(ctx.allowed_ids, ["AD1"])

    def test_dono_sem_conexao_meta_e_403_do_dono(self):
        scope = PA.EntityWriteScope(
            owner_id="owner-2", is_guest=True, role="editor",
            pack_ids=("pack-1",), allowed_ids=("AD1",),
        )
        with self.assertRaises(HTTPException) as ctx:
            self._ctx(scope, silo_token=None)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.detail["error"], "owner_facebook_connection_missing")

    def test_sem_escopo_cai_no_caminho_do_ator(self):
        ctx = self._ctx(None)
        self.assertFalse(ctx.is_guest)
        self.assertEqual(ctx.user_jwt, "jwt")
        self.assertEqual(ctx.user_id, "actor-1")
        self.assertIsNone(ctx.allowed_ids)


class TestReadVsWriteRoles(unittest.TestCase):
    """A MESMA funcao serve leitura e escrita — o que separa e `roles`. Ver o
    criativo do pack e o que um viewer recebeu permissao para fazer; pausar nao."""

    ACTOR = "actor-1"
    OWNER = "owner-2"

    def _call(self, roles):
        rows = [{"pack_id": "pack-1", "owner_id": self.OWNER, "role": "viewer"}]
        sb = _sb(rows, {self.OWNER: [("AD1", ["pack-1"])]}, "ad_id")
        with mock.patch.object(PA, "get_supabase_service", return_value=sb):
            return PA.resolve_entity_pack_scope(self.ACTOR, "ad", ["AD1"], ["pack-1"], roles=roles)

    def test_viewer_le_midia(self):
        scope = self._call(("dono", "editor", "viewer"))
        self.assertIsNotNone(scope)
        self.assertEqual(scope.owner_id, self.OWNER)
        self.assertTrue(scope.is_guest)

    def test_viewer_nao_escreve(self):
        self.assertIsNone(self._call(("dono", "editor")))

    def test_midia_por_ad_name(self):
        rows = [{"pack_id": "pack-1", "owner_id": self.OWNER, "role": "viewer"}]
        sb = _sb(rows, {self.OWNER: [("Meu Anuncio", ["pack-1"])]}, "ad_name")
        with mock.patch.object(PA, "get_supabase_service", return_value=sb):
            scope = PA.resolve_entity_pack_scope(
                self.ACTOR, "adname", ["Meu Anuncio"], ["pack-1"],
                roles=("dono", "editor", "viewer"),
            )
        self.assertEqual(scope.owner_id, self.OWNER)


if __name__ == "__main__":
    unittest.main()

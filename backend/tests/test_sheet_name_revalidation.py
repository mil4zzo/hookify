# -*- coding: utf-8 -*-
"""147 — revalidacao passiva do nome da planilha vinculada.

O que precisa ser verdade, e por que cada item ja quebrou ou quebraria:

1. DEDUPE POR ARQUIVO. E o que torna a rota barata o bastante para viver num
   read-path: o mesmo arquivo do Drive serve dezenas de packs. Sem dedupe seria
   uma chamada por vinculo e a ideia inteira cairia.
2. A MARCA GUARDA O NOME ORIGINAL, nao o penultimo. A copia diz "era X
   ORIGINALMENTE" — sobrescrever a marca na segunda renomeacao faria a tela
   mentir com a maior naturalidade.
3. FALHA NUNCA SOBRESCREVE. Drive fora do ar, 404 ou token expirado devolvem
   None/excecao: o nome guardado continua sendo a melhor informacao que temos.
4. TOKEN EXPIRADO NAO PROPAGA. Isto roda em segundo plano; deixar o codigo
   GOOGLE_TOKEN_EXPIRED subir faria o app pedir "reconecte sua conta Google"
   sozinho, no meio de uma navegacao qualquer.
5. PREENCHER NOME VAZIO NAO E RENOMEACAO. Nao existe "era X" quando nunca houve X.
"""
import unittest
from unittest import mock

from app.services import sheet_name_revalidation as svc
from app.services.google_errors import GOOGLE_TOKEN_EXPIRED
from app.services.google_sheets_service import GoogleSheetsError


class _FakeResp:
    def __init__(self, data):
        self.data = data


class _FakeTable:
    """Registra os updates aplicados e devolve as linhas no select."""

    def __init__(self, rows, updates):
        self._rows = rows
        self._updates = updates
        self._pending = None

    def select(self, *_a, **_k):
        self._pending = ("select", None)
        return self

    def update(self, payload):
        self._pending = ("update", payload)
        return self

    def eq(self, col, val):
        if self._pending and self._pending[0] == "update" and col == "id":
            self._pending = ("update", self._pending[1], val)
        return self

    def execute(self):
        if self._pending and self._pending[0] == "update":
            payload = self._pending[1]
            integ_id = self._pending[2] if len(self._pending) > 2 else None
            self._updates.append((integ_id, payload))
            for row in self._rows:
                if row["id"] == integ_id:
                    row.update(payload)
            return _FakeResp([])
        return _FakeResp(self._rows)


class _FakeSb:
    def __init__(self, rows, updates):
        self._rows = rows
        self._updates = updates

    def table(self, _name):
        return _FakeTable(self._rows, self._updates)


def _integ(iid, name, sid="FILE_A", renamed_from=None, connection_id="conn-1", pack_id=None):
    return {
        "id": iid,
        "pack_id": pack_id or f"pack-{iid}",
        "spreadsheet_id": sid,
        "spreadsheet_name": name,
        "spreadsheet_renamed_from": renamed_from,
        "connection_id": connection_id,
    }


class TestRevalidateSheetNames(unittest.TestCase):
    def _run(self, rows, drive):
        """`drive` é um callable(spreadsheet_id) -> nome, ou levanta."""
        updates = []
        chamadas = []

        def _get_name(*, user_jwt, user_id, spreadsheet_id, connection_id):
            chamadas.append((connection_id, spreadsheet_id))
            return drive(spreadsheet_id)

        with mock.patch.object(svc, "get_supabase_for_user", return_value=_FakeSb(rows, updates)), \
             mock.patch.object(svc, "get_spreadsheet_name", side_effect=_get_name):
            alterados = svc.revalidate_sheet_names(user_jwt="jwt", user_id="u1")
        return alterados, updates, chamadas

    def test_dedupe_uma_chamada_por_arquivo(self):
        rows = [_integ("i1", "EI.30"), _integ("i2", "EI.30"), _integ("i3", "EI.30")]
        alterados, updates, chamadas = self._run(rows, lambda _sid: "EI.31")

        self.assertEqual(len(chamadas), 1, "3 vinculos no mesmo arquivo = 1 chamada ao Drive")
        self.assertEqual(len(updates), 3, "mas os 3 vinculos precisam ser gravados")
        self.assertEqual(len(alterados), 3)

    def test_arquivos_distintos_nao_se_confundem(self):
        rows = [_integ("i1", "EI.30", sid="A"), _integ("i2", "Outra", sid="B")]
        nomes = {"A": "EI.31", "B": "Outra"}
        alterados, updates, chamadas = self._run(rows, lambda sid: nomes[sid])

        self.assertEqual(len(chamadas), 2)
        self.assertEqual([a["integration_id"] for a in alterados], ["i1"])
        self.assertEqual(len(updates), 1, "o arquivo que nao mudou nao pode ser reescrito")

    def test_nome_igual_nao_grava_nada(self):
        rows = [_integ("i1", "EI.31")]
        alterados, updates, _ = self._run(rows, lambda _sid: "EI.31")

        self.assertEqual(alterados, [])
        self.assertEqual(updates, [], "escrita a toa move updated_at e suja o banco por nada")

    def test_marca_guarda_o_nome_original_e_nao_o_penultimo(self):
        rows = [_integ("i1", "EI.29")]

        # 1a renomeacao: EI.29 -> EI.30. A marca nasce com EI.29.
        alterados, updates, _ = self._run(rows, lambda _sid: "EI.30")
        self.assertEqual(updates[0][1]["spreadsheet_renamed_from"], "EI.29")
        self.assertEqual(alterados[0]["spreadsheet_renamed_from"], "EI.29")

        # 2a renomeacao: EI.30 -> EI.31, no MESMO estado ja marcado.
        alterados2, updates2, _ = self._run(rows, lambda _sid: "EI.31")
        self.assertEqual(updates2[0][1]["spreadsheet_name"], "EI.31")
        self.assertNotIn(
            "spreadsheet_renamed_from", updates2[0][1],
            "a marca ja existe: reescreve-la trocaria o nome ORIGINAL pelo penultimo",
        )
        self.assertEqual(alterados2[0]["spreadsheet_renamed_from"], "EI.29")

    def test_nome_vazio_preenchido_nao_e_renomeacao(self):
        rows = [_integ("i1", None)]
        alterados, updates, _ = self._run(rows, lambda _sid: "EI.31")

        self.assertEqual(updates[0][1], {"spreadsheet_name": "EI.31"})
        self.assertIsNone(alterados[0]["spreadsheet_renamed_from"])

    def test_drive_sem_resposta_nunca_sobrescreve(self):
        rows = [_integ("i1", "EI.30")]
        alterados, updates, _ = self._run(rows, lambda _sid: None)

        self.assertEqual(alterados, [])
        self.assertEqual(updates, [], "404/sem acesso nao pode apagar o nome guardado")

    def test_token_expirado_nao_propaga(self):
        rows = [_integ("i1", "EI.30")]

        def _boom(_sid):
            raise GoogleSheetsError("expirado", code=GOOGLE_TOKEN_EXPIRED)

        alterados, updates, _ = self._run(rows, _boom)
        self.assertEqual(alterados, [])
        self.assertEqual(updates, [])

    def test_falha_ao_ler_integracoes_devolve_vazio(self):
        class _Explode:
            def table(self, _name):
                raise RuntimeError("postgrest fora do ar")

        with mock.patch.object(svc, "get_supabase_for_user", return_value=_Explode()):
            self.assertEqual(svc.revalidate_sheet_names(user_jwt="jwt", user_id="u1"), [])

    def test_pack_id_ausente_sai_como_none(self):
        rows = [_integ("i1", "EI.30")]
        rows[0]["pack_id"] = None
        alterados, _, _ = self._run(rows, lambda _sid: "EI.31")
        self.assertIsNone(alterados[0]["pack_id"])


if __name__ == "__main__":
    unittest.main()

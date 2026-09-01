# -*- coding: utf-8 -*-
"""Export de midia em pack COMPARTILHADO (correcao de 2026-08-23).

O bug: `/media-source-urls/batch` nao recebia `pack_ids` e lia sempre o silo de
quem pediu. Um convidado exportando 6 packs de outro dono recebeu 110 falhas de
112 anuncios — e as 2 que funcionaram so passaram porque aqueles nomes tambem
existiam por coincidencia no silo dele. O sintoma foi "quase tudo falhou", que
esconde a causa muito melhor do que "tudo falhou" teria escondido.

A licao que estes testes travam: a funcao de escopo UNICO nao serve para lote.
Ela precisa eleger um silo e, havendo o do ator, elege o do ator — exatamente o
silo errado. Por isso existe `resolve_entity_pack_groups`, que devolve todos.
"""
import unittest
from unittest import mock

from app.services import pack_access as PA


class _Resp:
    def __init__(self, data):
        self.data = data


class _AdsQuery:
    """Encadeamento PostgREST de `ads`, respondendo pelo silo consultado.

    Reproduz o comportamento que causou o bug: `ad_name` tem FAN-OUT (varias
    linhas por nome) e o PostgREST corta em 1000 linhas por resposta, sem erro.
    `rows_per_name` controla esse fan-out.
    """

    PAGE_CAP = 1000

    def __init__(self, by_owner, rows_per_name=1):
        self.by_owner = by_owner
        self.rows_per_name = rows_per_name
        self.owner = None
        self.names = []
        self.rng = None

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        if col == "user_id":
            self.owner = val
        return self

    def in_(self, _col, values):
        self.names = list(values)
        return self

    def overlaps(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def range(self, start, end):
        self.rng = (start, end)
        return self

    def execute(self):
        owned = self.by_owner.get(self.owner, set())
        # Ordenado por nome: e o que `order(column)` garante, e o que faz a
        # primeira pagina cobrir so o comeco do alfabeto quando ha fan-out.
        todas = [
            {"ad_name": n}
            for n in sorted(n for n in self.names if n in owned)
            for _ in range(self.rows_per_name)
        ]
        if self.rng is None:
            return _Resp(todas[: self.PAGE_CAP])
        start, end = self.rng
        janela = todas[start : end + 1]
        return _Resp(janela[: self.PAGE_CAP])


def _fake_sb(access_rows, ads_by_owner, rows_per_name=1):
    sb = mock.Mock()
    sb.rpc.return_value.execute.return_value = _Resp(access_rows)
    sb.table.side_effect = lambda _t: _AdsQuery(ads_by_owner, rows_per_name)
    return sb


ACTOR = "actor-1"
OWNER = "owner-1"


class TestGruposPorSilo(unittest.TestCase):
    def test_lote_do_convidado_encontra_os_anuncios_no_silo_do_dono(self):
        """O caso real: nomes do pack compartilhado que NAO existem no silo do ator."""
        sb = _fake_sb(
            access_rows=[{"pack_id": "p1", "owner_id": OWNER, "role": "editor"}],
            ads_by_owner={OWNER: {"ad-a", "ad-b", "ad-c"}},
        )
        with mock.patch.object(PA, "get_supabase_service", return_value=sb):
            groups = PA.resolve_entity_pack_groups(
                ACTOR, "adname", ["ad-a", "ad-b", "ad-c"], ["p1"],
            )

        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0].owner_id, OWNER)
        self.assertTrue(groups[0].is_guest)
        self.assertEqual(set(groups[0].allowed_ids), {"ad-a", "ad-b", "ad-c"})

    def test_lote_misto_devolve_UM_grupo_POR_dono(self):
        """Selecionar packs de dois donos e legitimo — e a funcao de escopo unico
        levantaria 409 aqui, derrubando o export inteiro."""
        sb = _fake_sb(
            access_rows=[
                {"pack_id": "p1", "owner_id": ACTOR, "role": "dono"},
                {"pack_id": "p2", "owner_id": OWNER, "role": "viewer"},
            ],
            ads_by_owner={ACTOR: {"meu-1"}, OWNER: {"dele-1", "dele-2"}},
        )
        with mock.patch.object(PA, "get_supabase_service", return_value=sb):
            groups = PA.resolve_entity_pack_groups(
                ACTOR, "adname", ["meu-1", "dele-1", "dele-2"], ["p1", "p2"],
            )

        by_owner = {g.owner_id: g for g in groups}
        self.assertEqual(set(by_owner), {ACTOR, OWNER})
        self.assertEqual(set(by_owner[ACTOR].allowed_ids), {"meu-1"})
        self.assertEqual(set(by_owner[OWNER].allowed_ids), {"dele-1", "dele-2"})
        self.assertFalse(by_owner[ACTOR].is_guest)
        self.assertTrue(by_owner[OWNER].is_guest)

    def test_nome_nos_dois_silos_resolve_uma_vez_so_no_silo_do_ator(self):
        """Sem isso a mesma midia seria resolvida duas vezes — e o contador de
        sucesso/falha do export contaria o mesmo nome em dobro."""
        sb = _fake_sb(
            access_rows=[
                {"pack_id": "p1", "owner_id": ACTOR, "role": "dono"},
                {"pack_id": "p2", "owner_id": OWNER, "role": "editor"},
            ],
            ads_by_owner={ACTOR: {"comum"}, OWNER: {"comum", "so-dele"}},
        )
        with mock.patch.object(PA, "get_supabase_service", return_value=sb):
            groups = PA.resolve_entity_pack_groups(
                ACTOR, "adname", ["comum", "so-dele"], ["p1", "p2"],
            )

        by_owner = {g.owner_id: g for g in groups}
        self.assertEqual(set(by_owner[ACTOR].allowed_ids), {"comum"})
        self.assertEqual(set(by_owner[OWNER].allowed_ids), {"so-dele"})
        todos = [i for g in groups for i in g.allowed_ids]
        self.assertEqual(len(todos), len(set(todos)), "nome resolvido em dois silos")

    def test_papel_insuficiente_nao_propoe_silo(self):
        """`roles` restrito exclui o silo — leitura de midia aceita viewer, escrita nao."""
        sb = _fake_sb(
            access_rows=[{"pack_id": "p1", "owner_id": OWNER, "role": "viewer"}],
            ads_by_owner={OWNER: {"ad-a"}},
        )
        with mock.patch.object(PA, "get_supabase_service", return_value=sb):
            leitura = PA.resolve_entity_pack_groups(ACTOR, "adname", ["ad-a"], ["p1"])
            escrita = PA.resolve_entity_pack_groups(
                ACTOR, "adname", ["ad-a"], ["p1"], roles=("dono", "editor"),
            )

        self.assertEqual(len(leitura), 1)
        self.assertEqual(escrita, [])

    def test_sem_pack_ids_nao_inventa_silo(self):
        """Cliente antigo: sem contexto, a rota cai no caminho historico do ator."""
        with mock.patch.object(PA, "get_supabase_service") as sb:
            self.assertEqual(PA.resolve_entity_pack_groups(ACTOR, "adname", ["a"], []), [])
            self.assertEqual(PA.resolve_entity_pack_groups(ACTOR, "adname", ["a"], None), [])
            sb.assert_not_called()

    def test_nome_que_nao_existe_em_silo_nenhum_fica_de_fora(self):
        sb = _fake_sb(
            access_rows=[{"pack_id": "p1", "owner_id": OWNER, "role": "editor"}],
            ads_by_owner={OWNER: {"existe"}},
        )
        with mock.patch.object(PA, "get_supabase_service", return_value=sb):
            groups = PA.resolve_entity_pack_groups(
                ACTOR, "adname", ["existe", "fantasma"], ["p1"],
            )
        self.assertEqual(set(groups[0].allowed_ids), {"existe"})


class TestCorteSilenciosoDe1000Linhas(unittest.TestCase):
    """`.in_()` limita quantos NOMES vao na URL, nao quantas LINHAS voltam.

    Caso real que motivou: 104 nomes = 6394 linhas de `ads`. Sem paginar, o
    PostgREST devolvia as primeiras 1000 em silencio e so 42 nomes apareciam —
    o export do convidado subia de 2 para 42 de 104 e parecia "quase certo".
    """

    def test_fan_out_alto_nao_perde_nomes(self):
        nomes = [f"ad-{i:03d}" for i in range(104)]
        sb = _fake_sb(
            access_rows=[{"pack_id": "p1", "owner_id": OWNER, "role": "viewer"}],
            ads_by_owner={OWNER: set(nomes)},
            rows_per_name=61,  # 104 x 61 = 6344 linhas, muito acima do teto
        )
        with mock.patch.object(PA, "get_supabase_service", return_value=sb):
            groups = PA.resolve_entity_pack_groups(ACTOR, "adname", nomes, ["p1"])

        self.assertEqual(len(groups), 1)
        self.assertEqual(len(groups[0].allowed_ids), 104, "nomes perdidos no corte de 1000 linhas")

    def test_escopo_unico_tambem_pagina(self):
        """A funcao de escopo unico ja estava em producao com o mesmo defeito."""
        nomes = [f"ad-{i:03d}" for i in range(104)]
        sb = _fake_sb(
            access_rows=[{"pack_id": "p1", "owner_id": OWNER, "role": "editor"}],
            ads_by_owner={OWNER: set(nomes)},
            rows_per_name=61,
        )
        with mock.patch.object(PA, "get_supabase_service", return_value=sb):
            scope = PA.resolve_entity_pack_scope(ACTOR, "adname", nomes, ["p1"])

        self.assertIsNotNone(scope)
        self.assertEqual(len(scope.allowed_ids), 104)


class TestRotaNaoExigeMetaDoAtor(unittest.TestCase):
    def test_batch_nao_depende_mais_de_get_graph_api(self):
        """`Depends(get_graph_api)` levanta 403 ANTES do corpo para quem nao tem
        Meta propria — barrava justamente o convidado, que por desenho pode nao ter."""
        import inspect
        from app.routes import facebook as FB

        sig = inspect.signature(FB.get_media_source_urls_batch)
        self.assertNotIn("api", sig.parameters)


if __name__ == "__main__":
    unittest.main()

"""
Double-write do status de pai em `parent_entities` (passo 1 da migracao do read-path).

CONTEXTO
--------
Ate 2026-08-25 a `parent_entities` so recebia `effective_status` dos syncs de CONTA
INTEIRA (enrich do refresh de pack e sync on-focus). O caminho do TOGGLE — pausar ou
ativar pelo app — gravava exclusivamente nas colunas `ads.adset_status` /
`ads.campaign_status`.

Enquanto o read-path mora em `ads`, isso e invisivel. Mas impede a migracao: logo apos
um toggle a `parent_entities` estaria stale e a entidade apareceria com o status ANTIGO
ate o proximo sync completo. Estes testes travam o fechamento desse furo.

INVARIANTE DE ESCOPO (TestEscopoDoSnapshotDeContaInteira): o snapshot de conta inteira
traz milhares de pais SEM ads importados no Hookify; eles nao podem entrar em
`parent_entities`. No passo 3 as escritas de status em `ads` foram removidas e o filtro
de `upsert_parent_entities` virou o unico guardiao dessa regra.
"""

import unittest
from unittest.mock import patch

from app.services import supabase_repo


class _FakeQuery:
    """Encadeamento do PostgREST: cada filtro devolve self e registra o que foi pedido."""

    def __init__(self, table, op, payload, registro, linhas_select):
        self.table = table
        self.op = op
        self.payload = payload
        self._registro = registro
        self._linhas_select = linhas_select
        self.filtros = {}
        self._range = None

    def eq(self, coluna, valor):
        self.filtros[coluna] = valor
        return self

    def in_(self, coluna, valores):
        self.filtros[coluna] = list(valores)
        return self

    def or_(self, expr):
        self.filtros["or"] = expr
        return self

    def range(self, inicio, fim):
        self._range = (inicio, fim)
        return self

    def execute(self):
        if self.op == "select":
            inicio, fim = self._range or (0, 999)
            dados = self._linhas_select[inicio : fim + 1]
            return type("Res", (), {"data": dados})()
        self._registro.append(
            {"table": self.table, "op": self.op, "payload": self.payload, "filtros": self.filtros}
        )
        return type("Res", (), {"data": []})()


class _FakeTable:
    def __init__(self, nome, registro, linhas_select):
        self.nome = nome
        self._registro = registro
        self._linhas_select = linhas_select

    def update(self, payload):
        return _FakeQuery(self.nome, "update", payload, self._registro, self._linhas_select)

    def upsert(self, linhas, on_conflict=None):
        return _FakeQuery(self.nome, "upsert", linhas, self._registro, self._linhas_select)

    def select(self, campos):
        return _FakeQuery(self.nome, "select", campos, self._registro, self._linhas_select)


class _FakeSB:
    """Cliente Supabase falso que grava toda escrita para inspecao."""

    def __init__(self, ads_presentes=None):
        self.registro = []
        # `_fetch_present_parent_ids` pagina `ads` para descobrir o escopo real.
        self._linhas_ads = ads_presentes or []

    def table(self, nome):
        return _FakeTable(nome, self.registro, self._linhas_ads if nome == "ads" else [])

    # --- helpers de leitura do registro ---
    def upserts_parent_entities(self):
        return [r for r in self.registro if r["table"] == "parent_entities" and r["op"] == "upsert"]

    def linhas_espelhadas(self):
        linhas = []
        for r in self.upserts_parent_entities():
            linhas.extend(r["payload"])
        return linhas

    def updates_ads(self):
        return [r for r in self.registro if r["table"] == "ads" and r["op"] == "update"]


class TestWriteParentEntityStatuses(unittest.TestCase):
    """O helper dedicado em si."""

    def test_monta_linha_minima_por_nivel(self):
        sb = _FakeSB()
        supabase_repo.write_parent_entity_statuses(
            None, "u1",
            {"campaigns": {"c1": "ACTIVE"}, "adsets": {"a1": "PAUSED"}},
            sb_client=sb,
        )
        linhas = {l["entity_id"]: l for l in sb.linhas_espelhadas()}
        self.assertEqual(linhas["c1"]["level"], "campaign")
        self.assertEqual(linhas["a1"]["level"], "adset")
        self.assertEqual(linhas["c1"]["effective_status"], "ACTIVE")

        # Payload ESTREITO: tocar budget/account_id aqui apagaria o que o sync
        # de conta inteira gravou (PostgREST so atualiza colunas presentes).
        for l in linhas.values():
            self.assertEqual(
                set(l), {"user_id", "entity_id", "level", "effective_status", "updated_at"}
            )

    def test_normaliza_caixa_e_ignora_status_vazio(self):
        sb = _FakeSB()
        supabase_repo.write_parent_entity_statuses(
            None, "u1",
            {"campaigns": {"c1": "active", "c2": None, "c3": "", "  ": "ACTIVE"}},
            sb_client=sb,
        )
        linhas = sb.linhas_espelhadas()
        # Apagar verdade conhecida seria pior que nao escrever: status falsy nao vira linha.
        self.assertEqual([l["entity_id"] for l in linhas], ["c1"])
        self.assertEqual(linhas[0]["effective_status"], "ACTIVE")

    def test_ordem_deterministica_de_lock(self):
        # Anti-deadlock 40P01: toggle e sync on-focus tocam as MESMAS linhas de
        # parent_entities. Ordem total consistente torna o ciclo de espera impossivel.
        # Entrada ASSIMETRICA de proposito: a ordem de insercao nao pode ser nem a
        # ordenada nem a sua inversa, senao uma implementacao errada (ex.: `reverse()`)
        # passaria por coincidencia — foi o que aconteceu na primeira versao deste teste.
        sb = _FakeSB()
        supabase_repo.write_parent_entity_statuses(
            None, "u1",
            {
                "campaigns": {"c3": "ACTIVE", "c1": "ACTIVE", "c2": "PAUSED"},
                "adsets": {"a2": "PAUSED", "a3": "ACTIVE", "a1": "PAUSED"},
            },
            sb_client=sb,
        )
        chaves = [(l["level"], l["entity_id"]) for l in sb.linhas_espelhadas()]
        self.assertEqual(chaves, sorted(chaves))
        self.assertNotEqual(chaves, list(reversed(chaves)))

    def test_nao_escreve_quando_nada_a_gravar(self):
        sb = _FakeSB()
        supabase_repo.write_parent_entity_statuses(None, "u1", {}, sb_client=sb)
        supabase_repo.write_parent_entity_statuses(None, "u1", {"campaigns": {}}, sb_client=sb)
        self.assertEqual(sb.upserts_parent_entities(), [])

    def test_nao_pagina_a_tabela_ads(self):
        # `_fetch_present_parent_ids` custa ~71 paginas sobre 71k linhas. Pagar isso no
        # toggle reintroduziria justamente o custo que esta migracao quer eliminar.
        sb = _FakeSB(ads_presentes=[{"campaign_id": "c1", "adset_id": "a1"}])
        with patch.object(
            supabase_repo, "_fetch_present_parent_ids", side_effect=AssertionError("nao deve paginar")
        ):
            supabase_repo.write_parent_entity_statuses(
                None, "u1", {"campaigns": {"c1": "ACTIVE"}}, sb_client=sb
            )
        self.assertEqual(len(sb.linhas_espelhadas()), 1)


class TestEscopoDoSnapshotDeContaInteira(unittest.TestCase):
    """A invariante de escopo, apos a remocao de `write_parent_statuses` (passo 3).

    O snapshot de conta inteira traz TODOS os pais da conta Meta, inclusive os
    milhares sem nenhum anuncio importado no Hookify. Grava-los em
    `parent_entities` incharia a tabela com entidades que nenhuma tela le.

    Ate o passo 3 havia dois guardioes desse filtro (`write_parent_statuses` e
    `upsert_parent_entities`). O primeiro sumiu junto com as escritas em `ads`;
    este teste trava o que restou, que passou a ser o unico.
    """

    def test_upsert_de_conta_inteira_ignora_pais_sem_ads(self):
        # So c1/a1 tem linhas em `ads`; c_fora/a_fora vem do edge mas nao sao do escopo.
        sb = _FakeSB(ads_presentes=[{"campaign_id": "c1", "adset_id": "a1"}])
        supabase_repo.upsert_parent_entities(
            None, "u1",
            {
                "campaigns": {
                    "c1": {"effective_status": "ACTIVE", "daily_budget": 1000},
                    "c_fora": {"effective_status": "PAUSED", "daily_budget": 5000},
                },
                "adsets": {
                    "a1": {"effective_status": "PAUSED", "campaign_id": "c1"},
                    "a_fora": {"effective_status": "ACTIVE", "campaign_id": "c_fora"},
                },
            },
            sb_client=sb,
        )
        gravados = {l["entity_id"] for l in sb.linhas_espelhadas()}
        self.assertEqual(gravados, {"c1", "a1"})

    def test_upsert_de_conta_inteira_carrega_status_e_budget(self):
        # Este e o caminho que substituiu o `write_parent_statuses` no sync de conta:
        # um upsert so leva status E orcamento do mesmo snapshot.
        sb = _FakeSB(ads_presentes=[{"campaign_id": "c1", "adset_id": "a1"}])
        supabase_repo.upsert_parent_entities(
            None, "u1",
            {"campaigns": {"c1": {"effective_status": "ACTIVE", "daily_budget": 1000}}, "adsets": {}},
            sb_client=sb,
        )
        linha = sb.linhas_espelhadas()[0]
        self.assertEqual(linha["effective_status"], "ACTIVE")
        self.assertEqual(linha["daily_budget"], 1000)


class TestToggleEspelhaParentEntities(unittest.TestCase):
    """Os DOIS caminhos de toggle — o furo que o passo 1 fecha.

    Ate 2026-08-25 estes caminhos gravavam SO em `ads`. Se algum deles voltar a
    fazer isso, a `parent_entities` fica stale logo apos pausar/ativar e a troca
    da fonte de leitura passa a mostrar o status ANTIGO ate o proximo sync.
    """

    def _fb(self):
        from app.routes import facebook
        return facebook

    def test_toggle_de_entidade_unica_grava_status(self):
        facebook = self._fb()
        sb = _FakeSB()
        with patch.object(facebook, "_sb_for", return_value=sb):
            facebook._write_parent_status(
                user_jwt=None, user_id="u1", entity_type="campaign",
                entity_id="c1", status="PAUSED",
            )
        linhas = sb.linhas_espelhadas()
        self.assertEqual(len(linhas), 1)
        self.assertEqual(linhas[0]["entity_id"], "c1")
        self.assertEqual(linhas[0]["level"], "campaign")
        self.assertEqual(linhas[0]["effective_status"], "PAUSED")

    def test_toggle_de_entidade_unica_nao_toca_mais_em_ads(self):
        # Passo 3: UMA linha em parent_entities no lugar de ate ~60 linhas de `ads`.
        # Se isto voltar a escrever em `ads`, a amplificacao voltou junto.
        facebook = self._fb()
        sb = _FakeSB()
        with patch.object(facebook, "_sb_for", return_value=sb):
            facebook._write_parent_status(
                user_jwt=None, user_id="u1", entity_type="campaign",
                entity_id="c1", status="PAUSED",
            )
        self.assertEqual(sb.updates_ads(), [])

    def test_toggle_de_adset_usa_nivel_adset(self):
        facebook = self._fb()
        sb = _FakeSB()
        with patch.object(facebook, "_sb_for", return_value=sb):
            facebook._write_parent_status(
                user_jwt=None, user_id="u1", entity_type="adset",
                entity_id="a1", status="ACTIVE",
            )
        self.assertEqual(sb.linhas_espelhadas()[0]["level"], "adset")

    def test_toggle_em_lote_espelha_status_verificado(self):
        facebook = self._fb()
        sb = _FakeSB()
        with patch.object(facebook, "_sb_for", return_value=sb):
            facebook._batch_reconcile_parent_status_local(
                user_jwt=None, user_id="u1", entity_type="adset",
                # a2 sem leitura verificada => cai no target (fail-open, ja existente)
                verified_statuses={"a1": "PAUSED"},
                updated_ids=["a1", "a2"],
                target_status="PAUSED",
            )
        espelhado = {l["entity_id"]: l["effective_status"] for l in sb.linhas_espelhadas()}
        self.assertEqual(espelhado, {"a1": "PAUSED", "a2": "PAUSED"})

    def test_lote_espelha_antes_da_cascata_em_ads(self):
        # `resolved` ja e verdade verificada e nao depende da cascata. Espelhar antes
        # garante que uma falha no meio dos UPDATEs de `ads` deixe parent_entities
        # correta — o lado certo de errar, ja que ela passa a ser a fonte lida.
        facebook = self._fb()
        sb = _FakeSB()
        with patch.object(facebook, "_sb_for", return_value=sb):
            facebook._batch_reconcile_parent_status_local(
                user_jwt=None, user_id="u1", entity_type="campaign",
                verified_statuses={"c1": "ACTIVE"}, updated_ids=["c1"],
                target_status="ACTIVE",
            )
        tabelas = [r["table"] for r in sb.registro]
        self.assertEqual(tabelas[0], "parent_entities")
        self.assertIn("ads", tabelas)

    def test_falha_do_espelho_nao_derruba_o_toggle(self):
        facebook = self._fb()
        sb = _FakeSB()
        with patch.object(facebook, "_sb_for", return_value=sb), patch.object(
            supabase_repo, "write_parent_entity_statuses", side_effect=RuntimeError("boom")
        ):
            facebook._batch_reconcile_parent_status_local(
                user_jwt=None, user_id="u1", entity_type="adset",
                verified_statuses={"a1": "PAUSED"}, updated_ids=["a1"],
                target_status="PAUSED",
            )
        self.assertTrue(sb.updates_ads(), "a cascata em `ads` continua")


class TestClearAposToggleDeCampanha(unittest.TestCase):
    """Anulacao deliberada do status dos CONJUNTOS apos toggle de CAMPANHA.

    Pausar uma campanha nao muda o status proprio dos conjuntos no Meta — muda o
    effective_status deles. O valor que temos gravado fica sabidamente defasado, e
    manter esse valor faz a aba "por conjunto" contradizer a "por campanha".

    Ate a migration 122 bastava anular `ads.adset_status`. Como a fonte LIDA passou
    a ser `parent_entities`, anular so em `ads` virou no-op: sem o clear espelhado,
    os conjuntos exibiriam o status antigo sob a campanha recem-pausada.
    """

    def _updates_pe(self, sb):
        return [r for r in sb.registro if r["table"] == "parent_entities" and r["op"] == "update"]

    def test_helper_anula_por_campanha_e_nivel(self):
        sb = _FakeSB()
        supabase_repo.clear_parent_entity_adset_statuses(None, "u1", ["c2", "c1"], sb_client=sb)
        upd = self._updates_pe(sb)
        self.assertEqual(len(upd), 1)
        self.assertIsNone(upd[0]["payload"]["effective_status"])
        # `level='adset'` e obrigatorio: sem ele o UPDATE apagaria tambem o status
        # da PROPRIA campanha que acabou de ser gravado pelo toggle.
        self.assertEqual(upd[0]["filtros"]["level"], "adset")
        self.assertEqual(upd[0]["filtros"]["campaign_id"], ["c1", "c2"])  # ordenado

    def test_helper_ignora_lista_vazia(self):
        sb = _FakeSB()
        supabase_repo.clear_parent_entity_adset_statuses(None, "u1", [], sb_client=sb)
        supabase_repo.clear_parent_entity_adset_statuses(None, "u1", ["", "  "], sb_client=sb)
        self.assertEqual(self._updates_pe(sb), [])

    def test_toggle_em_lote_de_campanha_anula_conjuntos(self):
        from app.routes import facebook
        sb = _FakeSB()
        with patch.object(facebook, "_sb_for", return_value=sb):
            facebook._batch_reconcile_parent_status_local(
                user_jwt=None, user_id="u1", entity_type="campaign",
                verified_statuses={"c1": "PAUSED"}, updated_ids=["c1"],
                target_status="PAUSED",
            )
        anulacoes = [u for u in self._updates_pe(sb) if u["payload"].get("effective_status") is None]
        self.assertTrue(anulacoes, "toggle de campanha precisa anular o status dos conjuntos em parent_entities")
        self.assertEqual(anulacoes[0]["filtros"]["campaign_id"], ["c1"])

    def test_toggle_em_lote_de_adset_nao_anula_nada(self):
        # A anulacao e especifica de campanha: em toggle de CONJUNTO o status
        # gravado e o do proprio conjunto, e apagar seria perder verdade fresca.
        from app.routes import facebook
        sb = _FakeSB()
        with patch.object(facebook, "_sb_for", return_value=sb):
            facebook._batch_reconcile_parent_status_local(
                user_jwt=None, user_id="u1", entity_type="adset",
                verified_statuses={"a1": "PAUSED"}, updated_ids=["a1"],
                target_status="PAUSED",
            )
        anulacoes = [u for u in self._updates_pe(sb) if u["payload"].get("effective_status") is None]
        self.assertEqual(anulacoes, [])


class TestPasso3SemEscritaDeStatusDePaiEmAds(unittest.TestCase):
    """A amplificacao nao pode voltar.

    Registrar o status de 1.188 campanhas reescrevia 70.982 linhas de `ads`
    (59,7x), ~11 MB de WAL por UPDATE. Desde a migration 122 ninguem le essas
    colunas e o passo 3 parou de escreve-las. Estes testes falham se alguem
    reintroduzir a escrita por linha de ad.

    ATENCAO ao que NAO esta proibido: `ads.effective_status` (status do PROPRIO
    anuncio) continua sendo escrito e lido — inclusive na cascata de marcadores
    que alimenta o fallback do wrapper. O alvo aqui e so o status do PAI.
    """

    _COLUNAS_DE_PAI = ("campaign_status", "adset_status")

    def _paga_status_de_pai(self, sb):
        return [
            u for u in sb.updates_ads()
            if any(c in (u["payload"] or {}) for c in self._COLUNAS_DE_PAI)
        ]

    def test_toggle_em_lote_de_conjunto(self):
        from app.routes import facebook
        sb = _FakeSB()
        with patch.object(facebook, "_sb_for", return_value=sb):
            facebook._batch_reconcile_parent_status_local(
                user_jwt=None, user_id="u1", entity_type="adset",
                verified_statuses={"a1": "PAUSED"}, updated_ids=["a1"],
                target_status="PAUSED",
            )
        self.assertEqual(self._paga_status_de_pai(sb), [])
        # ...mas a cascata no status dos ADS filhos continua (fallback do wrapper).
        self.assertTrue([u for u in sb.updates_ads() if "effective_status" in (u["payload"] or {})])

    def test_toggle_em_lote_de_campanha(self):
        from app.routes import facebook
        sb = _FakeSB()
        with patch.object(facebook, "_sb_for", return_value=sb):
            facebook._batch_reconcile_parent_status_local(
                user_jwt=None, user_id="u1", entity_type="campaign",
                verified_statuses={"c1": "PAUSED"}, updated_ids=["c1"],
                target_status="PAUSED",
            )
        self.assertEqual(self._paga_status_de_pai(sb), [])

    def test_write_parent_statuses_nao_existe_mais(self):
        # Guarda explicita: recriar a funcao e recriar a amplificacao.
        self.assertFalse(
            hasattr(supabase_repo, "write_parent_statuses"),
            "write_parent_statuses foi removida no passo 3; use write_parent_entity_statuses",
        )

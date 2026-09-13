# -*- coding: utf-8 -*-
"""F7 (2026-09-13): o refresh grava em `ads` só o que mudou.

O QUE ISTO TRAVA
----------------
Antes, todo refresh regravava TODOS os anúncios do pack idênticos (8,7 GB de WAL em 18
dias numa tabela de 276 MB), regravava a vinculação ao pack de quem já estava nele, fazia
uma consulta de transcrição POR NOME e regravava os campos de miniatura de todos os
anúncios cujo nome já estava em cache (mais 3,1 GB). Cada regravação também desfaz o
index-only scan da migration 152.

Invariante: o conteúdo de `ads` depois do F7 é o mesmo que o código antigo produziria —
só deixa de gravar o que já está igual. Por isso:
- a comparação é GENÉRICA (todo campo gravado), e um teste de guarda falha se alguém
  gravar um campo que a leitura prévia não traz;
- data de criação compara instante (a Meta manda -0300, o banco devolve +00:00), e NULL
  na linha nova não é mudança (o trigger da 115 preserva o valor gravado);
- sem leitura prévia (criação de pack) tudo é gravado e vinculado, como antes.
"""
import copy
import unittest
from unittest import mock

from app.services import supabase_repo
from app.services.thumbnail_cache import CachedThumb

PACK = "11111111-1111-4111-8111-000000000007"
OUTRO_PACK = "22222222-2222-4222-8222-000000000007"


# ------------------------------------------------------------------ dublê do Supabase

class _Res:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, sb, table):
        self.sb, self.table = sb, table
        self.op, self.payload, self.filters = None, None, {}

    def select(self, fields):
        self.op, self.payload = "select", fields
        return self

    def upsert(self, rows, on_conflict=None):
        self.op, self.payload = "upsert", rows
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def eq(self, col, val):
        self.filters[col] = val
        return self

    def in_(self, col, vals):
        self.filters[col] = list(vals)
        return self

    def or_(self, expr):
        self.filters["or"] = expr
        return self

    def filter(self, col, op, criteria):
        self.filters[f"{col}.{op}"] = criteria
        return self

    def limit(self, n):
        self.filters["limit"] = n
        return self

    def execute(self):
        self.sb.calls.append((self.table, self.op, self.payload, dict(self.filters)))
        if self.op == "select" and self.table == "ad_transcriptions":
            if "ad_name.in" in self.filters:
                if self.sb.fail_transcription_batch:
                    raise RuntimeError("HTTP 400: lista mal formada")
                raw = self.filters["ad_name.in"]
                return _Res([t for t in self.sb.transcriptions
                             if supabase_repo._postgrest_in_list([t["ad_name"]])[1:-1] in raw])
            name = self.filters.get("ad_name")
            return _Res([t for t in self.sb.transcriptions if t["ad_name"] == name][:1])
        if self.op == "select" and self.table == "ads":
            if self.sb.fail_thumb_read:
                raise RuntimeError("queda de rede")
            ids = set(self.filters.get("ad_id", []))
            return _Res([dict(r, ad_id=aid) for aid, r in self.sb.thumbs.items() if aid in ids])
        return _Res([])


class _Rpc:
    def __init__(self, sb, name, params):
        self.sb, self.name, self.params = sb, name, params

    def execute(self):
        self.sb.rpcs.append((self.name, dict(self.params)))
        return _Res({"rows_updated": 0, "status": "success"})


class _FakeSB:
    def __init__(self, transcriptions=None, thumbs=None, fail_thumb_read=False, fail_transcription_batch=False):
        self.calls, self.rpcs = [], []
        self.transcriptions = transcriptions or []
        self.thumbs = thumbs or {}
        self.fail_thumb_read = fail_thumb_read
        self.fail_transcription_batch = fail_transcription_batch

    def table(self, name):
        return _Query(self, name)

    def rpc(self, name, params):
        return _Rpc(self, name, params)

    def upserted_ad_ids(self):
        return [r["ad_id"] for (t, op, rows, _f) in self.calls if t == "ads" and op == "upsert" for r in rows]

    def attached_ad_ids(self):
        return [aid for (n, p) in self.rpcs if n == "batch_add_pack_id_to_arrays" for aid in p["p_ids_to_update"]]


def _ad(ad_id, **over):
    ad = {
        "ad_id": ad_id,
        "ad_name": f"AD {ad_id}",
        "account_id": "act_1",
        "campaign_id": "c1",
        "campaign_name": "Campanha",
        "adset_id": "s1",
        "adset_name": "Conjunto",
        "effective_status": "ACTIVE",
        "creative": {"video_id": f"v{ad_id}", "thumbnail_url": f"https://t/{ad_id}", "body": {"texto": "oi"}},
        "adcreatives_videos_ids": [],
        "adcreatives_videos_thumbs": [],
        "meta_created_time": "2026-09-05T23:52:32-0300",
    }
    ad.update(over)
    return ad


def _gravado(formatted, pack_ids=(PACK,)):
    """O que `get_existing_ads_map` devolveria depois de gravar `formatted`: a mesma linha,
    com a data no formato do banco e o pack vinculado."""
    snap = {}
    for row in supabase_repo._build_ads_rows(formatted, "u1"):
        stored = {k: v for k, v in row.items() if k not in ("user_id", "updated_at")}
        stored["meta_created_time"] = "2026-09-06T02:52:32+00:00"
        stored["pack_ids"] = list(pack_ids)
        snap[row["ad_id"]] = stored
    return snap


class _Base(unittest.TestCase):
    def setUp(self):
        patches = [
            mock.patch.object(supabase_repo, "with_postgrest_retry", side_effect=lambda _l, fn: fn()),
            mock.patch.object(supabase_repo.time, "sleep", lambda *_a: None),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def _upsert(self, sb, formatted, existing, pack_id=PACK):
        supabase_repo.upsert_ads(None, formatted, "u1", pack_id, sb_client=sb, existing_ads_map=existing)


# ------------------------------------------------------------------ anúncios

class TestUpsertAdsGravaSoOQueMudou(_Base):
    def test_refresh_sem_mudanca_nao_grava_nem_vincula(self):
        formatted = [_ad("1"), _ad("2"), _ad("3")]
        sb = _FakeSB()
        self._upsert(sb, formatted, _gravado(formatted))
        self.assertEqual(sb.upserted_ad_ids(), [])
        self.assertEqual(sb.attached_ad_ids(), [])

    def test_status_mudou_grava_so_ele(self):
        formatted = [_ad("1"), _ad("2"), _ad("3")]
        existing = _gravado(formatted)
        formatted[1] = _ad("2", effective_status="PAUSED")
        sb = _FakeSB()
        self._upsert(sb, formatted, existing)
        self.assertEqual(sb.upserted_ad_ids(), ["2"])

    def test_anuncio_novo_grava_e_vincula(self):
        existing = _gravado([_ad("1")])
        sb = _FakeSB()
        self._upsert(sb, [_ad("1"), _ad("9")], existing)
        self.assertEqual(sb.upserted_ad_ids(), ["9"])
        self.assertEqual(sb.attached_ad_ids(), ["9"])

    def test_mesma_data_de_criacao_em_outro_fuso_nao_e_mudanca(self):
        # _gravado guarda +00:00; a linha nova vem da Meta em -0300. Mesmo instante.
        formatted = [_ad("1")]
        sb = _FakeSB()
        self._upsert(sb, formatted, _gravado(formatted))
        self.assertEqual(sb.upserted_ad_ids(), [])

    def test_data_de_criacao_diferente_e_mudanca(self):
        existing = _gravado([_ad("1")])
        sb = _FakeSB()
        self._upsert(sb, [_ad("1", meta_created_time="2026-09-07T10:00:00-0300")], existing)
        self.assertEqual(sb.upserted_ad_ids(), ["1"])

    def test_data_de_criacao_nula_na_linha_nova_nao_e_mudanca(self):
        # O trigger trg_ads_preserve_meta_created_time (115) manteria a data gravada.
        existing = _gravado([_ad("1")])
        sb = _FakeSB()
        self._upsert(sb, [_ad("1", meta_created_time=None)], existing)
        self.assertEqual(sb.upserted_ad_ids(), [])

    def test_criativo_mudou_por_dentro_grava(self):
        existing = _gravado([_ad("1")])
        novo = _ad("1")
        novo["creative"]["body"]["texto"] = "texto novo"
        sb = _FakeSB()
        self._upsert(sb, [novo], existing)
        self.assertEqual(sb.upserted_ad_ids(), ["1"])

    def test_null_gravado_e_texto_vazio_novo_conta_como_mudanca(self):
        # Igualdade estrita: o código antigo gravaria "" por cima de NULL.
        existing = _gravado([_ad("1")])
        existing["1"]["campaign_name"] = None
        sb = _FakeSB()
        self._upsert(sb, [_ad("1", campaign_name="")], existing)
        self.assertEqual(sb.upserted_ad_ids(), ["1"])

    def test_ja_vinculado_nao_chama_vinculo_mas_quem_nao_esta_sim(self):
        formatted = [_ad("1"), _ad("2")]
        existing = _gravado(formatted)
        existing["2"]["pack_ids"] = [OUTRO_PACK]
        sb = _FakeSB()
        self._upsert(sb, formatted, existing)
        self.assertEqual(sb.upserted_ad_ids(), [])
        self.assertEqual(sb.attached_ad_ids(), ["2"])

    def test_criacao_de_pack_sem_leitura_previa_grava_e_vincula_tudo(self):
        sb = _FakeSB()
        self._upsert(sb, [_ad("1"), _ad("2")], None)
        self.assertEqual(sb.upserted_ad_ids(), ["1", "2"])
        self.assertEqual(sb.attached_ad_ids(), ["1", "2"])

    def test_refresh_com_leitura_vazia_grava_e_vincula_tudo(self):
        sb = _FakeSB()
        self._upsert(sb, [_ad("1"), _ad("2")], {})
        self.assertEqual(sb.upserted_ad_ids(), ["1", "2"])
        self.assertEqual(sb.attached_ad_ids(), ["1", "2"])

    def test_comparacao_nao_altera_a_leitura_previa(self):
        formatted = [_ad("1")]
        existing = _gravado(formatted)
        antes = copy.deepcopy(existing)
        self._upsert(_FakeSB(), formatted, existing)
        self.assertEqual(existing, antes)

    def test_guarda_todo_campo_gravado_esta_na_leitura_previa(self):
        # Campo gravado que a leitura não traz faria a comparação achar "igual" e perder a
        # mudança para sempre. Se este teste falhar, inclua o campo em EXISTING_ADS_SELECT_FIELDS.
        lidos = set(supabase_repo.EXISTING_ADS_SELECT_FIELDS.split(","))
        gravados = set(supabase_repo._build_ads_rows([_ad("1")], "u1")[0])
        faltando = gravados - supabase_repo._ADS_ROW_UNCOMPARED_KEYS - lidos
        self.assertEqual(faltando, set())
        self.assertIn("pack_ids", lidos)

    def test_sabotagem_sem_comparacao_grava_todos(self):
        formatted = [_ad("1"), _ad("2")]
        sb = _FakeSB()
        with mock.patch.object(supabase_repo, "_ads_row_changed", return_value=True):
            self._upsert(sb, formatted, _gravado(formatted))
        self.assertEqual(sb.upserted_ad_ids(), ["1", "2"])

    def test_data_de_criacao_nova_sobre_null_gravado_e_mudanca(self):
        existing = _gravado([_ad("1")])
        existing["1"]["meta_created_time"] = None
        sb = _FakeSB()
        self._upsert(sb, [_ad("1")], existing)
        self.assertEqual(sb.upserted_ad_ids(), ["1"])

    def test_varias_linhas_diarias_do_mesmo_anuncio_comparam_a_linha_final(self):
        # O dedupe mantém a classificação definitiva quando a última linha diária vem sem
        # evidência de mídia; é essa linha final que se compara com o gravado.
        video = _ad("1")
        sem_evidencia = _ad("1", creative={}, adcreatives_videos_ids=[], adcreatives_videos_thumbs=[])
        existing = _gravado([video, sem_evidencia])
        sb = _FakeSB()
        self._upsert(sb, [video, sem_evidencia], existing)
        self.assertEqual(sb.upserted_ad_ids(), [])


class TestParseInstant(unittest.TestCase):
    def test_formatos_equivalentes(self):
        p = supabase_repo._parse_instant
        self.assertEqual(p("2026-09-05T23:52:32-0300"), p("2026-09-06T02:52:32+00:00"))
        self.assertEqual(p("2026-09-06T02:52:32Z"), p("2026-09-06T02:52:32+00:00"))
        self.assertEqual(p("2026-09-06T02:52:32.000000+00:00"), p("2026-09-06T02:52:32+00:00"))
        self.assertIsNone(p(None))
        self.assertIsNone(p("não é data"))


# ------------------------------------------------------------------ transcrições

class TestTranscricaoSoOQueFalta(_Base):
    def _sync(self, sb, pairs):
        supabase_repo._sync_ads_transcription_links(None, "u1", pairs, sb_client=sb)

    def test_consulta_por_lote_de_nomes_e_nao_por_nome(self):
        pairs = [(str(i), f"AD [{i}] | teste") for i in range(120)]
        sb = _FakeSB()
        self._sync(sb, pairs)
        consultas = [c for c in sb.calls if c[0] == "ad_transcriptions" and c[1] == "select"]
        self.assertLessEqual(len(consultas), 3)

    def test_lotes_respeitam_o_tamanho_da_url(self):
        nomes = [f"ADNV{i:03d} - [ONGOING] [EUINVESTIDOR31] [CAPTACAO] | teste / variação {i}" for i in range(300)]
        lotes = list(supabase_repo._batches_by_url_length(nomes, max_chars=4000))
        self.assertEqual(sum(len(l) for l in lotes), 300)
        self.assertGreater(len(lotes), 1)
        for lote in lotes:
            # Parênteses codificados (%28 %29) somam 6; a última vírgula contada não vai.
            self.assertLessEqual(len(supabase_repo.quote(supabase_repo._postgrest_in_list(lote), safe="")), 4000 + 6)

    def test_lista_escapada_no_builder_real_do_postgrest(self):
        from postgrest import SyncPostgrestClient

        nomes = ['VIDEO "DEPOIMENTO" (v2), final', "barra" + chr(92) + "invertida", "normal"]
        q = SyncPostgrestClient("http://localhost").from_("ad_transcriptions").select("id").filter(
            "ad_name", "in", supabase_repo._postgrest_in_list(nomes)
        )
        enviado = dict(q.params)["ad_name"]
        bs = chr(92)
        esperado = ('in.("VIDEO ' + bs + '"DEPOIMENTO' + bs + '" (v2), final",'
                    '"barra' + bs + bs + 'invertida","normal")')
        self.assertEqual(enviado, esperado)

    def test_nome_com_aspas_encontra_a_transcricao(self):
        nome = 'VIDEO "DEPOIMENTO" (v2)'
        sb = _FakeSB(transcriptions=[{"id": "t1", "ad_name": nome, "ad_ids": []}])
        self._sync(sb, [("1", nome)])
        updates = [c for c in sb.calls if c[0] == "ad_transcriptions" and c[1] == "update"]
        self.assertEqual(len(updates), 1)

    def test_lote_que_falha_cai_para_consulta_por_nome_e_segue(self):
        sb = _FakeSB(
            transcriptions=[{"id": "t1", "ad_name": "AD X", "ad_ids": []}],
            fail_transcription_batch=True,
        )
        self._sync(sb, [("1", "AD X"), ("2", "AD Y")])
        por_nome = [c for c in sb.calls if c[0] == "ad_transcriptions" and c[1] == "select" and "ad_name" in c[3]]
        self.assertEqual(len(por_nome), 2)
        updates = [c for c in sb.calls if c[0] == "ad_transcriptions" and c[1] == "update"]
        self.assertEqual(len(updates), 1)

    def test_transcricao_com_ad_ids_nulo(self):
        sb = _FakeSB(transcriptions=[{"id": "t1", "ad_name": "AD X", "ad_ids": None}])
        self._sync(sb, [("1", "AD X")])
        updates = [c for c in sb.calls if c[0] == "ad_transcriptions" and c[1] == "update"]
        self.assertEqual(updates[0][2]["ad_ids"], ["1"])

    def test_vinculo_completo_nao_regrava_a_transcricao(self):
        sb = _FakeSB(transcriptions=[{"id": "t1", "ad_name": "AD X", "ad_ids": ["1", "2"]}])
        self._sync(sb, [("1", "AD X"), ("2", "AD X")])
        self.assertEqual([c for c in sb.calls if c[0] == "ad_transcriptions" and c[1] == "update"], [])
        updates_ads = [c for c in sb.calls if c[0] == "ads" and c[1] == "update"]
        self.assertEqual(len(updates_ads), 1)
        # Só as linhas sem o vínculo certo são tocadas no banco.
        self.assertEqual(updates_ads[0][3]["or"], "transcription_id.is.null,transcription_id.neq.t1")

    def test_anuncio_novo_no_nome_entra_em_ad_ids(self):
        sb = _FakeSB(transcriptions=[{"id": "t1", "ad_name": "AD X", "ad_ids": ["1"]}])
        self._sync(sb, [("1", "AD X"), ("7", "AD X")])
        updates = [c for c in sb.calls if c[0] == "ad_transcriptions" and c[1] == "update"]
        self.assertEqual(len(updates), 1)
        self.assertEqual(updates[0][2]["ad_ids"], ["1", "7"])

    def test_nome_sem_transcricao_nao_grava_nada(self):
        sb = _FakeSB()
        self._sync(sb, [("1", "AD SEM")])
        self.assertEqual([c for c in sb.calls if c[1] == "update"], [])


# ------------------------------------------------------------------ miniaturas

class TestMiniaturaSoOQueMudou(_Base):
    def _cached(self, path="thumbs/a.jpg", at="2026-09-10T12:00:00+00:00", src="https://src/a"):
        return CachedThumb(storage_path=path, public_url="", cached_at=at, source_url=src)

    def _run(self, sb, mapping):
        with mock.patch.object(supabase_repo, "get_supabase_service", return_value=sb):
            return supabase_repo.update_ads_thumbnail_cache("u1", mapping)

    def _upserted(self, sb):
        return [r["ad_id"] for (t, op, rows, _f) in sb.calls if t == "ads" and op == "upsert" for r in rows]

    def test_miniatura_igual_nao_regrava(self):
        sb = _FakeSB(thumbs={"1": {"thumb_storage_path": "thumbs/a.jpg",
                                   "thumb_cached_at": "2026-09-10T12:00:00Z",
                                   "thumb_source_url": "https://src/a"}})
        self._run(sb, {"1": self._cached()})
        self.assertEqual(self._upserted(sb), [])

    def test_miniatura_diferente_grava_so_ela(self):
        igual = {"thumb_storage_path": "thumbs/a.jpg", "thumb_cached_at": "2026-09-10T12:00:00+00:00",
                 "thumb_source_url": "https://src/a"}
        sb = _FakeSB(thumbs={"1": dict(igual), "2": dict(igual, thumb_storage_path="thumbs/velha.jpg")})
        self._run(sb, {"1": self._cached(), "2": self._cached()})
        self.assertEqual(self._upserted(sb), ["2"])

    def test_anuncio_sem_miniatura_gravada_grava(self):
        sb = _FakeSB(thumbs={})
        self._run(sb, {"1": self._cached()})
        self.assertEqual(self._upserted(sb), ["1"])

    def test_leitura_falhou_grava_todas_como_antes(self):
        sb = _FakeSB(fail_thumb_read=True)
        self._run(sb, {"1": self._cached(), "2": self._cached()})
        self.assertEqual(self._upserted(sb), ["1", "2"])


# ------------------------------------------------------------------ ligação no job

class TestJobEntregaALeituraPrevia(unittest.TestCase):
    """`_persist_data` repassa a leitura prévia a `upsert_ads` no refresh e None na criação.

    A cópia profunda é tirada em `process()` (logo após `get_existing_ads_map`); este teste
    trava o repasse até a gravação. `process()` inteiro não é exercitado aqui.
    """

    def _processor(self):
        from app.services import job_processor

        jp = job_processor.JobProcessor.__new__(job_processor.JobProcessor)
        jp.tracker = mock.MagicMock()
        jp.tracker.heartbeat.return_value = True
        jp.tracker.get_job.return_value = {"status": "processing"}
        jp.user_jwt, jp.user_id, jp._sb = None, "u1", mock.MagicMock()
        return job_processor, jp

    def _persist(self, is_refresh, existing):
        job_processor, jp = self._processor()
        repo = mock.MagicMock()
        repo.upsert_pack.return_value = "p-novo"
        repo.get_pack.return_value = None
        with mock.patch.object(job_processor, "supabase_repo", repo),              mock.patch.object(job_processor, "spawn_pack_background_tasks", mock.MagicMock()),              mock.patch.object(jp, "_check_if_cancelled", return_value=False):
            try:
                jp._persist_data(
                    "job-1", {"name": "Pack X"}, [{"ad_id": "1", "ad_name": "AD 1"}],
                    is_refresh, "p1" if is_refresh else None, existing_ads_map=existing,
                )
            except Exception:
                pass  # o resto da persistência não importa aqui; só o repasse
        self.assertTrue(repo.upsert_ads.called, "upsert_ads não foi chamado")
        return repo.upsert_ads.call_args.kwargs.get("existing_ads_map")

    def test_refresh_repassa_a_leitura_previa(self):
        snap = {"1": {"ad_id": "1"}}
        self.assertIs(self._persist(True, snap), snap)

    def test_criacao_de_pack_nao_recebe_leitura(self):
        self.assertIsNone(self._persist(False, None))


if __name__ == "__main__":
    unittest.main()

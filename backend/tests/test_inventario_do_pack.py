# -*- coding: utf-8 -*-
"""F5 (2026-09-14): o anúncio ativo sem entrega vive no inventário, não em ad_metrics.

O QUE ISTO TRAVA
----------------
Antes, cada anúncio entregável que não voltava do /insights virava uma linha-zero POR DIA
em ad_metrics (79% da tabela). Agora o intervalo ativo vai para ad_pack_inventory e o
anúncio só de inventário passa pelo pipeline uma vez, para ganhar `ads`, lista do pack e
miniatura. Cada lugar que contava ou listava pelas linhas-zero passa a unir o inventário:
- a persistência separa: métricas e mapa SEM o só de inventário; inventário obrigatório;
- a contagem do pack (cards de /packs) soma anúncios, nomes, campanhas e conjuntos dele;
- a lista de anúncios do pack (transcrição do pack, criação) inclui ele;
- apagar o pack apaga o inventário (não há FK que o leve junto).
"""
import unittest
from unittest import mock

from app.services import supabase_repo

PACK = "11111111-1111-4111-8111-00000000f5f5"


# ------------------------------------------------------------------ dublê do Supabase

class _Res:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, sb, table):
        self.sb, self.table = sb, table
        self.op, self.filters, self.rng = "select", [], None

    def select(self, _fields):
        return self

    def delete(self):
        self.op = "delete"
        return self

    def eq(self, col, val):
        self.filters.append((col, "eq", val))
        return self

    def in_(self, col, vals):
        self.filters.append((col, "in", list(vals)))
        return self

    def filter(self, *_a):
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, _n):
        return self

    def range(self, a, b):
        self.rng = (a, b)
        return self

    def _match(self, row):
        for col, op, val in self.filters:
            if op == "eq" and str(row.get(col)) != str(val):
                return False
            if op == "in" and row.get(col) not in val:
                return False
        return True

    def execute(self):
        self.sb.calls.append((self.table, self.op, list(self.filters)))
        rows = [r for r in self.sb.tables.get(self.table, []) if self._match(r)]
        if self.op == "delete":
            self.sb.tables[self.table] = [r for r in self.sb.tables.get(self.table, []) if not self._match(r)]
            return _Res(rows)
        if self.rng:
            a, b = self.rng
            rows = rows[a:b + 1]
        return _Res(rows)


class _FakeSB:
    def __init__(self, **tables):
        self.tables = {k: list(v) for k, v in tables.items()}
        self.calls = []

    def table(self, name):
        return _Query(self, name)


def _metric(ad_id, date, spend, name=None, campaign="c1", adset="s1"):
    return {"user_id": "u1", "pack_id": PACK, "ad_id": ad_id, "id": f"{date}-{ad_id}",
            "ad_name": name or f"AD {ad_id}", "campaign_id": campaign, "adset_id": adset, "spend": spend}


def _map(ad_id, date):
    return {"user_id": "u1", "pack_id": PACK, "ad_id": ad_id, "metric_date": date}


def _inv(ad_id, name=None, campaign="c1", adset="s1", pack=PACK):
    return {"user_id": "u1", "pack_id": pack, "ad_id": ad_id, "ad_name": name or f"AD {ad_id}",
            "campaign_id": campaign, "adset_id": adset}


# ------------------------------------------------------------------ contagem do pack

class TestContagemDoPack(unittest.TestCase):
    def _stats(self, sb):
        return supabase_repo.calculate_pack_stats_essential(None, PACK, user_id="u1", sb_client=sb)

    def test_pack_so_com_ativos_sem_entrega_conta_pelo_inventario(self):
        sb = _FakeSB(packs=[{"id": PACK, "user_id": "u1"}],
                     ad_pack_inventory=[_inv("a", campaign="c1", adset="s1"), _inv("b", campaign="c2", adset="s2")])
        self.assertEqual(self._stats(sb), {"totalSpend": 0.0, "uniqueAds": 2, "uniqueAdNames": 2,
                                           "uniqueCampaigns": 2, "uniqueAdsets": 2})

    def test_uniao_sem_contar_duas_vezes_e_gasto_so_das_metricas(self):
        sb = _FakeSB(
            packs=[{"id": PACK, "user_id": "u1"}],
            ad_metric_pack_map=[_map("a", "2026-09-01"), _map("a", "2026-09-02")],
            ad_metrics=[_metric("a", "2026-09-01", 10), _metric("a", "2026-09-02", 5)],
            # "a" também no inventário (ativo que gastou num trecho); "z" só no inventário, outro pai
            ad_pack_inventory=[_inv("a"), _inv("z", campaign="c9", adset="s9"),
                               _inv("x", pack="22222222-2222-4222-8222-00000000f5f5")],
        )
        self.assertEqual(self._stats(sb), {"totalSpend": 15.0, "uniqueAds": 2, "uniqueAdNames": 2,
                                           "uniqueCampaigns": 2, "uniqueAdsets": 2})


# ------------------------------------------------------------------ lista de anúncios do pack

class TestListaDoPack(unittest.TestCase):
    def test_inclui_anuncio_so_de_inventario(self):
        sb = _FakeSB(
            ad_metric_pack_map=[_map("a", "2026-09-01")],
            ad_pack_inventory=[_inv("a"), _inv("z")],
            ads=[{"user_id": "u1", "ad_id": "a", "ad_name": "AD a"}, {"user_id": "u1", "ad_id": "z", "ad_name": "AD z"},
                 {"user_id": "u1", "ad_id": "fora", "ad_name": "AD fora"}],
        )
        with mock.patch.object(supabase_repo, "_attach_storage_thumbnail", side_effect=lambda ad: ad):
            ads = supabase_repo.get_ads_for_pack(None, {"id": PACK}, "u1", sb_client=sb)
        self.assertEqual(sorted(a["ad_id"] for a in ads), ["a", "z"])


# ------------------------------------------------------------------ gravação do inventário

class TestMergeDoInventario(unittest.TestCase):
    def test_lotes_pela_rpc_com_silo_e_pack(self):
        sb = mock.MagicMock()
        sb.rpc.return_value.execute.return_value = _Res(3)
        rows = [{"ad_id": str(i)} for i in range(supabase_repo.INVENTORY_MERGE_BATCH + 1)]
        mudou = supabase_repo.merge_pack_inventory(None, rows, user_id="u1", pack_id=PACK, sb_client=sb)
        self.assertEqual(sb.rpc.call_count, 2)
        nome, params = sb.rpc.call_args_list[0].args
        self.assertEqual(nome, "merge_ad_pack_inventory")
        self.assertEqual((params["p_user_id"], params["p_pack_id"]), ("u1", PACK))
        self.assertEqual(len(params["p_rows"]), supabase_repo.INVENTORY_MERGE_BATCH)
        self.assertEqual(mudou, 6)

    def test_sem_intervalos_nao_chama(self):
        sb = mock.MagicMock()
        self.assertEqual(supabase_repo.merge_pack_inventory(None, [], user_id="u1", pack_id=PACK, sb_client=sb), 0)
        sb.rpc.assert_not_called()


# ------------------------------------------------------------------ apagar o pack

class TestApagarPack(unittest.TestCase):
    def test_apaga_o_inventario_do_pack_e_so_dele(self):
        outro = "22222222-2222-4222-8222-00000000f5f5"
        sb = _FakeSB(packs=[{"id": PACK, "user_id": "u1", "ad_ids": [], "date_start": None, "date_stop": None}],
                     ad_pack_inventory=[_inv("a"), _inv("b", pack=outro)])
        with mock.patch.object(supabase_repo, "_get_pack_thumb_storage_paths", return_value=[]), \
             mock.patch.object(supabase_repo, "_process_pack_deletion_in_batches", return_value=([], [], [])):
            try:
                supabase_repo.delete_pack(None, PACK, user_id="u1", sb_client=sb)
            except Exception:
                pass  # o resto da exclusão não importa aqui
        self.assertEqual([r["ad_id"] for r in sb.tables["ad_pack_inventory"]], ["b"])


# ------------------------------------------------------------------ persistência do job

class TestPersistenciaSeparaOInventario(unittest.TestCase):
    FORMATTED = [
        {"ad_id": "real", "ad_name": "AD real", "date": "2026-09-01"},
        {"ad_id": "real", "ad_name": "AD real", "date": "2026-09-02"},
        {"ad_id": "so-inv", "ad_name": "AD so-inv", "date": "2026-09-01"},
    ]
    INTERVALS = [{"ad_id": "real", "first_active_date": "2026-09-01", "last_active_date": "2026-09-02"},
                 {"ad_id": "so-inv", "first_active_date": "2026-09-01", "last_active_date": "2026-09-02"}]

    def _persist(self, *, is_refresh=True, merge_error=None, intervals=INTERVALS):
        from app.services import job_processor

        jp = job_processor.JobProcessor.__new__(job_processor.JobProcessor)
        jp.tracker = mock.MagicMock()
        jp.tracker.heartbeat.return_value = True
        jp.tracker.get_job.return_value = {"status": "processing"}
        jp.user_jwt, jp.user_id, jp._sb, jp.use_service_role = None, "u1", mock.MagicMock(), False
        repo = mock.MagicMock()
        repo.upsert_pack.return_value = "p-novo"
        repo.get_pack.return_value = None
        ordem = []

        def gravar(nome, falha=None, devolve=None):
            def _f(*_a, **_k):
                ordem.append(nome)
                if falha:
                    raise falha
                return devolve
            return _f

        repo.upsert_ad_metrics.side_effect = gravar("upsert_ad_metrics")
        repo.merge_pack_inventory.side_effect = gravar("merge_pack_inventory", merge_error)
        repo.calculate_pack_stats_essential.side_effect = gravar("calculate_pack_stats_essential", devolve={"totalSpend": 0})
        erro = None
        with mock.patch.object(job_processor, "supabase_repo", repo), \
             mock.patch.object(job_processor, "spawn_pack_background_tasks", mock.MagicMock()), \
             mock.patch.object(jp, "_check_if_cancelled", return_value=False), \
             mock.patch.object(jp, "_cleanup_new_pack") as cleanup:
            try:
                jp._persist_data(
                    "job-1", {"name": "Pack X", "date_stop": "2026-09-02"}, list(self.FORMATTED),
                    is_refresh, "p1" if is_refresh else None,
                    inventory_intervals=intervals, inventory_only_ad_ids={"so-inv"},
                )
            except Exception as e:  # noqa: BLE001
                erro = e
        return repo, ordem, erro, cleanup

    def test_metricas_sem_o_so_de_inventario_e_lista_do_pack_com_ele(self):
        repo, _ordem, erro, _c = self._persist()
        self.assertIsNone(erro)
        metricas = repo.upsert_ad_metrics.call_args.args[1]
        self.assertEqual([m["ad_id"] for m in metricas], ["real", "real"])
        self.assertEqual([a["ad_id"] for a in repo.upsert_ads.call_args.args[1]], ["real", "real", "so-inv"])
        self.assertEqual(repo.update_pack_ad_ids.call_args.args[2], ["real", "so-inv"])

    def test_inventario_gravado_antes_da_contagem(self):
        repo, ordem, erro, _c = self._persist()
        self.assertIsNone(erro)
        self.assertEqual(repo.merge_pack_inventory.call_args.args[1], self.INTERVALS)
        self.assertEqual(repo.merge_pack_inventory.call_args.kwargs["pack_id"], "p1")
        self.assertEqual(ordem, ["upsert_ad_metrics", "merge_pack_inventory", "calculate_pack_stats_essential"])

    def test_falha_no_inventario_derruba_e_limpa_pack_novo(self):
        from app.services.job_processor import PersistStageError

        _repo, _ordem, erro, cleanup = self._persist(is_refresh=False, merge_error=RuntimeError("queda"))
        self.assertIsInstance(erro, PersistStageError)
        self.assertEqual(erro.stage, "inventory_merge")
        cleanup.assert_called_once()

    def test_sem_intervalos_nao_grava_inventario(self):
        repo, _ordem, erro, _c = self._persist(intervals=[])
        self.assertIsNone(erro)
        repo.merge_pack_inventory.assert_not_called()


if __name__ == "__main__":
    unittest.main()

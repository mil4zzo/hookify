# -*- coding: utf-8 -*-
"""Recorte de um pack (`supabase_repo.trim_pack_to_window`).

As funções SQL têm teste próprio no laboratório (167_recorte_de_periodo.test.sql,
18 asserções, 5 sabotagens). Aqui se trava a ORQUESTRAÇÃO, que é onde mora a
segurança:

- a ordem: cabeça → período → inventário → anúncios → conversion_types. As datas
  do pack NÃO são tocadas aqui (quem as aplica é `apply_pack_window_edit`, por
  último, no chamador) — se algo falhar no meio, o pack segue declarando o
  período antigo, que é o estado do qual um refresh repõe o que faltar;
- ausência só apaga na cabeça, e só com as chaves da resposta em mãos;
- só os dias FORA do período novo são apagados, um por requisição;
- um dia que falha interrompe o recorte em vez de seguir em silêncio.

Sabotagens já feitas: trocar a ordem (clamp antes do delete) → falha em
test_ordem_das_operacoes; engolir a exceção do dia → falha em
test_dia_que_falha_interrompe.
"""
import unittest
from unittest import mock

from app.services import supabase_repo

OWNER = "user-1"
PACK = "pack-1"


class _Q:
    """Query builder falso: registra a cadeia e devolve as linhas configuradas."""

    def __init__(self, registro, tabela, linhas):
        self._registro, self._tabela, self._linhas = registro, tabela, linhas
        self._op = "select"
        self._filtros = {}

    def delete(self):
        self._op = "delete"
        return self

    def select(self, *a, **k):
        self._op = "select"
        return self

    def eq(self, campo, valor):
        self._filtros[campo] = valor
        return self

    def lt(self, campo, valor):
        self._filtros[f"{campo}<"] = valor
        return self

    def gt(self, campo, valor):
        self._filtros[f"{campo}>"] = valor
        return self

    def in_(self, campo, valores):
        self._filtros[f"{campo} in"] = list(valores)
        return self

    def or_(self, *a, **k):
        return self

    def filter(self, *a, **k):
        return self

    def range(self, *a, **k):
        return self

    def execute(self):
        self._registro.append((f"{self._tabela}.{self._op}", dict(self._filtros)))
        # O fake honra lt/gt em `date`: a leitura dos dias fora do período pede
        # só o que está fora, em duas consultas paginadas. Um fake que devolvesse
        # tudo esconderia justamente o erro que essa leitura pode ter.
        linhas = self._linhas
        antes, depois = self._filtros.get("date<"), self._filtros.get("date>")
        if self._op == "select" and (antes or depois):
            linhas = [
                r for r in linhas
                if (antes and str(r.get("date", "")) < antes) or (depois and str(r.get("date", "")) > depois)
            ]
        return mock.Mock(data=linhas)


class _Sb:
    def __init__(self, linhas_por_tabela=None, rpc_retorno=None, falhar_dia=None):
        self.chamadas = []
        self._linhas = linhas_por_tabela or {}
        self._rpc = rpc_retorno or {}
        self._falhar_dia = falhar_dia

    def table(self, nome):
        if self._falhar_dia and nome == "ad_metrics":
            sb = self

            class _Explode(_Q):
                def execute(self_inner):
                    if self_inner._filtros.get("date") == sb._falhar_dia:
                        raise RuntimeError("PostgREST caiu")
                    return super().execute()

            return _Explode(self.chamadas, nome, self._linhas.get(nome, []))
        return _Q(self.chamadas, nome, self._linhas.get(nome, []))

    def rpc(self, nome, params):
        self.chamadas.append((f"rpc.{nome}", dict(params)))
        return mock.Mock(execute=lambda: mock.Mock(data=self._rpc.get(nome, [])))

    @property
    def nomes(self):
        return [c[0] for c in self.chamadas]


DIAS_DO_PACK = [
    {"date": "2026-07-01"}, {"date": "2026-07-02"},          # saem (antes)
    {"date": "2026-07-15"}, {"date": "2026-07-20"},          # ficam
    {"date": "2026-09-01"},                                   # sai (depois)
]


def _trim(sb, **kw):
    with mock.patch.object(supabase_repo, "_get_sb", return_value=sb), \
         mock.patch.object(supabase_repo, "_delete_unreferenced_thumb_paths", return_value=0):
        return supabase_repo.trim_pack_to_window(
            OWNER, PACK, "2026-07-10", "2026-08-31", sb_client=sb, **kw)


class TestTrimPackToWindow(unittest.TestCase):
    def test_ordem_das_operacoes(self) -> None:
        sb = _Sb({"ad_metrics": DIAS_DO_PACK},
                 {"pack_clamp_inventory": [{"ajustados": 2, "removidos": 1}], "pack_prune_ad_ids": []})
        _trim(sb, head=("2026-07-10", "2026-07-16"), head_keys=[["a1", "2026-07-10"]])

        passos = [n for n in sb.nomes if n.startswith("rpc.") or n == "ad_metrics.delete"]
        self.assertEqual(passos[0], "rpc.pack_trim_head")           # cabeça primeiro
        self.assertEqual(passos[-1], "rpc.pack_recompute_conversion_types")
        self.assertLess(passos.index("rpc.pack_clamp_inventory"),
                        passos.index("rpc.pack_prune_ad_ids"))      # inventário antes de podar
        self.assertIn("ad_metrics.delete", passos[:passos.index("rpc.pack_clamp_inventory")])
        # Nenhuma escrita em `packs` aqui: as datas são do chamador, por último.
        self.assertNotIn("packs.update", sb.nomes)

    def test_apaga_so_os_dias_fora_do_periodo(self) -> None:
        sb = _Sb({"ad_metrics": DIAS_DO_PACK}, {"pack_prune_ad_ids": []})
        r = _trim(sb)
        dias = [c[1]["date"] for c in sb.chamadas if c[0] == "ad_metrics.delete" and "date" in c[1]]
        self.assertEqual(dias, ["2026-07-01", "2026-07-02", "2026-09-01"])
        self.assertEqual(r["dias_apagados"], 3)

    def test_varredura_final_pega_o_que_esta_fora_da_janela_declarada(self) -> None:
        sb = _Sb({"ad_metrics": DIAS_DO_PACK}, {"pack_prune_ad_ids": []})
        _trim(sb)
        varreduras = [c[1] for c in sb.chamadas if c[0] == "ad_metrics.delete" and "date" not in c[1]]
        self.assertEqual(len(varreduras), 2)
        self.assertEqual(varreduras[0].get("date<"), "2026-07-10")
        self.assertEqual(varreduras[1].get("date>"), "2026-08-31")

    def test_sem_chaves_a_cabeca_nao_e_tocada(self) -> None:
        """Ausência só apaga com a resposta em mãos. Sem chaves, nada de cabeça."""
        sb = _Sb({"ad_metrics": DIAS_DO_PACK}, {"pack_prune_ad_ids": []})
        _trim(sb, head=("2026-07-10", "2026-07-16"), head_keys=None)
        self.assertNotIn("rpc.pack_trim_head", sb.nomes)

        sb2 = _Sb({"ad_metrics": DIAS_DO_PACK}, {"pack_prune_ad_ids": []})
        _trim(sb2, head=("2026-07-10", "2026-07-16"), head_keys=[])
        self.assertNotIn("rpc.pack_trim_head", sb2.nomes)

    def test_dia_que_falha_interrompe_o_recorte(self) -> None:
        """Meio recorte em silêncio é pior que recorte nenhum: o pack ficaria com
        o período antigo declarado e dias faltando no meio."""
        sb = _Sb({"ad_metrics": DIAS_DO_PACK}, {"pack_prune_ad_ids": []}, falhar_dia="2026-07-02")
        with self.assertRaises(RuntimeError):
            _trim(sb)
        self.assertNotIn("rpc.pack_clamp_inventory", sb.nomes)
        self.assertNotIn("rpc.pack_recompute_conversion_types", sb.nomes)

    def test_sem_ads_saindo_nao_mexe_em_ads(self) -> None:
        sb = _Sb({"ad_metrics": DIAS_DO_PACK}, {"pack_prune_ad_ids": []})
        r = _trim(sb)
        self.assertNotIn("rpc.batch_remove_pack_id_from_arrays", sb.nomes)
        self.assertEqual(r["ads_removidos"], 0)

    def test_ads_que_saem_perdem_o_pack_e_as_miniaturas(self) -> None:
        """adX pertence a outro pack (fica, só perde este); adY era só deste (apaga).
        É a mesma decisão linha a linha do delete_pack."""
        sb = _Sb({"ad_metrics": DIAS_DO_PACK,
                  "ads": [{"ad_id": "adX", "pack_ids": [PACK, "outro"], "thumb_storage_path": "x.jpg"},
                          {"ad_id": "adY", "pack_ids": [PACK], "thumb_storage_path": "y.jpg"}]},
                 {"pack_prune_ad_ids": ["adX", "adY"],
                  "batch_remove_pack_id_from_arrays": {"status": "success"}})
        r = _trim(sb)
        self.assertIn("rpc.batch_remove_pack_id_from_arrays", sb.nomes)
        # Só o exclusivo entra no delete; adX sobrevive porque outro pack o usa.
        apagados = [c[1].get("ad_id in") for c in sb.chamadas if c[0] == "ads.delete"]
        self.assertEqual(apagados, [["adY"]])
        self.assertEqual(r["ads_removidos"], 2)


if __name__ == "__main__":
    unittest.main()

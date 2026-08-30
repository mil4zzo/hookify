"""
O onboarding le `validation_criteria` — e o formato do campo mudou.

O QUE ESTA EM JOGO, NA PRATICA
------------------------------
`validation_criteria_configured` e o que marca "criterio de validacao" como passo
concluido no onboarding. Ler o formato errado tem duas consequencias opostas e
igualmente ruins: dizer "nao configurado" para quem ja configurou reabre o
onboarding de todo mundo; dizer "configurado" para quem nao configurou pula um
passo obrigatorio e deixa o app julgando anuncio sem amostra.

O CAMPO ERA UM ARRAY, VIROU UMA ARVORE
--------------------------------------
Ate a migration 135 o campo era `[{...condicao}, ...]` e o servico decidia com
`isinstance(criteria, list) and len(criteria) > 0`. Agora e a MESMA arvore de
regra dos filtros do Manager e dos grupos do Boards:

    {"logic": "AND", "conditions": [{...}]}

Um array que tenha sobrado no banco tem de cair em "nao configurado" — e o mesmo
destino que o array vazio ja tinha, entao ninguem muda de estado por causa disso.
"""

import unittest
from unittest.mock import patch

from app.services import onboarding_service


class _Query:
  """Dublê da cadeia fluente do PostgREST: .select().eq().limit().execute()."""

  def __init__(self, rows):
    self._rows = rows

  def select(self, *_a, **_k):
    return self

  def eq(self, *_a, **_k):
    return self

  def limit(self, *_a, **_k):
    return self

  def execute(self):
    return type("Res", (), {"data": self._rows})()


class _Supabase:
  def __init__(self, prefs_row):
    self._prefs_row = prefs_row

  def table(self, name):
    if name == "user_preferences":
      return _Query([self._prefs_row] if self._prefs_row is not None else [])
    # facebook_connections e o resto: sem linhas, nao e o objeto deste teste.
    return _Query([])


def _status_para(validation_criteria):
  row = {
    "has_completed_onboarding": False,
    "locale": "pt-BR",
    "validation_criteria": validation_criteria,
  }
  with patch.object(onboarding_service, "get_supabase_for_user", return_value=_Supabase(row)):
    return onboarding_service.get_onboarding_status("jwt", "user-1")


class TestOnboardingValidationCriteriaTree(unittest.TestCase):
  def test_arvore_com_condicao_e_configurado(self):
    # E exatamente o que a migration 135 gravou para todo mundo.
    criterio = {
      "logic": "AND",
      "conditions": [
        {"id": "seed_impressions", "type": "condition", "field": "impressions", "operator": ">", "value": 3000}
      ],
    }
    self.assertTrue(_status_para(criterio)["validation_criteria_configured"])

  def test_arvore_com_subgrupo_conta_pelo_topo(self):
    criterio = {
      "logic": "OR",
      "conditions": [{"id": "g1", "type": "group", "logic": "AND", "conditions": []}],
    }
    # Um no de topo basta: quem decide se a regra "diz alguma coisa" de verdade e
    # a tela (countRestrictiveConditions). Aqui a pergunta e so "existe criterio?".
    self.assertTrue(_status_para(criterio)["validation_criteria_configured"])

  def test_arvore_vazia_nao_e_configurado(self):
    self.assertFalse(_status_para({"logic": "AND", "conditions": []})["validation_criteria_configured"])

  def test_formato_ANTIGO_em_array_nao_e_configurado(self):
    # O resto do formato antigo tem de cair no mesmo lugar que o array vazio ja
    # caia. Se isto virasse True, um criterio ilegivel passaria por configurado.
    antigo = [{"id": "a", "type": "condition", "field": "ctr", "operator": "GREATER_THAN", "value": "0.02"}]
    self.assertFalse(_status_para(antigo)["validation_criteria_configured"])

  def test_array_vazio_nao_e_configurado(self):
    self.assertFalse(_status_para([])["validation_criteria_configured"])

  def test_null_e_lixo_nao_quebram(self):
    for valor in (None, "texto", 42, {"logic": "AND"}, {"conditions": "nao-e-lista"}):
      with self.subTest(valor=valor):
        self.assertFalse(_status_para(valor)["validation_criteria_configured"])


if __name__ == "__main__":
  unittest.main()

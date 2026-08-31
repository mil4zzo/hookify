/**
 * A matriz de disponibilidade — o ÚNICO eixo em que as três telas diferem.
 *
 * Operador, escala e semântica são iguais em Manager, Boards e Critério; o que
 * muda é quais campos cada uma oferece. Se essa matriz escorregar, volta o drift
 * que a unificação veio desfazer — só que agora escondido num registry só.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALL_RULE_CONTEXTS,
  RULE_FIELDS,
  RULE_OPERATORS,
  getAvailableRuleFields,
  getRuleField,
  getRuleOperators,
  ruleOperatorNeedsValue,
  type RuleContext,
} from "@/lib/rules/fields";

const ALL = { hasSheetIntegration: true };

function idsFor(context: RuleContext, extra: Record<string, unknown> = {}): string[] {
  return getAvailableRuleFields({ hasSheetIntegration: true, context, ...extra }).map((f) => f.id);
}

/**
 * A REGRA que pegou um bug real (2026-08-30): um campo de multi-seleção só pode ser
 * oferecido onde a tela consegue montar a LISTA de opções, e a lista sempre sai das
 * linhas do recorte. Onde não há recorte, o seletor abre com "nada disponível" e o
 * campo vira opção de menu que não funciona — o mesmo campo morto que a fase 4 apagou
 * do Critério, e que a fase 5 quase reintroduziu ao oferecer "Campanha" nas
 * Configurações.
 *
 * Este mapa é o contrato com os quatro editores. Ao acrescentar um campo
 * multi-seleção, ou ele entra aqui (e o editor daquele contexto passa a fornecer as
 * opções), ou este teste quebra.
 */
const OPCOES_FORNECIDAS: Record<RuleContext, string[]> = {
  // ManagerTable.ruleDimensionOptions: monta as quatro a partir das linhas carregadas.
  manager: ["pack_ids", "account_ids", "campaign_ids", "adset_ids"],
  // ManagerChildrenTable: a filha traz pack_ids (migration 134) e account_id.
  "manager-children": ["pack_ids", "account_ids"],
  // app/boards/page.tsx: as quatro, a partir das linhas do board.
  boards: ["pack_ids", "account_ids", "campaign_ids", "adset_ids"],
  // ValidationCriteriaEditor: nas Configurações não há período nem pack selecionado.
  // Packs e contas saem da sessão do cliente (lista completa e estável); campanha e
  // conjunto não têm fonte equivalente — a pergunta ali se faz por NOME.
  criteria: ["pack_ids", "account_ids"],
};

test("todo campo de multi-seleção oferecido tem quem forneça as opções", () => {
  for (const context of ALL_RULE_CONTEXTS) {
    const oferecidos = getAvailableRuleFields({ hasSheetIntegration: true, context })
      .filter((field) => field.kind === "multiselect")
      .map((field) => field.id);
    const semFonte = oferecidos.filter((id) => !OPCOES_FORNECIDAS[context].includes(id));
    assert.deepEqual(
      semFonte,
      [],
      `em "${context}" estes seletores abririam vazios: ${semFonte.join(", ")}`,
    );
  }
});

test("e a pergunta por NOME continua possível onde o id não é oferecido", () => {
  // O contrapeso do teste acima: tirar o seletor de id não pode deixar o contexto
  // sem forma nenhuma de perguntar por campanha.
  for (const context of ["criteria", "manager-children"] as RuleContext[]) {
    const ids = idsFor(context);
    assert.ok(ids.includes("campaign_name"), `${context} ficou sem como perguntar por campanha`);
    assert.ok(ids.includes("adset_name"), `${context} ficou sem como perguntar por conjunto`);
  }
});

test("os três contextos compartilham o núcleo: métricas, nome e status", () => {
  const nucleo = ["ad_name", "status", "meta_created_time", "spend", "hook", "cpr", "ctr"];
  for (const context of ALL_RULE_CONTEXTS) {
    const ids = idsFor(context);
    for (const field of nucleo) {
      assert.ok(ids.includes(field), `${field} deveria existir em "${context}"`);
    }
  }
});

test("linhas-filhas oferecem só o que a linha carrega de verdade", () => {
  const ids = idsFor("manager-children");

  // Tags são do CRIATIVO e a filha não as recebe — e não vai receber: derivá-las
  // para o anúncio exigiria casar por nome, vínculo que não existe no dado.
  assert.ok(!ids.includes("tags"), "tags não podem aparecer em linhas-filhas");

  // Procedência entrou nas filhas: Conta porque a linha já traz `account_id`
  // (exato, não representante) e Pack pela migration 134.
  assert.ok(ids.includes("account_ids"), "Conta é respondida por account_id na filha");
  assert.ok(ids.includes("pack_ids"), "Pack veio na migration 134");

  assert.ok(ids.includes("ad_name"));
  assert.ok(ids.includes("spend"));
});

test("ad_id só onde a linha É um anúncio", () => {
  assert.ok(!idsFor("boards").includes("ad_id"), "board agrupa criativos, não anúncios");
  assert.ok(idsFor("criteria").includes("ad_id"));
  assert.ok(idsFor("manager", { tab: "individual" }).includes("ad_id"));
  for (const tab of ["por-anuncio", "por-conjunto", "por-campanha"] as const) {
    assert.ok(!idsFor("manager", { tab }).includes("ad_id"), `ad_id não faz sentido na aba ${tab}`);
  }
});

test("sem aba declarada, o Manager oferece tudo que o contexto permite", () => {
  // A aba é um refino opcional: quem não passa `tab` não perde campo.
  assert.ok(idsFor("manager").includes("ad_id"));
});

test("MQL some sem integração de planilha, mas a regra salva continua avaliável", () => {
  const semPlanilha = getAvailableRuleFields({ hasSheetIntegration: false }).map((f) => f.id);
  for (const field of ["mqls", "cpmql", "leadscore_avg", "mql_rate"]) {
    assert.ok(!semPlanilha.includes(field), `${field} não deveria aparecer sem planilha`);
    // O registry continua conhecendo o campo — o avaliador não o trata como extinto.
    assert.ok(getRuleField(field), `${field} deveria seguir no registry`);
  }
});

test("campanha e conjunto: id onde a linha traz o array, nome em toda parte", () => {
  // A migration 136 pôs `campaign_ids`/`adset_ids` na linha AGREGADA. A linha-filha
  // é UM anúncio e a RPC de detalhe devolve o NOME dele, não o id — escolher da
  // lista ali seria um filtro que nunca casa, então só o campo de texto é ofertado.
  for (const field of ["campaign_ids", "adset_ids"]) {
    assert.ok(idsFor("manager").includes(field), `${field} deveria ser oferecido no Manager`);
    assert.ok(idsFor("boards").includes(field), `${field} deveria ser oferecido no Boards`);
    // Fora de `criteria` e `manager-children`: sem recorte não há lista de opções —
    // ver OPCOES_FORNECIDAS acima.
    assert.ok(!idsFor("criteria").includes(field), `${field} não tem lista nas Configurações`);
    assert.ok(!idsFor("manager-children").includes(field), `${field} não cabe na linha-filha`);
  }
  for (const field of ["campaign_name", "adset_name"]) {
    for (const context of ALL_RULE_CONTEXTS) {
      assert.ok(idsFor(context).includes(field), `${field} deveria ser oferecido em "${context}"`);
    }
  }
});

test("todo campo do registry tem operadores, e todo operador tem rótulo", () => {
  for (const field of RULE_FIELDS) {
    const operators = getRuleOperators(field.id);
    assert.ok(operators.length > 0, `${field.id} sem operadores`);
    for (const op of operators) {
      assert.ok(op.label && op.label.trim().length > 0, `${field.id}/${op.value} sem rótulo`);
    }
  }
});

test("todo campo declara um kind conhecido e um grupo do seletor", () => {
  const kinds = new Set(Object.keys(RULE_OPERATORS));
  const groups = new Set(["Tags", "Criativo", "Procedência", "Métricas"]);
  for (const field of RULE_FIELDS) {
    assert.ok(kinds.has(field.kind), `${field.id} tem kind desconhecido: ${field.kind}`);
    assert.ok(groups.has(field.group), `${field.id} tem grupo desconhecido: ${field.group}`);
  }
});

test("ids do registry são únicos", () => {
  const ids = RULE_FIELDS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, "id duplicado no registry");
});

test("is_empty/is_not_empty existem em métrica, texto e data — e não pedem valor", () => {
  for (const kind of ["metric", "text", "date"] as const) {
    const ops = RULE_OPERATORS[kind].map((o) => o.value);
    assert.ok(ops.includes("is_empty"), `${kind} sem is_empty`);
    assert.ok(ops.includes("is_not_empty"), `${kind} sem is_not_empty`);
  }
  assert.equal(ruleOperatorNeedsValue("is_empty"), false);
  assert.equal(ruleOperatorNeedsValue("is_not_empty"), false);
  assert.equal(ruleOperatorNeedsValue("contains"), true);
  assert.equal(ruleOperatorNeedsValue("matches_regex"), true);
});

test("regex é operador de texto e só de texto", () => {
  assert.ok(RULE_OPERATORS.text.some((o) => o.value === "matches_regex"));
  for (const kind of ["metric", "date", "status", "multiselect", "tags"] as const) {
    assert.ok(
      !RULE_OPERATORS[kind].some((o) => o.value === "matches_regex"),
      `regex não faz sentido em ${kind}`,
    );
  }
});

test("a escala de porcentagem é derivada do registry de métricas, não redigitada aqui", () => {
  // `isRatioPercent` decide a divisão por 100 na avaliação. Um campo marcado errado
  // reinterpreta em silêncio toda regra gravada — por isso o valor vem de
  // METRIC_DEFINITIONS.formatKind, e não de uma lista paralela.
  for (const id of ["hook", "ctr", "hold_rate", "connect_rate", "page_conv", "scroll_stop", "website_ctr"]) {
    assert.equal(getRuleField(id)?.isRatioPercent, true, `${id} deveria ser ratioPercent`);
  }
  // rawPercent (já em 0-100) NÃO divide.
  for (const id of ["video_watched_p50", "video_watched_p75"]) {
    assert.ok(!getRuleField(id)?.isRatioPercent, `${id} é rawPercent, não pode dividir por 100`);
  }
  // Contagem e dinheiro nunca dividem.
  for (const id of ["spend", "impressions", "clicks", "cpr", "cpm", "plays"]) {
    assert.ok(!getRuleField(id)?.isRatioPercent, `${id} não é porcentagem`);
  }
});

test("o registry cobre todas as métricas do Manager — nenhuma fica sem filtro", () => {
  const ids = new Set(getAvailableRuleFields(ALL).map((f) => f.id));
  // Amostra do que o usuário espera poder filtrar em qualquer tela.
  for (const id of ["spend", "impressions", "clicks", "reach", "frequency", "results", "cpr", "cpc", "cpm", "hook", "hold_rate", "ctr", "lpv", "page_conv", "thruplays"]) {
    assert.ok(ids.has(id), `${id} não está no registry`);
  }
});

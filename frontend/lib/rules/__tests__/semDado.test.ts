/**
 * A regra dos TRÊS ESTADOS, caso a caso — os exemplos que o usuário aprovou.
 *
 * "Sem dado" ⇔ o divisor é zero. Uma linha sem dado não casa com a condição NEM
 * com a contrária; quem a quer, pede `is_empty`.
 *
 * Cada teste aqui é uma situação real de tela, com o comportamento ANTIGO anotado.
 * São as divergências INTENCIONAIS contra `reference/legacyEvaluators.ts` — o
 * diferencial não pode "consertá-las" para ficar verde.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { rowMatchesRules } from "@/lib/rules/evaluate";
import { getMetricNumericValueOrNull } from "@/lib/metrics";
import type { RuleTree } from "@/lib/rules/types";

function rule(field: string, operator: string, value: any = null): RuleTree {
  return { logic: "AND", conditions: [{ id: "c1", type: "condition", field, operator, value }] };
}

const CTX = { actionType: "lead" };

/* ------------------------------------------------------------------ *
 * Anúncio de imagem: 40 mil impressões, 0 plays
 * ------------------------------------------------------------------ */

const IMAGEM = {
  ad_name: "Banner BF",
  media_type: "image",
  impressions: 40000,
  clicks: 800,
  spend: 300,
  plays: 0,
  // A RPC fabrica esses zeros: `case when plays > 0 then wsum/plays else 0 end`.
  hook: 0,
  hold_rate: 0,
  scroll_stop: 0,
  video_watched_p50: 0,
  video_watched_p75: 0,
  ctr: 0.02,
  conversions: { lead: 10 },
  lpv: 500,
};

test("anúncio de imagem não aparece em 'hook < 5%' — nem em 'hook >= 5%'", () => {
  // ANTES: aparecia em "< 5%" (hook = 0), como se fosse um vídeo ruim.
  assert.equal(rowMatchesRules(IMAGEM, rule("hook", "<", "5"), CTX), false);
  assert.equal(rowMatchesRules(IMAGEM, rule("hook", ">=", "5"), CTX), false);
  assert.equal(rowMatchesRules(IMAGEM, rule("hook", ">", "0"), CTX), false);
  assert.equal(rowMatchesRules(IMAGEM, rule("hook", "=", "0"), CTX), false);
  assert.equal(rowMatchesRules(IMAGEM, rule("hook", "!=", "0"), CTX), false);
});

test("'hook está vazio' é como o usuário pede os anúncios de imagem de propósito", () => {
  assert.equal(rowMatchesRules(IMAGEM, rule("hook", "is_empty"), CTX), true);
  assert.equal(rowMatchesRules(IMAGEM, rule("hook", "is_not_empty"), CTX), false);
});

test("todas as métricas que dividem por plays seguem a mesma regra", () => {
  for (const metric of ["hook", "hold_rate", "scroll_stop", "video_watched_p50", "video_watched_p75"]) {
    assert.equal(rowMatchesRules(IMAGEM, rule(metric, "<", "5"), CTX), false, `${metric} < 5 deveria excluir`);
    assert.equal(rowMatchesRules(IMAGEM, rule(metric, "is_empty"), CTX), true, `${metric} is_empty deveria incluir`);
  }
});

test("no anúncio de imagem, o que NÃO depende de vídeo continua funcionando", () => {
  // Gasto, cliques, impressões e CTR são fatos — zero neles é zero de verdade.
  assert.equal(rowMatchesRules(IMAGEM, rule("spend", ">", "100"), CTX), true);
  assert.equal(rowMatchesRules(IMAGEM, rule("impressions", ">", "1000"), CTX), true);
  assert.equal(rowMatchesRules(IMAGEM, rule("ctr", ">", "1"), CTX), true);
  assert.equal(rowMatchesRules(IMAGEM, rule("plays", "=", "0"), CTX), true);
});

/* ------------------------------------------------------------------ *
 * R$ 300 gastos, 0 resultados
 * ------------------------------------------------------------------ */

const SEM_CONVERSAO = {
  ad_name: "Video sem conversao",
  impressions: 20000,
  clicks: 300,
  spend: 300,
  plays: 15000,
  hook: 0.25,
  ctr: 0.015,
  lpv: 100,
  conversions: {},
};

test("anúncio com R$ 300 e 0 resultados não aparece em 'CPR < 50' — nem lidera a ordenação", () => {
  // ANTES: CPR = 0 → aparecia em "< 50" E ia para o topo de "CPR mais barato",
  // como se fosse o melhor anúncio da conta.
  assert.equal(rowMatchesRules(SEM_CONVERSAO, rule("cpr", "<", "50"), CTX), false);
  assert.equal(rowMatchesRules(SEM_CONVERSAO, rule("cpr", ">=", "50"), CTX), false);
  assert.equal(getMetricNumericValueOrNull(SEM_CONVERSAO, "cpr", CTX), null);
});

test("'resultados = 0' e 'CPR está vazio' são as duas formas de encontrá-lo", () => {
  assert.equal(rowMatchesRules(SEM_CONVERSAO, rule("results", "=", "0"), CTX), true);
  assert.equal(rowMatchesRules(SEM_CONVERSAO, rule("cpr", "is_empty"), CTX), true);
});

test("com 1 resultado, CPR é número real e caro — não 'sem dado'", () => {
  const umResultado = { ...SEM_CONVERSAO, conversions: { lead: 1 } };
  assert.equal(rowMatchesRules(umResultado, rule("cpr", ">", "200"), CTX), true);
  assert.equal(rowMatchesRules(umResultado, rule("cpr", "is_empty"), CTX), false);
});

/* ------------------------------------------------------------------ *
 * Poucos plays é RUÍDO, não ausência
 * ------------------------------------------------------------------ */

test("vídeo com 12 plays e hook 8% casa em 'hook >= 5%' — significância é outra pergunta", () => {
  const poucosPlays = { ad_name: "Novo", plays: 12, hook: 0.08, impressions: 300, spend: 5 };
  assert.equal(rowMatchesRules(poucosPlays, rule("hook", ">=", "5"), CTX), true);
  assert.equal(rowMatchesRules(poucosPlays, rule("hook", "is_empty"), CTX), false);

  // Quem quer significância combina — é o que já se faz olhando a tabela.
  const comCorte: RuleTree = {
    logic: "AND",
    conditions: [
      { id: "a", type: "condition", field: "hook", operator: ">=", value: "5" },
      { id: "b", type: "condition", field: "plays", operator: ">=", value: "100" },
    ],
  };
  assert.equal(rowMatchesRules(poucosPlays, comCorte, CTX), false);
});

/* ------------------------------------------------------------------ *
 * Pausado o período inteiro: 0 impressões
 * ------------------------------------------------------------------ */

const PAUSADO = {
  ad_name: "Pausado",
  impressions: 0,
  clicks: 0,
  spend: 0,
  plays: 0,
  ctr: 0,
  hook: 0,
  lpv: 0,
  conversions: {},
};

test("anúncio sem impressões: CTR é 'sem dado', gasto zero é fato", () => {
  assert.equal(rowMatchesRules(PAUSADO, rule("ctr", ">", "1"), CTX), false);
  assert.equal(rowMatchesRules(PAUSADO, rule("ctr", "<", "1"), CTX), false);
  assert.equal(rowMatchesRules(PAUSADO, rule("ctr", "is_empty"), CTX), true);
  // Gasto e impressões são contagem: zero é resposta, não ausência.
  assert.equal(rowMatchesRules(PAUSADO, rule("spend", "=", "0"), CTX), true);
  assert.equal(rowMatchesRules(PAUSADO, rule("impressions", "=", "0"), CTX), true);
  assert.equal(rowMatchesRules(PAUSADO, rule("spend", "is_empty"), CTX), false);
});

/* ------------------------------------------------------------------ *
 * `plays` ausente ≠ `plays` zero
 * ------------------------------------------------------------------ */

test("linha sem a coluna plays não vira 'sem dado' — ausência de denominador não é zero", () => {
  // Abas/consultas que não devolvem `plays` não podem apagar o hook que veio.
  const semColuna = { ad_name: "X", hook: 0.3, impressions: 1000 };
  assert.equal(getMetricNumericValueOrNull(semColuna, "hook", CTX), 0.3);
  assert.equal(rowMatchesRules(semColuna, rule("hook", ">", "10"), CTX), true);
});

/* ------------------------------------------------------------------ *
 * Escala: 2 = 2%, 0,5 = 0,5% — e a vírgula do teclado brasileiro
 * ------------------------------------------------------------------ */

test("a escala é a que o usuário digita, inclusive abaixo de 1%", () => {
  const linha = { ad_name: "X", plays: 1000, impressions: 50000, hook: 0.004 }; // 0,4%
  assert.equal(rowMatchesRules(linha, rule("hook", "<", "0.5"), CTX), true);
  assert.equal(rowMatchesRules(linha, rule("hook", ">", "0.5"), CTX), false);
  // Vírgula decimal (teclado pt-BR) vale o mesmo que ponto.
  assert.equal(rowMatchesRules(linha, rule("hook", "<", "0,5"), CTX), true);
});

/* ------------------------------------------------------------------ *
 * Regex
 * ------------------------------------------------------------------ */

test("regex casa alternativa — o 'X ou Y' que motivou tudo isto", () => {
  const bf = { ad_name: "Hook_v3 | BF_2026" };
  const ct = { ad_name: "Hook_v3 | CT_2026" };
  const outro = { ad_name: "Hook_v3 | Sempre_On" };
  const r = rule("ad_name", "matches_regex", "BF|CT");
  assert.equal(rowMatchesRules(bf, r, CTX), true);
  assert.equal(rowMatchesRules(ct, r, CTX), true);
  assert.equal(rowMatchesRules(outro, r, CTX), false);
});

test("regex é case-insensitive, como os outros operadores de texto", () => {
  assert.equal(rowMatchesRules({ ad_name: "banner bf" }, rule("ad_name", "matches_regex", "BF"), CTX), true);
});

test("regex inválida ou gigante IGNORA a condição — nunca derruba a tela", () => {
  const linha = { ad_name: "Hook_v3" };
  // O usuário digita "(" a caminho de "(BF|CT)": a tela não pode quebrar no meio.
  assert.equal(rowMatchesRules(linha, rule("ad_name", "matches_regex", "("), CTX), true);
  assert.equal(rowMatchesRules(linha, rule("ad_name", "matches_regex", "[a-"), CTX), true);
  assert.equal(rowMatchesRules(linha, rule("ad_name", "matches_regex", "a".repeat(201)), CTX), true);
  // No limite ainda vale.
  assert.equal(rowMatchesRules({ ad_name: "a".repeat(200) }, rule("ad_name", "matches_regex", "a".repeat(200)), CTX), true);
});

test("regex inválida dentro de um E não derruba as outras condições", () => {
  const tree: RuleTree = {
    logic: "AND",
    conditions: [
      { id: "a", type: "condition", field: "ad_name", operator: "matches_regex", value: "(" },
      { id: "b", type: "condition", field: "spend", operator: ">", value: "100" },
    ],
  };
  assert.equal(rowMatchesRules({ ad_name: "X", spend: 300 }, tree, CTX), true);
  assert.equal(rowMatchesRules({ ad_name: "X", spend: 50 }, tree, CTX), false);
});

/* ------------------------------------------------------------------ *
 * Texto vazio
 * ------------------------------------------------------------------ */

test("'nome está vazio' encontra linha sem nome, e espaço em branco conta como vazio", () => {
  assert.equal(rowMatchesRules({ ad_name: "" }, rule("ad_name", "is_empty"), CTX), true);
  assert.equal(rowMatchesRules({ ad_name: "   " }, rule("ad_name", "is_empty"), CTX), true);
  assert.equal(rowMatchesRules({}, rule("ad_name", "is_empty"), CTX), true);
  assert.equal(rowMatchesRules({ ad_name: "Hook" }, rule("ad_name", "is_empty"), CTX), false);
  assert.equal(rowMatchesRules({ ad_name: "Hook" }, rule("ad_name", "is_not_empty"), CTX), true);
});

/* ------------------------------------------------------------------ *
 * Data vazia
 * ------------------------------------------------------------------ */

test("'criado em está vazio' encontra o ad não ressincronizado desde a migration 115", () => {
  const semData = { ad_name: "X", meta_created_time: null };
  assert.equal(rowMatchesRules(semData, rule("meta_created_time", "is_empty"), CTX), true);
  assert.equal(rowMatchesRules(semData, rule("meta_created_time", "is_not_empty"), CTX), false);
  // E segue fora de qualquer recorte temporal, nas duas direções.
  assert.equal(rowMatchesRules(semData, rule("meta_created_time", ">=", "2020-01-01"), CTX), false);
  assert.equal(rowMatchesRules(semData, rule("meta_created_time", "<=", "2030-01-01"), CTX), false);
});

/* ------------------------------------------------------------------ *
 * Campanha/conjunto: semântica "alguma" pelo dicionário de nomes
 * ------------------------------------------------------------------ */

const ESPALHADO = {
  ad_name: "Hook_v3",
  campaign_ids: ["c1", "c2"],
  adset_ids: ["a1"],
  // O nome do REPRESENTANTE — a fonte da mentira antiga.
  campaign_name: "Sempre_On",
};

const NAMES = {
  names: { campaigns: { c1: "BF_2026", c2: "Sempre_On" }, adsets: { a1: "Conjunto Frio" } },
  actionType: "lead",
};

test("criativo que roda em 2 campanhas casa por QUALQUER uma delas", () => {
  // ANTES: o filtro lia `campaign_name` = "Sempre_On" (o representante) e este
  // criativo NÃO aparecia em "campanha contém BF", embora rodasse na Black Friday.
  assert.equal(rowMatchesRules(ESPALHADO, rule("campaign_name", "contains", "BF"), NAMES), true);
  assert.equal(rowMatchesRules(ESPALHADO, rule("campaign_name", "contains", "Sempre"), NAMES), true);
  assert.equal(rowMatchesRules(ESPALHADO, rule("campaign_name", "contains", "Natal"), NAMES), false);
  assert.equal(rowMatchesRules(ESPALHADO, rule("adset_name", "contains", "Frio"), NAMES), true);
});

test("negativo pede TODAS: 'não contém BF' é falso se ALGUMA campanha contém", () => {
  assert.equal(rowMatchesRules(ESPALHADO, rule("campaign_name", "not_contains", "BF"), NAMES), false);
  assert.equal(rowMatchesRules(ESPALHADO, rule("campaign_name", "not_contains", "Natal"), NAMES), true);
});

test("sem o dicionário, a condição de nome é IGNORADA — nunca respondida pelo representante", () => {
  // É a diferença entre "não sei" e "não". Responder pelo representante seria
  // reintroduzir exatamente a mentira que a mudança veio consertar.
  assert.equal(rowMatchesRules(ESPALHADO, rule("campaign_name", "contains", "BF"), CTX), true);
  assert.equal(rowMatchesRules(ESPALHADO, rule("campaign_name", "contains", "Natal"), CTX), true);
});

test("campanha por id usa 'é alguma de', como Pack e Conta", () => {
  assert.equal(rowMatchesRules(ESPALHADO, rule("campaign_ids", "has_any", ["c1"]), NAMES), true);
  assert.equal(rowMatchesRules(ESPALHADO, rule("campaign_ids", "has_none", ["c1"]), NAMES), false);
  assert.equal(rowMatchesRules(ESPALHADO, rule("campaign_ids", "has_any", ["c9"]), NAMES), false);
});

test("regex também vale sobre os nomes multivalorados", () => {
  assert.equal(rowMatchesRules(ESPALHADO, rule("campaign_name", "matches_regex", "^BF"), NAMES), true);
  assert.equal(rowMatchesRules(ESPALHADO, rule("campaign_name", "matches_regex", "^Natal"), NAMES), false);
});

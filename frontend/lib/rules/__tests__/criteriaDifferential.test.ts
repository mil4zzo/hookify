/**
 * DIFERENCIAL DA FASE 4 — Critério de validação: motor único × avaliador congelado.
 *
 * O QUE O CRITÉRIO DECIDE, NA PRÁTICA
 *   "A partir de quando um anúncio já tem amostra suficiente para ser julgado."
 *   Quem não atende fica de fora do G.O.L.D., do plano de ação e das oportunidades —
 *   é o portão de entrada de três telas. Um critério que rejeita quem deveria passar
 *   não dá erro: as telas simplesmente ficam vazias, e isso se lê como "não tenho
 *   anúncio bom", não como "meu critério está quebrado".
 *
 * POR QUE O DIFERENCIAL É CONTRA A CÓPIA CONGELADA
 *   `lib/utils/validateAdCriteria.ts` foi apagado nesta fase.
 *   `reference/legacyEvaluators.ts` é o registro do que ele fazia, e era cópia
 *   comprovadamente literal enquanto os dois coexistiam.
 *
 * AS DIVERGÊNCIAS SÃO INTENCIONAIS E ESTÃO LISTADAS UMA A UMA ABAIXO.
 * O que não estiver nesta lista é regressão.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { rowMatchesRules } from "@/lib/rules/evaluate";
import { getAvailableRuleFields } from "@/lib/rules/fields";
import { countRestrictiveConditions } from "@/lib/rules/restrictive";
import { normalizeRuleTree, type RuleTree } from "@/lib/rules/types";
import { evaluateCondition, LEGACY_DEAD_FIELDS, LEGACY_FIELD_TYPES } from "./reference/legacyEvaluators";

/** Uma linha da RPC como o pipeline a entrega — sem mapper no meio. */
const LINHA = {
  ad_name: "BF_2026",
  ad_id: "123",
  account_id: "act_9",
  account_ids: ["act_9"],
  impressions: 40000,
  reach: 20000,
  frequency: 2,
  clicks: 800,
  inline_link_clicks: 600,
  spend: 300,
  lpv: 400,
  plays: 12000,
  video_total_thruplays: 3000,
  hook: 0.3,
  hold_rate: 0.12,
  scroll_stop: 0.4,
  video_watched_p50: 8,
  video_watched_p75: 5,
  ctr: 0.02,
  website_ctr: 0.015,
  connect_rate: 0.66,
  cpm: 7.5,
  cpc: 0.375,
  cplc: 0.5,
  conversions: { "action:purchase": 20 },
};

function rule(field: string, operator: string, value: unknown): RuleTree {
  return { logic: "AND", conditions: [{ id: "c1", type: "condition", field, operator, value: value as any }] };
}

const CRITERIA_FIELDS = getAvailableRuleFields({ context: "criteria" });
const CRITERIA_FIELD_IDS = new Set(CRITERIA_FIELDS.map((field) => field.id));

/* ------------------------------------------------------------------ *
 * 1. O bug central: 11 campos que rejeitavam TODO anúncio
 * ------------------------------------------------------------------ */

test("congelado: os 11 campos mortos rejeitam todo anúncio, mesmo com o dado na linha", () => {
  // Prova que o problema era do MAPPER, não do avaliador: a linha tem reach,
  // frequency, video_watched_p50 — e o critério rejeitava assim mesmo, porque
  // `buildAdMetricsData` não copiava esses campos e "ausente" devolvia false.
  assert.equal(LEGACY_DEAD_FIELDS.length, 11);
  for (const field of LEGACY_DEAD_FIELDS) {
    for (const operator of ["GREATER_THAN", "LESS_THAN", "EQUAL", "CONTAIN"]) {
      for (const value of ["0", "1", "BF"]) {
        assert.equal(
          evaluateCondition({ field, operator, value }, {}, LEGACY_FIELD_TYPES[field]),
          false,
          `${field} ${operator} "${value}" deveria rejeitar no congelado`,
        );
      }
    }
  }
});

test("DIVERGE (de propósito): reach, frequency e retenção viram métrica de verdade", () => {
  // Os três estão no registry E respondem sobre a linha. No congelado, qualquer
  // pergunta sobre eles rejeitava o anúncio.
  const vivos: [string, string, number, boolean][] = [
    ["reach", ">", 10000, true],
    ["reach", ">", 30000, false],
    ["frequency", ">", 1.5, true],
    ["frequency", ">", 5, false],
    ["video_watched_p50", ">", 5, true],
    ["video_watched_p50", ">", 20, false],
    ["plays", ">", 1000, true],
    ["thruplays", ">", 1000, true],
    ["thruplays", ">", 9000, false],
  ];
  for (const [field, operator, value, esperado] of vivos) {
    assert.ok(CRITERIA_FIELD_IDS.has(field), `${field} deveria ser oferecido no Critério`);
    assert.equal(rowMatchesRules(LINHA, rule(field, operator, value)), esperado, `${field} ${operator} ${value}`);
  }
});

test("nenhum campo de métrica oferecido no Critério rejeita esta linha por ausência de dado", () => {
  // A rede contra o bug voltar: se um campo entrar no seletor sem chegar na linha,
  // ele volta a ser "opção de menu que zera a tela". `is_not_empty` é a pergunta
  // exata "esta linha tem esse dado?". `results`/`cpr`/`page_conv` dependem do
  // tipo de conversão escolhido, que é sempre passado no contexto.
  const semDadoNaLinha: string[] = [];
  for (const field of CRITERIA_FIELDS) {
    if (field.kind !== "metric") continue;
    if (!rowMatchesRules(LINHA, rule(field.id, "is_not_empty", null), { actionType: "action:purchase" })) {
      semDadoNaLinha.push(field.id);
    }
  }
  assert.deepEqual(semDadoNaLinha, [], `campos oferecidos mas sem dado na linha: ${semDadoNaLinha.join(", ")}`);
});

test("métricas de conversão respondem quando o tipo de conversão está escolhido", () => {
  const ctx = { actionType: "action:purchase" };
  assert.equal(rowMatchesRules(LINHA, rule("results", ">", 10), ctx), true);
  assert.equal(rowMatchesRules(LINHA, rule("cpr", "<", 20), ctx), true, "300 / 20 = 15");
  assert.equal(rowMatchesRules(LINHA, rule("cpr", "<", 10), ctx), false);
  // page_conv = 20 / 400 = 5%. É `ratioPercent`: o usuário digita 4, não 0,04.
  assert.equal(rowMatchesRules(LINHA, rule("page_conv", ">", 4), ctx), true);
  assert.equal(rowMatchesRules(LINHA, rule("page_conv", ">", 6), ctx), false);
});

test("hook e page_conv passam a ser OFERECIDOS — a outra metade do bug", () => {
  // Funcionavam no avaliador antigo, mas não existiam no dropdown: ninguém
  // conseguia escrever o critério mais óbvio de todos ("hook decente").
  for (const field of ["hook", "hold_rate", "page_conv", "scroll_stop", "video_watched_p75"]) {
    assert.equal(LEGACY_FIELD_TYPES[field], undefined, `${field} não estava no registry antigo`);
    assert.ok(CRITERIA_FIELD_IDS.has(field), `${field} deveria ser oferecido agora`);
  }
});

test("o Critério ganha as dimensões que só o Manager e o Boards tinham", () => {
  for (const field of ["tags", "status", "meta_created_time", "pack_ids", "account_ids", "ad_id", "ad_name"]) {
    assert.ok(CRITERIA_FIELD_IDS.has(field), `${field} deveria ser oferecido no Critério`);
  }
});

test("métricas de MQL só aparecem com planilha — sem ela viriam sempre zeradas", () => {
  const semPlanilha = new Set(getAvailableRuleFields({ context: "criteria" }).map((f) => f.id));
  const comPlanilha = new Set(getAvailableRuleFields({ context: "criteria", hasSheetIntegration: true }).map((f) => f.id));
  for (const field of ["cpmql", "mqls", "leadscore_avg", "mql_rate"]) {
    assert.equal(semPlanilha.has(field), false, `${field} não deveria aparecer sem planilha`);
    assert.equal(comPlanilha.has(field), true, `${field} deveria aparecer com planilha`);
  }
});

/* ------------------------------------------------------------------ *
 * 2. Escala de porcentagem — a divergência que muda número gravado
 * ------------------------------------------------------------------ */

test("DIVERGE (de propósito): porcentagem agora é a escala que se digita", () => {
  // Linha com CTR de 2%. No congelado o usuário tinha de escrever `0.02` (a escala
  // interna, 0-1); no Boards, `2`; nas linhas-filhas do Manager, depende. Agora é
  // uma só: `2` significa 2%, em toda tela.
  assert.equal(
    evaluateCondition({ field: "ctr", operator: "GREATER_THAN", value: "0.01" }, LINHA, "numeric"),
    true,
    "congelado: 0.02 > 0.01",
  );
  assert.equal(
    evaluateCondition({ field: "ctr", operator: "GREATER_THAN", value: "1" }, LINHA, "numeric"),
    false,
    "congelado: 0.02 > 1 é falso — escrever `1` querendo 1% não funcionava",
  );

  assert.equal(rowMatchesRules(LINHA, rule("ctr", ">", 1)), true, "novo: 2% > 1%");
  assert.equal(rowMatchesRules(LINHA, rule("ctr", ">", 3)), false, "novo: 2% > 3% é falso");
  // E o caso que a heurística `> 1` das linhas-filhas errava:
  assert.equal(rowMatchesRules({ ...LINHA, ctr: 0.002 }, rule("ctr", "<", 0.5)), true, "0,2% < 0,5%");
});

test("métrica de CONTAGEM não muda de escala — 3000 continua sendo 3000", () => {
  // É o critério que a fase 4 gravou para todo mundo; se `impressions` tivesse
  // virado porcentagem por engano, ele deixaria passar qualquer anúncio.
  assert.equal(rowMatchesRules(LINHA, rule("impressions", ">", 3000)), true);
  assert.equal(rowMatchesRules({ ...LINHA, impressions: 2000 }, rule("impressions", ">", 3000)), false);
  assert.equal(rowMatchesRules({ ...LINHA, impressions: 3000 }, rule("impressions", ">", 3000)), false, "corte é estrito");
});

/* ------------------------------------------------------------------ *
 * 3. "Sem dado" — a divergência que muda quem entra
 * ------------------------------------------------------------------ */

test("DIVERGE (de propósito): anúncio de imagem não passa mais por critério de vídeo", () => {
  // A RPC devolve hook = 0 para um estático (não houve vídeo). No congelado esse
  // zero fabricado satisfazia qualquer "menor que", então um critério como
  // "hook < 5%" (usado para separar criativo fraco) arrastava TODO estático junto.
  const imagem = { ...LINHA, media_type: "image", plays: 0, hook: 0, hold_rate: 0 };

  assert.equal(
    evaluateCondition({ field: "hook", operator: "LESS_THAN", value: "5" }, imagem, "numeric"),
    true,
    "congelado: 0 < 5",
  );
  assert.equal(rowMatchesRules(imagem, rule("hook", "<", 5)), false, "novo: sem dado não casa");
  assert.equal(rowMatchesRules(imagem, rule("hook", ">=", 5)), false, "nem com a contrária");
  assert.equal(rowMatchesRules(imagem, rule("hook", "is_empty", null)), true, "é assim que se pede essas linhas");

  // O que NÃO muda: contagem zero continua sendo zero de verdade.
  assert.equal(rowMatchesRules(imagem, rule("plays", "=", 0)), true);
});

test("DIVERGE (de propósito): anúncio sem conversão não passa em critério de CPR", () => {
  const semConversao = { ...LINHA, conversions: {} };
  assert.equal(rowMatchesRules(semConversao, rule("cpr", "<", 50), { actionType: "action:purchase" }), false);
  assert.equal(rowMatchesRules(semConversao, rule("cpr", "is_empty", null), { actionType: "action:purchase" }), true);
});

/* ------------------------------------------------------------------ *
 * 4. O que NÃO diverge: a lógica que o Critério já tinha
 * ------------------------------------------------------------------ */

test("critério vazio não restringe — todo anúncio é elegível", () => {
  assert.equal(rowMatchesRules(LINHA, { logic: "AND", conditions: [] }), true);
});

test("E no topo: uma condição falha derruba o critério", () => {
  const criterio: RuleTree = {
    logic: "AND",
    conditions: [
      { id: "a", type: "condition", field: "impressions", operator: ">", value: 3000 },
      { id: "b", type: "condition", field: "spend", operator: ">", value: 9999 },
    ],
  };
  assert.equal(rowMatchesRules(LINHA, criterio), false);
});

test("OU no topo: uma condição basta — e agora é nativo, não um campo `logic` carimbado nó a nó", () => {
  const criterio: RuleTree = {
    logic: "OR",
    conditions: [
      { id: "a", type: "condition", field: "impressions", operator: ">", value: 3000 },
      { id: "b", type: "condition", field: "spend", operator: ">", value: 9999 },
    ],
  };
  assert.equal(rowMatchesRules(LINHA, criterio), true);
});

test("a lógica do subgrupo é dele — não desce do topo", () => {
  const criterio: RuleTree = {
    logic: "AND",
    conditions: [
      { id: "a", type: "condition", field: "ad_name", operator: "contains", value: "BF" },
      {
        id: "g1",
        type: "group",
        logic: "OR",
        conditions: [
          { id: "b", type: "condition", field: "spend", operator: ">", value: 9999 },
          { id: "c", type: "condition", field: "ctr", operator: ">", value: 1 },
        ],
      },
    ],
  };
  assert.equal(rowMatchesRules(LINHA, criterio), true, "topo E, subgrupo OU: o OU interno salva");

  const soFalhas: RuleTree = {
    logic: "AND",
    conditions: [
      criterio.conditions[0],
      {
        id: "g1",
        type: "group",
        logic: "OR",
        conditions: [{ id: "b", type: "condition", field: "spend", operator: ">", value: 9999 }],
      },
    ],
  };
  assert.equal(rowMatchesRules(LINHA, soFalhas), false);
});

test("o critério sobrevive ao round-trip por JSON — é o que vai para o jsonb", () => {
  const criterio: RuleTree = {
    logic: "OR",
    conditions: [{ id: "a", type: "condition", field: "impressions", operator: ">", value: 3000 }],
  };
  const doBanco = normalizeRuleTree(JSON.parse(JSON.stringify(criterio)));
  assert.equal(doBanco.logic, "OR");
  assert.equal(rowMatchesRules(LINHA, doBanco), true);
});

/* ------------------------------------------------------------------ *
 * 5. O formato antigo no banco: sem reinterpretação
 * ------------------------------------------------------------------ */

test("critério no formato ANTIGO (array) vira árvore VAZIA, não uma tradução chutada", () => {
  // `ctr GREATER_THAN 0.02` significava 2% na escala antiga e significaria 0,02%
  // na nova. Traduzir automaticamente exigiria adivinhar a intenção métrica a
  // métrica; a migration 135 reescreve todo mundo como "impressões > 3000" e o
  // que sobrar cai aqui — "sem critério", nunca um critério errado em silêncio.
  const antigo = [{ id: "a", type: "condition", field: "ctr", operator: "GREATER_THAN", value: "0.02" }];
  const normalizado = normalizeRuleTree(antigo);
  assert.deepEqual(normalizado.conditions, []);
  assert.equal(countRestrictiveConditions(normalizado), 0);
  assert.equal(rowMatchesRules(LINHA, normalizado), true, "sem critério = todo anúncio elegível");
});

test("o critério que a migration gravou é restritivo — o onboarding depende disso", () => {
  // `countRestrictiveConditions` é o que libera o botão "Próximo" e o que o
  // backend espelha em `validation_criteria_configured`.
  const gravado = normalizeRuleTree({
    logic: "AND",
    conditions: [{ id: "seed_impressions", type: "condition", field: "impressions", operator: ">", value: 3000 }],
  });
  assert.equal(countRestrictiveConditions(gravado), 1);
  assert.equal(rowMatchesRules(LINHA, gravado), true);
});

test("condição em branco não conta como critério configurado", () => {
  const emBranco = normalizeRuleTree({
    logic: "AND",
    conditions: [{ id: "a", type: "condition", field: "impressions", operator: ">", value: "" }],
  });
  assert.equal(countRestrictiveConditions(emBranco), 0);
  assert.equal(rowMatchesRules(LINHA, emBranco), true, "e não restringe nada");
});

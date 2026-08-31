/**
 * FASE 5 — filtrar por campanha e conjunto sem a mentira do representante.
 *
 * O QUE ESTAVA ERRADO
 *   A linha agregada por criativo colapsa dezenas de anúncios. Até a migration 136
 *   ela só carregava `campaign_name` do REPRESENTANTE (o anúncio de maior entrega).
 *   "Me mostre os criativos da campanha X" escondia todo criativo cuja maior
 *   entrega estivesse em outra campanha — 22% deles, medido no laboratório.
 *   E não dava erro: a linha simplesmente sumia da tabela.
 *
 * O QUE A LINHA TRAZ AGORA
 *   `campaign_ids`/`adset_ids` — TODOS os pais do grupo — e a resposta traz um
 *   dicionário `id → nome` na raiz. O nome não viaja por linha porque com ~7,5
 *   campanhas por criativo ele apareceria milhares de vezes.
 *
 * AS DUAS LINHAS, AS DUAS FONTES
 *   Agregada: ids + dicionário. Filha: é UM anúncio e traz o nome dela mesma,
 *   exato. O avaliador separa os casos por `Array.isArray(campaign_ids)`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { rowMatchesRules } from "@/lib/rules/evaluate";
import { getAvailableRuleFields, getRuleField } from "@/lib/rules/fields";
import type { RuleTree } from "@/lib/rules/types";

/** Linha agregada: um criativo que roda em três campanhas e quatro conjuntos. */
const AGREGADA = {
  ad_name: "BF_2026_v3",
  impressions: 40000,
  spend: 300,
  // O representante é a campanha de Retargeting — a que mais entregou.
  campaign_id: "c_retarget",
  campaign_name: "Retargeting | Sempre On",
  adset_id: "a_retarget_lal1",
  adset_name: "LAL 1% compradores",
  campaign_ids: ["c_retarget", "c_bf", "c_prospect"],
  adset_ids: ["a_retarget_lal1", "a_bf_frio", "a_bf_quente", "a_prospect_amplo"],
};

const NOMES = {
  campaigns: {
    c_retarget: "Retargeting | Sempre On",
    c_bf: "BLACK FRIDAY 2026",
    c_prospect: "Prospecção Fria",
  },
  adsets: {
    a_retarget_lal1: "LAL 1% compradores",
    a_bf_frio: "BF | Público frio",
    a_bf_quente: "BF | Quente",
    a_prospect_amplo: "Amplo 18-65",
  },
};

/** Linha-filha: UM anúncio. Não tem os arrays; tem o próprio nome. */
const FILHA = {
  ad_id: "1234",
  ad_name: "BF_2026_v3",
  impressions: 900,
  spend: 12,
  campaign_name: "BLACK FRIDAY 2026",
  adset_name: "BF | Público frio",
};

function rule(field: string, operator: string, value: unknown): RuleTree {
  return { logic: "AND", conditions: [{ id: "c1", type: "condition", field, operator, value: value as any }] };
}

const CTX = { names: NOMES };

/* ------------------------------------------------------------------ *
 * 1. O caso que motivou a fase
 * ------------------------------------------------------------------ */

test("o criativo aparece pela campanha em que ele NÃO tem a maior entrega", () => {
  // Este é o teste inteiro da fase 5 numa linha: "BLACK FRIDAY" não é a campanha
  // do representante, e antes da 136 este criativo sumia do filtro.
  assert.equal(rowMatchesRules(AGREGADA, rule("campaign_name", "contains", "BLACK FRIDAY"), CTX), true);
  assert.equal(rowMatchesRules(AGREGADA, rule("campaign_name", "contains", "Prospec"), CTX), true);
  // E continua aparecendo pela do representante.
  assert.equal(rowMatchesRules(AGREGADA, rule("campaign_name", "contains", "Retargeting"), CTX), true);
  // Campanha que ele não tem: fora.
  assert.equal(rowMatchesRules(AGREGADA, rule("campaign_name", "contains", "Natal"), CTX), false);
});

test("conjunto segue a mesma regra de ALGUM", () => {
  assert.equal(rowMatchesRules(AGREGADA, rule("adset_name", "contains", "Público frio"), CTX), true);
  assert.equal(rowMatchesRules(AGREGADA, rule("adset_name", "starts_with", "Amplo"), CTX), true);
  assert.equal(rowMatchesRules(AGREGADA, rule("adset_name", "contains", "Instagram"), CTX), false);
});

test("o NEGATIVO pede TODOS, não algum", () => {
  // "nenhuma campanha do criativo contém BF" só é verdade se nenhuma contiver.
  // Se fosse "algum", a linha passaria por causa de Retargeting e o usuário veria
  // exatamente o que pediu para esconder.
  assert.equal(rowMatchesRules(AGREGADA, rule("campaign_name", "not_contains", "BLACK"), CTX), false);
  assert.equal(rowMatchesRules(AGREGADA, rule("campaign_name", "not_contains", "Natal"), CTX), true);
  assert.equal(rowMatchesRules(AGREGADA, rule("campaign_name", "not_equals", "Prospecção Fria"), CTX), false);
});

test("regex vale sobre o conjunto de nomes", () => {
  assert.equal(rowMatchesRules(AGREGADA, rule("campaign_name", "matches_regex", "^BLACK|^Natal"), CTX), true);
  assert.equal(rowMatchesRules(AGREGADA, rule("campaign_name", "matches_regex", "^Natal"), CTX), false);
});

/* ------------------------------------------------------------------ *
 * 2. Escolher da lista: "é alguma de"
 * ------------------------------------------------------------------ */

test("campanha por id: é alguma de / não é nenhuma de", () => {
  assert.equal(rowMatchesRules(AGREGADA, rule("campaign_ids", "has_any", ["c_bf"]), CTX), true);
  assert.equal(rowMatchesRules(AGREGADA, rule("campaign_ids", "has_any", ["c_natal"]), CTX), false);
  assert.equal(rowMatchesRules(AGREGADA, rule("campaign_ids", "has_any", ["c_natal", "c_prospect"]), CTX), true);
  assert.equal(rowMatchesRules(AGREGADA, rule("campaign_ids", "has_none", ["c_bf"]), CTX), false);
  assert.equal(rowMatchesRules(AGREGADA, rule("campaign_ids", "has_none", ["c_natal"]), CTX), true);
  // Lista vazia é pergunta em branco: não restringe.
  assert.equal(rowMatchesRules(AGREGADA, rule("campaign_ids", "has_any", []), CTX), true);
});

test("id não depende do dicionário — escolher da lista funciona sem nomes", () => {
  // O dicionário rotula a opção; a comparação é sobre o id. Uma campanha cujo
  // nome não veio (anúncio sem `campaign_name` em `ads`) ainda pode ser filtrada.
  assert.equal(rowMatchesRules(AGREGADA, rule("campaign_ids", "has_any", ["c_bf"]), {}), true);
});

/* ------------------------------------------------------------------ *
 * 3. Sem dicionário: ignorar, nunca responder com o representante
 * ------------------------------------------------------------------ */

test("linha agregada SEM dicionário: a condição de nome é ignorada", () => {
  // Acontece com uma resposta antiga em cache, ou antes da migration chegar.
  // A alternativa — cair no `campaign_name` do representante — é exatamente a
  // mentira que a fase veio corrigir, e seria pior: silenciosa e parcialmente certa.
  assert.equal(rowMatchesRules(AGREGADA, rule("campaign_name", "contains", "BLACK FRIDAY"), {}), true);
  assert.equal(rowMatchesRules(AGREGADA, rule("campaign_name", "contains", "Natal"), {}), true);
});

test("dicionário sem a chave da linha: os ids sem nome somem do conjunto", () => {
  const parcial = { names: { campaigns: { c_bf: "BLACK FRIDAY 2026" } } };
  assert.equal(rowMatchesRules(AGREGADA, rule("campaign_name", "contains", "BLACK"), parcial), true);
  // "Retargeting" não tem nome neste dicionário: não há o que casar.
  assert.equal(rowMatchesRules(AGREGADA, rule("campaign_name", "contains", "Retargeting"), parcial), false);
});

/* ------------------------------------------------------------------ *
 * 4. A linha-filha: nome próprio, exato
 * ------------------------------------------------------------------ */

test("linha-filha usa o próprio nome, sem dicionário nenhum", () => {
  // A RPC de detalhe devolve `campaign_name` da filha, que é UM anúncio: o nome é
  // exato, não representa ninguém. Exigir dicionário aqui deixaria o filtro de
  // campanha da visão expandida sempre ligado sem efeito.
  assert.equal(rowMatchesRules(FILHA, rule("campaign_name", "contains", "BLACK"), {}), true);
  assert.equal(rowMatchesRules(FILHA, rule("campaign_name", "contains", "Retargeting"), {}), false);
  assert.equal(rowMatchesRules(FILHA, rule("adset_name", "contains", "frio"), {}), true);
  assert.equal(rowMatchesRules(FILHA, rule("campaign_name", "is_empty", null), {}), false);
});

test("filha sem o campo: está vazio", () => {
  const semNome = { ad_id: "9", impressions: 10 };
  assert.equal(rowMatchesRules(semNome, rule("campaign_name", "is_empty", null), {}), true);
  assert.equal(rowMatchesRules(semNome, rule("campaign_name", "contains", "BF"), {}), false);
});

/* ------------------------------------------------------------------ *
 * 5. Onde cada campo é oferecido
 * ------------------------------------------------------------------ */

test("id na linha agregada; nome em toda parte, inclusive nas filhas", () => {
  const idsDe = (context: any) => getAvailableRuleFields({ context, hasSheetIntegration: true }).map((f) => f.id);
  for (const field of ["campaign_ids", "adset_ids"]) {
    assert.ok(idsDe("manager").includes(field));
    assert.ok(idsDe("boards").includes(field));
    // Nem no Critério nem nas filhas: escolher da lista exige uma LISTA, e ela sai
    // das linhas do recorte. As Configurações não têm recorte; a filha é um anúncio
    // só e a RPC de detalhe devolve o nome, não o id. Ali a pergunta é por nome.
    assert.ok(!idsDe("criteria").includes(field), `${field} não tem lista nas Configurações`);
    assert.ok(!idsDe("manager-children").includes(field), `${field} não cabe na linha-filha`);
  }
  for (const field of ["campaign_name", "adset_name"]) {
    for (const context of ["manager", "manager-children", "boards", "criteria"]) {
      assert.ok(idsDe(context).includes(field), `${field} deveria existir em ${context}`);
    }
  }
});

test("os quatro campos estão no grupo Procedência, junto de Pack e Conta", () => {
  for (const field of ["campaign_ids", "adset_ids", "campaign_name", "adset_name", "pack_ids", "account_ids"]) {
    assert.equal(getRuleField(field)?.group, "Procedência", `${field} fora do grupo`);
  }
});

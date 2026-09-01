/**
 * Status com os quatro rótulos do Meta, e "quantos anúncios ativos".
 *
 * O QUE ACONTECEU
 *   O filtro de status do Manager tinha quatro caixas de marcar — Ativo, Pausado,
 *   Pausado (Conjunto), Pausado (Campanha) — e a unificação dos filtros (2026-08-30)
 *   as colapsou em dois operadores booleanos. Havia motivo para metade dos casos: nas
 *   abas que agregam, comparar com o status do REPRESENTANTE mente. Mas a saída jogou
 *   fora uma pergunta legítima — "está parado porque EU parei, ou porque o pai está
 *   parado?" — e um filtro numérico inteiro ("criativos com mais de 3 anúncios
 *   ativos"), que eu registrei no plano como se `is_active` o substituísse. Não
 *   substitui: `is_active` é "≥ 1", o outro é qualquer corte.
 *
 * O CONTRATO POR ABA (acordado com o idealizador)
 *   Anúncios, Conjuntos, Campanhas → o status PURO da entidade. Sem agregação.
 *   Criativos → única aba que agrega: ativo se ALGUM anúncio está ativo; se nenhum
 *   está, casa com CADA motivo presente.
 *
 *   Quem decide qual leitura usar é o DADO, não um parâmetro: a RPC manda os
 *   contadores por motivo só nas abas que agregam anúncios (migration 138).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { rowMatchesRules } from "@/lib/rules/evaluate";
import { getAvailableRuleFields, getRuleField } from "@/lib/rules/fields";
import type { RuleTree } from "@/lib/rules/types";

function rule(field: string, operator: string, value: unknown): RuleTree {
  return { logic: "AND", conditions: [{ id: "c1", type: "condition", field, operator, value: value as any }] };
}

const status = (...valores: string[]) => rule("status", "has_any", valores);
const semStatus = (...valores: string[]) => rule("status", "has_none", valores);

/* ------------------------------------------------------------------ *
 * 1. Linha que É a entidade: status puro, sem agregação
 * ------------------------------------------------------------------ */

test("aba Anúncios: o status do próprio anúncio, exato", () => {
  // A RPC manda contadores nesta aba, mas eles degeneram para um anúncio só —
  // e a resposta bate com o `effective_status` dele.
  const pausadoPelaCampanha = {
    effective_status: "CAMPAIGN_PAUSED",
    active_count: 0,
    paused_self_count: 0,
    adset_paused_count: 0,
    campaign_paused_count: 1,
  };
  assert.equal(rowMatchesRules(pausadoPelaCampanha, status("CAMPAIGN_PAUSED")), true);
  assert.equal(rowMatchesRules(pausadoPelaCampanha, status("PAUSED")), false);
  assert.equal(rowMatchesRules(pausadoPelaCampanha, status("ADSET_PAUSED")), false);
  assert.equal(rowMatchesRules(pausadoPelaCampanha, status("ACTIVE")), false);
  // Marcar mais de uma caixa é "ou".
  assert.equal(rowMatchesRules(pausadoPelaCampanha, status("ACTIVE", "CAMPAIGN_PAUSED")), true);
});

test("aba Conjuntos: o estado do CONJUNTO, não o dos anúncios dele", () => {
  // Um conjunto pausado tem todos os anúncios em ADSET_PAUSED. Se a tela lesse os
  // anúncios, ele apareceria como "Pausado (Conjunto)" — resposta certa para o
  // anúncio e errada para o conjunto, que está simplesmente pausado. Por isso a RPC
  // NÃO manda contadores aqui, e a ausência é o sinal.
  const conjuntoPausado = { effective_status: "PAUSED", active_count: 0 };
  assert.equal(rowMatchesRules(conjuntoPausado, status("PAUSED")), true);
  assert.equal(rowMatchesRules(conjuntoPausado, status("ADSET_PAUSED")), false);

  // Conjunto ativo cujos anúncios estão todos pausados: o conjunto está ATIVO.
  const conjuntoAtivoSemAnuncio = { effective_status: "ACTIVE", active_count: 0 };
  assert.equal(rowMatchesRules(conjuntoAtivoSemAnuncio, status("ACTIVE")), true);
  assert.equal(rowMatchesRules(conjuntoAtivoSemAnuncio, status("PAUSED")), false);
});

test("aba Campanhas: sem contagem de ativos, cai no status da própria campanha", () => {
  // A RPC devolve `active_count: null` para campanhas.
  const campanha = { effective_status: "PAUSED", active_count: null };
  assert.equal(rowMatchesRules(campanha, status("PAUSED")), true);
  assert.equal(rowMatchesRules(campanha, status("ACTIVE")), false);
});

test("linha-filha: um anúncio, status exato, sem contadores", () => {
  const filha = { ad_id: "1", effective_status: "ADSET_PAUSED" };
  assert.equal(rowMatchesRules(filha, status("ADSET_PAUSED")), true);
  assert.equal(rowMatchesRules(filha, status("PAUSED")), false);
});

/* ------------------------------------------------------------------ *
 * 2. Aba Criativos: a única que agrega
 * ------------------------------------------------------------------ */

test("ativo é ALGUM ativo — mesmo com o representante pausado", () => {
  // Era o motivo de o status ter virado `active_count` em agosto, e continua valendo:
  // `effective_status` numa linha de criativo é o motivo alfabeticamente primeiro.
  const misto = {
    effective_status: "ADSET_PAUSED",
    active_count: 2,
    paused_self_count: 5,
    adset_paused_count: 30,
    campaign_paused_count: 0,
  };
  assert.equal(rowMatchesRules(misto, status("ACTIVE")), true);
  // Com algum ativo, nenhum motivo de pausa se aplica — senão "pausado" e "ativo"
  // seriam a mesma linha e o filtro pararia de significar algo.
  assert.equal(rowMatchesRules(misto, status("PAUSED")), false);
  assert.equal(rowMatchesRules(misto, status("ADSET_PAUSED")), false);
  assert.equal(rowMatchesRules(misto, status("CAMPAIGN_PAUSED")), false);
});

test("parado: casa com CADA motivo presente, não só com o dominante", () => {
  // Medido no laboratório sobre 400 criativos: motivo MISTURADO é a regra (só 88
  // tinham todos os anúncios parados pelo mesmo motivo). Se a resposta exigisse
  // "todos compartilham", as duas opções específicas ficariam quase vazias.
  const parado = {
    effective_status: "ARCHIVED", // o lixo do min alfabético, ignorado aqui
    active_count: 0,
    paused_self_count: 1,
    adset_paused_count: 30,
    campaign_paused_count: 0,
  };
  assert.equal(rowMatchesRules(parado, status("ADSET_PAUSED")), true);
  assert.equal(rowMatchesRules(parado, status("PAUSED")), true, "1 anúncio pausado nele mesmo conta");
  assert.equal(rowMatchesRules(parado, status("CAMPAIGN_PAUSED")), false, "nenhum por campanha");
  assert.equal(rowMatchesRules(parado, status("ACTIVE")), false);
});

test("o status agregado ignora `effective_status` — que é lixo na aba de criativos", () => {
  // `fallback_status = min(effective_status)` é ordem alfabética: ACTIVE <
  // ADSET_PAUSED < ARCHIVED < CAMPAIGN_PAUSED < PAUSED. Um criativo com um único
  // anúncio arquivado aparece como ARCHIVED. Confirmado no laboratório.
  const comArquivado = {
    effective_status: "ARCHIVED",
    active_count: 0,
    paused_self_count: 0,
    adset_paused_count: 0,
    campaign_paused_count: 12,
  };
  assert.equal(rowMatchesRules(comArquivado, status("CAMPAIGN_PAUSED")), true);
  assert.equal(rowMatchesRules(comArquivado, status("ARCHIVED")), false);
});

test('"não é nenhum de" nega o conjunto inteiro', () => {
  const parado = { active_count: 0, paused_self_count: 0, adset_paused_count: 4, campaign_paused_count: 0 };
  assert.equal(rowMatchesRules(parado, semStatus("ACTIVE")), true);
  assert.equal(rowMatchesRules(parado, semStatus("ADSET_PAUSED")), false);
});

test("nada marcado é pergunta em branco: não restringe", () => {
  const qualquer = { active_count: 0, paused_self_count: 3, adset_paused_count: 0, campaign_paused_count: 0 };
  assert.equal(rowMatchesRules(qualquer, status()), true);
});

/* ------------------------------------------------------------------ *
 * 3. Compatibilidade: as regras salvas na versão booleana
 * ------------------------------------------------------------------ */

test("`is_active` / `is_paused` de uma regra salva continuam valendo", () => {
  // Board e Critério guardam a regra no banco. Mudar o significado de uma regra
  // gravada é pior do que carregar dois apelidos no avaliador.
  const ativo = { active_count: 2, paused_self_count: 0, adset_paused_count: 1, campaign_paused_count: 0 };
  const parado = { active_count: 0, paused_self_count: 0, adset_paused_count: 3, campaign_paused_count: 0 };
  assert.equal(rowMatchesRules(ativo, rule("status", "is_active", null)), true);
  assert.equal(rowMatchesRules(ativo, rule("status", "is_paused", null)), false);
  assert.equal(rowMatchesRules(parado, rule("status", "is_paused", null)), true);
  assert.equal(rowMatchesRules(parado, rule("status", "is_active", null)), false);
});

test("resposta antiga em cache (sem contadores) não regride para o representante em ATIVO", () => {
  // Enquanto o cache do navegador não vira, a linha vem sem contadores. "Tem ativo"
  // continua sendo respondido por `active_count`, que é exato — e não por
  // `effective_status`, que na linha de criativo mente.
  const antiga = { active_count: 2, effective_status: "PAUSED" };
  assert.equal(rowMatchesRules(antiga, status("ACTIVE")), true);
  assert.equal(rowMatchesRules(antiga, rule("status", "is_active", null)), true);
});

/* ------------------------------------------------------------------ *
 * 4. "Anúncios ativos": o filtro numérico, com corte
 * ------------------------------------------------------------------ */

test("anúncios ativos aceita QUALQUER corte, não só maior que zero", () => {
  // É a diferença que o plano tratou como equivalência e não é: `is_active`
  // responde "≥ 1"; este campo responde "quantos".
  const criativo = { active_count: 12, ad_count: 40 };
  assert.equal(rowMatchesRules(criativo, rule("active_count", ">", 3)), true);
  assert.equal(rowMatchesRules(criativo, rule("active_count", ">", 20)), false);
  assert.equal(rowMatchesRules(criativo, rule("active_count", "<=", 12)), true);
  assert.equal(rowMatchesRules(criativo, rule("active_count", "=", 12)), true);
  assert.equal(rowMatchesRules(criativo, rule("active_count", "!=", 12)), false);
});

test("zero anúncios ativos é ZERO, não ausência", () => {
  // Contagem não tem o estado "sem dado" das métricas que são divisão: `= 0` tem de
  // encontrar os criativos totalmente parados.
  assert.equal(rowMatchesRules({ active_count: 0 }, rule("active_count", "=", 0)), true);
  assert.equal(rowMatchesRules({ active_count: 0 }, rule("active_count", ">", 0)), false);
});

test("linha sem a contagem não casa com corte nenhum", () => {
  // Aba de campanha: a RPC manda `null`. Tratar como zero diria "toda campanha tem
  // zero anúncios ativos", que é falso.
  assert.equal(rowMatchesRules({ active_count: null }, rule("active_count", "=", 0)), false);
  assert.equal(rowMatchesRules({ active_count: null }, rule("active_count", ">", 0)), false);
});

test("corte em branco não restringe", () => {
  assert.equal(rowMatchesRules({ active_count: 5 }, rule("active_count", ">", "")), true);
});

test("anúncios ativos não é métrica — não tem escala de porcentagem", () => {
  // Se caísse no caminho das métricas, `> 3` viraria `> 0,03`.
  assert.equal(getRuleField("active_count")?.kind, "count");
  assert.equal(getRuleField("active_count")?.isRatioPercent, undefined);
  assert.equal(rowMatchesRules({ active_count: 2 }, rule("active_count", ">", 3)), false);
});

/* ------------------------------------------------------------------ *
 * 5. Onde cada campo aparece
 * ------------------------------------------------------------------ */

test("anúncios ativos só onde a contagem existe de verdade", () => {
  const idsDe = (tab: any) => getAvailableRuleFields({ context: "manager", tab, hasSheetIntegration: true }).map((f) => f.id);
  // Criativos e Conjuntos: a RPC manda o número.
  assert.ok(idsDe("por-anuncio").includes("active_count"));
  assert.ok(idsDe("por-conjunto").includes("active_count"));
  // Anúncios: seria sempre 0 ou 1 — a pergunta ali é o status, não a contagem.
  assert.ok(!idsDe("individual").includes("active_count"));
  // Campanhas: a RPC devolve null. Antes o filtro caía para "número de conjuntos",
  // silenciosamente errado.
  assert.ok(!idsDe("por-campanha").includes("active_count"));
});

test("status continua em todas as abas e telas", () => {
  for (const context of ["manager", "manager-children", "boards", "criteria"] as const) {
    assert.ok(
      getAvailableRuleFields({ context, hasSheetIntegration: true }).some((f) => f.id === "status"),
      `status sumiu de ${context}`,
    );
  }
});

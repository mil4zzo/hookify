import assert from "node:assert/strict";
import test from "node:test";

import { sortBoardRows, summarizeBoardGroup } from "@/lib/boards/aggregate";

function row(overrides: Record<string, any> = {}) {
  return {
    group_key: "a",
    spend: 0,
    impressions: 0,
    clicks: 0,
    inline_link_clicks: 0,
    lpv: 0,
    plays: 0,
    reach: 0,
    conversions: {} as Record<string, number>,
    ...overrides,
  };
}

test("CPR do grupo e soma(spend)/soma(resultados), nao a media dos CPRs", () => {
  // Pesos desiguais de proposito: a media simples dos CPRs (46) fica bem longe
  // do valor correto do grupo, entao o teste separa as duas contas de fato.
  const rows = [
    row({ group_key: "a", spend: 100, conversions: { lead: 50 } }), // CPR 2
    row({ group_key: "b", spend: 900, conversions: { lead: 10 } }), // CPR 90
  ];
  const summary = summarizeBoardGroup(rows, { actionType: "lead" });

  assert.equal(summary.spend, 1000);
  assert.equal(summary.results, 60);
  // soma/soma = 1000/60 ≈ 16,67 — bem longe da media simples dos CPRs (46).
  assert.ok(summary.cpr != null && Math.abs(summary.cpr - 1000 / 60) < 0.0001);
  assert.notEqual(Math.round(summary.cpr!), 46);
});

test("sem resultado nao existe CPR — null, nunca zero", () => {
  const summary = summarizeBoardGroup([row({ spend: 500 })], { actionType: "lead" });
  assert.equal(summary.spend, 500);
  assert.equal(summary.results, 0);
  // Zero leria como "custo zero", que e o oposto de "custo desconhecido".
  assert.equal(summary.cpr, null);
});

test("grupo vazio nao quebra e nao inventa fatia", () => {
  const summary = summarizeBoardGroup([], { actionType: "lead", totalSpend: 1000 });
  assert.equal(summary.count, 0);
  assert.equal(summary.spend, 0);
  assert.equal(summary.cpr, null);
  assert.equal(summary.spendShare, 0);
});

test("fatia do spend usa o recorte inteiro como denominador", () => {
  const summary = summarizeBoardGroup([row({ spend: 250 })], { totalSpend: 1000 });
  assert.equal(summary.spendShare, 0.25);
  // Sem denominador nao ha fatia — melhor ausente do que uma porcentagem inventada.
  assert.equal(summarizeBoardGroup([row({ spend: 250 })], {}).spendShare, null);
  assert.equal(summarizeBoardGroup([row({ spend: 250 })], { totalSpend: 0 }).spendShare, null);
});

test("ordenacao respeita a direcao", () => {
  const rows = [row({ group_key: "a", spend: 10 }), row({ group_key: "b", spend: 90 }), row({ group_key: "c", spend: 50 })];
  assert.deepEqual(sortBoardRows(rows, "spend", "desc").map((r) => r.group_key), ["b", "c", "a"]);
  assert.deepEqual(sortBoardRows(rows, "spend", "asc").map((r) => r.group_key), ["a", "c", "b"]);
});

test("linha sem valor para a metrica vai para o fim nas DUAS direcoes", () => {
  // Em `asc`, tratar ausente como zero jogaria quem nao tem dado para o topo —
  // exatamente o oposto do que "menor primeiro" quer dizer.
  const rows = [
    row({ group_key: "sem", conversions: {} }),
    row({ group_key: "caro", spend: 900, conversions: { lead: 10 } }),
    row({ group_key: "barato", spend: 100, conversions: { lead: 50 } }),
  ];
  assert.deepEqual(sortBoardRows(rows, "cpr", "asc", { actionType: "lead" }).map((r) => r.group_key), ["barato", "caro", "sem"]);
  assert.deepEqual(sortBoardRows(rows, "cpr", "desc", { actionType: "lead" }).map((r) => r.group_key), ["caro", "barato", "sem"]);
});

test("ordenar nao muta o array recebido", () => {
  const rows = [row({ group_key: "a", spend: 10 }), row({ group_key: "b", spend: 90 })];
  sortBoardRows(rows, "spend", "desc");
  assert.deepEqual(rows.map((r) => r.group_key), ["a", "b"]);
});

test("taxas do grupo sao ponderadas, nao media simples de linha", () => {
  // CTR do grupo = soma(clicks)/soma(impressions). Media simples dos CTRs daria
  // peso igual a um ad de 100 impressoes e um de 100.000.
  const rows = [
    row({ group_key: "pequeno", impressions: 100, clicks: 50 }), // CTR 50%
    row({ group_key: "grande", impressions: 100000, clicks: 1000 }), // CTR 1%
  ];
  const summary = summarizeBoardGroup(rows, {});
  const ponderado = 1050 / 100100;
  assert.ok(summary.averages.ctr != null && Math.abs(summary.averages.ctr - ponderado) < 1e-9);
  // A media simples seria ~25,5% — quase 25x o valor real do grupo.
  assert.ok(summary.averages.ctr! < 0.02);
});

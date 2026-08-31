/**
 * As opções dos campos de multi-seleção — e o bug que este arquivo existe para pegar.
 *
 * O CASO REAL (2026-08-30)
 *   A visão expandida do Manager oferecia Pack e Conta no seletor e não passava
 *   opção nenhuma ao construtor: o campo estava no vocabulário, o dado estava na
 *   linha (migration 134) e o seletor abria com "nada disponível no recorte atual".
 *   Três telas montavam essa lista, cada uma do seu jeito, e a quarta esqueceu.
 *
 *   O teste de disponibilidade (`disponibilidade.test.ts`) NÃO pegava isso: ele
 *   verifica o registry, e o registry estava certo. Por isso a montagem virou uma
 *   função única — para haver o que testar.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRuleDimensionOptions } from "@/lib/rules/dimensionOptions";

/** Linha AGREGADA: listas. É o que a RPC do Manager e do Boards devolve. */
const AGREGADA = {
  pack_ids: ["p_junho", "p_julho"],
  account_ids: ["act_111", "act_222"],
  campaign_ids: ["c_bf", "c_retarget"],
  adset_ids: ["a_frio", "a_quente"],
};

/** Linha-FILHA: um anúncio só, valores únicos. É o que a RPC de detalhe devolve. */
const FILHA = {
  ad_id: "9",
  pack_ids: ["p_junho"],
  account_id: "act_111",
  campaign_name: "BLACK FRIDAY",
};

const FONTES = {
  packNameById: new Map([
    ["p_junho", "Junho"],
    ["p_julho", "Julho"],
  ]),
  // Chaveado SEM o prefixo `act_` — é assim que useProvenanceIndex o monta.
  accountNameById: new Map([
    ["111", "Conta Principal"],
    ["222", "Conta Secundária"],
  ]),
  names: {
    campaigns: { c_bf: "BLACK FRIDAY 2026", c_retarget: "Retargeting" },
    adsets: { a_frio: "Público frio", a_quente: "Quente" },
  },
};

test("as quatro dimensões saem rotuladas com o nome, não com o id", () => {
  const o = buildRuleDimensionOptions([AGREGADA], FONTES);
  assert.deepEqual(o.pack_ids, [
    { value: "p_julho", label: "Julho" },
    { value: "p_junho", label: "Junho" },
  ]);
  assert.deepEqual(o.account_ids, [
    { value: "act_111", label: "Conta Principal" },
    { value: "act_222", label: "Conta Secundária" },
  ]);
  assert.deepEqual(o.campaign_ids?.map((x) => x.label), ["BLACK FRIDAY 2026", "Retargeting"]);
  assert.deepEqual(o.adset_ids?.map((x) => x.label), ["Público frio", "Quente"]);
});

test("o prefixo `act_` não pode furar o nome da conta", () => {
  // O índice é chaveado sem o prefixo; a linha o traz com. Consultar sem normalizar
  // erra em SILÊNCIO e a opção volta rotulada com `act_111` — era o que o Manager
  // fazia antes desta função existir.
  const o = buildRuleDimensionOptions([{ account_ids: ["act_111"] }], FONTES);
  assert.equal(o.account_ids?.[0].label, "Conta Principal");
  // O valor guardado continua sendo o id EXATO da linha: é ele que o avaliador
  // compara. Normalizar o valor faria a regra parar de casar.
  assert.equal(o.account_ids?.[0].value, "act_111");
});

test("linha-filha: valor único conta como lista de um", () => {
  // A filha é UM anúncio e traz `account_id`, não `account_ids`. Sem isto, o filtro
  // de Conta da visão expandida abriria vazio.
  const o = buildRuleDimensionOptions([FILHA], FONTES);
  assert.deepEqual(o.account_ids, [{ value: "act_111", label: "Conta Principal" }]);
  assert.deepEqual(o.pack_ids, [{ value: "p_junho", label: "Junho" }]);
  // Campanha/conjunto não são oferecidos na filha (ela traz o NOME do pai, não o id),
  // e a função reflete isso devolvendo lista vazia em vez de inventar.
  assert.deepEqual(o.campaign_ids, []);
  assert.deepEqual(o.adset_ids, []);
});

test("id sem nome conhecido aparece pelo id — nunca some da lista", () => {
  // Uma opção rotulada com o número é ruim; uma opção FALTANDO é pior: o usuário
  // procura o que viu na tabela e não acha, sem nada explicando por quê.
  const o = buildRuleDimensionOptions([{ pack_ids: ["p_deletado"], campaign_ids: ["c_novo"] }], FONTES);
  assert.deepEqual(o.pack_ids, [{ value: "p_deletado", label: "p_deletado" }]);
  assert.deepEqual(o.campaign_ids, [{ value: "c_novo", label: "c_novo" }]);
});

test("sem fontes de nome nenhuma, ainda produz opções utilizáveis", () => {
  const o = buildRuleDimensionOptions([AGREGADA]);
  assert.equal(o.pack_ids?.length, 2);
  assert.equal(o.campaign_ids?.length, 2);
  assert.ok(o.pack_ids?.every((x) => x.label === x.value));
});

test("dedupe entre linhas, e nenhuma lista vem de linha nenhuma", () => {
  const o = buildRuleDimensionOptions([AGREGADA, AGREGADA, { pack_ids: ["p_agosto"] }], FONTES);
  assert.equal(o.pack_ids?.length, 3, "p_junho e p_julho não podem duplicar");
  assert.deepEqual(buildRuleDimensionOptions([], FONTES).pack_ids, []);
});

test("ids vazios, nulos e não-arrays não viram opção", () => {
  const o = buildRuleDimensionOptions(
    [{ pack_ids: ["", null, "p_junho"] }, { pack_ids: null }, { pack_ids: "nao-e-array" }, {}],
    FONTES,
  );
  assert.deepEqual(o.pack_ids, [{ value: "p_junho", label: "Junho" }]);
});

test("a ordem é alfabética em pt-BR — acento não vai para o fim", () => {
  const o = buildRuleDimensionOptions([{ pack_ids: ["z", "a", "u"] }], {
    packNameById: new Map([
      ["z", "Zebra"],
      ["a", "Abril"],
      ["u", "Última"],
    ]),
  });
  assert.deepEqual(o.pack_ids?.map((x) => x.label), ["Abril", "Última", "Zebra"]);
});

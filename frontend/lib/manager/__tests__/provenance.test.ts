import test from "node:test";
import assert from "node:assert/strict";
import { computeProvenanceVisibility, formatProvenanceNames, formatProvenanceTitle, getRowAccountNames, getRowPackNames, type ProvenanceIndex } from "../provenance";

const index: ProvenanceIndex = {
  packNameById: new Map([
    ["pack-1", "Junho"],
    ["pack-2", "Abril"],
  ]),
  // Chaveado SEM o prefixo act_.
  accountNameById: new Map([
    ["111", "CA - 01"],
    ["222", "CA - 02"],
  ]),
};

const row = (fields: Record<string, unknown>) => fields as any;

test("resolve nomes de pack: dedup, ordena e descarta pack fora do store", () => {
  assert.deepEqual(getRowPackNames(row({ pack_ids: ["pack-1"] }), index), ["Junho"]);

  // Ordenado por nome (não pela ordem dos ids) e sem duplicatas.
  assert.deepEqual(getRowPackNames(row({ pack_ids: ["pack-1", "pack-2", "pack-1"] }), index), ["Abril", "Junho"]);

  // Pack deletado (não está mais no store): omitido — o UUID cru não diria nada ao usuário.
  assert.deepEqual(getRowPackNames(row({ pack_ids: ["pack-1", "pack-sumiu"] }), index), ["Junho"]);

  assert.deepEqual(getRowPackNames(row({ pack_ids: [] }), index), []);
  assert.deepEqual(getRowPackNames(row({}), index), []);
  assert.deepEqual(getRowPackNames(null, index), []);
});

test("resolve nomes de conta: casa com e sem o prefixo act_ e cai para o id quando desconhecida", () => {
  assert.deepEqual(getRowAccountNames(row({ account_ids: ["act_111"] }), index), ["CA - 01"]);
  assert.deepEqual(getRowAccountNames(row({ account_ids: ["111"] }), index), ["CA - 01"]);

  // Linha que agrega contas — o caso que o account_id do representante escondia.
  assert.deepEqual(getRowAccountNames(row({ account_ids: ["act_222", "act_111"] }), index), ["CA - 01", "CA - 02"]);

  // Conta fora do store: mostra o id (act_999 ainda é reconhecível), ao contrário do pack.
  assert.deepEqual(getRowAccountNames(row({ account_ids: ["act_999"] }), index), ["act_999"]);
});

test("account_ids tem precedência sobre account_id (que é só o representante do grupo)", () => {
  // Payload da migration 093: account_ids manda, mesmo que account_id aponte para outra conta.
  const aggregated = row({ account_id: "act_111", account_ids: ["act_111", "act_222"] });
  assert.deepEqual(getRowAccountNames(aggregated, index), ["CA - 01", "CA - 02"]);

  // Payload antigo (sem account_ids): cai para o representante em vez de não mostrar nada.
  const legacy = row({ account_id: "act_222" });
  assert.deepEqual(getRowAccountNames(legacy, index), ["CA - 02"]);
});

test("visibilidade: a dimensão só aparece quando VARIA entre as linhas", () => {
  // Um pack e uma conta só → o seletor de packs já respondeu; repetir em toda linha seria ruído.
  const uniform = [row({ pack_ids: ["pack-1"], account_ids: ["act_111"] }), row({ pack_ids: ["pack-1"], account_ids: ["act_111"] })];
  assert.deepEqual(computeProvenanceVisibility(uniform), { showPack: false, showAccount: false });

  // Packs diferentes entre linhas → procedência vira informação que não está em nenhum outro lugar.
  const mixedPacks = [row({ pack_ids: ["pack-1"], account_ids: ["act_111"] }), row({ pack_ids: ["pack-2"], account_ids: ["act_111"] })];
  assert.deepEqual(computeProvenanceVisibility(mixedPacks), { showPack: true, showAccount: false });

  // Uma única linha que já mistura packs/contas (grupo por ad_name) também conta como variação.
  const mixedWithinRow = [row({ pack_ids: ["pack-1", "pack-2"], account_ids: ["act_111", "act_222"] })];
  assert.deepEqual(computeProvenanceVisibility(mixedWithinRow), { showPack: true, showAccount: true });

  // Fallback: variação detectada via account_id (payload antigo, sem account_ids).
  const legacyMixed = [row({ account_id: "act_111" }), row({ account_id: "act_222" })];
  assert.deepEqual(computeProvenanceVisibility(legacyMixed), { showPack: false, showAccount: true });

  assert.deepEqual(computeProvenanceVisibility([]), { showPack: false, showAccount: false });
  assert.deepEqual(computeProvenanceVisibility(undefined), { showPack: false, showAccount: false });
});

test("formatação: otimiza para o caso de um valor, com +N como salvaguarda", () => {
  assert.equal(formatProvenanceNames([]), "");
  assert.equal(formatProvenanceNames(["Junho"]), "Junho");
  assert.equal(formatProvenanceNames(["Junho", "Abril"]), "Junho +1");
  assert.equal(formatProvenanceNames(["Junho", "Abril", "Maio"]), "Junho +2");

  // O title do badge mostra a lista inteira — o "+N" nunca esconde informação.
  assert.equal(formatProvenanceTitle(["Junho", "Abril"]), "Junho · Abril");
});

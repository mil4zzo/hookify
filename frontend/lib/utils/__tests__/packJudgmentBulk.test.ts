import test from "node:test";
import assert from "node:assert/strict";
import type { AdsPack } from "@/lib/types";
import type { LeadEconomics } from "../leadEconomics";
import {
  buildBulkPackJudgmentPayload,
  bulkFieldEffect,
  bulkJudgmentStorePatch,
  describeMqlValues,
  resolveBulkPackCurrency,
  seedBulkJudgment,
  summarizeBulkJudgment,
} from "../packJudgmentBulk";

/**
 * Critérios de julgamento em massa: o que o diálogo mostra ao abrir para N packs
 * (só o que todos concordam), o que o save manda (só o que foi mexido; mexido e
 * vazio limpa) e o resumo.
 */

const DOC: LeadEconomics = {
  products: [{ id: "p1", name: "Mentoria", ticket: 3000, contribution_margin: 0.55, target_margin: 0.4 }],
  bands: [
    { min: null, product: "p1", conversion: 0.005 },
    { min: 70, product: "p1", conversion: 0.04 },
  ],
};

function pack(over: Partial<AdsPack>): AdsPack {
  return { id: "x", name: "Pack", conversion_types: [], ...over } as AdsPack;
}

test("abertura: pré-preenche só onde todos concordam; eventos são a união", () => {
  const seed = seedBulkJudgment([
    pack({ id: "a", mql_leadscore_min: 70, target_cpr: { "conversion:lead": 10, "conversion:buy": 50 }, conversion_types: ["conversion:lead", "conversion:buy"], lead_economics: DOC, sheet_integration: { id: "s" } as any }),
    pack({ id: "b", mql_leadscore_min: 70, target_cpr: { "conversion:lead": 10, "conversion:buy": 60 }, conversion_types: ["conversion:lead", "conversion:other"], lead_economics: DOC }),
  ]);
  assert.equal(seed.form.mql, "70");
  assert.deepEqual(seed.conversionTypes, ["conversion:lead", "conversion:buy", "conversion:other"]);
  assert.deepEqual(seed.form.targets, { "conversion:lead": "10", "conversion:buy": "", "conversion:other": "" });
  assert.deepEqual(seed.divergent, { mql: false, targetKeys: ["conversion:buy"], economics: false });
  assert.deepEqual(seed.economicsSaved, DOC);
  assert.equal(seed.economicsRawExists, true);
  assert.equal(seed.packsWithSheet, 1);
});

test("abertura: packs que discordam abrem vazios e marcados; 'sem corte' contra '70' é discordância", () => {
  const seed = seedBulkJudgment([
    pack({ id: "a", mql_leadscore_min: 70, lead_economics: DOC }),
    // Corte gravado como texto: é o mesmo 70, não um quarto valor na frase.
    pack({ id: "a2", mql_leadscore_min: "70" as unknown as number, lead_economics: DOC }),
    pack({ id: "b", mql_leadscore_min: null, lead_economics: null }),
    pack({ id: "c", mql_leadscore_min: 80 }),
  ]);
  assert.equal(seed.form.mql, "");
  assert.equal(seed.divergent.mql, true);
  assert.deepEqual(seed.mqlValues, [70, null, 80]);
  assert.equal(describeMqlValues(seed.mqlValues), "70, não definido e 80");
  assert.equal(seed.divergent.economics, true);
  assert.equal(seed.economicsSaved, null, "divergente: nada acordado");
  assert.equal(seed.economicsRawExists, true, "um pack tem cadastro: dá para apagar de todos");
});

test("efeito por campo: igual à abertura não muda; diferente e vazio limpa", () => {
  assert.equal(bulkFieldEffect("", ""), "keep");
  assert.equal(bulkFieldEffect("70", " 70 "), "keep", "pré-preenchido e intocado não é alteração");
  assert.equal(bulkFieldEffect("", "70"), "set");
  assert.equal(bulkFieldEffect("70", "80"), "set");
  assert.equal(bulkFieldEffect("70", "  "), "clear", "valor comum apagado limpa em todos");
});

test("campo divergente (abriu vazio): digitar e apagar NÃO limpa os packs", () => {
  // Regressão da revisão: com a regra "quem mexeu", isto mandava mql null para todos.
  const initial = { mql: "", targets: { a: "" } };
  const typedAndErased = { mql: "", targets: { a: "" } };
  assert.equal(bulkFieldEffect(initial.mql, typedAndErased.mql), "keep");
  assert.deepEqual(buildBulkPackJudgmentPayload(typedAndErased, initial, { kind: "omit" }), { kind: "empty" });
});

test("payload: campo igual à abertura fica AUSENTE; nada alterado = vazio, não um save em branco", () => {
  const initial = { mql: "70", targets: { a: "10", b: "" } };
  assert.deepEqual(buildBulkPackJudgmentPayload(initial, initial, { kind: "omit" }), { kind: "empty" });

  const only = buildBulkPackJudgmentPayload({ ...initial, mql: "80" }, initial, { kind: "omit" });
  assert.deepEqual(only, { kind: "ok", payload: { mql_leadscore_min: 80 } });
  assert.equal("target_cpr" in (only as any).payload, false, "CPR alvo inalterado não vai (nem como patch vazio)");
});

test("payload: valor comum apagado limpa; CPR alvo é patch por evento com null para remover", () => {
  const initial = { mql: "70", targets: { a: "", b: "5", c: "9" } };
  const form = { mql: "", targets: { a: "12.5", b: "", c: "9" } };
  const built = buildBulkPackJudgmentPayload(form, initial, { kind: "set", value: null });
  assert.deepEqual(built, {
    kind: "ok",
    payload: { mql_leadscore_min: null, target_cpr: { a: 12.5, b: null }, lead_economics: null },
  });
});

test("payload: erros na ordem da tela, e a economia inválida trava o save", () => {
  const empty = { mql: "", targets: {} };
  const bad = buildBulkPackJudgmentPayload({ mql: "-1", targets: {} }, empty, { kind: "omit" });
  assert.equal(bad.kind, "error");
  assert.equal((bad as any).field, "mql");

  const badTarget = buildBulkPackJudgmentPayload({ mql: "", targets: { "conversion:lead": "0" } }, { mql: "", targets: { "conversion:lead": "" } }, { kind: "omit" });
  assert.equal((badTarget as any).field, "target");
  assert.match((badTarget as any).message, /"lead"/);

  const badEconomics = buildBulkPackJudgmentPayload(empty, empty, { kind: "invalid", errors: ["Cadastre ao menos um produto."] });
  assert.deepEqual(badEconomics, { kind: "error", field: "economics", message: "Cadastre ao menos um produto." });

  const set = buildBulkPackJudgmentPayload(empty, empty, { kind: "set", value: DOC });
  assert.deepEqual(set, { kind: "ok", payload: { lead_economics: DOC } });
});

test("moeda: uma só vem da conta; várias caem na preferência e avisam; nenhuma cai na preferência", () => {
  assert.deepEqual(resolveBulkPackCurrency(["brl", "BRL", null], "USD"), { code: "BRL", fromAccount: true, mixed: [] });
  assert.deepEqual(resolveBulkPackCurrency(["BRL", "USD"], "BRL"), { code: "BRL", fromAccount: false, mixed: ["BRL", "USD"] });
  assert.deepEqual(resolveBulkPackCurrency([null, undefined], "EUR"), { code: "EUR", fromAccount: false, mixed: [] });
});

test("patch do store: só as chaves gravadas; economia canônica normalizada; null limpa", () => {
  assert.deepEqual(bulkJudgmentStorePatch({ mql_leadscore_min: 70 }), { mql_leadscore_min: 70 });
  assert.deepEqual(bulkJudgmentStorePatch({ target_cpr: null, lead_economics: null }), { target_cpr: null, lead_economics: null });
  assert.deepEqual(bulkJudgmentStorePatch({ lead_economics: DOC }), { lead_economics: DOC });
  assert.deepEqual(bulkJudgmentStorePatch({ lead_economics: { products: "x" } }), { lead_economics: null }, "inválido vira não configurado");
});

test("resumo separa atualizados, sem permissão e falhas", () => {
  const summary = summarizeBulkJudgment(
    [
      { pack_id: "a", status: "updated" },
      { pack_id: "b", status: "skipped", reason: "viewer" },
      { pack_id: "c", status: "failed", error: "banco" },
      { pack_id: "d", status: "updated" },
    ],
    { a: "A", b: "B", c: "C", d: "D" },
  );
  assert.deepEqual(summary.updated, ["A", "D"]);
  assert.deepEqual(summary.skipped, ["B"]);
  assert.deepEqual(summary.failed, [{ name: "C", error: "banco" }]);
  assert.equal(summary.headline, "2 packs atualizados · 1 sem permissão · 1 falhou");
});

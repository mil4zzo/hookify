import test from "node:test";
import assert from "node:assert/strict";
import type { AdsPack } from "@/lib/types";
import type { LeadEconomics } from "../leadEconomics";
import { reviewBulkJudgment, reviewBulkSheet } from "../bulkApplyReview";

/**
 * Resumo da confirmação em massa: só abre (`needsConfirm`) quando o save SOBRESCREVE
 * ou apaga algo que algum pack tinha. O que é só informativo (pack sem o evento,
 * pack sem planilha, pack que não tinha nada) aparece, mas não força a confirmação.
 */

const DOC: LeadEconomics = {
  products: [{ id: "p1", name: "Mentoria", ticket: 3000, contribution_margin: 0.55, target_margin: 0.4 }],
  bands: [
    { min: null, product: "p1", conversion: 0.005 },
    { min: 70, product: "p1", conversion: 0.04 },
  ],
};

function pack(over: Partial<AdsPack>): AdsPack {
  return { id: "x", name: "Pack", conversion_types: ["conversion:lead"], sheet_integration: { id: "s" }, ...over } as AdsPack;
}

const texts = (r: { lines: { text: string }[] }) => r.lines.map((l) => l.text).join("\n");

// ── Critérios ───────────────────────────────────────────────────────────────

test("corte: só define onde não havia → sem confirmação", () => {
  const r = reviewBulkJudgment([pack({ id: "a", name: "A" }), pack({ id: "b", name: "B", mql_leadscore_min: 70 })], { mql_leadscore_min: 70 });
  assert.equal(r.needsConfirm, false, "70 sobre 70 e 70 sobre nada não perdem nada");
  assert.match(texts(r), /Define em 1 pack que não tinha corte/);
});

test("corte: substitui um valor diferente → confirma, citando o valor de hoje e o pack", () => {
  const r = reviewBulkJudgment([pack({ id: "a", name: "A", mql_leadscore_min: 60 }), pack({ id: "b", name: "B" })], { mql_leadscore_min: 70 });
  assert.equal(r.needsConfirm, true);
  assert.match(texts(r), /Substitui o corte de hoje \(60\) em 1 pack: A\./);
});

test("corte: limpar só confirma se algum pack tinha corte", () => {
  assert.equal(reviewBulkJudgment([pack({ mql_leadscore_min: null })], { mql_leadscore_min: null }).needsConfirm, false);
  const r = reviewBulkJudgment([pack({ name: "A", mql_leadscore_min: 70 })], { mql_leadscore_min: null });
  assert.equal(r.needsConfirm, true);
  assert.match(texts(r), /removido de 1 pack \(A\)/);
});

test("CPR alvo: pack sem o evento é informativo; meta diferente é sobrescrita", () => {
  const semEvento = pack({ id: "b", name: "B", conversion_types: ["conversion:buy"] });
  const info = reviewBulkJudgment([pack({ id: "a", name: "A" }), semEvento], { target_cpr: { "conversion:lead": 12 } });
  assert.equal(info.needsConfirm, false);
  assert.match(texts(info), /1 pack não tem esse evento \(B\): a meta fica gravada, sem uso\./);

  const over = reviewBulkJudgment([pack({ name: "A", target_cpr: { "conversion:lead": 10 } })], { target_cpr: { "conversion:lead": 12 } });
  assert.equal(over.needsConfirm, true);

  const removed = reviewBulkJudgment([pack({ name: "A", target_cpr: { "conversion:lead": 10 } }), pack({ name: "B" })], { target_cpr: { "conversion:lead": null } });
  assert.equal(removed.needsConfirm, true);
  assert.match(texts(removed), /removida de 1 pack: A\./);
});

test("economia: mesmo cadastro (outra ordem de chaves) não confirma; outro nome de produto confirma", () => {
  const reordered = JSON.parse(JSON.stringify({ bands: DOC.bands, products: DOC.products })) as LeadEconomics;
  const same = reviewBulkJudgment([pack({ lead_economics: reordered })], { lead_economics: DOC });
  assert.equal(same.needsConfirm, false, "ordem das chaves não é diferença");

  const renamed = { ...DOC, products: [{ ...DOC.products[0], name: "Mentoria VIP" }] };
  const r = reviewBulkJudgment([pack({ name: "A", lead_economics: renamed }), pack({ name: "B" })], { lead_economics: DOC });
  assert.equal(r.needsConfirm, true, "os números batem, mas o nome do produto muda: é sobrescrever");
  assert.match(texts(r), /Substitui o cadastro de 1 pack \(A\): produtos, nomes/);
  assert.match(texts(r), /1 pack passa a ter cadastro/);
});

test("economia: cadastro gravado inválido conta como sobrescrito; apagar confirma", () => {
  const invalid = reviewBulkJudgment([pack({ lead_economics: { products: "x" } as unknown as LeadEconomics })], { lead_economics: DOC });
  assert.equal(invalid.needsConfirm, true);
  assert.equal(reviewBulkJudgment([pack({ lead_economics: DOC })], { lead_economics: null }).needsConfirm, true);
  assert.equal(reviewBulkJudgment([pack({ lead_economics: null })], { lead_economics: null }).needsConfirm, false);
});

test("pack sem planilha recebendo critério de leadscore: aviso informativo", () => {
  const r = reviewBulkJudgment([pack({ name: "A", sheet_integration: undefined })], { mql_leadscore_min: 70 });
  assert.equal(r.needsConfirm, false);
  assert.match(texts(r), /1 pack ainda não tem planilha \(A\)/);
  assert.equal(reviewBulkJudgment([pack({ sheet_integration: undefined })], { target_cpr: { "conversion:lead": 5 } }).lines.length, 1, "CPR alvo não depende de planilha");
});

// ── Planilha ────────────────────────────────────────────────────────────────

const CONFIG = {
  spreadsheet_id: "F1",
  worksheet_title: "Leads",
  ad_id_column: "ad_id",
  date_column: "data",
  date_format: "DD/MM/YYYY" as const,
  leadscore_column: "score",
  column_mappings: [{ column_index: 4, column_name: "IDADE", label: "Idade", kind: "number" as const }],
};

function connected(over: Record<string, unknown>, packOver: Partial<AdsPack> = {}): AdsPack {
  return pack({
    sheet_integration: {
      id: "s",
      owner_id: "u",
      spreadsheet_id: "F1",
      spreadsheet_name: "EI.31",
      worksheet_title: "Leads",
      ad_id_column: "ad_id",
      date_column: "data",
      date_format: "DD/MM/YYYY" as const,
      leadscore_column: "score",
      column_mappings: [{ id: "m1", integration_id: "s", column_index: 9, column_name: "idade ", label: "Idade", kind: "number", config: {}, position: 0 }],
      ...over,
    } as AdsPack["sheet_integration"],
    ...packOver,
  });
}

test("planilha: mesma configuração (coluna em outra posição, cabeçalho normalizado) não confirma", () => {
  const r = reviewBulkSheet([connected({}), pack({ name: "Novo", sheet_integration: undefined })], CONFIG, null, "EI.32");
  assert.equal(r.needsConfirm, false);
  assert.match(texts(r), /1 pack sem planilha passa a usar "EI\.32": Novo\./);
});

test("planilha: trocar de arquivo confirma e nomeia o arquivo de hoje", () => {
  const r = reviewBulkSheet([connected({ spreadsheet_id: "F0", spreadsheet_name: "EI.30" }, { name: "Antigo" })], CONFIG, null, "EI.31");
  assert.equal(r.needsConfirm, true);
  assert.match(texts(r), /1 pack troca de arquivo \(Antigo\): hoje usa "EI\.30"/);
  assert.match(texts(r), /A coluna "Idade" deixa de existir/, "vínculo de outro arquivo nunca é reaproveitado");
});

test("planilha: aba, colunas base e coluna adicional que some confirmam", () => {
  assert.equal(reviewBulkSheet([connected({ worksheet_title: "Antiga" })], CONFIG, null, "").needsConfirm, true);
  assert.equal(reviewBulkSheet([connected({ leadscore_column: "nota" })], CONFIG, null, "").needsConfirm, true);
  const lost = reviewBulkSheet([connected({}, { name: "A" })], { ...CONFIG, column_mappings: [] }, null, "");
  assert.equal(lost.needsConfirm, true);
  assert.match(texts(lost), /A coluna "Idade" deixa de existir em 1 pack \(A\)/);
  assert.equal(reviewBulkSheet([connected({})], { ...CONFIG, column_mappings: null }, null, "").needsConfirm, false, "lista ausente: o servidor não mexe nas colunas");
});

test("planilha: corte de MQL diferente confirma pela mesma regra dos critérios", () => {
  const r = reviewBulkSheet([connected({}, { mql_leadscore_min: 60 })], CONFIG, 70, "");
  assert.equal(r.needsConfirm, true);
  assert.match(texts(r), /Substitui o corte de hoje \(60\)/);
});

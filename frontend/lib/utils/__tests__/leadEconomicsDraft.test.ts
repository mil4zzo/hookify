import test from "node:test";
import assert from "node:assert/strict";
import { LEAD_ECONOMICS_MESSAGES as M, normalizeLeadEconomics, validateLeadEconomics, type LeadEconomics } from "../leadEconomics";
import {
  LEAD_ECONOMICS_FIELD_MESSAGES as F,
  LEAD_ECONOMICS_SINGLE_PRODUCT_NAME,
  LEAD_ECONOMICS_UNREADABLE_CUT_MESSAGE as UNREADABLE_CUT,
  addDraftBand,
  addDraftProduct,
  bandsUsingProduct,
  createLeadEconomicsDraft,
  decideLeadEconomicsPayload,
  draftBandCeiling,
  draftBandLabel,
  draftToLeadEconomicsDocument,
  editLeadEconomicsDraft,
  formatMoneyInput,
  formatPercentInput,
  formatScoreInput,
  hasLeadEconomicsFieldIssues,
  isLeadEconomicsBandMessage,
  isLeadEconomicsEditDirty,
  leadEconomicsDraftErrors,
  leadEconomicsDraftFieldIssues,
  leadEconomicsDraftLiveErrors,
  leadEconomicsEditPanel,
  leadEconomicsToDraft,
  newLeadEconomicsId,
  openLeadEconomicsEdit,
  parseDecimalInput,
  parseMoneyInput,
  parsePercentInput,
  parseScoreInput,
  removeDraftBand,
  removeDraftProduct,
  removeLeadEconomicsEdit,
  startLeadEconomicsEdit,
  suggestNextCut,
  undoRemoveLeadEconomicsEdit,
  updateDraftBand,
  updateDraftProduct,
  validateLeadEconomicsDraft,
  type LeadEconomicsDraft,
} from "../leadEconomicsDraft";

/**
 * O rascunho da tela da economia do lead: texto digitado ↔ documento do contrato.
 * A tela mostra porcentagem, o documento guarda fração — o erro clássico aqui é
 * gravar 55 no lugar de 0.55 (e o contrato recusaria, ou pior, 0,5 virar 0.5).
 */

// Exemplo da seção 5 do plano (o mesmo de leadEconomics.test.ts).
const EXAMPLE: LeadEconomics = {
  products: [
    { id: "p1", name: "Mentoria", ticket: 3000, contribution_margin: 0.55, target_margin: 0.4 },
    { id: "p2", name: "Ebook", ticket: 300, contribution_margin: 0.9, target_margin: 0.4 },
  ],
  bands: [
    { min: null, product: "p2", conversion: 0.005 },
    { min: 60, product: "p1", conversion: 0.04 },
    { min: 80, product: "p1", conversion: 0.12 },
  ],
};

function draft(products: LeadEconomicsDraft["products"], bands: Omit<LeadEconomicsDraft["bands"][number], "key">[]): LeadEconomicsDraft {
  return { products, bands: bands.map((band, i) => ({ key: `k${i}`, ...band })) };
}

const MENTORIA = { id: "p1", name: "Mentoria", ticket: "3.000", contribution: "55", target: "40" };
const EBOOK = { id: "p2", name: "Ebook", ticket: "300", contribution: "90", target: "40" };

// ── Texto → número ───────────────────────────────────────────────────────────

test("parseDecimalInput: vírgula decimal, ponto de milhar e os formatos mistos", () => {
  const cases: Array<[string, number | null]> = [
    ["55", 55],
    ["55,5", 55.5],
    ["0,5", 0.5],
    ["0,125", 0.125], // nota de corte em escala 0–1: NÃO é milhar
    ["3.000", 3000],
    ["3000", 3000],
    ["3.000,50", 3000.5],
    ["3000.5", 3000.5],
    ["0.125", 0.125], // zero à esquerda: decimal, não milhar
    ["1.234.567", 1234567],
    ["3,000.50", 3000.5],
    ["1,234,567", 1234567],
    ["R$ 3.000,50", 3000.5],
    ["R$ 3.000", 3000], // o espaço que o Intl põe depois do símbolo
    [" 40 % ", 40],
    ["-5", -5],
    ["", null],
    ["   ", null],
    ["abc", null],
    ["1,2,3", null],
    ["3.000.5", null],
  ];
  for (const [raw, expected] of cases) {
    assert.equal(parseDecimalInput(raw), expected, `parseDecimalInput(${JSON.stringify(raw)})`);
  }
});

test("parsePercentInput: a tela mostra porcentagem, o documento guarda fração", () => {
  assert.equal(parsePercentInput("55"), 0.55);
  assert.equal(parsePercentInput("55,5"), 0.555);
  assert.equal(parsePercentInput("0,5"), 0.005);
  assert.equal(parsePercentInput("100"), 1);
  assert.equal(parsePercentInput("0"), 0);
  // Sem arredondar, 14.3 / 100 dá 0.14300000000000002.
  assert.equal(parsePercentInput("14,3"), 0.143);
  assert.equal(parsePercentInput(""), null);
  assert.equal(parsePercentInput("x"), null);
});

// ── Número → texto ───────────────────────────────────────────────────────────

test("formatPercentInput: fração volta como porcentagem limpa, no máximo 4 casas", () => {
  assert.equal(formatPercentInput(0.55), "55"); // e não "55.00000000000001"
  assert.equal(formatPercentInput(0.555), "55,5");
  assert.equal(formatPercentInput(0.005), "0,5");
  assert.equal(formatPercentInput(0.143), "14,3");
  assert.equal(formatPercentInput(0.123456), "12,3456");
  assert.equal(formatPercentInput(0.1234567), "12,3457");
  assert.equal(formatPercentInput(1), "100");
  assert.equal(formatPercentInput(0), "0");
});

test("formatMoneyInput e formatScoreInput: voltam idênticos pelo parser do mesmo campo", () => {
  assert.equal(formatMoneyInput(3000), "3.000");
  assert.equal(formatMoneyInput(3000.5), "3.000,50");
  assert.equal(formatScoreInput(1000), "1000");
  assert.equal(formatScoreInput(0.125), "0,125");
  for (const value of [3000, 3000.5, 300, 99.99, 1234567.89, 0.5, 12, 0.01]) {
    assert.equal(parseMoneyInput(formatMoneyInput(value)), value, `dinheiro ${value}`);
  }
  for (const value of [60, 70.5, 0.125, 1000, 0.6, 0.87345, 0.123456]) {
    assert.equal(parseScoreInput(formatScoreInput(value)), value, `nota ${value}`);
  }
  for (const fraction of [0.55, 0.555, 0.005, 0.4, 0.9, 0.12, 0.04, 0.143, 1, 0, 0.123456]) {
    assert.equal(parsePercentInput(formatPercentInput(fraction)), fraction, `porcentagem ${fraction}`);
  }
});

test("entrada e exibição com a mesma precisão: o parse já arredonda no que a tela mostra", () => {
  // Dinheiro em centavos; nota em 6 casas; porcentagem em 4 (6 da fração).
  assert.equal(parseMoneyInput("3.000,505"), 3000.51);
  assert.equal(parseMoneyInput("99,999"), 100);
  assert.equal(formatMoneyInput(99.999), "100");
  assert.equal(parseScoreInput("0,1234564"), 0.123456);
  assert.equal(parseScoreInput("0,87345"), 0.87345);
  assert.equal(formatScoreInput(0.87345), "0,87345"); // e não "0,8735"
  assert.equal(parsePercentInput("12,34564"), 0.123456);
  // -0 nunca aparece na tela.
  assert.equal(Object.is(parseScoreInput("-0,0000001"), 0), true);
  assert.equal(formatScoreInput(parseScoreInput("-0,0000001")!), "0");
});

// ── Rascunho ↔ documento ─────────────────────────────────────────────────────

test("rascunho digitado vira o documento do exemplo, com frações e ids", () => {
  const typed = draft(
    [MENTORIA, EBOOK],
    [
      { min: "", product: "p2", conversion: "0,5" },
      { min: "60", product: "p1", conversion: "4" },
      { min: "80", product: "p1", conversion: "12" },
    ],
  );
  const { value, errors } = validateLeadEconomicsDraft(typed);
  assert.deepEqual(errors, []);
  assert.deepEqual(value, EXAMPLE);
});

test("documento → rascunho → documento é ponto fixo, ids preservados", () => {
  const asDraft = leadEconomicsToDraft(EXAMPLE);
  assert.deepEqual(
    asDraft.products.map((p) => p.id),
    ["p1", "p2"],
  );
  assert.deepEqual(asDraft.products[0], { id: "p1", name: "Mentoria", ticket: "3.000", contribution: "55", target: "40" });
  assert.deepEqual(
    asDraft.bands.map((b) => [b.min, b.product, b.conversion]),
    [
      ["", "p2", "0,5"],
      ["60", "p1", "4"],
      ["80", "p1", "12"],
    ],
  );
  const again = validateLeadEconomicsDraft(asDraft);
  assert.deepEqual(again.errors, []);
  assert.deepEqual(again.value, EXAMPLE);
  // E de novo: nenhum ruído de ponto flutuante se acumula a cada abrir-e-salvar.
  assert.deepEqual(validateLeadEconomicsDraft(leadEconomicsToDraft(again.value!)).value, EXAMPLE);
});

test("um produto só: nome vazio vira \"Produto\" e toda faixa aponta para ele", () => {
  const single = draft(
    [{ id: "only", name: "  ", ticket: "997", contribution: "70", target: "30" }],
    [
      { min: "", product: "id-velho", conversion: "1" },
      { min: "70", product: "", conversion: "8" },
    ],
  );
  const { value, errors } = validateLeadEconomicsDraft(single);
  assert.deepEqual(errors, []);
  assert.equal(value?.products[0].name, LEAD_ECONOMICS_SINGLE_PRODUCT_NAME);
  assert.equal(value?.products[0].id, "only");
  assert.deepEqual(
    value?.bands.map((b) => b.product),
    ["only", "only"],
  );
  assert.deepEqual(
    value?.bands.map((b) => b.min),
    [null, 70],
  );
});

test("um produto só: nome que o contrato lê como vazio também vira \"Produto\"", () => {
  // Só caractere de controle (colado quando havia dois produtos; o campo sumiu com um).
  const single = draft([{ ...MENTORIA, name: "\u0001" }], [{ min: "", product: "p1", conversion: "4" }]);
  assert.deepEqual(validateLeadEconomicsDraft(single).errors, []);
  assert.deepEqual(leadEconomicsDraftFieldIssues(single, { showAll: true }).products, [{}]);
});

test("dois produtos: nome vazio é o erro do contrato, sem nome inventado", () => {
  const two = draft(
    [MENTORIA, { ...EBOOK, name: "" }],
    [
      { min: "", product: "p2", conversion: "0,5" },
      { min: "60", product: "p1", conversion: "4" },
    ],
  );
  const { value, errors } = validateLeadEconomicsDraft(two);
  assert.equal(value, null);
  assert.deepEqual(errors, [M.productNameMissing]);
});

test("campo vazio nunca vira zero: salvar cobra cada um com a mensagem do contrato", () => {
  const blank = createLeadEconomicsDraft(70);
  const { value, errors } = validateLeadEconomicsDraft(blank);
  assert.equal(value, null);
  const name = LEAD_ECONOMICS_SINGLE_PRODUCT_NAME;
  assert.deepEqual(errors, [M.ticket(name), M.contributionMargin(name), M.targetMargin(name), M.bandConversion]);
  // Corte apagado na segunda faixa.
  const noCut = { ...blank, bands: blank.bands.map((b, i) => (i === 1 ? { ...b, min: "" } : b)) };
  assert.ok(validateLeadEconomicsDraft(noCut).errors.includes(M.bandMinMissing));
});

test("margem desejada igual à sobra: o erro \"nenhum lead se paga\" do contrato", () => {
  const bad = draft([{ ...MENTORIA, target: "55" }], [{ min: "", product: "p1", conversion: "4" }]);
  assert.deepEqual(validateLeadEconomicsDraft(bad).errors, [M.targetNotBelowContribution("Mentoria")]);
});

// ── Erros ao vivo ────────────────────────────────────────────────────────────

test("erros ao vivo: formulário em branco não acusa nada; engano de verdade acusa", () => {
  assert.deepEqual(leadEconomicsDraftLiveErrors(createLeadEconomicsDraft(70)), []);
  assert.deepEqual(leadEconomicsDraftLiveErrors(createLeadEconomicsDraft(null)), []);

  const twoBlankNames = addDraftProduct(createLeadEconomicsDraft(null));
  assert.deepEqual(leadEconomicsDraftLiveErrors(twoBlankNames), []);

  // Margem desejada acima da sobra, com o ticket ainda vazio.
  const partial = draft([{ id: "p1", name: "", ticket: "", contribution: "30", target: "40" }], [{ min: "", product: "p1", conversion: "" }]);
  assert.deepEqual(leadEconomicsDraftLiveErrors(partial), [M.targetNotBelowContribution(LEAD_ECONOMICS_SINGLE_PRODUCT_NAME)]);

  // Conversão de 150% e cortes fora de ordem.
  const wrong = draft(
    [MENTORIA],
    [
      { min: "", product: "p1", conversion: "150" },
      { min: "80", product: "p1", conversion: "" },
      { min: "60", product: "p1", conversion: "" },
    ],
  );
  // Ordem do contrato: faixa por faixa (a conversão da primeira vem antes do corte da terceira).
  assert.deepEqual(leadEconomicsDraftLiveErrors(wrong), [M.bandConversion, M.bandMinNotIncreasing]);

  // Corte que não é número acusa (com a frase da tela); corte em branco, não.
  const unreadable = draft([MENTORIA], [
    { min: "", product: "p1", conversion: "" },
    { min: "setenta", product: "p1", conversion: "" },
  ]);
  assert.deepEqual(leadEconomicsDraftLiveErrors(unreadable), [UNREADABLE_CUT]);
});

test("número gigante (estoura para Infinity ao arredondar) é \"não é um número\", nunca um save travado sem frase", () => {
  // Cada leitor estoura num tamanho: × 10^6 (nota), × 10^2 (dinheiro), × 10^4 (%).
  // Abaixo disso o número é finito e legítimo — o contrato julga se faz sentido.
  const huge = "1" + "0".repeat(303); // 1e303 × 1e6 = Infinity
  for (const [parse, text] of [
    [parseScoreInput, huge],
    [parseMoneyInput, "1" + "0".repeat(307)], // 1e307 × 1e2
    [parsePercentInput, "1" + "0".repeat(305)], // 1e305 × 1e4
  ] as const) {
    assert.ok(Number.isFinite(parseDecimalInput(text)!), "pré-condição: o parser lê um número finito");
    assert.equal(parse(text), null, `${parse.name} com ${text.length} dígitos`);
  }
  assert.equal(parseMoneyInput(huge), 1e303, "abaixo do estouro, continua sendo o número");

  const typo = draft([MENTORIA], [
    { min: "", product: "p1", conversion: "1" },
    { min: huge, product: "p1", conversion: "8" },
  ]);
  assert.deepEqual(leadEconomicsDraftFieldIssues(typo).bands[1], { min: F.notANumber });
  assert.deepEqual(leadEconomicsDraftErrors(typo), [UNREADABLE_CUT]);
  const decision = decideLeadEconomicsPayload({ draft: typo, saved: null, rawSavedExists: false, touched: true, removed: false });
  assert.deepEqual(decision, { kind: "invalid", errors: [UNREADABLE_CUT] });
});

test("corte \"7O\": resumo e aviso do save dizem \"não é um número\", como o campo — nunca \"falta nota de corte\"", () => {
  const typo = draft([MENTORIA], [
    { min: "", product: "p1", conversion: "1" },
    { min: "7O", product: "p1", conversion: "8" },
  ]);
  // O contrato, sozinho, só vê o vazio: é a frase que contradizia o campo.
  assert.deepEqual(validateLeadEconomicsDraft(typo).errors, [M.bandMinMissing]);
  assert.deepEqual(leadEconomicsDraftFieldIssues(typo).bands[1], { min: F.notANumber });
  assert.deepEqual(leadEconomicsDraftLiveErrors(typo), [UNREADABLE_CUT], "resumo ao vivo");
  assert.deepEqual(leadEconomicsDraftErrors(typo), [UNREADABLE_CUT], "resumo depois de tentar salvar");
  // O aviso do save é a primeira mensagem da decisão.
  const decision = decideLeadEconomicsPayload({ draft: typo, saved: null, rawSavedExists: false, touched: true, removed: false });
  assert.deepEqual(decision, { kind: "invalid", errors: [UNREADABLE_CUT] });

  // Corte EM BRANCO continua com a frase do contrato (e só no save).
  const blank = updateDraftBand(typo, 1, { min: "" });
  assert.deepEqual(leadEconomicsDraftLiveErrors(blank), []);
  assert.deepEqual(leadEconomicsDraftErrors(blank), [M.bandMinMissing]);

  // Os dois ao mesmo tempo: cada um dito como é, no lugar da frase única do contrato.
  const both = { ...typo, bands: [...typo.bands, { key: "k9", min: "", product: "p1", conversion: "20" }] };
  assert.deepEqual(leadEconomicsDraftErrors(both), [M.bandMinMissing, UNREADABLE_CUT]);
  assert.deepEqual(leadEconomicsDraftLiveErrors(both), [UNREADABLE_CUT]);
  // A frase da tela vai para o resumo das FAIXAS.
  assert.equal(isLeadEconomicsBandMessage(UNREADABLE_CUT), true);
});

test("mensagens separadas por bloco: faixas × produtos", () => {
  assert.equal(isLeadEconomicsBandMessage(M.bandConversion), true);
  assert.equal(isLeadEconomicsBandMessage(M.bandMinNotIncreasing), true);
  assert.equal(isLeadEconomicsBandMessage(M.ticket("Mentoria")), false);
  assert.equal(isLeadEconomicsBandMessage(M.productNameMissing), false);
});

// ── Rascunho inicial e ids ───────────────────────────────────────────────────

test("rascunho inicial: 2 faixas no corte de MQL, ou 1 faixa sem corte", () => {
  const withMql = createLeadEconomicsDraft(70);
  assert.equal(withMql.products.length, 1);
  assert.deepEqual(
    withMql.bands.map((b) => b.min),
    ["", "70"],
  );
  assert.ok(withMql.bands.every((b) => b.product === withMql.products[0].id));
  assert.equal(createLeadEconomicsDraft(0.65).bands[1].min, "0,65");
  assert.equal(createLeadEconomicsDraft(null).bands.length, 1);
});

test("ids novos: únicos, não vazios e dentro dos 40 caracteres do contrato", () => {
  const ids = new Set(Array.from({ length: 200 }, () => newLeadEconomicsId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.ok(id.length > 0 && id.length <= 40, id);

  // Sem crypto.randomUUID (http fora de localhost): o fallback também serve.
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
  try {
    const fallback = newLeadEconomicsId();
    assert.ok(fallback.length > 0 && fallback.length <= 40, fallback);
    assert.notEqual(fallback, newLeadEconomicsId());
  } finally {
    if (original) Object.defineProperty(globalThis, "crypto", original);
  }
});

test("nome não vira id: renomear mantém o id e as faixas ligadas", () => {
  const asDraft = leadEconomicsToDraft(EXAMPLE);
  const renamed = { ...asDraft, products: asDraft.products.map((p) => (p.id === "p1" ? { ...p, name: "Mentoria VIP" } : p)) };
  const { value } = validateLeadEconomicsDraft(renamed);
  assert.equal(value?.products[0].id, "p1");
  assert.deepEqual(
    value?.bands.map((b) => b.product),
    ["p2", "p1", "p1"],
  );
});

// ── Edição ───────────────────────────────────────────────────────────────────

test("remover faixa: nunca zero; remover a primeira promove a segunda sem corte", () => {
  const three = leadEconomicsToDraft(EXAMPLE);
  const withoutFirst = removeDraftBand(three, 0);
  assert.deepEqual(
    withoutFirst.bands.map((b) => [b.min, b.product]),
    [
      ["", "p1"],
      ["80", "p1"],
    ],
  );
  assert.deepEqual(validateLeadEconomicsDraft(withoutFirst).errors, []);

  const withoutMiddle = removeDraftBand(three, 1);
  assert.deepEqual(
    withoutMiddle.bands.map((b) => b.min),
    ["", "80"],
  );

  const one = removeDraftBand(removeDraftBand(three, 2), 1);
  assert.equal(one.bands.length, 1);
  assert.equal(removeDraftBand(one, 0), one);
});

test("remover produto em uso: só com destino; as faixas mudam de produto; nunca zero", () => {
  const asDraft = leadEconomicsToDraft(EXAMPLE);
  assert.deepEqual(bandsUsingProduct(asDraft, "p1"), [1, 2]);
  assert.equal(removeDraftProduct(asDraft, "p1", null), asDraft, "sem destino não remove");
  assert.equal(removeDraftProduct(asDraft, "p1", "p1"), asDraft, "destino não pode ser o próprio produto");

  const moved = removeDraftProduct(asDraft, "p1", "p2");
  assert.deepEqual(
    moved.products.map((p) => p.id),
    ["p2"],
  );
  assert.deepEqual(
    moved.bands.map((b) => b.product),
    ["p2", "p2", "p2"],
  );
  assert.equal(removeDraftProduct(moved, "p2", null), moved, "o último produto fica");

  // Produto sem faixa sai direto.
  const extra = addDraftProduct(asDraft);
  const extraId = extra.products[2].id;
  assert.deepEqual(bandsUsingProduct(extra, extraId), []);
  assert.equal(removeDraftProduct(extra, extraId, null).products.length, 2);
});

test("adicionar produto ao modo simples liga as faixas ao produto que já existia", () => {
  const single = draft([{ ...MENTORIA }], [
    { min: "", product: "id-velho", conversion: "1" },
    { min: "70", product: "p1", conversion: "8" },
  ]);
  const two = addDraftProduct(single);
  assert.equal(two.products.length, 2);
  assert.deepEqual(
    two.bands.map((b) => b.product),
    ["p1", "p1"],
  );
});

test("adicionar faixa: corte sugerido acima do último, no passo da escala", () => {
  assert.equal(suggestNextCut(leadEconomicsToDraft(EXAMPLE), null), "100"); // 60 → 80 → 100
  const one = draft([MENTORIA], [
    { min: "", product: "p1", conversion: "" },
    { min: "70", product: "p1", conversion: "" },
  ]);
  assert.equal(suggestNextCut(one, null), "80");
  assert.equal(suggestNextCut({ ...one, bands: one.bands.map((b, i) => (i ? { ...b, min: "0,6" } : b)) }, null), "0,7");
  assert.equal(suggestNextCut({ ...one, bands: one.bands.map((b, i) => (i ? { ...b, min: "600" } : b)) }, null), "700");
  const firstOnly = draft([MENTORIA], [{ min: "", product: "p1", conversion: "" }]);
  assert.equal(suggestNextCut(firstOnly, 70), "70");
  assert.equal(suggestNextCut(firstOnly, null), "");

  const added = addDraftBand(leadEconomicsToDraft(EXAMPLE), null);
  assert.equal(added.bands.length, 4);
  assert.deepEqual([added.bands[3].min, added.bands[3].product, added.bands[3].conversion], ["100", "p1", ""]);
});

// ── Leitura para a tela ──────────────────────────────────────────────────────

test("teto por lead ao vivo: o da seção 5, e — enquanto a faixa não fecha", () => {
  const asDraft = leadEconomicsToDraft(EXAMPLE);
  const near = (actual: number | null, expected: number) =>
    assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `esperado ${expected}, veio ${actual}`);
  near(draftBandCeiling(asDraft, 0), 0.75);
  near(draftBandCeiling(asDraft, 1), 18);
  near(draftBandCeiling(asDraft, 2), 54);

  const blankConversion = { ...asDraft, bands: asDraft.bands.map((b, i) => (i === 2 ? { ...b, conversion: "" } : b)) };
  assert.equal(draftBandCeiling(blankConversion, 2), null);
  const noSlack = { ...asDraft, products: asDraft.products.map((p) => (p.id === "p1" ? { ...p, target: "55" } : p)) };
  assert.equal(draftBandCeiling(noSlack, 2), null, "margem desejada = sobra: sem teto, não R$ 0");
  assert.equal(draftBandCeiling(asDraft, 9), null);
});

test("rótulo das faixas: o corte exato entra na faixa de cima", () => {
  const asDraft = leadEconomicsToDraft(EXAMPLE);
  assert.deepEqual(
    asDraft.bands.map((_, i) => draftBandLabel(asDraft, i)),
    ["abaixo de 60", "60 a menos de 80", "80 ou mais"],
  );
  const one = draft([MENTORIA], [{ min: "", product: "p1", conversion: "" }]);
  assert.equal(draftBandLabel(one, 0), "todas as notas");
  const pending = draft([MENTORIA], [
    { min: "", product: "p1", conversion: "" },
    { min: "", product: "p1", conversion: "" },
  ]);
  assert.equal(draftBandLabel(pending, 0), "abaixo do próximo corte");
});

test("o documento pré-validação carrega NaN, nunca 0, no campo ilegível", () => {
  const doc = draftToLeadEconomicsDocument(draft([{ ...MENTORIA, ticket: "" }], [{ min: "", product: "p1", conversion: "abc" }]));
  assert.ok(Number.isNaN(doc.products[0].ticket));
  assert.ok(Number.isNaN(doc.bands[0].conversion));
  assert.equal(validateLeadEconomics(doc).value, null);
});

// ── Precisão: documento → tela → documento é ponto fixo ─────────────────────

/** PRNG determinístico (mulberry32): a propriedade roda igual em todo lugar. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("ponto fixo: corte de 6 casas, ticket em centavos e % de 4 casas voltam idênticos", () => {
  const precise: LeadEconomics = {
    products: [
      { id: "p1", name: "Mentoria", ticket: 1234.56, contribution_margin: 0.123456, target_margin: 0.0005 },
      { id: "p2", name: "Ebook", ticket: 97.9, contribution_margin: 0.87345, target_margin: 0.4 },
    ],
    bands: [
      { min: null, product: "p2", conversion: 0.000123 },
      { min: 0.12341, product: "p1", conversion: 0.041234 },
      { min: 0.12344, product: "p1", conversion: 0.12 },
      { min: 0.87345, product: "p1", conversion: 1 },
    ],
  };
  assert.deepEqual(validateLeadEconomics(precise).value, precise, "o exemplo é um documento válido");
  const asDraft = leadEconomicsToDraft(precise);
  assert.deepEqual(
    asDraft.bands.map((b) => b.min),
    ["", "0,12341", "0,12344", "0,87345"],
  );
  assert.equal(asDraft.products[0].ticket, "1.234,56");
  assert.equal(asDraft.products[0].contribution, "12,3456");
  const again = validateLeadEconomicsDraft(asDraft);
  assert.deepEqual(again.errors, [], "cortes 0,12341 e 0,12344 não podem virar iguais");
  assert.deepEqual(again.value, precise);

  // O cenário do achado: reabrir e mexer em OUTRO campo (renomear) não regrava os números.
  const renamed = validateLeadEconomicsDraft(updateDraftProduct(asDraft, "p2", { name: "Ebook 2" })).value!;
  assert.deepEqual(renamed.bands, precise.bands);
  assert.deepEqual(renamed.products[0], precise.products[0]);
});

test("ponto fixo (propriedade): documentos gerados nas precisões da tela voltam idênticos", () => {
  const random = prng(20260923);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  for (let run = 0; run < 2000; run++) {
    const productCount = int(1, 3);
    const products = Array.from({ length: productCount }, (_, i) => {
      const contribution = int(1, 1e6); // fração com 6 casas = % com 4
      return {
        id: `p${i}`,
        name: `Produto ${i}`,
        ticket: int(1, 5e8) / 100, // centavos, até 5 milhões
        contribution_margin: contribution / 1e6,
        target_margin: int(0, contribution - 1) / 1e6,
      };
    });
    let cut = int(-1e6, 1e6);
    const bands = Array.from({ length: int(1, 5) }, (_, i) => {
      if (i > 0) cut += int(1, 5e7); // nota com 6 casas, sempre crescente
      return { min: i === 0 ? null : cut / 1e6, product: `p${int(0, productCount - 1)}`, conversion: int(0, 1e6) / 1e6 };
    });
    const doc: LeadEconomics = { products, bands };
    assert.deepEqual(validateLeadEconomics(doc).value, doc, `documento ${run} inválido na geração`);
    const back = validateLeadEconomicsDraft(leadEconomicsToDraft(doc));
    assert.deepEqual(back.value, doc, `ida e volta ${run}: ${JSON.stringify(doc)}`);
  }
});

// ── O que o save manda (D21) ─────────────────────────────────────────────────

test("payload: removido apaga só o que estava gravado (válido ou inválido)", () => {
  assert.deepEqual(
    decideLeadEconomicsPayload({ draft: null, saved: EXAMPLE, rawSavedExists: true, touched: false, removed: true }),
    { kind: "set", value: null },
  );
  // Gravado inválido: normalize deu null, mas a coluna tem algo — o remover precisa limpá-la.
  assert.deepEqual(
    decideLeadEconomicsPayload({ draft: null, saved: null, rawSavedExists: true, touched: false, removed: true }),
    { kind: "set", value: null },
  );
  // Nada gravado: remover um rascunho não salvo não manda nada.
  assert.deepEqual(
    decideLeadEconomicsPayload({ draft: leadEconomicsToDraft(EXAMPLE), saved: null, rawSavedExists: false, touched: true, removed: true }),
    { kind: "omit" },
  );
});

test("payload: sem rascunho, ou rascunho intocado com cadastro válido gravado → a chave não vai", () => {
  assert.deepEqual(decideLeadEconomicsPayload({ draft: null, saved: null, rawSavedExists: false, touched: false, removed: false }), { kind: "omit" });
  assert.deepEqual(decideLeadEconomicsPayload({ draft: null, saved: null, rawSavedExists: true, touched: false, removed: false }), { kind: "omit" });
  assert.deepEqual(
    decideLeadEconomicsPayload({ draft: leadEconomicsToDraft(EXAMPLE), saved: EXAMPLE, rawSavedExists: true, touched: false, removed: false }),
    { kind: "omit" },
  );
});

test("payload regra 3: gravado que a LEITURA aceita e a ESCRITA recusa, reaberto sem mexer → a chave não vai", () => {
  // Dois produtos com o mesmo nome e um nome de 80 caracteres: a leitura tolerante
  // aceita (a conta não depende do nome), a escrita estrita recusa.
  const raw = {
    products: [
      { id: "p1", name: "Mentoria", ticket: 3000, contribution_margin: 0.55, target_margin: 0.4 },
      { id: "p2", name: "mentoria", ticket: 300, contribution_margin: 0.9, target_margin: 0.4 },
      { id: "p3", name: "x".repeat(80), ticket: 97, contribution_margin: 0.9, target_margin: 0.4 },
    ],
    bands: [
      { min: null, product: "p2", conversion: 0.005 },
      { min: 60, product: "p1", conversion: 0.04 },
      { min: 80, product: "p3", conversion: 0.12 },
    ],
  };
  const saved = normalizeLeadEconomics(raw);
  assert.ok(saved, "a leitura aceita");
  assert.equal(validateLeadEconomics(raw).value, null, "a escrita recusa");

  // Reabrir e salvar só o corte de MQL: o rascunho intocado não passa pela escrita.
  const opened = openLeadEconomicsEdit(saved);
  assert.deepEqual(
    decideLeadEconomicsPayload({ draft: opened.draft, saved, rawSavedExists: true, touched: opened.touched, removed: false }),
    { kind: "omit" },
  );
  // Mexeu: aí sim a escrita cobra os nomes (e o save mostra por quê).
  const edited = editLeadEconomicsDraft(updateDraftBand(opened.draft!, 2, { conversion: "15" }));
  const decision = decideLeadEconomicsPayload({ draft: edited.draft, saved, rawSavedExists: true, touched: edited.touched, removed: false });
  assert.equal(decision.kind, "invalid");
  assert.ok(decision.kind === "invalid" && decision.errors.includes(M.productNameDuplicate("mentoria")), "nome repetido cobrado");
});

test("payload regra 4: \"Configurar\" sem mexer → a chave não vai; mexeu, mesmo sem números → valida", () => {
  // O que "Configurar" cria e ninguém tocou: o mesmo que não configurar, com ou sem
  // um gravado inválido na coluna (que fica como estava).
  for (const rawSavedExists of [false, true]) {
    const started = startLeadEconomicsEdit(70);
    assert.deepEqual(
      decideLeadEconomicsPayload({ draft: started.draft, saved: null, rawSavedExists, touched: started.touched, removed: false }),
      { kind: "omit" },
      `intocado, rawSavedExists=${rawSavedExists}`,
    );
  }

  // Nome e corte digitados, nenhum número: antes sumia calado e o diálogo dizia
  // "salva". Agora cai na validação — o save para e os campos mostram o que falta.
  const started = startLeadEconomicsEdit(70);
  const pid = started.draft!.products[0].id;
  const structure = addDraftBand(addDraftProduct(updateDraftProduct(started.draft!, pid, { name: "Mentoria" })), 70);
  const typed = editLeadEconomicsDraft(structure);
  for (const rawSavedExists of [false, true]) {
    const decision = decideLeadEconomicsPayload({ draft: typed.draft, saved: null, rawSavedExists, touched: typed.touched, removed: false });
    assert.equal(decision.kind, "invalid", `rawSavedExists=${rawSavedExists}`);
    assert.ok(decision.kind === "invalid" && decision.errors.includes(M.ticket("Mentoria")), "o ticket em branco é cobrado");
  }
  // Até o formulário do "Configurar" tocado e devolvido ao branco: valida (apagar é pelo Remover).
  const retyped = editLeadEconomicsDraft(started.draft!);
  assert.equal(decideLeadEconomicsPayload({ draft: retyped.draft, saved: null, rawSavedExists: false, touched: true, removed: false }).kind, "invalid");
});

test("payload: com cadastro gravado, esvaziar os campos à mão é erro de validação, não remoção", () => {
  const decision = decideLeadEconomicsPayload({ draft: createLeadEconomicsDraft(60), saved: EXAMPLE, rawSavedExists: true, touched: true, removed: false });
  assert.equal(decision.kind, "invalid");
  assert.ok(decision.kind === "invalid" && decision.errors.includes(M.ticket(LEAD_ECONOMICS_SINGLE_PRODUCT_NAME)));
});

test("payload: inválido não salva; válido igual ao gravado não vai; diferente vai", () => {
  const asDraft = leadEconomicsToDraft(EXAMPLE);
  const broken = updateDraftBand(asDraft, 2, { min: "50" }); // cortes fora de ordem
  assert.deepEqual(decideLeadEconomicsPayload({ draft: broken, saved: EXAMPLE, rawSavedExists: true, touched: true, removed: false }), {
    kind: "invalid",
    errors: [M.bandMinNotIncreasing],
  });

  // Mexeu e deixou o mesmo número (com outra grafia): nada mudou, nada vai.
  const same = updateDraftProduct(asDraft, "p1", { ticket: "3000,00" });
  assert.deepEqual(decideLeadEconomicsPayload({ draft: same, saved: EXAMPLE, rawSavedExists: true, touched: true, removed: false }), { kind: "omit" });

  const changed = updateDraftBand(asDraft, 2, { conversion: "15" });
  const decision = decideLeadEconomicsPayload({ draft: changed, saved: EXAMPLE, rawSavedExists: true, touched: true, removed: false });
  assert.equal(decision.kind, "set");
  assert.equal(decision.kind === "set" && decision.value?.bands[2].conversion, 0.15);

  // Primeiro cadastro, e cadastro novo por cima de um gravado inválido: vão.
  const typed = draft([MENTORIA], [{ min: "", product: "p1", conversion: "4" }]);
  for (const rawSavedExists of [false, true]) {
    const first = decideLeadEconomicsPayload({ draft: typed, saved: null, rawSavedExists, touched: true, removed: false });
    assert.equal(first.kind, "set", `rawSavedExists=${rawSavedExists}`);
  }
});

// ── Remover e desfazer ───────────────────────────────────────────────────────

test("desfazer remoção devolve o que foi digitado antes de remover (e o touched)", () => {
  const withSaved = { rawSavedExists: true };
  const opened = openLeadEconomicsEdit(EXAMPLE);
  assert.equal(opened.touched, false);
  const edited = editLeadEconomicsDraft(updateDraftBand(opened.draft!, 2, { conversion: "15" }));
  const removed = removeLeadEconomicsEdit(edited, withSaved);
  assert.equal(removed.draft, null);
  assert.ok(removed.removed);
  assert.equal(removeLeadEconomicsEdit(removed, withSaved), removed, "remover de novo não perde o estado guardado");

  const undone = undoRemoveLeadEconomicsEdit(removed);
  assert.deepEqual(undone, edited, "a edição volta, não o documento gravado");
  // E o save manda a edição, porque o touched voltou junto.
  const decision = decideLeadEconomicsPayload({ draft: undone.draft, saved: EXAMPLE, rawSavedExists: true, touched: undone.touched, removed: false });
  assert.equal(decision.kind, "set");

  // Rascunho nunca salvo, mas digitado, também volta.
  const fresh = editLeadEconomicsDraft(updateDraftBand(startLeadEconomicsEdit(70).draft!, 1, { conversion: "8" }));
  assert.deepEqual(undoRemoveLeadEconomicsEdit(removeLeadEconomicsEdit(fresh, { rawSavedExists: false })), fresh);
  // Sem rascunho (gravado inválido): remove e desfaz de volta ao vazio.
  const empty = openLeadEconomicsEdit(null);
  assert.deepEqual(undoRemoveLeadEconomicsEdit(removeLeadEconomicsEdit(empty, withSaved)), empty);
  assert.equal(undoRemoveLeadEconomicsEdit(opened), opened, "desfazer sem remoção não muda nada");
});

test("\"Configurar\" e logo \"Remover\" sem digitar nada: volta a não configurada, sem desfazer e sem alteração", () => {
  const started = startLeadEconomicsEdit(70);
  const removed = removeLeadEconomicsEdit(started, { rawSavedExists: false });
  assert.deepEqual(removed, openLeadEconomicsEdit(null), "o mesmo estado de quem nunca configurou");
  assert.equal(isLeadEconomicsEditDirty(removed), false, "Esc e clique fora voltam a fechar");
  assert.equal(leadEconomicsEditPanel(removed, { valid: false, rawExists: false }), "empty");
  assert.deepEqual(decideLeadEconomicsPayload({ draft: removed.draft, saved: null, rawSavedExists: false, touched: removed.touched, removed: removed.removed !== null }), {
    kind: "omit",
  });

  // Com algo gravado — mesmo inválido ("Configurar de novo") — remover é apagar: tem desfazer.
  const overInvalid = removeLeadEconomicsEdit(started, { rawSavedExists: true });
  assert.ok(overInvalid.removed, "sobre gravado inválido: removido, com desfazer");
  assert.equal(leadEconomicsEditPanel(overInvalid, { valid: false, rawExists: true }), "removed");
  // Intocado com cadastro válido gravado também.
  assert.ok(removeLeadEconomicsEdit(openLeadEconomicsEdit(EXAMPLE), { rawSavedExists: true }).removed, "sobre gravado válido: removido");
});

test("painel da seção (e alvo do foco): o desfazer de um gravado inválido volta ao AVISO, não ao editor", () => {
  const invalidSaved = { valid: false, rawExists: true };
  const opened = openLeadEconomicsEdit(null);
  assert.equal(leadEconomicsEditPanel(opened, invalidSaved), "invalid");
  const removed = removeLeadEconomicsEdit(opened, { rawSavedExists: true });
  assert.equal(leadEconomicsEditPanel(removed, invalidSaved), "removed");
  // O achado: o diálogo pedia foco no "editor" aqui, o editor não montava e o pedido
  // ficava pendurado até a próxima abertura.
  assert.equal(leadEconomicsEditPanel(undoRemoveLeadEconomicsEdit(removed), invalidSaved), "invalid");

  // "Configurar de novo" → editor; remover → removido; desfazer → editor de novo.
  const reconfigured = startLeadEconomicsEdit(70);
  assert.equal(leadEconomicsEditPanel(reconfigured, invalidSaved), "editor");
  const removedDraft = removeLeadEconomicsEdit(reconfigured, { rawSavedExists: true });
  assert.equal(leadEconomicsEditPanel(undoRemoveLeadEconomicsEdit(removedDraft), invalidSaved), "editor");

  const validSaved = { valid: true, rawExists: true };
  assert.equal(leadEconomicsEditPanel(openLeadEconomicsEdit(EXAMPLE), validSaved), "editor");
  assert.equal(leadEconomicsEditPanel(openLeadEconomicsEdit(null), { valid: false, rawExists: false }), "empty");
});

test("configurar não conta como alteração: rascunho novo nasce intocado", () => {
  const started = startLeadEconomicsEdit(70);
  assert.equal(started.touched, false);
  assert.equal(started.removed, null);
  assert.deepEqual(
    started.draft!.bands.map((b) => b.min),
    ["", "70"],
  );
});

test("alteração a perder (o diálogo não fecha por Esc/clique fora): digitou ou removeu", () => {
  assert.equal(isLeadEconomicsEditDirty(openLeadEconomicsEdit(EXAMPLE)), false);
  assert.equal(isLeadEconomicsEditDirty(openLeadEconomicsEdit(null)), false);
  assert.equal(isLeadEconomicsEditDirty(startLeadEconomicsEdit(70)), false, "só abrir o formulário não é alteração");
  const typed = editLeadEconomicsDraft(updateDraftBand(startLeadEconomicsEdit(70).draft!, 0, { conversion: "1" }));
  assert.equal(isLeadEconomicsEditDirty(typed), true);
  // Remover sem ter digitado nada: o desfazer só existe com o diálogo aberto.
  const removedUntouched = removeLeadEconomicsEdit(openLeadEconomicsEdit(EXAMPLE), { rawSavedExists: true });
  assert.equal(isLeadEconomicsEditDirty(removedUntouched), true);
  assert.equal(isLeadEconomicsEditDirty(undoRemoveLeadEconomicsEdit(removedUntouched)), false, "desfeito, volta a não ter nada a perder");
});

// ── Corte em branco ao vivo ──────────────────────────────────────────────────

test("corte em branco: ao vivo não acusa; salvar cobra a nota de corte", () => {
  const blankCut = addDraftBand(createLeadEconomicsDraft(null), null);
  assert.equal(blankCut.bands[1].min, "", "sem MQL e sem corte anterior não há sugestão");
  assert.deepEqual(leadEconomicsDraftLiveErrors(blankCut), []);
  assert.ok(validateLeadEconomicsDraft(blankCut).errors.includes(M.bandMinMissing));
});

// ── Erro por campo ───────────────────────────────────────────────────────────

test("erro por campo: cada mensagem no campo certo", () => {
  const typed = draft(
    [
      { id: "p1", name: "Mentoria", ticket: "0", contribution: "150", target: "40" },
      { id: "p2", name: " mentoria ", ticket: "abc", contribution: "30", target: "30" },
      { id: "p3", name: "x".repeat(61), ticket: "10", contribution: "50", target: "100" },
    ],
    [
      { min: "", product: "p1", conversion: "150" },
      { min: "7O", product: "sumiu", conversion: "z" },
      { min: "80", product: "p1", conversion: "-1" },
      { min: "60", product: "p2", conversion: "4" },
    ],
  );
  const issues = leadEconomicsDraftFieldIssues(typed);
  assert.deepEqual(issues.products, [
    { ticket: F.positive, contribution: F.contributionRange },
    { name: F.nameDuplicate, ticket: F.notANumber, target: F.targetNotBelowContribution },
    { name: F.nameTooLong, target: F.targetRange },
  ]);
  assert.deepEqual(issues.bands, [
    { conversion: F.conversionRange },
    { min: F.notANumber, product: F.productMissing, conversion: F.notANumber },
    { conversion: F.conversionRange },
    { min: F.cutNotIncreasing },
  ]);
});

test("erro por campo: \"7O\" no corte é \"não é um número\", nunca \"falta nota de corte\"", () => {
  const typo = draft([MENTORIA], [
    { min: "", product: "p1", conversion: "1" },
    { min: "7O", product: "p1", conversion: "8" },
  ]);
  assert.deepEqual(leadEconomicsDraftFieldIssues(typo).bands[1], { min: F.notANumber });
  assert.deepEqual(leadEconomicsDraftFieldIssues(typo, { showAll: true }).bands[1], { min: F.notANumber });
});

test("erro por campo: em branco só acusa com showAll; com um produto, nome em branco nunca", () => {
  const blank = createLeadEconomicsDraft(null);
  assert.equal(hasLeadEconomicsFieldIssues(leadEconomicsDraftFieldIssues(blank)), false);
  const all = leadEconomicsDraftFieldIssues(blank, { showAll: true });
  assert.deepEqual(all.products, [{ ticket: F.required, contribution: F.required, target: F.required }], "sem nome no modo simples");
  assert.deepEqual(all.bands, [{ conversion: F.required }], "a primeira faixa não tem corte");

  const blankCut = addDraftBand(blank, null);
  assert.deepEqual(leadEconomicsDraftFieldIssues(blankCut).bands[1], {});
  assert.equal(leadEconomicsDraftFieldIssues(blankCut, { showAll: true }).bands[1].min, F.required);

  // Dois produtos com nome vazio: só com showAll, e os dois (vazio não é "repetido").
  const twoBlank = addDraftProduct(blank);
  assert.deepEqual(
    leadEconomicsDraftFieldIssues(twoBlank).products.map((p) => p.name),
    [undefined, undefined],
  );
  assert.deepEqual(
    leadEconomicsDraftFieldIssues(twoBlank, { showAll: true }).products.map((p) => p.name),
    [F.required, F.required],
  );
  // O seletor de produto aparece, e a faixa já aponta para um produto que existe.
  assert.deepEqual(leadEconomicsDraftFieldIssues(twoBlank).bands[0], {});
});

test("erro por campo: o corte compara com o último corte VÁLIDO, como o contrato", () => {
  const skip = draft([MENTORIA], [
    { min: "", product: "p1", conversion: "1" },
    { min: "60", product: "p1", conversion: "1" },
    { min: "", product: "p1", conversion: "1" },
    { min: "50", product: "p1", conversion: "1" },
  ]);
  const bands = leadEconomicsDraftFieldIssues(skip, { showAll: true }).bands;
  assert.deepEqual(bands[2], { min: F.required });
  assert.deepEqual(bands[3], { min: F.cutNotIncreasing }, "50 comparado com 60, pulando o branco");
});

test("erro por campo (propriedade): há erro de campo ⇔ o contrato recusa; e ⇔ há erro ao vivo", () => {
  const random = prng(1729);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  // Cada campo erra com chance pequena: assim ~1/3 dos rascunhos passa inteiro e boa
  // parte tem UM campo errado — o caso que distingue "campo certo" de "campo errado".
  const field = (valid: readonly string[], wrong: readonly string[]) => (random() < 0.07 ? pick(wrong) : pick(valid));
  // Bordas de arredondamento de propósito: "0,001" de ticket e "0,00001"% de sobra
  // viram zero; "100,00001"% de conversão vira 100%; "0,1234564" de corte, 0,123456.
  const tickets = { valid: ["3.000", "997", "12,5", "0,01"], wrong: ["", "abc", "0", "-1", "0,001"] };
  const contributions = { valid: ["55", "100", "30", "0,0001", "90"], wrong: ["", "x", "0", "150", "-5", "0,00001"] };
  const targets = { valid: ["0", "10", "20", "29,99"], wrong: ["", "y", "100", "-1", "99,99"] };
  const conversions = { valid: ["0", "4", "100", "0,5", "100,00001"], wrong: ["", "z", "150", "-1"] };
  const cutsWrong = ["", "7O", "-1", "5", "0,1234564", "0,1234561"];
  // Caractere de controle: o contrato limpa antes de comparar ("Produto\u00010" repete
  // "Produto 0"); o erro por campo não pode ter uma limpeza própria que discorde.
  const namesWrong = ["", "  ", "Produto 0", " produto 0", "x".repeat(61), "\u0001", "Produto\u00010"];
  for (let run = 0; run < 4000; run++) {
    const products = Array.from({ length: 1 + Math.floor(random() * 3) }, (_, i) => ({
      id: `p${i}`,
      name: field([`Produto ${i}`], namesWrong),
      ticket: field(tickets.valid, tickets.wrong),
      contribution: field(contributions.valid, contributions.wrong),
      target: field(targets.valid, targets.wrong),
    }));
    const bands = Array.from({ length: 1 + Math.floor(random() * 4) }, (_, i) => ({
      min: field([String(10 * i)], cutsWrong),
      product: field(
        products.map((p) => p.id),
        ["sumiu", ""],
      ),
      conversion: field(conversions.valid, conversions.wrong),
    }));
    const d = draft(products, bands);
    assert.equal(
      hasLeadEconomicsFieldIssues(leadEconomicsDraftFieldIssues(d, { showAll: true })),
      validateLeadEconomicsDraft(d).errors.length > 0,
      `showAll ≠ contrato: ${JSON.stringify(d)}`,
    );
    assert.equal(
      hasLeadEconomicsFieldIssues(leadEconomicsDraftFieldIssues(d)),
      leadEconomicsDraftLiveErrors(d).length > 0,
      `ao vivo ≠ leadEconomicsDraftLiveErrors: ${JSON.stringify(d)}`,
    );
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeBulkBudgetSelection,
  applyBudgetPercent,
  computeBudgetTotals,
  formatBudgetTotals,
  parseSignedDecimal,
  previewBulkBudget,
} from "../budget";

const row = (fields: Record<string, unknown>) => fields as any;

// Formatador de teste: não depende do store de settings (o real lê Intl + preferências).
const fmt = (value: number, currency?: string) => `${currency ?? "??"} ${value.toFixed(2)}`;

test("soma orçamentos diários convertendo a subunidade da moeda", () => {
  const totals = computeBudgetTotals([
    row({ budget_daily: 15000, budget_currency: "BRL" }), // R$ 150,00
    row({ budget_daily: 5050, budget_currency: "BRL" }), // R$ 50,50
  ]);

  assert.equal(totals.byCurrency.length, 1);
  assert.equal(totals.byCurrency[0].daily, 200.5);
  assert.equal(totals.byCurrency[0].dailyCount, 2);
  assert.equal(totals.withBudget, 2);
  assert.equal(totals.withoutBudget, 0);
  assert.equal(formatBudgetTotals(totals, fmt), "BRL 200.50/dia");
});

test("moeda sem subunidade (JPY) não é dividida por 100", () => {
  const totals = computeBudgetTotals([row({ budget_daily: 5000, budget_currency: "JPY" })]);
  assert.equal(totals.byCurrency[0].daily, 5000);
});

test("diário e lifetime não se misturam na mesma soma", () => {
  const totals = computeBudgetTotals([
    row({ budget_daily: 10000, budget_currency: "BRL" }),
    row({ budget_lifetime: 400000, budget_currency: "BRL" }),
  ]);

  assert.equal(totals.byCurrency[0].daily, 100);
  assert.equal(totals.byCurrency[0].lifetime, 4000);
  assert.equal(formatBudgetTotals(totals, fmt), "BRL 100.00/dia + BRL 4000.00 total");
});

test("linha com os dois campos entra só no diário — a mesma precedência da célula", () => {
  const totals = computeBudgetTotals([row({ budget_daily: 10000, budget_lifetime: 400000, budget_currency: "BRL" })]);
  assert.equal(totals.byCurrency[0].daily, 100);
  assert.equal(totals.byCurrency[0].lifetime, 0);
  assert.equal(totals.byCurrency[0].lifetimeCount, 0);
});

test("linha sem orçamento próprio fica FORA da soma (não conta como zero)", () => {
  const totals = computeBudgetTotals([
    row({ budget_daily: 10000, budget_currency: "BRL" }),
    row({ budget_daily: null, budget_lifetime: null, budget_mode: "abo" }), // campanha ABO: orçamento nos conjuntos
    row({}), // ainda não sincronizada
  ]);

  assert.equal(totals.withBudget, 1);
  assert.equal(totals.withoutBudget, 2);
  assert.equal(totals.byCurrency[0].daily, 100);
});

test("moedas diferentes geram somas separadas, maior primeiro", () => {
  const totals = computeBudgetTotals([
    row({ budget_daily: 1000, budget_currency: "USD" }), // 10
    row({ budget_daily: 50000, budget_currency: "BRL" }), // 500
  ]);

  assert.deepEqual(
    totals.byCurrency.map((g) => g.currency),
    ["BRL", "USD"],
  );
  assert.equal(formatBudgetTotals(totals, fmt), "BRL 500.00/dia · USD 10.00/dia");
});

test("nenhuma linha com orçamento próprio: string vazia (header não mostra linha)", () => {
  const totals = computeBudgetTotals([row({ budget_mode: "abo" })]);
  assert.equal(totals.byCurrency.length, 0);
  assert.equal(formatBudgetTotals(totals, fmt), "");
});

// ── Ajuste em massa ─────────────────────────────────────────────────────────

const campaign = (id: string, fields: Record<string, unknown>) =>
  row({ campaign_id: id, campaign_name: `Campanha ${id}`, budget_currency: "BRL", ...fields });

test("seleção separa quem entra, quem tem orçamento no outro nível e quem não sincronizou", () => {
  const sel = analyzeBulkBudgetSelection(
    [
      campaign("c1", { budget_daily: 10000, budget_mode: "cbo" }),
      campaign("c2", { budget_mode: "abo" }), // ABO: orçamento nos conjuntos
      campaign("c3", {}), // sem snapshot
    ],
    "campaign",
  );
  assert.deepEqual(sel.eligible.map((r) => r.id), ["c1"]);
  assert.deepEqual(sel.elsewhere.map((r) => r.id), ["c2"]);
  assert.deepEqual(sel.unknown.map((r) => r.id), ["c3"]);
  assert.equal(sel.moneyBlockedReason, null);
  assert.equal(sel.kind, "daily");
});

test("diário e total misturados bloqueiam os modos em dinheiro; moeda mista também", () => {
  const mixedKind = analyzeBulkBudgetSelection(
    [campaign("c1", { budget_daily: 10000 }), campaign("c2", { budget_lifetime: 500000 })],
    "campaign",
  );
  assert.equal(mixedKind.moneyBlockedReason, "mixed-kind");
  assert.equal(mixedKind.kind, null);

  const mixedCurrency = analyzeBulkBudgetSelection(
    [campaign("c1", { budget_daily: 10000 }), campaign("c2", { budget_daily: 1000, budget_currency: "USD" })],
    "campaign",
  );
  assert.equal(mixedCurrency.moneyBlockedReason, "mixed-currency");
});

test("aba por conjunto lê id e nome do conjunto", () => {
  const sel = analyzeBulkBudgetSelection([row({ adset_id: "a1", adset_name: "Conjunto 1", campaign_id: "c9", budget_daily: 500 })], "adset");
  assert.deepEqual(sel.eligible.map((r) => [r.id, r.name]), [["a1", "Conjunto 1"]]);
});

test("percentual arredonda ao centavo com meio para cima, igual ao backend", () => {
  assert.equal(applyBudgetPercent(3333, 15), 3833); // 38,3295 → 38,33
  assert.equal(applyBudgetPercent(1003, 50), 1505); // 1504,5 → 1505 (bancário daria 1504)
  assert.equal(applyBudgetPercent(10000, 10.1), 11010);
  // 50 × 1,15 = 57,5 exato, mas em float é 57,4999… e Math.round daria 57
  assert.equal(applyBudgetPercent(50, 15), 58);
  assert.equal(applyBudgetPercent(10000, -20), 8000);
});

test("prévia marca mudança grande (>25%), sem mudança e resultado inválido", () => {
  const rows = analyzeBulkBudgetSelection(
    [campaign("c1", { budget_daily: 10000 }), campaign("c2", { budget_daily: 3000 })],
    "campaign",
  ).eligible;

  const delta = previewBulkBudget(rows, { mode: "delta", amountMinor: -3000, kind: "daily" });
  assert.deepEqual(delta.map((r) => [r.newMinor, r.status, r.big]), [
    [7000, "change", true], // −30%: acima dos 25%
    [0, "invalid", false],
  ]);

  const fixed = previewBulkBudget(rows, { mode: "fixed", amountMinor: 10000, kind: "daily" });
  assert.deepEqual(fixed.map((r) => [r.status, r.big]), [
    ["unchanged", false],
    ["change", true], // 30 → 100: +233%
  ]);

  const pct = previewBulkBudget(rows, { mode: "percent", percent: 25 });
  assert.equal(pct[0].big, false); // exatamente 25% não avisa
  assert.equal(previewBulkBudget(rows, { mode: "percent", percent: 26 })[0].big, true);
  assert.equal(previewBulkBudget(rows, { mode: "percent", percent: -26 })[0].big, true); // reduzir também conta
});

test("parse aceita sinal, vírgula decimal e milhar", () => {
  assert.equal(parseSignedDecimal("-20"), -20);
  assert.equal(parseSignedDecimal("+15"), 15);
  assert.equal(parseSignedDecimal("10,5"), 10.5);
  assert.equal(parseSignedDecimal("1.500,50"), 1500.5);
  assert.equal(parseSignedDecimal("150.50"), 150.5);
  assert.equal(parseSignedDecimal("-"), null);
  assert.equal(parseSignedDecimal("abc"), null);
  assert.equal(parseSignedDecimal("1-2"), null);
});

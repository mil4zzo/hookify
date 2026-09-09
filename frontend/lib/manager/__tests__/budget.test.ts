import test from "node:test";
import assert from "node:assert/strict";
import { computeBudgetTotals, formatBudgetTotals } from "../budget";

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

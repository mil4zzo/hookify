import test from "node:test";
import assert from "node:assert/strict";

import { useSettingsStore } from "@/lib/store/settings";
import { formatCurrency } from "@/lib/utils/currency";

const setLanguage = (language: string) => useSettingsStore.setState((s) => ({ settings: { ...s.settings, language } }));
const flat = (text: string) => text.replace(/\s/g, " ");

test("o idioma decide o formato do número; a moeda da conta decide só o símbolo", () => {
  try {
    setLanguage("pt-BR");
    assert.equal(flat(formatCurrency(1234.5, "BRL")), "R$ 1.234,50");
    assert.equal(flat(formatCurrency(1234.5, "USD")), "US$ 1.234,50", "conta em dólar, app em português");

    setLanguage("en-US");
    assert.equal(flat(formatCurrency(1234.5, "USD")), "$1,234.50");
    assert.equal(flat(formatCurrency(1234.5, "BRL")), "R$1,234.50", "conta em reais, app em inglês");
  } finally {
    setLanguage("pt-BR");
  }
});

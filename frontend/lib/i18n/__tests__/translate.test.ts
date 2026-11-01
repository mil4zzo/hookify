import test from "node:test";
import assert from "node:assert/strict";

import { useSettingsStore } from "@/lib/store/settings";
import { translate } from "../translate";
import { LEAD_ECONOMICS_UNAVAILABLE_TEXT } from "@/components/manager/LeadEconomicsCell";

const setLanguage = (language: string) => useSettingsStore.setState((s) => ({ settings: { ...s.settings, language } }));

test("texto fora de componente segue o idioma na hora da leitura, com plural", () => {
  try {
    setLanguage("pt-BR");
    assert.equal(translate("manager.leadEconomics.scored", { count: 1 }), "1 lead com nota");
    assert.equal(translate("manager.leadEconomics.scored", { count: 5 }), "5 leads com nota");
    const ptText = LEAD_ECONOMICS_UNAVAILABLE_TEXT["no-economics"];

    setLanguage("en-US");
    assert.equal(translate("manager.leadEconomics.scored", { count: 1 }), "1 scored lead");
    assert.equal(translate("manager.leadEconomics.scored", { count: 5 }), "5 scored leads");
    assert.notEqual(LEAD_ECONOMICS_UNAVAILABLE_TEXT["no-economics"], ptText, "o getter relê o idioma, não congela o do carregamento");

    setLanguage("es-ES");
    assert.equal(translate("manager.leadEconomics.scored", { count: 2 }), "2 leads com nota", "sem tradução cai no português");
  } finally {
    setLanguage("pt-BR");
  }
});

import test from "node:test";
import assert from "node:assert/strict";

import { useSettingsStore } from "@/lib/store/settings";
import { translate } from "../translate";

const setLanguage = (language: string) => useSettingsStore.setState((s) => ({ settings: { ...s.settings, language } }));
const noun = (kind: string, count: number) => translate("bulk.noun", { kind, count });

test("pausar/ativar em massa: gênero e número concordam em português (campanha é feminino)", () => {
  setLanguage("pt-BR");
  try {
    assert.equal(translate("bulk.done", { count: 1, noun: noun("ad", 1), action: "pause", kind: "ad" }), "1 anúncio pausado.");
    assert.equal(translate("bulk.done", { count: 3, noun: noun("campaign", 3), action: "activate", kind: "campaign" }), "3 campanhas ativadas.");
    assert.equal(translate("manager.bulk.pauseMessage", { count: 1, noun: noun("campaign", 1), kind: "campaign" }), "A veiculação desta campanha será interrompida no Meta imediatamente.");
    assert.equal(translate("manager.bulk.activateMessage", { count: 2, noun: noun("adset", 2), kind: "adset" }), "Estes conjuntos voltarão a veicular no Meta (exceto os bloqueados por campanha/conjunto pausado).");
    assert.equal(translate("bulk.delivery.DISAPPROVED", { kind: "campaign", noun: noun("campaign", 1) }), "Ativada, mas a campanha foi reprovada pelo Meta e não vai veicular. Veja o motivo no Gerenciador de Anúncios.");

    setLanguage("en-US");
    assert.equal(translate("bulk.done", { count: 3, noun: noun("adset", 3), action: "pause", kind: "adset" }), "3 ad sets paused.");
    assert.equal(translate("manager.bulk.pauseMessage", { count: 1, noun: noun("ad", 1), kind: "ad" }), "Delivery of this ad will be stopped on Meta immediately.");
    assert.equal(translate("bulk.delivery.PREAPPROVED", { kind: "ad", noun: noun("ad", 1) }), "Activated. The ad was pre-approved and will start delivering shortly.");
  } finally {
    setLanguage("pt-BR");
  }
});

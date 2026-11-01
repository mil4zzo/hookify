import test from "node:test";
import assert from "node:assert/strict";

import { useSettingsStore } from "@/lib/store/settings";
import { DEFAULT_LOCALE, formatLocaleDate, formatLocaleNumber, getAppLocale } from "../locale";

const setLanguage = (language: string) => useSettingsStore.setState((s) => ({ settings: { ...s.settings, language } }));

test("o idioma das configurações dirige número e data", () => {
  try {
    setLanguage("pt-BR");
    assert.equal(getAppLocale(), "pt-BR");
    assert.equal(formatLocaleNumber(1234567), "1.234.567");
    assert.equal(formatLocaleDate("2026-10-31T12:00:00Z", { timeZone: "UTC" }), "31/10/2026");

    setLanguage("en-US");
    assert.equal(getAppLocale(), "en-US");
    assert.equal(formatLocaleNumber(1234567), "1,234,567");
    assert.equal(formatLocaleDate("2026-10-31T12:00:00Z", { timeZone: "UTC" }), "10/31/2026");

    setLanguage("es-ES");
    assert.equal(formatLocaleDate("2026-10-31T12:00:00Z", { timeZone: "UTC" }), "31/10/2026");
  } finally {
    setLanguage(DEFAULT_LOCALE);
  }
});

test("idioma vazio ou desconhecido cai no padrão, nunca quebra o Intl", () => {
  try {
    for (const bad of ["", "xx", "klingon", "pt_BR"]) {
      setLanguage(bad);
      assert.equal(getAppLocale(), DEFAULT_LOCALE, bad);
      assert.equal(formatLocaleNumber(1000), "1.000");
    }
  } finally {
    setLanguage(DEFAULT_LOCALE);
  }
});

test("idioma de quem lê vem do navegador; sem idioma conhecido, o padrão", async () => {
  const { pickLocale, setLocaleOverride } = await import("../locale");
  assert.equal(pickLocale(["en-GB", "pt-BR"]), "en-US");
  assert.equal(pickLocale(["fr-FR", "pt-PT"]), "pt-BR");
  assert.equal(pickLocale(["fr-FR", "ja"]), DEFAULT_LOCALE);
  assert.equal(pickLocale([]), DEFAULT_LOCALE);
  try {
    setLocaleOverride("en-US");
    assert.equal(getAppLocale(), "en-US", "o idioma de quem lê vale mesmo com a conta em português");
  } finally {
    setLocaleOverride(null);
  }
  assert.equal(getAppLocale(), "pt-BR");
});

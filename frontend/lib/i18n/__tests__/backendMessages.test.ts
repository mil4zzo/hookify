import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { useSettingsStore } from "@/lib/store/settings";
import { parseError } from "@/lib/utils/errors";
import { BACKEND_MESSAGES, normalizeBackendMessage, translateBackendMessage } from "../backendMessages";

const setLanguage = (language: string) => useSettingsStore.setState((s) => ({ settings: { ...s.settings, language } }));

test("a mesma mensagem casa com acento, sem acento e com acento quebrado", () => {
  const expected = normalizeBackendMessage("Pack não encontrado");
  for (const variant of ["Pack nao encontrado", "Pack nÃ£o encontrado", "Pack nÃƒÂ£o encontrado", "pack não encontrado."]) {
    assert.equal(normalizeBackendMessage(variant), expected, variant);
  }
});

test("mensagem conhecida segue o idioma; desconhecida passa como veio", () => {
  try {
    setLanguage("en-US");
    assert.equal(translateBackendMessage("Pack nao encontrado"), "Pack not found.");
    assert.equal(translateBackendMessage("Algo que o backend inventou"), "Algo que o backend inventou");
    setLanguage("pt-BR");
    assert.equal(translateBackendMessage("Pack nÃ£o encontrado"), "Pack não encontrado.", "em português também conserta o acento quebrado");
  } finally {
    setLanguage("pt-BR");
  }
});

test("parseError traduz o detail de string e o detail estruturado", () => {
  try {
    setLanguage("en-US");
    const plain = parseError({ response: { status: 404, data: { detail: "Pasta nao encontrada" } } });
    assert.equal(plain.message, "Folder not found.");
    const structured = parseError({ response: { status: 404, data: { detail: { code: "X", message: "Tag nao encontrada." } } } });
    assert.equal(structured.message, "Tag not found.");
    assert.equal(structured.code, "X", "o código estruturado é preservado");
  } finally {
    setLanguage("pt-BR");
  }
});

function pythonSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "__pycache__" ? [] : pythonSources(full);
    return name.endsWith(".py") ? [readFileSync(full, "utf8")] : [];
  });
}

test("cada texto da lista ainda existe no backend (senão a tradução ficou órfã)", () => {
  const backend = pythonSources(join(process.cwd(), "..", "backend", "app"))
    .flatMap((source) => source.split(/\r?\n/)) // por linha: o acento quebrado só se desfaz em texto uniforme
    .map((line) => normalizeBackendMessage(line))
    .join("\n");
  const missing = BACKEND_MESSAGES.filter(([text]) => !backend.includes(normalizeBackendMessage(text))).map(([text]) => text);
  assert.deepEqual(missing, [], "texto da lista que o backend não tem mais");
});

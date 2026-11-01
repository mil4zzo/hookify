import test from "node:test";
import assert from "node:assert/strict";

import { flattenKeys, getMessages, getRawCatalog, mergeMessages } from "../messages";

test("inglês tem exatamente as mesmas chaves do português (nada some, nada sobra)", () => {
  const pt = flattenKeys(getRawCatalog("pt-BR")).sort();
  const en = flattenKeys(getRawCatalog("en-US")).sort();
  assert.deepEqual(en.filter((key) => !pt.includes(key)), [], "chave só no inglês (typo ou resto)");
  assert.deepEqual(pt.filter((key) => !en.includes(key)), [], "chave sem tradução em inglês");
});

test("o que falta num idioma cai no português, nunca em branco", () => {
  const merged = mergeMessages({ a: { x: "um", y: "dois" }, b: "tres" }, { a: { y: "two" } });
  assert.deepEqual(merged, { a: { x: "um", y: "two" }, b: "tres" });
  assert.equal((getMessages("es-ES") as any).common.back, "Voltar", "espanhol sem tradução mostra português");
  assert.equal((getMessages("en-US") as any).common.back, "Back");
});

test("nenhum texto vazio nos catálogos, e as marcações <b> abrem e fecham", () => {
  for (const locale of ["pt-BR", "en-US"] as const) {
    const walk = (node: unknown, path: string) => {
      if (typeof node === "string") {
        assert.ok(node.trim().length > 0, `${locale}:${path} vazio`);
        const opens = (node.match(/<b>/g) ?? []).length;
        const closes = (node.match(/<\/b>/g) ?? []).length;
        assert.equal(opens, closes, `${locale}:${path} marcação <b> desbalanceada`);
      } else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    };
    walk(getRawCatalog(locale), "");
  }
});

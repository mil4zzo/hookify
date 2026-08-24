import assert from "node:assert/strict";
import test from "node:test";

import { nextTagColor, TAG_COLORS } from "@/lib/tags/colors";
import { isTagNameTaken, normalizeTagName } from "@/lib/tags/naming";

// Estes casos foram rodados contra a coluna gerada `tags.slug` no Postgres
// (migration 116) e devem produzir exatamente o mesmo resultado aqui. Divergir
// significa oferecer "Criar" de algo que o unique index rejeita com 409.
const CASOS_DO_BANCO: [string, string][] = [
  ["Black Friday", "black friday"],
  ["black  friday", "black friday"],
  ["BLACK FRIDAY ", "black friday"],
  ["Ação Direta", "acao direta"],
  ["acao direta", "acao direta"],
  ["Hook Dor", "hook dor"],
  ["Teste A/B", "teste a/b"],
];

test("normalizeTagName espelha o slug gerado no banco", () => {
  for (const [entrada, slug] of CASOS_DO_BANCO) {
    assert.equal(normalizeTagName(entrada), slug, `entrada: ${entrada}`);
  }
});

test("nome duplicado e detectado por caixa, espaco e acento", () => {
  const existentes = ["Black Friday", "Ação Direta"];
  assert.equal(isTagNameTaken("black  friday", existentes), true);
  assert.equal(isTagNameTaken("BLACK FRIDAY", existentes), true);
  assert.equal(isTagNameTaken("acao direta", existentes), true);
  // Nome realmente novo continua podendo ser criado.
  assert.equal(isTagNameTaken("Hook Dor", existentes), false);
  // Vazio nunca "colide": quem trata isso e a validacao de campo obrigatorio.
  assert.equal(isTagNameTaken("   ", existentes), false);
});

test("nextTagColor rotaciona a paleta e nunca sai dela", () => {
  assert.equal(nextTagColor(0), TAG_COLORS[0]);
  assert.equal(nextTagColor(TAG_COLORS.length), TAG_COLORS[0]);
  assert.equal(nextTagColor(TAG_COLORS.length + 2), TAG_COLORS[2]);
  // Entradas degeneradas nao podem produzir undefined: a cor vai para o banco,
  // que so aceita a paleta fechada.
  for (const entrada of [-1, NaN, Infinity, 1.7]) {
    assert.ok(TAG_COLORS.includes(nextTagColor(entrada)), `entrada: ${entrada}`);
  }
});

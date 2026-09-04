import assert from "node:assert/strict";
import test from "node:test";

import { extractErrorDetail } from "../errorMessage";

// O formato que o interceptor do apiClient de fato rejeita (AppError).
test("usa a message do AppError rejeitado pelo interceptor", () => {
  const appError = { status: 500, message: "Internal Server Error", code: "HTTP_ERROR" };
  assert.equal(extractErrorDetail(appError), "Internal Server Error");
});

test("preserva o detail que o backend explicou (já traduzido pelo parseError)", () => {
  const appError = {
    status: 422,
    message: "Criativos não encontrados na sua conta: ADNV89",
    code: "HTTP_ERROR",
  };
  assert.equal(extractErrorDetail(appError), "Criativos não encontrados na sua conta: ADNV89");
});

// Regressão 2026-09-04: o dialog lia o formato do axios cru e, para o AppError
// acima, achava undefined em toda falha — o backend explicava e a tela dizia
// "Tente novamente em instantes."
test("AppError nunca cai no texto genérico", () => {
  const appError = { status: 500, message: "Internal Server Error", code: "HTTP_ERROR" };
  assert.notEqual(extractErrorDetail(appError), "Tente novamente em instantes.");
});

test("ainda entende o erro cru do axios (chamada fora do interceptor)", () => {
  const raw = { response: { data: { detail: "Máximo de 20 criativos por link" } } };
  assert.equal(extractErrorDetail(raw), "Máximo de 20 criativos por link");
});

test("entende Error nativo", () => {
  assert.equal(extractErrorDetail(new Error("boom")), "boom");
});

test("cai no fallback só quando não há mensagem alguma", () => {
  assert.equal(extractErrorDetail(undefined), "Tente novamente em instantes.");
  assert.equal(extractErrorDetail({}), "Tente novamente em instantes.");
  assert.equal(extractErrorDetail({ message: "   " }), "Tente novamente em instantes.");
});

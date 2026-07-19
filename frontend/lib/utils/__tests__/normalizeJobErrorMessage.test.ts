import test from "node:test";
import assert from "node:assert/strict";
import { normalizeJobErrorMessage } from "../errors";

test("remove prefixos 'Erro:' acumulados pelas camadas do backend", () => {
  const { message } = normalizeJobErrorMessage("Erro: Erro: Falha ao ler a planilha.");
  assert.equal(message, "Falha ao ler a planilha.");
});

test("separa repr de exceção Python para a linha de diagnóstico", () => {
  const raw =
    "Erro: Erro ao ler planilha do Google: ('Connection aborted.', ConnectionResetError(10054, 'Foi forçado o cancelamento', None, 10054, None))";
  const { message, diagnostic } = normalizeJobErrorMessage(raw);

  assert.equal(message, "Erro ao ler planilha do Google");
  assert.ok(diagnostic?.startsWith("('Connection aborted.'"));
  assert.ok(!message.includes("ConnectionResetError"));
});

test("separa exceção nomeada sem parênteses de tupla", () => {
  const { message, diagnostic } = normalizeJobErrorMessage(
    "Falha ao executar atualização em lote: KeyError('ad_id')",
  );
  assert.equal(message, "Falha ao executar atualização em lote");
  assert.equal(diagnostic, "KeyError('ad_id')");
});

test("mensagem já legível passa intacta e sem diagnóstico", () => {
  const { message, diagnostic } = normalizeJobErrorMessage(
    "Falha de conexão com o Google Sheets. Tente novamente em alguns instantes.",
  );
  assert.equal(message, "Falha de conexão com o Google Sheets. Tente novamente em alguns instantes.");
  assert.equal(diagnostic, undefined);
});

test("vazio/nulo cai no fallback fornecido", () => {
  assert.equal(normalizeJobErrorMessage("", "Falhou.").message, "Falhou.");
  assert.equal(normalizeJobErrorMessage(null, "Falhou.").message, "Falhou.");
  assert.equal(normalizeJobErrorMessage("   ", "Falhou.").message, "Falhou.");
});

test("mensagem que é só o repr técnico mantém o texto (não vira fallback vazio)", () => {
  const { message } = normalizeJobErrorMessage("ValueError('x')", "Falhou.");
  assert.equal(message, "ValueError('x')");
});

test("diagnóstico muito longo é truncado", () => {
  const longTail = `RuntimeError('${"x".repeat(500)}')`;
  const { diagnostic } = normalizeJobErrorMessage(`Falha na importação: ${longTail}`);
  assert.ok(diagnostic && diagnostic.length <= 241, `diagnóstico tem ${diagnostic?.length} chars`);
  assert.ok(diagnostic?.endsWith("…"));
});

import test from "node:test";
import assert from "node:assert/strict";
import { createLeadEconomicsDraft, validateLeadEconomicsDraft, type LeadEconomicsDraft } from "../leadEconomicsDraft";
import {
  LEAD_ECONOMICS_BANDS_CSV_TEMPLATE,
  decodeCsvBytes,
  importLeadEconomicsBandsCsv,
  parseBandFloor,
} from "../leadEconomicsCsv";

/**
 * Importar faixas de um CSV: o arquivo vira o rascunho do editor (faixas trocadas,
 * produtos mantidos e completados). Formato tolerante: separador, cabeçalho, jeito
 * de escrever a nota e codificação variam com quem exportou.
 */

function fresh(): LeadEconomicsDraft {
  return createLeadEconomicsDraft(null);
}

function ok(result: ReturnType<typeof importLeadEconomicsBandsCsv>) {
  assert.equal(result.kind, "ok", result.kind === "error" ? result.message : "");
  return result as Extract<typeof result, { kind: "ok" }>;
}

const bandsOf = (draft: LeadEconomicsDraft) =>
  draft.bands.map((band) => [band.min, band.conversion, draft.products.find((p) => p.id === band.product)?.name ?? "?"]);

test("o modelo para baixar importa como está", () => {
  const r = ok(importLeadEconomicsBandsCsv(LEAD_ECONOMICS_BANDS_CSV_TEMPLATE, fresh()));
  assert.deepEqual(bandsOf(r.draft), [
    ["", "0,5", "Ebook"],
    ["60", "4", "Mentoria"],
    ["80", "12", "Mentoria"],
  ]);
  assert.deepEqual(r.newProducts, ["Ebook", "Mentoria"]);
  assert.equal(r.draft.products.length, 2, "o produto em branco do 'Configurar' é reaproveitado");
});

test("nota: piso de número, intervalo, '+', 'ou mais', e a faixa de baixo", () => {
  assert.equal(parseBandFloor("60"), 60);
  assert.equal(parseBandFloor("60 a 79"), 60);
  assert.equal(parseBandFloor("60-79,9"), 60);
  assert.equal(parseBandFloor("80+"), 80);
  assert.equal(parseBandFloor("≥ 80"), 80);
  assert.equal(parseBandFloor("0,875"), 0.875, "escala de 0 a 1 com vírgula decimal");
  assert.equal(parseBandFloor("Abaixo de 60"), null);
  assert.equal(parseBandFloor("< 60"), null);
  assert.equal(parseBandFloor("até 59"), null);
  assert.equal(parseBandFloor(""), null);
  assert.equal(parseBandFloor("frio"), undefined);
});

test("sem cabeçalho, vírgula como separador, fora de ordem: ordena e lê nota/conversão/produto", () => {
  const csv = "80,12%,Mentoria\n0,0.5,Ebook\n60,4,Mentoria";
  const r = ok(importLeadEconomicsBandsCsv(csv, fresh()));
  assert.deepEqual(bandsOf(r.draft), [
    ["", "0,5", "Ebook"],
    ["60", "4", "Mentoria"],
    ["80", "12", "Mentoria"],
  ]);
  assert.equal(r.warnings.some((w) => w.includes("abaixo de")), false, "piso 0 não precisa de aviso");
});

test("cabeçalho em qualquer ordem e com acento; separador ;", () => {
  const csv = "Produto;Taxa de conversão;Nota mínima\nMentoria;4,5;60\nMentoria;10;80\nEbook;0,5;";
  const r = ok(importLeadEconomicsBandsCsv(csv, fresh()));
  assert.deepEqual(bandsOf(r.draft), [
    ["", "0,5", "Ebook"],
    ["60", "4,5", "Mentoria"],
    ["80", "10", "Mentoria"],
  ]);
});

test("o resultado passa no contrato quando os produtos estão preenchidos", () => {
  const base = fresh();
  base.products[0] = { ...base.products[0], name: "Mentoria", ticket: "3000", contribution: "55", target: "40" };
  const r = ok(importLeadEconomicsBandsCsv("nota;conversao\n;0,5\n60;4\n80;12", base));
  assert.deepEqual(r.newProducts, []);
  assert.deepEqual(validateLeadEconomicsDraft(r.draft).errors, []);
});

test("produtos: casa pelo nome (caixa e espaços não importam) e só cria o que falta", () => {
  const base = fresh();
  base.products[0] = { ...base.products[0], name: "Mentoria", ticket: "3000", contribution: "55", target: "40" };
  const r = ok(importLeadEconomicsBandsCsv("nota;conversao;produto\n;1;Ebook\n70;5;  mentoria ", base));
  assert.equal(r.draft.products.length, 2);
  assert.equal(r.draft.products[0].ticket, "3000", "produto existente fica intacto");
  assert.deepEqual(r.newProducts, ["Ebook"]);
  assert.ok(r.warnings.some((w) => w.includes("preencha ticket")));
});

test("piso acima de zero sem faixa de baixo: avisa que a primeira faixa cobre as notas abaixo", () => {
  const r = ok(importLeadEconomicsBandsCsv("nota;conversao\n30;1\n60;4", fresh()));
  assert.equal(r.draft.bands[0].min, "", "a primeira faixa não tem piso");
  assert.ok(r.warnings.some((w) => w.includes("abaixo de 30")));
});

test("conversões que parecem fração geram aviso; com % não", () => {
  const frac = ok(importLeadEconomicsBandsCsv("nota;conversao\n;0,005\n60;0,04", fresh()));
  assert.ok(frac.warnings.some((w) => w.includes("multiplique por 100")));
  const pct = ok(importLeadEconomicsBandsCsv("nota;conversao\n;0,5%\n60;0,9%", fresh()));
  assert.equal(pct.warnings.some((w) => w.includes("multiplique")), false);
});

test("erros: arquivo vazio, só cabeçalho, nota ilegível, conversão ilegível, duas sem piso, nota repetida", () => {
  const err = (csv: string) => {
    const r = importLeadEconomicsBandsCsv(csv, fresh());
    assert.equal(r.kind, "error", csv);
    return (r as { message: string }).message;
  };
  assert.match(err(" \n "), /vazio/);
  assert.match(err("nota;conversao"), /só o cabeçalho/);
  assert.match(err("nota;conversao\nfrio;1"), /Linha 2: não deu para ler a nota "frio"/);
  assert.match(err("nota;conversao\n60;alta"), /Linha 2: a conversão "alta"/);
  assert.match(err("nota;conversao\n;1\nabaixo de 50;2"), /Só uma faixa pode não ter nota mínima/);
  assert.match(err("nota;conversao\n;1\n60;2\n60 a 79;3"), /Duas faixas começam na nota 60/);
});

test("faixas não têm teto: um arquivo com 11 e com 300 linhas importa inteiro", () => {
  for (const quantidade of [11, 300]) {
    const csv = ["nota;conversao", ...Array.from({ length: quantidade }, (_, i) => `${i};1`)].join("\n");
    const result = ok(importLeadEconomicsBandsCsv(csv, fresh()));
    assert.equal(result.bandCount, quantidade, `${quantidade} linhas`);
    assert.equal(result.draft.bands.length, quantidade);
  }
});

test("arquivo do Excel em Windows-1252 é lido com acento", () => {
  const latin1 = new Uint8Array([0x43, 0x6f, 0x6e, 0x76, 0x65, 0x72, 0x73, 0xe3, 0x6f]); // "Conversão"
  assert.equal(decodeCsvBytes(latin1.buffer), "Conversão");
  const utf8 = new TextEncoder().encode("Conversão");
  assert.equal(decodeCsvBytes(utf8.buffer as ArrayBuffer), "Conversão");
});

test("BOM e aspas com separador dentro", () => {
  const r = ok(importLeadEconomicsBandsCsv('﻿nota,conversao,produto\n,"0,5",Ebook\n60,"4,5","Mentoria, turma 2"', fresh()));
  assert.deepEqual(bandsOf(r.draft), [
    ["", "0,5", "Ebook"],
    ["60", "4,5", "Mentoria, turma 2"],
  ]);
});

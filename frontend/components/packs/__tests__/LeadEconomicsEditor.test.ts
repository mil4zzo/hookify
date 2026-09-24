import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  LeadEconomicsEditor,
  focusKeyAfterRemoval,
  formatLeadEconomicsMoney,
  leadEconomicsCurrencySymbol,
  productDisplayName,
  productTrashClick,
  type LeadEconomicsEditorProps,
} from "../LeadEconomicsEditor";
import { LEAD_ECONOMICS_MESSAGES as M } from "@/lib/utils/leadEconomics";
import {
  LEAD_ECONOMICS_FIELD_MESSAGES as F,
  LEAD_ECONOMICS_UNREADABLE_CUT_MESSAGE,
  parseMoneyInput,
  type LeadEconomicsDraft,
} from "@/lib/utils/leadEconomicsDraft";

/**
 * Editor da economia do lead: o que a tela ENTREGA ao leitor de tela e ao olho —
 * erro marcado no campo certo, região viva montada antes do conteúdo, teto com
 * nome, dinheiro no padrão brasileiro na moeda da conta, substituto de "sem nome"
 * que não parece nome. As regras (quando há erro, qual mensagem) são do
 * leadEconomicsDraft e têm teste lá; aqui é a ligação delas com a marcação.
 *
 * Render no servidor (renderToStaticMarkup): o projeto não tem DOM de teste. O que
 * depende de DOM vivo (foco) tem a decisão testada como função pura.
 */

// O tsx compila o JSX do componente no modo clássico (React.createElement).
(globalThis as { React?: typeof React }).React = React;

const NBSP = "\u00a0"; // espaço que o Intl põe entre o símbolo e o número

function render(props: Partial<LeadEconomicsEditorProps> & { value: LeadEconomicsDraft }): string {
  return renderToStaticMarkup(
    React.createElement(LeadEconomicsEditor, { onChange: () => {}, mqlLeadscoreMin: 70, currency: "BRL", ...props }),
  );
}

/** A tag de abertura do elemento que tem este atributo exato (primeira ocorrência). */
function tagWith(html: string, attribute: string): string {
  const at = html.indexOf(attribute);
  assert.ok(at >= 0, `nenhum elemento com ${attribute}`);
  const start = html.lastIndexOf("<", at);
  const end = html.indexOf(">", at);
  return html.slice(start, end + 1);
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? match[1] : null;
}

/** Texto do elemento com este id (a mensagem curta apontada pelo aria-describedby). */
function textOfId(html: string, id: string): string {
  const match = html.match(new RegExp(`id="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>([^<]*)<`));
  assert.ok(match, `nenhum elemento com id="${id}"`);
  return match[1];
}

/** Campo marcado com erro: aria-invalid e aria-describedby apontando para `message`. */
function assertFieldIssue(html: string, label: string, message: string) {
  const tag = tagWith(html, `aria-label="${label}"`);
  assert.equal(attr(tag, "aria-invalid"), "true", `${label}: aria-invalid`);
  const describedBy = attr(tag, "aria-describedby");
  assert.ok(describedBy, `${label}: sem aria-describedby`);
  assert.equal(textOfId(html, describedBy), message, `${label}: mensagem do campo`);
}

function assertFieldClean(html: string, label: string) {
  const tag = tagWith(html, `aria-label="${label}"`);
  assert.equal(attr(tag, "aria-invalid"), null, `${label}: não devia estar marcado`);
  assert.equal(attr(tag, "aria-describedby"), null, `${label}: não devia apontar mensagem`);
}

/** Dois produtos, três faixas (70 e 80): o "Curso" não se paga e a faixa do meio tem 150%. */
function draftWithMistakes(): LeadEconomicsDraft {
  return {
    products: [
      { id: "p1", name: "Mentoria", ticket: "3.000", contribution: "55", target: "40" },
      { id: "p2", name: "Curso", ticket: "500", contribution: "30", target: "30" },
    ],
    bands: [
      { key: "b1", min: "", product: "p2", conversion: "0,5" },
      { key: "b2", min: "70", product: "p2", conversion: "150" },
      { key: "b3", min: "80", product: "p1", conversion: "" },
    ],
  };
}

// ── Peças puras ──────────────────────────────────────────────────────────────

test("dinheiro no padrão brasileiro com a moeda da conta: vírgula decimal, nunca \"$1,500.00\"", () => {
  assert.equal(formatLeadEconomicsMoney(1500, "USD"), `US$${NBSP}1.500,00`);
  assert.equal(formatLeadEconomicsMoney(18, "BRL"), `R$${NBSP}18,00`);
  assert.equal(formatLeadEconomicsMoney(1500, "EUR"), `€${NBSP}1.500,00`);
  assert.equal(formatLeadEconomicsMoney(0.5, "usd"), `US$${NBSP}0,50`, "código em minúscula também vale");
  // Código que o Intl recusa não derruba a tela: número puro com o código.
  assert.equal(formatLeadEconomicsMoney(1500, "DOLAR"), "DOLAR 1.500,00");
  assert.equal(formatLeadEconomicsMoney(1500, ""), "1.500,00");
  // Copiar o teto para o campo de ticket devolve o mesmo número (o campo lê vírgula decimal).
  for (const currency of ["USD", "BRL", "EUR"]) {
    assert.equal(parseMoneyInput(formatLeadEconomicsMoney(1234.5, currency)), 1234.5, currency);
  }
});

test("prefixo do ticket: o símbolo da moeda da conta, no mesmo padrão", () => {
  assert.equal(leadEconomicsCurrencySymbol("USD"), "US$");
  assert.equal(leadEconomicsCurrencySymbol("BRL"), "R$");
  assert.equal(leadEconomicsCurrencySymbol("EUR"), "€");
  assert.equal(leadEconomicsCurrencySymbol("DOLAR"), "DOLAR");
});

test("produto sem nome: substituto que não parece um nome digitado", () => {
  assert.deepEqual(productDisplayName({ name: "Curso" }, 1), { text: "Curso", unnamed: false });
  assert.deepEqual(productDisplayName({ name: "  Curso  " }, 1), { text: "Curso", unnamed: false });
  assert.deepEqual(productDisplayName({ name: "" }, 1), { text: "Sem nome (produto 2)", unnamed: true });
  assert.deepEqual(productDisplayName({ name: "   " }, 0), { text: "Sem nome (produto 1)", unnamed: true });
});

test("foco depois de remover: lixeira da vizinha de baixo, a de cima na última, \"Adicionar\" se sobra uma", () => {
  assert.equal(focusKeyAfterRemoval(["a", "b", "c"], 0), "b");
  assert.equal(focusKeyAfterRemoval(["a", "b", "c"], 1), "c");
  assert.equal(focusKeyAfterRemoval(["a", "b", "c"], 2), "b");
  // Sobra uma linha: ela não tem lixeira (não se remove a única) → null = botão "Adicionar".
  assert.equal(focusKeyAfterRemoval(["a", "b"], 0), null);
  assert.equal(focusKeyAfterRemoval(["a", "b"], 1), null);
  assert.equal(focusKeyAfterRemoval(["a", "b", "c"], 3), null, "índice fora da lista");
  assert.equal(focusKeyAfterRemoval(["a", "b", "c"], -1), null);
});

test("lixeira de produto: remover OUTRO produto na hora fecha a pergunta \"Mover para\" aberta (sem pergunta zumbi)", () => {
  // p1 é usado pelas faixas 2 e 3; p2 pela 1; p3 por nenhuma.
  const draft: LeadEconomicsDraft = {
    ...draftWithMistakes(),
    products: [...draftWithMistakes().products, { id: "p3", name: "Ebook", ticket: "", contribution: "", target: "" }],
  };
  draft.bands[1].product = "p1";
  const askingP1 = { productId: "p1", moveTo: "p2" };

  // O achado: com a pergunta de p1 aberta, a lixeira de p3 removia p3 e a pergunta
  // de p1 ficava guardada — escondida quando sobrava um produto só, e de volta
  // sozinha (roubando o foco) ao adicionar outro.
  assert.deepEqual(productTrashClick(draft, "p3", askingP1), { removeNow: true, refocusQuestion: false, pending: null });
  // Produto em uso: a pergunta dele toma o lugar da outra.
  assert.deepEqual(productTrashClick(draft, "p2", askingP1), { removeNow: false, refocusQuestion: false, pending: { productId: "p2", moveTo: "p1" } });
  // A mesma lixeira de novo: só devolve o foco à pergunta, que continua com o destino escolhido.
  const chosen = { productId: "p1", moveTo: "p3" };
  assert.deepEqual(productTrashClick(draft, "p1", chosen), { removeNow: false, refocusQuestion: true, pending: chosen });
  // Sem pergunta aberta: abre com o primeiro outro produto como destino.
  assert.deepEqual(productTrashClick(draft, "p1", null), { removeNow: false, refocusQuestion: false, pending: { productId: "p1", moveTo: "p2" } });
});

// ── Marcação ─────────────────────────────────────────────────────────────────

test("erro no campo certo, ao vivo: margem que não se paga e conversão de 150% da faixa do meio", () => {
  const html = render({ value: draftWithMistakes() });

  // "Nenhum lead de Curso se paga" marca a margem desejada do Curso — e só ela.
  assertFieldIssue(html, "Margem de lucro desejada de Curso", F.targetNotBelowContribution);
  assertFieldClean(html, "De cada venda de Curso, quanto sobra");
  assertFieldClean(html, "Margem de lucro desejada de Mentoria");
  // A faixa com 150% é a do meio; a mensagem está no campo dela.
  assertFieldIssue(html, "Conversão da faixa 70 a menos de 80", F.conversionRange);
  assertFieldClean(html, "Conversão da faixa abaixo de 70");
  // Em branco não acusa enquanto se digita.
  assertFieldClean(html, "Conversão da faixa 80 ou mais");

  // O resumo continua com as frases do contrato.
  assert.match(html, /Nenhum lead de &quot;Curso&quot; se paga/);
  assert.match(html, /A conversão de cada faixa precisa estar entre 0% e 100%\./);
});

test("erro no campo depois de tentar salvar: o que falta preencher também marca o campo", () => {
  const draft = draftWithMistakes();
  draft.products[1].name = "";
  draft.products[0].ticket = "";
  const live = render({ value: draft });
  assertFieldClean(live, "Nome do produto 2");
  assertFieldClean(live, "Ticket de Mentoria");
  assertFieldClean(live, "Conversão da faixa 80 ou mais");

  const html = render({ value: draft, showAllErrors: true });
  assertFieldIssue(html, "Nome do produto 2", F.required);
  assertFieldIssue(html, "Ticket de Mentoria", F.required);
  assertFieldIssue(html, "Conversão da faixa 80 ou mais", F.required);
  // Cada mensagem tem id próprio: dois campos com "Obrigatório." não apontam o mesmo elemento.
  const ids = ["Nome do produto 2", "Ticket de Mentoria", "Conversão da faixa 80 ou mais"].map((label) =>
    attr(tagWith(html, `aria-label="${label}"`), "aria-describedby"),
  );
  assert.equal(new Set(ids).size, ids.length);
});

test("corte fora de ordem marca o corte da faixa; seletor de produto também é marcável", () => {
  const draft = draftWithMistakes();
  draft.bands[2].min = "60";
  draft.bands[1].product = "sumiu";
  const html = render({ value: draft });
  assertFieldIssue(html, "Nota de corte da faixa 3", F.cutNotIncreasing);
  assertFieldClean(html, "Nota de corte da faixa 2");
  // Rótulo da faixa 2 com os cortes como estão digitados (70, depois 60).
  const trigger = tagWith(html, 'aria-label="Produto da faixa 70 a menos de 60"');
  assert.equal(attr(trigger, "aria-invalid"), "true");
  assert.equal(textOfId(html, attr(trigger, "aria-describedby")!), F.productMissing);
});

// As classes foram compiladas no CLI do Tailwind 3.4 e geram CSS; o override de foco
// precisa existir porque `aria-[invalid=true]:` sai DEPOIS de `focus:` no CSS.
test("borda de erro presa ao aria-invalid, e o foco volta ao azul no campo com erro", () => {
  const html = render({ value: draftWithMistakes() });
  const input = tagWith(html, 'aria-label="Margem de lucro desejada de Curso"');
  assert.match(attr(input, "class")!, /aria-\[invalid=true\]:border-destructive/);
  assert.match(attr(input, "class")!, /aria-\[invalid=true\]:focus-visible:border-primary/);
  const trigger = tagWith(html, 'aria-label="Produto da faixa abaixo de 70"');
  assert.match(attr(trigger, "class")!, /aria-\[invalid=true\]:border-destructive/);
  assert.match(attr(trigger, "class")!, /aria-\[invalid=true\]:focus:border-primary/);
});

test("região viva do resumo já montada, vazia, antes do primeiro erro", () => {
  const clean: LeadEconomicsDraft = {
    products: [{ id: "p1", name: "", ticket: "", contribution: "", target: "" }],
    bands: [{ key: "b1", min: "", product: "p1", conversion: "" }],
  };
  const html = render({ value: clean });
  assert.equal(html.match(/<div aria-live="polite"><\/div>/g)?.length, 2, "uma região por bloco, montada sem conteúdo");
});

test("teto por lead: <output> com nome da faixa, anunciado ao mudar, na moeda da conta", () => {
  const draft: LeadEconomicsDraft = {
    products: [{ id: "p1", name: "", ticket: "3.000", contribution: "55", target: "40" }],
    bands: [
      { key: "b1", min: "", product: "p1", conversion: "0,5" },
      { key: "b2", min: "70", product: "p1", conversion: "" },
    ],
  };
  const html = render({ value: draft, currency: "USD" });
  // 0,5% × 3.000 × (55% − 40%) = 2,25
  const filled = tagWith(html, 'aria-label="Teto por lead da faixa abaixo de 70"');
  assert.match(filled, /^<output /);
  assert.equal(attr(filled, "aria-live"), "polite");
  assert.ok(html.includes(`US$${NBSP}2,25</span></output>`), "valor no padrão brasileiro, com US$");
  // Faixa incompleta: travessão para o olho, palavra para o leitor de tela.
  const empty = tagWith(html, 'aria-label="Teto por lead da faixa 70 ou mais"');
  assert.match(empty, /^<output /);
  assert.ok(html.includes('<span aria-hidden="true">—</span><span class="sr-only">incompleto</span></output>'));
  // Prefixo do ticket na moeda da conta, com respiro para 3 caracteres.
  assert.ok(html.includes(">US$</span>"));
  assert.match(attr(tagWith(html, 'aria-label="Ticket"'), "class")!, /\bpl-12\b/);
});

test("nome em branco não parece preenchido: placeholder genérico, substituto apagado no seletor", () => {
  const draft = draftWithMistakes();
  draft.products[1].name = "";
  const html = render({ value: draft });
  const nameTag = tagWith(html, 'aria-label="Nome do produto 2"');
  assert.equal(attr(nameTag, "placeholder"), "Nome do produto");
  assert.ok(!/placeholder="Produto \d"/.test(html), "o placeholder não imita um nome");
  // No gatilho da faixa, o substituto aparece no tom secundário.
  assert.ok(html.includes('<span class="text-muted-foreground">Sem nome (produto 2)</span>'));
  // Nas frases do leitor de tela, o substituto é dito como tal.
  tagWith(html, 'aria-label="Ticket de produto 2 (sem nome)"');
});

test("rótulos truncáveis têm title: o limite de cima da faixa não some em tela estreita", () => {
  const html = render({ value: draftWithMistakes() });
  assert.ok(html.includes('title="abaixo de 70"'), "rótulo da primeira faixa");
  assert.ok(html.includes('title="a menos de 80"'), "sufixo do corte");
  // Coluna "Nota" com largura mínima também no modo com vários produtos.
  assert.ok(html.includes("grid-cols-[minmax(11rem,1.5fr)_minmax(7.5rem,1fr)_6.5rem_6.5rem_2.5rem]"));
});

test("sufixo do corte (\"a menos de 80\") quebra a linha em vez de cortar: inteiro sem hover, em toque", () => {
  const html = render({ value: draftWithMistakes() });
  const suffix = tagWith(html, 'title="a menos de 80"');
  const classes = attr(suffix, "class")!.split(/\s+/);
  // Com o campo em w-24 sobram ~80px no diálogo 2xl com barra de rolagem, e o texto
  // pede ~81px: truncado, virava "a menos d…".
  assert.ok(!classes.includes("truncate"), `não pode truncar: ${classes.join(" ")}`);
  assert.ok(!classes.some((name) => name.startsWith("whitespace-nowrap")), "nem impedir a quebra");
  assert.ok(classes.includes("break-words"), "número comprido quebra dentro da célula, não vaza");
  assert.ok(html.includes(">a menos de 80</span>"), "o texto inteiro está na marcação");
});

test("tabelas cabem no diálogo 2xl com barra de rolagem: min-w = soma das colunas, até 603px", () => {
  // 2xl = 42rem − 2px da borda do diálogo (AppDialog) − p-6 dos dois lados = 622px;
  // − 17px da barra de rolagem do diálogo (o editor aberto sempre passa da altura)
  // − 2px da borda da tabela = 603px.
  const available = 42 * 16 - 2 - 2 * 24 - 17 - 2;
  const cases: Array<[LeadEconomicsDraft, number]> = [
    [draftWithMistakes(), 2], // produtos e faixas com vários produtos
    [{ ...draftWithMistakes(), products: [draftWithMistakes().products[0]] }, 1], // faixas com um produto (produtos = grid-cols-3)
  ];
  for (const [value, tables] of cases) {
    const html = render({ value });
    // O contêiner com min-w e, logo dentro, a linha de cabeçalho com as colunas.
    const matches = [...html.matchAll(/min-w-\[([\d.]+)rem\][^"]*"><div class="[^"]*grid-cols-\[([^\]]+)\]/g)];
    assert.equal(matches.length, tables, "tabelas medidas");
    for (const match of matches) {
      const minWidth = Number(match[1]) * 16;
      const columns = match[2].split("_").map((column) => Number(/([\d.]+)rem/.exec(column)![1]) * 16);
      // Colunas nos mínimos + vãos (gap-2) + respiro (px-3).
      const needed = columns.reduce((sum, width) => sum + width, 0) + (columns.length - 1) * 8 + 2 * 12;
      assert.ok(minWidth <= available, `min-w de ${minWidth}px rola na horizontal (cabem ${available}px)`);
      assert.ok(minWidth >= needed, `min-w de ${minWidth}px espreme colunas que pedem ${needed}px`);
    }
  }
});

test("textos de ajuda: conversão é lead → venda; margem desejada é sobre o preço de venda", () => {
  const html = render({ value: draftWithMistakes() });
  assert.ok(html.includes("Conversão: de cada 100 leads desta faixa, quantos viram venda."), "ajuda da conversão");
  assert.ok(html.includes("Margem desejada: sobre o preço de venda."), "ajuda da margem desejada");
  // No mesmo padrão da ajuda que já existia ("Quanto sobra: ..."): texto secundário pequeno.
  const help = html.slice(html.lastIndexOf("<div", html.indexOf("Conversão: de cada 100")), html.indexOf("Conversão: de cada 100"));
  assert.match(help, /class="[^"]*\btext-xs\b[^"]*\btext-muted-foreground\b/);
});

test("moeda da preferência (conta do pack não achada): aviso discreto perto do ticket", () => {
  const note = "Ticket em BRL, a moeda da sua preferência: não deu para confirmar a moeda da conta deste pack.";
  const fallback = render({ value: draftWithMistakes(), currency: "BRL", currencyFromAccount: false });
  assert.ok(fallback.includes(note), "sem a conta, a tela diz de onde veio a moeda");
  // O aviso fica no bloco dos produtos (onde está o ticket), antes das faixas.
  assert.ok(fallback.indexOf(note) < fallback.indexOf("Quem compra"), "no bloco dos produtos");
  assert.ok(!render({ value: draftWithMistakes(), currency: "BRL", currencyFromAccount: true }).includes("moeda da sua preferência"), "moeda da conta: sem aviso");
  assert.ok(!render({ value: draftWithMistakes(), currency: "BRL" }).includes("moeda da sua preferência"), "padrão: moeda da conta");
});

test("corte \"7O\" depois de tentar salvar: resumo diz \"não é um número\", como o campo", () => {
  const draft = draftWithMistakes();
  draft.bands[2].min = "7O";
  const html = render({ value: draft, showAllErrors: true });
  assertFieldIssue(html, "Nota de corte da faixa 3", F.notANumber);
  assert.ok(html.includes(LEAD_ECONOMICS_UNREADABLE_CUT_MESSAGE), "a frase da tela no resumo das faixas");
  assert.ok(!html.includes(M.bandMinMissing), "nunca \"precisa de uma nota de corte\" com o campo preenchido");
});

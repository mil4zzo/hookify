import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLeadEconomics, validateLeadEconomics, type LeadEconomics } from "../leadEconomics";
import { decideLeadEconomicsPayload, openLeadEconomicsEdit } from "../leadEconomicsDraft";
import {
  buildPackJudgmentPayload,
  findAdAccountCurrency,
  isPackJudgmentFormDirty,
  packJudgmentFormValues,
  resolvePackCurrency,
} from "../packJudgmentForm";

/**
 * Configuração do pack: o que os campos mostram ao abrir, quando o diálogo deixa de
 * fechar por Esc/clique fora (há alteração a perder), a moeda do ticket e o que o
 * save manda.
 */

const DOC: LeadEconomics = {
  products: [{ id: "p1", name: "Mentoria", ticket: 3000, contribution_margin: 0.55, target_margin: 0.4 }],
  bands: [
    { min: null, product: "p1", conversion: 0.005 },
    { min: 70, product: "p1", conversion: 0.04 },
  ],
};

test("valores iniciais: número vira texto; ausente vira campo vazio, nunca \"0\"", () => {
  const values = packJudgmentFormValues({ mql_leadscore_min: 70, target_cpr: { "conversion:lead": 12.5 } }, ["conversion:lead", "conversion:purchase"]);
  assert.deepEqual(values, { mql: "70", targets: { "conversion:lead": "12.5", "conversion:purchase": "" } });
  assert.deepEqual(packJudgmentFormValues({ mql_leadscore_min: null, target_cpr: null }, ["a"]), { mql: "", targets: { a: "" } });
  assert.equal(packJudgmentFormValues({ mql_leadscore_min: 0 }, []).mql, "0", "0 é um corte legítimo");
});

test("alteração no corte de MQL ou num CPR alvo bloqueia o fechar acidental", () => {
  const initial = packJudgmentFormValues({ mql_leadscore_min: 70, target_cpr: { a: 10 } }, ["a", "b"]);
  assert.equal(isPackJudgmentFormDirty(initial, structuredClone(initial)), false);
  assert.equal(isPackJudgmentFormDirty(initial, { ...initial, mql: " 70 " }), false, "espaço não é alteração");
  assert.equal(isPackJudgmentFormDirty(initial, { ...initial, mql: "80" }), true);
  assert.equal(isPackJudgmentFormDirty(initial, { ...initial, mql: "" }), true, "apagar o corte é alteração");
  assert.equal(isPackJudgmentFormDirty(initial, { ...initial, targets: { a: "10", b: "5" } }), true);
  assert.equal(isPackJudgmentFormDirty(initial, { ...initial, targets: { a: "", b: "" } }), true);
  // Digitou e voltou ao que era: nada a perder.
  assert.equal(isPackJudgmentFormDirty(initial, { mql: "70", targets: { a: "10", b: "" } }), false);
});

test("moeda: a da conta do pack; sem a conta na lista (pack de outra pessoa), null", () => {
  const accounts = [
    { id: "act_1", currency: "BRL" },
    { id: "act_2", currency: "usd " },
    { id: "act_3", currency: null },
    { id: "act_4" },
  ];
  assert.equal(findAdAccountCurrency(accounts, "act_1"), "BRL");
  assert.equal(findAdAccountCurrency(accounts, "act_2"), "USD");
  assert.equal(findAdAccountCurrency(accounts, "act_3"), null, "conta ainda sem sync de moeda");
  assert.equal(findAdAccountCurrency(accounts, "act_4"), null);
  assert.equal(findAdAccountCurrency(accounts, "act_9"), null, "pack compartilhado de conta alheia");
  assert.equal(findAdAccountCurrency(accounts, undefined), null);
  assert.equal(findAdAccountCurrency(undefined, "act_1"), null, "lista ainda carregando");
});

test("moeda do ticket: a da conta quando achou; senão a preferência, marcada como tal (a tela avisa)", () => {
  assert.deepEqual(resolvePackCurrency("USD", "BRL"), { code: "USD", fromAccount: true });
  assert.deepEqual(resolvePackCurrency(" usd ", "BRL"), { code: "USD", fromAccount: true });
  assert.deepEqual(resolvePackCurrency(null, "BRL"), { code: "BRL", fromAccount: false }, "pack de conta alheia");
  assert.deepEqual(resolvePackCurrency(undefined, "BRL"), { code: "BRL", fromAccount: false });
  assert.deepEqual(resolvePackCurrency("  ", "BRL"), { code: "BRL", fromAccount: false });
  // Mesmo quando a preferência coincide com a moeda: não é CONFIRMADO, então avisa.
  assert.deepEqual(resolvePackCurrency(findAdAccountCurrency([{ id: "act_1", currency: "BRL" }], "act_9"), "BRL"), {
    code: "BRL",
    fromAccount: false,
  });
});

// ── O que o save manda ───────────────────────────────────────────────────────

const FORM = { mql: "70", targets: { "conversion:lead": "12.5", "conversion:purchase": "" } };

test("payload: economia sem mudança → a chave lead_economics fica AUSENTE (não null)", () => {
  const built = buildPackJudgmentPayload(FORM, { kind: "omit" });
  assert.equal(built.kind, "ok");
  if (built.kind !== "ok") return;
  assert.equal("lead_economics" in built.payload, false, "null apagaria o cadastro; ausente é não mexer");
  assert.deepEqual(built.payload, { mql_leadscore_min: 70, target_cpr: { "conversion:lead": 12.5 } });
});

test("payload: remover manda a chave com null; cadastro novo manda o documento", () => {
  const removed = buildPackJudgmentPayload({ mql: "", targets: {} }, { kind: "set", value: null });
  assert.equal(removed.kind, "ok");
  if (removed.kind !== "ok") return;
  assert.equal("lead_economics" in removed.payload, true);
  assert.equal(removed.payload.lead_economics, null);
  // Campos vazios: null explícito, que é o que limpa corte e CPR alvo.
  assert.equal(removed.payload.mql_leadscore_min, null);
  assert.equal(removed.payload.target_cpr, null);

  const set = buildPackJudgmentPayload({ mql: "70", targets: {} }, { kind: "set", value: DOC });
  assert.equal(set.kind, "ok");
  assert.deepEqual(set.kind === "ok" && set.payload.lead_economics, DOC);
});

test("payload: erros na ordem da tela — corte de MQL, CPR alvo, economia do lead", () => {
  const invalidEconomics = { kind: "invalid" as const, errors: ["Uma nota de corte não é um número.", "outra"] };
  assert.deepEqual(buildPackJudgmentPayload({ ...FORM, mql: "-1" }, invalidEconomics), {
    kind: "error",
    field: "mql",
    message: "Informe um leadscore mínimo válido (número maior ou igual a zero).",
  });
  assert.equal(buildPackJudgmentPayload({ ...FORM, mql: "abc" }, { kind: "omit" }).kind, "error");
  assert.deepEqual(buildPackJudgmentPayload({ mql: "70", targets: { "conversion:lead": "0" } }, invalidEconomics), {
    kind: "error",
    field: "target",
    message: 'O CPR alvo de "lead" precisa ser maior que zero.',
  });
  // A economia inválida para o save com a PRIMEIRA mensagem (e abre os erros nos campos).
  assert.deepEqual(buildPackJudgmentPayload({ mql: "70", targets: {} }, invalidEconomics), {
    kind: "error",
    field: "economics",
    message: "Uma nota de corte não é um número.",
  });
  assert.deepEqual(buildPackJudgmentPayload({ mql: "70", targets: {} }, { kind: "invalid", errors: [] }), {
    kind: "error",
    field: "economics",
    message: "Revise a economia do lead.",
  });
});

test("payload regra 3: pack com cadastro que a leitura aceita e a escrita recusa — salvar só o MQL não trava", () => {
  // Dois produtos com o mesmo nome: a leitura tolerante aceita, a escrita estrita recusa.
  const raw = {
    products: [
      { id: "p1", name: "Mentoria", ticket: 3000, contribution_margin: 0.55, target_margin: 0.4 },
      { id: "p2", name: "MENTORIA", ticket: 300, contribution_margin: 0.9, target_margin: 0.4 },
    ],
    bands: [
      { min: null, product: "p2", conversion: 0.005 },
      { min: 70, product: "p1", conversion: 0.04 },
    ],
  };
  const saved = normalizeLeadEconomics(raw);
  assert.ok(saved, "a leitura aceita");
  assert.equal(validateLeadEconomics(raw).value, null, "a escrita recusa");

  // O caminho do diálogo: abre, não mexe na economia, troca o corte de MQL e salva.
  const economics = openLeadEconomicsEdit(saved);
  const decision = decideLeadEconomicsPayload({
    draft: economics.draft,
    saved,
    rawSavedExists: true,
    touched: economics.touched,
    removed: economics.removed !== null,
  });
  const built = buildPackJudgmentPayload({ mql: "80", targets: {} }, decision);
  assert.equal(built.kind, "ok", "o save do corte de MQL não pode travar num nome que ninguém mexeu");
  assert.ok(built.kind === "ok" && !("lead_economics" in built.payload), "economia intocada: a chave não vai");
  assert.equal(built.kind === "ok" && built.payload.mql_leadscore_min, 80);
});

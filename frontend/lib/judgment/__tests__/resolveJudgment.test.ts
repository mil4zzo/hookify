import test from "node:test";
import assert from "node:assert/strict";
import {
  JUDGMENT_FIELD_LABELS,
  resolveJudgment,
  type PackJudgmentConfig,
} from "../resolveJudgment";
import { normalizeLeadEconomics, type LeadEconomics } from "../../utils/leadEconomics";

// Cadastro da seção 4 do plano-economia-do-lead.md, já na forma canônica.
const ECONOMIA: LeadEconomics = {
  products: [
    { id: "p1", name: "Mentoria VIP", ticket: 3000, contribution_margin: 0.55, target_margin: 0.4 },
    { id: "p2", name: "Ebook", ticket: 300, contribution_margin: 0.9, target_margin: 0.4 },
  ],
  bands: [
    { min: null, product: "p2", conversion: 0.005 },
    { min: 60, product: "p1", conversion: 0.04 },
    { min: 80, product: "p1", conversion: 0.12 },
  ],
};

/** Cópia profunda: cada pack tem o próprio objeto, como vem do banco. */
function economia(): LeadEconomics {
  return JSON.parse(JSON.stringify(ECONOMIA));
}

// ── Economia do lead (D16: mesma regra do corte de MQL) ──────────────────────

test("economia: 0 packs → null, sem divergência", () => {
  const r = resolveJudgment([]);
  assert.equal(r.leadEconomics, null);
  assert.equal(r.divergent.leadEconomics, false);
  assert.equal(r.hasDivergence, false);
});

test("economia: 1 pack com cadastro → o documento normalizado", () => {
  const r = resolveJudgment([{ lead_economics: economia() }]);
  assert.deepEqual(r.leadEconomics, ECONOMIA);
  assert.equal(r.divergent.leadEconomics, false);
  assert.equal(r.hasDivergence, false);
});

test("economia: 1 pack sem cadastro (ausente ou null) → null, e ausência não é divergência", () => {
  for (const pack of [{}, { lead_economics: null }, { lead_economics: undefined }] as PackJudgmentConfig[]) {
    const r = resolveJudgment([pack]);
    assert.equal(r.leadEconomics, null);
    assert.equal(r.divergent.leadEconomics, false);
  }
  // Vários packs, nenhum com cadastro: todos concordam em "não configurado".
  const r = resolveJudgment([{}, { lead_economics: null }, {}]);
  assert.equal(r.leadEconomics, null);
  assert.equal(r.divergent.leadEconomics, false);
});

test("economia: 2 packs iguais → o valor, mesmo com chave a mais, outra ordem de chaves e espaços no nome", () => {
  // Mesma economia gravada de outro jeito: chaves desconhecidas em todos os níveis,
  // chaves em outra ordem e o nome com espaços sobrando (nas pontas e no meio).
  const outraGrafia = {
    versao: 2,
    bands: [
      { conversion: 0.005, product: "p2", min: null, cor: "cinza" },
      { conversion: 0.04, product: "p1", min: 60 },
      { conversion: 0.12, min: 80, product: "p1" },
    ],
    products: [
      { target_margin: 0.4, contribution_margin: 0.55, ticket: 3000, name: "  Mentoria   VIP ", id: "p1", sku: "X" },
      { target_margin: 0.4, contribution_margin: 0.9, ticket: 300, name: "Ebook", id: "p2" },
    ],
  };
  // Pré-condição: cru, os dois NÃO são o mesmo JSON — senão o teste não prova a normalização.
  assert.notEqual(JSON.stringify(outraGrafia), JSON.stringify(ECONOMIA));

  const r = resolveJudgment([{ lead_economics: economia() }, { lead_economics: outraGrafia }]);
  assert.deepEqual(r.leadEconomics, ECONOMIA);
  assert.equal(r.divergent.leadEconomics, false);
  assert.equal(r.hasDivergence, false);

  // A ordem dos packs não muda o resultado: sai sempre a forma canônica.
  const invertido = resolveJudgment([{ lead_economics: outraGrafia }, { lead_economics: economia() }]);
  assert.deepEqual(invertido.leadEconomics, ECONOMIA);
  assert.equal(invertido.divergent.leadEconomics, false);
});

test("economia: 2 packs diferentes → null, com divergência marcada", () => {
  const outra = economia();
  outra.bands[2].conversion = 0.1; // um número só muda o teto da faixa de cima
  const r = resolveJudgment([{ lead_economics: economia() }, { lead_economics: outra }]);
  assert.equal(r.leadEconomics, null);
  assert.equal(r.divergent.leadEconomics, true);
  assert.equal(r.hasDivergence, true);
});

test("economia: mesmos números com ids, nomes e ordem de produtos diferentes → iguais (D20)", () => {
  // Dois packs cadastrados à mão com os mesmos números: o editor gera id aleatório,
  // o nome pode sair com outra grafia e os produtos em outra ordem. A conta dá o
  // mesmo resultado nos dois — divergir aqui sumiria com teto e margem à toa.
  const outroCadastro: LeadEconomics = {
    products: [
      { id: "b7f0c1d2", name: "E-book", ticket: 300, contribution_margin: 0.9, target_margin: 0.4 },
      { id: "sem-uso", name: "Consultoria", ticket: 9000, contribution_margin: 0.5, target_margin: 0.3 },
      { id: "a1e9", name: "Mentoria", ticket: 3000, contribution_margin: 0.55, target_margin: 0.4 },
    ],
    bands: [
      { min: null, product: "b7f0c1d2", conversion: 0.005 },
      { min: 60, product: "a1e9", conversion: 0.04 },
      { min: 80, product: "a1e9", conversion: 0.12 },
    ],
  };
  const r = resolveJudgment([{ lead_economics: economia() }, { lead_economics: outroCadastro }]);
  assert.equal(r.divergent.leadEconomics, false);
  // Com packs iguais, vale o documento do primeiro (é dele que o modal tira os nomes).
  assert.deepEqual(r.leadEconomics, ECONOMIA);

  // Na ordem inversa, o primeiro passa a ser o outro cadastro.
  const inverso = resolveJudgment([{ lead_economics: outroCadastro }, { lead_economics: economia() }]);
  assert.equal(inverso.divergent.leadEconomics, false);
  assert.deepEqual(inverso.leadEconomics, outroCadastro);

  // Mas o mesmo produto com um número diferente numa faixa usada diverge.
  const ticketDiferente = JSON.parse(JSON.stringify(outroCadastro)) as LeadEconomics;
  ticketDiferente.products[2].ticket = 3100;
  const diverge = resolveJudgment([{ lead_economics: economia() }, { lead_economics: ticketDiferente }]);
  assert.equal(diverge.leadEconomics, null);
  assert.equal(diverge.divergent.leadEconomics, true);
});

test("economia: cada número que a conta usa separa dois packs (D20)", () => {
  // Um campo só diferente, numa faixa que tem leads e conversão > 0: a conta dá
  // outro teto — os packs precisam divergir.
  const casos: Array<[string, (doc: LeadEconomics) => void]> = [
    ["só um corte diferente", (doc) => (doc.bands[1].min = 65)],
    ["só a sobra de um produto usado", (doc) => (doc.products[0].contribution_margin = 0.6)],
    ["só a margem desejada de um produto usado", (doc) => (doc.products[0].target_margin = 0.35)],
  ];
  for (const [label, muda] of casos) {
    const outra = economia();
    muda(outra);
    assert.ok(normalizeLeadEconomics(outra), `${label}: pré-condição — o documento é válido`);
    const r = resolveJudgment([{ lead_economics: economia() }, { lead_economics: outra }]);
    assert.equal(r.leadEconomics, null, label);
    assert.equal(r.divergent.leadEconomics, true, label);
  }
});

test("economia: corte -0 e corte 0 são o mesmo corte", () => {
  const comZero = economia();
  comZero.bands[1].min = 0;
  const comMenosZero = economia();
  comMenosZero.bands[1].min = -0; // depois da cópia: o JSON.stringify apagaria o sinal
  assert.ok(Object.is(comMenosZero.bands[1].min, -0), "pré-condição: o -0 chegou ao documento");
  const r = resolveJudgment([{ lead_economics: comZero }, { lead_economics: comMenosZero }]);
  assert.equal(r.divergent.leadEconomics, false);
  assert.ok(r.leadEconomics);
});

test("economia: produto diferente só na faixa de conversão 0% → iguais (a conta não o enxerga)", () => {
  // Faixa de baixo com conversão 0: receita, contribuição, teto e meta dela dão 0
  // com qualquer produto. Um pack aponta para o Ebook, o outro para a Mentoria.
  const comEbook = economia();
  comEbook.bands[0].conversion = 0;
  const comMentoria = economia();
  comMentoria.bands[0].conversion = 0;
  comMentoria.bands[0].product = "p1";

  const r = resolveJudgment([{ lead_economics: comEbook }, { lead_economics: comMentoria }]);
  assert.equal(r.divergent.leadEconomics, false);
  assert.deepEqual(r.leadEconomics, comEbook, "vale o documento do primeiro pack");

  // Com conversão > 0 o mesmo produto trocado diverge (controle do caso acima).
  const ebookComVenda = economia();
  const mentoriaComVenda = economia();
  mentoriaComVenda.bands[0].product = "p1";
  const controle = resolveJudgment([{ lead_economics: ebookComVenda }, { lead_economics: mentoriaComVenda }]);
  assert.equal(controle.divergent.leadEconomics, true);
});

test("economia: um pack com cadastro e outro sem → divergente (sem cadastro contradiz cadastro)", () => {
  for (const packs of [
    [{ lead_economics: economia() }, { lead_economics: null }],
    [{}, { lead_economics: economia() }],
  ] as PackJudgmentConfig[][]) {
    const r = resolveJudgment(packs);
    assert.equal(r.leadEconomics, null);
    assert.equal(r.divergent.leadEconomics, true);
    assert.equal(r.hasDivergence, true);
  }
});

test("economia: documento inválido conta como sem cadastro", () => {
  // Margem desejada ≥ sobra: nenhum lead se paga — o normalize devolve null.
  const invalida = economia();
  invalida.products[0].target_margin = 0.6;
  assert.equal(normalizeLeadEconomics(invalida), null, "pré-condição: o contrato recusa o documento");

  // Sozinho: não configurado, não divergente.
  const sozinho = resolveJudgment([{ lead_economics: invalida }]);
  assert.equal(sozinho.leadEconomics, null);
  assert.equal(sozinho.divergent.leadEconomics, false);

  // Inválido + sem cadastro: os dois são "não configurado" → concordam.
  const comVazio = resolveJudgment([{ lead_economics: invalida }, { lead_economics: null }, { lead_economics: "lixo" }]);
  assert.equal(comVazio.leadEconomics, null);
  assert.equal(comVazio.divergent.leadEconomics, false);

  // Inválido + válido: "sem" contra "com" → divergente, como qualquer pack sem cadastro.
  const comValido = resolveJudgment([{ lead_economics: invalida }, { lead_economics: economia() }]);
  assert.equal(comValido.leadEconomics, null);
  assert.equal(comValido.divergent.leadEconomics, true);
});

test("economia: divergir na economia não mexe no corte de MQL nem no CPR alvo", () => {
  const r = resolveJudgment([
    { mql_leadscore_min: 70, target_cpr: { lead: 12 }, lead_economics: economia() },
    { mql_leadscore_min: 70, target_cpr: { lead: 12 }, lead_economics: null },
  ]);
  assert.equal(r.divergent.leadEconomics, true);
  assert.equal(r.mqlLeadscoreMin, 70);
  assert.equal(r.divergent.mqlLeadscoreMin, false);
  assert.deepEqual(r.targetCprByActionType, { lead: 12 });
  assert.equal(r.divergent.targetCprByActionType, false);
});

test("rótulo do campo para a UI explicar a divergência", () => {
  assert.equal(JUDGMENT_FIELD_LABELS.leadEconomics, "Economia do lead");
});

// ── Corte de MQL (comportamento existente) ───────────────────────────────────

test("mql: 0 packs → null, sem divergência", () => {
  const r = resolveJudgment([]);
  assert.equal(r.mqlLeadscoreMin, null);
  assert.equal(r.divergent.mqlLeadscoreMin, false);
});

test("mql: pack sem corte → null, e ausência não é divergência", () => {
  const r = resolveJudgment([{ mql_leadscore_min: null }, {}]);
  assert.equal(r.mqlLeadscoreMin, null);
  assert.equal(r.divergent.mqlLeadscoreMin, false);
});

test("mql: packs iguais → o valor (número e texto numérico são o mesmo corte)", () => {
  const r = resolveJudgment([{ mql_leadscore_min: 70 }, { mql_leadscore_min: "70" }]);
  assert.equal(r.mqlLeadscoreMin, 70);
  assert.equal(r.divergent.mqlLeadscoreMin, false);
  assert.equal(r.hasDivergence, false);
});

test("mql: 0 é um corte válido, não ausência", () => {
  const r = resolveJudgment([{ mql_leadscore_min: 0 }]);
  assert.equal(r.mqlLeadscoreMin, 0);
});

test("mql: packs divergentes → null com divergência; sem corte contra corte também diverge", () => {
  const diferentes = resolveJudgment([{ mql_leadscore_min: 70 }, { mql_leadscore_min: 80 }]);
  assert.equal(diferentes.mqlLeadscoreMin, null);
  assert.equal(diferentes.divergent.mqlLeadscoreMin, true);
  assert.equal(diferentes.hasDivergence, true);

  const comSem = resolveJudgment([{ mql_leadscore_min: 70 }, { mql_leadscore_min: null }]);
  assert.equal(comSem.mqlLeadscoreMin, null);
  assert.equal(comSem.divergent.mqlLeadscoreMin, true);
});

test("mql: valor inválido (negativo, texto não numérico) conta como não definido", () => {
  const r = resolveJudgment([{ mql_leadscore_min: -5 }, { mql_leadscore_min: "abc" }, { mql_leadscore_min: null }]);
  assert.equal(r.mqlLeadscoreMin, null);
  assert.equal(r.divergent.mqlLeadscoreMin, false);
});

// ── CPR alvo (comportamento existente: resolve por action_type) ──────────────

test("cpr alvo: 0 packs → mapa vazio, sem divergência", () => {
  const r = resolveJudgment([]);
  assert.deepEqual(r.targetCprByActionType, {});
  assert.equal(r.divergent.targetCprByActionType, false);
  assert.deepEqual(r.divergentTargetCprKeys, []);
});

test("cpr alvo: packs iguais → o mapa", () => {
  const r = resolveJudgment([
    { target_cpr: { lead: 12, purchase: 80 } },
    { target_cpr: { purchase: 80, lead: 12 } },
  ]);
  assert.deepEqual(r.targetCprByActionType, { lead: 12, purchase: 80 });
  assert.equal(r.divergent.targetCprByActionType, false);
  assert.deepEqual(r.divergentTargetCprKeys, []);
});

test("cpr alvo: resolve por chave — a chave divergente sai, a acordada fica", () => {
  const r = resolveJudgment([
    { target_cpr: { lead: 12, purchase: 80 } },
    { target_cpr: { lead: 12, purchase: 95 } },
  ]);
  assert.deepEqual(r.targetCprByActionType, { lead: 12 });
  assert.equal(r.divergent.targetCprByActionType, true);
  assert.deepEqual(r.divergentTargetCprKeys, ["purchase"]);
  assert.equal(r.hasDivergence, true);
});

test("cpr alvo: pack sem a chave conta como discordância, não omissão", () => {
  const r = resolveJudgment([{ target_cpr: { lead: 12, purchase: 80 } }, { target_cpr: { lead: 12 } }, { target_cpr: null }]);
  assert.deepEqual(r.targetCprByActionType, {});
  assert.deepEqual(r.divergentTargetCprKeys, ["lead", "purchase"]);
  assert.equal(r.divergent.targetCprByActionType, true);
});

test("cpr alvo: meta inválida (zero, negativa, não numérica) é descartada antes de comparar", () => {
  const r = resolveJudgment([
    { target_cpr: { lead: 12, purchase: 0, add_to_cart: -3 } },
    { target_cpr: { lead: 12, purchase: "abc" } as unknown as Record<string, number> },
  ]);
  assert.deepEqual(r.targetCprByActionType, { lead: 12 });
  assert.equal(r.divergent.targetCprByActionType, false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildPackMembershipIndex, isAdInSelectedPacks } from "../packMembership";

// ── Referência: cópia verbatim do predicado interno da varredura original ──────
// (o `.some()` de getPackId, aplicado à união achatada de todos os packAds dos
// packs selecionados — matematicamente equivalente, já que o loop externo por
// pack é só OR-de-ORs = OR sobre a união; ver comentário de equivalência em
// packMembership.ts).
function referenceMatches(packAds: any[], ad: any): boolean {
  return packAds.some((packAd: any) => {
    if (ad.account_id && packAd.account_id) {
      if (String(ad.account_id).trim() !== String(packAd.account_id).trim()) return false;
    }
    if (ad.ad_id && packAd.ad_id && String(ad.ad_id).trim() === String(packAd.ad_id).trim()) return true;
    if (ad.ad_name && packAd.ad_name && String(ad.ad_name).trim() === String(packAd.ad_name).trim()) return true;
    return false;
  });
}

function indexFor(packAds: any[]): ReturnType<typeof buildPackMembershipIndex> {
  return buildPackMembershipIndex([{ id: "p1" }], new Map([["p1", packAds]]));
}

function check(packAds: any[], ad: any): boolean {
  return isAdInSelectedPacks(indexFor(packAds), ad);
}

// ── Casos básicos ────────────────────────────────────────────────────────────

test("packMembership: id-only match → true", () => {
  assert.equal(check([{ ad_id: "1" }], { ad_id: "1" }), true);
});

test("packMembership: name-only match → true", () => {
  assert.equal(check([{ ad_name: "X" }], { ad_name: "X" }), true);
});

test("packMembership: nenhum campo casa → false", () => {
  assert.equal(check([{ ad_id: "1", ad_name: "X" }], { ad_id: "2", ad_name: "Y" }), false);
});

test("packMembership: ad sem ad_id e ad_name → false", () => {
  assert.equal(check([{ ad_id: "1", ad_name: "X" }], {}), false);
});

test("packMembership: packAd sem ad_id e ad_name → false", () => {
  assert.equal(check([{}], { ad_id: "1", ad_name: "X" }), false);
});

test("packMembership: selectedPacks vazio → false", () => {
  const index = buildPackMembershipIndex([], new Map());
  assert.equal(isAdInSelectedPacks(index, { ad_id: "1" }), false);
});

test("packMembership: pack selecionado ausente do map → false", () => {
  const index = buildPackMembershipIndex([{ id: "p1" }], new Map());
  assert.equal(isAdInSelectedPacks(index, { ad_id: "1" }), false);
});

test("packMembership: pack com [] packAds + outro pack que casa → true", () => {
  const index = buildPackMembershipIndex(
    [{ id: "empty" }, { id: "full" }],
    new Map([
      ["empty", []],
      ["full", [{ ad_id: "1" }]],
    ])
  );
  assert.equal(isAdInSelectedPacks(index, { ad_id: "1" }), true);
});

// ── Guard de conta — NÃO REGREDIR ───────────────────────────────────────────
// Estes casos travam a interação entre o guard de account_id e os dois
// caminhos de match (id/nome). Um índice ingênuo (que não agrupa accounts
// por chave) diverge exatamente aqui.

test("account guard — não regredir: único packAd casa por id E nome mas conta conflita → false (Caso B, load-bearing)", () => {
  const ad = { account_id: "A", ad_id: "1", ad_name: "X" };
  const packAds = [{ account_id: "B", ad_id: "1", ad_name: "X" }];
  assert.equal(referenceMatches(packAds, ad), false); // trava a referência
  assert.equal(check(packAds, ad), false);
});

test("account guard — não regredir: id conflita mas outro packAd casa por nome com conta compatível → true (Caso A)", () => {
  const ad = { account_id: "A", ad_id: "1", ad_name: "X" };
  const packAds = [
    { account_id: "B", ad_id: "1" },
    { account_id: "A", ad_name: "X" },
  ];
  assert.equal(referenceMatches(packAds, ad), true);
  assert.equal(check(packAds, ad), true);
});

test("account guard — não regredir: dois packAds casam por id, ambos com conta conflitante → false (Caso C)", () => {
  const ad = { account_id: "A", ad_id: "1" };
  const packAds = [
    { account_id: "B", ad_id: "1" },
    { account_id: "C", ad_id: "1" },
  ];
  assert.equal(referenceMatches(packAds, ad), false);
  assert.equal(check(packAds, ad), false);
});

test("account guard — não regredir: ad tem conta, packAd não tem conta, id casa → true (Caso D)", () => {
  const ad = { account_id: "A", ad_id: "1" };
  const packAds = [{ ad_id: "1" }];
  assert.equal(referenceMatches(packAds, ad), true);
  assert.equal(check(packAds, ad), true);
});

test("account guard — não regredir: ad sem conta, packAd com conta, id casa → true (Caso E)", () => {
  const ad = { ad_id: "1" };
  const packAds = [{ account_id: "B", ad_id: "1" }];
  assert.equal(referenceMatches(packAds, ad), true);
  assert.equal(check(packAds, ad), true);
});

test("account guard — não regredir: packAd conflitante + packAd compatível na mesma chave de id → true", () => {
  const ad = { account_id: "A", ad_id: "1" };
  const packAds = [
    { account_id: "B", ad_id: "1" },
    { account_id: "A", ad_id: "1" },
  ];
  assert.equal(referenceMatches(packAds, ad), true);
  assert.equal(check(packAds, ad), true);
});

test("account guard — não regredir: account_id só-espaço não colide com sentinela de 'ausente' → false", () => {
  // ad.account_id="   " é truthy (trim->"" mas o campo em si não é falsy) — deve
  // ser tratado como conta REAL "" que conflita com "B", não como "ausente".
  const ad = { account_id: "   ", ad_id: "1" };
  const packAds = [{ account_id: "B", ad_id: "1" }];
  assert.equal(referenceMatches(packAds, ad), false);
  assert.equal(check(packAds, ad), false);
});

test("account guard — não regredir: ad sem nome, packAd com nome-match mas ad não fornece nome → false (Caso F)", () => {
  const ad = { account_id: "A", ad_id: "1" }; // sem ad_name
  const packAds = [
    { account_id: "B", ad_id: "1" },
    { account_id: "A", ad_name: "X" }, // não pode casar: ad não tem ad_name
  ];
  assert.equal(referenceMatches(packAds, ad), false);
  assert.equal(check(packAds, ad), false);
});

// ── Trim / tipos ─────────────────────────────────────────────────────────────

test("packMembership: id casa com espaços nas duas pontas → true", () => {
  assert.equal(check([{ ad_id: " 1 " }], { ad_id: "1" }), true);
});

test("packMembership: account_id casa com espaços (id-match) → true", () => {
  assert.equal(check([{ account_id: " A ", ad_id: "1" }], { account_id: "A", ad_id: "1" }), true);
});

test("packMembership: ad_id number vs string → true", () => {
  assert.equal(check([{ ad_id: "1" }], { ad_id: 1 }), true);
});

test("packMembership: ad_id=0 (falsy) → false mesmo com packAd correspondente", () => {
  assert.equal(check([{ ad_id: "0" }], { ad_id: 0 }), false);
});

test("packMembership: ad_id='' ou NaN → false", () => {
  assert.equal(check([{ ad_id: "1" }], { ad_id: "" }), false);
  assert.equal(check([{ ad_id: "1" }], { ad_id: NaN }), false);
});

test("packMembership: mesma chave de id vinda de dois packs diferentes é unificada", () => {
  const index = buildPackMembershipIndex(
    [{ id: "p1" }, { id: "p2" }],
    new Map([
      ["p1", [{ account_id: "B", ad_id: "1" }]],
      ["p2", [{ account_id: "A", ad_id: "1" }]],
    ])
  );
  // conta compatível (A) está presente na união → true
  assert.equal(isAdInSelectedPacks(index, { account_id: "A", ad_id: "1" }), true);
});

// ── Teste diferencial: índice(ad) === referência(ad) sobre matriz exaustiva ──
// Domínios pequenos e deliberadamente adversariais (falsy, espaços, number vs
// string) para um único packAd — cobre toda a lógica de guard+match par-a-par.

const ACCOUNT_DOMAIN = [undefined, "A", "B", 0, "", "   "];
const AD_ID_DOMAIN = [undefined, "1", "2", 1, 0, ""];
const AD_NAME_DOMAIN = [undefined, "X", "Y", " X "];

function buildCandidates() {
  const candidates: any[] = [];
  for (const account_id of ACCOUNT_DOMAIN) {
    for (const ad_id of AD_ID_DOMAIN) {
      for (const ad_name of AD_NAME_DOMAIN) {
        const obj: any = {};
        if (account_id !== undefined) obj.account_id = account_id;
        if (ad_id !== undefined) obj.ad_id = ad_id;
        if (ad_name !== undefined) obj.ad_name = ad_name;
        candidates.push(obj);
      }
    }
  }
  return candidates;
}

test("packMembership: diferencial exaustivo (1 packAd) — índice bate com a referência em todas as combinações", () => {
  const candidates = buildCandidates();
  let compared = 0;
  let divergences: string[] = [];

  for (const ad of candidates) {
    for (const packAd of candidates) {
      const expected = referenceMatches([packAd], ad);
      const actual = check([packAd], ad);
      compared++;
      if (expected !== actual) {
        divergences.push(`ad=${JSON.stringify(ad)} packAd=${JSON.stringify(packAd)} expected=${expected} actual=${actual}`);
      }
    }
  }

  assert.equal(divergences.length, 0, `${divergences.length} divergência(s) de ${compared} combinações:\n${divergences.slice(0, 5).join("\n")}`);
  // sanidade: a matriz realmente rodou o volume esperado (não ficou vazia por engano)
  assert.equal(compared, candidates.length * candidates.length);
});

test("packMembership: diferencial curado (2 packAds) — casos de interação id-conflita/nome-compatível e vice-versa", () => {
  const scenarios: Array<{ ad: any; packAds: any[] }> = [
    { ad: { account_id: "A", ad_id: "1", ad_name: "X" }, packAds: [{ account_id: "B", ad_id: "1" }, { account_id: "A", ad_name: "X" }] },
    { ad: { account_id: "A", ad_id: "1" }, packAds: [{ account_id: "B", ad_id: "1" }, { account_id: "C", ad_id: "1" }] },
    { ad: { account_id: "A", ad_id: "1", ad_name: "X" }, packAds: [{ account_id: "B", ad_id: "1", ad_name: "X" }] },
    { ad: { ad_id: "1" }, packAds: [{ account_id: "B", ad_id: "1" }] },
    { ad: { account_id: "A", ad_id: "1" }, packAds: [{ account_id: "B", ad_name: "Y" }, { ad_id: "1" }] },
  ];

  for (const { ad, packAds } of scenarios) {
    const expected = referenceMatches(packAds, ad);
    const actual = check(packAds, ad);
    assert.equal(actual, expected, `ad=${JSON.stringify(ad)} packAds=${JSON.stringify(packAds)}`);
  }
});

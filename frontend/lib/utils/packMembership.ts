/**
 * Índice O(1) para "este anúncio pertence à união dos packs selecionados?".
 *
 * Substitui uma varredura O(rows × packs × packAds) por um índice montado uma vez
 * (O(Σ packAds)) e consultado em O(1) por linha.
 *
 * Contrato: preserva SÓ o booleano de pertencimento à união dos packAds. NÃO preserva
 * qual pack casou nem a ordem "primeiro pack vence" — nenhum consumidor atual precisa
 * disso (o único uso é `!== null` num filtro). Se um dia for necessário saber QUAL pack,
 * isso deve ser uma função separada, não uma sobrecarga deste índice.
 *
 * Equivalência com a varredura original (por anúncio `ad` e cada packAd `Q`):
 *   matchOne(ad,Q) = guardOK(ad,Q) ∧ (idMatch(ad,Q) ∨ nameMatch(ad,Q))
 *   guardOK   = ¬(ad.account_id ∧ Q.account_id ∧ trim(ad.account_id) ≠ trim(Q.account_id))
 * membership = ∃Q [ matchOne(ad,Q) ], união de todos os packAds dos packs selecionados.
 * Como ∃ distribui sobre ∨: ∃Q[G∧(I∨N)] = ∃Q(G∧I) ∨ ∃Q(G∧N) — exatamente um mapa por id
 * e um por nome, cada chave guardando os account_id de todo packAd que casou naquela chave.
 */

// Nunca pode colidir com um account_id real (mesmo trimado). Símbolo é seguro.
const NO_ACCOUNT = Symbol("no-account");
type AccountToken = string | typeof NO_ACCOUNT;

export interface PackMembershipIndex {
  idToAccounts: Map<string, Set<AccountToken>>;
  nameToAccounts: Map<string, Set<AccountToken>>;
}

function accountToken(x: any): AccountToken {
  // Truthiness primeiro (espelha o `&&` da varredura) — NÃO trim-then-empty, senão
  // account_id="   " (truthy, trim→"") colidiria com "ausente".
  return x?.account_id ? String(x.account_id).trim() : NO_ACCOUNT;
}

function addToIndex(map: Map<string, Set<AccountToken>>, key: unknown, token: AccountToken) {
  if (!key) return; // mesmo falsy-check da varredura: 0, "", NaN = ausente
  const k = String(key).trim();
  let set = map.get(k);
  if (!set) {
    set = new Set();
    map.set(k, set);
  }
  set.add(token);
}

/**
 * Monta o índice sobre a união dos packAds de todos os packs selecionados.
 * `packsAdsMap`: Map<packId, packAd[]> (mesmo shape de usePacksAds).
 */
export function buildPackMembershipIndex(
  selectedPacks: Array<{ id: string }>,
  packsAdsMap: Map<string, any[]>
): PackMembershipIndex {
  const idToAccounts = new Map<string, Set<AccountToken>>();
  const nameToAccounts = new Map<string, Set<AccountToken>>();

  for (const pack of selectedPacks) {
    const packAds = packsAdsMap.get(pack.id) || [];
    for (const packAd of packAds) {
      const token = accountToken(packAd);
      addToIndex(idToAccounts, packAd.ad_id, token);
      addToIndex(nameToAccounts, packAd.ad_name, token);
    }
  }

  return { idToAccounts, nameToAccounts };
}

function guardPasses(xacc: AccountToken, accs: Set<AccountToken>): boolean {
  if (xacc === NO_ACCOUNT) return true; // ad sem conta: guard nunca conflita
  return accs.has(NO_ACCOUNT) || accs.has(xacc);
}

/** Retorna true se `ad` pertence à união dos packs usados para montar `index`. */
export function isAdInSelectedPacks(index: PackMembershipIndex, ad: any): boolean {
  const xacc = accountToken(ad);

  if (ad?.ad_id) {
    const accs = index.idToAccounts.get(String(ad.ad_id).trim());
    if (accs && guardPasses(xacc, accs)) return true;
  }

  if (ad?.ad_name) {
    const accs = index.nameToAccounts.get(String(ad.ad_name).trim());
    if (accs && guardPasses(xacc, accs)) return true;
  }

  return false;
}

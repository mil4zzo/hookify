/**
 * Economia do lead: o cadastro de produtos e faixas de nota do pack, e a conta do
 * teto de CPL e da margem por anúncio.
 *
 * Plano e decisões: documentation/plano-economia-do-lead.md (seções 4 e 5).
 *
 * Este arquivo é o CONTRATO do cadastro no frontend. As regras de
 * `validateLeadEconomics` são espelhadas, com as MESMAS mensagens, no backend
 * (`backend/app/services/lead_economics.py`): a tela valida antes de enviar e o
 * backend recusa o que escapar. Mudar uma regra é mudar as duas.
 *
 * Escrita estrita, leitura tolerante: `validateLeadEconomics` (o que se grava)
 * cobra tudo; `normalizeLeadEconomics` (o que se lê do banco) cobra só o que a
 * conta precisa — ver o comentário dela.
 *
 * `null` é NÃO CONFIGURADO, nunca zero. Sem cadastro válido, teto e margem ficam
 * indisponíveis — zero diria "esse lead não vale nada".
 */

// ── Tipos do cadastro (packs.lead_economics, migration 179) ──────────────────

export interface LeadEconomicsProduct {
  /** Identificador estável: renomear o produto não desliga as faixas que o usam. */
  id: string;
  name: string;
  /** Faturamento por venda (bruto), na moeda da conta. */
  ticket: number;
  /** Fração do faturamento que sobra antes do anúncio (produto, imposto, comissão e taxas já descontados). (0, 1]. */
  contribution_margin: number;
  /** Margem de lucro desejada, SOBRE O FATURAMENTO (D15). [0, 1) e menor que `contribution_margin`. */
  target_margin: number;
}

export interface LeadEconomicsBand {
  /** Nota mínima da faixa (`nota >= min`). `null` só na primeira faixa: ela não tem piso. */
  min: number | null;
  /** `LeadEconomicsProduct.id` que esta faixa compra. */
  product: string;
  /** Conversão lead → venda da faixa, em [0, 1]. Zero é legítimo ("abaixo de 30 ninguém compra"). */
  conversion: number;
}

export interface LeadEconomics {
  products: LeadEconomicsProduct[];
  bands: LeadEconomicsBand[];
}

export const LEAD_ECONOMICS_MAX_PRODUCTS = 10;
export const LEAD_ECONOMICS_MAX_BANDS = 10;
export const LEAD_ECONOMICS_PRODUCT_ID_MAX = 40;
export const LEAD_ECONOMICS_PRODUCT_NAME_MAX = 60;
/** Abaixo disto o teto aparece esmaecido, como número instável (D7). */
export const LEAD_ECONOMICS_MIN_SAMPLE = 20;

// ── Mensagens (idênticas às do backend) ──────────────────────────────────────

export const LEAD_ECONOMICS_MESSAGES = {
  invalidShape: "O cadastro da economia do lead está em um formato inválido.",
  noProducts: "Cadastre ao menos um produto.",
  tooManyProducts: `Cadastre no máximo ${LEAD_ECONOMICS_MAX_PRODUCTS} produtos.`,
  noBands: "Cadastre ao menos uma faixa de nota.",
  tooManyBands: `Cadastre no máximo ${LEAD_ECONOMICS_MAX_BANDS} faixas de nota.`,
  productNameMissing: "Dê um nome a cada produto.",
  productNameTooLong: `O nome do produto pode ter no máximo ${LEAD_ECONOMICS_PRODUCT_NAME_MAX} caracteres.`,
  productNameDuplicate: (name: string) => `Dois produtos com o nome "${name}".`,
  ticket: (name: string) => `O ticket de "${name}" precisa ser maior que zero.`,
  contributionMargin: (name: string) =>
    `Quanto sobra de cada venda de "${name}" precisa ser maior que 0% e no máximo 100%.`,
  targetMargin: (name: string) => `A margem desejada de "${name}" precisa ser de 0% a menos de 100%.`,
  targetNotBelowContribution: (name: string) =>
    `Nenhum lead de "${name}" se paga: a margem desejada precisa ser menor do que o que sobra de cada venda.`,
  firstBandHasMin: "A primeira faixa não tem nota mínima.",
  bandMinMissing: "Toda faixa depois da primeira precisa de uma nota de corte.",
  bandMinNotIncreasing: "As notas de corte precisam ser crescentes, sem repetir.",
  bandProductMissing: "Toda faixa precisa apontar para um produto cadastrado.",
  bandConversion: "A conversão de cada faixa precisa estar entre 0% e 100%.",
} as const;

// ── Validação e normalização ─────────────────────────────────────────────────

export interface LeadEconomicsValidation {
  /** Documento canônico (só as chaves conhecidas, nomes aparados) — `null` se houver qualquer erro. */
  value: LeadEconomics | null;
  /** Todas as violações, em ordem estável. Vazio quando `value` não é null. */
  errors: string[];
}

function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw);
}

/**
 * Só `number` finito; string, boolean e o resto viram NaN. Estrito de propósito:
 * a tela converte o texto digitado antes de validar, e aceitar string aqui abriria
 * divergência com o backend (`float("1_000")` vale 1000 no Python e NaN aqui).
 */
function toFinite(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : NaN;
}

/** Chave de comparação de nomes: caixa e espaços não distinguem produtos. */
export function productNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

// Controle C0 e DEL: o Postgres recusa U+0000 dentro de jsonb, e o PATCH inteiro
// caía com 500 — levando junto o corte de MQL do mesmo save. Os outros controles
// não têm lugar num nome e seguem o mesmo caminho: viram espaço e colapsam com os
// vizinhos no trim/replace logo depois.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
// Surrogate sem par (o JSON "\ud800" sozinho): o Postgres também recusa. Sem a
// flag `u` a regex anda por unidade UTF-16, então o par válido (emoji) casa
// inteiro na primeira alternativa e é devolvido intacto.
const SURROGATES = /[\ud800-\udbff][\udc00-\udfff]|[\ud800-\udfff]/g;

/** Limpa id e nome ANTES de aparar/colapsar (espelho de `_sanitize_text` no backend). */
function sanitizeText(value: string): string {
  return value.replace(CONTROL_CHARS, " ").replace(SURROGATES, (match) => (match.length === 2 ? match : ""));
}

/**
 * `write`: tudo que o contrato cobra — é o que o backend espelha e o que a tela
 * mostra antes de salvar. `read`: sem as regras de NOME (ausente, longo demais,
 * duplicado); ver `normalizeLeadEconomics`.
 */
type LeadEconomicsCheckMode = "write" | "read";

export function validateLeadEconomics(raw: unknown): LeadEconomicsValidation {
  return checkLeadEconomics(raw, "write");
}

function checkLeadEconomics(raw: unknown, mode: LeadEconomicsCheckMode): LeadEconomicsValidation {
  const M = LEAD_ECONOMICS_MESSAGES;
  const errors: string[] = [];
  // Dedupe por texto exato num Set ao lado da lista: `errors.includes` era O(n) por
  // mensagem, e produto sem nome gera mensagem única ("produto 1", "produto 2"…) —
  // 20 mil produtos vazios viravam segundos de CPU. A lista continua dando a ordem.
  const seen = new Set<string>();
  const push = (message: string) => {
    if (seen.has(message)) return;
    seen.add(message);
    errors.push(message);
  };

  if (!isPlainObject(raw) || !Array.isArray(raw.products) || !Array.isArray(raw.bands)) {
    return { value: null, errors: [M.invalidShape] };
  }

  // Produtos
  const rawProducts = raw.products as unknown[];
  if (rawProducts.length === 0) push(M.noProducts);
  if (rawProducts.length > LEAD_ECONOMICS_MAX_PRODUCTS) push(M.tooManyProducts);

  const products: LeadEconomicsProduct[] = [];
  const productIds = new Set<string>();
  const nameKeys = new Set<string>();

  rawProducts.forEach((item, index) => {
    if (!isPlainObject(item)) {
      push(M.invalidShape);
      return;
    }
    const id = typeof item.id === "string" ? sanitizeText(item.id).trim() : "";
    if (!id || id.length > LEAD_ECONOMICS_PRODUCT_ID_MAX || productIds.has(id)) {
      push(M.invalidShape);
    } else {
      productIds.add(id);
    }

    const name = typeof item.name === "string" ? sanitizeText(item.name).trim().replace(/\s+/g, " ") : "";
    const displayName = name || `produto ${index + 1}`;
    if (mode === "write") {
      if (!name) push(M.productNameMissing);
      else if (name.length > LEAD_ECONOMICS_PRODUCT_NAME_MAX) push(M.productNameTooLong);
      else {
        const key = productNameKey(name);
        if (nameKeys.has(key)) push(M.productNameDuplicate(name));
        nameKeys.add(key);
      }
    }

    const ticket = toFinite(item.ticket);
    if (!(ticket > 0)) push(M.ticket(displayName));

    const contribution = toFinite(item.contribution_margin);
    const contributionOk = contribution > 0 && contribution <= 1;
    if (!contributionOk) push(M.contributionMargin(displayName));

    const target = toFinite(item.target_margin);
    const targetOk = target >= 0 && target < 1;
    if (!targetOk) push(M.targetMargin(displayName));

    // Só compara quando os dois são válidos: senão a mensagem repetiria o mesmo erro.
    if (contributionOk && targetOk && target >= contribution) push(M.targetNotBelowContribution(displayName));

    products.push({ id, name, ticket, contribution_margin: contribution, target_margin: target });
  });

  // Faixas
  const rawBands = raw.bands as unknown[];
  if (rawBands.length === 0) push(M.noBands);
  if (rawBands.length > LEAD_ECONOMICS_MAX_BANDS) push(M.tooManyBands);

  const bands: LeadEconomicsBand[] = [];
  let previousMin: number | null = null;

  rawBands.forEach((item, index) => {
    if (!isPlainObject(item)) {
      push(M.invalidShape);
      return;
    }

    let min: number | null = null;
    if (index === 0) {
      if (item.min !== null && item.min !== undefined) push(M.firstBandHasMin);
    } else {
      const parsed = toFinite(item.min);
      if (!Number.isFinite(parsed)) {
        push(M.bandMinMissing);
      } else {
        if (previousMin !== null && !(parsed > previousMin)) push(M.bandMinNotIncreasing);
        min = parsed;
        previousMin = parsed;
      }
    }

    // A referência passa pela mesma limpeza do id do produto: senão um id com
    // controle viraria "p 1" no produto e continuaria "p\u00001" na faixa.
    const product = typeof item.product === "string" ? sanitizeText(item.product).trim() : "";
    if (!product || !productIds.has(product)) push(M.bandProductMissing);

    const conversion = toFinite(item.conversion);
    if (!(conversion >= 0 && conversion <= 1)) push(M.bandConversion);

    bands.push({ min, product, conversion });
  });

  if (errors.length > 0) return { value: null, errors };
  return { value: { products, bands }, errors: [] };
}

/**
 * Cadastro gravado → documento canônico, ou `null` (não configurado).
 * Mesma postura de `normalizeTargetCpr`: documento inválido não propaga lixo
 * para a conta — some, e as colunas ficam indisponíveis.
 *
 * Leitura TOLERANTE: cobra só o que a conta precisa (forma, ids únicos, números,
 * cortes crescentes, faixa apontando para produto existente) e ignora as regras
 * de nome (ausente, longo demais, duplicado). O que já foi gravado passou pela
 * escrita estrita do backend; reaplicar regra cosmética na leitura só serve para
 * apagar cadastro em silêncio:
 * - "nome duplicado" depende da tabela Unicode do runtime: `toLocaleLowerCase` do
 *   navegador e `str.lower` do Python discordam quando as versões do Unicode
 *   diferem (27 code points só entre a 15 e a 16) — um cadastro aceito pelo
 *   backend sumiria num navegador;
 * - endurecer uma regra de nome no futuro faria teto e margem sumirem de packs
 *   antigos sem aviso, em vez de só cobrar a correção no próximo salvamento.
 */
export function normalizeLeadEconomics(raw: unknown): LeadEconomics | null {
  if (raw === null || raw === undefined) return null;
  return checkLeadEconomics(raw, "read").value;
}

/**
 * Chave do que a conta ENXERGA num cadastro, para decidir se dois packs têm "a
 * mesma economia" (D16, D20). Fica de fora o que não muda número nenhum: id e
 * nome dos produtos, a ordem deles e produto que nenhuma faixa usa. Sem isto, dois
 * packs cadastrados à mão com os mesmos números divergiriam pelo id aleatório do
 * produto — e teto e margem sumiriam ao selecionar os dois juntos.
 *
 * Faixa com conversão 0 também não enxerga o produto: faturamento, contribuição,
 * teto e meta dela dão 0 com qualquer ticket — os números do produto entram como
 * null. (`-0 === 0`, e `JSON.stringify(-0)` é "0": corte ou conversão -0 é 0.)
 */
export function leadEconomicsSemanticKey(config: LeadEconomics): string {
  return JSON.stringify(
    config.bands.map((band) => {
      const product = band.conversion === 0 ? null : findLeadEconomicsProduct(config, band.product);
      return [
        band.min,
        band.conversion,
        product?.ticket ?? null,
        product?.contribution_margin ?? null,
        product?.target_margin ?? null,
      ];
    }),
  );
}

// ── Peças da conta usadas pela tela e pela conta por anúncio ─────────────────

export function findLeadEconomicsProduct(config: LeadEconomics, productId: string): LeadEconomicsProduct | null {
  return config.products.find((product) => product.id === productId) ?? null;
}

/** Faturamento esperado por lead de uma faixa: conversão × ticket. */
export function bandRevenuePerLead(conversion: number, product: LeadEconomicsProduct): number {
  return conversion * product.ticket;
}

/**
 * Quanto se pode pagar por um lead de uma faixa sem descer abaixo da margem
 * desejada: conversão × ticket × (sobra − margem desejada). Margem sobre o
 * faturamento (D15) — por isso a subtração, e não `sobra × (1 − meta)`.
 */
export function bandCeilingPerLead(conversion: number, product: LeadEconomicsProduct): number {
  return conversion * product.ticket * (product.contribution_margin - product.target_margin);
}

// 6 casas: a mesma resolução das notas gravadas (o importador da planilha arredonda
// cada nota em 6 casas — `round(v, 6)` em ad_metrics_sheet_importer.py). Com 2, o
// corte 0,125 aparecia "0,13" e os cortes 0,121 e 0,124 viravam "0,12 a menos de
// 0,12": o rótulo mentia sobre onde a nota cai.
const scoreFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 6 });

export function formatLeadScore(score: number): string {
  return scoreFormatter.format(score);
}

/**
 * Rótulo da faixa para a tela: "abaixo de 60", "60 a menos de 80", "80 ou mais".
 * "a menos de" é deliberado: a nota exata do corte pertence à faixa de cima, e
 * "60 a 79" mentiria para uma nota 79,5.
 */
export function formatBandLabel(bands: ReadonlyArray<Pick<LeadEconomicsBand, "min">>, index: number): string {
  if (bands.length <= 1) return "todas as notas";
  const next = bands[index + 1]?.min ?? null;
  const own = bands[index]?.min ?? null;
  if (index === 0) return next === null ? "todas as notas" : `abaixo de ${formatLeadScore(next)}`;
  if (own === null) return "";
  if (next === null) return `${formatLeadScore(own)} ou mais`;
  return `${formatLeadScore(own)} a menos de ${formatLeadScore(next)}`;
}

// ── Resultado da conta por anúncio (implementação abaixo) ────────────────────

export interface LeadEconomicsBandResult {
  index: number;
  /** Nota mínima (null na primeira faixa). */
  min: number | null;
  /** Nota de corte da próxima faixa (exclusiva); null na última. */
  max: number | null;
  label: string;
  product: LeadEconomicsProduct;
  conversion: number;
  /** Leads com nota que caíram nesta faixa. */
  leads: number;
  /** leads ÷ leads com nota. */
  share: number;
  /** conversão × ticket. */
  revenuePerLead: number;
  /** conversão × ticket × sobra. */
  contributionPerLead: number;
  /** conversão × ticket × (sobra − margem desejada). */
  ceilingPerLead: number;
}

export interface LeadEconomicsResult {
  /** Leads com nota (a amostra; D13). Sempre > 0 num resultado não nulo. */
  leadsScored: number;
  bands: LeadEconomicsBandResult[];
  /** R = Σ fatia × conversão × ticket. */
  revenuePerLead: number;
  /** K = Σ fatia × conversão × ticket × sobra. */
  contributionPerLead: number;
  /** Teto de CPL = Σ fatia × conversão × ticket × (sobra − margem desejada). */
  cplCeiling: number;
  /** Gasto ÷ leads com nota; null quando o gasto não é um número finito. */
  cplActual: number | null;
  /** (K − CPL) ÷ R; null quando R = 0 (nenhum faturamento para dividir) ou sem CPL. */
  margin: number | null;
  /** Σ fatia × conversão × ticket × meta ÷ R; null quando R = 0. */
  targetMargin: number | null;
  /** Menos de LEAD_ECONOMICS_MIN_SAMPLE leads com nota (D7). */
  lowSample: boolean;
}

// ── A conta por anúncio ──────────────────────────────────────────────────────

/**
 * Soma em `into` os leads do dado bruto de leadscore, por nota distinta.
 *
 * Mesma leitura de `normalizeLeadscoreValues` (mqlMetrics.ts), nas duas formas:
 * - array: `Number(v || 0)`, só finitos — `null` vira nota 0, como no Leadscore Médio;
 * - histograma `{ "80": 2 }`: nota finita e quantidade `Math.trunc` > 0.
 * Mas SEM expandir o histograma em array: a linha de média soma centenas de linhas,
 * e um anúncio com 5 mil leads viraria 5 mil posições para contar umas 20 notas.
 * O teste de paridade (leadEconomics.test.ts) prende as duas leituras juntas.
 */
function addLeadscoreCounts(into: Map<number, number>, raw: unknown): void {
  if (Array.isArray(raw)) {
    for (const v of raw) {
      const score = Number(v || 0);
      if (Number.isFinite(score)) into.set(score, (into.get(score) ?? 0) + 1);
    }
    return;
  }
  if (raw && typeof raw === "object") {
    for (const [key, qtyRaw] of Object.entries(raw as Record<string, unknown>)) {
      const score = Number(key);
      const qty = Math.trunc(Number(qtyRaw));
      if (Number.isFinite(score) && Number.isFinite(qty) && qty > 0) {
        into.set(score, (into.get(score) ?? 0) + qty);
      }
    }
  }
}

/** Leads por nota distinta (`nota → quantidade`), a partir do array ou do histograma. */
export function countLeadscores(raw: unknown): Map<number, number> {
  const counts = new Map<number, number>();
  addLeadscoreCounts(counts, raw);
  return counts;
}

/**
 * Faixa da nota: a última cujo piso é ≤ nota. Abaixo do primeiro corte cai na
 * primeira faixa (sem piso). Nota exatamente no corte vai para a faixa de cima
 * (premissa 2) — por isso `>=`.
 */
function findBandIndex(bands: ReadonlyArray<LeadEconomicsBand>, score: number): number {
  for (let i = bands.length - 1; i > 0; i--) {
    const min = bands[i].min;
    if (min !== null && score >= min) return i;
  }
  return 0;
}

function finiteSpendOrNull(spend: number | null | undefined): number | null {
  return typeof spend === "number" && Number.isFinite(spend) ? spend : null;
}

/**
 * O núcleo: contagens por nota + gasto → resultado. Anúncio e linha de média
 * passam por aqui; o que muda entre eles é só de onde vêm as contagens.
 */
function computeFromScoreCounts(
  counts: ReadonlyMap<number, number>,
  spend: number | null,
  config: LeadEconomics,
): LeadEconomicsResult | null {
  if (config.bands.length === 0) return null;

  const bandLeads = new Array<number>(config.bands.length).fill(0);
  let leadsScored = 0;
  for (const [score, qty] of counts) {
    bandLeads[findBandIndex(config.bands, score)] += qty;
    leadsScored += qty;
  }
  if (leadsScored <= 0) return null;

  const bands: LeadEconomicsBandResult[] = [];
  let revenuePerLead = 0;
  let contributionPerLead = 0;
  let cplCeiling = 0;
  let targetPerLead = 0;

  for (let index = 0; index < config.bands.length; index++) {
    const band = config.bands[index];
    // Documento fora do contrato (normalizeLeadEconomics não deixaria passar): sem
    // produto não há conta honesta — indisponível, nunca uma faixa valendo zero.
    const product = findLeadEconomicsProduct(config, band.product);
    if (!product) return null;

    const leads = bandLeads[index];
    const share = leads / leadsScored;
    const bandRevenue = bandRevenuePerLead(band.conversion, product);
    const bandContribution = bandRevenue * product.contribution_margin;
    const bandCeiling = bandCeilingPerLead(band.conversion, product);

    revenuePerLead += share * bandRevenue;
    contributionPerLead += share * bandContribution;
    cplCeiling += share * bandCeiling;
    targetPerLead += share * bandRevenue * product.target_margin;

    bands.push({
      index,
      min: band.min,
      max: config.bands[index + 1]?.min ?? null,
      label: formatBandLabel(config.bands, index),
      product,
      conversion: band.conversion,
      leads,
      share,
      revenuePerLead: bandRevenue,
      contributionPerLead: bandContribution,
      ceilingPerLead: bandCeiling,
    });
  }

  const cplActual = spend === null ? null : spend / leadsScored;
  // R = 0 quando todo lead está em faixa de conversão zero: o teto é R$ 0 (verdade),
  // mas margem e meta não têm faturamento sobre o qual se dividir.
  const hasRevenue = revenuePerLead > 0;

  return {
    leadsScored,
    bands,
    revenuePerLead,
    contributionPerLead,
    cplCeiling,
    cplActual,
    margin: hasRevenue && cplActual !== null ? (contributionPerLead - cplActual) / revenuePerLead : null,
    targetMargin: hasRevenue ? targetPerLead / revenuePerLead : null,
    lowSample: leadsScored < LEAD_ECONOMICS_MIN_SAMPLE,
  };
}

/**
 * Cache por referência, como `computeMqlMetricsFromLeadscore`: dentro de um render o
 * mesmo anúncio passa por accessor → filtro → célula com a mesma referência do dado
 * bruto. Dado bruto → cadastro (também por referência) → gasto. WeakMap nos dois
 * primeiros níveis: dado ou cadastro novos soltam o que ficou velho.
 */
const _leadEconomicsCache = new WeakMap<
  object,
  WeakMap<LeadEconomics, Map<number | null | undefined, LeadEconomicsResult | null>>
>();

/**
 * Teto de CPL e margem de uma linha (anúncio, conjunto, campanha): a conta da
 * seção 5 do plano sobre a mistura de notas da linha. `null` sem cadastro ou sem
 * lead com nota — indisponível, nunca zero.
 */
export function computeLeadEconomics(params: {
  spend: number | null | undefined;
  leadscoreRaw: unknown;
  config: LeadEconomics | null;
}): LeadEconomicsResult | null {
  const { spend, leadscoreRaw, config } = params;
  if (!config) return null;
  // Fora de array/objeto não há lead com nota (normalizeLeadscoreValues devolve []).
  if (!leadscoreRaw || typeof leadscoreRaw !== "object") return null;

  let byConfig = _leadEconomicsCache.get(leadscoreRaw);
  if (!byConfig) {
    byConfig = new WeakMap();
    _leadEconomicsCache.set(leadscoreRaw, byConfig);
  }
  let bySpend = byConfig.get(config);
  if (!bySpend) {
    bySpend = new Map();
    byConfig.set(config, bySpend);
  }
  if (bySpend.has(spend)) return bySpend.get(spend) ?? null;

  const result = computeFromScoreCounts(countLeadscores(leadscoreRaw), finiteSpendOrNull(spend), config);
  bySpend.set(spend, result);
  return result;
}

/**
 * Linha de média do Manager (D17): soma as CONTAGENS de todas as linhas e o gasto e
 * faz a conta UMA vez sobre o total. Nunca a média dos tetos — ela daria a um
 * anúncio com 3 leads o mesmo peso de um com 300.
 *
 * Gasto: só os finitos entram na soma; se nenhuma linha tiver gasto finito, o CPL
 * fica indisponível (o teto não depende dele e continua calculado).
 */
export function computeLeadEconomicsForRows(
  rows: ReadonlyArray<{ spend: number | null | undefined; leadscoreRaw: unknown }>,
  config: LeadEconomics | null,
): LeadEconomicsResult | null {
  if (!config) return null;

  const counts = new Map<number, number>();
  let spendTotal = 0;
  let hasSpend = false;
  for (const row of rows) {
    addLeadscoreCounts(counts, row.leadscoreRaw);
    const spend = finiteSpendOrNull(row.spend);
    if (spend !== null) {
      spendTotal += spend;
      hasSpend = true;
    }
  }
  return computeFromScoreCounts(counts, hasSpend ? spendTotal : null, config);
}

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
  // A resolução por linha (D27) pergunta isto para cada pack de cada linha, várias
  // vezes por render; o cadastro normalizado é imutável e estável por referência.
  const cached = _semanticKeyCache.get(config);
  if (cached !== undefined) return cached;
  const key = buildSemanticKey(config);
  _semanticKeyCache.set(config, key);
  return key;
}

const _semanticKeyCache = new WeakMap<LeadEconomics, string>();

function buildSemanticKey(config: LeadEconomics): string {
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

// ── Resolução por linha (D27) ─────────────────────────────────────────────────
//
// Com vários packs selecionados, cada linha usa o cadastro dos packs de onde vêm
// os anúncios dela (`pack_ids`). Só a linha que junta packs com cadastros
// DIFERENTES (pela chave D20) fica indisponível — a tela inteira não some por
// causa dela, como sumia com a regra da tela (D16).

/**
 * Cadastro de cada pack SELECIONADO; `null` = pack selecionado sem cadastro. As
 * chaves são os packs da tela: uma linha sem `pack_ids` (payload antigo) se
 * resolve contra todos eles.
 */
export type LeadEconomicsByPack = Readonly<Record<string, LeadEconomics | null>>;

/** Por que uma linha não tem teto nem margem — a célula diz qual. */
export type LeadEconomicsUnavailableReason =
  /** Algum pack da linha não tem economia cadastrada. */
  | "no-economics"
  /** Os packs da linha têm cadastros com números diferentes. */
  | "mixed-economics"
  /** Cadastro existe, mas a linha não tem nenhum lead com nota. */
  | "no-scored-leads";

export type RowLeadEconomicsResolution =
  | { config: LeadEconomics; unavailable?: undefined }
  | { config?: undefined; unavailable: "no-economics" | "mixed-economics" };

const NO_ECONOMICS = Object.freeze({ unavailable: "no-economics" as const });
const MIXED_ECONOMICS = Object.freeze({ unavailable: "mixed-economics" as const });
const NO_SCORED_LEADS = Object.freeze({ unavailable: "no-scored-leads" as const });

// A resolução é por (mapa, lista de packs da linha): as duas referências são
// estáveis entre renders (o mapa vem memoizado; `pack_ids` é da linha da query).
const _resolutionCache = new WeakMap<LeadEconomicsByPack, WeakMap<readonly string[], RowLeadEconomicsResolution>>();
const _resolutionAllPacksCache = new WeakMap<LeadEconomicsByPack, RowLeadEconomicsResolution>();

function resolveFromPackIds(packIds: readonly string[], byPack: LeadEconomicsByPack): RowLeadEconomicsResolution {
  if (packIds.length === 0) return NO_ECONOMICS;
  let first: LeadEconomics | null = null;
  let firstKey = "";
  for (const packId of packIds) {
    const config = Object.prototype.hasOwnProperty.call(byPack, packId) ? byPack[packId] : null;
    // Pack sem cadastro (ou fora da seleção): parte dos leads da linha não tem
    // economia — calcular com o cadastro dos outros daria número de outro negócio.
    if (!config) return NO_ECONOMICS;
    const key = leadEconomicsSemanticKey(config);
    if (first === null) {
      first = config;
      firstKey = key;
    } else if (key !== firstKey) {
      return MIXED_ECONOMICS;
    }
  }
  return { config: first as LeadEconomics };
}

/** Cadastro que vale para uma linha, ou o motivo de não haver um. */
export function resolveRowLeadEconomics(
  packIds: readonly string[] | null | undefined,
  byPack: LeadEconomicsByPack,
): RowLeadEconomicsResolution {
  if (!Array.isArray(packIds) || packIds.length === 0) {
    const cached = _resolutionAllPacksCache.get(byPack);
    if (cached) return cached;
    const resolution = resolveFromPackIds(Object.keys(byPack), byPack);
    _resolutionAllPacksCache.set(byPack, resolution);
    return resolution;
  }
  let perRow = _resolutionCache.get(byPack);
  if (!perRow) {
    perRow = new WeakMap();
    _resolutionCache.set(byPack, perRow);
  }
  const cached = perRow.get(packIds);
  if (cached) return cached;
  const resolution = resolveFromPackIds(packIds, byPack);
  perRow.set(packIds, resolution);
  return resolution;
}

/** O que uma linha do Manager precisa carregar para a conta. */
export interface LeadEconomicsRowSource {
  pack_ids?: readonly string[] | null;
  spend?: unknown;
  leadscore_histogram?: unknown;
  leadscore_values?: unknown;
}

export type RowLeadEconomicsOutcome =
  | { result: LeadEconomicsResult; config: LeadEconomics; unavailable?: undefined }
  | { result?: undefined; config?: undefined; unavailable: LeadEconomicsUnavailableReason };

/**
 * Gasto da linha como número. As linhas da RPC já trazem número; texto numérico
 * (payload antigo) é aceito aqui, na borda, porque `computeLeadEconomics` só aceita
 * `number` e trataria "12.5" como gasto ausente.
 */
function rowSpend(spend: unknown): number | null {
  if (typeof spend === "number") return Number.isFinite(spend) ? spend : null;
  if (typeof spend === "string" && spend.trim() !== "") {
    const n = Number(spend);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function rowLeadscoreRaw(row: LeadEconomicsRowSource): unknown {
  // Mesma precedência de `getLeadscoreRaw` (mqlMetrics): histograma da RPC, senão o array cru.
  return row.leadscore_histogram ?? row.leadscore_values;
}

/** Teto e margem de UMA linha, com o cadastro dos packs dela (D27). */
export function getRowLeadEconomics(row: LeadEconomicsRowSource, byPack: LeadEconomicsByPack): RowLeadEconomicsOutcome {
  const resolution = resolveRowLeadEconomics(row.pack_ids, byPack);
  if (resolution.unavailable) return resolution;
  const result = computeLeadEconomics({ spend: rowSpend(row.spend), leadscoreRaw: rowLeadscoreRaw(row), config: resolution.config });
  if (!result) return NO_SCORED_LEADS;
  return { result, config: resolution.config };
}

/**
 * Folga do ponto flutuante na igualdade margem = meta. Matematicamente
 * `margem ≥ meta ⇔ CPL ≤ teto`; no ponto exato o arredondamento pode separar as
 * duas colunas (teto 8.399999999999999 × CPL 8.4 com margem = meta). Sem folga, a
 * Margem pintaria "abaixo da meta" um anúncio exatamente no teto.
 */
export const LEAD_ECONOMICS_TOLERANCE = 1e-9;

export type LeadMarginTone = "success" | "warning" | "destructive";

/**
 * Os três estados da Margem (D14): na meta ou acima (sucesso), lucrando mas abaixo
 * da meta (alerta), prejuízo (erro). Margem zero é empate — não é prejuízo.
 */
export function leadMarginTone(margin: number | null | undefined, targetMargin: number | null | undefined): LeadMarginTone | null {
  if (margin == null || !Number.isFinite(margin)) return null;
  if (margin < -LEAD_ECONOMICS_TOLERANCE) return "destructive";
  if (targetMargin != null && Number.isFinite(targetMargin) && margin >= targetMargin - LEAD_ECONOMICS_TOLERANCE) return "success";
  return "warning";
}

/**
 * A Margem da linha diante da meta, como VALOR — o que o filtro "Margem vs meta"
 * compara e o que o "N de M abaixo da meta de margem" conta. A meta muda de pack
 * para pack (é a margem desejada do produto de cada faixa), então nenhuma condição
 * "Margem < X%" responde "abaixo da meta" numa tela com dois cadastros.
 */
export type LeadMarginStatus = "on_target" | "below_target" | "loss";

const TONE_TO_STATUS: Record<LeadMarginTone, LeadMarginStatus> = {
  success: "on_target",
  warning: "below_target",
  destructive: "loss",
};

/** Mesma régua da cor da célula (`leadMarginTone`, com a folga). `null` = linha sem margem. */
export function leadMarginStatus(margin: number | null | undefined, targetMargin: number | null | undefined): LeadMarginStatus | null {
  const tone = leadMarginTone(margin, targetMargin);
  return tone ? TONE_TO_STATUS[tone] : null;
}

export function getRowLeadMarginStatus(row: LeadEconomicsRowSource, byPack: LeadEconomicsByPack): LeadMarginStatus | null {
  const outcome = getRowLeadEconomics(row, byPack);
  return outcome.result ? leadMarginStatus(outcome.result.margin, outcome.result.targetMargin) : null;
}

export interface LeadEconomicsAggregate {
  leadsScored: number;
  revenuePerLead: number;
  contributionPerLead: number;
  cplCeiling: number;
  cplActual: number | null;
  margin: number | null;
  targetMargin: number | null;
  lowSample: boolean;
}

export interface LeadEconomicsRowsSummary {
  /** Média do conjunto; null quando nenhuma linha com cadastro tem lead com nota. */
  aggregate: LeadEconomicsAggregate | null;
  /** Linhas com lead ou gasto deixadas de fora da média, por motivo. */
  excludedMixed: number;
  excludedNoEconomics: number;
  /** Linhas com margem calculável, e quantas delas abaixo da própria meta. */
  rowsWithMargin: number;
  rowsBelowTarget: number;
}

function hasAnyScoredLead(raw: unknown): boolean {
  if (Array.isArray(raw)) return raw.length > 0;
  if (raw && typeof raw === "object") {
    for (const qty of Object.values(raw as Record<string, unknown>)) {
      if (Math.trunc(Number(qty)) > 0) return true;
    }
  }
  return false;
}

/**
 * Linha de média do Manager com a economia de cada linha (D27): cada linha entra
 * com o PRÓPRIO cadastro, e o resultado é ponderado pelos leads com nota dela.
 *
 * Com um cadastro só, dá exatamente o número de `computeLeadEconomicsForRows`
 * (contagens somadas): R, K e teto do conjunto são a média dos R, K e tetos das
 * linhas pesada pelos leads; a meta pesa também pelo faturamento; o CPL é o gasto
 * das linhas que entraram (inclusive as sem lead, que também custaram) ÷ os leads.
 * Nunca a média simples dos tetos (D17) — um anúncio com 3 leads pesaria igual a
 * um com 300.
 *
 * Linha indisponível (packs sem cadastro ou com cadastros diferentes) fica de fora,
 * com gasto e tudo, e é contada — o cabeçalho avisa que a média não cobre tudo.
 */
export function aggregateRowsLeadEconomics(
  rows: ReadonlyArray<LeadEconomicsRowSource>,
  byPack: LeadEconomicsByPack,
): LeadEconomicsRowsSummary {
  let leads = 0;
  let sumRevenue = 0;
  let sumContribution = 0;
  let sumCeiling = 0;
  let sumTargetRevenue = 0;
  let spendTotal = 0;
  let hasSpend = false;
  let excludedMixed = 0;
  let excludedNoEconomics = 0;
  let rowsWithMargin = 0;
  let rowsBelowTarget = 0;

  for (const row of rows) {
    const resolution = resolveRowLeadEconomics(row.pack_ids, byPack);
    const spend = rowSpend(row.spend);
    const raw = rowLeadscoreRaw(row);

    if (resolution.unavailable) {
      // Linha sem lead e sem gasto não muda a média: não há o que avisar.
      if (hasAnyScoredLead(raw) || (spend !== null && spend !== 0)) {
        if (resolution.unavailable === "mixed-economics") excludedMixed += 1;
        else excludedNoEconomics += 1;
      }
      continue;
    }

    if (spend !== null) {
      spendTotal += spend;
      hasSpend = true;
    }

    const result = computeLeadEconomics({ spend, leadscoreRaw: raw, config: resolution.config });
    if (!result) continue;

    const weight = result.leadsScored;
    leads += weight;
    sumRevenue += result.revenuePerLead * weight;
    sumContribution += result.contributionPerLead * weight;
    sumCeiling += result.cplCeiling * weight;
    sumTargetRevenue += (result.targetMargin ?? 0) * result.revenuePerLead * weight;

    if (result.margin !== null) {
      rowsWithMargin += 1;
      // A mesma régua do filtro "Margem vs meta": o link do resumo filtra exatamente estas.
      if (leadMarginStatus(result.margin, result.targetMargin) !== "on_target") rowsBelowTarget += 1;
    }
  }

  if (leads === 0) {
    return { aggregate: null, excludedMixed, excludedNoEconomics, rowsWithMargin, rowsBelowTarget };
  }

  const revenuePerLead = sumRevenue / leads;
  const contributionPerLead = sumContribution / leads;
  const cplActual = hasSpend ? spendTotal / leads : null;
  return {
    aggregate: {
      leadsScored: leads,
      revenuePerLead,
      contributionPerLead,
      cplCeiling: sumCeiling / leads,
      cplActual,
      margin: revenuePerLead > 0 && cplActual !== null ? (contributionPerLead - cplActual) / revenuePerLead : null,
      targetMargin: sumRevenue > 0 ? sumTargetRevenue / sumRevenue : null,
      lowSample: leads < LEAD_ECONOMICS_MIN_SAMPLE,
    },
    excludedMixed,
    excludedNoEconomics,
    rowsWithMargin,
    rowsBelowTarget,
  };
}

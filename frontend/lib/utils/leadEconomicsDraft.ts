/**
 * Economia do lead — o RASCUNHO do cadastro na tela e a conversão texto ↔ número.
 *
 * A tela guarda o que foi digitado como TEXTO (como o diálogo já faz com o corte de
 * MQL e o CPR alvo): "55,5" precisa sobreviver enquanto a pessoa digita, e um campo
 * numérico viraria NaN no meio do caminho. Só na hora de validar o texto vira número
 * e passa por `validateLeadEconomics` — as mensagens de erro são as do contrato
 * (`leadEconomics.ts`), nunca uma versão paralela daqui. Duas exceções: o rótulo curto
 * AO LADO do campo (`leadEconomicsDraftFieldIssues`: mesmas regras, e um teste de
 * propriedade prende "campo com erro" a "o contrato recusa"), e a frase do corte que
 * não é número (`LEAD_ECONOMICS_UNREADABLE_CUT_MESSAGE`), que o contrato não tem como
 * distinguir de corte em branco.
 *
 * Unidades: a tela mostra PORCENTAGEM ("55" = 55%) e o documento guarda FRAÇÃO
 * (0.55). Dinheiro e nota são o próprio número.
 *
 * Precisão: cada campo lê e mostra com o MESMO número de casas (nota 6, dinheiro 2,
 * porcentagem 4), arredondando já na leitura. Assim documento → tela → documento
 * é ponto fixo: reabrir o cadastro e mexer em outro campo não regrava um corte
 * 0,87345 como 0,8735 (o que mudaria leads de faixa sem ninguém tocar nele).
 *
 * Plano: documentation/plano-economia-do-lead.md (seções 6 e 13).
 */

import {
  LEAD_ECONOMICS_MAX_PRODUCTS,
  LEAD_ECONOMICS_MESSAGES,
  LEAD_ECONOMICS_PRODUCT_NAME_MAX,
  bandCeilingPerLead,
  formatLeadScore,
  productNameKey,
  validateLeadEconomics,
  type LeadEconomics,
  type LeadEconomicsValidation,
} from "./leadEconomics";

// ── Tipos do rascunho ────────────────────────────────────────────────────────

export interface LeadEconomicsProductDraft {
  /** Id estável do produto: gerado ao criar, nunca derivado do nome (D12). */
  id: string;
  name: string;
  /** Ticket digitado, na moeda da conta ("3.000", "3000,50"). */
  ticket: string;
  /** "De cada venda, quanto sobra?", em PORCENTAGEM digitada ("55" = 0.55). */
  contribution: string;
  /** Margem de lucro desejada, em PORCENTAGEM digitada ("40" = 0.40). */
  target: string;
}

export interface LeadEconomicsBandDraft {
  /** Chave só da tela (React): faixa não tem id no documento. */
  key: string;
  /** Nota de corte digitada. Ignorada na primeira faixa, que não tem piso. */
  min: string;
  /** `LeadEconomicsProductDraft.id`. Com um produto só, a conversão aponta para ele. */
  product: string;
  /** Conversão em PORCENTAGEM digitada ("0,5" = 0.005). */
  conversion: string;
}

export interface LeadEconomicsDraft {
  products: LeadEconomicsProductDraft[];
  bands: LeadEconomicsBandDraft[];
}

// ── Ids ──────────────────────────────────────────────────────────────────────

/**
 * Id novo de produto (ou chave de faixa). `crypto.randomUUID` só existe em contexto
 * seguro (https/localhost); fora dele, um id aleatório curto — cabe nos 40
 * caracteres do contrato de qualquer jeito.
 */
export function newLeadEconomicsId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Texto → número ───────────────────────────────────────────────────────────

/**
 * Número digitado num campo em português. Vírgula é decimal ("55,5", "0,125");
 * ponto em grupos de três é milhar ("3.000", "1.234.567") e fora disso é decimal
 * ("3000.5", "0.125"); com os dois, o último é o decimal ("3.000,50", "3,000.50").
 * Aceita símbolo de moeda na frente e "%" no fim. Vazio ou lixo → `null`.
 *
 * Não reusa `parseSheetNumber` (planilha) de propósito: lá "0,125" vira 125 (lê a
 * vírgula como milhar do inglês), o que aqui transformaria uma nota de corte 0,125
 * em 125 sem erro nenhum. Nem o `parseBudgetInput` do BudgetCell, que lê "3.000"
 * como 3.
 */
export function parseDecimalInput(raw: string): number | null {
  let text = String(raw ?? "")
    .replace(/\s+/g, "")
    .replace(/^(R\$|US\$|\$|€|£)/, "")
    .replace(/%$/, "");
  if (!text) return null;

  const hasComma = text.includes(",");
  const hasPeriod = text.includes(".");
  if (hasComma && hasPeriod) {
    text = text.lastIndexOf(",") > text.lastIndexOf(".") ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (hasComma) {
    // Mais de uma vírgula em grupos de três é milhar no formato inglês ("1,234,567").
    text = /^-?\d{1,3}(,\d{3}){2,}$/.test(text) ? text.replace(/,/g, "") : text.replace(",", ".");
  } else if (hasPeriod && /^-?[1-9]\d{0,2}(\.\d{3})+$/.test(text)) {
    // Primeiro grupo sem zero à esquerda: "0.125" continua decimal.
    text = text.replace(/\./g, "");
  }

  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Casas da nota de corte: as mesmas da nota de leadscore na tela (`formatLeadScore`). */
export const LEAD_ECONOMICS_SCORE_DECIMALS = 6;
/** Casas do dinheiro: centavos. */
export const LEAD_ECONOMICS_MONEY_DECIMALS = 2;
/** Casas da PORCENTAGEM na tela — 6 da fração no documento. */
export const LEAD_ECONOMICS_PERCENT_DECIMALS = 4;

/**
 * `k / 10^casas` numa divisão só: é o mesmo número que o texto "k com casas" vira
 * no parser, então o que a tela mostra volta idêntico. O `+ 0` troca -0 por 0 —
 * senão "-0,0000001" viraria um "-0" na tela.
 */
function roundDecimals(value: number, decimals: number): number {
  return Math.round(value * 10 ** decimals) / 10 ** decimals + 0;
}

/**
 * Número finito, ou null. Um texto de 300+ dígitos é finito no parser mas estoura
 * para Infinity ao multiplicar por 10^casas; sem isto ele chegava ao contrato como
 * "sem nota de corte" e a tela não tinha frase para mostrar — o save travava sem
 * dizer onde. Como null, vira "não é um número", no campo e no resumo.
 */
function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/** Nota de corte digitada, arredondada nas casas com que volta para a tela. */
export function parseScoreInput(raw: string): number | null {
  const value = parseDecimalInput(raw);
  return value === null ? null : finiteOrNull(roundDecimals(value, LEAD_ECONOMICS_SCORE_DECIMALS));
}

/** Dinheiro digitado, arredondado em centavos: "3.000,505" → 3000.51. */
export function parseMoneyInput(raw: string): number | null {
  const value = parseDecimalInput(raw);
  return value === null ? null : finiteOrNull(roundDecimals(value, LEAD_ECONOMICS_MONEY_DECIMALS));
}

/**
 * Porcentagem digitada → fração: "55" → 0.55, "55,5" → 0.555, "0,5" → 0.005.
 * Arredonda em 4 casas da porcentagem (6 da fração) — o mesmo limite com que o
 * número volta para a tela. Sem isso "14,3" gravaria 0.14300000000000002, e dois
 * packs cadastrados com os mesmos números podiam divergir no ruído.
 */
export function parsePercentInput(raw: string): number | null {
  const percent = parseDecimalInput(raw);
  if (percent === null) return null;
  // Uma divisão só (e não arredondar e depois ÷ 100): dois arredondamentos de ponto
  // flutuante podiam cair no vizinho do número que o texto da tela representa.
  return finiteOrNull(Math.round(percent * 10 ** LEAD_ECONOMICS_PERCENT_DECIMALS) / 10 ** (LEAD_ECONOMICS_PERCENT_DECIMALS + 2) + 0);
}

// ── Número → texto (documento → rascunho) ────────────────────────────────────

const scoreFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: LEAD_ECONOMICS_SCORE_DECIMALS,
  useGrouping: false,
});
const percentFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: LEAD_ECONOMICS_PERCENT_DECIMALS,
  useGrouping: false,
});
const moneyIntegerFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0, useGrouping: true });
const moneyDecimalFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: LEAD_ECONOMICS_MONEY_DECIMALS,
  maximumFractionDigits: LEAD_ECONOMICS_MONEY_DECIMALS,
  useGrouping: true,
});

/** Nota de corte para o campo: sem milhar, até 6 casas ("1000", "0,125", "0,87345"). */
export function formatScoreInput(value: number): string {
  return scoreFormatter.format(value);
}

/** Dinheiro para o campo: "3.000", "3.000,50". Volta idêntico por `parseMoneyInput`. */
export function formatMoneyInput(value: number): string {
  const cents = roundDecimals(value, LEAD_ECONOMICS_MONEY_DECIMALS);
  return Number.isInteger(cents) ? moneyIntegerFormatter.format(cents) : moneyDecimalFormatter.format(cents);
}

/**
 * Fração → porcentagem para o campo: 0.55 → "55" (e não 55.00000000000001),
 * 0.555 → "55,5", 0.005 → "0,5". Até 4 casas, sem zeros à direita.
 */
export function formatPercentInput(fraction: number): string {
  return percentFormatter.format(fraction * 100);
}

// ── Rascunho ↔ documento ─────────────────────────────────────────────────────

function isBlank(raw: string): boolean {
  return raw.trim() === "";
}

function numberOrNaN(value: number | null): number {
  return value === null ? NaN : value;
}

/**
 * O nome como o CONTRATO o lê: em branco, longo demais, ou a chave de comparação
 * do nome gravado. Pergunta ao próprio `validateLeadEconomics` (com um produto
 * mínimo) em vez de repetir aqui a limpeza que ele faz — ela já mudou uma vez
 * (caractere de controle vira espaço), e uma cópia daqui ficaria para trás calada.
 */
function readProductName(raw: string): { kind: "blank" } | { kind: "tooLong" } | { kind: "ok"; key: string } {
  const M = LEAD_ECONOMICS_MESSAGES;
  const { value, errors } = validateLeadEconomics({
    products: [{ id: "nome", name: raw, ticket: 1, contribution_margin: 1, target_margin: 0 }],
    bands: [{ min: null, product: "nome", conversion: 0 }],
  });
  if (errors.includes(M.productNameMissing)) return { kind: "blank" };
  if (errors.includes(M.productNameTooLong)) return { kind: "tooLong" };
  return { kind: "ok", key: productNameKey(value?.products[0].name ?? raw) };
}

/**
 * Rascunho → documento com números, ANTES da validação (pode ter NaN: é o
 * validador do contrato que diz o que está errado).
 *
 * O nome é obrigatório mesmo com UM produto (revisão P1, 2026-09-29): antes, nesse
 * caso, o campo sumia e o nome gravado era "Produto" — que depois aparecia nas
 * mensagens de erro ("Nenhum lead de "Produto" se paga") sem a pessoa ter escrito.
 * Com um produto, toda faixa aponta para ele, qualquer que seja o id guardado nela.
 */
export function draftToLeadEconomicsDocument(draft: LeadEconomicsDraft) {
  const single = draft.products.length === 1;
  return {
    products: draft.products.map((product) => ({
      id: product.id,
      name: product.name,
      ticket: numberOrNaN(parseMoneyInput(product.ticket)),
      contribution_margin: numberOrNaN(parsePercentInput(product.contribution)),
      target_margin: numberOrNaN(parsePercentInput(product.target)),
    })),
    bands: draft.bands.map((band, index) => ({
      min: index === 0 ? null : parseScoreInput(band.min),
      product: single ? draft.products[0].id : band.product,
      conversion: numberOrNaN(parsePercentInput(band.conversion)),
    })),
  };
}

/**
 * Valida o rascunho com o contrato (`validateLeadEconomics`). O `value` é o
 * documento canônico que vai para o backend; `errors`, as mensagens do contrato.
 */
export function validateLeadEconomicsDraft(draft: LeadEconomicsDraft): LeadEconomicsValidation {
  return validateLeadEconomics(draftToLeadEconomicsDocument(draft));
}

/**
 * Frase da TELA para corte que não é número ("7O"). O contrato só recebe o número
 * convertido: para ele texto ilegível e campo em branco são o mesmo vazio, e a frase
 * dele é "Toda faixa depois da primeira precisa de uma nota de corte." — que, com
 * "7O" no campo, contradizia o "Não é um número." ao lado dele.
 */
export const LEAD_ECONOMICS_UNREADABLE_CUT_MESSAGE = "Uma nota de corte não é um número.";

/**
 * Troca a frase de "falta corte" do contrato pelo que há de fato nos campos de corte
 * (na mesma posição da lista): em branco → a frase do contrato, só se `countBlank`;
 * ilegível → a da tela. O contrato só emite essa frase quando algum corte depois da
 * primeira faixa não virou número — em branco ou ilegível, nada mais.
 */
function phraseCutErrors(errors: string[], draft: LeadEconomicsDraft, countBlank: boolean): string[] {
  let blank = false;
  let unreadable = false;
  draft.bands.forEach((band, index) => {
    if (index === 0) return;
    if (isBlank(band.min)) blank = true;
    else if (parseScoreInput(band.min) === null) unreadable = true;
  });
  return errors.flatMap((message) => {
    if (message !== LEAD_ECONOMICS_MESSAGES.bandMinMissing) return [message];
    const phrased: string[] = [];
    if (blank && countBlank) phrased.push(message);
    if (unreadable) phrased.push(LEAD_ECONOMICS_UNREADABLE_CUT_MESSAGE);
    return phrased;
  });
}

/**
 * Erros para o resumo depois de tentar salvar e para o aviso do save: os do contrato
 * (`validateLeadEconomicsDraft`), com o corte ilegível dito como tal.
 */
export function leadEconomicsDraftErrors(draft: LeadEconomicsDraft): string[] {
  return phraseCutErrors(validateLeadEconomicsDraft(draft).errors, draft, true);
}

/**
 * Erros para mostrar ENQUANTO se digita, sem abrir o formulário com uma parede de
 * "preencha isto": campo VAZIO conta como um valor neutro válido (ticket 1, sobra
 * 100%, margem 0%, conversão 0%) e "falta nome"/"falta corte" saem da lista
 * enquanto o campo está em branco. O que sobra é engano de verdade: margem desejada
 * acima da sobra, conversão de 150%, cortes fora de ordem, texto que não é número.
 *
 * Só serve para exibir. Salvar valida com `leadEconomicsDraftErrors`, que cobra
 * os campos vazios.
 */
export function leadEconomicsDraftLiveErrors(draft: LeadEconomicsDraft): string[] {
  const neutral: LeadEconomicsDraft = {
    products: draft.products.map((product) => ({
      ...product,
      ticket: isBlank(product.ticket) ? "1" : product.ticket,
      contribution: isBlank(product.contribution) ? "100" : product.contribution,
      target: isBlank(product.target) ? "0" : product.target,
    })),
    bands: draft.bands.map((band) => ({
      ...band,
      conversion: isBlank(band.conversion) ? "0" : band.conversion,
    })),
  };
  // Nome não tem "ilegível": só falta quando está em branco. Corte tem — texto que
  // não é número continua acusando (com a frase da tela; em branco, não acusa).
  const errors = validateLeadEconomics(draftToLeadEconomicsDocument(neutral)).errors.filter(
    (message) => message !== LEAD_ECONOMICS_MESSAGES.productNameMissing,
  );
  return phraseCutErrors(errors, draft, false);
}

// ── Erro por campo (para marcar o campo, não só listar) ──────────────────────

/**
 * Mensagens curtas, só da tela, para ficar AO LADO do campo (e no aria-invalid
 * dele). A lista completa continua com as frases do contrato; aqui o campo já diz
 * de quem é o erro, então a frase não precisa repetir o produto ou a faixa.
 */
export const LEAD_ECONOMICS_FIELD_MESSAGES = {
  required: "Obrigatório.",
  notANumber: "Não é um número.",
  positive: "Maior que zero.",
  contributionRange: "Maior que 0% e até 100%.",
  targetRange: "De 0% a menos de 100%.",
  targetNotBelowContribution: "Menor que o quanto sobra.",
  conversionRange: "Entre 0% e 100%.",
  cutNotIncreasing: "Maior que o corte anterior.",
  nameTooLong: `Até ${LEAD_ECONOMICS_PRODUCT_NAME_MAX} caracteres.`,
  nameDuplicate: "Nome repetido.",
  productMissing: "Escolha um produto.",
} as const;

export interface LeadEconomicsProductFieldIssues {
  name?: string;
  ticket?: string;
  contribution?: string;
  target?: string;
}

export interface LeadEconomicsBandFieldIssues {
  min?: string;
  conversion?: string;
  product?: string;
}

/** Mesma ordem e tamanho de `draft.products` / `draft.bands`; campo sem problema não tem chave. */
export interface LeadEconomicsFieldIssues {
  products: LeadEconomicsProductFieldIssues[];
  bands: LeadEconomicsBandFieldIssues[];
}

/** Remove as chaves `undefined`: "sem problema" é ausência, não um valor. */
function onlyIssues<T extends object>(issues: T): T {
  return Object.fromEntries(Object.entries(issues).filter(([, message]) => message !== undefined)) as T;
}

/**
 * Número de um campo: em branco (só acusa com `showAll`), ilegível, fora da regra
 * ou o próprio número. `value` só vem quando o campo está válido — é o que as
 * regras entre campos (margem < sobra, cortes crescentes) comparam.
 */
function readNumberField(
  raw: string,
  parse: (raw: string) => number | null,
  isValid: (value: number) => boolean,
  invalidMessage: string,
  showAll: boolean,
): { issue?: string; value: number | null } {
  const F = LEAD_ECONOMICS_FIELD_MESSAGES;
  if (isBlank(raw)) return { issue: showAll ? F.required : undefined, value: null };
  const value = parse(raw);
  if (value === null) return { issue: F.notANumber, value: null };
  if (!isValid(value)) return { issue: invalidMessage, value: null };
  return { value };
}

/**
 * O erro de CADA campo, com as regras do contrato (`validateLeadEconomics`) na
 * granularidade do campo — o editor usa para marcar o campo (aria-invalid) e dizer
 * qual faixa ou produto está errado, coisa que a lista de frases não diz.
 *
 * `showAll: false` segue `leadEconomicsDraftLiveErrors`: só engano de verdade
 * (texto que não é número, número fora da regra, contradição entre campos); campo em
 * branco não acusa. `showAll: true` (depois de tentar salvar) acusa também o que
 * falta — o nome inclusive, com um produto ou com vários.
 *
 * As duas funções não podem divergir: o teste de propriedade prende "há erro de
 * campo" = "o contrato recusa" (e = "há erro ao vivo", no modo sem `showAll`).
 */
export function leadEconomicsDraftFieldIssues(
  draft: LeadEconomicsDraft,
  { showAll = false }: { showAll?: boolean } = {},
): LeadEconomicsFieldIssues {
  const F = LEAD_ECONOMICS_FIELD_MESSAGES;
  const single = draft.products.length === 1;

  const seenNames = new Set<string>();
  const products = draft.products.map((product): LeadEconomicsProductFieldIssues => {
    let name: string | undefined;
    const read = readProductName(product.name);
    if (read.kind === "blank") {
      if (showAll) name = F.required;
    } else if (read.kind === "tooLong") {
      name = F.nameTooLong;
    } else {
      // O contrato acusa o nome que REPETE um anterior; o primeiro fica limpo.
      if (seenNames.has(read.key)) name = F.nameDuplicate;
      seenNames.add(read.key);
    }

    const ticket = readNumberField(product.ticket, parseMoneyInput, (v) => v > 0, F.positive, showAll);
    const contribution = readNumberField(product.contribution, parsePercentInput, (v) => v > 0 && v <= 1, F.contributionRange, showAll);
    const target = readNumberField(product.target, parsePercentInput, (v) => v >= 0 && v < 1, F.targetRange, showAll);
    // Só compara quando os dois são números válidos, como o contrato.
    const targetIssue =
      target.issue ??
      (contribution.value !== null && target.value !== null && target.value >= contribution.value ? F.targetNotBelowContribution : undefined);

    return onlyIssues({ name, ticket: ticket.issue, contribution: contribution.issue, target: targetIssue });
  });

  const productIds = new Set(draft.products.map((product) => product.id.trim()));
  // Corte anterior VÁLIDO: em branco ou ilegível não entra na comparação (contrato).
  let previousMin: number | null = null;
  const bands = draft.bands.map((band, index): LeadEconomicsBandFieldIssues => {
    let min: string | undefined;
    if (index > 0) {
      if (isBlank(band.min)) {
        if (showAll) min = F.required;
      } else {
        const value = parseScoreInput(band.min);
        if (value === null) {
          min = F.notANumber;
        } else {
          if (previousMin !== null && !(value > previousMin)) min = F.cutNotIncreasing;
          previousMin = value;
        }
      }
    }

    // Com um produto só, a faixa aponta para ele de qualquer jeito (o seletor só mostra ele).
    const productId = band.product.trim();
    const product = !single && (!productId || !productIds.has(productId)) ? F.productMissing : undefined;

    const conversion = readNumberField(band.conversion, parsePercentInput, (v) => v >= 0 && v <= 1, F.conversionRange, showAll);
    return onlyIssues({ min, product, conversion: conversion.issue });
  });

  return { products, bands };
}

/** Algum campo com erro? */
export function hasLeadEconomicsFieldIssues(issues: LeadEconomicsFieldIssues): boolean {
  return [...issues.products, ...issues.bands].some((item) => Object.keys(item).length > 0);
}

/** Documento gravado (já normalizado) → rascunho. Ids de produto preservados. */
export function leadEconomicsToDraft(doc: LeadEconomics): LeadEconomicsDraft {
  return {
    products: doc.products.map((product) => ({
      id: product.id,
      name: product.name,
      ticket: formatMoneyInput(product.ticket),
      contribution: formatPercentInput(product.contribution_margin),
      target: formatPercentInput(product.target_margin),
    })),
    bands: doc.bands.map((band) => ({
      key: newLeadEconomicsId(),
      min: band.min === null ? "" : formatScoreInput(band.min),
      product: band.product,
      conversion: formatPercentInput(band.conversion),
    })),
  };
}

/**
 * Rascunho inicial de quem clica "Configurar": um produto em branco e, se o pack
 * tem corte de MQL, duas faixas separadas nele (o ponto de partida mais comum:
 * "abaixo do MQL" e "MQL ou mais"); sem corte, uma faixa só.
 */
export function createLeadEconomicsDraft(mqlLeadscoreMin: number | null): LeadEconomicsDraft {
  const product: LeadEconomicsProductDraft = { id: newLeadEconomicsId(), name: "", ticket: "", contribution: "", target: "" };
  const band = (min: string): LeadEconomicsBandDraft => ({ key: newLeadEconomicsId(), min, product: product.id, conversion: "" });
  const hasMql = mqlLeadscoreMin !== null && Number.isFinite(mqlLeadscoreMin);
  return {
    products: [product],
    bands: hasMql ? [band(""), band(formatScoreInput(mqlLeadscoreMin))] : [band("")],
  };
}

// ── Leitura do rascunho para a tela ──────────────────────────────────────────

/** Cortes já convertidos; `null` na primeira faixa e em corte vazio ou ilegível. */
export function draftBandMins(draft: LeadEconomicsDraft): (number | null)[] {
  return draft.bands.map((band, index) => (index === 0 ? null : parseScoreInput(band.min)));
}

/**
 * Rótulo da faixa a partir dos cortes JÁ convertidos (`draftBandMins`). A conta é
 * uma só para o rótulo de uma faixa e o de todas, para elas nunca divergirem.
 */
function bandLabelFromMins(mins: readonly (number | null)[], index: number): string {
  if (mins.length <= 1) return "todas as notas";
  const own = mins[index] ?? null;
  const next = index + 1 < mins.length ? mins[index + 1] : null;
  const isLast = index === mins.length - 1;
  if (index === 0) return next === null ? "abaixo do próximo corte" : `abaixo de ${formatLeadScore(next)}`;
  if (own === null) return `faixa ${index + 1}`;
  if (isLast) return `${formatLeadScore(own)} ou mais`;
  if (next === null) return `a partir de ${formatLeadScore(own)}`;
  return `${formatLeadScore(own)} a menos de ${formatLeadScore(next)}`;
}

/**
 * Rótulo da faixa para a tela e para o aviso de "produto em uso". Enquanto o corte
 * seguinte não é um número, a primeira faixa não tem como dizer "abaixo de quanto".
 */
export function draftBandLabel(draft: LeadEconomicsDraft, index: number): string {
  return bandLabelFromMins(draftBandMins(draft), index);
}

/**
 * O rótulo de TODAS as faixas, lendo os cortes uma vez. O editor chama isto a cada
 * tecla: com `draftBandLabel` por faixa, cada rótulo relia todos os cortes e o render
 * custava O(n²) — 0,8 s por tecla com mil faixas (o cadastro não tem teto de faixas).
 */
export function draftBandLabels(draft: LeadEconomicsDraft): string[] {
  const mins = draftBandMins(draft);
  return mins.map((_, index) => bandLabelFromMins(mins, index));
}

/**
 * Teto por lead da faixa, ao vivo, com os números do formulário: conversão × ticket
 * × (sobra − margem desejada). `null` enquanto a faixa ou o produto dela não
 * passarem no contrato — a tela mostra "—", nunca um teto de mentira.
 *
 * A checagem é o próprio `validateLeadEconomics` sobre um cadastro mínimo (o produto
 * da faixa e ela como faixa única), para não repetir aqui as regras de cada campo.
 */
export function draftBandCeiling(draft: LeadEconomicsDraft, index: number): number | null {
  if (!draft.bands[index]) return null;
  return bandCeilingFromDocument(draftToLeadEconomicsDocument(draft), index);
}

/** O teto de TODAS as faixas, convertendo o rascunho uma vez (ver `draftBandLabels`). */
export function draftBandCeilings(draft: LeadEconomicsDraft): (number | null)[] {
  const doc = draftToLeadEconomicsDocument(draft);
  return doc.bands.map((_, index) => bandCeilingFromDocument(doc, index));
}

function bandCeilingFromDocument(doc: ReturnType<typeof draftToLeadEconomicsDocument>, index: number): number | null {
  const productId = doc.bands[index].product;
  const product = doc.products.find((item) => item.id === productId);
  if (!product) return null;
  const { value } = validateLeadEconomics({
    products: [{ ...product, name: "produto" }],
    bands: [{ min: null, product: product.id, conversion: doc.bands[index].conversion }],
  });
  if (!value) return null;
  return bandCeilingPerLead(value.bands[0].conversion, value.products[0]);
}

/** Índices das faixas que usam o produto (com um produto só, todas). */
export function bandsUsingProduct(draft: LeadEconomicsDraft, productId: string): number[] {
  const single = draft.products.length === 1;
  const out: number[] = [];
  draft.bands.forEach((band, index) => {
    if (single ? draft.products[0].id === productId : band.product === productId) out.push(index);
  });
  return out;
}

/** Separa as mensagens do contrato por bloco da tela: faixas × produtos. */
const BAND_MESSAGES = new Set<string>([
  LEAD_ECONOMICS_MESSAGES.noBands,
  LEAD_ECONOMICS_MESSAGES.firstBandHasMin,
  LEAD_ECONOMICS_MESSAGES.bandMinMissing,
  LEAD_ECONOMICS_UNREADABLE_CUT_MESSAGE,
  LEAD_ECONOMICS_MESSAGES.bandMinNotIncreasing,
  LEAD_ECONOMICS_MESSAGES.bandProductMissing,
  LEAD_ECONOMICS_MESSAGES.bandConversion,
]);

export function isLeadEconomicsBandMessage(message: string): boolean {
  return BAND_MESSAGES.has(message);
}

// ── Edição (funções puras: rascunho → rascunho) ──────────────────────────────

export function canAddDraftProduct(draft: LeadEconomicsDraft): boolean {
  return draft.products.length < LEAD_ECONOMICS_MAX_PRODUCTS;
}

export function addDraftProduct(draft: LeadEconomicsDraft): LeadEconomicsDraft {
  if (!canAddDraftProduct(draft)) return draft;
  const product: LeadEconomicsProductDraft = { id: newLeadEconomicsId(), name: "", ticket: "", contribution: "", target: "" };
  // Com um produto só, a faixa aponta para ele qualquer que seja o id guardado; com
  // o segundo, o id passa a valer: garante que todas apontam para o produto que já
  // existia (e não para um id velho).
  const bands =
    draft.products.length === 1 ? draft.bands.map((band) => ({ ...band, product: draft.products[0].id })) : draft.bands;
  return { products: [...draft.products, product], bands };
}

export function updateDraftProduct(
  draft: LeadEconomicsDraft,
  productId: string,
  patch: Partial<Omit<LeadEconomicsProductDraft, "id">>,
): LeadEconomicsDraft {
  return {
    ...draft,
    products: draft.products.map((product) => (product.id === productId ? { ...product, ...patch } : product)),
  };
}

/**
 * Remove o produto. As faixas que o usavam passam para `moveBandsTo` — a tela
 * pergunta para onde antes de chamar. Nunca deixa zero produtos; sem destino
 * válido para faixas em uso, não remove.
 */
export function removeDraftProduct(
  draft: LeadEconomicsDraft,
  productId: string,
  moveBandsTo: string | null,
): LeadEconomicsDraft {
  if (draft.products.length <= 1) return draft;
  const products = draft.products.filter((product) => product.id !== productId);
  if (products.length === draft.products.length) return draft;
  const inUse = bandsUsingProduct(draft, productId).length > 0;
  const target = moveBandsTo && products.some((product) => product.id === moveBandsTo) ? moveBandsTo : null;
  if (inUse && target === null) return draft;
  return {
    products,
    bands: draft.bands.map((band) => (band.product === productId && target ? { ...band, product: target } : band)),
  };
}

/**
 * Corte sugerido para a faixa nova: acima do último, no passo que a escala sugere
 * (o mesmo intervalo entre os dois últimos cortes; com um corte só, a casa decimal
 * dele: 70 → 80, 0,6 → 0,7, 600 → 700). Sem nenhum corte, o de MQL, se houver.
 */
export function suggestNextCut(draft: LeadEconomicsDraft, mqlLeadscoreMin: number | null): string {
  const cuts = draftBandMins(draft).filter((min): min is number => min !== null);
  if (cuts.length === 0) {
    return mqlLeadscoreMin !== null && Number.isFinite(mqlLeadscoreMin) ? formatScoreInput(mqlLeadscoreMin) : "";
  }
  const last = cuts[cuts.length - 1];
  const previous = cuts.length >= 2 ? cuts[cuts.length - 2] : null;
  let step = previous !== null && last > previous ? last - previous : 0;
  if (step <= 0) step = last > 0 ? 10 ** Math.floor(Math.log10(last)) : 1;
  return formatScoreInput(last + step);
}

/** Faixa nova no fim, com o corte sugerido e o produto da última faixa. */
export function addDraftBand(draft: LeadEconomicsDraft, mqlLeadscoreMin: number | null): LeadEconomicsDraft {
  const last = draft.bands[draft.bands.length - 1];
  const band: LeadEconomicsBandDraft = {
    key: newLeadEconomicsId(),
    // Com uma faixa só, a nova é a primeira com corte: começa no de MQL, se houver.
    min: suggestNextCut(draft, mqlLeadscoreMin),
    product: last?.product ?? draft.products[0]?.id ?? "",
    conversion: "",
  };
  return { ...draft, bands: [...draft.bands, band] };
}

export function updateDraftBand(
  draft: LeadEconomicsDraft,
  index: number,
  patch: Partial<Omit<LeadEconomicsBandDraft, "key">>,
): LeadEconomicsDraft {
  return { ...draft, bands: draft.bands.map((band, i) => (i === index ? { ...band, ...patch } : band)) };
}

/**
 * Remove a faixa. Nunca deixa zero faixas. Remover a primeira promove a segunda,
 * que perde o corte (a primeira faixa não tem piso): as notas da faixa removida
 * passam a cair nela.
 */
export function removeDraftBand(draft: LeadEconomicsDraft, index: number): LeadEconomicsDraft {
  if (draft.bands.length <= 1 || index < 0 || index >= draft.bands.length) return draft;
  const bands = draft.bands.filter((_, i) => i !== index);
  if (index === 0) bands[0] = { ...bands[0], min: "" };
  return { ...draft, bands };
}

// ── Estado da edição no diálogo (funções puras) ──────────────────────────────

/** O que o diálogo guarda da economia do lead entre abrir e salvar. */
export interface LeadEconomicsEditState {
  /** Rascunho na tela; `null` = nada sendo editado (não configurado, ou removido). */
  draft: LeadEconomicsDraft | null;
  /** Alguém digitou no rascunho desde que o diálogo abriu. */
  touched: boolean;
  /**
   * Como estava ANTES de "remover": o "Desfazer" devolve exatamente isto, inclusive
   * o que foi digitado e ainda não salvo (e o `touched`, senão o save nem mandaria a
   * edição). `null` = não removido.
   */
  removed: { draft: LeadEconomicsDraft | null; touched: boolean } | null;
}

/** Diálogo abrindo: o cadastro gravado (já normalizado) vira rascunho, intocado. */
export function openLeadEconomicsEdit(saved: LeadEconomics | null): LeadEconomicsEditState {
  return { draft: saved ? leadEconomicsToDraft(saved) : null, touched: false, removed: null };
}

/**
 * "Configurar economia do lead": rascunho novo. NÃO marca `touched` — ninguém
 * digitou nada, e um formulário só aberto não é alteração a salvar (regra 4 de
 * `decideLeadEconomicsPayload`) nem a proteger.
 */
export function startLeadEconomicsEdit(mqlLeadscoreMin: number | null): LeadEconomicsEditState {
  return { draft: createLeadEconomicsDraft(mqlLeadscoreMin), touched: false, removed: null };
}

export function editLeadEconomicsDraft(next: LeadEconomicsDraft): LeadEconomicsEditState {
  return { draft: next, touched: true, removed: null };
}

/**
 * "Remover": some da tela, mas o estado de antes fica guardado para o desfazer.
 *
 * Exceção: rascunho INTOCADO sem nada gravado (nem válido nem inválido) — o
 * "Configurar" seguido de "Remover" sem digitar nada. Aí não há o que apagar nem o
 * que perder: volta direto a "não configurado". Sem isto, virava um "removido" que
 * travava Esc/clique fora e dizia "O que foi preenchido aqui não será salvo." sobre
 * um formulário que ninguém preencheu.
 */
export function removeLeadEconomicsEdit(
  state: LeadEconomicsEditState,
  { rawSavedExists }: { rawSavedExists: boolean },
): LeadEconomicsEditState {
  if (state.removed) return state;
  if (!state.touched && !rawSavedExists) return openLeadEconomicsEdit(null);
  return { draft: null, touched: state.touched, removed: { draft: state.draft, touched: state.touched } };
}

export function undoRemoveLeadEconomicsEdit(state: LeadEconomicsEditState): LeadEconomicsEditState {
  if (!state.removed) return state;
  return { draft: state.removed.draft, touched: state.removed.touched, removed: null };
}

/**
 * O que a seção mostra: o editor (há rascunho), o "removida — Desfazer", o aviso de
 * cadastro gravado inválido (a coluna tem algo que a leitura recusa) ou o "não
 * configurada".
 *
 * É também o ALVO DO FOCO depois de trocar o conteúdo da seção: o diálogo pede foco
 * para o painel que o próximo estado vai mostrar, e cada painel tem um controle que
 * atende. O diálogo pedia "editor" fixo ao desfazer — quando o desfazer voltava ao
 * aviso de inválido, o editor não montava, o pedido ficava pendurado entre aberturas
 * e roubava o foco do próximo pack com economia.
 */
export type LeadEconomicsEditPanel = "editor" | "removed" | "invalid" | "empty";

export function leadEconomicsEditPanel(
  state: LeadEconomicsEditState,
  saved: { valid: boolean; rawExists: boolean },
): LeadEconomicsEditPanel {
  if (state.draft) return "editor";
  if (state.removed) return "removed";
  if (saved.rawExists && !saved.valid) return "invalid";
  return "empty";
}

/**
 * Há o que perder se o diálogo fechar agora: algo digitado, ou uma remoção (que só
 * se desfaz com o diálogo aberto). Formulário só aberto por "Configurar" não conta.
 */
export function isLeadEconomicsEditDirty(state: LeadEconomicsEditState): boolean {
  return state.touched || state.removed !== null;
}

// ── O que o save manda (D21) ─────────────────────────────────────────────────

export type LeadEconomicsPayloadDecision =
  /** Não mandar a chave `lead_economics`: o backend não mexe na coluna. */
  | { kind: "omit" }
  /** Mandar este valor (`null` apaga o cadastro gravado). */
  | { kind: "set"; value: LeadEconomics | null }
  /** Não salvar nada: o rascunho não passa no contrato. `errors` são as de `leadEconomicsDraftErrors`. */
  | { kind: "invalid"; errors: string[] };

/**
 * Decide se o save manda `lead_economics`, e com o quê. A chave só vai quando o
 * cadastro MUDOU (D21), por dois motivos: salvar o corte de MQL não pode depender da
 * coluna existir no banco (código publicado antes da migration 179 derrubaria o
 * save inteiro com 500), e o histórico do pack não pode ganhar "economia do lead
 * removida" a cada save de quem nunca a configurou.
 *
 * Regras, nesta ordem:
 * 1. removido → apaga (`null`) se havia cadastro gravado, válido ou não; senão, nada;
 * 2. sem rascunho → nada;
 * 3. rascunho intocado com cadastro válido gravado → nada: volta como estava, sem
 *    passar pela ida e volta do texto NEM pela escrita estrita. A leitura é tolerante
 *    (aceita, por exemplo, dois produtos com o mesmo nome) e a escrita não: sem esta
 *    regra, reabrir um cadastro desses e salvar só o corte de MQL travaria o save;
 * 4. rascunho intocado sem cadastro válido gravado → nada: é o que "Configurar" cria
 *    e ninguém mexeu, o mesmo que não configurar;
 * 5. tocado: inválido → não salva, mesmo sem nenhum número digitado (os erros
 *    aparecem nos campos; apagar é pelo botão de remover — antes, um rascunho "sem
 *    números" sumia calado com os nomes e cortes digitados, e o diálogo dizia
 *    "salva"); válido e igual ao gravado → nada; senão → manda.
 *
 * `saved` é o gravado já normalizado (`null` também quando é inválido);
 * `rawSavedExists` diz se a coluna tem QUALQUER coisa — é o que permite apagar um
 * cadastro gravado inválido, que a tela não consegue mostrar.
 */
export function decideLeadEconomicsPayload(params: {
  draft: LeadEconomicsDraft | null;
  saved: LeadEconomics | null;
  rawSavedExists: boolean;
  touched: boolean;
  removed: boolean;
}): LeadEconomicsPayloadDecision {
  const { draft, saved, rawSavedExists, touched, removed } = params;
  if (removed) return rawSavedExists || saved !== null ? { kind: "set", value: null } : { kind: "omit" };
  if (!draft) return { kind: "omit" };
  // Regras 3 e 4: intocado não vai, com ou sem cadastro válido gravado.
  if (!touched) return { kind: "omit" };

  const { value, errors } = validateLeadEconomicsDraft(draft);
  // O aviso do save mostra a primeira: corte "7O" dito como tal, não como "falta corte".
  if (!value) return { kind: "invalid", errors: phraseCutErrors(errors, draft, true) };
  // Os dois são canônicos (mesmo validador, mesma ordem de chaves): o JSON compara.
  if (saved && JSON.stringify(value) === JSON.stringify(saved)) return { kind: "omit" };
  return { kind: "set", value };
}

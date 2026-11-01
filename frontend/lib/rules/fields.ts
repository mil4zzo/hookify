/**
 * Vocabulário de regra — um só, para Manager, Boards e Critério de validação.
 *
 * POR QUE UM SÓ
 *   Até 2026-08 eram três: este (Boards), os shapes de `ColumnFilter` (Manager) e
 *   `lib/config/adMetricsFields` (Critério). Nasceram em três meses diferentes, um
 *   por tela nova, nenhum olhando para trás — e cada um errava num lugar: o Manager
 *   só combinava em E, o Critério oferecia 22 campos dos quais 11 rejeitavam todo
 *   anúncio, e havia QUATRO convenções de porcentagem para a mesma coluna. Era
 *   drift, não desenho. Ver documentation/plano-filtros-unificados.md.
 *
 * O QUE DIFERE ENTRE AS TELAS
 *   Só a DISPONIBILIDADE do campo, declarada aqui em `availableIn`/`availableTabs`.
 *   Operador, escala e semântica são os mesmos nos três lugares — é o que permite
 *   ao usuário aprender o filtro uma vez.
 *
 * MULTIPLICIDADE: por que id-em-array e não o nome do representante
 *   Uma linha agregada por criativo colapsa ~34 anúncios, que podem estar em várias
 *   campanhas, conjuntos, contas e packs. `campaign_name` na linha é o do
 *   REPRESENTANTE (o ad de maior impressões) — uma regra sobre ele acerta a maioria
 *   e mente no resto, em silêncio. Por isso a pergunta é sempre "ALGUM": os campos
 *   `*_ids` leem o array completo da linha, e os `*_name` resolvem esses ids pelo
 *   dicionário de nomes que vem na mesma resposta (`RuleEvaluationContext.names`).
 */

import { MANAGER_METRIC_KEYS, getManagerMetricLabel, type ManagerMetricKey } from "@/lib/metrics";
import { METRIC_DEFINITIONS } from "@/lib/metrics/definitions";
import { getActiveCustomRuleFields, resolveCustomRuleField } from "./customFields";
import { TAG_FILTER_OPERATORS } from "@/lib/tags/filter";
import type { LeadMarginStatus } from "@/lib/utils/leadEconomics";
import { translate } from "@/lib/i18n/translate";

/**
 * `count` é uma contagem que a LINHA carrega (quantos anúncios ativos o grupo tem),
 * não uma métrica do registry de métricas: não tem escala de porcentagem, não tem
 * divisor que possa ser zero, e o valor é lido direto da linha.
 */
export type RuleFieldKind = "metric" | "count" | "text" | "tags" | "status" | "date" | "multiselect";

export type RuleFieldGroup = "Tags" | "Criativo" | "Procedência" | "Métricas" | "Planilha";

/**
 * Onde o campo é oferecido no seletor.
 *
 * `manager-children` são as linhas-filhas (anúncios dentro de um criativo, dentro de
 * um conjunto): não carregam tags nem os arrays de procedência, então oferecê-los ali
 * produziria filtro que nunca casa.
 */
export type RuleContext = "manager" | "manager-children" | "boards" | "criteria";

export const ALL_RULE_CONTEXTS: RuleContext[] = ["manager", "manager-children", "boards", "criteria"];

/** Abas do Manager, na ordem em que aparecem. */
export type RuleManagerTab = "individual" | "por-anuncio" | "por-conjunto" | "por-campanha";

export interface RuleField {
  id: string;
  label: string;
  kind: RuleFieldKind;
  group: RuleFieldGroup;
  /** Métrica em escala 0-1 (ctr, hook, ...). O input do usuário é dividido por 100. */
  isRatioPercent?: boolean;
  /** Só aparece quando algum pack selecionado tem integração de planilha. */
  requiresSheetIntegration?: boolean;
  /** Só aparece quando algum pack selecionado tem a economia do lead cadastrada. */
  requiresLeadEconomics?: boolean;
  /** Depende do tipo de conversão escolhido no filtro global. */
  requiresActionType?: boolean;
  /** Telas que oferecem o campo. Ausente = todas. */
  availableIn?: RuleContext[];
  /** Abas do Manager que oferecem o campo. Ausente = todas. */
  availableTabs?: RuleManagerTab[];
  /**
   * Opções FIXAS do campo, quando o vocabulário não vem das linhas da tela. O status
   * é o caso: as quatro situações existem independentemente do que está carregado.
   * Um campo com `options` não precisa que o editor forneça `dimensionOptions`.
   */
  options?: { value: string; label: string }[];
  /**
   * Chave alternativa na linha, quando a mesma pergunta é respondida por um campo
   * de nome diferente. A linha AGREGADA traz `account_ids` (lista: o criativo roda
   * em várias contas); a linha-filha é UM anúncio e traz `account_id` (uma só, e
   * exata — não é representante de nada). A pergunta do usuário é a mesma.
   */
  rowKeyFallback?: string;
}

export interface RuleOperatorOption {
  value: string;
  label: string;
  /** Aceito pelo avaliador, mas fora do menu — só reaparece quando a regra salva já o usa. */
  hidden?: boolean;
}

/**
 * Rótulo lido na hora (getter): `RULE_OPERATORS` é constante de módulo e o idioma pode
 * mudar depois da carga.
 */
function op(value: string, name: string, extra?: { hidden?: boolean }): RuleOperatorOption {
  return {
    value,
    get label() {
      return translate(`rules.op.${name}`);
    },
    ...extra,
  };
}

const COMPARISON_OPERATORS = (): RuleOperatorOption[] => [
  op(">", "gt"),
  op("<", "lt"),
  op(">=", "gte"),
  op("<=", "lte"),
  op("=", "eq"),
  op("!=", "neq"),
];

export const RULE_OPERATORS: Record<RuleFieldKind, RuleOperatorOption[]> = {
  metric: [
    ...COMPARISON_OPERATORS(),
    // A forma INTENCIONAL de pedir as linhas em que a métrica não se aplica —
    // anúncio de imagem não tem hook, anúncio sem conversão não tem CPR. Sem estes,
    // o usuário só chegaria nelas por acidente, através de um `< x` que as incluía
    // por causa do zero fabricado.
    op("is_empty", "emptyNotApplicable"),
    op("is_not_empty", "hasValue"),
  ],
  text: [
    op("contains", "contains"),
    op("not_contains", "notContains"),
    op("starts_with", "startsWith"),
    op("ends_with", "endsWith"),
    op("equals", "equals"),
    op("not_equals", "notEquals"),
    op("matches_regex", "matchesRegex"),
    op("is_empty", "empty"),
    op("is_not_empty", "hasValue"),
  ],
  // Data compara POR DIA (evaluate.ts corta em 10 chars), então `>` e `>=` diferem em
  // exatamente um dia — e o rótulo não dizia de que lado o dia escolhido caía. Sobram só
  // os inclusivos. `>`/`<` continuam ACEITOS pelo avaliador e reaparecem no menu só
  // quando a regra salva já os usa — mesmo precedente de is_active/is_paused no status.
  date: [
    op(">=", "onOrAfter"),
    op("<=", "onOrBefore"),
    op("=", "exactlyOn"),
    op(">", "after", { hidden: true }),
    op("<", "before", { hidden: true }),
    op("is_empty", "empty"),
    op("is_not_empty", "hasValue"),
  ],
  tags: TAG_FILTER_OPERATORS.map((o) => ({
    value: o.value as string,
    get label() {
      return o.label;
    },
  })),
  // Caixas de marcar, como sempre foi: escolher mais de uma é "ou". Os operadores
  // `is_active`/`is_paused` da versão de agosto continuam sendo aceitos pelo
  // avaliador (regra salva não muda de significado), mas saíram do menu.
  status: [op("has_any", "isAnyOf"), op("has_none", "isNoneOf")],
  count: COMPARISON_OPERATORS(),
  multiselect: [op("has_any", "isAnyOf"), op("has_none", "isNoneOf")],
};

/** Operadores que são a pergunta inteira — não têm campo de valor. */
const VALUELESS_OPERATORS = new Set(["is_active", "is_paused", "is_empty", "is_not_empty"]);

export function ruleOperatorNeedsValue(operator: string): boolean {
  return !VALUELESS_OPERATORS.has(operator);
}

// ─────────────────────────────────────────────────────────────────────────────
// Presença: "Está vazio" + "Tem valor" viram UM operador na tela
// ─────────────────────────────────────────────────────────────────────────────
//
// A árvore continua gravando `is_empty` / `is_not_empty` — nada muda no banco nem no
// avaliador. O que muda é como se edita: o menu de operador mostra um único "Está", e
// a coluna de VALOR (que com esses dois operadores ficava morta, ocupada pela frase
// "A pergunta já está completa.") passa a escolher entre os dois. A leitura vira frase:
// "Hook · está · não se aplica". É tradução de tela, não migração.

/** Valor sintético que o Select de operador mostra no lugar de is_empty/is_not_empty. */
export const PRESENCE_UI_OPERATOR = "__presence__";

export function isPresenceOperator(operator: string): boolean {
  return operator === "is_empty" || operator === "is_not_empty";
}

/**
 * Opções da coluna de valor quando o operador é de presença. Em métrica, "vazio"
 * significa "não se aplica" (anúncio de imagem não tem hook) — a intenção que já
 * estava no rótulo antigo. Em texto e data, é vazio mesmo.
 */
export function getPresenceValueOptions(kind: RuleFieldKind): RuleOperatorOption[] {
  if (kind === "metric" || kind === "count") {
    return [op("is_empty", "notApplicable"), op("is_not_empty", "hasValue")];
  }
  return [op("is_empty", "blank"), op("is_not_empty", "filled")];
}

/**
 * O que o menu de operador OFERECE — derivado de `RULE_OPERATORS`, que continua sendo
 * o vocabulário completo do avaliador. Duas transformações:
 *   - is_empty/is_not_empty colapsam em PRESENCE_UI_OPERATOR ("Está");
 *   - operadores `hidden` saem, a menos que sejam o operador ATUAL da condição — uma
 *     regra salva com `>` cairia num Select sem a opção e mostraria o operador em branco.
 */
export function getRuleOperatorMenu(fieldId: string, currentOperator?: string): RuleOperatorOption[] {
  const all = getRuleOperators(fieldId);
  const menu: RuleOperatorOption[] = [];
  let presenceAdded = false;
  for (const option of all) {
    if (isPresenceOperator(option.value)) {
      if (!presenceAdded) {
        menu.push(op(PRESENCE_UI_OPERATOR, "presence"));
        presenceAdded = true;
      }
      continue;
    }
    if (option.hidden && option.value !== currentOperator) continue;
    menu.push(option);
  }
  return menu;
}

const DIMENSION_FIELDS: RuleField[] = [
  // Linhas-filhas não carregam tags (a RPC não as devolve nesse nível).
    // As tags são do CRIATIVO. A RPC só as devolve nos agrupamentos por criativo e
  // por anúncio; nas abas de Conjunto e Campanha vem sempre lista vazia (a tag do
  // representante descreveria o grupo errado). Oferecer o campo lá seria uma opção
  // de menu que devolve tabela vazia SEMPRE — parece bug do filtro, não do dado.
  {
    id: "tags",
    get label() {
      return translate("rules.fields.tags");
    },
    kind: "tags",
    group: "Tags",
    availableIn: ["manager", "boards", "criteria"],
    availableTabs: ["individual", "por-anuncio"],
  },
  { id: "ad_name", get label() {
      return translate("rules.fields.adName");
    }, kind: "text", group: "Criativo" },
  {
    id: "status",
    get label() {
      return translate("rules.fields.status");
    },
    kind: "status",
    group: "Criativo",
    // Os rótulos do Meta, que são os que o usuário lê no Gerenciador. "Pausado
    // (Conjunto)" e "(Campanha)" respondem a pergunta que o status sozinho não
    // responde: está parado porque EU parei, ou porque o pai está parado?
    options: [
      { value: "ACTIVE", get label() { return translate("rules.status.ACTIVE"); } },
      { value: "PAUSED", get label() { return translate("rules.status.PAUSED"); } },
      { value: "ADSET_PAUSED", get label() { return translate("rules.status.ADSET_PAUSED"); } },
      { value: "CAMPAIGN_PAUSED", get label() { return translate("rules.status.CAMPAIGN_PAUSED"); } },
    ],
  },
  // Contagem de anúncios ativos do grupo. Só onde a linha agrega anúncios E a RPC
  // manda o número: na aba de Anúncios ele é 0 ou 1 (inútil) e na de Campanhas a
  // RPC não o devolve. `is_active` responde "≥ 1"; este campo responde "quantos".
  {
    id: "active_count",
    get label() {
      return translate("rules.fields.activeCount");
    },
    kind: "count",
    group: "Criativo",
    availableIn: ["manager"],
    availableTabs: ["por-anuncio", "por-conjunto"],
  },
  // meta_created_time é ATRIBUTO do criativo ("quando estreou"), não o recorte da
  // tela — por isso é regra, enquanto o período continua vindo do seletor global.
  { id: "meta_created_time", get label() {
      return translate("rules.fields.createdAt");
    }, kind: "date", group: "Criativo" },
  // Identidade do anúncio: só faz sentido onde a linha É um anúncio.
  {
    id: "ad_id",
    get label() {
      return translate("rules.fields.adId");
    },
    kind: "text",
    group: "Criativo",
    availableIn: ["manager", "manager-children", "criteria"],
    availableTabs: ["individual"],
  },
  {
    id: "pack_ids",
    get label() {
      return translate("rules.fields.pack");
    },
    kind: "multiselect",
    group: "Procedência",
    // A filha passou a receber `pack_ids` na migration 134. Rende quando há dois ou
    // mais packs selecionados: com um só, toda linha mostra o mesmo pack.
    availableIn: ["manager", "manager-children", "boards", "criteria"],
  },
  {
    id: "account_ids",
    get label() {
      return translate("rules.fields.account");
    },
    kind: "multiselect",
    group: "Procedência",
    availableIn: ["manager", "manager-children", "criteria", "boards"],
    rowKeyFallback: "account_id",
  },
  // Campanha e conjunto por ID (migration 136/137). A linha AGREGADA traz os arrays
  // completos; escolher da lista é "é alguma de".
  //
  // ONDE NÃO APARECE, E POR QUÊ
  //   Uma lista para escolher só existe dentro de um RECORTE — as opções saem das
  //   linhas na tela. Dois contextos não têm recorte nenhum:
  //   • `manager-children`: a filha é UM anúncio e a RPC de detalhe devolve o NOME
  //     dele, não o id.
  //   • `criteria`: o construtor vive nas Configurações, onde não há período nem pack
  //     selecionado. O seletor abriria vazio ("nada disponível no recorte atual") e o
  //     campo seria inutilizável — a mesma opção-de-menu-que-não-funciona que a fase 4
  //     acabou de apagar do Critério.
  //   Nos dois casos a pergunta continua possível por "Nome da campanha", que é texto
  //   e não precisa de lista.
  {
    id: "campaign_ids",
    get label() {
      return translate("rules.fields.campaign");
    },
    kind: "multiselect",
    group: "Procedência",
    availableIn: ["manager", "boards"],
  },
  {
    id: "adset_ids",
    get label() {
      return translate("rules.fields.adset");
    },
    kind: "multiselect",
    group: "Procedência",
    availableIn: ["manager", "boards"],
  },
  // Texto sobre os MESMOS pais: na linha agregada a pergunta é "algum nome do grupo
  // casa?" (resolvido pelo dicionário); na filha, o nome da própria linha.
  {
    id: "campaign_name",
    get label() {
      return translate("rules.fields.campaignName");
    },
    kind: "text",
    group: "Procedência",
  },
  {
    id: "adset_name",
    get label() {
      return translate("rules.fields.adsetName");
    },
    kind: "text",
    group: "Procedência",
  },
];

function buildMetricField(key: ManagerMetricKey): RuleField {
  const definition = METRIC_DEFINITIONS[key];
  return {
    id: key,
    label: getManagerMetricLabel(key),
    kind: "metric",
    group: "Métricas",
    isRatioPercent: definition?.formatKind === "ratioPercent",
    requiresSheetIntegration: definition?.requiresSheetIntegration,
    requiresActionType: definition?.requiresActionType,
    // CPL Max e Margem: a conta precisa da economia de cada pack da linha, que só o
    // Manager passa ao avaliador. Oferecidas no Boards, no Critério ou no /insights,
    // seriam campo que não responde — toda condição sobre elas zeraria a tela sem erro.
    ...(definition?.requiresLeadEconomics
      ? { requiresLeadEconomics: true, availableIn: ["manager", "manager-children"] as RuleContext[] }
      : {}),
  };
}

/**
 * "Margem vs meta": a situação da Margem de cada linha diante da meta DELA
 * (`getRowLeadMarginStatus`). Não é "Margem < X%": a meta é a margem desejada do
 * produto de cada faixa, e muda de pack para pack. É o filtro que o "N de M abaixo
 * da meta de margem" liga no clique. O id é imutável: regras salvas o citam.
 *
 * Mesmas restrições do Teto e da Margem (`buildMetricField`): só o Manager passa a
 * economia de cada pack ao avaliador.
 */
export const LEAD_MARGIN_STATUS_FIELD_ID = "lead_margin_status";

const LEAD_MARGIN_STATUS_FIELD: RuleField = {
  id: LEAD_MARGIN_STATUS_FIELD_ID,
  get label() {
      return translate("rules.fields.marginVsTarget");
    },
  kind: "multiselect",
  group: "Métricas",
  requiresSheetIntegration: true,
  requiresLeadEconomics: true,
  availableIn: ["manager", "manager-children"],
  options: [
    { value: "on_target", get label() { return translate("rules.marginStatus.on_target"); } },
    { value: "below_target", get label() { return translate("rules.marginStatus.below_target"); } },
    { value: "loss", get label() { return translate("rules.marginStatus.loss"); } },
  ] satisfies { value: LeadMarginStatus; label: string }[],
};

export const RULE_FIELDS: RuleField[] = [...DIMENSION_FIELDS, ...MANAGER_METRIC_KEYS.map(buildMetricField), LEAD_MARGIN_STATUS_FIELD];

const RULE_FIELDS_BY_ID = new Map(RULE_FIELDS.map((field) => [field.id, field]));

export function getRuleField(fieldId: string): RuleField | undefined {
  // 140: colunas vinculadas da planilha (`custom:<id>:<faceta>`) vêm do registro
  // ativo, ou viram "Coluna excluída" quando a regra cita um vínculo que já não existe.
  return RULE_FIELDS_BY_ID.get(fieldId) ?? resolveCustomRuleField(fieldId);
}

/** Campos que resolvem ids pelo dicionário de nomes do contexto. */
export const NAME_LOOKUP_FIELDS: Record<string, { idsField: string; dictionary: "campaigns" | "adsets" }> = {
  campaign_name: { idsField: "campaign_ids", dictionary: "campaigns" },
  adset_name: { idsField: "adset_ids", dictionary: "adsets" },
};

export interface RuleFieldAvailability {
  hasSheetIntegration?: boolean;
  /** Algum pack selecionado tem a economia do lead cadastrada. */
  hasLeadEconomics?: boolean;
  /** Tela que está pedindo. Ausente = não filtra por contexto. */
  context?: RuleContext;
  /** Aba do Manager. Ausente = não filtra por aba. */
  tab?: RuleManagerTab;
}

/**
 * Campos oferecidos no seletor. Métricas de MQL só aparecem com planilha ligada —
 * sem ela vêm sempre zeradas, e uma regra sobre zero é um grupo vazio que parece
 * bug. Um campo já salvo continua sendo avaliado mesmo se sair desta lista: a
 * regra não deve mudar de significado porque a planilha caiu, nem porque o usuário
 * trocou de aba.
 */
export function getAvailableRuleFields({
  hasSheetIntegration = false,
  hasLeadEconomics = false,
  context,
  tab,
}: RuleFieldAvailability = {}): RuleField[] {
  // 140: as colunas vinculadas dos packs selecionados entram no vocabulário. Só
  // existem no registro quando algum pack tem vínculo, então nunca são "campo
  // oferecido que não responde".
  return [...RULE_FIELDS, ...getActiveCustomRuleFields()].filter((field) => {
    if (field.requiresSheetIntegration && !hasSheetIntegration) return false;
    if (field.requiresLeadEconomics && !hasLeadEconomics) return false;
    if (context && field.availableIn && !field.availableIn.includes(context)) return false;
    if (tab && field.availableTabs && !field.availableTabs.includes(tab)) return false;
    return true;
  });
}

export function getRuleOperators(fieldId: string): RuleOperatorOption[] {
  const field = getRuleField(fieldId);
  return field ? RULE_OPERATORS[field.kind] : RULE_OPERATORS.metric;
}

export function getDefaultRuleOperator(fieldId: string): string {
  return getRuleOperators(fieldId)[0]?.value ?? ">";
}

/** Valor inicial coerente com o tipo — evita condição nasce quebrada. */
export function getDefaultRuleValue(fieldId: string): import("./types").RuleConditionValue {
  const field = getRuleField(fieldId);
  if (!field) return null;
  if (field.kind === "tags" || field.kind === "multiselect" || field.kind === "status") return [];
  return "";
}

/** Métricas oferecidas para ordenar dentro do grupo. */
export function getRuleSortMetrics({ hasSheetIntegration = false }: RuleFieldAvailability = {}): { value: string; label: string }[] {
  // Só o Boards ordena por aqui, e o Boards não tem a economia do lead por linha.
  const base = MANAGER_METRIC_KEYS.filter((key) => !METRIC_DEFINITIONS[key]?.requiresLeadEconomics)
    .filter((key) => !METRIC_DEFINITIONS[key]?.requiresSheetIntegration || hasSheetIntegration)
    .map((key) => ({
    value: key,
    label: getManagerMetricLabel(key),
  }));
  // 140: facetas numéricas das colunas vinculadas (categoria não ordena).
  const custom = getActiveCustomRuleFields()
    .filter((field) => field.kind === "metric")
    .map((field) => ({ value: field.id, label: field.label }));
  return [...base, ...custom];
}

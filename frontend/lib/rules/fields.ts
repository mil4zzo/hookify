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

export const RULE_OPERATORS: Record<RuleFieldKind, { value: string; label: string }[]> = {
  metric: [
    { value: ">", label: "Maior que" },
    { value: "<", label: "Menor que" },
    { value: ">=", label: "Maior ou igual" },
    { value: "<=", label: "Menor ou igual" },
    { value: "=", label: "Igual a" },
    { value: "!=", label: "Diferente de" },
    // A forma INTENCIONAL de pedir as linhas em que a métrica não se aplica —
    // anúncio de imagem não tem hook, anúncio sem conversão não tem CPR. Sem estes,
    // o usuário só chegaria nelas por acidente, através de um `< x` que as incluía
    // por causa do zero fabricado.
    { value: "is_empty", label: "Está vazio (não se aplica)" },
    { value: "is_not_empty", label: "Tem valor" },
  ],
  text: [
    { value: "contains", label: "Contém" },
    { value: "not_contains", label: "Não contém" },
    { value: "starts_with", label: "Começa com" },
    { value: "ends_with", label: "Termina com" },
    { value: "equals", label: "É igual a" },
    { value: "not_equals", label: "É diferente de" },
    { value: "matches_regex", label: "Casa com a expressão" },
    { value: "is_empty", label: "Está vazio" },
    { value: "is_not_empty", label: "Tem valor" },
  ],
  date: [
    { value: ">=", label: "A partir de" },
    { value: "<=", label: "Até" },
    { value: ">", label: "Depois de" },
    { value: "<", label: "Antes de" },
    { value: "=", label: "Exatamente em" },
    { value: "is_empty", label: "Está vazio" },
    { value: "is_not_empty", label: "Tem valor" },
  ],
  tags: TAG_FILTER_OPERATORS.map((op) => ({ value: op.value as string, label: op.label })),
  // Caixas de marcar, como sempre foi: escolher mais de uma é "ou". Os operadores
  // `is_active`/`is_paused` da versão de agosto continuam sendo aceitos pelo
  // avaliador (regra salva não muda de significado), mas saíram do menu.
  status: [
    { value: "has_any", label: "É algum de" },
    { value: "has_none", label: "Não é nenhum de" },
  ],
  count: [
    { value: ">", label: "Maior que" },
    { value: "<", label: "Menor que" },
    { value: ">=", label: "Maior ou igual" },
    { value: "<=", label: "Menor ou igual" },
    { value: "=", label: "Igual a" },
    { value: "!=", label: "Diferente de" },
  ],
  multiselect: [
    { value: "has_any", label: "É algum de" },
    { value: "has_none", label: "Não é nenhum de" },
  ],
};

/** Operadores que são a pergunta inteira — não têm campo de valor. */
const VALUELESS_OPERATORS = new Set(["is_active", "is_paused", "is_empty", "is_not_empty"]);

export function ruleOperatorNeedsValue(operator: string): boolean {
  return !VALUELESS_OPERATORS.has(operator);
}

const DIMENSION_FIELDS: RuleField[] = [
  // Linhas-filhas não carregam tags (a RPC não as devolve nesse nível).
    // As tags são do CRIATIVO. A RPC só as devolve nos agrupamentos por criativo e
  // por anúncio; nas abas de Conjunto e Campanha vem sempre lista vazia (a tag do
  // representante descreveria o grupo errado). Oferecer o campo lá seria uma opção
  // de menu que devolve tabela vazia SEMPRE — parece bug do filtro, não do dado.
  {
    id: "tags",
    label: "Tags",
    kind: "tags",
    group: "Tags",
    availableIn: ["manager", "boards", "criteria"],
    availableTabs: ["individual", "por-anuncio"],
  },
  { id: "ad_name", label: "Nome do criativo", kind: "text", group: "Criativo" },
  {
    id: "status",
    label: "Status",
    kind: "status",
    group: "Criativo",
    // Os rótulos do Meta, que são os que o usuário lê no Gerenciador. "Pausado
    // (Conjunto)" e "(Campanha)" respondem a pergunta que o status sozinho não
    // responde: está parado porque EU parei, ou porque o pai está parado?
    options: [
      { value: "ACTIVE", label: "Ativo" },
      { value: "PAUSED", label: "Pausado" },
      { value: "ADSET_PAUSED", label: "Pausado (Conjunto)" },
      { value: "CAMPAIGN_PAUSED", label: "Pausado (Campanha)" },
    ],
  },
  // Contagem de anúncios ativos do grupo. Só onde a linha agrega anúncios E a RPC
  // manda o número: na aba de Anúncios ele é 0 ou 1 (inútil) e na de Campanhas a
  // RPC não o devolve. `is_active` responde "≥ 1"; este campo responde "quantos".
  {
    id: "active_count",
    label: "Anúncios ativos",
    kind: "count",
    group: "Criativo",
    availableIn: ["manager"],
    availableTabs: ["por-anuncio", "por-conjunto"],
  },
  // meta_created_time é ATRIBUTO do criativo ("quando estreou"), não o recorte da
  // tela — por isso é regra, enquanto o período continua vindo do seletor global.
  { id: "meta_created_time", label: "Criado em", kind: "date", group: "Criativo" },
  // Identidade do anúncio: só faz sentido onde a linha É um anúncio.
  {
    id: "ad_id",
    label: "ID do anúncio",
    kind: "text",
    group: "Criativo",
    availableIn: ["manager", "manager-children", "criteria"],
    availableTabs: ["individual"],
  },
  {
    id: "pack_ids",
    label: "Pack",
    kind: "multiselect",
    group: "Procedência",
    // A filha passou a receber `pack_ids` na migration 134. Rende quando há dois ou
    // mais packs selecionados: com um só, toda linha mostra o mesmo pack.
    availableIn: ["manager", "manager-children", "boards", "criteria"],
  },
  {
    id: "account_ids",
    label: "Conta",
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
    label: "Campanha",
    kind: "multiselect",
    group: "Procedência",
    availableIn: ["manager", "boards"],
  },
  {
    id: "adset_ids",
    label: "Conjunto",
    kind: "multiselect",
    group: "Procedência",
    availableIn: ["manager", "boards"],
  },
  // Texto sobre os MESMOS pais: na linha agregada a pergunta é "algum nome do grupo
  // casa?" (resolvido pelo dicionário); na filha, o nome da própria linha.
  {
    id: "campaign_name",
    label: "Nome da campanha",
    kind: "text",
    group: "Procedência",
  },
  {
    id: "adset_name",
    label: "Nome do conjunto",
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
  };
}

export const RULE_FIELDS: RuleField[] = [...DIMENSION_FIELDS, ...MANAGER_METRIC_KEYS.map(buildMetricField)];

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
  context,
  tab,
}: RuleFieldAvailability = {}): RuleField[] {
  // 140: as colunas vinculadas dos packs selecionados entram no vocabulário. Só
  // existem no registro quando algum pack tem vínculo, então nunca são "campo
  // oferecido que não responde".
  return [...RULE_FIELDS, ...getActiveCustomRuleFields()].filter((field) => {
    if (field.requiresSheetIntegration && !hasSheetIntegration) return false;
    if (context && field.availableIn && !field.availableIn.includes(context)) return false;
    if (tab && field.availableTabs && !field.availableTabs.includes(tab)) return false;
    return true;
  });
}

export function getRuleOperators(fieldId: string): { value: string; label: string }[] {
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
  const base = MANAGER_METRIC_KEYS.filter((key) => !METRIC_DEFINITIONS[key]?.requiresSheetIntegration || hasSheetIntegration).map((key) => ({
    value: key,
    label: getManagerMetricLabel(key),
  }));
  // 140: facetas numéricas das colunas vinculadas (categoria não ordena).
  const custom = getActiveCustomRuleFields()
    .filter((field) => field.kind === "metric")
    .map((field) => ({ value: field.id, label: field.label }));
  return [...base, ...custom];
}

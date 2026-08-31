/**
 * Avaliador de regra — o único, para Manager, Boards e Critério de validação.
 *
 * Roda 100% no cliente, sobre as MESMAS linhas que a tela já buscou — nenhuma
 * regra custa uma query. É por isso que grupos de Board podem se sobrepor à
 * vontade: o custo de N grupos é N passadas num array que já está na memória.
 *
 * CONVENÇÃO DE PORCENTAGEM
 *   O valor da condição é gravado na ESCALA QUE O USUÁRIO DIGITOU: `2` é 2%,
 *   `0,5` é 0,5%. A divisão por 100 acontece aqui, para as métricas `ratioPercent`
 *   (que vivem em 0-1), e é INCONDICIONAL — a escala de gravação é conhecida.
 *
 *   Havia quatro convenções antes disto: o Manager convertia na entrada, as
 *   linhas-filhas adivinhavam com `valor > 1` (que erra em `hook > 0,5%`), o
 *   Board dividia sempre e o Critério nunca dividia. Uma consequência a registrar:
 *   o `formatKind` de uma métrica passa a ser IMUTÁVEL depois de publicado —
 *   trocá-lo reinterpreta em silêncio toda regra já gravada.
 *
 * TRÊS ESTADOS, NÃO DOIS
 *   Uma métrica que é DIVISÃO fica "sem dado" quando o divisor é zero: hook sem
 *   plays, CPR sem resultados, CTR sem impressões. A RPC fabrica `0` nesses casos
 *   (`case when plays > 0 then ... else 0 end`), e o zero fabricado é
 *   indistinguível do zero real — era por isso que "hook < 5%" trazia todo anúncio
 *   de imagem e "CPR mais barato" começava por quem não converteu.
 *
 *   Aqui, "sem dado" NÃO casa com a condição NEM com a contrária: `hook < 5%` e
 *   `hook >= 5%` os dois deixam o anúncio de imagem de fora. Quem quer essas
 *   linhas pede `is_empty`. Quem transforma o zero em `null` é
 *   `getMetricNumericValueOrNull` — esta é a única porta de leitura de métrica.
 *
 * O QUE É "IGNORAR" E O QUE É "NÃO CASAR"
 *   Condição MALFORMADA (campo fora do registry, valor em branco, regex inválida)
 *   é ignorada, como filtro vazio — não derruba o resto da regra. Dado NÃO
 *   APLICÁVEL à linha não casa. São coisas diferentes e cada uma tem seu caminho.
 */

import { getMetricNumericValueOrNull } from "@/lib/metrics";
import { rowMatchesTagFilter, type TagFilterOperator } from "@/lib/tags/filter";
import { getRuleField, NAME_LOOKUP_FIELDS } from "./fields";
import { isEmptyRuleTree, type RuleConditionLeaf, type RuleConditionValue, type RuleNode, type RuleTree } from "./types";

/** Dicionário `id → nome` que vem na raiz da resposta da RPC (fase 5 do plano). */
export interface RuleNameDictionary {
  campaigns?: Record<string, string>;
  adsets?: Record<string, string>;
}

export interface RuleEvaluationContext {
  actionType?: string;
  mqlLeadscoreMin?: number | null;
  /**
   * Nomes de campanha/conjunto. Sem ele, uma regra sobre `campaign_name` não tem
   * como saber os nomes das campanhas do criativo — e é IGNORADA (condição sem
   * como ser respondida), em vez de responder errado com o nome do representante.
   */
  names?: RuleNameDictionary;
}

/** Linha do Manager agrupada por criativo, mais o que a regra precisa ler. */
export type RuleRow = Record<string, any>;

function compareNumeric(rowValue: number, target: number, operator: string): boolean {
  switch (operator) {
    case ">":
      return rowValue > target;
    case "<":
      return rowValue < target;
    case ">=":
      return rowValue >= target;
    case "<=":
      return rowValue <= target;
    // Mesma tolerância do Manager: comparar float por igualdade exata nunca casa.
    case "=":
      return Math.abs(rowValue - target) < 0.0001;
    case "!=":
      return Math.abs(rowValue - target) >= 0.0001;
    default:
      return true;
  }
}

/**
 * Exportado porque a busca por NOME da barra do Manager é o mesmo "contém" da
 * regra — duas implementações dariam duas noções de igualdade na mesma tela
 * (acento, caixa, espaço). Um comparador só.
 */
export function compareText(rawValue: string, target: string, operator: string): boolean {
  const value = rawValue.toLowerCase();
  const needle = target.toLowerCase();
  switch (operator) {
    case "contains":
      return value.includes(needle);
    case "not_contains":
      return !value.includes(needle);
    case "starts_with":
      return value.startsWith(needle);
    case "ends_with":
      return value.endsWith(needle);
    case "equals":
      return value === needle;
    case "not_equals":
      return value !== needle;
    default:
      return true;
  }
}

/** YYYY-MM-DD comparado como string: a ordem lexicográfica desse formato é a cronológica. */
function compareDate(rowDate: string, target: string, operator: string): boolean {
  switch (operator) {
    case ">":
      return rowDate > target;
    case "<":
      return rowDate < target;
    case ">=":
      return rowDate >= target;
    case "<=":
      return rowDate <= target;
    case "=":
      return rowDate === target;
    default:
      return true;
  }
}

function toStringList(value: RuleConditionValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry)).filter(Boolean);
}

/**
 * Semântica "ALGUM", sempre. Um criativo roda em ~34 anúncios e pode espalhar-se
 * por várias contas/packs; "está na conta X" quase sempre quer dizer "tem alguma
 * veiculação na conta X". A alternativa ("só existe em X") esvaziaria grupos sem
 * o usuário entender por quê.
 */
function matchesMultiSelect(rowValues: unknown, value: RuleConditionValue, operator: string): boolean {
  const wanted = toStringList(value);
  if (wanted.length === 0) return true;

  // A linha pode trazer a lista (linha agregada: `account_ids`) ou um valor único
  // (linha-filha: `account_id`, porque a filha é UM anúncio e pertence a uma conta
  // só). Um valor único é uma lista de um — a pergunta "está em alguma destas?"
  // continua sendo a mesma.
  const asList = Array.isArray(rowValues) ? rowValues : rowValues == null || rowValues === "" ? [] : [rowValues];
  const present = new Set(asList.map((entry) => String(entry)));
  const intersects = wanted.some((entry) => present.has(entry));
  return operator === "has_none" ? !intersects : intersects;
}

/**
 * Ativo = tem ao menos UMA veiculação ativa. `active_count` é o número de ads
 * ativos do grupo; quando a RPC não o devolve (abas que não agregam), cai para o
 * status do representante.
 */
function matchesStatus(row: RuleRow, operator: string): boolean {
  // `Number(null)` e 0, nao NaN — checar ausencia ANTES de converter. Sem isso,
  // linha sem contagem seria lida como "zero ativos" e todo criativo cairia em
  // "totalmente pausado".
  const raw = row.active_count;
  const activeCount = raw == null ? null : Number(raw);
  const hasActive =
    activeCount != null && Number.isFinite(activeCount)
      ? activeCount > 0
      : String(row.effective_status || "").toUpperCase() === "ACTIVE";
  return operator === "is_paused" ? !hasActive : hasActive;
}

/**
 * Regex do usuário: compilada a cada avaliação porque a regra muda enquanto se
 * digita. Inválida ou longa demais = condição IGNORADA (não restringe), nunca uma
 * exceção que derruba a tela — o usuário passa por "(" antes de chegar em "(BF|CT)".
 *
 * O teto de 200 caracteres é anti-acidente, não segurança: não há guarda contra
 * backtracking catastrófico. O app é de uso interno; se abrir para terceiros, isto
 * vira um problema real.
 */
const MAX_REGEX_LENGTH = 200;

function matchesRegex(rawValue: string, pattern: string): boolean | null {
  if (pattern.length > MAX_REGEX_LENGTH) return null;
  try {
    return new RegExp(pattern, "i").test(rawValue);
  } catch {
    return null;
  }
}

/**
 * Texto de um campo `*_name`: TODOS os nomes que a linha representa.
 *
 * DUAS LINHAS, DUAS FONTES
 *   A linha AGREGADA colapsa dezenas de anúncios e traz `campaign_ids` (migration
 *   136): a resposta é o conjunto de nomes resolvidos pelo dicionário. A
 *   linha-FILHA é UM anúncio e traz `campaign_name` direto — exato, não
 *   representante de nada. `Array.isArray(ids)` separa os dois casos.
 *
 * QUANDO DEVOLVE `null`
 *   Linha agregada com os ids mas sem dicionário (resposta antiga em cache, ou a
 *   migration ainda não aplicada): a condição é IGNORADA. Responder com o nome do
 *   representante seria exatamente a mentira que a v136 veio corrigir — acertar a
 *   maioria e esconder o resto sem avisar.
 */
function resolveNamesForField(fieldId: string, row: RuleRow, context: RuleEvaluationContext): string[] | null {
  const lookup = NAME_LOOKUP_FIELDS[fieldId];
  if (!lookup) return null;
  const ids = row[lookup.idsField];
  // Sem o array: a linha é uma filha, e o nome dela é o dela mesma. Ausente conta
  // como vazio — a pergunta É respondível ("esta filha não tem campanha"), ao
  // contrário do caso abaixo, em que a linha tem pais mas falta como traduzi-los.
  if (!Array.isArray(ids)) {
    const own = row[fieldId];
    return [typeof own === "string" ? own : ""];
  }
  const dictionary = context.names?.[lookup.dictionary];
  if (!dictionary) return null;
  return ids.map((id) => dictionary[String(id)]).filter((name): name is string => typeof name === "string");
}

/**
 * "Vazio" de um campo de texto/data: string ausente ou só espaço. Para os campos
 * multivalorados (`*_name`), vazio = o grupo não tem nenhum nome resolvido.
 */
function isBlankText(values: string[]): boolean {
  return values.every((value) => value.trim() === "");
}

function evaluateLeaf(condition: RuleConditionLeaf, row: RuleRow, context: RuleEvaluationContext): boolean {
  const field = getRuleField(condition.field);
  // Campo que saiu do registry (renomeado, removido) não pode derrubar o grupo
  // inteiro em silêncio — a condição é ignorada, como um filtro em branco.
  if (!field) return true;

  const { operator, value } = condition;

  if (field.kind === "tags") {
    return rowMatchesTagFilter(row.tags, { operator: operator as TagFilterOperator, tagIds: toStringList(value) });
  }

  if (field.kind === "status") {
    return matchesStatus(row, operator);
  }

  if (field.kind === "multiselect") {
    const raw = row[field.id] ?? (field.rowKeyFallback ? row[field.rowKeyFallback] : undefined);
    return matchesMultiSelect(raw, value, operator);
  }

  if (field.kind === "date") {
    const raw = row[field.id];
    const rowDate = raw ? String(raw).slice(0, 10) : "";
    // Linha sem data (ad não ressincronizado desde a migration 115) é "sem dado":
    // is_empty a encontra, e nenhum recorte temporal a inclui.
    if (operator === "is_empty") return rowDate === "";
    if (operator === "is_not_empty") return rowDate !== "";

    const target = String(value ?? "").slice(0, 10);
    if (!target) return true; // condição incompleta não restringe, igual ao Manager
    if (!rowDate) return false;
    return compareDate(rowDate, target, operator);
  }

  if (field.kind === "text") {
    // `campaign_name`/`adset_name` são MULTIVALORADOS na linha agregada: a pergunta
    // é "ALGUM nome do grupo casa?". `resolved === null` = dicionário não veio.
    const resolved = resolveNamesForField(field.id, row, context);
    if (field.id in NAME_LOOKUP_FIELDS && resolved === null) return true;
    const values = resolved ?? [String(row[field.id] ?? "")];

    if (operator === "is_empty") return isBlankText(values);
    if (operator === "is_not_empty") return !isBlankText(values);

    const target = String(value ?? "");
    if (!target) return true;

    if (operator === "matches_regex") {
      const results = values.map((entry) => matchesRegex(entry, target));
      // Regex inválida: condição ignorada, não linha rejeitada.
      if (results.some((result) => result === null)) return true;
      return results.some(Boolean);
    }

    // Negativos ("não contém", "é diferente de") pedem TODOS, não ALGUM: "nenhuma
    // campanha do criativo contém BF" só é verdade se nenhuma contiver.
    const isNegative = operator === "not_contains" || operator === "not_equals";
    return isNegative
      ? values.every((entry) => compareText(entry, target, operator))
      : values.some((entry) => compareText(entry, target, operator));
  }

  const rowValue = getMetricNumericValueOrNull(row, field.id, {
    actionType: context.actionType,
    mqlLeadscoreMin: context.mqlLeadscoreMin ?? null,
  });
  const hasValue = rowValue != null && Number.isFinite(rowValue);

  // A forma intencional de perguntar por "não se aplica" — ver o cabeçalho.
  if (operator === "is_empty") return !hasValue;
  if (operator === "is_not_empty") return hasValue;

  const target = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(target)) return true;

  // Sem dado não casa com a condição NEM com a contrária: o grupo afirma um
  // número, e a linha não tem número nenhum para afirmar ou negar.
  if (!hasValue) return false;

  return compareNumeric(rowValue as number, field.isRatioPercent ? target / 100 : target, operator);
}

function evaluateNode(node: RuleNode, row: RuleRow, context: RuleEvaluationContext): boolean {
  if (node.type === "group") {
    const children = node.conditions ?? [];
    // Subgrupo vazio é pergunta em branco: não restringe, nem em AND nem em OR.
    if (children.length === 0) return true;
    const results = children.map((child) => evaluateNode(child, row, context));
    return node.logic === "OR" ? results.some(Boolean) : results.every(Boolean);
  }
  return evaluateLeaf(node, row, context);
}

/** True se a linha pertence ao grupo. Regra vazia = grupo mostra o recorte inteiro. */
export function rowMatchesRules(row: RuleRow, rules: RuleTree, context: RuleEvaluationContext = {}): boolean {
  if (isEmptyRuleTree(rules)) return true;
  const results = rules.conditions.map((node) => evaluateNode(node, row, context));
  return rules.logic === "OR" ? results.some(Boolean) : results.every(Boolean);
}

export function filterRowsByRules<T extends RuleRow>(rows: readonly T[], rules: RuleTree, context: RuleEvaluationContext = {}): T[] {
  if (isEmptyRuleTree(rules)) return [...rows];
  return rows.filter((row) => rowMatchesRules(row, rules, context));
}

/** Quantas condições-folha a regra tem — alimenta o resumo "3 condições" no header. */
export function countRuleConditions(rules: RuleTree | undefined | null): number {
  if (!rules) return 0;
  const walk = (nodes: RuleNode[]): number =>
    nodes.reduce((total, node) => total + (node.type === "group" ? walk(node.conditions ?? []) : 1), 0);
  return walk(rules.conditions ?? []);
}

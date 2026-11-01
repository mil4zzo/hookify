import { translate } from "@/lib/i18n/translate"
import type { RankingsRowTag } from "@/lib/api/schemas"

/**
 * Operadores do filtro de tags.
 *
 * `is_empty`/`is_not_empty` são perguntas completas em si — não recebem valor, e
 * por isso substituíram a antiga opção-sentinela "Sem tag" que vivia dentro da
 * lista de tags (ver LEGACY_NO_TAG_VALUE).
 */
export type TagFilterOperator = "has_any" | "has_all" | "has_none" | "has_exact" | "is_empty" | "is_not_empty"

export interface TagFilterValue {
  operator: TagFilterOperator
  /** Ids de tag. Sempre por id: o nome muda quando a tag é renomeada, o id não. */
  tagIds: string[]
}

const tagOperator = (value: TagFilterOperator): { value: TagFilterOperator; readonly label: string } => ({
  value,
  get label() {
    return translate(`manager.tags.operators.${value}`)
  },
})

export const TAG_FILTER_OPERATORS: { value: TagFilterOperator; readonly label: string }[] = [
  tagOperator("has_any"),
  tagOperator("has_all"),
  tagOperator("has_none"),
  tagOperator("has_exact"),
  tagOperator("is_empty"),
  tagOperator("is_not_empty"),
]

/** Operadores sem campo de valor — a pergunta não depende de quais tags. */
export function tagOperatorNeedsValue(operator: TagFilterOperator): boolean {
  return operator !== "is_empty" && operator !== "is_not_empty"
}

/** Filtro recém-criado: pergunta mais comum, ainda sem tag escolhida (não restringe). */
export function defaultTagFilterValue(): TagFilterValue {
  return { operator: "has_any", tagIds: [] }
}

/**
 * Valor da versão anterior do filtro, quando tags eram um multi-select de checkboxes
 * (`{ selectedStatuses }`) com uma opção-sentinela para "sem tag". Os filtros vivem no
 * sessionStorage, então uma aba aberta durante o deploy reidrata o formato antigo.
 */
const LEGACY_NO_TAG_VALUE = "__sem_tag__"

/** Converte qualquer valor cru vindo do estado/storage no shape atual. */
export function normalizeTagFilterValue(raw: unknown): TagFilterValue | undefined {
  if (!raw || typeof raw !== "object") return undefined

  if ("tagIds" in raw) {
    const value = raw as Partial<TagFilterValue>
    if (!value.operator) return undefined
    return { operator: value.operator, tagIds: Array.isArray(value.tagIds) ? value.tagIds : [] }
  }

  if ("selectedStatuses" in raw) {
    const selected = (raw as { selectedStatuses?: unknown }).selectedStatuses
    if (!Array.isArray(selected)) return undefined
    const tagIds = selected.filter((id): id is string => typeof id === "string" && id !== LEGACY_NO_TAG_VALUE)
    // Só o sentinela marcado era exatamente a pergunta "sem tag".
    if (tagIds.length === 0 && selected.includes(LEGACY_NO_TAG_VALUE)) return { operator: "is_empty", tagIds: [] }
    return { operator: "has_any", tagIds }
  }

  return undefined
}

/** True se o filtro restringe de fato — alimenta o badge "Filtros (N)" e o funil no header. */
export function isRestrictiveTagFilterValue(raw: unknown): boolean {
  const value = normalizeTagFilterValue(raw)
  if (!value) return false
  if (!tagOperatorNeedsValue(value.operator)) return true
  return value.tagIds.length > 0
}

/** True se a linha passa no filtro de tags. */
export function rowMatchesTagFilter(tags: RankingsRowTag[] | undefined, raw: unknown): boolean {
  const value = normalizeTagFilterValue(raw)
  if (!value) return true

  const rowIds = new Set((tags ?? []).map((tag) => tag.id))

  if (value.operator === "is_empty") return rowIds.size === 0
  if (value.operator === "is_not_empty") return rowIds.size > 0

  // Operador escolhido mas nenhuma tag ainda: a pergunta está incompleta, não restringe.
  const wanted = [...new Set(value.tagIds)]
  if (wanted.length === 0) return true

  switch (value.operator) {
    case "has_any":
      return wanted.some((id) => rowIds.has(id))
    case "has_all":
      return wanted.every((id) => rowIds.has(id))
    // Linha sem tag nenhuma passa: não contém, de fato, nenhuma das escolhidas.
    case "has_none":
      return !wanted.some((id) => rowIds.has(id))
    case "has_exact":
      return rowIds.size === wanted.length && wanted.every((id) => rowIds.has(id))
  }
}

/**
 * Colunas vinculadas da planilha como CAMPOS de regra (migration 140).
 *
 * A lista ativa vive em `lib/metrics/customColumnsRegistry` (publicada pela tela
 * que conhece os packs selecionados). Aqui ela vira `RuleField`.
 *
 * VÍNCULO EXCLUÍDO
 *   Uma regra salva pode citar `custom:<id>:...` de um vínculo que já não existe.
 *   O campo NÃO some: `resolveCustomRuleField` devolve um campo rotulado "Coluna
 *   excluída", para a regra continuar legível e editável. Na avaliação, a linha não
 *   tem o histograma e a condição não casa — como qualquer "sem dado" (memória
 *   rule_engine_offered_field_must_be_answerable: um campo que zera a tela em
 *   silêncio é o pior dos mundos; aqui ele está nomeado na regra).
 */
import type { RuleContext, RuleField } from "./fields";
import { isCustomColumnKey, parseCustomColumnKey, type CustomColumnDef } from "@/lib/metrics/customColumns";
import { getActiveCustomColumn, getActiveCustomColumns } from "@/lib/metrics/customColumnsRegistry";

export { setActiveCustomColumns, getActiveCustomColumns, getActiveCustomColumn } from "@/lib/metrics/customColumnsRegistry";

/** Contextos onde as colunas vinculadas aparecem. Critério de validação fica de fora:
 *  vive nas Configurações, sem pack selecionado, e o campo abriria sem resposta. */
const CUSTOM_FIELD_CONTEXTS: RuleContext[] = ["manager", "manager-children", "boards"];

export function buildCustomRuleField(def: CustomColumnDef): RuleField {
  if (def.kind === "category") {
    return {
      id: def.key,
      label: `${def.mapping.label} (maioria)`,
      kind: "multiselect",
      group: "Planilha",
      availableIn: CUSTOM_FIELD_CONTEXTS,
    };
  }
  return {
    id: def.key,
    label: def.label,
    kind: "metric",
    group: "Planilha",
    isRatioPercent: def.facet === "mql_rate",
    availableIn: CUSTOM_FIELD_CONTEXTS,
  };
}

/** Campos das colunas ativas, na ordem dos vínculos. */
export function getActiveCustomRuleFields(): RuleField[] {
  return getActiveCustomColumns().map(buildCustomRuleField);
}

/**
 * Campo para uma chave `custom:` — ativo, ou o placeholder "Coluna excluída" para
 * uma chave que a regra cita mas nenhum pack selecionado tem.
 */
export function resolveCustomRuleField(fieldId: string): RuleField | undefined {
  if (!isCustomColumnKey(fieldId)) return undefined;
  const def = getActiveCustomColumn(fieldId);
  if (def) return buildCustomRuleField(def);
  const parsed = parseCustomColumnKey(fieldId);
  if (!parsed) return undefined;
  return {
    id: fieldId,
    label: "Coluna excluída (planilha)",
    kind: parsed.facet === "top" ? "multiselect" : "metric",
    group: "Planilha",
    isRatioPercent: parsed.facet === "mql_rate",
    availableIn: CUSTOM_FIELD_CONTEXTS,
  };
}

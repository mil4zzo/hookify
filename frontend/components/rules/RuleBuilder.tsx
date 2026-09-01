"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { IconPlus, IconTrash, IconX } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InlineNotice } from "@/components/common/States";
import { useTags } from "@/lib/api/hooks";
import { tagChipClasses, tagDotClasses } from "@/lib/tags/colors";
import {
  RULE_OPERATORS,
  ruleOperatorNeedsValue,
  getAvailableRuleFields,
  getRuleField,
  getRuleOperators,
  getDefaultRuleOperator,
  getDefaultRuleValue,
  type RuleContext,
  type RuleField,
  type RuleFieldGroup,
  type RuleManagerTab,
} from "@/lib/rules/fields";
import type { RuleConditionLeaf, RuleConditionValue, RuleLogic, RuleNode, RuleTree } from "@/lib/rules/types";
import { cn } from "@/lib/utils/cn";

export interface RuleDimensionOption {
  value: string;
  label: string;
}

export interface RuleBuilderProps {
  value: RuleTree;
  onChange: (rules: RuleTree) => void;
  /** Opções de Pack/Conta/Campanha/Conjunto presentes no recorte atual. */
  dimensionOptions?: Partial<Record<string, RuleDimensionOption[]>>;
  hasSheetIntegration?: boolean;
  disabled?: boolean;
  /**
   * Tela que está usando o construtor. É o ÚNICO eixo em que as três telas
   * diferem — muda quais campos o seletor oferece, nunca o operador, a escala
   * ou a semântica. Ver lib/rules/fields.ts.
   */
  context?: RuleContext;
  /**
   * Campo a destacar ao abrir — vem do clique no funil de uma coluna do Manager.
   *
   * O funil REVELA, não cria. Numa árvore com grupos e OU não existe resposta
   * óbvia para "onde entra a condição nova": no topo ela somaria (OU) ou apertaria
   * (E) conforme um seletor que está em outro lugar da tela, e o mesmo clique
   * faria coisas opostas. Então o funil responde a pergunta que ele PODE responder
   * sem ambiguidade — "onde este campo está sendo filtrado?" — e rola até lá.
   */
  highlightFieldId?: string | null;
  /** Aba do Manager, quando o contexto é o Manager. */
  tab?: RuleManagerTab;
}

const FIELD_GROUP_ORDER: RuleFieldGroup[] = ["Tags", "Criativo", "Procedência", "Métricas"];

/**
 * Campo em que uma condição nova nasce, por tela.
 *
 * No Manager e no Boards a pergunta mais comum é "quais tags?"; no Critério de
 * validação a pergunta é sempre volume ("a partir de quantas impressões este
 * anúncio já pode ser julgado?"), então nascer em Tags ali obrigaria a trocar o
 * campo em toda condição nova. O fallback existe porque nem todo contexto oferece
 * o preferido — linhas-filhas não carregam tags — e nascer num campo que o
 * seletor não oferece deixaria a condição órfã, sem como ser corrigida.
 */
const PREFERRED_DEFAULT_FIELD: Record<string, string> = {
  criteria: "impressions",
};
const FALLBACK_DEFAULT_FIELD = "tags";

function pickDefaultField(fields: RuleField[], context?: RuleContext): string {
  const preferred = (context && PREFERRED_DEFAULT_FIELD[context]) || FALLBACK_DEFAULT_FIELD;
  if (fields.some((field) => field.id === preferred)) return preferred;
  return fields[0]?.id ?? "ad_name";
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function newCondition(field: string): RuleConditionLeaf {
  return {
    id: newId("cond"),
    type: "condition",
    field,
    operator: getDefaultRuleOperator(field),
    value: getDefaultRuleValue(field),
  };
}

/** Substitui um nó pelo id, em qualquer profundidade. */
function replaceNode(nodes: RuleNode[], id: string, next: RuleNode): RuleNode[] {
  return nodes.map((node) => {
    if (node.id === id) return next;
    if (node.type === "group") return { ...node, conditions: replaceNode(node.conditions ?? [], id, next) };
    return node;
  });
}

function removeNode(nodes: RuleNode[], id: string): RuleNode[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) => (node.type === "group" ? { ...node, conditions: removeNode(node.conditions ?? [], id) } : node));
}

// ─────────────────────────────────────────────────────────────────────────────
// Valor da condição — um editor por tipo de campo
// ─────────────────────────────────────────────────────────────────────────────

function TagValueEditor({
  value,
  onChange,
  disabled,
}: {
  value: RuleConditionValue;
  onChange: (value: RuleConditionValue) => void;
  disabled?: boolean;
}) {
  const { data } = useTags();
  const allTags = useMemo(() => data?.data ?? [], [data]);
  const selectedIds = useMemo(() => (Array.isArray(value) ? value : []), [value]);
  const selected = useMemo(() => allTags.filter((tag) => selectedIds.includes(tag.id)), [allTags, selectedIds]);
  const available = useMemo(() => allTags.filter((tag) => !selectedIds.includes(tag.id)), [allTags, selectedIds]);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {selected.map((tag) => (
        <span key={tag.id} className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs", tagChipClasses(tag.color))}>
          {tag.name}
          <button
            type="button"
            className="opacity-70 transition-opacity hover:opacity-100"
            onClick={() => onChange(selectedIds.filter((id) => id !== tag.id))}
            disabled={disabled}
            aria-label={`Remover ${tag.name}`}
          >
            <IconX className="h-3 w-3" />
          </button>
        </span>
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={disabled || available.length === 0}>
            <IconPlus className="mr-1 h-3.5 w-3.5" />
            Tag
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-1" align="start">
          <div className="max-h-56 overflow-y-auto">
            {available.length === 0 ? (
              <div className="px-2 py-3 text-2xs text-muted-foreground">Nenhuma tag disponível.</div>
            ) : (
              available.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-input-30"
                  onClick={() => onChange([...selectedIds, tag.id])}
                >
                  <span className={cn("h-2 w-2 flex-shrink-0 rounded-full", tagDotClasses(tag.color))} />
                  <span className="truncate">{tag.name}</span>
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function MultiSelectValueEditor({
  options,
  value,
  onChange,
  disabled,
}: {
  options: RuleDimensionOption[];
  value: RuleConditionValue;
  onChange: (value: RuleConditionValue) => void;
  disabled?: boolean;
}) {
  const selectedIds = useMemo(() => (Array.isArray(value) ? value : []), [value]);
  const labelOf = useCallback(
    (id: string) => options.find((option) => option.value === id)?.label ?? id,
    [options],
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="min-w-0 max-w-full justify-start" disabled={disabled}>
          <span className="truncate">
            {selectedIds.length === 0
              ? "Selecionar..."
              : selectedIds.length === 1
                ? labelOf(selectedIds[0])
                : `${selectedIds.length} selecionados`}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1" align="start">
        <div className="max-h-56 overflow-y-auto">
          {options.length === 0 ? (
            <div className="px-2 py-3 text-2xs text-muted-foreground">Nada disponível no recorte atual.</div>
          ) : (
            options.map((option) => {
              const checked = selectedIds.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-input-30"
                  onClick={() =>
                    onChange(checked ? selectedIds.filter((id) => id !== option.value) : [...selectedIds, option.value])
                  }
                >
                  <span
                    className={cn(
                      "flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-sm border",
                      checked ? "border-primary bg-primary" : "border-border",
                    )}
                  />
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ConditionValueEditor({
  field,
  condition,
  onChange,
  dimensionOptions,
  disabled,
}: {
  field: RuleField;
  condition: RuleConditionLeaf;
  onChange: (value: RuleConditionValue) => void;
  dimensionOptions?: Partial<Record<string, RuleDimensionOption[]>>;
  disabled?: boolean;
}) {
  if (!ruleOperatorNeedsValue(condition.operator)) {
    return <span className="text-2xs text-muted-foreground">A pergunta já está completa.</span>;
  }

  if (field.kind === "tags") {
    return <TagValueEditor value={condition.value} onChange={onChange} disabled={disabled} />;
  }

  // `status` também é multi-seleção, mas o vocabulário é FIXO (as quatro situações
  // do Meta existem independentemente do que está carregado na tela), então vem do
  // próprio campo em vez de `dimensionOptions`.
  if (field.kind === "multiselect" || field.kind === "status") {
    return (
      <MultiSelectValueEditor
        options={field.options ?? dimensionOptions?.[field.id] ?? []}
        value={condition.value}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }

  if (field.kind === "date") {
    return (
      <Input
        size="sm"
        type="date"
        value={typeof condition.value === "string" ? condition.value : ""}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
    );
  }

  if (field.kind === "text") {
    return (
      <Input
        size="sm"
        value={typeof condition.value === "string" ? condition.value : ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Texto..."
        disabled={disabled}
      />
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Input
        size="sm"
        type="number"
        inputMode="decimal"
        value={condition.value == null ? "" : String(condition.value)}
        onChange={(event) => onChange(event.target.value)}
        placeholder="0"
        disabled={disabled}
      />
      {/* O valor é digitado e gravado na escala visível (30 = 30%); a divisão por
          100 acontece só na avaliação. Ver lib/rules/evaluate.ts. */}
      {field.isRatioPercent && <span className="text-2xs text-muted-foreground">%</span>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Linha de condição
// ─────────────────────────────────────────────────────────────────────────────

function ConditionRow({
  condition,
  fields,
  dimensionOptions,
  onChange,
  onRemove,
  disabled,
  highlighted = false,
}: {
  condition: RuleConditionLeaf;
  fields: RuleField[];
  dimensionOptions?: Partial<Record<string, RuleDimensionOption[]>>;
  onChange: (next: RuleConditionLeaf) => void;
  onRemove: () => void;
  disabled?: boolean;
  highlighted?: boolean;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  // Rola até a condição destacada — numa regra com vários grupos ela pode estar
  // fora da área visível do popover, e destacar sem rolar não ajudaria ninguém.
  useEffect(() => {
    if (highlighted) rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlighted]);

  const field = getRuleField(condition.field);
  const operators = getRuleOperators(condition.field);

  const grouped = useMemo(() => {
    const map = new Map<RuleFieldGroup, RuleField[]>();
    for (const item of fields) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return FIELD_GROUP_ORDER.filter((group) => map.has(group)).map((group) => ({ group, items: map.get(group)! }));
  }, [fields]);

  const handleFieldChange = (nextFieldId: string) => {
    // Trocar de campo reseta operador e valor: manter "> 30" ao ir de spend para
    // tags produziria uma condição que não é avaliável e some sem avisar.
    onChange({
      ...condition,
      field: nextFieldId,
      operator: getDefaultRuleOperator(nextFieldId),
      value: getDefaultRuleValue(nextFieldId),
    });
  };

  return (
    <div
      ref={rowRef}
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border bg-card px-2 py-2 transition-colors",
        highlighted ? "border-primary ring-1 ring-primary-30" : "border-border",
      )}
    >
      <div className="w-44 flex-shrink-0">
        <Select value={condition.field} onValueChange={handleFieldChange} disabled={disabled}>
          <SelectTrigger size="sm">
            <SelectValue placeholder="Campo" />
          </SelectTrigger>
          <SelectContent>
            {grouped.map(({ group, items }) => (
              <SelectGroup key={group}>
                <SelectLabel className="text-2xs uppercase tracking-wide text-muted-foreground">{group}</SelectLabel>
                {items.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="w-44 flex-shrink-0">
        <Select
          value={condition.operator}
          onValueChange={(operator) => onChange({ ...condition, operator })}
          disabled={disabled}
        >
          <SelectTrigger size="sm">
            <SelectValue placeholder="Operador" />
          </SelectTrigger>
          <SelectContent>
            {operators.map((operator) => (
              <SelectItem key={operator.value} value={operator.value}>
                {operator.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-0 flex-1">
        {field && (
          <ConditionValueEditor
            field={field}
            condition={condition}
            onChange={(value) => onChange({ ...condition, value })}
            dimensionOptions={dimensionOptions}
            disabled={disabled}
          />
        )}
      </div>

      <Button type="button" variant="ghost" size="sm" onClick={onRemove} disabled={disabled} aria-label="Remover condição">
        <IconTrash className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Builder
// ─────────────────────────────────────────────────────────────────────────────

function LogicSelect({
  value,
  onChange,
  disabled,
}: {
  value: RuleLogic;
  onChange: (logic: RuleLogic) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as RuleLogic)} disabled={disabled}>
      <SelectTrigger size="sm" className="w-20">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="AND">E</SelectItem>
        <SelectItem value="OR">OU</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function RuleBuilder({
  value,
  onChange,
  dimensionOptions,
  hasSheetIntegration = false,
  context,
  tab,
  highlightFieldId,
  disabled = false,
}: RuleBuilderProps) {
  const fields = useMemo(
    () => getAvailableRuleFields({ hasSheetIntegration, context, tab }),
    [hasSheetIntegration, context, tab],
  );
  const defaultField = useMemo(() => pickDefaultField(fields, context), [fields, context]);

  const setNodes = (conditions: RuleNode[]) => onChange({ ...value, conditions });

  const renderNode = (node: RuleNode, index: number) => {
    const connector =
      index === 0 ? null : (
        <div className="flex items-center gap-2 pl-1">
          {index === 1 ? (
            <LogicSelect value={value.logic} onChange={(logic) => onChange({ ...value, logic })} disabled={disabled} />
          ) : (
            <span className="w-20 text-center text-2xs font-medium uppercase text-muted-foreground">
              {value.logic === "OR" ? "OU" : "E"}
            </span>
          )}
        </div>
      );

    if (node.type === "group") {
      const children = node.conditions ?? [];
      return (
        <div key={node.id} className="space-y-2">
          {connector}
          <div className="space-y-2 rounded-md border border-dashed border-border bg-input-10 p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-2xs uppercase tracking-wide text-muted-foreground">Subgrupo</span>
                <LogicSelect
                  value={node.logic}
                  onChange={(logic) => setNodes(replaceNode(value.conditions, node.id, { ...node, logic }))}
                  disabled={disabled}
                />
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setNodes(replaceNode(value.conditions, node.id, { ...node, conditions: [...children, newCondition(defaultField)] }))
                  }
                  disabled={disabled}
                >
                  <IconPlus className="mr-1 h-3.5 w-3.5" />
                  Condição
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setNodes(removeNode(value.conditions, node.id))}
                  disabled={disabled}
                  aria-label="Remover subgrupo"
                >
                  <IconTrash className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>

            {children.length === 0 ? (
              <p className="px-1 text-2xs text-muted-foreground">Subgrupo vazio não restringe nada.</p>
            ) : (
              children.map((child, childIndex) => (
                <div key={child.id} className="space-y-2">
                  {childIndex > 0 && (
                    <span className="block pl-1 text-2xs font-medium uppercase text-muted-foreground">
                      {node.logic === "OR" ? "OU" : "E"}
                    </span>
                  )}
                  {child.type === "condition" && (
                    <ConditionRow
                      condition={child}
                      fields={fields}
                      dimensionOptions={dimensionOptions}
                      onChange={(next) => setNodes(replaceNode(value.conditions, child.id, next))}
                      onRemove={() => setNodes(removeNode(value.conditions, child.id))}
                      disabled={disabled}
                      highlighted={!!highlightFieldId && child.field === highlightFieldId}
                    />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      );
    }

    return (
      <div key={node.id} className="space-y-2">
        {connector}
        <ConditionRow
          condition={node}
          fields={fields}
          dimensionOptions={dimensionOptions}
          onChange={(next) => setNodes(replaceNode(value.conditions, node.id, next))}
          onRemove={() => setNodes(removeNode(value.conditions, node.id))}
          disabled={disabled}
          highlighted={!!highlightFieldId && node.field === highlightFieldId}
        />
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {value.conditions.length === 0 ? (
        <InlineNotice tone="info" title="Sem condições">
          {context === "criteria"
            ? "Sem critério, todo anúncio é considerado maduro — inclusive os que mal começaram a rodar. Adicione ao menos uma condição."
            : "Um grupo sem condição mostra todos os criativos do recorte. Adicione ao menos uma para o grupo significar algo."}
        </InlineNotice>
      ) : (
        <div className="space-y-2">{value.conditions.map(renderNode)}</div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setNodes([...value.conditions, newCondition(defaultField)])}
          disabled={disabled}
        >
          <IconPlus className="mr-1 h-3.5 w-3.5" />
          Condição
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            setNodes([...value.conditions, { id: newId("grp"), type: "group", logic: "OR", conditions: [newCondition(defaultField)] }])
          }
          disabled={disabled}
        >
          <IconPlus className="mr-1 h-3.5 w-3.5" />
          Subgrupo
        </Button>
      </div>
    </div>
  );
}

export { RULE_OPERATORS };

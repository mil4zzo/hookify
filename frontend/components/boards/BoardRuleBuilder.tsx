"use client";

import { useCallback, useMemo } from "react";
import { IconPlus, IconTrash, IconX } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InlineNotice } from "@/components/common/States";
import { useTags } from "@/lib/api/hooks";
import { tagChipClasses, tagDotClasses } from "@/lib/tags/colors";
import {
  BOARD_OPERATORS,
  boardOperatorNeedsValue,
  getAvailableBoardFields,
  getBoardField,
  getBoardOperators,
  getDefaultBoardOperator,
  getDefaultBoardValue,
  type BoardField,
  type BoardFieldGroup,
} from "@/lib/boards/fields";
import type { BoardConditionLeaf, BoardConditionValue, BoardLogic, BoardRuleNode, BoardRules } from "@/lib/boards/types";
import { cn } from "@/lib/utils/cn";

export interface BoardDimensionOption {
  value: string;
  label: string;
}

export interface BoardRuleBuilderProps {
  value: BoardRules;
  onChange: (rules: BoardRules) => void;
  /** Opções de Pack/Conta presentes no recorte atual. */
  dimensionOptions?: Partial<Record<string, BoardDimensionOption[]>>;
  hasSheetIntegration?: boolean;
  disabled?: boolean;
}

const FIELD_GROUP_ORDER: BoardFieldGroup[] = ["Tags", "Criativo", "Procedência", "Métricas"];

const DEFAULT_FIELD = "tags";

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function newCondition(field: string = DEFAULT_FIELD): BoardConditionLeaf {
  return {
    id: newId("cond"),
    type: "condition",
    field,
    operator: getDefaultBoardOperator(field),
    value: getDefaultBoardValue(field),
  };
}

/** Substitui um nó pelo id, em qualquer profundidade. */
function replaceNode(nodes: BoardRuleNode[], id: string, next: BoardRuleNode): BoardRuleNode[] {
  return nodes.map((node) => {
    if (node.id === id) return next;
    if (node.type === "group") return { ...node, conditions: replaceNode(node.conditions ?? [], id, next) };
    return node;
  });
}

function removeNode(nodes: BoardRuleNode[], id: string): BoardRuleNode[] {
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
  value: BoardConditionValue;
  onChange: (value: BoardConditionValue) => void;
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
  options: BoardDimensionOption[];
  value: BoardConditionValue;
  onChange: (value: BoardConditionValue) => void;
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
  field: BoardField;
  condition: BoardConditionLeaf;
  onChange: (value: BoardConditionValue) => void;
  dimensionOptions?: Partial<Record<string, BoardDimensionOption[]>>;
  disabled?: boolean;
}) {
  if (!boardOperatorNeedsValue(condition.operator)) {
    return <span className="text-2xs text-muted-foreground">A pergunta já está completa.</span>;
  }

  if (field.kind === "tags") {
    return <TagValueEditor value={condition.value} onChange={onChange} disabled={disabled} />;
  }

  if (field.kind === "multiselect") {
    return (
      <MultiSelectValueEditor
        options={dimensionOptions?.[field.id] ?? []}
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
          100 acontece só na avaliação. Ver lib/boards/evaluate.ts. */}
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
}: {
  condition: BoardConditionLeaf;
  fields: BoardField[];
  dimensionOptions?: Partial<Record<string, BoardDimensionOption[]>>;
  onChange: (next: BoardConditionLeaf) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const field = getBoardField(condition.field);
  const operators = getBoardOperators(condition.field);

  const grouped = useMemo(() => {
    const map = new Map<BoardFieldGroup, BoardField[]>();
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
      operator: getDefaultBoardOperator(nextFieldId),
      value: getDefaultBoardValue(nextFieldId),
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-2 py-2">
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
  value: BoardLogic;
  onChange: (logic: BoardLogic) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as BoardLogic)} disabled={disabled}>
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

export function BoardRuleBuilder({
  value,
  onChange,
  dimensionOptions,
  hasSheetIntegration = false,
  disabled = false,
}: BoardRuleBuilderProps) {
  const fields = useMemo(() => getAvailableBoardFields({ hasSheetIntegration }), [hasSheetIntegration]);

  const setNodes = (conditions: BoardRuleNode[]) => onChange({ ...value, conditions });

  const renderNode = (node: BoardRuleNode, index: number) => {
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
                    setNodes(replaceNode(value.conditions, node.id, { ...node, conditions: [...children, newCondition()] }))
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
        />
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {value.conditions.length === 0 ? (
        <InlineNotice tone="info" title="Sem condições">
          Um grupo sem condição mostra todos os criativos do recorte. Adicione ao menos uma para o grupo significar algo.
        </InlineNotice>
      ) : (
        <div className="space-y-2">{value.conditions.map(renderNode)}</div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setNodes([...value.conditions, newCondition()])}
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
            setNodes([...value.conditions, { id: newId("grp"), type: "group", logic: "OR", conditions: [newCondition()] }])
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

export { BOARD_OPERATORS };

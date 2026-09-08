"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconCalendar, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { format, isValid, parse } from "date-fns";
import { ptBR } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InlineNotice } from "@/components/common/States";
import { useTags } from "@/lib/api/hooks";
import { useTagScope } from "@/components/manager/TagScopeProvider";
import { tagChipClasses, tagDotClasses } from "@/lib/tags/colors";
import {
  PRESENCE_UI_OPERATOR,
  RULE_OPERATORS,
  ruleOperatorNeedsValue,
  getAvailableRuleFields,
  getPresenceValueOptions,
  getRuleField,
  getRuleOperatorMenu,
  getDefaultRuleOperator,
  getDefaultRuleValue,
  isPresenceOperator,
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
  // O vocabulário é do SILO do pack, não do usuário (migration 139). Sem passar o
  // escopo, o backend resolvia para o silo do próprio ator e quem recebe um pack
  // compartilhado abria o filtro vazio — as tags apareciam nas linhas da tabela e
  // não existiam na lista ao lado.
  //
  // Fora do Manager (Boards, Critério) não há provider montado e `packIds` vem
  // vazio: cai no silo próprio, que é o escopo correto nessas telas.
  const { packIds } = useTagScope();
  const { data } = useTags(packIds);
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

/** Formato gravado na árvore: o mesmo que o `<input type="date">` gravava. */
const RULE_DATE_FORMAT = "yyyy-MM-dd";

/**
 * Data via Popover + Calendar do projeto — o mesmo par do seletor de período do topo.
 *
 * Substitui o `<Input type="date">`, que era o ÚNICO input de data nativo aberto ao
 * usuário: o ícone do picker é desenhado pelo navegador (preto sólido no tema escuro,
 * sem como recolorir fora de um `filter: invert` que quebra no claro) e o calendário
 * que ele abre não é o do app. A data continua gravada como "yyyy-MM-dd".
 */
function DateValueEditor({
  value,
  onChange,
  disabled,
}: {
  value: RuleConditionValue;
  onChange: (value: RuleConditionValue) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // parse() em vez de new Date(string): "2026-09-08" no construtor nativo é UTC e vira
  // 07/09 à noite em UTC-3. parse() lê no fuso local, sem deslocar o dia.
  const selected = useMemo(() => {
    if (typeof value !== "string" || !value) return undefined;
    const parsed = parse(value, RULE_DATE_FORMAT, new Date());
    return isValid(parsed) ? parsed : undefined;
  }, [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("w-full min-w-0 justify-between font-normal", !selected && "text-muted-foreground")}
          disabled={disabled}
        >
          <span className="truncate">{selected ? format(selected, "dd/MM/yyyy", { locale: ptBR }) : "Escolher data"}</span>
          <IconCalendar className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          locale={ptBR}
          onSelect={(day) => {
            onChange(day ? format(day, RULE_DATE_FORMAT) : "");
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Coluna de valor para o operador de presença: escolhe entre is_empty e is_not_empty.
 * Grava no OPERADOR da condição, não no valor — a árvore não muda de formato.
 */
function PresenceValueEditor({
  field,
  operator,
  onChange,
  disabled,
}: {
  field: RuleField;
  operator: string;
  onChange: (operator: string) => void;
  disabled?: boolean;
}) {
  const options = getPresenceValueOptions(field.kind);
  return (
    <Select value={operator} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ConditionValueEditor({
  field,
  condition,
  onChange,
  onOperatorChange,
  dimensionOptions,
  disabled,
}: {
  field: RuleField;
  condition: RuleConditionLeaf;
  onChange: (value: RuleConditionValue) => void;
  onOperatorChange: (operator: string) => void;
  dimensionOptions?: Partial<Record<string, RuleDimensionOption[]>>;
  disabled?: boolean;
}) {
  if (isPresenceOperator(condition.operator)) {
    return <PresenceValueEditor field={field} operator={condition.operator} onChange={onOperatorChange} disabled={disabled} />;
  }

  // Sobram is_active/is_paused (legado do status, fora do menu): a pergunta é inteira.
  if (!ruleOperatorNeedsValue(condition.operator)) {
    return null;
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
    return <DateValueEditor value={condition.value} onChange={onChange} disabled={disabled} />;
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
  // O menu colapsa is_empty/is_not_empty em "Está" e reanexa operador legado (`>` em
  // data) só quando a condição já o usa. Ver getRuleOperatorMenu em lib/rules/fields.ts.
  const operatorMenu = getRuleOperatorMenu(condition.field, condition.operator);
  const operatorMenuValue = isPresenceOperator(condition.operator) ? PRESENCE_UI_OPERATOR : condition.operator;

  const handleOperatorChange = (next: string) => {
    if (next === PRESENCE_UI_OPERATOR) {
      // Já era presença? Mantém a escolha (vazio × preenchido). Senão, nasce em "vazio".
      if (!isPresenceOperator(condition.operator)) onChange({ ...condition, operator: "is_empty" });
      return;
    }
    onChange({ ...condition, operator: next });
  };

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

  // Sem moldura: a linha se lê pelo alinhamento dos campos, que já são mais claros que
  // o modal. Caixa com borda aqui era moldura dentro de moldura (o modal é bg-card e a
  // linha também era — mesma tinta, só a borda separava). O destaque do funil usa ring
  // com offset, que não mexe no layout e não precisa de padding para respirar.
  return (
    <div
      ref={rowRef}
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md transition-shadow",
        highlighted && "ring-1 ring-primary ring-offset-4 ring-offset-card",
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
        <Select value={operatorMenuValue} onValueChange={handleOperatorChange} disabled={disabled}>
          <SelectTrigger size="sm">
            <SelectValue placeholder="Operador" />
          </SelectTrigger>
          <SelectContent>
            {operatorMenu.map((operator) => (
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
            onOperatorChange={(operator) => onChange({ ...condition, operator })}
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

const LOGIC_LABEL: Record<RuleLogic, string> = { AND: "E", OR: "OU" };

/**
 * O conector E/OU tem UMA forma: a mesma pastilha em todo lugar. O primeiro de cada
 * grupo é clicável (o `logic` é do grupo, então um seletor basta); os seguintes são eco
 * do mesmo valor, na mesma pastilha, vazada. Antes o primeiro era um Select de 32px —
 * do tamanho de um campo de dado — e os ecos eram texto de 10px: a mesma informação
 * com dois pesos opostos na mesma coluna.
 */
const LOGIC_CHIP_CLASSES = "h-control-chip rounded-full text-2xs font-semibold uppercase tracking-wide";

function LogicChip({
  value,
  onChange,
  disabled,
}: {
  value: RuleLogic;
  onChange?: (logic: RuleLogic) => void;
  disabled?: boolean;
}) {
  if (!onChange) {
    return (
      <span
        className={cn(
          LOGIC_CHIP_CLASSES,
          "inline-flex min-w-12 items-center justify-center border border-border-50 bg-surface-2 px-2 text-muted-foreground",
        )}
      >
        {LOGIC_LABEL[value]}
      </span>
    );
  }
  return (
    <Select value={value} onValueChange={(next) => onChange(next as RuleLogic)} disabled={disabled}>
      <SelectTrigger size="xs" className={cn(LOGIC_CHIP_CLASSES, "w-auto min-w-12 gap-1")} aria-label="Conector lógico">
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

  // Ritmo vertical ÚNICO: 6px (space-y-1.5) entre qualquer par de vizinhos — item↔chip,
  // chip↔subgrupo, item↔item dentro do subgrupo. Nem item nem conector têm padding ou
  // margem própria, então a distância é simétrica por construção; antes ela vinha de
  // três fontes (padding do item, gap da lista, margem do grupo) e nunca batia.
  const renderNode = (node: RuleNode, index: number) => {
    const connector =
      index === 0 ? null : (
        <div className="flex items-center">
          <LogicChip
            value={value.logic}
            onChange={index === 1 ? (logic) => onChange({ ...value, logic }) : undefined}
            disabled={disabled}
          />
        </div>
      );

    if (node.type === "group") {
      const children = node.conditions ?? [];
      // O subgrupo é o ÚNICO contêiner da tela: superfície um degrau acima do modal
      // (surface-2), faixa de cabeçalho um degrau acima dela (surface-3). Antes era
      // tracejado sobre bg-input-10 — um poço quase da cor da página, o nível mais
      // profundo da regra desenhado como o mais fraco.
      return (
        <div key={node.id} className="space-y-1.5">
          {connector}
          <div className="overflow-hidden rounded-lg border border-border bg-surface-2">
            <div className="flex items-center justify-between gap-2 border-b border-border-50 bg-surface-3 px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Subgrupo</span>
                <LogicChip
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

            <div className="space-y-1.5 p-2">
            {children.length === 0 ? (
              <p className="px-1 text-2xs text-muted-foreground">Subgrupo vazio não restringe nada.</p>
            ) : (
              children.map((child, childIndex) => (
                <div key={child.id} className="space-y-1.5">
                  {childIndex > 0 && (
                    <div className="flex items-center">
                      <LogicChip value={node.logic} />
                    </div>
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
        </div>
      );
    }

    return (
      <div key={node.id} className="space-y-1.5">
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
        <div className="space-y-1.5">{value.conditions.map(renderNode)}</div>
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

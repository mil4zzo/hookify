"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { IconPlus, IconTrash, IconCheck, IconAlertCircle, IconLoader2 } from "@tabler/icons-react";
import { getAdMetricsFieldsForSelect, getFieldInfo, getOperatorsForFieldType, isOperatorValidForFieldType } from "@/lib/config/adMetricsFields";

export type ValidationCondition = {
  id: string;
  type: "condition" | "group";
  logic?: "AND" | "OR"; // Operador lógico com a condição anterior (apenas para grupos, para saber como se conectam com outros critérios/grupos)
  groupLogic?: "AND" | "OR"; // Operador lógico do grupo (aplica-se a todos os critérios dentro do grupo)
  field?: string;
  operator?: string;
  value?: string;
  conditions?: ValidationCondition[]; // Para grupos
};

export type ValidationCriteriaData = {
  globalLogic?: "AND" | "OR"; // Operador lógico global (aplica-se a todos os critérios fora dos grupos)
  conditions: ValidationCondition[];
};

interface ValidationCriteriaBuilderProps {
  value: ValidationCondition[];
  onChange: (conditions: ValidationCondition[]) => void;
  onSave?: (conditions: ValidationCondition[]) => Promise<void>;
  isSaving?: boolean;
}

// Campos disponíveis carregados dinamicamente de ad_metrics
const FILTER_FIELDS = getAdMetricsFieldsForSelect();

function generateId(): string {
  return `condition_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Retorna o operador padrão para um campo baseado no seu tipo
 */
function getDefaultOperatorForField(fieldValue: string): string {
  const fieldInfo = getFieldInfo(fieldValue);
  const operators = getOperatorsForFieldType(fieldInfo?.type);
  return operators.length > 0 ? operators[0].value : "EQUAL";
}

/**
 * Compara duas condições de forma profunda (deep comparison)
 */
function areConditionsEqual(conditions1: ValidationCondition[], conditions2: ValidationCondition[]): boolean {
  if (conditions1.length !== conditions2.length) {
    return false;
  }

  const normalizeCondition = (condition: ValidationCondition): any => {
    // Remove id para comparação (ids são gerados dinamicamente)
    const { id, ...rest } = condition;
    if (rest.type === "group" && rest.conditions) {
      return {
        ...rest,
        conditions: rest.conditions.map(normalizeCondition),
      };
    }
    return rest;
  };

  const normalized1 = conditions1.map(normalizeCondition);
  const normalized2 = conditions2.map(normalizeCondition);

  return JSON.stringify(normalized1) === JSON.stringify(normalized2);
}

/**
 * Valida se as condições estão completas (sem campos vazios)
 */
function validateConditions(conditions: ValidationCondition[]): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  const validateCondition = (condition: ValidationCondition, path: string = ""): void => {
    if (condition.type === "condition") {
      if (!condition.field || condition.field.trim() === "") {
        errors.push(`${path ? `${path}: ` : ""}Campo não pode estar vazio`);
      }
      if (!condition.operator || condition.operator.trim() === "") {
        errors.push(`${path ? `${path}: ` : ""}Operador não pode estar vazio`);
      }
      if (condition.value === undefined || condition.value === null || (typeof condition.value === "string" && condition.value.trim() === "")) {
        errors.push(`${path ? `${path}: ` : ""}Valor não pode estar vazio`);
      }
    } else if (condition.type === "group") {
      if (!condition.conditions || condition.conditions.length === 0) {
        errors.push(`${path ? `${path}: ` : ""}Grupo não pode estar vazio`);
      } else {
        condition.conditions.forEach((c, index) => {
          const newPath = path ? `${path} > Condição ${index + 1}` : `Grupo > Condição ${index + 1}`;
          validateCondition(c, newPath);
        });
      }
    }
  };

  if (conditions.length === 0) {
    errors.push("Adicione pelo menos uma condição");
  } else {
    conditions.forEach((condition, index) => {
      const path = condition.type === "group" ? `Grupo ${index + 1}` : `Condição ${index + 1}`;
      validateCondition(condition, path);
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

interface ConditionRowProps {
  condition: ValidationCondition;
  index: number;
  operatorLogic: "AND" | "OR";
  onFieldChange: (value: string) => void;
  onOperatorChange: (value: string) => void;
  onValueChange: (value: string) => void;
  onRemove: () => void;
  onOperatorLogicChange?: (value: "AND" | "OR") => void;
  showOperatorSelector?: boolean;
}

function ConditionRow({ condition, index, operatorLogic, onFieldChange, onOperatorChange, onValueChange, onRemove, onOperatorLogicChange, showOperatorSelector = false }: ConditionRowProps) {
  // Obter informações do campo selecionado
  const fieldInfo = condition.field ? getFieldInfo(condition.field) : undefined;
  const fieldType = fieldInfo?.type;

  // Obter operadores disponíveis baseado no tipo do campo
  const availableOperators = getOperatorsForFieldType(fieldType);

  // Handler para mudança de campo que valida/reseta o operador
  const handleFieldChange = (newFieldValue: string) => {
    onFieldChange(newFieldValue);

    // Obter o tipo do novo campo
    const newFieldInfo = getFieldInfo(newFieldValue);
    const newFieldType = newFieldInfo?.type;

    // Se o operador atual não for válido para o novo tipo, resetar para o primeiro operador válido
    if (condition.operator && newFieldType) {
      if (!isOperatorValidForFieldType(condition.operator, newFieldType)) {
        const newOperators = getOperatorsForFieldType(newFieldType);
        if (newOperators.length > 0) {
          onOperatorChange(newOperators[0].value);
        }
      }
    } else if (newFieldType) {
      // Se não há operador selecionado, definir o primeiro operador válido
      const newOperators = getOperatorsForFieldType(newFieldType);
      if (newOperators.length > 0) {
        onOperatorChange(newOperators[0].value);
      }
    }
  };

  // Handler para mudança de valor que valida números para campos numéricos
  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;

    // Se o campo for numérico (integer ou numeric), permitir apenas números e ponto decimal
    if (fieldType === "integer" || fieldType === "numeric") {
      // Permitir números, ponto decimal e sinal negativo no início
      // Regex: permite números, um ponto decimal, e sinal negativo opcional no início
      const numericRegex = /^-?\d*\.?\d*$/;

      if (newValue === "" || numericRegex.test(newValue)) {
        // Para integer, remover ponto decimal se houver
        if (fieldType === "integer") {
          const integerValue = newValue.replace(/\./g, "");
          onValueChange(integerValue);
        } else {
          onValueChange(newValue);
        }
      }
      // Se não passar na validação, não atualiza o valor (ignora a entrada)
    } else {
      // Para campos não numéricos, permitir qualquer valor
      onValueChange(newValue);
    }
  };

  // Determinar o placeholder baseado no tipo do campo
  const inputPlaceholder = fieldType === "integer" || fieldType === "numeric" ? "Número..." : "Valor...";
  return (
    <div className="flex items-center gap-2">
      {/* Mostrar "ONDE" para primeira condição, seletor na segunda, label nas demais */}
      {index === 0 ? (
        <div className="w-16 px-3 py-2 flex items-center justify-start">
          <span className="text-sm font-medium text-muted-foreground">ONDE</span>
        </div>
      ) : index === 1 && showOperatorSelector && onOperatorLogicChange ? (
        <div className="w-16 flex items-center justify-start">
          <Select value={operatorLogic} onValueChange={onOperatorLogicChange}>
            <SelectTrigger className="w-full h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="AND">E</SelectItem>
              <SelectItem value="OR">OU</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div className="w-16 px-3 py-2 flex items-center justify-start">
          <span className="text-sm font-medium text-muted-foreground">{operatorLogic === "OR" ? "OU" : "E"}</span>
        </div>
      )}
      <div className="flex-1 grid grid-cols-12 gap-2">
        <div className="col-span-4">
          <Combobox value={condition.field || ""} onValueChange={handleFieldChange} options={FILTER_FIELDS} placeholder="Campo" searchPlaceholder="Buscar campo..." emptyMessage="Nenhum campo encontrado." className="w-full" />
        </div>
        <div className="col-span-3">
          <Select value={condition.operator || ""} onValueChange={onOperatorChange} disabled={!condition.field}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Operador" />
            </SelectTrigger>
            <SelectContent>
              {availableOperators.map((op) => (
                <SelectItem key={op.value} value={op.value}>
                  {op.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-4">
          <Input type="text" placeholder={inputPlaceholder} value={condition.value || ""} onChange={handleValueChange} inputMode={fieldType === "integer" || fieldType === "numeric" ? "decimal" : "text"} />
        </div>
        <div className="col-span-1">
          <Button type="button" variant="ghost" size="sm" onClick={onRemove} className="h-full text-destructive hover:text-destructive">
            <IconTrash className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ValidationCriteriaBuilder({ value, onChange, onSave, isSaving = false }: ValidationCriteriaBuilderProps) {
  const [conditions, setConditions] = useState<ValidationCondition[]>(value || []);
  const [globalLogic, setGlobalLogic] = useState<"AND" | "OR">("AND");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  // Referência do estado original (o que foi carregado do Supabase/localStorage)
  const originalConditionsRef = useRef<ValidationCondition[]>([]);

  // Sincronizar estado interno com prop value
  useEffect(() => {
    // Sempre sincronizar, mesmo se for array vazio
    if (Array.isArray(value)) {
      setConditions(value);
      // Atualizar referência do estado original quando o valor muda (carregamento inicial ou após salvar)
      originalConditionsRef.current = JSON.parse(JSON.stringify(value));
    }
  }, [value]);

  const updateConditions = (newConditions: ValidationCondition[]) => {
    setConditions(newConditions);
    onChange(newConditions);
    // Limpar erros quando o usuário edita
    setValidationErrors([]);
  };

  const handleSave = async () => {
    const validation = validateConditions(conditions);

    if (!validation.isValid) {
      setValidationErrors(validation.errors);
      return;
    }

    setValidationErrors([]);

    if (onSave) {
      try {
        await onSave(conditions);
        // Atualizar referência do estado original após salvar com sucesso
        originalConditionsRef.current = JSON.parse(JSON.stringify(conditions));
      } catch (error) {
        console.error("Erro ao salvar critérios:", error);
        setValidationErrors(["Erro ao salvar critérios. Tente novamente."]);
      }
    }
  };

  // Verificar se há mudanças em relação ao estado original
  const hasChanges = !areConditionsEqual(conditions, originalConditionsRef.current);

  const addCondition = () => {
    const defaultField = "campaign_name";
    const newCondition: ValidationCondition = {
      id: generateId(),
      type: "condition",
      // Não adiciona logic aqui - usa o globalLogic
      field: defaultField,
      operator: getDefaultOperatorForField(defaultField),
      value: "",
    };
    updateConditions([...conditions, newCondition]);
  };

  const addConditionGroup = () => {
    const newGroup: ValidationCondition = {
      id: generateId(),
      type: "group",
      // Não adiciona logic aqui - usa o globalLogic para conectar com outros critérios/grupos
      groupLogic: "OR", // Operador padrão do grupo
      conditions: [
        {
          id: generateId(),
          type: "condition",
          field: "campaign_name",
          operator: getDefaultOperatorForField("campaign_name"),
          value: "",
        },
      ],
    };
    updateConditions([...conditions, newGroup]);
  };

  const removeCondition = (id: string) => {
    const removeRecursive = (items: ValidationCondition[]): ValidationCondition[] => {
      return items
        .filter((item) => item.id !== id)
        .map((item) => {
          if (item.type === "group" && item.conditions) {
            return {
              ...item,
              conditions: removeRecursive(item.conditions),
            };
          }
          return item;
        });
    };

    const newConditions = removeRecursive(conditions);
    updateConditions(newConditions);
  };

  const updateCondition = (id: string, updates: Partial<ValidationCondition>) => {
    const updateRecursive = (items: ValidationCondition[]): ValidationCondition[] => {
      return items.map((item) => {
        if (item.id === id) {
          const updated = { ...item, ...updates };
          // Se o groupLogic mudou, garantir que está definido
          if (updated.type === "group" && "groupLogic" in updates && !updated.groupLogic) {
            updated.groupLogic = "OR"; // Valor padrão
          }
          return updated;
        }
        if (item.type === "group" && item.conditions) {
          return {
            ...item,
            conditions: updateRecursive(item.conditions),
          };
        }
        return item;
      });
    };

    updateConditions(updateRecursive(conditions));
  };

  const addConditionToGroup = (groupId: string) => {
    const updateRecursive = (items: ValidationCondition[]): ValidationCondition[] => {
      return items.map((item) => {
        if (item.id === groupId && item.type === "group") {
          const defaultField = "campaign_name";
          const newCondition: ValidationCondition = {
            id: generateId(),
            type: "condition",
            // Não adiciona logic aqui - o grupo usa groupLogic
            field: defaultField,
            operator: getDefaultOperatorForField(defaultField),
            value: "",
          };
          return {
            ...item,
            conditions: [...(item.conditions || []), newCondition],
          };
        }
        if (item.type === "group" && item.conditions) {
          return {
            ...item,
            conditions: updateRecursive(item.conditions),
          };
        }
        return item;
      });
    };

    updateConditions(updateRecursive(conditions));
  };

  const removeConditionFromGroup = (groupId: string, conditionId: string) => {
    const updateRecursive = (items: ValidationCondition[]): ValidationCondition[] => {
      return items.map((item) => {
        if (item.id === groupId && item.type === "group" && item.conditions) {
          const filtered = item.conditions.filter((c) => c.id !== conditionId);
          return {
            ...item,
            conditions: filtered,
          };
        }
        if (item.type === "group" && item.conditions) {
          return {
            ...item,
            conditions: updateRecursive(item.conditions),
          };
        }
        return item;
      });
    };

    updateConditions(updateRecursive(conditions));
  };

  const updateConditionInGroup = (groupId: string, conditionId: string, updates: Partial<ValidationCondition>) => {
    const updateRecursive = (items: ValidationCondition[]): ValidationCondition[] => {
      return items.map((item) => {
        if (item.id === groupId && item.type === "group" && item.conditions) {
          return {
            ...item,
            conditions: item.conditions.map((c) => (c.id === conditionId ? { ...c, ...updates } : c)),
          };
        }
        if (item.type === "group" && item.conditions) {
          return {
            ...item,
            conditions: updateRecursive(item.conditions),
          };
        }
        return item;
      });
    };

    updateConditions(updateRecursive(conditions));
  };

  const renderCondition = (condition: ValidationCondition, index: number, isInGroup: boolean = false) => {
    if (condition.type === "group") {
      const groupLogic = condition.groupLogic || "OR";

      return (
        <div key={condition.id} className="flex items-start gap-2">
          {/* Operador global fora do grupo, à esquerda */}
          {index === 0 ? (
            <div className="w-16 px-3 py-2 flex items-center justify-start">
              <span className="text-sm font-medium text-muted-foreground">ONDE</span>
            </div>
          ) : (
            <div className="w-16 px-3 py-2 flex items-center justify-start">
              {index === 1 ? (
                <Select value={globalLogic} onValueChange={(value: "AND" | "OR") => setGlobalLogic(value)}>
                  <SelectTrigger className="w-full h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AND">E</SelectItem>
                    <SelectItem value="OR">OU</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-sm font-medium text-muted-foreground">{globalLogic === "OR" ? "OU" : "E"}</span>
              )}
            </div>
          )}
          {/* Card do grupo alinhado aos seletores de campo */}
          <div className="flex-1 border border-border rounded-lg p-3 pt-1 bg-secondary/30 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">{groupLogic === "OR" ? "Any of the following are true…" : "All of the following are true…"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => addConditionToGroup(condition.id)} className="h-full">
                  <IconPlus className="w-4 h-4" />
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeCondition(condition.id)} className="h-full text-destructive hover:text-destructive">
                  <IconTrash className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              {condition.conditions?.map((groupCondition, groupIndex) => (
                <ConditionRow key={groupCondition.id} condition={groupCondition} index={groupIndex} operatorLogic={groupLogic} onFieldChange={(value) => updateConditionInGroup(condition.id, groupCondition.id, { field: value })} onOperatorChange={(value) => updateConditionInGroup(condition.id, groupCondition.id, { operator: value })} onValueChange={(value) => updateConditionInGroup(condition.id, groupCondition.id, { value })} onRemove={() => removeConditionFromGroup(condition.id, groupCondition.id)} onOperatorLogicChange={(value) => updateCondition(condition.id, { groupLogic: value })} showOperatorSelector={groupIndex === 1} />
              ))}
            </div>
          </div>
        </div>
      );
    }

    // Condição simples
    return <ConditionRow key={condition.id} condition={condition} index={index} operatorLogic={globalLogic} onFieldChange={(value) => updateCondition(condition.id, { field: value })} onOperatorChange={(value) => updateCondition(condition.id, { operator: value })} onValueChange={(value) => updateCondition(condition.id, { value })} onRemove={() => removeCondition(condition.id)} onOperatorLogicChange={(value) => setGlobalLogic(value)} showOperatorSelector={index === 1} />;
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {conditions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">Nenhum critério de validação definido.</p>
            <p className="text-xs mt-1">Adicione uma condição ou grupo para começar.</p>
          </div>
        ) : (
          conditions.map((condition, index) => renderCondition(condition, index))
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addCondition} className="flex items-center gap-2">
          <IconPlus className="w-4 h-4" />
          Adicionar condição
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={addConditionGroup} className="flex items-center gap-2">
          <IconPlus className="w-4 h-4" />
          Adicionar grupo de condições
        </Button>
      </div>

      {/* Mensagens de erro de validação */}
      {validationErrors.length > 0 && (
        <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
          <div className="flex items-start gap-2">
            <IconAlertCircle className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive mb-1">Erros de validação:</p>
              <ul className="text-sm text-destructive/90 list-disc list-inside space-y-1">
                {validationErrors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Botão Salvar */}
      {onSave && (
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={handleSave} disabled={isSaving || conditions.length === 0 || !hasChanges} variant={hasChanges && conditions.length > 0 && !isSaving ? "default" : "ghost"} className="flex items-center gap-2">
            {isSaving ? (
              <>
                <IconLoader2 className="w-4 h-4 animate-spin" />
                Salvando...
              </>
            ) : hasChanges && conditions.length > 0 ? (
              <>
                <IconCheck className="w-4 h-4" />
                Salvar critérios
              </>
            ) : (
              <>
                <IconCheck className="w-4 h-4" />
                Salvo
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

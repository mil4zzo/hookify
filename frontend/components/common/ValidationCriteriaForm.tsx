"use client";

import { useState } from "react";
import { ValidationCondition } from "@/components/common/ValidationCriteriaBuilder";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { IconCheck, IconLoader2 } from "@tabler/icons-react";
import { INTEGER_FIELDS, NUMERIC_FIELDS, NUMERIC_OPERATORS } from "@/lib/config/adMetricsFields";

interface ValidationCriteriaFormProps {
  defaultImpressions?: number;
  isSaving?: boolean;
  error?: string | null;
  onSave: (criteria: ValidationCondition[]) => Promise<void> | void;
  onSkip?: () => void;
}

const DEFAULT_IMPRESSIONS = 3000;

export function ValidationCriteriaForm({
  defaultImpressions = DEFAULT_IMPRESSIONS,
  isSaving,
  error,
  onSave,
  onSkip,
}: ValidationCriteriaFormProps) {
  // Campos disponíveis: apenas métricas numéricas/inteiras
  const numericFields = [...INTEGER_FIELDS, ...NUMERIC_FIELDS];
  const defaultField = numericFields.find((f) => f.value === "impressions")?.value || numericFields[0]?.value || "impressions";

  const [field, setField] = useState<string>(defaultField);
  const [operator, setOperator] = useState<string>("GREATER_THAN_OR_EQUAL");
  const [value, setValue] = useState<number>(defaultImpressions);

  const handleSave = async () => {
    const numericValue = Number(value);
    const safeValue = Number.isFinite(numericValue) ? numericValue : defaultImpressions;

    const condition: ValidationCondition = {
      id: "validation_default_condition",
      type: "condition",
      field,
      operator,
      value: String(safeValue),
    };
    await onSave([condition]);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">Um anúncio pode ser analisado se...</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-40">
            <Select value={field} onValueChange={setField}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {numericFields.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-32">
            <Select value={operator} onValueChange={setOperator}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NUMERIC_OPERATORS.map((op) => (
                  <SelectItem key={op.value} value={op.value}>
                    {op.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-32">
            <Input
              type="number"
              min={0}
              value={value}
              onChange={(e) => setValue(Number(e.target.value || defaultImpressions))}
              className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Recomenda-se começar, como padrão, com <strong>Impressions &gt;= {defaultImpressions.toLocaleString("pt-BR")}</strong>,
          mas você pode ajustar o campo, o operador e o valor conforme seu contexto.
        </p>
      </div>

      {error && (
        <p className="text-xs text-red-500">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <Button
          className="flex-1 flex items-center gap-2"
          onClick={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <IconLoader2 className="w-4 h-4 animate-spin" />
          ) : (
            <IconCheck className="w-4 h-4" />
          )}
          {isSaving ? "Salvando..." : "Salvar e continuar"}
        </Button>
        {onSkip && (
          <Button
            variant="outline"
            onClick={onSkip}
            disabled={isSaving}
          >
            Ajustar depois
          </Button>
        )}
      </div>
    </div>
  );
}



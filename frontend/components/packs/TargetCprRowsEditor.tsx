"use client";

import { IconPlus, IconTrash } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatActionTypeLabel } from "@/lib/utils/packJudgmentForm";
import {
  addTargetCprRow,
  canAddTargetCprRow,
  eventsForRow,
  removeTargetCprRow,
  updateTargetCprRow,
  type TargetCprRow,
} from "@/lib/utils/targetCprRows";

interface TargetCprRowsEditorProps {
  rows: TargetCprRow[];
  onChange: (rows: TargetCprRow[]) => void;
  /** Eventos de conversão do pack (em massa: a união dos packs). */
  conversionTypes: readonly string[];
  disabled?: boolean;
  /** Nota curta ao lado do evento no seletor (em massa: "os packs discordam"). */
  eventNote?: (event: string) => string | undefined;
}

/**
 * CPR alvo em linhas: evento à esquerda, meta à direita, lixeira no fim — o mesmo
 * desenho das condições dos filtros. Só as linhas com meta aparecem; "Meta" acrescenta
 * outra. A lógica (o que cada linha vira no mapa do formulário) é `targetCprRows.ts`.
 */
export function TargetCprRowsEditor({ rows, onChange, conversionTypes, disabled, eventNote }: TargetCprRowsEditorProps) {
  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        {rows.map((row) => {
          const options = eventsForRow(rows, conversionTypes, row.key);
          const label = row.event ? formatActionTypeLabel(row.event) : "";
          return (
            <div key={row.key} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Select value={row.event} onValueChange={(event) => onChange(updateTargetCprRow(rows, row.key, { event }))} disabled={disabled}>
                  <SelectTrigger size="sm" aria-label="Evento de conversão">
                    <SelectValue placeholder="Escolha o evento" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((type) => {
                      const note = eventNote?.(type);
                      return (
                        <SelectItem key={type} value={type}>
                          {formatActionTypeLabel(type)}
                          {note ? <span className="text-muted-foreground"> · {note}</span> : null}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <Input
                type="number"
                min="0"
                step="0.01"
                size="sm"
                className="w-36"
                value={row.value}
                onChange={(e) => onChange(updateTargetCprRow(rows, row.key, { value: e.target.value }))}
                placeholder={row.event ? "sem meta" : "escolha o evento"}
                aria-label={label ? `Meta de CPR de ${label}` : "Meta de CPR"}
                // Valor sem evento não vira meta de ninguém: o campo só abre com o evento escolhido.
                disabled={disabled || !row.event}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(removeTargetCprRow(rows, row.key))}
                disabled={disabled || (rows.length === 1 && !row.event && !row.value)}
                aria-label={label ? `Remover a meta de ${label}` : "Remover linha"}
              >
                <IconTrash className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          );
        })}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange(addTargetCprRow(rows))}
        disabled={disabled || !canAddTargetCprRow(rows, conversionTypes)}
      >
        <IconPlus className="mr-1 h-3.5 w-3.5" />
        Meta
      </Button>
    </div>
  );
}

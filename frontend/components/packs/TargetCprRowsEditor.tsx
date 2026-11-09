"use client";

import { useTranslations } from "next-intl";
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
  /** Eventos cuja meta é definida por uma pasta: a linha não muda nem sai. */
  lockedEvents?: ReadonlySet<string>;
  /** Recado sob a linha travada. */
  lockedNote?: string | null;
}

/**
 * CPR alvo em linhas: evento à esquerda, meta à direita, lixeira no fim — o mesmo
 * desenho das condições dos filtros. Só as linhas com meta aparecem; "Meta" acrescenta
 * outra. A lógica (o que cada linha vira no mapa do formulário) é `targetCprRows.ts`.
 */
export function TargetCprRowsEditor({ rows, onChange, conversionTypes, disabled, eventNote, lockedEvents, lockedNote }: TargetCprRowsEditorProps) {
  const t = useTranslations("packs.targetCpr");
  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        {rows.map((row) => {
          const options = eventsForRow(rows, conversionTypes, row.key);
          const label = row.event ? formatActionTypeLabel(row.event) : "";
          // Evento cuja meta a pasta define (dono único): a linha fica, mas não muda nem sai.
          const locked = !!row.event && !!lockedEvents?.has(row.event);
          const rowDisabled = disabled || locked;
          return (
            <div key={row.key} className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Select value={row.event} onValueChange={(event) => onChange(updateTargetCprRow(rows, row.key, { event }))} disabled={rowDisabled}>
                  <SelectTrigger size="sm" aria-label={t("conversionEvent")}>
                    <SelectValue placeholder={t("chooseEvent")} />
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
                placeholder={row.event ? t("noTarget") : t("chooseEventLower")}
                aria-label={label ? t("goalFor", { label }) : t("goal")}
                // Valor sem evento não vira meta de ninguém: o campo só abre com o evento escolhido.
                disabled={rowDisabled || !row.event}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(removeTargetCprRow(rows, row.key))}
                disabled={rowDisabled || (rows.length === 1 && !row.event && !row.value)}
                aria-label={label ? t("removeFor", { label }) : t("removeRow")}
              >
                <IconTrash className="h-4 w-4 text-destructive" />
              </Button>
            </div>
            {locked && lockedNote ? <p className="text-xs text-muted-foreground">{lockedNote}</p> : null}
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
        {t("add")}
      </Button>
    </div>
  );
}

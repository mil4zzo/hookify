"use client";

import { useEffect, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";

import { AppDialog } from "@/components/common/AppDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BoardRuleBuilder, type BoardDimensionOption } from "@/components/boards/BoardRuleBuilder";
import { getBoardSortMetrics } from "@/lib/boards/fields";
import { EMPTY_BOARD_RULES, normalizeBoardRules, type BoardGroup, type BoardRules } from "@/lib/boards/types";
import { TAG_COLORS, tagDotClasses } from "@/lib/tags/colors";
import { cn } from "@/lib/utils/cn";

export interface BoardGroupDraft {
  name: string;
  color: string;
  rules: BoardRules;
  sort_metric: string;
  sort_direction: "asc" | "desc";
}

export interface BoardGroupDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Ausente = criação. */
  group?: BoardGroup | null;
  /** Cor sugerida na criação, rotacionando a paleta pelo total de grupos. */
  suggestedColor?: string;
  dimensionOptions?: Partial<Record<string, BoardDimensionOption[]>>;
  hasSheetIntegration?: boolean;
  isSaving?: boolean;
  onSubmit: (draft: BoardGroupDraft) => Promise<void> | void;
}

const MAX_NAME_LEN = 60; // espelha o CHECK board_groups_name_max_len (migration 119)

export function BoardGroupDialog({
  isOpen,
  onClose,
  group,
  suggestedColor,
  dimensionOptions,
  hasSheetIntegration = false,
  isSaving = false,
  onSubmit,
}: BoardGroupDialogProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(TAG_COLORS[0]);
  const [rules, setRules] = useState<BoardRules>(EMPTY_BOARD_RULES);
  const [sortMetric, setSortMetric] = useState("spend");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // Reidrata a cada abertura, não a cada render: sem o gate em `isOpen`, digitar
  // no nome seria desfeito pelo próximo render do pai.
  useEffect(() => {
    if (!isOpen) return;
    setName(group?.name ?? "");
    setColor(group?.color ?? suggestedColor ?? TAG_COLORS[0]);
    setRules(group ? normalizeBoardRules(group.rules) : EMPTY_BOARD_RULES);
    setSortMetric(group?.sort_metric ?? "spend");
    setSortDirection(group?.sort_direction ?? "desc");
  }, [isOpen, group, suggestedColor]);

  const sortMetrics = getBoardSortMetrics({ hasSheetIntegration });
  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !isSaving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    await onSubmit({ name: trimmedName, color, rules, sort_metric: sortMetric, sort_direction: sortDirection });
  };

  return (
    <AppDialog
      isOpen={isOpen}
      onClose={onClose}
      title={group ? "Editar grupo" : "Novo grupo"}
      size="3xl"
      padding="md"
      className="flex max-h-[90dvh] min-h-0 flex-col overflow-hidden"
      bodyClassName="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <div>
          <h2 className="text-lg font-medium text-foreground">{group ? "Editar grupo" : "Novo grupo"}</h2>
          <p className="text-sm text-muted-foreground">
            O grupo mostra todo criativo do recorte atual que atender às condições. Grupos não são exclusivos: o mesmo
            criativo pode aparecer em vários.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-2xs uppercase tracking-wide text-muted-foreground" htmlFor="board-group-name">
              Nome
            </label>
            <Input
              id="board-group-name"
              value={name}
              maxLength={MAX_NAME_LEN}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Hook de dor"
            />
          </div>

          <div>
            <span className="mb-1 block text-2xs uppercase tracking-wide text-muted-foreground">Cor</span>
            <div className="flex h-control-default items-center gap-2">
              {TAG_COLORS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-label={`Cor ${option}`}
                  aria-pressed={color === option}
                  onClick={() => setColor(option)}
                  className={cn(
                    "h-6 w-6 rounded-full ring-offset-background transition-all",
                    tagDotClasses(option),
                    color === option ? "ring-2 ring-ring ring-offset-2" : "opacity-60 hover:opacity-100",
                  )}
                />
              ))}
            </div>
          </div>
        </div>

        <div>
          <span className="mb-2 block text-2xs uppercase tracking-wide text-muted-foreground">Condições</span>
          <BoardRuleBuilder
            value={rules}
            onChange={setRules}
            dimensionOptions={dimensionOptions}
            hasSheetIntegration={hasSheetIntegration}
            disabled={isSaving}
          />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-2xs uppercase tracking-wide text-muted-foreground" htmlFor="board-group-sort">
              Ordenar por
            </label>
            <Select value={sortMetric} onValueChange={setSortMetric} disabled={isSaving}>
              <SelectTrigger id="board-group-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sortMetrics.map((metric) => (
                  <SelectItem key={metric.value} value={metric.value}>
                    {metric.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-40">
            <span className="mb-1 block text-2xs uppercase tracking-wide text-muted-foreground">Direção</span>
            <Select
              value={sortDirection}
              onValueChange={(value) => setSortDirection(value as "asc" | "desc")}
              disabled={isSaving}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">Maior primeiro</SelectItem>
                <SelectItem value="asc">Menor primeiro</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-shrink-0 items-center justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" onClick={onClose} disabled={isSaving}>
          Cancelar
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
          {isSaving && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
          {group ? "Salvar" : "Criar grupo"}
        </Button>
      </div>
    </AppDialog>
  );
}

"use client";

import React, { useCallback, useMemo, useState } from "react";
import { IconAlertTriangle, IconPencil } from "@tabler/icons-react";
import type { RankingsItem } from "@/lib/api/schemas";
import { useFormatCurrency, getCurrencySymbol } from "@/lib/utils/currency";
import { useBudgetControl, type BudgetEntityType } from "@/lib/hooks/useBudgetControl";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

// Moedas que a Meta trata SEM subunidade (offset 1) — nas demais o budget vem em
// centésimos (offset 100). Fonte: doc oficial de currencies da Marketing API.
const META_OFFSET_ONE = new Set([
  "CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "MWK", "PYG", "TWD", "VND",
]);

/** Converte budget em subunidade da Meta para o valor de exibição na moeda da conta. */
export function budgetMinorToValue(minor: number, currency?: string | null): number {
  const code = String(currency || "").toUpperCase();
  return META_OFFSET_ONE.has(code) ? minor : minor / 100;
}

/** Converte valor de exibição (unidade da moeda) para a subunidade que a Meta espera. */
export function budgetValueToMinor(value: number, currency?: string | null): number {
  const code = String(currency || "").toUpperCase();
  return Math.round(META_OFFSET_ONE.has(code) ? value : value * 100);
}

/** Budget efetivo da linha para ordenação: daily ?? lifetime (subunidade; null = sem budget próprio). */
export function getRowBudgetMinor(row: RankingsItem): number | null {
  return row.budget_daily ?? row.budget_lifetime ?? null;
}

interface BudgetCellProps {
  original: RankingsItem;
  currentTab: "por-conjunto" | "por-campanha";
}

/**
 * Aceita vírgula OU ponto como separador decimal. Com vírgula presente ("1.500,50"),
 * pontos são separadores de milhar; sem vírgula, um ponto único é decimal ("150.50").
 */
function parseBudgetInput(raw: string): number | null {
  let normalized = raw.trim();
  if (!normalized) return null;
  if (normalized.includes(",")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  }
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

interface BudgetEditorProps {
  entityType: BudgetEntityType;
  entityId: string;
  currentMinor: number;
  isDaily: boolean;
  currency: string | null;
  formatted: string;
  titleHint: string;
}

/**
 * Valor clicável + popover de edição. O backend valida modo (CBO/ABO) e tipo
 * (daily/lifetime), escreve e RELÊ do Meta — o cache recebe só a verdade verificada.
 */
function BudgetEditor({ entityType, entityId, currentMinor, isDaily, currency, formatted, titleHint }: BudgetEditorProps) {
  const { updateBudget, isLoading } = useBudgetControl({ entityType, entityId });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const currentValue = budgetMinorToValue(currentMinor, currency);
  const symbol = currency ? getCurrencySymbol(currency) : "";

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (isLoading) return; // não fechar/reabrir no meio do save
      setOpen(next);
      if (next) {
        // Draft sempre parte do valor VIGENTE (sem separador de milhar, decimais só se existirem)
        setDraft(String(currentValue % 1 === 0 ? currentValue : currentValue.toFixed(2)).replace(".", ","));
      }
    },
    [isLoading, currentValue],
  );

  const parsed = parseBudgetInput(draft);
  // Mudança grande (>25%) pode devolver o conjunto/campanha à fase de aprendizado do Meta.
  const isBigChange = parsed !== null && currentValue > 0 && Math.abs(parsed - currentValue) / currentValue > 0.25;

  const handleSave = useCallback(async () => {
    if (parsed === null || isLoading) return;
    const minor = budgetValueToMinor(parsed, currency);
    const ok = await updateBudget(isDaily ? { daily_budget: minor } : { lifetime_budget: minor });
    if (ok) setOpen(false);
  }, [parsed, isLoading, currency, isDaily, updateBudget]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group/budget mx-auto flex items-baseline justify-center gap-1 rounded-md px-2 py-0.5 tabular-nums transition-colors hover:bg-secondary"
          title={titleHint}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Editar orçamento ${isDaily ? "diário" : "total"}`}
        >
          <span className="text-sm">{formatted}</span>
          <span className="text-xs text-muted-foreground">{isDaily ? "/dia" : "total"}</span>
          <IconPencil className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover/budget:opacity-100" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="center" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-3">
          <div className="text-sm font-medium text-text">{isDaily ? "Orçamento diário" : "Orçamento total (lifetime)"}</div>
          <div className="flex items-center gap-2">
            {symbol ? <span className="text-sm text-muted-foreground">{symbol}</span> : null}
            <Input
              size="sm"
              inputMode="decimal"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSave();
                if (e.key === "Escape") setOpen(false);
              }}
              disabled={isLoading}
              aria-label="Novo valor do orçamento"
            />
          </div>
          {isBigChange && (
            <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <IconAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Mudanças acima de ~25% podem devolver a entrega à fase de aprendizado do Meta.</span>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={isLoading}>
              Cancelar
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={isLoading || parsed === null || parsed === currentValue}>
              {isLoading ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Célula de orçamento das abas por-conjunto/por-campanha. Linha com budget próprio é
 * EDITÁVEL (popover); sem budget próprio mostra ONDE ele vive (CBO → campanha; ABO →
 * conjuntos); tudo NULL (pré-backfill da migration 091) mostra "—".
 */
export function BudgetCell({ original, currentTab }: BudgetCellProps) {
  const formatCurrency = useFormatCurrency();
  const daily = original.budget_daily ?? null;
  const lifetime = original.budget_lifetime ?? null;
  const mode = original.budget_mode ?? null;
  const currency = original.budget_currency ?? null;

  const { entityType, entityId } = useMemo(() => {
    if (currentTab === "por-conjunto") {
      return { entityType: "adset" as BudgetEntityType, entityId: String(original.adset_id || "").trim() };
    }
    return { entityType: "campaign" as BudgetEntityType, entityId: String(original.campaign_id || "").trim() };
  }, [currentTab, original]);

  const minor = daily ?? lifetime;
  if (minor !== null) {
    const value = budgetMinorToValue(minor, currency);
    const formatted = currency
      ? formatCurrency(value, currency)
      : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
    const isShared = currentTab === "por-conjunto" && mode === "abo_shared";
    const titleHint = isShared
      ? "Orçamento do conjunto com compartilhamento ativo: a Meta pode mover até 20% entre conjuntos da campanha. Clique para editar."
      : daily !== null
        ? "Orçamento diário — clique para editar"
        : "Orçamento total (lifetime) — clique para editar";

    if (!entityId) {
      // Sem id da própria entidade não há o que editar — cai no display puro.
      return (
        <div className={cn("flex w-full items-baseline justify-center gap-1 tabular-nums")} title={titleHint}>
          <span className="text-sm">{formatted}</span>
          <span className="text-xs text-muted-foreground">{daily !== null ? "/dia" : "total"}</span>
        </div>
      );
    }

    return (
      <div className="flex w-full justify-center" onClick={(e) => e.stopPropagation()}>
        <BudgetEditor
          entityType={entityType}
          entityId={entityId}
          currentMinor={minor}
          isDaily={daily !== null}
          currency={currency}
          formatted={formatted}
          titleHint={titleHint}
        />
      </div>
    );
  }

  if (currentTab === "por-conjunto" && mode === "cbo") {
    return (
      <div
        className="flex w-full justify-center text-xs text-muted-foreground"
        title="Orçamento definido na campanha (Advantage Campaign Budget / CBO)"
      >
        na campanha
      </div>
    );
  }

  if (currentTab === "por-campanha" && (mode === "abo" || mode === "abo_shared")) {
    return (
      <div
        className="flex w-full justify-center text-xs text-muted-foreground"
        title={
          mode === "abo_shared"
            ? "Orçamento definido nos conjuntos, com compartilhamento de até 20% entre eles"
            : "Orçamento definido nos conjuntos (ABO)"
        }
      >
        nos conjuntos
      </div>
    );
  }

  // Sem snapshot ainda (backfill acontece no próximo refresh/sync do pack)
  return <div className="flex w-full justify-center text-muted-foreground">—</div>;
}

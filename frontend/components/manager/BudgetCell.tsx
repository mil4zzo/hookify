"use client";

import React, { useCallback, useMemo, useState } from "react";
import { IconAlertTriangle, IconPencil, IconSquareCheck } from "@tabler/icons-react";
import type { RankingsItem } from "@/lib/api/schemas";
import { useFormatCurrency, getCurrencySymbol } from "@/lib/utils/currency";
import { budgetMinorToValue, budgetValueToMinor, formatBudgetTotals, type BudgetTotals, type ManagerBudgetTotals } from "@/lib/manager/budget";
import { useBudgetControl, type BudgetEntityType } from "@/lib/hooks/useBudgetControl";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Soma dos orçamentos abaixo do título da coluna — o par do "gasto total" que já aparece
 * sob o Spend. Diferença importante: o Spend é o que JÁ saiu no período; isto é o que está
 * programado para sair (por dia, no caso do orçamento diário) se nada mudar.
 *
 * Como a soma só cobre as linhas com orçamento PRÓPRIO, o tooltip diz quantas ficaram de
 * fora (campanha ABO tem o orçamento nos conjuntos; conjunto CBO tem na campanha) — um
 * número que ignorasse isso em silêncio pareceria "investimento total" e não seria.
 */
function BudgetTotalLine({
  totals,
  formatCurrency,
  elsewhereHint,
  tooltipTitle,
  minimal,
  emphasis,
  icon,
}: {
  totals: BudgetTotals;
  formatCurrency: (value: number, currency?: string) => string;
  elsewhereHint: string;
  tooltipTitle: string;
  minimal: boolean;
  emphasis: boolean;
  icon?: React.ReactNode;
}) {
  const text = formatBudgetTotals(totals, formatCurrency);
  if (!text) return null;

  const textSize = minimal ? "text-2xs" : "text-xs";
  const leading = minimal ? "leading-none" : "";
  const tone = emphasis ? "text-primary font-semibold" : "text-muted-foreground font-normal";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`${textSize} ${tone} flex items-center gap-0.5 cursor-help whitespace-nowrap ${leading}`}>
            {icon}
            {text}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs">{tooltipTitle}</p>
          {totals.withoutBudget > 0 && (
            <p className="text-xs text-muted-foreground">
              {totals.withoutBudget} {totals.withoutBudget === 1 ? "linha" : "linhas"} com orçamento {elsewhereHint} não entram na soma.
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Bloco do header: soma da aba inteira e, quando há recorte ativo, a soma do recorte —
 * mesma gramática das colunas de métrica (régua em cinza, recorte em destaque, seleção
 * ganhando do filtro).
 */
export function BudgetHeaderTotals({
  totals,
  currentTab,
  minimal,
}: {
  totals: ManagerBudgetTotals;
  currentTab: "por-conjunto" | "por-campanha";
  minimal: boolean;
}) {
  const formatCurrency = useFormatCurrency();
  const entityPlural = currentTab === "por-campanha" ? "campanhas" : "conjuntos";
  const elsewhereHint = currentTab === "por-campanha" ? "definido nos conjuntos" : "definido na campanha";

  return (
    <>
      {totals.base && (
        <BudgetTotalLine
          totals={totals.base}
          formatCurrency={formatCurrency}
          elsewhereHint={elsewhereHint}
          tooltipTitle={`Soma dos orçamentos de ${totals.base.withBudget} ${entityPlural}`}
          minimal={minimal}
          emphasis={false}
        />
      )}
      {totals.subset && (
        <BudgetTotalLine
          totals={totals.subset.totals}
          formatCurrency={formatCurrency}
          elsewhereHint={elsewhereHint}
          tooltipTitle={
            totals.subset.kind === "selection"
              ? `Soma dos orçamentos de ${totals.subset.totals.withBudget} dos ${totals.subset.count} selecionados`
              : `Soma dos orçamentos de ${totals.subset.totals.withBudget} ${entityPlural} filtrados`
          }
          minimal={minimal}
          emphasis
          icon={totals.subset.kind === "selection" ? <IconSquareCheck className="h-3 w-3 shrink-0" /> : undefined}
        />
      )}
    </>
  );
}

interface BudgetCellProps {
  original: RankingsItem;
  currentTab: "por-conjunto" | "por-campanha";
  /** Packs do contexto — habilita escrita em pack COMPARTILHADO (silo do dono). */
  packIds?: string[];
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
  packIds?: string[];
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
function BudgetEditor({ entityType, entityId, packIds, currentMinor, isDaily, currency, formatted, titleHint }: BudgetEditorProps) {
  const { updateBudget, isLoading } = useBudgetControl({ entityType, entityId, packIds });
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
          className="group/budget mx-auto flex flex-col items-end justify-center gap-0 rounded-md px-2 py-0.5 tabular-nums transition-colors hover:bg-secondary"
          title={titleHint}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Editar orçamento ${isDaily ? "diário" : "total"}`}
        >
          <span className="flex items-center gap-1">
            <IconPencil className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover/budget:opacity-100" />
            <span className="text-sm">{formatted}</span>
          </span>
          <span className="text-xs leading-none text-muted-foreground">{isDaily ? "Diário" : "Total"}</span>
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
export function BudgetCell({ original, currentTab, packIds }: BudgetCellProps) {
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
        <div className="flex w-full justify-center" title={titleHint}>
          <div className="flex flex-col items-end gap-0 tabular-nums">
            <span className="text-sm">{formatted}</span>
            <span className="text-xs leading-none text-muted-foreground">{daily !== null ? "Diário" : "Total"}</span>
          </div>
        </div>
      );
    }

    return (
      <div className="flex w-full justify-center" onClick={(e) => e.stopPropagation()}>
        <BudgetEditor
          entityType={entityType}
          entityId={entityId}
          packIds={packIds}
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

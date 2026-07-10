"use client";

import React from "react";
import type { RankingsItem } from "@/lib/api/schemas";
import { useFormatCurrency } from "@/lib/utils/currency";

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

/** Budget efetivo da linha para ordenação: daily ?? lifetime (subunidade; null = sem budget próprio). */
export function getRowBudgetMinor(row: RankingsItem): number | null {
  return row.budget_daily ?? row.budget_lifetime ?? null;
}

interface BudgetCellProps {
  original: RankingsItem;
  currentTab: "por-conjunto" | "por-campanha";
}

/**
 * Célula de orçamento (read-only) das abas por-conjunto/por-campanha.
 * Linha sem budget próprio mostra ONDE ele vive (CBO → campanha; ABO → conjuntos);
 * tudo NULL (pré-backfill da migration 091) mostra "—".
 */
export function BudgetCell({ original, currentTab }: BudgetCellProps) {
  const formatCurrency = useFormatCurrency();
  const daily = original.budget_daily ?? null;
  const lifetime = original.budget_lifetime ?? null;
  const mode = original.budget_mode ?? null;
  const currency = original.budget_currency ?? null;

  const minor = daily ?? lifetime;
  if (minor !== null) {
    const value = budgetMinorToValue(minor, currency);
    const formatted = currency
      ? formatCurrency(value, currency)
      : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
    const isShared = currentTab === "por-conjunto" && mode === "abo_shared";
    return (
      <div
        className="flex w-full items-baseline justify-center gap-1 tabular-nums"
        title={
          isShared
            ? "Orçamento do conjunto com compartilhamento ativo: a Meta pode mover até 20% entre conjuntos da campanha"
            : daily !== null
              ? "Orçamento diário"
              : "Orçamento total (lifetime)"
        }
      >
        <span className="text-sm">{formatted}</span>
        <span className="text-xs text-muted-foreground">{daily !== null ? "/dia" : "total"}</span>
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

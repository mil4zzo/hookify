"use client";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { PackHealth, PackHealthState } from "@/lib/hooks/usePacksHealth";

// Regra do design (packs-hangar-design.md): gamificar a LEITURA — anel/estado aceleram
// a percepção, mas o NÚMERO (CPR) aparece sempre junto. Cores só via tokens semânticos.
const STATE_META: Record<PackHealthState, { label: string; emoji: string; ringClass: string; textClass: string }> = {
  escalando:        { label: "Escalando",       emoji: "🔥", ringClass: "stroke-success",          textClass: "text-success" },
  estavel:          { label: "Estável",         emoji: "⚖️", ringClass: "stroke-attention",        textClass: "text-attention" },
  sangrando:        { label: "Sangrando",       emoji: "🩸", ringClass: "stroke-destructive",      textClass: "text-destructive" },
  "sem-alvo":       { label: "Sem alvo",        emoji: "🎯", ringClass: "stroke-muted-foreground", textClass: "text-muted-foreground" },
  "sem-entrega":    { label: "Sem entrega",     emoji: "⏸",  ringClass: "stroke-muted-foreground", textClass: "text-muted-foreground" },
  "fora-do-periodo":{ label: "Fora do período", emoji: "🗓",  ringClass: "stroke-muted-foreground", textClass: "text-muted-foreground" },
};

interface PackHealthBadgeProps {
  health: PackHealth;
  formatCurrency: (value: number) => string;
  windowDays: number;
  actionType?: string | null;
}

/**
 * Health ring (SVG) + estado nomeado + CPR numérico da janela de saúde.
 * O anel preenche por healthPct (100 = folga total vs alvo; 50 = no alvo; 0 = 2× alvo).
 */
export function PackHealthBadge({ health, formatCurrency, windowDays, actionType }: PackHealthBadgeProps) {
  const meta = STATE_META[health.state];
  const pct = health.healthPct;

  const R = 20;
  const C = 2 * Math.PI * R;
  const filled = pct != null ? (pct / 100) * C : 0;

  const tooltip = (() => {
    const lines: string[] = [`Últimos ${windowDays} dias${actionType ? ` · ${actionType}` : ""}`];
    lines.push(`Spend: ${formatCurrency(health.spend)}`);
    lines.push(`Resultados: ${health.results}`);
    if (health.cpr != null) lines.push(`CPR: ${formatCurrency(health.cpr)}`);
    if (health.ratioToTarget != null) lines.push(`${Math.round(health.ratioToTarget * 100)}% do custo-alvo`);
    if (health.state === "sem-alvo") lines.push("Defina um custo-alvo no /plano para ativar a saúde.");
    if (health.state === "fora-do-periodo") lines.push("Período do pack anterior à janela de saúde.");
    return lines;
  })();

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-3 cursor-default">
            {/* Ring com número dentro */}
            <div className="relative w-12 h-12 flex-shrink-0">
              <svg viewBox="0 0 48 48" className="w-12 h-12 -rotate-90">
                <circle cx="24" cy="24" r={R} fill="none" strokeWidth="4" className="stroke-border" />
                {pct != null && (
                  <circle
                    cx="24" cy="24" r={R} fill="none" strokeWidth="4" strokeLinecap="round"
                    strokeDasharray={`${filled} ${C - filled}`}
                    className={`${meta.ringClass} transition-[stroke-dasharray] duration-700 ease-out`}
                  />
                )}
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={`text-[11px] font-bold ${meta.textClass}`}>{pct != null ? pct : meta.emoji}</span>
              </div>
            </div>
            {/* Estado nomeado + número SEMPRE junto */}
            <div className="flex flex-col items-start min-w-0">
              <span className={`text-sm font-semibold leading-tight ${meta.textClass}`}>
                {meta.emoji} {meta.label}
              </span>
              <span className="text-xs text-muted-foreground leading-tight">
                {health.cpr != null ? `CPR ${formatCurrency(health.cpr)} · ${windowDays}d` : `${formatCurrency(health.spend)} · ${windowDays}d`}
              </span>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {tooltip.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

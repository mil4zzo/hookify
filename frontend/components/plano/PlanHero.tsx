"use client";

import { useState, useMemo, useCallback } from "react";
import { StandardCard } from "@/components/common/StandardCard";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  IconPencil,
  IconCheck,
  IconX,
  IconTrendingUp,
  IconTarget,
  IconSchool,
  IconPlayerPauseFilled,
  IconTrophy,
  IconAlertTriangle,
  IconChartBarOff,
  IconChevronDown,
  IconChevronUp,
} from "@tabler/icons-react";
import { getMetricValueTextClass } from "@/lib/utils/metricQuality";
import { useFormatCurrency } from "@/lib/utils/currency";
import type { ActionPlan, ActionItem, Verdict } from "@/lib/utils/actionPlan";
import type { DiagnosticSummaryResult } from "@/lib/metrics/diagnostics";

// ─── Types ────────────────────────────────────────────────────────────────────

type HeroState = "oportunidade" | "saudavel" | "dados-finos" | "so-pausar";

interface ChipMeta {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  chipClass: string;
}

const CHIP_META: Record<Exclude<Verdict, "observar">, ChipMeta> = {
  gem:      { label: "Escalar",  icon: IconTrendingUp,        chipClass: "text-success bg-success-10 border-success-30 hover:bg-success-20" },
  otimizar: { label: "Otimizar", icon: IconTarget,            chipClass: "text-attention bg-attention-10 border-attention-30 hover:bg-attention-20" },
  licao:    { label: "Aprender", icon: IconSchool,            chipClass: "text-warning bg-warning-10 border-warning-30 hover:bg-warning-20" },
  descartar:{ label: "Pausar",   icon: IconPlayerPauseFilled, chipClass: "text-destructive bg-destructive-10 border-destructive-30 hover:bg-destructive-20" },
};

const CHIP_ORDER: Exclude<Verdict, "observar">[] = ["gem", "otimizar", "licao", "descartar"];

export interface PlanHeroProps {
  actionPlan: ActionPlan;
  actionType: string;
  // Target CPR (absorbed from old card)
  currentTarget?: number;
  isSaving: boolean;
  onSaveTarget: (val?: number) => Promise<void>;
  // Diagnostic integration
  summary: DiagnosticSummaryResult | null;
  minVolumeOk: boolean;
  showDiagnostic: boolean;
  onToggleDiagnostic: () => void;
  // Chip click → scroll + expand verdict group in the list below
  onChipClick: (verdict: Verdict) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PlanHero({
  actionPlan,
  actionType,
  currentTarget,
  isSaving,
  onSaveTarget,
  summary,
  minVolumeOk,
  showDiagnostic,
  onToggleDiagnostic,
  onChipClick,
}: PlanHeroProps) {
  const formatCurrency = useFormatCurrency();
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput, setTargetInput] = useState("");

  // ─── Derived state ──────────────────────────────────────────────────────────

  const { heroState, economiaPotencial, totalInvested, notLowDataCount, piorSangramento, gemCount } =
    useMemo(() => {
      const gems = actionPlan.gem;
      const otimizar = actionPlan.otimizar;
      const licao = actionPlan.licao;
      const descartar = actionPlan.descartar;

      const gemCount = gems.length;
      const hasActions = otimizar.length > 0 || descartar.length > 0;

      // Dados-finos: diagnostic says volume is low
      if (!minVolumeOk && (otimizar.length > 0 || descartar.length > 0)) {
        // Still show chips, but suppress the R$ protagonist
        // Fall through to hero state logic below
      }

      // Saudável: nothing to fix, only gems (or truly empty)
      if (!hasActions && gemCount > 0) {
        return {
          heroState: "saudavel" as HeroState,
          economiaPotencial: 0,
          totalInvested: 0,
          notLowDataCount: 0,
          piorSangramento: null,
          gemCount,
        };
      }

      // Só-pausar: only things to pause, nothing salvageable
      if (descartar.length > 0 && otimizar.length === 0 && licao.length === 0 && gemCount === 0) {
        const pior = descartar.reduce<ActionItem | null>((worst, i) => {
          if (!worst) return i;
          return Number((i.ad as any).spend ?? 0) > Number((worst.ad as any).spend ?? 0) ? i : worst;
        }, null);
        return {
          heroState: "so-pausar" as HeroState,
          economiaPotencial: 0,
          totalInvested: 0,
          notLowDataCount: 0,
          piorSangramento: pior,
          gemCount,
        };
      }

      // Check data confidence for R$ protagonist
      const confidentItems = otimizar.filter((i) => !i.lowData);
      const fracaoLowData = otimizar.length > 0 ? 1 - confidentItems.length / otimizar.length : 0;

      if (!minVolumeOk || fracaoLowData >= 0.7) {
        return {
          heroState: "dados-finos" as HeroState,
          economiaPotencial: 0,
          totalInvested: 0,
          notLowDataCount: confidentItems.length,
          piorSangramento: null,
          gemCount,
        };
      }

      const economia = confidentItems
        .filter((i) => Number.isFinite(i.impactSavings ?? NaN) && (i.impactSavings ?? 0) > 0)
        .reduce((sum, i) => sum + (i.impactSavings ?? 0), 0);

      const invested = confidentItems.reduce(
        (sum, i) => sum + Number((i.ad as any).spend ?? 0),
        0,
      );

      return {
        heroState: "oportunidade" as HeroState,
        economiaPotencial: economia,
        totalInvested: invested,
        notLowDataCount: confidentItems.length,
        piorSangramento: null,
        gemCount,
      };
    }, [actionPlan, minVolumeOk]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleSaveTarget = useCallback(async () => {
    const val = parseFloat(targetInput.replace(",", "."));
    await onSaveTarget(!isNaN(val) && val > 0 ? val : undefined);
    setEditingTarget(false);
  }, [targetInput, onSaveTarget]);

  const handleClearTarget = useCallback(async () => {
    await onSaveTarget(undefined);
  }, [onSaveTarget]);

  const handleChipClick = useCallback(
    (verdict: Verdict) => {
      onChipClick(verdict);
      setTimeout(() => {
        document
          .getElementById(`plan-section-${verdict}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    },
    [onChipClick],
  );

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <TooltipProvider>
      <StandardCard variant="default" padding="md" className="flex flex-col gap-4 overflow-visible">

        {/* ── State-specific content ─────────────────────────────────────── */}
        {heroState === "oportunidade" && economiaPotencial > 0 && (
          <div className="flex flex-col gap-0.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Você pode recuperar até
            </p>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-4xl font-black tracking-tight text-foreground">
                {formatCurrency(economiaPotencial)}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors">
                    como calculamos?
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
                  Estimamos o ganho de elevar cada métrica abaixo da média do pack até a média,
                  mantendo o gasto constante. É um potencial modelado — o resultado real depende
                  de testes e ajustes criativos.
                </TooltipContent>
              </Tooltip>
            </div>
            <p className="text-xs text-muted-foreground">
              de {formatCurrency(totalInvested)} investido
              {notLowDataCount > 0 && (
                <> em {notLowDataCount} anúncio{notLowDataCount !== 1 ? "s" : ""}</>
              )}
            </p>
          </div>
        )}

        {heroState === "oportunidade" && economiaPotencial <= 0 && (
          <div className="flex items-center gap-3">
            <IconTarget className="h-8 w-8 text-attention flex-shrink-0" />
            <div>
              <p className="font-semibold text-foreground">Há anúncios para otimizar</p>
              <p className="text-xs text-muted-foreground">Veja as alavancas abaixo para melhorar o CPR</p>
            </div>
          </div>
        )}

        {heroState === "saudavel" && (
          <div className="flex items-center gap-3">
            <IconTrophy className="h-8 w-8 text-success flex-shrink-0" />
            <div>
              <p className="font-semibold text-foreground">Pack em boa forma!</p>
              <p className="text-xs text-muted-foreground">
                {gemCount} anúncio{gemCount !== 1 ? "s" : ""} escalando — foque em expandir o orçamento
              </p>
            </div>
          </div>
        )}

        {heroState === "dados-finos" && (
          <div className="flex items-center gap-3">
            <IconChartBarOff className="h-7 w-7 text-muted-foreground flex-shrink-0" />
            <div>
              <p className="font-semibold text-foreground">Volume insuficiente</p>
              <p className="text-xs text-muted-foreground">
                Aguarde mais impressões para estimar o impacto com confiança
              </p>
            </div>
          </div>
        )}

        {heroState === "so-pausar" && (
          <div className="flex items-center gap-3">
            <IconAlertTriangle className="h-7 w-7 text-destructive flex-shrink-0" />
            <div>
              <p className="font-semibold text-foreground">Gasto sem retorno</p>
              {piorSangramento ? (
                <p className="text-xs text-muted-foreground">
                  Principal sangria: {formatCurrency(Number((piorSangramento.ad as any).spend ?? 0))} em{" "}
                  &ldquo;{(piorSangramento.ad as any).ad_name ?? "anúncio"}&rdquo;
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Pause os anúncios abaixo para estancar o gasto</p>
              )}
            </div>
          </div>
        )}

        {/* ── Verdict chips ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap">
          {CHIP_ORDER.map((verdict) => {
            const count = actionPlan[verdict].length;
            if (count === 0) return null;
            const { label, icon: Icon, chipClass } = CHIP_META[verdict];
            return (
              <button
                key={verdict}
                onClick={() => handleChipClick(verdict)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-sm font-semibold transition-colors ${chipClass}`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
                <span className="opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        {/* ── Target CPR ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap border-t border-border pt-3">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <span className="text-xs text-muted-foreground">
              Custo-alvo <span className="font-medium text-foreground">{actionType}</span>:
            </span>
            {currentTarget ? (
              <span className="text-sm font-bold text-foreground">{formatCurrency(currentTarget)}</span>
            ) : (
              <span className="text-xs text-muted-foreground italic">(modo relativo)</span>
            )}
          </div>

          {editingTarget ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">R$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                autoFocus
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveTarget();
                  if (e.key === "Escape") setEditingTarget(false);
                }}
                placeholder="ex: 15,00"
                className="w-28 text-sm border border-border rounded-md px-2 py-1 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={handleSaveTarget}
                disabled={isSaving}
                className="p-1 rounded hover:bg-success-10 text-success transition-colors"
              >
                <IconCheck className="h-4 w-4" />
              </button>
              <button
                onClick={() => setEditingTarget(false)}
                className="p-1 rounded hover:bg-muted-30 text-muted-foreground transition-colors"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setTargetInput(currentTarget ? String(currentTarget) : "");
                  setEditingTarget(true);
                }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted-30"
              >
                <IconPencil className="h-3.5 w-3.5" />
                {currentTarget ? "Editar alvo" : "Definir alvo"}
              </button>
              {currentTarget && (
                <button
                  onClick={handleClearTarget}
                  disabled={isSaving}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors px-2 py-1 rounded hover:bg-muted-30"
                >
                  Remover
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Momentum + diagnostic toggle ───────────────────────────────── */}
        {summary && (
          <div className="flex items-start justify-between gap-3 border-t border-border pt-3">
            <p
              className={`text-xs leading-relaxed flex-1 ${
                summary.muted ? "text-muted-foreground" : getMetricValueTextClass(summary.tone)
              }`}
            >
              {summary.headline}
            </p>
            <button
              onClick={onToggleDiagnostic}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap flex-shrink-0"
            >
              {showDiagnostic ? (
                <>fechar <IconChevronUp className="h-3.5 w-3.5" /></>
              ) : (
                <>ver diagnóstico <IconChevronDown className="h-3.5 w-3.5" /></>
              )}
            </button>
          </div>
        )}

      </StandardCard>
    </TooltipProvider>
  );
}

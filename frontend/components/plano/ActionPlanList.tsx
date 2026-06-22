"use client";

import { useState } from "react";
import type { ActionPlan, Verdict } from "@/lib/utils/actionPlan";
import type { RankingsResponse } from "@/lib/api/schemas";
import { ActionPlanRow } from "./ActionPlanRow";
import {
  IconChevronDown,
  IconChevronRight,
  IconTrendingUp,
  IconTarget,
  IconSchool,
  IconPlayerPauseFilled,
  IconEye,
} from "@tabler/icons-react";

const VERDICT_META: Record<Verdict, { label: string; description: string; icon: React.ComponentType<{ className?: string }>; chipClass: string }> = {
  gem:      { label: "Escalar",  description: "Custo abaixo do alvo e todas as métricas acima da média", icon: IconTrendingUp,        chipClass: "text-success bg-success-10 border-success-30" },
  otimizar: { label: "Otimizar", description: "Custo ok, mas há métricas com margem de melhoria",        icon: IconTarget,            chipClass: "text-attention bg-attention-10 border-attention-30" },
  licao:    { label: "Aprender", description: "Custo alto, mas há elemento forte para reciclar",          icon: IconSchool,            chipClass: "text-warning bg-warning-10 border-warning-30" },
  descartar:{ label: "Pausar",   description: "Custo alto e nenhuma métrica se destaca",                  icon: IconPlayerPauseFilled, chipClass: "text-destructive bg-destructive-10 border-destructive-30" },
  observar: { label: "Observar", description: "Dados insuficientes ou critérios de validação não atingidos", icon: IconEye,          chipClass: "text-muted-foreground bg-muted-30 border-border" },
};

const VERDICT_ORDER: Verdict[] = ["gem", "otimizar", "licao", "descartar", "observar"];

type ActionPlanListProps = {
  plan: ActionPlan;
  averages?: RankingsResponse["averages"];
  actionType: string;
  dateStart?: string;
  dateStop?: string;
  packIds?: string[];
  availableConversionTypes?: string[];
};

export function ActionPlanList({
  plan,
  averages,
  actionType,
  dateStart,
  dateStop,
  packIds,
  availableConversionTypes,
}: ActionPlanListProps) {
  const [collapsed, setCollapsed] = useState<Partial<Record<Verdict, boolean>>>({ observar: true });

  const toggle = (verdict: Verdict) => setCollapsed((prev) => ({ ...prev, [verdict]: !prev[verdict] }));

  const totalActions = (["gem", "otimizar", "licao", "descartar"] as Verdict[]).reduce(
    (sum, v) => sum + plan[v].length,
    0
  );

  if (totalActions === 0 && plan.observar.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground text-sm">
        Nenhum anúncio encontrado para gerar o plano de ação.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {VERDICT_ORDER.map((verdict) => {
        const items = plan[verdict];
        if (items.length === 0) return null;

        const { label, description, icon: Icon, chipClass } = VERDICT_META[verdict];
        const isCollapsed = collapsed[verdict] ?? false;

        return (
          <div key={verdict}>
            <button
              className="w-full flex items-center gap-3 py-3 px-1 text-left hover:opacity-80 transition-opacity group"
              onClick={() => toggle(verdict)}
              aria-expanded={!isCollapsed}
            >
              <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-sm font-semibold ${chipClass}`}>
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
              </div>
              <span className="text-sm text-muted-foreground font-medium">
                {items.length} anúncio{items.length !== 1 ? "s" : ""}
              </span>
              <span className="text-xs text-muted-foreground hidden sm:inline">{description}</span>
              <span className="ml-auto text-muted-foreground">
                {isCollapsed ? <IconChevronRight className="h-4 w-4" /> : <IconChevronDown className="h-4 w-4" />}
              </span>
            </button>

            {!isCollapsed && (
              <div className="flex flex-col gap-2 pb-4">
                {items.map((item, idx) => (
                  <ActionPlanRow
                    key={(item.ad as any).ad_id || (item.ad as any).ad_name || idx}
                    item={item}
                    averages={averages}
                    actionType={actionType}
                    dateStart={dateStart}
                    dateStop={dateStop}
                    packIds={packIds}
                    availableConversionTypes={availableConversionTypes}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

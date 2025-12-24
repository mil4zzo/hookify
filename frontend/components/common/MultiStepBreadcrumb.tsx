"use client";

import { IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";

export type StepStatus = "pending" | "active" | "completed";

export interface Step {
  id: string | number;
  label: string;
  description?: string;
  status?: StepStatus;
  disabled?: boolean;
}

export interface MultiStepBreadcrumbProps {
  steps: Step[];
  currentStepId: string | number;
  variant?: "simple" | "visual";
  className?: string;
  onStepClick?: (stepId: string | number) => void;
}

/**
 * Componente de breadcrumb para formulários multi-step
 *
 * @example
 * // Estilo simples (texto com separadores)
 * <MultiStepBreadcrumb
 *   steps={[
 *     { id: 1, label: "Conectar Facebook" },
 *     { id: 2, label: "Critério de validação" },
 *     { id: 3, label: "Carregar Pack" }
 *   ]}
 *   currentStepId={2}
 *   variant="simple"
 * />
 *
 * @example
 * // Estilo visual (círculos numerados com checkmarks)
 * <MultiStepBreadcrumb
 *   steps={[
 *     { id: "connect", label: "Conectar Google", description: "Conta Google" },
 *     { id: "select-sheet", label: "Selecionar planilha" },
 *     { id: "select-columns", label: "Selecionar colunas" }
 *   ]}
 *   currentStepId="select-sheet"
 *   variant="visual"
 * />
 */
export function MultiStepBreadcrumb({ steps, currentStepId, variant = "simple", className, onStepClick }: MultiStepBreadcrumbProps) {
  const getStepStatus = (step: Step, index: number): StepStatus => {
    if (step.status) return step.status;

    const currentIndex = steps.findIndex((s) => s.id === currentStepId);

    if (index < currentIndex) return "completed";
    if (index === currentIndex) return "active";
    return "pending";
  };

  if (variant === "visual") {
    return (
      <div className={cn("flex items-start pb-4 border-b border-border relative", className)}>
        {steps.map((step, index) => {
          const status = getStepStatus(step, index);
          const isCompleted = status === "completed";
          const isActive = status === "active";
          const isDisabled = step.disabled === true;
          // Steps são navegáveis quando onStepClick é fornecido e não estão desabilitados
          const isClickable = !!onStepClick && !isDisabled;
          // A linha conectora é verde apenas se o step atual está completo (já foi passado)
          // Isso garante que apenas conectores anteriores ao step selecionado sejam verdes
          const connectorIsGreen = isCompleted;

          return (
            <div key={step.id} className="flex flex-col items-center gap-2 flex-1 min-w-0 relative">
              {/* Wrapper do step (clicável) */}
              <div className={cn("flex flex-col items-center gap-2 w-full transition-opacity", isClickable && "cursor-pointer hover:opacity-80", isDisabled && "cursor-not-allowed opacity-50")} onClick={() => isClickable && onStepClick?.(step.id)}>
                {/* Círculo do step */}
                <div className={cn("flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all duration-200 flex-shrink-0 relative z-10", isCompleted ? "bg-green-500 border-green-500 text-white" : isActive ? "bg-primary border-primary text-white" : "bg-background border-border text-muted-foreground")}>{isCompleted ? <IconCheck className="w-5 h-5" /> : <span className="text-sm font-semibold">{index + 1}</span>}</div>

                {/* Label */}
                <div className="text-center min-w-0 w-full">
                  <div className={cn("text-sm font-medium transition-colors", isCompleted ? "text-green-500" : isActive ? "text-primary" : "text-muted-foreground")}>{step.label}</div>
                  {step.description && (
                    <div className="text-xs text-muted-foreground mt-0.5 truncate" title={step.description}>
                      {step.description}
                    </div>
                  )}
                </div>
              </div>

              {/* Linha conectora (exceto no último step) - conecta da borda direita deste círculo até a borda esquerda do próximo */}
              {index < steps.length - 1 && (
                <div className="absolute top-5 h-0.5 pointer-events-none z-0" style={{ left: "calc(50% + 20px)", right: "calc(-50% + 20px)" }}>
                  <div className={cn("h-full transition-all duration-200", connectorIsGreen ? "bg-green-500" : "bg-border")} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Variante simples (texto com separadores)
  return (
    <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
      {steps.map((step, index) => {
        const status = getStepStatus(step, index);
        const isActive = status === "active";
        const isDisabled = step.disabled === true;
        // Steps são navegáveis quando onStepClick é fornecido e não estão desabilitados
        const isClickable = !!onStepClick && !isDisabled;

        return (
          <div key={step.id} className="flex items-center gap-2">
            <span className={cn("transition-colors", isActive && "font-semibold text-foreground", isClickable && "cursor-pointer hover:text-foreground", isDisabled && "cursor-not-allowed opacity-50")} onClick={() => isClickable && onStepClick?.(step.id)}>
              {index + 1}. {step.label}
            </span>
            {index < steps.length - 1 && <span>·</span>}
          </div>
        );
      })}
    </div>
  );
}

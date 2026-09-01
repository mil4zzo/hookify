"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface TriStateToggleOption<T extends string> {
  value: T;
  /** Texto exibido ao lado do trilho quando esta posição está ativa. */
  label: string;
  /** Linha curta explicando o que a posição faz — some quando não informada. */
  hint?: string;
}

export interface TriStateToggleProps<T extends string> {
  id: string;
  value: T;
  /** Da esquerda para a direita: posição 0, 1 e 2 do trilho. */
  options: readonly [TriStateToggleOption<T>, TriStateToggleOption<T>, TriStateToggleOption<T>];
  onValueChange: (value: T) => void;
  /** Nome do grupo para leitor de tela (o label visível muda conforme a posição). */
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}

// Mesma métrica do Switch (h-6 w-11 com borda de 2px → caixa interna de 40px, thumb de
// 20px): o curso total é de 20px, então as três paradas caem em 0 / 10 / 20px, que são
// translate-x-0, translate-x-2.5 e translate-x-5. No meio, o thumb fica exatamente
// centrado — a posição se lê pela borda de trilho que sobra dos dois lados.
const THUMB_TRANSLATE = ["translate-x-0", "translate-x-2.5", "translate-x-5"] as const;
// Cores distintas por posição (não graus de opacidade da mesma cor): cinza do "desligado",
// roxo do intermediário (chart-4, o único tom fora da família semântica bom/ruim — usar
// success/destructive aqui sugeriria julgamento que a posição não tem) e azul da marca.
const TRACK_TONE = ["bg-input", "bg-chart-4", "bg-brand"] as const;

/**
 * Toggle de três posições (esquerda / centro / direita) com label que muda conforme
 * a posição ativa. Do mesmo tamanho do ToggleSwitch — o que muda é o knob parar no
 * meio do trilho e a cor do trilho ser própria de cada posição.
 *
 * Clique avança para a próxima posição e volta ao início depois da última (o trilho é
 * pequeno demais para acertar três zonas de clique); as setas do teclado vão direto
 * para a posição vizinha.
 *
 * @example
 * <TriStateToggle
 *   id="cell-mode"
 *   value={mode}
 *   onValueChange={setMode}
 *   ariaLabel="Conteúdo das células"
 *   options={[
 *     { value: "value", label: "Só o valor" },
 *     { value: "delta", label: "Variação" },
 *     { value: "trend", label: "Tendência" },
 *   ]}
 * />
 */
export function TriStateToggle<T extends string>({ id, value, options, onValueChange, ariaLabel, disabled = false, className }: TriStateToggleProps<T>) {
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const active = options[activeIndex];

  const goTo = (index: number) => {
    if (disabled) return;
    const next = options[Math.min(options.length - 1, Math.max(0, index))];
    if (next && next.value !== value) onValueChange(next.value);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const delta = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    goTo(activeIndex + delta);
  };

  return (
    <div
      className={cn("flex items-start gap-2", className)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={activeIndex > 0}
        aria-label={`${ariaLabel}: ${active.label}`}
        disabled={disabled}
        onClick={() => goTo((activeIndex + 1) % options.length)}
        onKeyDown={handleKeyDown}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
          TRACK_TONE[activeIndex],
        )}
      >
        <span aria-hidden className={cn("pointer-events-none block h-5 w-5 rounded-full bg-background shadow-elevation-overlay transition-transform", THUMB_TRANSLATE[activeIndex])} />
      </button>

      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-medium leading-none">{active.label}</span>
        {active.hint && <span className="text-2xs leading-tight text-muted-foreground">{active.hint}</span>}
      </div>
    </div>
  );
}

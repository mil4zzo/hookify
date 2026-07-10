import { IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";

/**
 * Indicador visual de seleção ("quadradinho") para linhas/opções clicáveis.
 * NÃO é interativo — o alvo de clique é o container pai (evita interativo aninhado).
 * Para checkbox standalone com foco/teclado, use `ui/checkbox`.
 */
export function CheckSquare({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors", checked ? "bg-primary border-primary" : "border-border", className)}>
      {checked && <IconCheck className="h-3 w-3 text-primary-foreground" />}
    </div>
  );
}

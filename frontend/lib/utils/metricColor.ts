/**
 * Retorna a classe de cor Tailwind baseada na relação atual/média de uma métrica.
 * lowerIsBetter=true: menor é melhor (ex: CPR); false: maior é melhor (ex: CTR, Hook).
 */
export function getValueColor(current: number, average: number, lowerIsBetter = false): string {
  if (average <= 0) return "text-foreground";

  if (lowerIsBetter) {
    if (current <= average) return "text-success";
    const ratio = current / average;
    if (ratio <= 1.25) return "text-attention";
    if (ratio <= 1.5) return "text-warning";
    return "text-destructive";
  } else {
    if (current >= average) return "text-success";
    const ratio = current / average;
    if (ratio >= 0.75) return "text-attention";
    if (ratio >= 0.5) return "text-warning";
    return "text-destructive";
  }
}

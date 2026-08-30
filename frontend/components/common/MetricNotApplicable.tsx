"use client";

import React from "react";
import { IconPhoto } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";

/**
 * "Esta métrica não se aplica a este anúncio."
 *
 * Aparece no lugar do par sparkline+número quando uma métrica de vídeo cai numa
 * linha de IMAGEM. Não é o mesmo que o travessão: o travessão diz "não houve o
 * que medir no período" (CPR sem conversão) e pode virar número amanhã; isto diz
 * "este criativo não tem essa métrica", e não vai mudar.
 *
 * POR QUE UM ÍCONE, E NÃO UM SÍMBOLO MAIS DISCRETO
 *   Nada mais na linha revela o formato do anúncio — `AdNameCell` mostra
 *   miniatura, nome e "5 / 124 anúncios", e o microfone do canto significa "tem
 *   transcrição", não "é vídeo". Então a célula vazia é o único lugar onde o
 *   usuário consegue aprender o motivo. Um Ø apagado seria mais limpo e trocaria
 *   "por que 0%?" por "por que vazio?".
 *
 * ALTURA
 *   Ocupa a altura do par que substitui (sparkline 24 + gap 12 + número 16 = 52,
 *   ou 4 + 4 + 12 = 20 no modo minimal) para não desalinhar as linhas vizinhas —
 *   e centraliza de verdade, em vez de ficar no lugar do número.
 */
export function MetricNotApplicable({ minimal = false, className }: { minimal?: boolean; className?: string }) {
  return (
    <div
      // Altura = a do par que substitui, para não desalinhar as linhas vizinhas:
      // sparkline (h-6 = 24) + gap-3 (12) + número text-base leading-none (16) = 52.
      // No minimal: h-4 (16) + gap-1 (4) + text-xs leading-none (12) = 32 = h-8.
      className={cn("grid place-items-center text-muted-foreground-50", minimal ? "h-8" : "h-[52px]", className)}
      title="Anúncio de imagem — não tem métricas de vídeo"
      aria-label="Não se aplica: anúncio de imagem"
      role="img"
    >
      <IconPhoto className={minimal ? "h-3.5 w-3.5" : "h-5 w-5"} stroke={1.7} aria-hidden />
    </div>
  );
}

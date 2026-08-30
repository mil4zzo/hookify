/**
 * Tipos do Board — a lente de agrupamento de criativos.
 *
 * Um board tem grupos; um grupo tem uma REGRA (`RuleTree`, de `lib/rules/types`,
 * a mesma árvore que o Manager e o Critério usam). Quem está em cada grupo nunca é
 * persistido: é derivado das linhas do Manager a cada abertura, sobre o recorte
 * (packs + período) que estiver ativo no seletor global. Ver migration 119.
 *
 * Grupos NÃO são exclusivos entre si e não se enxergam: o mesmo criativo pode
 * aparecer em quantos grupos suas regras casarem. Foi decisão de produto — a
 * alternativa (primeiro match vence) transformaria a ordem dos grupos em regra
 * escondida, e o usuário perderia a interseção, que é justamente o que permite
 * olhar o mesmo acervo por dois ângulos na mesma tela.
 */

import type { RuleTree } from "@/lib/rules/types";

export interface BoardGroup {
  id: string;
  board_id: string;
  name: string;
  /** Token --chart-* do design system, igual a tags.color. Nunca hex. */
  color: string;
  position: number;
  rules: RuleTree;
  /** Chave de métrica do registry do Manager (MANAGER_METRIC_KEYS). */
  sort_metric: string;
  sort_direction: "asc" | "desc";
}

export interface Board {
  id: string;
  name: string;
  position: number;
  groups: BoardGroup[];
}


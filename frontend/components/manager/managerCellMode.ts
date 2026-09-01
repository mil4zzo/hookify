import type { TriStateToggleOption } from "@/components/common/TriStateToggle";

/**
 * O que cada célula de métrica mostra ACIMA do número, no toggle de 3 posições da
 * tabela do Manager (menu "Exibição"):
 *
 * - "value": nada — só o número da métrica.
 * - "delta": a variação da linha contra a média do pack (+/-x%, verde = melhor).
 * - "trend": o sparkline dos últimos 5 dias (barras coloridas contra a média).
 *
 * O modo é o único gate da busca de séries: fora de "trend", o Manager não pede
 * `/ad-performance/series` ao backend.
 */
export type ManagerCellMode = "value" | "delta" | "trend";

export const MANAGER_CELL_MODE_STORAGE_KEY = "hookify-manager-cell-mode";
/** Chave do toggle booleano anterior (Tendências on/off), lida só para migrar a preferência. */
const LEGACY_SHOW_TRENDS_STORAGE_KEY = "hookify-manager-show-trends";

/** Ordem = posições do trilho, da esquerda para a direita. */
export const MANAGER_CELL_MODE_OPTIONS: readonly [TriStateToggleOption<ManagerCellMode>, TriStateToggleOption<ManagerCellMode>, TriStateToggleOption<ManagerCellMode>] = [
  { value: "value", label: "Só o valor", hint: "Apenas o número da métrica" },
  { value: "delta", label: "Variação", hint: "% contra a média do pack" },
  { value: "trend", label: "Tendência", hint: "Barras dos últimos 5 dias" },
];

function isManagerCellMode(value: unknown): value is ManagerCellMode {
  return value === "value" || value === "delta" || value === "trend";
}

/**
 * Lê a preferência do localStorage, migrando quem só tinha o toggle booleano antigo:
 * "Tendências ligado" vira "trend", "desligado" vira "delta" (que era exatamente o
 * que a tabela mostrava com o toggle off). Sem preferência nenhuma → "trend".
 */
export function readManagerCellMode(): ManagerCellMode {
  if (typeof window === "undefined") return "trend";
  try {
    const stored = localStorage.getItem(MANAGER_CELL_MODE_STORAGE_KEY);
    if (isManagerCellMode(stored)) return stored;
    const legacy = localStorage.getItem(LEGACY_SHOW_TRENDS_STORAGE_KEY);
    if (legacy === "false") return "delta";
    return "trend";
  } catch {
    return "trend";
  }
}

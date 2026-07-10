import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Tokens custom de `tailwind.config.ts` que o tailwind-merge precisa conhecer para
 * resolver conflitos (ex.: `h-control-default` vs `h-8`). Sem esse registro, um override
 * core não neutraliza o token custom: os dois vão ao DOM e o token vence na cascata,
 * matando o override silenciosamente.
 *
 * Manter em sincronia com `theme.extend` do tailwind.config.ts.
 */
const SPACING_TOKENS = [
  "control-compact",
  "control-default",
  "control-large",
  "row-compact",
  "row-detailed",
  "widget-compact",
  "widget-default",
  "widget-spacious",
  "stack-compact",
  "stack",
  "stack-spacious",
  "grid-compact",
  "grid",
  "grid-spacious",
];

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: SPACING_TOKENS,
    },
    classGroups: {
      shadow: [{ shadow: ["elevation-flat", "elevation-raised", "elevation-overlay"] }],
      z: [{ z: ["dropdown", "sticky", "overlay", "modal", "toast", "tooltip"] }],
      "font-size": [{ text: ["2xs"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

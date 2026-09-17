import type { Config } from "tailwindcss";

/**
 * Mistura uma cor semântica com a superfície da página.
 * Evita `transparent` em color-mix (OKLab trata transparent como preto sem alpha e pode virar branco).
 */
const colorMixOnCanvas = (cssVar: string, percent: number) => `color-mix(in oklab, var(${cssVar}) ${percent}%, var(--background))`;

// Rampa regular de 10 em 10. Os passos intermediários que existiam (5, 45, 75, 82, 88, 95)
// ficavam a 5 pontos do vizinho — em OKLab isso vale dE 1,2–3,8, no limiar de percepção:
// variantes que o olho não separa e que cada tela escolhia no chute. A 10 pontos (dE 3–7)
// a diferença é visível, então cada passo que sobrou significa alguma coisa.
// Passo fora desta lista NÃO gera classe — o checker (`alpha-step-out-of-scale`) barra.
const alphaSteps = [10, 20, 30, 40, 50, 60, 70, 80, 90] as const;

/** Opacidade da própria `--background` (overlay) — usa alpha real, não mix com transparent. */
const backgroundAlphaScale = () => {
  const entries = Object.fromEntries(alphaSteps.map((step) => [step, `oklch(from var(--background) l c h / ${step / 100})`])) as Record<(typeof alphaSteps)[number], string>;
  return {
    DEFAULT: "var(--background)",
    ...entries,
  };
};

/**
 * TINTA semantica (primary, destructive, success, warning, info, attention, ring): alpha
 * REAL sobre o que estiver atras. Ate 2026-09-17 era mistura com a pagina, e dentro de um
 * modal (mais claro que a pagina no tema escuro) a opcao escolhida e os avisos ficavam
 * mais escuros que o proprio modal. Com alpha o veu e o mesmo em pagina, cartao e modal
 * (como shadcn/Radix). Consequencia: sobre midia, a imagem aparece por baixo.
 */
const tintScale = (cssVar: string) => ({
  DEFAULT: `var(${cssVar})`,
  ...Object.fromEntries(alphaSteps.map((step) => [step, `oklch(from var(${cssVar}) l c h / ${step / 100})`])),
});

/**
 * Mistura com a pagina — so sobra para muted/input/accent, cujos usos com passo sao o
 * backlog de `structural-alpha-surface` (telas legadas ou a redesenhar).
 */
const alphaScale = (cssVar: string) => {
  if (cssVar === "--background") {
    return backgroundAlphaScale();
  }
  return {
    DEFAULT: `var(${cssVar})`,
    ...Object.fromEntries(alphaSteps.map((step) => [step, colorMixOnCanvas(cssVar, step)])),
  };
};

const semanticToneScale = (family: "primary" | "destructive" | "success") => ({
  950: `var(--${family}-950)`,
  800: `var(--${family}-800)`,
  600: `var(--${family}-600)`,
  400: `var(--${family}-400)`,
  300: `var(--${family}-300)`,
  label: `var(--${family}-label)`,
});

const semanticScale = (family: "primary" | "destructive" | "success", options?: { hover?: string }) => ({
  ...tintScale(`--${family}`),
  ...semanticToneScale(family),
  ...(options?.hover ? { hover: options.hover } : {}),
});

export default {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // === BASE ===
        background: alphaScale("--background"),
        foreground: "var(--foreground)",
        neutral: {
          DEFAULT: "var(--neutral-600)",
          950: "var(--neutral-950)",
          800: "var(--neutral-800)",
          600: "var(--neutral-600)",
          400: "var(--neutral-400)",
        },

        // === COMPONENTES ===
        card: {
          DEFAULT: "var(--card)",
          hover: "color-mix(in oklab, var(--card) 85%, var(--accent) 15%)",
        },
        "card-foreground": "var(--card-foreground)",
        popover: {
          DEFAULT: "var(--popover)",
          hover: "color-mix(in oklab, var(--popover) 85%, var(--accent) 15%)",
        },
        "popover-foreground": "var(--popover-foreground)",

        // === PRIMÁRIAS ===
        primary: semanticScale("primary", {
          hover: "color-mix(in oklab, var(--primary) 90%, oklch(1 0 0) 10%)",
        }),
        "primary-foreground": "var(--primary-foreground)",

        // === SECUNDÁRIAS ===

        // === ESTADOS ===
        muted: {
          ...alphaScale("--muted"),
          hover: "color-mix(in oklab, var(--muted) 85%, var(--accent) 15%)",
        },
        "muted-foreground": "var(--muted-foreground)",
        accent: {
          ...alphaScale("--accent"),
          hover: "color-mix(in oklab, var(--card) 80%, var(--accent) 20%)",
        },
        "accent-foreground": "var(--accent-foreground)",

        // === FEEDBACK ===
        destructive: semanticScale("destructive", {
          hover: "color-mix(in oklab, var(--destructive) 90%, oklch(1 0 0) 10%)",
        }),
        "destructive-foreground": "var(--destructive-foreground)",
        success: semanticScale("success", {
          hover: "color-mix(in oklab, var(--success) 90%, oklch(1 0 0) 10%)",
        }),
        "success-foreground": "var(--success-foreground)",
        warning: tintScale("--warning"),
        "warning-foreground": "var(--warning-foreground)",
        info: tintScale("--info"),
        "info-foreground": "var(--info-foreground)",
        attention: tintScale("--attention"),
        "attention-foreground": "var(--attention-foreground)",

        // === FORMULÁRIOS ===
        input: alphaScale("--input"),
        "input-foreground": "var(--input-foreground)",
        // Borda e texto NAO tem escala -N: a escala mistura com a pagina, e uma borda
        // "-50" cai exatamente no nivel 2 da escada (some sobre qualquer grupo); texto
        // "-80" era um terceiro/quarto tom de texto sem papel. Texto apagado = cor
        // secundaria + opacity-50; sobre superficie colorida, white/N (alpha real).
        border: "var(--border)",
        ring: tintScale("--ring"),
        "ring-foreground": "var(--ring-foreground)",

        // === COMPONENTES ESPECÍFICOS ===
        sidebar: "var(--sidebar)",
        "sidebar-foreground": "rgba(var(--sidebar-foreground-rgb) / <alpha-value>)",
        "sidebar-primary": "var(--sidebar-primary)",
        "sidebar-primary-foreground": "var(--sidebar-primary-foreground)",

        // === SUPERFÍCIES ===
        surface: {
          DEFAULT: "var(--surface)",
          fill: "var(--surface-fill)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
        },
        overlay: "var(--overlay)",

        // === TEXTO ===

        // === GRÁFICOS ===
        chart: {
          1: tintScale("--chart-1"),
          2: tintScale("--chart-2"),
          3: tintScale("--chart-3"),
          4: tintScale("--chart-4"),
          5: tintScale("--chart-5"),
        },

      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
      spacing: {
        "control-chip": "1.5rem",
        "control-compact": "2rem",
        "control-default": "2.5rem",
        "control-large": "3rem",
        // row-*: alturas de linha das tabelas do manager — espelhadas em MANAGER_ROW_HEIGHT
        // (components/manager/tableContentTypes.ts). Alterar os dois juntos.
        "row-compact": "2.5rem",
        "row-detailed": "7.5rem",
        "widget-compact": "0.75rem",
        "widget-default": "1rem",
        "widget-spacious": "1.5rem",
        "stack-compact": "0.75rem",
        stack: "1.5rem",
        "stack-spacious": "2rem",
        "grid-compact": "0.75rem",
        grid: "1rem",
        "grid-spacious": "1.5rem",
      },
      fontSize: {
        // Caption/overline: menor que text-xs (12px). Único degrau abaixo da escala core —
        // não criar text-3xs; densidades menores que 10px não são legíveis no app.
        "2xs": ["0.625rem", { lineHeight: "0.875rem" }],
      },
      boxShadow: {
        // Única escala de elevação do app — shadow-sm/md/lg crus caem no default do Tailwind
        // e são apontados pelo checker (regra raw-shadow). Não recriar overrides xs/sm/md/lg.
        "elevation-flat": "none",
        "elevation-raised": "0 1px 2px color-mix(in oklab, var(--foreground) 14%, transparent)",
        "elevation-overlay": "0 18px 50px color-mix(in oklab, var(--foreground) 22%, transparent)",
      },
      zIndex: {
        dropdown: "70",
        sticky: "40",
        overlay: "50",
        modal: "60",
        toast: "80",
        tooltip: "90",
      },
      fontFamily: {
        sans: ["var(--font-geist)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "toast-sweep": {
          from: { transform: "translateX(-150%)" },
          to: { transform: "translateX(400%)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.3s ease-out",
        "accordion-up": "accordion-up 0.3s ease-out",
        "toast-sweep": "toast-sweep 1.9s cubic-bezier(0.4, 0, 0.2, 1) infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;

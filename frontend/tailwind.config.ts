import type { Config } from 'tailwindcss'

/**
 * Mistura uma cor semântica com a superfície da página.
 * Evita `transparent` em color-mix (OKLab trata transparent como preto sem alpha e pode virar branco).
 */
const colorMixOnCanvas = (cssVar: string, percent: number) =>
  `color-mix(in oklab, var(${cssVar}) ${percent}%, var(--background))`

const alphaSteps = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90] as const

/** Opacidade da própria `--background` (overlay) — usa alpha real, não mix com transparent. */
const backgroundAlphaScale = () => {
  const entries = Object.fromEntries(
    alphaSteps.map((step) => [
      step,
      `oklch(from var(--background) l c h / ${step / 100})`,
    ]),
  ) as Record<(typeof alphaSteps)[number], string>
  return {
    DEFAULT: 'var(--background)',
    ...entries,
  }
}

const alphaScale = (cssVar: string) => {
  if (cssVar === '--background') {
    return backgroundAlphaScale()
  }
  return {
    DEFAULT: `var(${cssVar})`,
    ...Object.fromEntries(
      alphaSteps.map((step) => [step, colorMixOnCanvas(cssVar, step)]),
    ),
  }
}

const semanticToneScale = (family: 'primary' | 'destructive' | 'success') => ({
  950: `var(--${family}-950)`,
  800: `var(--${family}-800)`,
  600: `var(--${family}-600)`,
  400: `var(--${family}-400)`,
  300: `var(--${family}-300)`,
  label: `var(--${family}-label)`,
})

const semanticScale = (
  family: 'primary' | 'destructive' | 'success',
  options?: { hover?: string },
) => ({
  ...alphaScale(`--${family}`),
  ...semanticToneScale(family),
  ...(options?.hover ? { hover: options.hover } : {}),
})

export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // === BASE ===
        background: alphaScale('--background'),
        foreground: 'var(--foreground)',
        neutral: {
          DEFAULT: 'var(--neutral-600)',
          950: 'var(--neutral-950)',
          800: 'var(--neutral-800)',
          600: 'var(--neutral-600)',
          400: 'var(--neutral-400)',
        },

        // === COMPONENTES ===
        card: {
          DEFAULT: 'var(--card)',
          hover: 'color-mix(in oklab, var(--card) 85%, var(--accent) 15%)',
        },
        'card-foreground': 'var(--card-foreground)',
        popover: {
          DEFAULT: 'var(--popover)',
          hover: 'color-mix(in oklab, var(--popover) 85%, var(--accent) 15%)',
        },
        'popover-foreground': 'var(--popover-foreground)',

        // === PRIMÁRIAS ===
        primary: semanticScale('primary', {
          hover: 'color-mix(in oklab, var(--primary) 90%, oklch(1 0 0) 10%)',
        }),
        'primary-foreground': 'var(--primary-foreground)',

        // === SECUNDÁRIAS ===
        secondary: {
          ...alphaScale('--secondary'),
          hover: 'color-mix(in oklab, var(--secondary) 85%, var(--accent) 15%)',
        },
        'secondary-foreground': 'var(--secondary-foreground)',

        // === ESTADOS ===
        muted: {
          ...alphaScale('--muted'),
          hover: 'color-mix(in oklab, var(--muted) 85%, var(--accent) 15%)',
        },
        'muted-foreground': 'var(--muted-foreground)',
        accent: {
          ...alphaScale('--accent'),
          hover: 'color-mix(in oklab, var(--card) 80%, var(--accent) 20%)',
        },
        'accent-foreground': 'var(--accent-foreground)',

        // === FEEDBACK ===
        destructive: semanticScale('destructive', {
          hover: 'color-mix(in oklab, var(--destructive) 90%, oklch(1 0 0) 10%)',
        }),
        'destructive-foreground': 'var(--destructive-foreground)',
        success: semanticScale('success'),
        'success-foreground': 'var(--success-foreground)',
        warning: alphaScale('--warning'),
        'warning-foreground': 'var(--warning-foreground)',
        info: alphaScale('--info'),
        'info-foreground': 'var(--info-foreground)',
        attention: alphaScale('--attention'),
        'attention-foreground': 'var(--attention-foreground)',

        // === FORMULÁRIOS ===
        input: alphaScale('--input'),
        'input-foreground': 'var(--input-foreground)',
        border: 'var(--border)',
        ring: alphaScale('--ring'),
        'ring-foreground': 'var(--ring-foreground)',

        // === COMPONENTES ESPECÍFICOS ===
        sidebar: 'var(--sidebar)',
        'sidebar-foreground': 'rgba(var(--sidebar-foreground-rgb) / <alpha-value>)',
        'sidebar-primary': 'var(--sidebar-primary)',
        'sidebar-primary-foreground': 'var(--sidebar-primary-foreground)',

        // === SUPERFÍCIES ===
        surface: {
          DEFAULT: 'var(--surface)',
          fill: 'var(--surface-fill)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
        },
        'surface-2': 'var(--surface-2)',
        surface3: 'var(--surface-3)',
        overlay: 'var(--overlay)',

        // === TEXTO ===
        text: 'rgb(var(--text-rgb) / <alpha-value>)',

        // === GRÁFICOS ===
        chart: {
          1: 'var(--chart-1)',
          2: 'var(--chart-2)',
          3: 'var(--chart-3)',
          4: 'var(--chart-4)',
          5: 'var(--chart-5)',
        },

        // === BRAND ===
        brand: {
          ...alphaScale('--primary'),
          ...semanticToneScale('primary'),
        },
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        sm: '0 1px 2px rgba(0,0,0,0.25)',
        md: '0 4px 8px rgba(0,0,0,0.25)',
        lg: '0 12px 24px rgba(0,0,0,0.30)',
      },
      fontFamily: {
        sans: ['var(--font-geist)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.3s ease-out',
        'accordion-up': 'accordion-up 0.3s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config


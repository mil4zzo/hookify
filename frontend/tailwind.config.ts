import type { Config } from 'tailwindcss'

/**
 * Mistura uma cor semântica com a superfície da página.
 * Evita `transparent` em color-mix (OKLab trata transparent como preto sem alpha e pode virar branco).
 */
const colorMixOnCanvas = (cssVar: string, percent: number) =>
  `color-mix(in oklab, var(${cssVar}) ${percent}%, var(--background))`

const alphaSteps = [5, 10, 20, 30, 40, 45, 50, 60, 70, 75, 80, 82, 88, 90, 95] as const

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
        foreground: alphaScale('--foreground'),
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
        'card-foreground': alphaScale('--card-foreground'),
        popover: {
          DEFAULT: 'var(--popover)',
          hover: 'color-mix(in oklab, var(--popover) 85%, var(--accent) 15%)',
        },
        'popover-foreground': alphaScale('--popover-foreground'),

        // === PRIMÁRIAS ===
        primary: semanticScale('primary', {
          hover: 'color-mix(in oklab, var(--primary) 90%, oklch(1 0 0) 10%)',
        }),
        'primary-foreground': alphaScale('--primary-foreground'),

        // === SECUNDÁRIAS ===
        secondary: {
          ...alphaScale('--secondary'),
          hover: 'color-mix(in oklab, var(--secondary) 85%, var(--accent) 15%)',
        },
        'secondary-foreground': alphaScale('--secondary-foreground'),

        // === ESTADOS ===
        muted: {
          ...alphaScale('--muted'),
          hover: 'color-mix(in oklab, var(--muted) 85%, var(--accent) 15%)',
        },
        'muted-foreground': alphaScale('--muted-foreground'),
        accent: {
          ...alphaScale('--accent'),
          hover: 'color-mix(in oklab, var(--card) 80%, var(--accent) 20%)',
        },
        'accent-foreground': alphaScale('--accent-foreground'),

        // === FEEDBACK ===
        destructive: semanticScale('destructive', {
          hover: 'color-mix(in oklab, var(--destructive) 90%, oklch(1 0 0) 10%)',
        }),
        'destructive-foreground': alphaScale('--destructive-foreground'),
        success: semanticScale('success'),
        'success-foreground': alphaScale('--success-foreground'),
        warning: alphaScale('--warning'),
        'warning-foreground': alphaScale('--warning-foreground'),
        info: alphaScale('--info'),
        'info-foreground': alphaScale('--info-foreground'),
        attention: alphaScale('--attention'),
        'attention-foreground': alphaScale('--attention-foreground'),

        // === FORMULÁRIOS ===
        input: alphaScale('--input'),
        'input-foreground': alphaScale('--input-foreground'),
        border: alphaScale('--border'),
        ring: alphaScale('--ring'),
        'ring-foreground': alphaScale('--ring-foreground'),

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
          1: alphaScale('--chart-1'),
          2: alphaScale('--chart-2'),
          3: alphaScale('--chart-3'),
          4: alphaScale('--chart-4'),
          5: alphaScale('--chart-5'),
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
      spacing: {
        'control-compact': '2rem',
        'control-default': '2.5rem',
        'control-large': '3rem',
        'row-compact': '2.5rem',
        'row-default': '3.5rem',
        'row-detailed': '7.5rem',
        'widget-compact': '0.75rem',
        'widget-default': '1rem',
        'widget-spacious': '1.5rem',
        'stack-compact': '0.75rem',
        stack: '1.5rem',
        'stack-spacious': '2rem',
        'grid-compact': '0.75rem',
        grid: '1rem',
        'grid-spacious': '1.5rem',
        workspace: '1.5rem',
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        sm: '0 1px 2px rgba(0,0,0,0.25)',
        md: '0 4px 8px rgba(0,0,0,0.25)',
        lg: '0 12px 24px rgba(0,0,0,0.30)',
        'elevation-flat': 'none',
        'elevation-raised': '0 1px 2px color-mix(in oklab, var(--foreground) 14%, transparent)',
        'elevation-overlay': '0 18px 50px color-mix(in oklab, var(--foreground) 28%, transparent)',
      },
      zIndex: {
        dropdown: '70',
        sticky: '40',
        overlay: '50',
        modal: '60',
        toast: '80',
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

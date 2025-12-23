import type { Config } from 'tailwindcss'

export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // === BASE ===
        background: {
          DEFAULT: 'var(--background)',
          50: 'color-mix(in oklab, var(--background) 50%, transparent)',
          60: 'color-mix(in oklab, var(--background) 60%, transparent)',
          70: 'color-mix(in oklab, var(--background) 70%, transparent)',
          80: 'color-mix(in oklab, var(--background) 80%, transparent)',
          90: 'color-mix(in oklab, var(--background) 90%, transparent)',
        },
        foreground: 'var(--foreground)',
        
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
        primary: {
          DEFAULT: 'var(--primary)',
          5: 'color-mix(in oklab, var(--primary) 5%, transparent)',
          10: 'color-mix(in oklab, var(--primary) 10%, transparent)',
          20: 'color-mix(in oklab, var(--primary) 20%, transparent)',
          30: 'color-mix(in oklab, var(--primary) 30%, transparent)',
          50: 'color-mix(in oklab, var(--primary) 50%, transparent)',
          60: 'color-mix(in oklab, var(--primary) 60%, transparent)',
          70: 'color-mix(in oklab, var(--primary) 70%, transparent)',
          80: 'color-mix(in oklab, var(--primary) 80%, transparent)',
          90: 'color-mix(in oklab, var(--primary) 90%, transparent)',
          // Hover sólido: versão ligeiramente mais clara do primary (mistura com branco)
          hover: 'color-mix(in oklab, var(--primary) 90%, oklch(1 0 0) 10%)',
        },
        'primary-foreground': 'var(--primary-foreground)',
        
        // === SECUNDÁRIAS ===
        secondary: {
          DEFAULT: 'var(--secondary)',
          10: 'color-mix(in oklab, var(--secondary) 10%, transparent)',
          20: 'color-mix(in oklab, var(--secondary) 20%, transparent)',
          30: 'color-mix(in oklab, var(--secondary) 30%, transparent)',
          50: 'color-mix(in oklab, var(--secondary) 50%, transparent)',
          80: 'color-mix(in oklab, var(--secondary) 80%, transparent)',
          90: 'color-mix(in oklab, var(--secondary) 90%, transparent)',
          // Hover sólido: mistura secondary com accent para criar cor sólida intermediária
          hover: 'color-mix(in oklab, var(--secondary) 85%, var(--accent) 15%)',
        },
        'secondary-foreground': 'var(--secondary-foreground)',
        
        // === ESTADOS ===
        muted: {
          DEFAULT: 'var(--muted)',
          10: 'color-mix(in oklab, var(--muted) 10%, transparent)',
          20: 'color-mix(in oklab, var(--muted) 20%, transparent)',
          30: 'color-mix(in oklab, var(--muted) 30%, transparent)',
          40: 'color-mix(in oklab, var(--muted) 40%, transparent)',
          50: 'color-mix(in oklab, var(--muted) 50%, transparent)',
          60: 'color-mix(in oklab, var(--muted) 60%, transparent)',
          70: 'color-mix(in oklab, var(--muted) 70%, transparent)',
          80: 'color-mix(in oklab, var(--muted) 80%, transparent)',
          90: 'color-mix(in oklab, var(--muted) 90%, transparent)',
          // Hover sólido: mistura muted com accent para criar cor sólida intermediária
          hover: 'color-mix(in oklab, var(--muted) 85%, var(--accent) 15%)',
        },
        'muted-foreground': 'var(--muted-foreground)',
        accent: {
          DEFAULT: 'var(--accent)',
          10: 'color-mix(in oklab, var(--accent) 10%, transparent)',
          20: 'color-mix(in oklab, var(--accent) 20%, transparent)',
          30: 'color-mix(in oklab, var(--accent) 30%, transparent)',
          50: 'color-mix(in oklab, var(--accent) 50%, transparent)',
          80: 'color-mix(in oklab, var(--accent) 80%, transparent)',
          90: 'color-mix(in oklab, var(--accent) 90%, transparent)',
          // Hover sólido: mistura accent com card para criar cor sólida intermediária
          hover: 'color-mix(in oklab, var(--card) 80%, var(--accent) 20%)',
        },
        'accent-foreground': 'var(--accent-foreground)',
        
        // === FEEDBACK ===
        destructive: {
          DEFAULT: 'var(--destructive)',
          5: 'color-mix(in oklab, var(--destructive) 5%, transparent)',
          10: 'color-mix(in oklab, var(--destructive) 10%, transparent)',
          20: 'color-mix(in oklab, var(--destructive) 20%, transparent)',
          40: 'color-mix(in oklab, var(--destructive) 40%, transparent)',
          50: 'color-mix(in oklab, var(--destructive) 50%, transparent)',
          80: 'color-mix(in oklab, var(--destructive) 80%, transparent)',
          90: 'color-mix(in oklab, var(--destructive) 90%, transparent)',
          // Hover sólido: versão ligeiramente mais clara do destructive (mistura com branco)
          hover: 'color-mix(in oklab, var(--destructive) 90%, oklch(1 0 0) 10%)',
        },
        'destructive-foreground': 'var(--destructive-foreground)',
        success: {
          DEFAULT: 'var(--success)',
          20: 'color-mix(in oklab, var(--success) 20%, transparent)',
          40: 'color-mix(in oklab, var(--success) 40%, transparent)',
          50: 'color-mix(in oklab, var(--success) 50%, transparent)',
          80: 'color-mix(in oklab, var(--success) 80%, transparent)',
          90: 'color-mix(in oklab, var(--success) 90%, transparent)',
        },
        'success-foreground': 'var(--success-foreground)',
        warning: {
          DEFAULT: 'var(--warning)',
          20: 'color-mix(in oklab, var(--warning) 20%, transparent)',
          40: 'color-mix(in oklab, var(--warning) 40%, transparent)',
          50: 'color-mix(in oklab, var(--warning) 50%, transparent)',
          70: 'color-mix(in oklab, var(--warning) 70%, transparent)',
          80: 'color-mix(in oklab, var(--warning) 80%, transparent)',
          90: 'color-mix(in oklab, var(--warning) 90%, transparent)',
        },
        'warning-foreground': 'var(--warning-foreground)',
        info: {
          DEFAULT: 'var(--info)',
          20: 'color-mix(in oklab, var(--info) 20%, transparent)',
          40: 'color-mix(in oklab, var(--info) 40%, transparent)',
          50: 'color-mix(in oklab, var(--info) 50%, transparent)',
          80: 'color-mix(in oklab, var(--info) 80%, transparent)',
          90: 'color-mix(in oklab, var(--info) 90%, transparent)',
        },
        'info-foreground': 'var(--info-foreground)',
        danger: {
          DEFAULT: 'var(--danger)',
          10: 'color-mix(in oklab, var(--danger) 10%, transparent)',
          20: 'color-mix(in oklab, var(--danger) 20%, transparent)',
          40: 'color-mix(in oklab, var(--danger) 40%, transparent)',
          50: 'color-mix(in oklab, var(--danger) 50%, transparent)',
          70: 'color-mix(in oklab, var(--danger) 70%, transparent)',
          80: 'color-mix(in oklab, var(--danger) 80%, transparent)',
          90: 'color-mix(in oklab, var(--danger) 90%, transparent)',
        },
        'danger-foreground': 'var(--danger-foreground)',
        
        // === FORMULÁRIOS ===
        input: {
          DEFAULT: 'var(--input)',
          10: 'color-mix(in oklab, var(--input) 10%, transparent)',
          20: 'color-mix(in oklab, var(--input) 20%, transparent)',
          30: 'color-mix(in oklab, var(--input) 30%, transparent)',
          50: 'color-mix(in oklab, var(--input) 50%, transparent)',
          80: 'color-mix(in oklab, var(--input) 80%, transparent)',
        },
        'input-foreground': 'var(--input-foreground)',
        border: 'var(--border)',
        ring: 'var(--ring)',
        
        // === COMPONENTES ESPECÍFICOS ===
        sidebar: 'var(--sidebar)',
        'sidebar-foreground': 'rgba(var(--sidebar-foreground-rgb) / <alpha-value>)',
        'sidebar-primary': 'var(--sidebar-primary)',
        'sidebar-primary-foreground': 'var(--sidebar-primary-foreground)',
        
        // === SUPERFÍCIES ===
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        surface3: '#33373C',
        
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
          DEFAULT: 'var(--primary)',
          20: 'color-mix(in oklab, var(--primary) 20%, transparent)',
          50: 'color-mix(in oklab, var(--primary) 50%, transparent)',
          60: 'color-mix(in oklab, var(--primary) 60%, transparent)',
          70: 'color-mix(in oklab, var(--primary) 70%, transparent)',
          100: 'color-mix(in oklab, var(--primary) 60%, transparent)',
          200: 'color-mix(in oklab, var(--primary) 70%, transparent)',
          300: 'color-mix(in oklab, var(--primary) 80%, transparent)',
          400: 'color-mix(in oklab, var(--primary) 90%, transparent)',
          500: 'var(--primary)',
          600: '#256D2A',
          700: '#1F5A23',
        },
      },
      borderRadius: {
        md: '8px',
        lg: '10px',
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



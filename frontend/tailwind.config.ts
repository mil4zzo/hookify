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
        background: 'var(--background)',
        card: 'var(--card)',
        'card-foreground': 'var(--card-foreground)',
        popover: 'var(--popover)',
        'popover-foreground': 'var(--popover-foreground)',
        sidebar: 'var(--sidebar)',
        'sidebar-foreground': 'rgba(var(--sidebar-foreground-rgb) / <alpha-value>)',
        primary: {
          DEFAULT: 'var(--primary)',
          90: 'color-mix(in oklab, var(--primary) 90%, transparent)',
        },
        'primary-foreground': 'var(--primary-foreground)',
        secondary: 'var(--secondary)',
        muted: 'var(--muted)',
        'muted-foreground': 'var(--muted-foreground)',
        accent: 'var(--accent)',
        'accent-foreground': 'var(--accent-foreground)',
        input: {
          DEFAULT: 'var(--input)',
          '30': 'color-mix(in oklab, var(--input) 30%, transparent)',
        },
        border: 'var(--border)',
        ring: 'var(--ring)',
        text: 'rgb(var(--text-rgb) / <alpha-value>)',
        surface: 'var(--surface)',
        surface3: '#33373C',
        brand: {
          DEFAULT: '#1447e6',
          600: '#256D2A',
          700: '#1F5A23',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          20: 'color-mix(in oklab, var(--destructive) 20%, transparent)',
          40: 'color-mix(in oklab, var(--destructive) 40%, transparent)',
          90: 'color-mix(in oklab, var(--destructive) 90%, transparent)',
        },
        danger: '#EF4444',
        warning: '#F59E0B',
        info: '#3B82F6',
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
  plugins: [],
} satisfies Config



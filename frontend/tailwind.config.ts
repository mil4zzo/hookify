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
        bg: '#111315',
        surface: '#1A1D21',
        surface2: '#23272B',
        text: '#E5E7EB',
        muted: '#9CA3AF',
        brand: {
          DEFAULT: '#2E7D32',
          600: '#256D2A',
          700: '#1F5A23',
        },
        danger: '#EF4444',
        warning: '#F59E0B',
        info: '#3B82F6',
      },
      borderRadius: {
        md: '6px',
        lg: '10px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(0,0,0,0.25)',
        md: '0 4px 8px rgba(0,0,0,0.25)',
        lg: '0 12px 24px rgba(0,0,0,0.30)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['Roboto Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config



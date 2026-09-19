/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Structural neutrals. Cool-leaning slate — this is a control room, and
        // a warm grey reads as consumer software rather than clinical tooling.
        ink: {
          50: '#f6f8fa',
          100: '#eceff4',
          200: '#dbe1e9',
          300: '#bcc6d4',
          // 400-600 carry nearly all secondary text. They are tuned for
          // contrast at 12-13px rather than for an even visual ramp: an
          // evenly-spaced scale put these under the 4.5:1 floor on white.
          400: '#8d9aad',
          500: '#64728a',
          600: '#4d5a70',
          700: '#3c4759',
          800: '#2a3242',
          900: '#1a2030',
          950: '#0f131d',
        },
        // Brand — deep indigo. Used for navigation, primary actions and the
        // "opportunity" concept itself.
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        // Priority ramp. These are semantic, not decorative — never reuse them
        // for anything that is not a priority or severity.
        critical: { bg: '#fef2f2', border: '#fecaca', text: '#991b1b', solid: '#dc2626', dark: '#450a0a' },
        high: { bg: '#fff7ed', border: '#fed7aa', text: '#9a3412', solid: '#ea580c', dark: '#431407' },
        medium: { bg: '#fefce8', border: '#fef08a', text: '#854d0e', solid: '#ca8a04', dark: '#422006' },
        low: { bg: '#f0f9ff', border: '#bae6fd', text: '#075985', solid: '#0284c7', dark: '#082f49' },
        // Outcome colours, distinct from priority so a converted critical case
        // does not read as two conflicting signals.
        positive: { 50: '#ecfdf5', 100: '#d1fae5', 500: '#10b981', 600: '#059669', 700: '#047857', 900: '#064e3b' },
        warn: { 50: '#fffbeb', 100: '#fef3c7', 500: '#f59e0b', 600: '#d97706', 700: '#b45309' },
        danger: { 50: '#fef2f2', 100: '#fee2e2', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c' },
      },
      fontFamily: {
        sans: [
          'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto',
          'Helvetica Neue', 'Arial', 'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        // A dense operational scale: the default 16px base wastes a third of
        // the vertical space on a screen whose job is showing many rows.
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        xs: ['0.75rem', { lineHeight: '1.125rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem', { lineHeight: '1.375rem' }],
        lg: ['1rem', { lineHeight: '1.5rem' }],
        xl: ['1.125rem', { lineHeight: '1.625rem' }],
        '2xl': ['1.375rem', { lineHeight: '1.75rem' }],
        '3xl': ['1.75rem', { lineHeight: '2.125rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(16 24 40 / 0.04), 0 1px 3px 0 rgb(16 24 40 / 0.06)',
        raised: '0 4px 12px -2px rgb(16 24 40 / 0.10), 0 2px 6px -2px rgb(16 24 40 / 0.06)',
        pop: '0 12px 32px -8px rgb(16 24 40 / 0.22)',
      },
      animation: {
        'fade-in': 'fadeIn 160ms ease-out',
        'slide-up': 'slideUp 200ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}

import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    // Override the default color palette entirely so only design tokens can be used
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: '#FFFFFF',
      black: '#000000',
      neutral: {
        50: '#fafafa',
        100: '#f4f4f5',
        200: '#e4e4e7',
        300: '#d4d4d8',
        400: '#a1a1aa',
        500: '#71717a',
        600: '#52525b',
        700: '#3f3f46',
        800: '#27272a',
        900: '#18181b',
        950: '#09090b',
      },
      surface: {
        bg: 'var(--surface-bg)',
        panel: 'var(--surface-panel)',
        'panel-raised': 'var(--surface-panel-raised)',
        subtle: 'var(--surface-subtle)',
        hover: 'var(--surface-hover)',
        active: 'var(--surface-active)',
        border: 'var(--surface-border)',
        'border-subtle': 'var(--surface-border-subtle)',
        'border-focus': 'var(--surface-border-focus)',
      },
      text: {
        main: 'var(--text-main)',
        muted: 'var(--text-muted)',
        faint: 'var(--text-faint)',
        disabled: 'var(--text-disabled)',
      },
      accent: {
        DEFAULT: 'var(--accent)',
        hover: 'var(--accent-hover)',
        subtle: 'var(--accent-subtle)',
        border: 'var(--accent-border)',
        contrast: 'var(--accent-contrast)',
      },
      status: {
        offline: 'var(--status-offline)',
        'offline-bg': 'var(--status-offline-bg)',
        'offline-border': 'var(--status-offline-border)',
        error: 'var(--status-error)',
        'error-bg': 'var(--status-error-bg)',
        'error-border': 'var(--status-error-border)',
        warning: 'var(--status-warning)',
        'warning-bg': 'var(--status-warning-bg)',
        'warning-border': 'var(--status-warning-border)',
      },
    },
    extend: {
      fontFamily: {
        serif: 'var(--font-serif)',
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        panel: 'var(--shadow-panel)',
      },
    },
  },
  plugins: [],
};

export default config;

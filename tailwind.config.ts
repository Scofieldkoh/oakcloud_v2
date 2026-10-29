import type { Config } from 'tailwindcss';

const withOpacity = (cssVariable: string) => `rgb(var(${cssVariable}) / <alpha-value>)`;

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        oak: {
          primary: withOpacity('--oak-primary-rgb'),
          hover: withOpacity('--oak-hover-rgb'),
          light: withOpacity('--oak-light-rgb'),
          dark: withOpacity('--oak-dark-rgb'),
          'row-alt': withOpacity('--oak-row-alt-rgb'),
          'row-alt-hover': withOpacity('--oak-row-alt-hover-rgb'),
          'row-selected': withOpacity('--oak-row-selected-rgb'),
          'row-selected-hover': withOpacity('--oak-row-selected-hover-rgb'),
        },
        background: {
          primary: withOpacity('--bg-primary-rgb'),
          secondary: withOpacity('--bg-secondary-rgb'),
          tertiary: withOpacity('--bg-tertiary-rgb'),
          elevated: withOpacity('--bg-elevated-rgb'),
        },
        border: {
          primary: withOpacity('--border-primary-rgb'),
          secondary: withOpacity('--border-secondary-rgb'),
          focus: withOpacity('--border-focus-rgb'),
        },
        text: {
          primary: withOpacity('--text-primary-rgb'),
          secondary: withOpacity('--text-secondary-rgb'),
          tertiary: withOpacity('--text-tertiary-rgb'),
          muted: withOpacity('--text-muted-rgb'),
        },
        status: {
          success: '#22c55e',
          warning: '#eab308',
          error: '#ef4444',
          info: '#3b82f6',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],      // 11px
        'xs': ['0.75rem', { lineHeight: '1.125rem' }],     // 12px
        'sm': ['0.8125rem', { lineHeight: '1.25rem' }],    // 13px
        'base': ['0.875rem', { lineHeight: '1.5rem' }],    // 14px
        'lg': ['1rem', { lineHeight: '1.625rem' }],        // 16px
        'xl': ['1.125rem', { lineHeight: '1.75rem' }],     // 18px
        '2xl': ['1.25rem', { lineHeight: '1.875rem' }],    // 20px
        '3xl': ['1.5rem', { lineHeight: '2.125rem' }],     // 24px
        '4xl': ['1.875rem', { lineHeight: '2.375rem' }],   // 30px
      },
      borderRadius: {
        DEFAULT: '4px',
        'sm': '2px',
        'md': '4px',
        'lg': '6px',
        'xl': '8px',
      },
      spacing: {
        '0.5': '2px',
        '1': '4px',
        '1.5': '6px',
        '2': '8px',
        '2.5': '10px',
        '3': '12px',
        '3.5': '14px',
        '4': '16px',
        '5': '20px',
        '6': '24px',
        '8': '32px',
        '10': '40px',
        '12': '48px',
      },
      boxShadow: {
        'elevation-1': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'elevation-2': '0 2px 4px -1px rgba(0, 0, 0, 0.1)',
        'elevation-3': '0 4px 8px -2px rgba(0, 0, 0, 0.15)',
      },
    },
  },
  plugins: [],
};

export default config;

import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        border:  'hsl(214 32% 91%)',
        input:   'hsl(214 32% 91%)',
        ring:    'hsl(221 83% 53%)',
        background: 'hsl(0 0% 100%)',
        foreground: 'hsl(222 84% 5%)',
        primary: {
          DEFAULT:    'hsl(221 83% 53%)',
          foreground: 'hsl(210 40% 98%)',
        },
        secondary: {
          DEFAULT:    'hsl(210 40% 96%)',
          foreground: 'hsl(222 47% 11%)',
        },
        muted: {
          DEFAULT:    'hsl(210 40% 96%)',
          foreground: 'hsl(215 16% 47%)',
        },
        accent: {
          DEFAULT:    'hsl(210 40% 96%)',
          foreground: 'hsl(222 47% 11%)',
        },
        destructive: {
          DEFAULT:    'hsl(0 72% 51%)',
          foreground: 'hsl(210 40% 98%)',
        },
        card: {
          DEFAULT:    'hsl(0 0% 100%)',
          foreground: 'hsl(222 84% 5%)',
        },
      },
      borderRadius: {
        lg: '0.5rem',
        md: '0.375rem',
        sm: '0.25rem',
      },
    },
  },
  plugins: [],
};

export default config;

/** @type {import('tailwindcss').Config} */
export const darkMode = 'class';
export const content = ["./src/**/*.{js,jsx,ts,tsx}"];
export const theme = {
  extend: {
    fontFamily: {
      sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
    },
    animation: {
      fadeIn: 'fadeIn 0.3s ease-in-out',
      shake: 'shake 0.4s ease-in-out',
    },
    keyframes: {
      fadeIn: {
        '0%': { opacity: '0', transform: 'translateY(8px)' },
        '100%': { opacity: '1', transform: 'translateY(0)' },
      },
      shake: {
        '0%, 100%': { transform: 'translateX(0)' },
        '20%, 60%': { transform: 'translateX(-4px)' },
        '40%, 80%': { transform: 'translateX(4px)' },
      },
    },
    colors: {
      // Validated with the dataviz skill's color-formula checks
      // (lightness band, chroma floor, CVD separation, contrast) —
      // keep in sync with src/lib/theme.js.
      chart: {
        actual: '#4f46e5',
        predicted: '#eb6834',
        positive: '#4f46e5',
        negative: '#e34948',
      },
      status: {
        good: '#0ca30c',
        warning: '#fab219',
        critical: '#d03b3b',
      },
      // Semantic aliases over the tokens above — one vocabulary for
      // "what does this color mean" reused across cards, badges and
      // charts, instead of each page picking its own green/red.
      // Keep in sync with the `semantic` export in src/lib/theme.js.
      semantic: {
        primary: '#4f46e5',
        success: '#0ca30c',
        warning: '#fab219',
        danger: '#d03b3b',
        info: '#0284c7',
        positive: '#4f46e5',
        negative: '#e34948',
      },
    },
  },
};
export const plugins = [];
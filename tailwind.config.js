/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', '"SF Mono"', 'Consolas', 'monospace'],
        sans: ['"Space Grotesk"', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: {
          900: '#0a0b0d',
          800: '#101216',
          700: '#171a20',
          600: '#20242c',
          500: '#2c313b',
          400: '#3d434f',
        },
        signal: '#F27D26',
        cool: '#2F6B8A',
        alert: '#ff3b30',
        ok: '#38d17a',
      },
    },
  },
  plugins: [],
};

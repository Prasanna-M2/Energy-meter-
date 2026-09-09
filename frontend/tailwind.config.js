/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#0b0f19',
          card: '#131b2e',
          cardHover: '#1a243d',
          input: '#1b2640',
          border: '#243454',
          borderGlow: '#3b82f6',
        },
        primary: {
          cyan: '#00f2fe',
          blue: '#3b82f6',
        },
        accent: {
          green: '#00e676',
          orange: '#ff9800',
          red: '#ff5252',
          purple: '#a855f7',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        sans: ['Inter', 'sans-serif'],
      }
    },
  },
  plugins: [],
}

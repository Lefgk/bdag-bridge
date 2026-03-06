/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'bg-dark': '#050810',
        'card': '#111827',
        'card-hover': '#1a2235',
        'accent': '#00d4ff',
        'accent-dim': '#00a3c7',
      },
      fontFamily: {
        mono: ['DM Mono', 'monospace'],
        sans: ['Syne', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

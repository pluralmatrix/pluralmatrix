/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        matrix: {
          dark: '#15191e',
          light: '#21262c',
          primary: '#0dbd8b',
          secondary: '#04a97d',
          text: '#e1e1e1',
          muted: '#a1a1a1',
        },
      },
    },
  },
  plugins: [],
};

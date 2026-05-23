/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 800: '#1e3a5f', 700: '#1e4976', 600: '#1a5c96' }
      }
    }
  },
  plugins: []
}

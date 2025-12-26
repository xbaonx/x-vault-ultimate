/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#000000",
        surface: "#1C1C1E",
        primary: "#0A84FF",
        text: "#FFFFFF",
        secondary: "#8E8E93",
        success: "#30D158",
        danger: "#FF453A",
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', "Segoe UI", 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      }
    },
  },
  plugins: [],
}


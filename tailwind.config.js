/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        navy: {
          950: "rgb(var(--color-navy-950-rgb) / <alpha-value>)",
          900: "rgb(var(--color-navy-900-rgb) / <alpha-value>)",
          800: "rgb(var(--color-navy-800-rgb) / <alpha-value>)",
          700: "rgb(var(--color-navy-700-rgb) / <alpha-value>)",
          600: "rgb(var(--color-navy-600-rgb) / <alpha-value>)",
          500: "rgb(var(--color-navy-500-rgb) / <alpha-value>)",
          100: "rgb(var(--color-navy-100-rgb) / <alpha-value>)",
          50: "rgb(var(--color-navy-50-rgb) / <alpha-value>)",
        },
        gold: {
          600: "rgb(var(--color-gold-600-rgb) / <alpha-value>)",
          500: "rgb(var(--color-gold-500-rgb) / <alpha-value>)",
          400: "rgb(var(--color-gold-400-rgb) / <alpha-value>)",
          100: "rgb(var(--color-gold-100-rgb) / <alpha-value>)",
          50: "rgb(var(--color-gold-50-rgb) / <alpha-value>)",
        },
        cream: {
          100: "rgb(var(--color-cream-100-rgb) / <alpha-value>)",
          50: "rgb(var(--color-cream-50-rgb) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-pretendard)", "Pretendard", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [],
};

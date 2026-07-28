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
          950: "var(--color-navy-950)",
          900: "var(--color-navy-900)",
          800: "var(--color-navy-800)",
          700: "var(--color-navy-700)",
          600: "var(--color-navy-600)",
          500: "var(--color-navy-500)",
          100: "var(--color-navy-100)",
          50: "var(--color-navy-50)",
        },
        gold: {
          600: "var(--color-gold-600)",
          500: "var(--color-gold-500)",
          400: "var(--color-gold-400)",
          100: "var(--color-gold-100)",
          50: "var(--color-gold-50)",
        },
        cream: {
          100: "var(--color-cream-100)",
          50: "var(--color-cream-50)",
        },
      },
      fontFamily: {
        sans: ["var(--font-pretendard)", "Pretendard", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [],
};

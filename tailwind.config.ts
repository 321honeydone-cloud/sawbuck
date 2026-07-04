import type { Config } from "tailwindcss";

// HoneyDone industrial UI tokens — dark, gold, hard edges.
// Token NAMES match the original Handoff theme so component classes keep working;
// only the VALUES change to Manny's house palette.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0c", // near-black background
        card: "#141418", // panel background
        "card-2": "#1c1c22", // raised card background
        border: "#2a2a30", // borders
        "border-soft": "#1c1c22",
        brand: {
          DEFAULT: "#c9a227", // HoneyDone gold
          dim: "#a8861f", // darker gold (hover)
          bright: "#f0c948", // bright gold (accents)
        },
        ink: "#f4f3ee", // text primary (warm off-white)
        muted: "#85858d", // text secondary
        flag: "#e0922a", // amber "AI updates" / review status
        gold: "#c9a227",
        yellow: "#f0c948", // bright yellow — Complications Cap
        danger: "#e5484d", // red — Max Price Guarantee ceiling
        gain: "#5fb85f", // positive delta green
      },
      fontFamily: {
        sans: ["var(--font-barlow)", "system-ui", "sans-serif"],
        display: ["var(--font-oswald)", "var(--font-barlow)", "sans-serif"],
        mono: ["var(--font-space-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;

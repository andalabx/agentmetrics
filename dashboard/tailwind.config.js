/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // ── Semantic surface tokens ────────────────────────────────────────────
        bg:       "var(--bg)",
        surface:  "var(--surface)",
        surface2: "var(--surface-2)",

        // ── Accent (indigo) ───────────────────────────────────────────────────
        accent:        "var(--accent)",
        "accent-dim":  "var(--accent-dim)",
        "accent-txt":  "var(--accent-txt)",
        "accent-bg":   "var(--accent-bg)",

        // ── Live / streaming (cyan) ───────────────────────────────────────────
        live: "var(--live)",

        // ── Text scale ────────────────────────────────────────────────────────
        t1: "var(--text-1)",
        t2: "var(--text-2)",
        t3: "var(--text-3)",

        // ── Semantic data colors ───────────────────────────────────────────────
        cost:    "#F59E0B",   // amber  — spend, warnings
        savings: "#10B981",   // emerald — improvements
        danger:  "#EF4444",   // red    — errors, failures
      },

      borderColor: {
        DEFAULT: "var(--border)",
        muted:   "var(--border-muted)",
        strong:  "var(--border-strong)",
        focus:   "var(--border-focus)",
      },

      boxShadow: {
        card: "var(--shadow)",
      },

      fontFamily: {
        sans:    ["Inter", "system-ui", "sans-serif"],
        display: ["Space Grotesk", "system-ui", "sans-serif"],
        mono:    ["Geist Mono", "ui-monospace", "Cascadia Code", "monospace"],
      },

      borderRadius: {
        card:  "16px",
        card2: "20px",
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      // Mapped to the CSS custom properties in src/design-tokens.css (the
      // same tokens DESIGN.md defines) so Tailwind utilities and the
      // system-color fallbacks stay a single source of truth, not two.
      colors: {
        accent: "var(--accent)",
        "status-completed": "var(--status-completed)",
        "status-downloading": "var(--status-downloading)",
        "status-paused": "var(--status-paused)",
        "status-interrupted": "var(--status-interrupted)",
        "status-failed": "var(--status-failed)",
        "bg-window": "var(--bg-window)",
        "bg-sidebar": "var(--bg-sidebar)",
        "bg-row-hover": "var(--bg-row-hover)",
        separator: "var(--separator)",
        label: "var(--label)",
        "label-secondary": "var(--label-secondary)",
        "label-tertiary": "var(--label-tertiary)",
      },
      fontFamily: {
        sf: ["-apple-system", "BlinkMacSystemFont", "SF Pro Text", "sans-serif"],
      },
    },
  },
  plugins: [],
};

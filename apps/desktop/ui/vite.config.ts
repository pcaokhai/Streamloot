import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Built output is served by pywebview's own local HTTP server (see
// apps/desktop/main.py), not opened as a file:// page — relative asset
// paths matter here since there's no fixed domain root to assume.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

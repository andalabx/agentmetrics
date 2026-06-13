import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3099,
    proxy: {
      "/v1":    { target: "http://localhost:8099", changeOrigin: true },
      "/health": { target: "http://localhost:8099", changeOrigin: true },
    },
  },
  preview: {
    port: 3099,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});

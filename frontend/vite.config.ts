import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** El proxy evita problemas de CORS y deja el frontend hablando a /api. */
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:3001", changeOrigin: true } },
  },
});

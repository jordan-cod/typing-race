import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * In production the Go binary serves this bundle itself, so the page and the API share an
 * origin. The proxy makes development work the same way: without it the browser would talk to
 * two origins here and one in production, and the difference would only show up as a CORS or
 * cookie problem after a deploy.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      "/api": { target: "http://127.0.0.1:3001" },
      "/ws": { target: "http://127.0.0.1:3001", ws: true },
    },
  },
});

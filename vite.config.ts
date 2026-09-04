import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@futuraria/shared": "/src/shared",
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3001",
      "/mcp": "http://localhost:3001",
    },
  },
  // `vite preview` does NOT inherit server.proxy: without its own proxy every
  // /api request hits the SPA fallback and returns index.html (200, HTML),
  // which the frontend reads as "Unexpected token '<'… is not valid JSON".
  preview: {
    proxy: {
      "/api": "http://localhost:3001",
      "/mcp": "http://localhost:3001",
    },
  },
});

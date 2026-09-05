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
    // Windows fragility: chokidar dies with EBUSY when a watched file gets
    // locked (editor save, sync tool). It killed Vite once via
    // brand_guides_platform/index.html. None of these dirs feed the app
    // build, so excluding them both fixes the crash class and lightens the
    // watcher. public/ and src/ stay watched on purpose.
    watch: {
      ignored: [
        "**/brand_guides_platform/**",
        "**/dt-main/**",
        "**/exports_ig/**",
        "**/exports_pa/**",
        "**/models-cache/**",
        "**/.netlify/**",
        "**/.pnpm-store/**",
        "**/.tmp/**",
      ],
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

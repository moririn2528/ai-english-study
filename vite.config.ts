import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: { modulePreload: { polyfill: false } },
  // `npm run dev:api` runs the relay Worker locally; Origin is rewritten so its same-origin check passes.
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", headers: { origin: "http://127.0.0.1:8787" } },
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts", "worker/**/*.test.ts"] },
} as Parameters<typeof defineConfig>[0]);

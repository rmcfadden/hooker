import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// `hooker serve` (default port 4180) owns the /api/* routes and the SQLite DB. In dev the Vite
// server proxies those calls through so the React app is identical whether run from `npm run dev`
// or served from the built bundle. Override the target with HOOKER_API when serving on another port.
const apiTarget = process.env.HOOKER_API ?? "http://127.0.0.1:4180";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});

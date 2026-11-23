import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// `pnpm console:dev` serves the app on 7358 with hot reload and sends the API, the sign-in, run
// reports and run files to the console (`pnpm console`, 7357, or QA_CONSOLE_PORT).
// `pnpm console:setup` builds dist/, which the console serves itself.

const CONSOLE_URL = `http://127.0.0.1:${process.env.QA_CONSOLE_PORT ?? "7357"}`;

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("../shared", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 7358,
    strictPort: true,
    // The app imports console/shared and the engine's event schema from outside its folder.
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
    proxy: {
      "/api": { target: CONSOLE_URL },
      "/auth": { target: CONSOLE_URL },
      "^/runs/[^/]+/(report|files)": { target: CONSOLE_URL },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // One bundle, read from the local disk: its size does not matter here.
    chunkSizeWarningLimit: 1024,
  },
});

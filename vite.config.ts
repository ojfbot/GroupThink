import { resolve } from "node:path";
import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import manifest from "./src/manifest.json";

export default defineConfig({
  plugins: [react(), crx({ manifest: manifest as any })],
  build: {
    rollupOptions: {
      input: {
        app: resolve(__dirname, "src/app/index.html"),
      },
    },
  },
  test: {
    globals: true,
    environment: "happy-dom",
  },
});

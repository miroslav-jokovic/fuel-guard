import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// One id per BUILD: the Railway commit SHA when deployed, else the build instant. It is baked into the
// bundle (__APP_VERSION__) AND emitted as /version.json, so a running tab can detect that a newer build
// has shipped and offer a refresh (see composables/useAppUpdate.ts).
const buildId = process.env.RAILWAY_GIT_COMMIT_SHA ?? `local-${Date.now()}`;

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    {
      name: "fuelguard-emit-version",
      apply: "build",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: JSON.stringify({ version: buildId }),
        });
      },
    },
  ],
  define: {
    __APP_VERSION__: JSON.stringify(buildId),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
});

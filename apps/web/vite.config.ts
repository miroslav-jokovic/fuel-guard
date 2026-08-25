import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { Features } from "lightningcss";

// One id per BUILD: the Railway commit SHA when deployed, else the build instant. It is baked into the
// bundle (__APP_VERSION__) AND emitted as /version.json, so a running tab can detect that a newer build
// has shipped and offer a refresh (see composables/useAppUpdate.ts).
const buildId = process.env.RAILWAY_GIT_COMMIT_SHA ?? `local-${Date.now()}`;

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  if (mode === "production") {
    const missing = [
      !process.env.VITE_SUPABASE_URL && "VITE_SUPABASE_URL",
      !process.env.VITE_SUPABASE_ANON_KEY && "VITE_SUPABASE_ANON_KEY",
    ].filter(Boolean);
    if (missing.length) throw new Error(`Production web build is missing: ${missing.join(", ")}`);
  }
  return {
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
    /**
     * Keep `light-dark()` native (D-DS2).
     *
     * Lightning CSS minifies this project's CSS, and by default it TRANSPILES `light-dark()` into
     * `var(--lightningcss-light, …) var(--lightningcss-dark, …)` switched by a
     * `@media (prefers-color-scheme: dark)` block. That polyfill follows the OPERATING SYSTEM and
     * nothing else, which made the in-app scheme toggle structurally impossible: `color-scheme` on
     * <html> could never reach it, so picking Light while the OS was dark changed nothing. Dark had
     * only ever looked right because the OS agreed.
     *
     * `build.cssTarget` does NOT govern this — Lightning CSS takes its own options — so the transform
     * is excluded by name. Every browser that ships `color-scheme` support also ships `light-dark()`,
     * so there is no browser for which the polyfill was buying anything a toggle would not break.
     */
    css: {
      lightningcss: { exclude: Features.LightDark },
    },
    build: {
      chunkSizeWarningLimit: 1050,
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        // Vendored third-party builds live OUTSIDE src so lint, coverage and the file-size budget do
        // not treat a megabyte of somebody else's minified code as ours. See vendor/sheetjs/README.md.
        "@vendor": fileURLToPath(new URL("./vendor", import.meta.url)),
      },
    },
    server: {
      port: 5173,
    },
  };
});

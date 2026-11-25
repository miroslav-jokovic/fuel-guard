import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";
import { portalTokens } from "./src/portal/rootBlock";
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
        // The driver's training page takes the design system's COLOUR TOKENS and nothing else: importing
        // tokens.generated.css whole brings Tailwind and every utility the office app uses (115 KB of CSS,
        // measured 2026-11-25). This hands the page the token file's `:root` block and its `--color-*` names (`portalTokens`), read at build time,
        // so the colours are derived from the one source and never restated (SAFETY-VIDEOS D-TR12).
        name: "silvicom-portal-tokens",
        resolveId: (id) => (id === "virtual:portal-tokens.css" ? "\0portal-tokens.css" : null),
        load(id) {
          if (id !== "\0portal-tokens.css") return null;
          const file = fileURLToPath(new URL("../../packages/ui/src/tokens.generated.css", import.meta.url));
          this.addWatchFile(file);
          return portalTokens(readFileSync(file, "utf8"));
        },
      },
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
      // Two entries: the office app, and the driver's training link (`/t/:token`), which is kept apart so a
      // weak signal loads a few kilobytes instead of the app (SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS D-TR12).
      rollupOptions: {
        input: {
          main: fileURLToPath(new URL("./index.html", import.meta.url)),
          t: fileURLToPath(new URL("./t.html", import.meta.url)),
        },
      },
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

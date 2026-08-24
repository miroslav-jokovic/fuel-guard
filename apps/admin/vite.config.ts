import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { Features } from "lightningcss";

// Platform (admin) SPA. Served in production by apps/admin-api on the admin subdomain.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
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
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: { port: 5174 },
});

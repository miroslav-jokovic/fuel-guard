import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Mirrors vite.config.ts — vendored third-party builds live outside src.
      "@vendor": fileURLToPath(new URL("./vendor", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts"],
    // What jsdom is missing and any suite opening a dialog needs — see the file's own header for
    // why it is here rather than copied into a fourth test file.
    setupFiles: ["./vitest.setup.ts"],
  },
});

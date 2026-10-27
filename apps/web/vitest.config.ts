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
    // tutorials/: the narration trim's cases (`tutorials/produce/bracketTrim.test.ts`); the rest of
    // that folder is Playwright, run by `tutorials --check`, and named *.spec.ts so this never collects it.
    include: ["src/**/*.test.ts", "tutorials/**/*.test.ts"],
    // What jsdom is missing and any suite opening a dialog needs — see the file's own header for
    // why it is here rather than copied into a fourth test file.
    // The one jsdom setup, in the package whose dialogs need it (US7: BaseModal moved there).
    setupFiles: ["../../packages/ui/vitest.setup.ts"],
  },
});

import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

/**
 * The admin console had no test runner until US7 (D-US11). Its pages were hand-built and nothing
 * checked them; rebuilt on the shared list kit, they carry behaviour worth pinning — a failed read
 * that must not read as "No one on the list", a revoke that must ask first, a record that must say
 * it is missing. The jsdom setup is the shared one (`BaseModal` needs its `ResizeObserver` stub).
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts"],
    setupFiles: ["../../packages/ui/vitest.setup.ts"],
  },
});

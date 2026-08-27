import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

/**
 * `@silvicom/ui` had no test runner until U4 (UI plan, D-UI4).
 *
 * That was tolerable while the package held only presentational primitives whose whole behaviour was
 * their class list — `lint:tests` reported "no tests" for it and nothing was lost. `AppTabs` ends
 * that: it owns a roving tabindex and four arrow keys, which is real behaviour, and the reason it
 * exists at all is that six hand-rolled copies got that behaviour wrong. Shipping the fix untested
 * would repeat the mistake in one place instead of six.
 */
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});

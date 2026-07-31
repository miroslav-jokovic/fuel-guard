import { defineConfig } from "vitest/config";

// On the device the workspace resolves @hazmat/engine + @hazmat/data via pnpm — no aliases needed.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});

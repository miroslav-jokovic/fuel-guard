import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Every test runs with DNS stubbed — see the file for why, and for the 39 tests that were
    // silently resolving a real vendor hostname before it existed.
    setupFiles: ["src/testing/setupOutboundDns.ts"],
  },
});

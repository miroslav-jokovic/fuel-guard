import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Pure logic tests only (no RN renderer). Component render tests use @testing-library/react-native
// in a later increment. @silvicom/shared resolves to its built dist (run build:rn first).
export default defineConfig({
  resolve: {
    alias: {
      '@silvicom/shared': path.resolve(__dirname, '../../packages/shared/dist/index.js'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    // Every co-located test counts. This was 'tests/**/*.test.ts' only, which silently excluded
    // src/data/policy.test.ts (offline outbox retry policy, 20 cases) and src/lib/jwt.test.ts
    // (driver auth-claim decoding, 4 cases) — 24 tests that had never executed, and passed the
    // moment they were collected. scripts/check-test-collection.mjs now fails the build if any
    // *.test.ts(x) file is not collected by its workspace runner (audit 2026-08-09, finding 5.2).
    include: ['tests/**/*.test.ts?(x)', 'src/**/*.test.ts?(x)'],
    environment: 'node',
  },
});

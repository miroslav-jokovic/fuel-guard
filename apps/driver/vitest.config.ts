import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Pure logic tests only (no RN renderer). Component render tests use @testing-library/react-native
// in a later increment. @fuelguard/shared resolves to its built dist (run build:rn first).
export default defineConfig({
  resolve: {
    alias: {
      '@fuelguard/shared': path.resolve(__dirname, '../../packages/shared/dist/index.js'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});

import { defineConfig } from 'vitest/config';
import { TEST_KIND_TAGS } from '../../vitest.kinds.ts';

export default defineConfig({
  test: {
    // Persist transformed modules across runs (per-project cache; see vitest.monorepo.ts).
    fsModuleCache: true,
    tags: TEST_KIND_TAGS,
    coverage: {
      provider: 'v8',
      enabled: true,
      reportsDirectory: '.output/coverage',
      reporter: ['text-summary', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.*', '**/*.stories.*', '**/*.d.ts', '**/test/**', '**/test-fixtures/**'],
    },
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
});

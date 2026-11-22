import { defineConfig } from 'vitest/config';

/** Runs every workspace package's own Vitest config as one project each. */
export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts'],
  },
});

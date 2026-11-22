import { defineConfig } from 'vitest/config';
import { TEST_KIND_TAGS } from './vitest.kinds.ts';

export default defineConfig({
  test: {
    // Persist transformed modules across runs (per-project cache; see vitest.monorepo.ts).
    fsModuleCache: true,
    tags: TEST_KIND_TAGS,
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: [
      'src/**/*.test.{ts,tsx}',
      'server/**/*.test.ts',
      'cli/**/*.test.ts',
      'scripts/**/*.test.ts',
      'demos/**/*.test.ts',
    ],
    // 15s is a liveness bound, not an assertion: `bun run test` runs ~10 packages concurrently via
    // turbo, and on a CPU-starved runner even the fast, in-memory `SimpleHistoryProvider` renders in
    // `App.test.tsx` can blow past vitest's 5s default. Matches the repo-wide 15s convention (see
    // admin-ui, url-state, console.salir.se, app.salir.se, and other sibling configs). The single
    // ADR-203 integration test that boots the real history provider (WebCrypto digests +
    // isomorphic-git seeding) keeps its own larger per-test timeout on top of this budget.
    testTimeout: 15_000,
  },
});

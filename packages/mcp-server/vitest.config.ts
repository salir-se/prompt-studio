import { defineConfig } from 'vitest/config';
import { TEST_KIND_TAGS } from '../../vitest.kinds.ts';

// This workspace previously ran on bare vitest defaults (no config file). It
// needs one now for exactly one thing: declaring the repo-wide test-kind tags
// so `strictTags` accepts the `// @module-tag <kind>` pragma every test file
// carries. Everything else stays on defaults.
export default defineConfig({
  test: {
    // Persist transformed modules across runs (per-project cache; see vitest.monorepo.ts).
    fsModuleCache: true,
    tags: TEST_KIND_TAGS,
  },
});

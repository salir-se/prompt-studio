import { defineConfig } from 'vitest/config';
import { TEST_KIND_TAGS } from '../../vitest.kinds.ts';

export default defineConfig({
  test: { tags: TEST_KIND_TAGS, environment: 'node', globals: true },
});

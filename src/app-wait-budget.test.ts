// @vitest-environment node
// @module-tag pure
/**
 * The App test harness waits for the UI (`flushUntil`) under the test's own 15 s budget, not a shorter clock. A 5 s
 * wait lost the race on a loaded CI runner (PR #3006: the history provider had not booted by 5 s), then the abandoned
 * act loop logged "overlapping act() calls" and failed the console guard as well.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import config from '../vitest.config';
import { APP_UI_WAIT_MS } from './app-wait-budget';

const harness = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'App.test-harness.tsx'), 'utf8');

it('waits for the UI until just short of the test budget', () => {
  // Given: the package's per-test liveness budget
  const testTimeout = config.test?.testTimeout ?? 0;
  // When: the harness's UI wait is read
  // Then: it ends inside the budget, at most 1 s before it, so a slow boot is not a failure
  expect(APP_UI_WAIT_MS).toBeLessThan(testTimeout);
  expect(APP_UI_WAIT_MS).toBeGreaterThanOrEqual(testTimeout - 1_000);
});

it('flushUntil uses that budget by default, not its own shorter clock', () => {
  // Given: the App test harness source
  // When: its flushUntil signature is read
  // Then: the default timeout is the shared budget
  expect(harness).toMatch(/async function flushUntil\(condition: \(\) => boolean, timeout = APP_UI_WAIT_MS\)/);
});

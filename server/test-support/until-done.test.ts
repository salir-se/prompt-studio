// @vitest-environment node
// @module-tag pure
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import config from '../../vitest.config';
import { BACKGROUND_WORK_WAIT, untilDone } from './until-done';

const serverDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function serverTestFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'test-support' ? [] : serverTestFiles(full);
    return entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

it('bounds the wait by the test budget, not by vi.waitFor’s 1 s default', async () => {
  // Given: the package's per-test liveness budget
  const testTimeout = config.test?.testTimeout ?? 0;
  // When: a test waits for work that is already done
  // Then: the value comes back, and the wait outlasts vi.waitFor's default yet ends inside the budget
  await expect(untilDone(() => 'done')).resolves.toBe('done');
  expect(BACKGROUND_WORK_WAIT.timeout).toBeGreaterThan(1_000);
  expect(BACKGROUND_WORK_WAIT.timeout).toBeLessThan(testTimeout);
});

it('no server test waits on background work with a bare vi.waitFor', () => {
  // Given: every server test file
  // When: they are scanned for vi.waitFor
  const offenders = serverTestFiles(serverDir)
    .filter((file) => readFileSync(file, 'utf8').includes('vi.waitFor('))
    .map((file) => path.relative(serverDir, file));
  // Then: none uses it directly — untilDone carries the test-budget timeout
  expect(offenders).toEqual([]);
});

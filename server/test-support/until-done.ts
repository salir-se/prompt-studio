import { vi } from 'vitest';

/**
 * Wait for background work a server test cannot await directly — a run or an evaluation finishing
 * on disk after its route already answered.
 *
 * `vi.waitFor` gives up after 1 s by default: a second, much shorter clock inside the test's own
 * 15 s liveness budget. A CPU-starved CI runner loses that race while the work is still progressing
 * (2026-10-27: an evaluation with two 128 KB answers missed it on PR #2637 and passed on retry), so
 * every server wait goes through here instead. The wait stops just short of the test timeout so a
 * real hang still fails with the last assertion rather than a bare "Test timed out".
 * `until-done.test.ts` fails if a server test calls `vi.waitFor` directly.
 */
export const BACKGROUND_WORK_WAIT = { timeout: 14_000, interval: 20 } as const;

export function untilDone<T>(check: () => T | Promise<T>): Promise<T> {
  return vi.waitFor(check, BACKGROUND_WORK_WAIT);
}

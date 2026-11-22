// Log-quality assertions — let a test verify that the code under test emitted
// the milestone log lines a human reading the captured buffer would expect.
//
// Use case: instead of asserting only the function's return value, also assert
// that "milestone X happened with payload Y" was logged. This is the lever
// that turns the dump-on-fail buffer into a coverage probe for observability.
//
// Example:
//   import { consoleBuffer, expectMilestone } from '@prompt-studio/observability/test';
//
//   it('logs the welcome-email send result', async () => {
//     await sendWelcomeEmail(...);
//     expectMilestone(consoleBuffer, { method: 'info', includes: 'welcome email sent' });
//   });

import type { ConsoleBufferEntry } from './console-silencer';

export interface MilestoneSpec {
  /** Console method the milestone should appear under. Omit to match any. */
  method?: ConsoleBufferEntry['method'];
  /**
   * String the formatted args must contain (case-sensitive). Matches against
   * the joined string form of every arg, so it works for both `console.info('x')`
   * and `logger.info({ user: 'a' }, 'x')`.
   */
  includes?: string;
  /** Regex the formatted args must match. */
  match?: RegExp;
  /** Predicate run on the raw entry — escape hatch for complex shapes. */
  predicate?: (entry: ConsoleBufferEntry) => boolean;
}

/** Buffer-shaped object with `entries` — what installConsoleSilencer exposes. */
export interface BufferLike {
  readonly entries: readonly ConsoleBufferEntry[];
}

function formatArgs(args: readonly unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.message;
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

export function entryMatches(entry: ConsoleBufferEntry, spec: MilestoneSpec): boolean {
  if (spec.method && entry.method !== spec.method) return false;
  const formatted = formatArgs(entry.args);
  if (spec.includes && !formatted.includes(spec.includes)) return false;
  if (spec.match && !spec.match.test(formatted)) return false;
  if (spec.predicate && !spec.predicate(entry)) return false;
  return true;
}

/**
 * Find every entry that matches `spec`. Returns a copy — safe to inspect
 * without affecting the live buffer.
 */
export function findMilestones(buffer: BufferLike, spec: MilestoneSpec): ConsoleBufferEntry[] {
  return buffer.entries.filter((e) => entryMatches(e, spec));
}

/**
 * Throw if no entry matches `spec`. The error includes a dump of the buffer's
 * current contents so the test reader sees what _was_ logged next to what was
 * expected — saves a round-trip into the captured-stderr block.
 */
export function expectMilestone(buffer: BufferLike, spec: MilestoneSpec): void {
  const matches = findMilestones(buffer, spec);
  if (matches.length === 0) {
    throw new Error(buildFailure('expected at least one matching log entry', spec, buffer));
  }
}

/**
 * Throw if any entry matches `spec`. Useful for asserting "we did NOT log a
 * stack trace on the happy path" or "no error was emitted".
 */
export function expectNoMilestone(buffer: BufferLike, spec: MilestoneSpec): void {
  const matches = findMilestones(buffer, spec);
  if (matches.length > 0) {
    throw new Error(buildFailure(`expected no matches but found ${matches.length}`, spec, buffer));
  }
}

/**
 * Throw unless the milestones described by `specs` appear in the same order
 * as listed (with arbitrary entries allowed between). Lets a test pin down
 * a sequence — e.g. "first we logged 'connecting', later we logged 'connected'".
 */
export function expectMilestoneOrder(buffer: BufferLike, specs: readonly MilestoneSpec[]): void {
  let cursor = 0;
  for (const spec of specs) {
    let found = -1;
    for (let i = cursor; i < buffer.entries.length; i++) {
      if (entryMatches(buffer.entries[i], spec)) {
        found = i;
        break;
      }
    }
    if (found === -1) {
      throw new Error(buildFailure('milestones did not appear in expected order', spec, buffer));
    }
    cursor = found + 1;
  }
}

function buildFailure(message: string, spec: MilestoneSpec, buffer: BufferLike): string {
  const expected = describeSpec(spec);
  const actual =
    buffer.entries.length === 0
      ? '(buffer empty — no log entries captured)'
      : buffer.entries.map((e) => `  [${e.method}] ${formatArgs(e.args)}`).join('\n');
  return `${message}\n  expected milestone: ${expected}\n  buffered entries:\n${actual}`;
}

function describeSpec(spec: MilestoneSpec): string {
  const parts: string[] = [];
  if (spec.method) parts.push(`method=${spec.method}`);
  if (spec.includes) parts.push(`includes=${JSON.stringify(spec.includes)}`);
  if (spec.match) parts.push(`match=${spec.match}`);
  if (spec.predicate) parts.push('predicate=<fn>');
  return parts.length > 0 ? `{ ${parts.join(', ')} }` : '<empty spec — would match anything>';
}

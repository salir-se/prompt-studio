// @module-tag pure
import { describe, expect, it } from 'vitest';
import type { ConsoleBufferEntry } from './console-silencer';
import {
  type BufferLike,
  entryMatches,
  expectMilestone,
  expectMilestoneOrder,
  expectNoMilestone,
  findMilestones,
} from './log-assertions';

function makeBuffer(entries: ConsoleBufferEntry[]): BufferLike {
  return { entries };
}

const sample: ConsoleBufferEntry[] = [
  { method: 'info', args: ['connecting to', 'gmail-api'], timestamp: 1, testName: 't' },
  { method: 'info', args: [{ user: 'a@x.com' }, 'oauth nonce minted'], timestamp: 2, testName: 't' },
  { method: 'warn', args: ['rate limit nearing', { remaining: 12 }], timestamp: 3, testName: 't' },
  { method: 'info', args: ['connected'], timestamp: 4, testName: 't' },
];

describe('entryMatches', () => {
  it('matches by method', () => {
    expect(entryMatches(sample[0], { method: 'info' })).toBe(true);
    expect(entryMatches(sample[0], { method: 'warn' })).toBe(false);
  });

  it('matches by string include against the joined arg form', () => {
    expect(entryMatches(sample[0], { includes: 'gmail-api' })).toBe(true);
    expect(entryMatches(sample[1], { includes: 'oauth nonce' })).toBe(true);
    // Object args are JSON-stringified before include check
    expect(entryMatches(sample[1], { includes: 'a@x.com' })).toBe(true);
  });

  it('matches by regex', () => {
    expect(entryMatches(sample[2], { match: /rate limit/i })).toBe(true);
    expect(entryMatches(sample[2], { match: /^connected$/ })).toBe(false);
  });

  it('matches by custom predicate', () => {
    expect(
      entryMatches(sample[1], {
        predicate: (e) => typeof e.args[0] === 'object' && (e.args[0] as { user: string }).user === 'a@x.com',
      }),
    ).toBe(true);
  });

  it('AND-combines spec fields', () => {
    expect(entryMatches(sample[0], { method: 'info', includes: 'gmail-api' })).toBe(true);
    expect(entryMatches(sample[0], { method: 'warn', includes: 'gmail-api' })).toBe(false);
    expect(entryMatches(sample[0], { method: 'info', includes: 'no-match' })).toBe(false);
  });
});

describe('findMilestones', () => {
  it('returns every match', () => {
    expect(findMilestones(makeBuffer(sample), { method: 'info' })).toHaveLength(3);
  });

  it('returns empty when nothing matches', () => {
    expect(findMilestones(makeBuffer(sample), { method: 'error' })).toHaveLength(0);
  });
});

describe('expectMilestone', () => {
  it('passes when at least one entry matches', () => {
    expect(() => expectMilestone(makeBuffer(sample), { includes: 'connected' })).not.toThrow();
  });

  it('throws with a descriptive error when nothing matches', () => {
    let caught: Error | undefined;
    try {
      expectMilestone(makeBuffer(sample), { method: 'error' });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toContain('expected at least one matching log entry');
    expect(caught?.message).toContain('method=error');
    // Failure message includes the buffer dump so the reader sees what *was* logged
    expect(caught?.message).toContain('connecting to');
    expect(caught?.message).toContain('rate limit nearing');
  });

  it('says "buffer empty" when nothing was captured', () => {
    let caught: Error | undefined;
    try {
      expectMilestone(makeBuffer([]), { method: 'info' });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.message).toContain('buffer empty');
  });
});

describe('expectNoMilestone', () => {
  it('passes when no entries match', () => {
    expect(() => expectNoMilestone(makeBuffer(sample), { method: 'error' })).not.toThrow();
  });

  it('throws when any entry matches', () => {
    expect(() => expectNoMilestone(makeBuffer(sample), { method: 'warn' })).toThrow(/expected no matches but found 1/);
  });
});

describe('expectMilestoneOrder', () => {
  it('passes when milestones appear in the requested order', () => {
    expect(() =>
      expectMilestoneOrder(makeBuffer(sample), [
        { includes: 'connecting' },
        { includes: 'oauth nonce' },
        { includes: 'connected' },
      ]),
    ).not.toThrow();
  });

  it('passes even when extra log entries appear between the milestones', () => {
    expect(() =>
      expectMilestoneOrder(makeBuffer(sample), [{ includes: 'connecting' }, { includes: 'connected' }]),
    ).not.toThrow();
  });

  it('throws when milestones appear in the wrong order', () => {
    expect(() =>
      expectMilestoneOrder(makeBuffer(sample), [{ includes: 'connected' }, { includes: 'connecting' }]),
    ).toThrow(/milestones did not appear in expected order/);
  });

  it('throws when a milestone is missing entirely', () => {
    expect(() => expectMilestoneOrder(makeBuffer(sample), [{ includes: 'connecting' }, { method: 'error' }])).toThrow(
      /milestones did not appear/,
    );
  });
});

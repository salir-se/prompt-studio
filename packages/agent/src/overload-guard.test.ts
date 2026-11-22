// @module-tag pure
const mockLog = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@prompt-studio/observability', () => ({
  createLogger: () => mockLog,
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calculateLlmRetryDelayMs,
  calculateLlmRetryDelayMsV1,
  calculateLlmRetryDelayMsV2,
  createLlmOverloadGuard,
  isOverloadStatus,
  type LlmOverloadGuard,
  llmOverloadGuard,
  type LlmOverloadStoragePort,
  parseRetryAfterMs,
} from './overload-guard';

// ── Test helpers ────────────────────────────────────────────────────────

/** A representative overload status used across guard-behavior tests. */
const OVERLOAD_STATUS = 529;

/** Injectable, fully controllable fake clock -- never real timers/Date.now. */
function createClock(initial = 0): { now: () => number; set: (ms: number) => void; advance: (ms: number) => void } {
  let current = initial;
  return {
    now: () => current,
    set: (ms: number) => {
      current = ms;
    },
    advance: (ms: number) => {
      current += ms;
    },
  };
}

/** Minimal in-memory fake storage port, with `.data` exposed for assertions. */
function createFakeStorage(
  initial: Record<string, string> = {},
): LlmOverloadStoragePort & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

function recordN(guard: LlmOverloadGuard, count: number, status: number): void {
  for (let i = 0; i < count; i++) guard.recordOverload(status);
}

function recordSuccessN(guard: LlmOverloadGuard, count: number): void {
  for (let i = 0; i < count; i++) guard.recordSuccess();
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── isOverloadStatus ───────────────────────────────────────────────────

describe('isOverloadStatus', () => {
  it.each([429, 503, 529])('returns true for %d', (status) => {
    expect(isOverloadStatus(status)).toBe(true);
  });

  it.each([200, 400, 401, 403, 404, 500, 502, 504])('returns false for %d', (status) => {
    expect(isOverloadStatus(status)).toBe(false);
  });
});

// ── parseRetryAfterMs ──────────────────────────────────────────────────

describe('parseRetryAfterMs', () => {
  it('parses the integer-seconds form', () => {
    expect(parseRetryAfterMs('120')).toBe(120_000);
  });

  it('parses zero seconds', () => {
    expect(parseRetryAfterMs('0')).toBe(0);
  });

  it('rejects a negative integer-seconds form', () => {
    expect(parseRetryAfterMs('-5')).toBeNull();
  });

  it('parses the HTTP-date form relative to an injected now', () => {
    const now = () => Date.parse('2026-01-01T00:00:00.000Z');
    const header = new Date(Date.parse('2026-01-01T00:01:00.000Z')).toUTCString();
    expect(parseRetryAfterMs(header, now)).toBe(60_000);
  });

  it('clamps an HTTP-date already in the past to 0', () => {
    const now = () => Date.parse('2026-01-01T00:05:00.000Z');
    const header = new Date(Date.parse('2026-01-01T00:00:00.000Z')).toUTCString();
    expect(parseRetryAfterMs(header, now)).toBe(0);
  });

  it.each(['not-a-date-or-number', '', 'NaN', 'Infinity'])('returns null for garbage input %j', (value) => {
    expect(parseRetryAfterMs(value)).toBeNull();
  });

  it('returns null for a null header', () => {
    expect(parseRetryAfterMs(null)).toBeNull();
  });
});

// ── calculateLlmRetryDelayMsV1 ────────────────────────────────────────

describe('calculateLlmRetryDelayMsV1', () => {
  it.each([
    [0, 1000, 1000],
    [1, 1000, 2000],
    [2, 1000, 4000],
  ])('attempt=%d retryDelayMs=%d -> %d (pins pre-guard api.ts behavior)', (attempt, retryDelayMs, expected) => {
    expect(calculateLlmRetryDelayMsV1(attempt, retryDelayMs)).toBe(expected);
  });
});

// ── calculateLlmRetryDelayMsV2 ────────────────────────────────────────

describe('calculateLlmRetryDelayMsV2', () => {
  it('delegates exactly to V1 for non-overload statuses', () => {
    const result = calculateLlmRetryDelayMsV2({ status: 500, attempt: 2, retryDelayMs: 1000 });
    expect(result).toBe(calculateLlmRetryDelayMsV1(2, 1000));
  });

  it('floors the overload base delay at 5000ms even when retryDelayMs is smaller', () => {
    const result = calculateLlmRetryDelayMsV2({
      status: OVERLOAD_STATUS,
      attempt: 0,
      retryDelayMs: 1000,
      random: () => 0,
    });
    // base = max(1000, 5000) * 2**0 = 5000; jitter @random=0 -> *0.8 = 4000
    expect(result).toBe(4000);
  });

  it('applies the lower jitter bound (0.8x) when random() = 0', () => {
    const result = calculateLlmRetryDelayMsV2({ status: 429, attempt: 1, retryDelayMs: 5000, random: () => 0 });
    // base = 5000*2 = 10000; *0.8 = 8000
    expect(result).toBe(8000);
  });

  it('applies the upper jitter bound (1.2x) when random() = 1', () => {
    const result = calculateLlmRetryDelayMsV2({ status: 429, attempt: 1, retryDelayMs: 5000, random: () => 1 });
    // base = 5000*2 = 10000; *1.2 = 12000 (toBeCloseTo: 0.8 + 1*0.4 has float noise)
    expect(result).toBeCloseTo(12000, 6);
  });

  it('caps the jittered delay at 60s', () => {
    const result = calculateLlmRetryDelayMsV2({ status: 503, attempt: 5, retryDelayMs: 5000, random: () => 1 });
    // base = 5000*32 = 160000; *1.2 ~ 192000 -> capped to 60000 (Math.min clips the float noise too)
    expect(result).toBe(60_000);
  });

  it('honors Retry-After when larger than the jittered delay, capped at 120s', () => {
    const result = calculateLlmRetryDelayMsV2({
      status: 429,
      attempt: 0,
      retryDelayMs: 1000,
      random: () => 0,
      retryAfterMs: 200_000,
    });
    // jittered = 4000; retryAfter floor = min(200000,120000) = 120000; max(4000,120000) = 120000
    expect(result).toBe(120_000);
  });

  it('ignores Retry-After when smaller than the jittered delay', () => {
    const result = calculateLlmRetryDelayMsV2({
      status: 429,
      attempt: 3,
      retryDelayMs: 5000,
      random: () => 1,
      retryAfterMs: 1000,
    });
    // base = 5000*8 = 40000; *1.2 ~ 48000; retryAfter floor = 1000; max(48000,1000) = 48000
    expect(result).toBeCloseTo(48_000, 6);
  });

  it('defaults random to Math.random when omitted, staying within jitter bounds', () => {
    const result = calculateLlmRetryDelayMsV2({ status: 429, attempt: 0, retryDelayMs: 1000 });
    expect(result).toBeGreaterThanOrEqual(4000);
    expect(result).toBeLessThanOrEqual(6000);
  });
});

describe('calculateLlmRetryDelayMs alias', () => {
  it('is exactly calculateLlmRetryDelayMsV2 (the "final" alias callers use)', () => {
    expect(calculateLlmRetryDelayMs).toBe(calculateLlmRetryDelayMsV2);
  });
});

// ── LlmOverloadGuard: trip threshold ──────────────────────────────────

describe('llm overload guard: healthy -> cooldown trip', () => {
  it('does not trip after 3 overloads (below the default threshold of 4)', () => {
    const guard = createLlmOverloadGuard({ now: () => 0 });
    recordN(guard, 3, OVERLOAD_STATUS);
    const snap = guard.getSnapshot();
    expect(snap.state).toBe('healthy');
    expect(snap.recentOverloads).toBe(3);
  });

  it('trips into cooldown on the 4th overload within the window', () => {
    const guard = createLlmOverloadGuard({ now: () => 0 });
    recordN(guard, 4, OVERLOAD_STATUS);
    const snap = guard.getSnapshot();
    expect(snap.state).toBe('cooldown');
    expect(snap.consecutiveTrips).toBe(1);
    expect(snap.cooldownUntil).toBe(60_000);
    expect(snap.recentOverloads).toBe(4);
  });

  it('prunes events outside the window so stale overloads do not count toward the threshold', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now, windowMs: 120_000 });
    guard.recordOverload(OVERLOAD_STATUS); // t=0, will age out
    clock.set(130_000); // > 120_000ms later -- outside the window
    recordN(guard, 3, OVERLOAD_STATUS); // 3 fresh events; the stale t=0 event must not count
    const snap = guard.getSnapshot();
    expect(snap.state).toBe('healthy');
    expect(snap.recentOverloads).toBe(3);
  });
});

describe('llm overload guard: escalation', () => {
  it('doubles the cooldown duration on each consecutive trip and caps at maxCooldownMs', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });

    recordN(guard, 4, OVERLOAD_STATUS); // trip #1 at t=0
    expect(guard.getSnapshot().cooldownUntil).toBe(60_000);

    const retripAt = (deadline: number, expectedNextCooldownUntil: number): void => {
      clock.set(deadline);
      expect(guard.getSnapshot().state).toBe('recovery'); // lazy advance past the deadline
      guard.recordOverload(OVERLOAD_STATUS); // single overload re-trips immediately (escalated)
      expect(guard.getSnapshot().cooldownUntil).toBe(expectedNextCooldownUntil);
    };

    retripAt(60_000, 60_000 + 120_000); // trip #2: base*2**1 = 120000
    retripAt(180_000, 180_000 + 240_000); // trip #3: base*2**2 = 240000
    retripAt(420_000, 420_000 + 480_000); // trip #4: base*2**3 = 480000
    retripAt(900_000, 900_000 + 900_000); // trip #5: base*2**4 = 960000 -> capped at 900000

    expect(guard.getSnapshot().consecutiveTrips).toBe(5);
  });
});

describe('llm overload guard: retryAfterMs floor on trip', () => {
  it('extends cooldownUntil when retryAfterMs is larger than the escalated cooldown', () => {
    const clock = createClock(1_000_000);
    const guard = createLlmOverloadGuard({ now: clock.now });
    recordN(guard, 3, OVERLOAD_STATUS);
    guard.recordOverload(OVERLOAD_STATUS, 500_000); // 4th trips; base cooldown would only be 60_000
    expect(guard.getSnapshot().cooldownUntil).toBe(1_000_000 + 500_000);
  });

  it('keeps the computed cooldown when retryAfterMs is smaller', () => {
    const clock = createClock(1_000_000);
    const guard = createLlmOverloadGuard({ now: clock.now });
    recordN(guard, 3, OVERLOAD_STATUS);
    guard.recordOverload(OVERLOAD_STATUS, 1_000);
    expect(guard.getSnapshot().cooldownUntil).toBe(1_000_000 + 60_000);
  });

  it('caps a huge retryAfterMs at maxCooldownMs (default 15 min) rather than honoring it verbatim', () => {
    const clock = createClock(1_000_000);
    const guard = createLlmOverloadGuard({ now: clock.now });
    recordN(guard, 3, OVERLOAD_STATUS);
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    guard.recordOverload(OVERLOAD_STATUS, thirtyDaysMs);
    expect(guard.getSnapshot().cooldownUntil).toBe(1_000_000 + 900_000);
  });

  it('caps retryAfterMs at an injected maxCooldownMs when it is below the default', () => {
    const clock = createClock(1_000_000);
    const guard = createLlmOverloadGuard({ now: clock.now, maxCooldownMs: 120_000 });
    recordN(guard, 3, OVERLOAD_STATUS);
    guard.recordOverload(OVERLOAD_STATUS, 500_000);
    expect(guard.getSnapshot().cooldownUntil).toBe(1_000_000 + 120_000);
  });

  it('logs the raw uncapped retryAfterMs on the trip warn log', () => {
    const clock = createClock(1_000_000);
    const guard = createLlmOverloadGuard({ now: clock.now });
    recordN(guard, 3, OVERLOAD_STATUS);
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    guard.recordOverload(OVERLOAD_STATUS, thirtyDaysMs);
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({ retryAfterMs: thirtyDaysMs }),
      'LLM overload cooldown started',
    );
  });

  it('logs retryAfterMs as null when the header was absent', () => {
    const clock = createClock(1_000_000);
    const guard = createLlmOverloadGuard({ now: clock.now });
    recordN(guard, 3, OVERLOAD_STATUS);
    guard.recordOverload(OVERLOAD_STATUS);
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({ retryAfterMs: null }),
      'LLM overload cooldown started',
    );
  });
});

describe('llm overload guard: lazy cooldown -> recovery transition', () => {
  it('stays in cooldown until now reaches cooldownUntil, then advances only on read', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });
    recordN(guard, 4, OVERLOAD_STATUS);
    expect(guard.getSnapshot().state).toBe('cooldown');
    clock.set(59_999);
    expect(guard.getSnapshot().state).toBe('cooldown');
    clock.set(60_000);
    expect(guard.getSnapshot().state).toBe('recovery');
  });

  it('does not advance from recordSuccess alone -- only the 4 read methods lazily advance', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });
    recordN(guard, 4, OVERLOAD_STATUS);
    clock.set(60_000); // deadline reached, but nothing has read state yet
    guard.recordSuccess(); // per contract this must be a no-op: state is still (stale) 'cooldown'
    const snap = guard.getSnapshot(); // this call performs the lazy advance
    expect(snap.state).toBe('recovery');
    expect(snap.successesInRecovery).toBe(0); // the recordSuccess() above was not counted
  });
});

// ── LlmOverloadGuard: recovery ramp (D12 -- quick drop, slow recovery) ─

describe('llm overload guard: recovery ramp (D12)', () => {
  function enterRecovery(
    guard: LlmOverloadGuard,
    clock: ReturnType<typeof createClock>,
    cooldownDeadline = 60_000,
  ): void {
    recordN(guard, 4, OVERLOAD_STATUS);
    clock.set(cooldownDeadline);
    expect(guard.getSnapshot().state).toBe('recovery');
  }

  it('enters recovery at recoveryStepFraction with successesInRecovery reset to 0', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });
    enterRecovery(guard, clock);
    const snap = guard.getSnapshot();
    expect(snap.recoveryLevel).toBe(0.25);
    expect(snap.successesInRecovery).toBe(0);
  });

  it('ramps 0.25 -> 0.5 -> 0.75 -> healthy over 3 rounds of 3 successes each (defaults)', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });
    enterRecovery(guard, clock);

    guard.recordSuccess();
    guard.recordSuccess();
    expect(guard.getSnapshot().recoveryLevel).toBe(0.25); // round not complete yet
    guard.recordSuccess(); // 3rd success completes round 1
    let snap = guard.getSnapshot();
    expect(snap.recoveryLevel).toBe(0.5);
    expect(snap.state).toBe('recovery');
    expect(snap.successesInRecovery).toBe(0);

    recordSuccessN(guard, 3); // round 2
    snap = guard.getSnapshot();
    expect(snap.recoveryLevel).toBe(0.75);
    expect(snap.state).toBe('recovery');

    recordSuccessN(guard, 3); // round 3 -> healthy
    snap = guard.getSnapshot();
    expect(snap.state).toBe('healthy');
    expect(snap.recoveryLevel).toBe(0);
    expect(snap.consecutiveTrips).toBe(0);
    expect(snap.successesInRecovery).toBe(0);
    expect(snap.recentOverloads).toBe(0); // window cleared
    expect(snap.cooldownUntil).toBeNull();
  });

  it('a single overload mid-ramp re-trips cooldown (escalated); the next recovery restarts at recoveryStepFraction', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });
    enterRecovery(guard, clock); // level 0.25, consecutiveTrips=1
    recordSuccessN(guard, 3); // level 0.5

    guard.recordOverload(OVERLOAD_STATUS); // single overload -- immediate re-trip, escalated
    let snap = guard.getSnapshot();
    expect(snap.state).toBe('cooldown');
    expect(snap.consecutiveTrips).toBe(2);
    expect(snap.recoveryLevel).toBe(0); // no longer in recovery
    expect(snap.successesInRecovery).toBe(0);
    expect(snap.cooldownUntil).toBe(60_000 + 120_000); // base*2**1, from now=60000

    clock.set(180_000);
    expect(guard.getSnapshot().state).toBe('recovery');
    snap = guard.getSnapshot();
    expect(snap.recoveryLevel).toBe(0.25); // restarts at the step fraction, not resuming 0.5
  });

  it('effectiveConcurrency ramps 1 -> 2 -> 3 for configuredMax=5 across the default steps, then 5 once healthy', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });
    enterRecovery(guard, clock);
    expect(guard.effectiveConcurrency(5)).toBe(1); // floor(5*0.25)=1

    recordSuccessN(guard, 3);
    expect(guard.effectiveConcurrency(5)).toBe(2); // floor(5*0.5)=2

    recordSuccessN(guard, 3);
    expect(guard.effectiveConcurrency(5)).toBe(3); // floor(5*0.75)=3

    recordSuccessN(guard, 3);
    expect(guard.effectiveConcurrency(5)).toBe(5); // healthy -> configuredMax
  });

  it('effectiveConcurrency never drops below 1 during recovery even for a small configuredMax', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });
    enterRecovery(guard, clock);
    expect(guard.effectiveConcurrency(1)).toBe(1);
    recordSuccessN(guard, 3);
    expect(guard.effectiveConcurrency(1)).toBe(1);
    recordSuccessN(guard, 3);
    expect(guard.effectiveConcurrency(1)).toBe(1);
  });

  it('honors a recoveryStepFraction override -- 0.5 reaches healthy after a single round (two ramp steps total)', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now, recoveryStepFraction: 0.5 });
    enterRecovery(guard, clock);
    expect(guard.getSnapshot().recoveryLevel).toBe(0.5); // step 1: free on entry

    recordSuccessN(guard, 3); // step 2: one round of successes
    const snap = guard.getSnapshot();
    expect(snap.state).toBe('healthy');
    expect(snap.recoveryLevel).toBe(0);
  });

  it('rounds fractional steps to avoid binary float drift (0.1 must still reach exactly 1.0)', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now, recoveryStepFraction: 0.1 });
    enterRecovery(guard, clock);
    expect(guard.getSnapshot().recoveryLevel).toBe(0.1);

    // Raw IEEE754 addition of ten 0.1 terms drifts to 0.9999999999999999 (< 1),
    // which would never satisfy `recoveryLevel >= 1` without per-step rounding.
    for (let round = 0; round < 8; round++) {
      recordSuccessN(guard, 3);
      expect(guard.getSnapshot().state).toBe('recovery');
    }
    recordSuccessN(guard, 3); // 9th round after entry -> level reaches exactly 1.0
    expect(guard.getSnapshot().state).toBe('healthy');
  });

  it('recoveryLevel is 0 outside the recovery state', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });
    expect(guard.getSnapshot().recoveryLevel).toBe(0); // healthy
    recordN(guard, 4, OVERLOAD_STATUS);
    expect(guard.getSnapshot().recoveryLevel).toBe(0); // cooldown
  });
});

// ── LlmOverloadGuard: recordOverload while already cooling down ──────

describe('llm overload guard: recordOverload while already cooling down', () => {
  it('does not change state or extend cooldownUntil, but still records the event and notifies', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });
    recordN(guard, 4, OVERLOAD_STATUS); // trip
    const cooldownUntilBefore = guard.getSnapshot().cooldownUntil;
    const tripsBefore = guard.getSnapshot().consecutiveTrips;

    const listener = vi.fn();
    guard.subscribe(listener);
    clock.set(30_000); // still within the 60s cooldown
    guard.recordOverload(OVERLOAD_STATUS, 999_000); // even with a large retryAfterMs, no change per spec

    const snap = guard.getSnapshot();
    expect(snap.state).toBe('cooldown');
    expect(snap.cooldownUntil).toBe(cooldownUntilBefore);
    expect(snap.consecutiveTrips).toBe(tripsBefore);
    expect(snap.lastOverloadAt).toBe(30_000);
    expect(snap.lastOverloadStatus).toBe(OVERLOAD_STATUS);
    expect(listener).toHaveBeenCalled();
  });
});

// ── LlmOverloadGuard: recordSuccess no-ops outside recovery ───────────

describe('llm overload guard: recordSuccess no-ops outside recovery', () => {
  it('is a no-op in healthy state', () => {
    const guard = createLlmOverloadGuard({ now: () => 0 });
    const listener = vi.fn();
    guard.subscribe(listener);
    guard.recordSuccess();
    expect(guard.getSnapshot().state).toBe('healthy');
    expect(listener).not.toHaveBeenCalled();
  });

  it('is a no-op in cooldown state (deadline not yet reached)', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });
    recordN(guard, 4, OVERLOAD_STATUS);
    const listener = vi.fn();
    guard.subscribe(listener);
    clock.set(10_000); // still cooling down
    guard.recordSuccess();
    expect(guard.getSnapshot().state).toBe('cooldown');
    expect(listener).not.toHaveBeenCalled();
  });
});

// ── LlmOverloadGuard: effectiveConcurrency ────────────────────────────

describe('llm overload guard: effectiveConcurrency', () => {
  const configuredMax = 5;

  it('enforce + healthy -> configuredMax', () => {
    const guard = createLlmOverloadGuard({ now: () => 0 });
    expect(guard.effectiveConcurrency(configuredMax)).toBe(5);
  });

  it('enforce + cooldown -> 0', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });
    recordN(guard, 4, OVERLOAD_STATUS);
    expect(guard.effectiveConcurrency(configuredMax)).toBe(0);
  });

  it('enforce + recovery -> ramps by recoveryLevel (full ladder covered in the D12 describe block)', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });
    recordN(guard, 4, OVERLOAD_STATUS);
    clock.set(60_000);
    expect(guard.effectiveConcurrency(configuredMax)).toBe(1); // floor(5*0.25)=1
  });

  it('observe mode ignores state entirely and always returns configuredMax', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });
    guard.setMode('observe');

    expect(guard.effectiveConcurrency(configuredMax)).toBe(5); // healthy

    recordN(guard, 4, OVERLOAD_STATUS); // state machine still runs and trips internally
    expect(guard.getSnapshot().state).toBe('cooldown');
    expect(guard.effectiveConcurrency(configuredMax)).toBe(5); // concurrency unaffected

    clock.set(60_000);
    expect(guard.getSnapshot().state).toBe('recovery');
    expect(guard.effectiveConcurrency(configuredMax)).toBe(5); // still unaffected
  });
});

// ── LlmOverloadGuard: shouldDeferClaims (D11) ─────────────────────────

describe('llm overload guard: shouldDeferClaims (D11)', () => {
  it('returns false in healthy/enforce', () => {
    const guard = createLlmOverloadGuard({ now: () => 0 });
    expect(guard.shouldDeferClaims()).toBe(false);
  });

  it('returns true in cooldown/enforce', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });
    recordN(guard, 4, OVERLOAD_STATUS);
    expect(guard.shouldDeferClaims()).toBe(true);
  });

  it('returns false in recovery/enforce', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });
    recordN(guard, 4, OVERLOAD_STATUS);
    clock.set(60_000);
    expect(guard.shouldDeferClaims()).toBe(false);
  });

  it('always returns false in observe mode, even during cooldown', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });
    guard.setMode('observe');
    recordN(guard, 4, OVERLOAD_STATUS);
    expect(guard.getSnapshot().state).toBe('cooldown');
    expect(guard.shouldDeferClaims()).toBe(false);
  });

  it('lazily advances cooldown -> recovery before evaluating', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });
    recordN(guard, 4, OVERLOAD_STATUS);
    clock.set(60_000);
    expect(guard.shouldDeferClaims()).toBe(false); // deadline passed -> recovery -> false
    expect(guard.getSnapshot().state).toBe('recovery');
  });
});

// ── LlmOverloadGuard: isCoolingDown ────────────────────────────────────

describe('llm overload guard: isCoolingDown', () => {
  it('returns true while in cooldown and false once the deadline passes', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });
    recordN(guard, 4, OVERLOAD_STATUS);
    expect(guard.isCoolingDown()).toBe(true);
    clock.set(60_000);
    expect(guard.isCoolingDown()).toBe(false);
  });

  it('returns false in healthy state', () => {
    const guard = createLlmOverloadGuard({ now: () => 0 });
    expect(guard.isCoolingDown()).toBe(false);
  });
});

// ── LlmOverloadGuard: setMode ──────────────────────────────────────────

describe('llm overload guard: setMode', () => {
  it('updates the mode reflected in the snapshot', () => {
    const guard = createLlmOverloadGuard({ now: () => 0 });
    guard.setMode('observe');
    expect(guard.getSnapshot().mode).toBe('observe');
  });

  it('notifies subscribers when the mode actually changes', () => {
    const guard = createLlmOverloadGuard({ now: () => 0 });
    const listener = vi.fn();
    guard.subscribe(listener);
    guard.setMode('observe');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify when setting the same mode again (no-op)', () => {
    const guard = createLlmOverloadGuard({ now: () => 0 });
    guard.setMode('observe');
    const listener = vi.fn();
    guard.subscribe(listener);
    guard.setMode('observe');
    expect(listener).not.toHaveBeenCalled();
  });
});

// ── LlmOverloadGuard: getSnapshot reference stability ─────────────────

describe('llm overload guard: getSnapshot reference stability', () => {
  it('returns the same object reference across repeated calls when nothing changed', () => {
    const guard = createLlmOverloadGuard({ now: () => 0 });
    const snap1 = guard.getSnapshot();
    const snap2 = guard.getSnapshot();
    expect(snap2).toBe(snap1);
  });

  it('returns a new reference after a mutating call', () => {
    const guard = createLlmOverloadGuard({ now: () => 0 });
    const snap1 = guard.getSnapshot();
    guard.recordOverload(OVERLOAD_STATUS);
    const snap2 = guard.getSnapshot();
    expect(snap2).not.toBe(snap1);
  });

  it('returns a new reference when window pruning on read changes recentOverloads', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now, windowMs: 1000 });
    guard.recordOverload(OVERLOAD_STATUS);
    const snap1 = guard.getSnapshot();
    expect(snap1.recentOverloads).toBe(1);
    clock.set(2000);
    const snap2 = guard.getSnapshot();
    expect(snap2).not.toBe(snap1);
    expect(snap2.recentOverloads).toBe(0);
  });
});

// ── LlmOverloadGuard: subscribe ─────────────────────────────────────────

describe('llm overload guard: subscribe', () => {
  it('notifies once per recordOverload call that changes an observable field', () => {
    const guard = createLlmOverloadGuard({ now: () => 0 });
    const listener = vi.fn();
    guard.subscribe(listener);
    guard.recordOverload(OVERLOAD_STATUS);
    expect(listener).toHaveBeenCalledTimes(1);
    guard.recordOverload(OVERLOAD_STATUS);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('notifies on the lazy cooldown -> recovery transition triggered by a read, and only once', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });
    recordN(guard, 4, OVERLOAD_STATUS);
    const listener = vi.fn();
    guard.subscribe(listener);
    clock.set(60_000);
    guard.getSnapshot();
    expect(listener).toHaveBeenCalledTimes(1);
    guard.getSnapshot(); // already advanced -- no further change
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies on each ramp-relevant recordSuccess call while in recovery', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });
    recordN(guard, 4, OVERLOAD_STATUS);
    clock.set(60_000);
    guard.getSnapshot(); // consume the cooldown->recovery notify first
    const listener = vi.fn();
    guard.subscribe(listener);

    recordSuccessN(guard, 3); // every call while in recovery changes successesInRecovery/recoveryLevel
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('unsubscribe stops further notifications', () => {
    const guard = createLlmOverloadGuard({ now: () => 0 });
    const listener = vi.fn();
    const unsubscribe = guard.subscribe(listener);
    guard.recordOverload(OVERLOAD_STATUS);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    guard.recordOverload(OVERLOAD_STATUS);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('a throwing listener does not prevent other listeners from being notified', () => {
    const guard = createLlmOverloadGuard({ now: () => 0 });
    const throwing = vi.fn(() => {
      throw new Error('boom');
    });
    const healthy = vi.fn();
    guard.subscribe(throwing);
    guard.subscribe(healthy);
    expect(() => guard.recordOverload(OVERLOAD_STATUS)).not.toThrow();
    expect(throwing).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
  });
});

// ── LlmOverloadGuard: reset ──────────────────────────────────────────────

describe('llm overload guard: reset', () => {
  it('returns to pristine healthy state, preserves mode, notifies, and persists', () => {
    const clock = createClock(0);
    const storage = createFakeStorage();
    const guard = createLlmOverloadGuard({ now: clock.now, storage });
    guard.setMode('observe');
    recordN(guard, 4, OVERLOAD_STATUS);

    const listener = vi.fn();
    guard.subscribe(listener);
    guard.reset();

    const snap = guard.getSnapshot();
    expect(snap.state).toBe('healthy');
    expect(snap.mode).toBe('observe');
    expect(snap.consecutiveTrips).toBe(0);
    expect(snap.cooldownUntil).toBeNull();
    expect(snap.recentOverloads).toBe(0);
    expect(snap.recoveryLevel).toBe(0);
    expect(listener).toHaveBeenCalled();

    const rehydrated = createLlmOverloadGuard({ now: clock.now, storage });
    expect(rehydrated.getSnapshot().state).toBe('healthy');
  });
});

// ── LlmOverloadGuard: persistence ────────────────────────────────────────

describe('llm overload guard: persistence', () => {
  it('round-trips state (including recoveryLevel) through the storage port across instances', () => {
    const clock = createClock(0);
    const storage = createFakeStorage();
    const guard1 = createLlmOverloadGuard({ now: clock.now, storage });
    recordN(guard1, 4, OVERLOAD_STATUS);
    clock.set(60_000);
    guard1.getSnapshot(); // advance to recovery, level=0.25
    recordSuccessN(guard1, 3); // level=0.5
    const snap1 = guard1.getSnapshot();

    const guard2 = createLlmOverloadGuard({ now: clock.now, storage });
    const snap2 = guard2.getSnapshot();
    expect(snap2.state).toBe(snap1.state);
    expect(snap2.cooldownUntil).toBe(snap1.cooldownUntil);
    expect(snap2.consecutiveTrips).toBe(snap1.consecutiveTrips);
    expect(snap2.recentOverloads).toBe(snap1.recentOverloads);
    expect(snap2.recoveryLevel).toBe(snap1.recoveryLevel);
    expect(snap2.successesInRecovery).toBe(snap1.successesInRecovery);
  });

  it('does not persist mode -- a fresh instance defaults to enforce regardless of a prior instance', () => {
    const storage = createFakeStorage();
    const guard1 = createLlmOverloadGuard({ now: () => 0, storage });
    guard1.setMode('observe');

    const guard2 = createLlmOverloadGuard({ now: () => 0, storage });
    expect(guard2.getSnapshot().mode).toBe('enforce');
  });

  it('ignores corrupted JSON in storage and falls back to a pristine state', () => {
    const storage = createFakeStorage({ 'salir:llm-overload-guard:v1': '{not valid json' });
    const guard = createLlmOverloadGuard({ now: () => 0, storage });
    expect(guard.getSnapshot().state).toBe('healthy');
  });

  it('ignores a wrong-version payload and falls back to a pristine state', () => {
    const storage = createFakeStorage({
      'salir:llm-overload-guard:v1': JSON.stringify({ v: 2, state: 'cooldown' }),
    });
    const guard = createLlmOverloadGuard({ now: () => 0, storage });
    expect(guard.getSnapshot().state).toBe('healthy');
  });

  it('ignores a payload with a missing/invalid state field', () => {
    const storage = createFakeStorage({
      'salir:llm-overload-guard:v1': JSON.stringify({ v: 1, state: 'bogus-state', events: [] }),
    });
    const guard = createLlmOverloadGuard({ now: () => 0, storage });
    expect(guard.getSnapshot().state).toBe('healthy');
  });

  it('ignores a payload whose events field is not an array', () => {
    const storage = createFakeStorage({
      'salir:llm-overload-guard:v1': JSON.stringify({ v: 1, state: 'healthy', events: 'not-an-array' }),
    });
    const guard = createLlmOverloadGuard({ now: () => 0, storage });
    expect(guard.getSnapshot().state).toBe('healthy');
  });

  it('accepts a structurally valid payload but falls back to safe defaults for wrong-typed numeric fields', () => {
    const storage = createFakeStorage({
      'salir:llm-overload-guard:v1': JSON.stringify({
        v: 1,
        state: 'recovery',
        cooldownUntil: 'not-a-number',
        consecutiveTrips: 'two',
        successesInRecovery: null,
        recoveryLevel: 'half',
        events: [{ at: 1, status: 529 }, 'not-an-event', null, { at: 'x', status: 529 }, { at: 1 }],
        lastOverloadAt: 'never',
        lastOverloadStatus: 'oops',
      }),
    });
    const guard = createLlmOverloadGuard({ now: () => 0, storage });
    const snap = guard.getSnapshot();
    // The outer shape is valid (v:1, valid state, events is an array) so the
    // payload is accepted; each individually wrong-typed field falls back to
    // its safe default instead of invalidating the whole payload.
    expect(snap.state).toBe('recovery');
    expect(snap.cooldownUntil).toBeNull();
    expect(snap.consecutiveTrips).toBe(0);
    expect(snap.successesInRecovery).toBe(0);
    expect(snap.recoveryLevel).toBe(0);
    expect(snap.lastOverloadAt).toBeNull();
    expect(snap.lastOverloadStatus).toBeNull();
    // Only the one structurally-valid event survives isValidOverloadEvent filtering.
    expect(snap.recentOverloads).toBe(1);
  });

  it('swallows a storage.setItem that throws', () => {
    const storage: LlmOverloadStoragePort = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
    };
    const guard = createLlmOverloadGuard({ now: () => 0, storage });
    expect(() => guard.recordOverload(OVERLOAD_STATUS)).not.toThrow();
  });

  it('swallows a storage.getItem that throws during hydration', () => {
    const storage: LlmOverloadStoragePort = {
      getItem: () => {
        throw new Error('access denied');
      },
      setItem: () => {},
    };
    expect(() => createLlmOverloadGuard({ now: () => 0, storage })).not.toThrow();
  });

  it('uses a custom storageKey instead of the default', () => {
    const storage = createFakeStorage();
    const guard = createLlmOverloadGuard({ now: () => 0, storage, storageKey: 'custom-key' });
    guard.recordOverload(OVERLOAD_STATUS);
    expect(storage.data['custom-key']).toBeDefined();
    expect(storage.data['salir:llm-overload-guard:v1']).toBeUndefined();
  });

  it('works with no storage configured (in-memory only, never throws)', () => {
    const guard = createLlmOverloadGuard({ now: () => 0 });
    expect(() => guard.recordOverload(OVERLOAD_STATUS)).not.toThrow();
    expect(() => guard.reset()).not.toThrow();
  });

  it('clamps a persisted cooldownUntil far past maxCooldownMs on hydrate and rewrites storage', () => {
    const clock = createClock(1_000_000);
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const storage = createFakeStorage({
      'salir:llm-overload-guard:v1': JSON.stringify({
        v: 1,
        state: 'cooldown',
        cooldownUntil: 1_000_000 + thirtyDaysMs,
        consecutiveTrips: 1,
        successesInRecovery: 0,
        recoveryLevel: 0,
        events: [],
        lastOverloadAt: 1_000_000,
        lastOverloadStatus: OVERLOAD_STATUS,
      }),
    });

    const guard = createLlmOverloadGuard({ now: clock.now, storage });
    const snap = guard.getSnapshot();
    expect(snap.state).toBe('cooldown');
    expect(snap.cooldownRemainingMs).toBeLessThanOrEqual(900_000);
    expect(snap.cooldownUntil).toBe(1_000_000 + 900_000);

    const rewritten = JSON.parse(storage.data['salir:llm-overload-guard:v1']);
    expect(rewritten.cooldownUntil).toBe(1_000_000 + 900_000);
  });

  it('preserves a persisted cooldownUntil that is already within maxCooldownMs', () => {
    const clock = createClock(1_000_000);
    const storage = createFakeStorage({
      'salir:llm-overload-guard:v1': JSON.stringify({
        v: 1,
        state: 'cooldown',
        cooldownUntil: 1_000_000 + 60_000,
        consecutiveTrips: 1,
        successesInRecovery: 0,
        recoveryLevel: 0,
        events: [],
        lastOverloadAt: 1_000_000,
        lastOverloadStatus: OVERLOAD_STATUS,
      }),
    });

    const guard = createLlmOverloadGuard({ now: clock.now, storage });
    expect(guard.getSnapshot().cooldownUntil).toBe(1_000_000 + 60_000);
  });
});

// ── LlmOverloadGuard: defaults ────────────────────────────────────────────

describe('llm overload guard: defaults', () => {
  it('mode starts as enforce', () => {
    const guard = createLlmOverloadGuard({ now: () => 0 });
    expect(guard.getSnapshot().mode).toBe('enforce');
  });

  it('trips at the default threshold (4) with the default base cooldown (60s)', () => {
    const guard = createLlmOverloadGuard({ now: () => 0 });
    recordN(guard, 4, OVERLOAD_STATUS);
    const snap = guard.getSnapshot();
    expect(snap.state).toBe('cooldown');
    expect(snap.cooldownUntil).toBe(60_000);
  });

  it('persists under the default storage key', () => {
    const storage = createFakeStorage();
    const guard = createLlmOverloadGuard({ now: () => 0, storage });
    guard.recordOverload(OVERLOAD_STATUS);
    expect(storage.data['salir:llm-overload-guard:v1']).toBeDefined();
  });

  it('falls back to Date.now when now is not supplied', () => {
    const before = Date.now();
    const guard = createLlmOverloadGuard();
    guard.recordOverload(OVERLOAD_STATUS);
    const snap = guard.getSnapshot();
    const after = Date.now();
    expect(snap.lastOverloadAt).toBeGreaterThanOrEqual(before);
    expect(snap.lastOverloadAt).toBeLessThanOrEqual(after);
  });
});

// ── LlmOverloadGuard: logging (stable messages + structured fields) ──────

describe('llm overload guard: logging', () => {
  it('warns with the pinned fields and stable message when a trip occurs', () => {
    const clock = createClock(1_000_000);
    const guard = createLlmOverloadGuard({ now: clock.now });
    recordN(guard, 4, OVERLOAD_STATUS);

    expect(mockLog.warn).toHaveBeenCalledWith(
      {
        status: OVERLOAD_STATUS,
        recentOverloads: 4,
        consecutiveTrips: 1,
        cooldownMs: 60_000,
        cooldownUntil: 1_000_000 + 60_000,
        retryAfterMs: null,
      },
      'LLM overload cooldown started',
    );
  });

  it('logs info when cooldown ends and recovery probing begins', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });
    recordN(guard, 4, OVERLOAD_STATUS);
    mockLog.info.mockClear();
    clock.set(60_000);
    guard.getSnapshot();

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ consecutiveTrips: 1 }),
      'LLM overload cooldown ended — probing recovery at concurrency 1',
    );
  });

  it('logs info with the pinned fields on each ramp step that does not yet reach healthy', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });
    recordN(guard, 4, OVERLOAD_STATUS);
    clock.set(60_000);
    guard.getSnapshot();
    mockLog.info.mockClear();

    recordSuccessN(guard, 3);

    expect(mockLog.info).toHaveBeenCalledWith(
      { recoveryLevel: 0.5, successes: 3 },
      'LLM recovery ramp step — increasing concurrency',
    );
  });

  it('logs info once fully recovered, and does not also log a ramp-step message on that final step', () => {
    const clock = createClock(0);
    const guard = createLlmOverloadGuard({ now: clock.now });
    recordN(guard, 4, OVERLOAD_STATUS);
    clock.set(60_000);
    guard.getSnapshot();
    recordSuccessN(guard, 3); // -> 0.5
    recordSuccessN(guard, 3); // -> 0.75
    mockLog.info.mockClear();

    recordSuccessN(guard, 3); // -> healthy

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ consecutiveTrips: 1 }),
      'LLM API recovered — restoring full concurrency',
    );
    expect(mockLog.info).not.toHaveBeenCalledWith(expect.anything(), 'LLM recovery ramp step — increasing concurrency');
  });

  it('does not warn or log info on the happy path with no overloads', () => {
    const guard = createLlmOverloadGuard({ now: () => 0 });
    guard.recordSuccess(); // no-op, healthy
    guard.getSnapshot();
    expect(mockLog.warn).not.toHaveBeenCalled();
    expect(mockLog.info).not.toHaveBeenCalled();
  });
});

// ── Module singleton ───────────────────────────────────────────────────

describe('llmOverloadGuard module singleton', () => {
  it('exists and starts in a healthy, enforce-mode state without a global localStorage (Node test env)', () => {
    const snap = llmOverloadGuard.getSnapshot();
    expect(snap.state).toBe('healthy');
    expect(snap.mode).toBe('enforce');
  });
});

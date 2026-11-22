/**
 * Fleet-level LLM overload guard (ADR-129 / D1).
 *
 * The per-run circuit breaker in `api.ts` (REL-01) only protects a single
 * agent run — it never throttles the fleet. Under an aggressive schedule
 * (cron jobs every 1-6 min x researcher concurrency 5), every concurrent run
 * hammers a temporarily-overloaded Anthropic API independently, so retries
 * pile up and jobs land in the DLQ. This module is a small, timer-free state
 * machine — `healthy -> cooldown -> recovery -> healthy` — that tracks
 * overloads (429/503/529) across the whole fleet and tells callers (queue
 * processor, providers) when to back off.
 *
 * Design principle: **quick drop, slow recovery**. Tripping into cooldown is
 * immediate (a burst of overloads defers all LLM job claims right away), but
 * climbing back out is a gradual ramp, not a single flip back to full
 * concurrency (D12) — a still-shaky API that only *just* stopped erroring
 * should see a slowly increasing trickle of traffic, not a full-throttle
 * retry storm that re-trips it. A single overload during that ramp discards
 * all ramp progress and re-trips cooldown immediately (escalated).
 *
 * The guard itself owns no timers: every state-dependent read lazily
 * advances `cooldown -> recovery` if the deadline has passed (D3). This
 * keeps the module pure/testable (inject `now`) and lets callers (UI badge,
 * queue processor poll loop) drive the cadence.
 */

import { createLogger } from '@prompt-studio/observability';

const log = createLogger('llm-overload-guard');

// ── Public types (pinned contract, docs/00_archive/llm-overload-recovery.md) ──

/** Fleet-wide guard state. Mirrors the closed/open/half-open shape of the per-run REL-01 breaker, at fleet scope. */
export type LlmOverloadGuardState = 'healthy' | 'cooldown' | 'recovery';

/**
 * `enforce` gates real behavior (deferred claims, clamped concurrency).
 * `observe` is the flag-off shadow mode (D4): the state machine still runs
 * and logs so the rollout can be validated, but every gate returns the
 * unthrottled value. Mode is a runtime-only property — the feature flag
 * re-asserts it on every load, so it is deliberately never persisted.
 */
export type LlmOverloadGuardMode = 'enforce' | 'observe';

/**
 * Point-in-time view of the guard, safe to hand to React's
 * `useSyncExternalStore` — `getSnapshot()` returns the *same* object
 * reference until an observable field actually changes.
 */
export interface LlmOverloadSnapshot {
  state: LlmOverloadGuardState;
  mode: LlmOverloadGuardMode;
  /** Epoch ms the current/last cooldown ends at, or `null` if none has happened yet. */
  cooldownUntil: number | null;
  /** `max(0, cooldownUntil - now)` computed when this snapshot was built — not live; derive a countdown from `cooldownUntil` instead. */
  cooldownRemainingMs: number;
  /** Escalation counter — how many trips happened back-to-back without a full recovery. Resets to 0 on reaching healthy. */
  consecutiveTrips: number;
  /** Overload events inside the current rolling window (post-pruning). */
  recentOverloads: number;
  /** Successes accumulated toward the *next* ramp step (resets every step, see `recoveryLevel`). */
  successesInRecovery: number;
  /**
   * Recovery ramp position in `[0, 1)` while `state === 'recovery'` (0 whenever
   * it is not) — see the module doc for "quick drop, slow recovery" (D12).
   * `effectiveConcurrency` scales `configuredMax` by this fraction.
   */
  recoveryLevel: number;
  lastOverloadAt: number | null;
  lastOverloadStatus: number | null;
}

/** Minimal storage port the guard needs — satisfied by the real `localStorage` or a test fake. */
export interface LlmOverloadStoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Tunables for `createLlmOverloadGuard` — every field has a production default, so tests only override what a given case needs. */
export interface LlmOverloadGuardOptions {
  /** Rolling window for counting overload events (ms). Default 120_000. */
  windowMs?: number;
  /** Overload events inside the window that trip cooldown from healthy. Default 4. */
  threshold?: number;
  /** Cooldown duration for the first trip (ms); doubles per consecutive trip. Default 60_000. */
  baseCooldownMs?: number;
  /**
   * Ceiling for the escalating cooldown duration (ms). Default 900_000 (15
   * min). Also bounds the `retryAfterMs` floor applied in `tripCooldown` — an
   * upstream `Retry-After` can raise the cooldown but never push it past this
   * ceiling.
   */
  maxCooldownMs?: number;
  /** Consecutive successes required to complete one recovery ramp step. Default 3. */
  recoverySuccesses?: number;
  /** Fraction of `configuredMax` each completed ramp round adds (D12). Default 0.25. */
  recoveryStepFraction?: number;
  /** Injectable storage port; `null`/omitted keeps the guard in-memory only. */
  storage?: LlmOverloadStoragePort | null;
  /** Storage key for the persisted payload. Default `'salir:llm-overload-guard:v1'`. */
  storageKey?: string;
  /** Injectable clock — never real `Date.now()` in tests. Default `Date.now`. */
  now?: () => number;
}

/**
 * The guard's public surface. Every state-reading method (`getSnapshot`,
 * `isCoolingDown`, `effectiveConcurrency`, `shouldDeferClaims`) lazily
 * advances `cooldown -> recovery` before answering — see the module doc.
 */
export interface LlmOverloadGuard {
  /** Record an overload response (429/503/529). See the module doc for state-transition rules. */
  recordOverload(status: number, retryAfterMs?: number | null): void;
  /** Record a successful LLM call. Only meaningful while `state === 'recovery'` — a no-op otherwise. */
  recordSuccess(): void;
  /** Switch between `enforce` and `observe`. Not persisted — callers re-assert it from the feature flag on load. */
  setMode(mode: LlmOverloadGuardMode): void;
  /** Stable-reference snapshot for `useSyncExternalStore`; lazily advances `cooldown -> recovery` first. */
  getSnapshot(): LlmOverloadSnapshot;
  /** `true` while actively cooling down (lazily advances first). */
  isCoolingDown(): boolean;
  /** `configuredMax` scaled per state/mode — see field docs on `LlmOverloadGuardOptions`/`LlmOverloadSnapshot`. */
  effectiveConcurrency(configuredMax: number): number;
  /** Subscribe to every observable change. Returns an unsubscribe function. A throwing listener never blocks the others. */
  subscribe(listener: () => void): () => void;
  /** Test/support hatch: back to pristine healthy state, keeping the current mode. */
  reset(): void;
  /**
   * D11: should the queue processor defer claiming LLM-heavy jobs right now?
   * `true` only for `mode === 'enforce'` AND the (lazily advanced) state is
   * `'cooldown'`. Always `false` in `observe` mode — callers there read
   * `getSnapshot()` for shadow logging instead of gating on this.
   */
  shouldDeferClaims(): boolean;
}

// ── Defaults ─────────────────────────────────────────────────────────────

const DEFAULT_WINDOW_MS = 120_000;
const DEFAULT_THRESHOLD = 4;
const DEFAULT_BASE_COOLDOWN_MS = 60_000;
const DEFAULT_MAX_COOLDOWN_MS = 900_000;
const DEFAULT_RECOVERY_SUCCESSES = 3;
const DEFAULT_RECOVERY_STEP_FRACTION = 0.25;
const DEFAULT_STORAGE_KEY = 'salir:llm-overload-guard:v1';

const OVERLOAD_STATUSES: ReadonlySet<number> = new Set([429, 503, 529]);

// ── Retry-delay v1 -> v2 (deprecation pattern per user directive, D5) ─────

/** One overload/network-error event, kept only long enough to fall out of the rolling window. */
interface OverloadEvent {
  at: number;
  status: number;
}

/**
 * True for the three statuses this guard treats as "the LLM API is
 * overloaded": `429` (rate limit), `503` (service unavailable), and `529`
 * (Anthropic's overloaded_error). Callers (api.ts, providers) use this to
 * decide whether to call `recordOverload`.
 */
export function isOverloadStatus(status: number): boolean {
  return OVERLOAD_STATUSES.has(status);
}

/**
 * Parse a `Retry-After` header into milliseconds. WHY a second `now` param:
 * the HTTP-date form is an absolute deadline, so converting it to a relative
 * delay requires a reference "now" — hardcoding `Date.now()` here would make
 * the HTTP-date branch untestable without real timers. Returns `null` for a
 * `null`/empty/unparseable header rather than throwing, so a malformed
 * upstream header degrades to "no extra floor" instead of crashing the caller.
 */
export function parseRetryAfterMs(header: string | null, now: () => number = Date.now): number | null {
  if (header == null) return null;
  const trimmed = header.trim();
  if (trimmed === '') return null;

  // Integer-seconds form (RFC 9110 delay-seconds), e.g. "120". Negative
  // values are rejected explicitly rather than left to `Date.parse` (whose
  // handling of a bare "-5" is not reliably specified across engines).
  if (/^-?\d+$/.test(trimmed)) {
    if (trimmed.startsWith('-')) return null;
    return Number(trimmed) * 1000;
  }

  // HTTP-date form (RFC 9110 IMF-fixdate), e.g. "Wed, 21 Oct 2015 07:28:00 GMT".
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, parsed - now());
}

/**
 * @deprecated v1 — pins the pre-guard behavior of `packages/agent/src/api.ts`
 * (`2 ** attempt * retryDelayMs`, `attempt` is 0-based). Kept as the safe
 * fallback for non-overload statuses so the guard's rollout cannot change
 * retry timing for ordinary transient errors. Use `calculateLlmRetryDelayMs`.
 */
export function calculateLlmRetryDelayMsV1(attempt: number, retryDelayMs: number): number {
  return 2 ** attempt * retryDelayMs;
}

const OVERLOAD_RETRY_BASE_FLOOR_MS = 5000;
const OVERLOAD_RETRY_JITTER_MIN = 0.8;
const OVERLOAD_RETRY_JITTER_RANGE = 0.4;
const OVERLOAD_RETRY_CAP_MS = 60_000;
const RETRY_AFTER_CAP_MS = 120_000;

/**
 * Overload-aware retry delay. Non-overload statuses delegate straight to
 * `calculateLlmRetryDelayMsV1` (unchanged behavior). Overload statuses
 * (429/503/529) use a longer floor (5s, vs. v1's 1s default) so a burst of
 * overloads backs off harder, jitter (±20%) to avoid a thundering herd of
 * concurrently-retrying jobs all waking at once, a 60s cap so a single call
 * never blocks a job past the queue's own visibility timeout, and honors an
 * upstream `Retry-After` when it asks for more than the jittered delay
 * (capped at 120s so a very large `Retry-After` cannot stall a job forever).
 */
export function calculateLlmRetryDelayMsV2(args: {
  status: number;
  attempt: number;
  retryDelayMs: number;
  retryAfterMs?: number | null;
  random?: () => number;
}): number {
  const { status, attempt, retryDelayMs, retryAfterMs = null, random = Math.random } = args;
  if (!isOverloadStatus(status)) {
    return calculateLlmRetryDelayMsV1(attempt, retryDelayMs);
  }
  const base = Math.max(retryDelayMs, OVERLOAD_RETRY_BASE_FLOOR_MS) * 2 ** attempt;
  const jitterMultiplier = OVERLOAD_RETRY_JITTER_MIN + random() * OVERLOAD_RETRY_JITTER_RANGE;
  const jittered = Math.min(base * jitterMultiplier, OVERLOAD_RETRY_CAP_MS);
  if (retryAfterMs == null) return jittered;
  return Math.max(jittered, Math.min(retryAfterMs, RETRY_AFTER_CAP_MS));
}

/** Final alias callers use — always the current (v2) formula. */
export const calculateLlmRetryDelayMs = calculateLlmRetryDelayMsV2;

// ── Pure helpers (refactor step: window pruning, cooldown duration, ramp rounding, persistence codec) ──

/**
 * Drop events older than `windowMs` relative to `nowMs`. Pure so the trip
 * threshold and the persisted/reported `recentOverloads` count both go
 * through one definition of "inside the window."
 */
function pruneOverloadEvents(events: readonly OverloadEvent[], nowMs: number, windowMs: number): OverloadEvent[] {
  return events.filter((event) => nowMs - event.at < windowMs);
}

/**
 * Escalating cooldown duration for the Nth consecutive trip: doubles per
 * trip, capped at `maxCooldownMs`. Repeated overloads inside one window (or
 * a single overload right after entering recovery) signal a longer outage,
 * so each re-trip backs off harder instead of retrying at a fixed cadence
 * that would keep hammering a still-overloaded API (D2).
 */
function computeCooldownDurationMs(baseCooldownMs: number, maxCooldownMs: number, consecutiveTrips: number): number {
  const escalated = baseCooldownMs * 2 ** (consecutiveTrips - 1);
  return Math.min(escalated, maxCooldownMs);
}

/**
 * Round a recovery ramp level to 2 decimals. WHY: `recoveryLevel +=
 * recoveryStepFraction` accumulates binary-float drift (e.g. nine additions
 * of 0.1 lands on 0.9999999999999999, not 1), which would leave the ramp
 * forever short of the `>= 1` healthy threshold. Two decimals is generous
 * for a UI-facing ramp fraction and eliminates the drift.
 */
function roundRecoveryLevel(level: number): number {
  return Math.round(level * 100) / 100;
}

/** Internal, mutable state — the part of the guard that is actually persisted. */
interface InternalState {
  state: LlmOverloadGuardState;
  cooldownUntil: number | null;
  consecutiveTrips: number;
  successesInRecovery: number;
  recoveryLevel: number;
  events: OverloadEvent[];
  lastOverloadAt: number | null;
  lastOverloadStatus: number | null;
}

function createPristineState(): InternalState {
  return {
    state: 'healthy',
    cooldownUntil: null,
    consecutiveTrips: 0,
    successesInRecovery: 0,
    recoveryLevel: 0,
    events: [],
    lastOverloadAt: null,
    lastOverloadStatus: null,
  };
}

/** On-disk/localStorage shape. Versioned so a future schema change only touches this pair of functions. */
interface PersistedStateV1 {
  v: 1;
  state: LlmOverloadGuardState;
  cooldownUntil: number | null;
  consecutiveTrips: number;
  successesInRecovery: number;
  recoveryLevel: number;
  events: OverloadEvent[];
  lastOverloadAt: number | null;
  lastOverloadStatus: number | null;
}

const VALID_STATES: readonly LlmOverloadGuardState[] = ['healthy', 'cooldown', 'recovery'];

function encodePersistedState(state: InternalState): string {
  const payload: PersistedStateV1 = {
    v: 1,
    state: state.state,
    cooldownUntil: state.cooldownUntil,
    consecutiveTrips: state.consecutiveTrips,
    successesInRecovery: state.successesInRecovery,
    recoveryLevel: state.recoveryLevel,
    events: state.events,
    lastOverloadAt: state.lastOverloadAt,
    lastOverloadStatus: state.lastOverloadStatus,
  };
  return JSON.stringify(payload);
}

function isValidOverloadEvent(value: unknown): value is OverloadEvent {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<OverloadEvent>;
  return typeof candidate.at === 'number' && typeof candidate.status === 'number';
}

/**
 * Decode a persisted payload, defensively. Returns `null` (never throws) for
 * corrupt JSON, a wrong/missing version, or a structurally invalid shape —
 * the caller falls back to a pristine state, so a bad payload from an older
 * build degrades to "guard restarts healthy" instead of crashing hydration.
 */
function decodePersistedState(raw: string): InternalState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedStateV1> | null;
    if (parsed?.v !== 1) return null;
    if (!parsed.state || !VALID_STATES.includes(parsed.state)) return null;
    if (!Array.isArray(parsed.events)) return null;
    return {
      state: parsed.state,
      cooldownUntil: typeof parsed.cooldownUntil === 'number' ? parsed.cooldownUntil : null,
      consecutiveTrips: typeof parsed.consecutiveTrips === 'number' ? parsed.consecutiveTrips : 0,
      successesInRecovery: typeof parsed.successesInRecovery === 'number' ? parsed.successesInRecovery : 0,
      recoveryLevel: typeof parsed.recoveryLevel === 'number' ? parsed.recoveryLevel : 0,
      events: parsed.events.filter(isValidOverloadEvent),
      lastOverloadAt: typeof parsed.lastOverloadAt === 'number' ? parsed.lastOverloadAt : null,
      lastOverloadStatus: typeof parsed.lastOverloadStatus === 'number' ? parsed.lastOverloadStatus : null,
    };
  } catch {
    return null;
  }
}

// ── The state machine ──────────────────────────────────────────────────

/**
 * Create an independent guard instance. Most callers should use the module
 * singleton `llmOverloadGuard` below; `createLlmOverloadGuard` exists mainly
 * for tests (inject `now`/`storage`) and for any future per-scope guard.
 */
export function createLlmOverloadGuard(opts: LlmOverloadGuardOptions = {}): LlmOverloadGuard {
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const baseCooldownMs = opts.baseCooldownMs ?? DEFAULT_BASE_COOLDOWN_MS;
  const maxCooldownMs = opts.maxCooldownMs ?? DEFAULT_MAX_COOLDOWN_MS;
  const recoverySuccesses = opts.recoverySuccesses ?? DEFAULT_RECOVERY_SUCCESSES;
  const recoveryStepFraction = opts.recoveryStepFraction ?? DEFAULT_RECOVERY_STEP_FRACTION;
  const storage = opts.storage ?? null;
  const storageKey = opts.storageKey ?? DEFAULT_STORAGE_KEY;
  const now = opts.now ?? Date.now;

  let mode: LlmOverloadGuardMode = 'enforce';
  let state: InternalState = createPristineState();
  let cachedSnapshot: LlmOverloadSnapshot | null = null;
  let dirty = true;
  const listeners = new Set<() => void>();

  function markDirty(): void {
    dirty = true;
  }

  /** Listener exceptions must not break other listeners (contract requirement) — each runs in its own try/catch. */
  function notify(): void {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // A subscriber's own bug is not this guard's problem to propagate.
      }
    }
  }

  function persistState(): void {
    if (!storage) return;
    try {
      storage.setItem(storageKey, encodePersistedState(state));
    } catch (err) {
      log.debug({ err }, 'failed to persist llm-overload-guard state');
    }
  }

  /**
   * A `maxCooldownMs` upgrade (or a downgraded config) only bounds *new*
   * trips (`tripCooldown`) — a `cooldownUntil` already on disk from before
   * the ceiling existed, or from a since-lowered ceiling, would otherwise
   * survive hydration untouched and hold the tab in cooldown for however
   * long it was originally set. Clamp it to the current ceiling right after
   * hydrating, and persist the clamped value back so the next load is clean.
   */
  function clampHydratedCooldown(): void {
    if (state.state !== 'cooldown' || state.cooldownUntil == null) return;
    const ceiling = now() + maxCooldownMs;
    if (state.cooldownUntil <= ceiling) return;
    const persistedCooldownUntil = state.cooldownUntil;
    state.cooldownUntil = ceiling;
    log.debug(
      { persistedCooldownUntil, clampedCooldownUntil: ceiling },
      'clamped persisted cooldownUntil to maxCooldownMs',
    );
    persistState();
  }

  function hydrateFromStorage(): void {
    if (!storage) return;
    try {
      const raw = storage.getItem(storageKey);
      if (raw == null) return;
      const decoded = decodePersistedState(raw);
      if (!decoded) return;
      state = decoded;
      clampHydratedCooldown();
    } catch (err) {
      log.debug({ err }, 'failed to hydrate llm-overload-guard state');
    }
  }

  hydrateFromStorage();

  /**
   * Timer-free lazy transition (D3): every state-reading method calls this
   * first. If we are cooling down and the deadline has passed, advance to
   * `recovery` at the first ramp step. This is the ONLY place recovery is
   * entered, so "restarts at recoveryStepFraction" (quick drop, slow
   * recovery) falls out naturally regardless of how recovery was left last.
   */
  function maybeAdvanceCooldown(nowMs: number): void {
    if (state.state !== 'cooldown' || state.cooldownUntil == null) return;
    if (nowMs < state.cooldownUntil) return;
    state.state = 'recovery';
    state.successesInRecovery = 0;
    state.recoveryLevel = roundRecoveryLevel(recoveryStepFraction);
    log.info(
      { consecutiveTrips: state.consecutiveTrips, recoveryLevel: state.recoveryLevel },
      'LLM overload cooldown ended — probing recovery at concurrency 1',
    );
    markDirty();
    persistState();
    notify();
  }

  /**
   * Shared trip/re-trip logic for both "healthy crossed the threshold" and
   * "a single overload during recovery" (quick drop): escalate, compute the
   * new cooldown window (floored by `retryAfterMs` when larger, but that
   * floor is itself capped at `maxCooldownMs` so one provider header can
   * never hold the fleet in cooldown past the documented 15-minute ceiling —
   * see the 30-day-header regression in overload-guard.test.ts), and discard
   * any recovery-ramp progress.
   */
  function tripCooldown(nowMs: number, status: number, retryAfterMs: number | null | undefined): void {
    state.consecutiveTrips += 1;
    const durationMs = Math.min(
      Math.max(computeCooldownDurationMs(baseCooldownMs, maxCooldownMs, state.consecutiveTrips), retryAfterMs ?? 0),
      maxCooldownMs,
    );
    const cooldownUntil = nowMs + durationMs;
    state.state = 'cooldown';
    state.cooldownUntil = cooldownUntil;
    state.successesInRecovery = 0;
    state.recoveryLevel = 0;
    log.warn(
      {
        status,
        recentOverloads: state.events.length,
        consecutiveTrips: state.consecutiveTrips,
        cooldownMs: cooldownUntil - nowMs,
        cooldownUntil,
        retryAfterMs: retryAfterMs ?? null,
      },
      'LLM overload cooldown started',
    );
  }

  function recordOverload(status: number, retryAfterMs?: number | null): void {
    const nowMs = now();
    state.events = pruneOverloadEvents(state.events, nowMs, windowMs);
    state.events.push({ at: nowMs, status });
    state.lastOverloadAt = nowMs;
    state.lastOverloadStatus = status;

    if (state.state === 'healthy') {
      if (state.events.length >= threshold) {
        tripCooldown(nowMs, status, retryAfterMs);
      }
    } else if (state.state === 'recovery') {
      // Quick drop: a single overload while probing recovery discards all
      // ramp progress and re-trips immediately, escalated.
      tripCooldown(nowMs, status, retryAfterMs);
    }
    // 'cooldown': already cooling down -- no state change, but the event
    // above still updates recentOverloads/lastOverloadAt/lastOverloadStatus.

    markDirty();
    persistState();
    notify();
  }

  function recordSuccess(): void {
    if (state.state !== 'recovery') return; // no-op outside recovery -- window is intentionally NOT cleared here

    state.successesInRecovery += 1;
    if (state.successesInRecovery < recoverySuccesses) {
      markDirty();
      persistState();
      notify();
      return;
    }

    // A full round of `recoverySuccesses` completed -- advance one ramp step.
    state.successesInRecovery = 0;
    state.recoveryLevel = roundRecoveryLevel(state.recoveryLevel + recoveryStepFraction);

    if (state.recoveryLevel >= 1) {
      const previousTrips = state.consecutiveTrips;
      state.state = 'healthy';
      state.consecutiveTrips = 0;
      state.recoveryLevel = 0;
      state.events = [];
      state.cooldownUntil = null;
      log.info({ consecutiveTrips: previousTrips }, 'LLM API recovered — restoring full concurrency');
    } else {
      log.info(
        { recoveryLevel: state.recoveryLevel, successes: recoverySuccesses },
        'LLM recovery ramp step — increasing concurrency',
      );
    }

    markDirty();
    persistState();
    notify();
  }

  function setMode(nextMode: LlmOverloadGuardMode): void {
    if (mode === nextMode) return;
    mode = nextMode;
    markDirty();
    notify();
    // Mode is intentionally NOT persisted (D4) -- the feature flag
    // re-asserts it at runtime on every load, so persisting a stale value
    // could survive a flag flip and silently keep the old mode active.
  }

  function getSnapshot(): LlmOverloadSnapshot {
    const nowMs = now();
    const pruned = pruneOverloadEvents(state.events, nowMs, windowMs);
    if (pruned.length !== state.events.length) {
      state.events = pruned;
      markDirty();
    }
    maybeAdvanceCooldown(nowMs);

    if (dirty || !cachedSnapshot) {
      cachedSnapshot = {
        state: state.state,
        mode,
        cooldownUntil: state.cooldownUntil,
        cooldownRemainingMs: state.cooldownUntil == null ? 0 : Math.max(0, state.cooldownUntil - nowMs),
        consecutiveTrips: state.consecutiveTrips,
        recentOverloads: state.events.length,
        successesInRecovery: state.successesInRecovery,
        recoveryLevel: state.recoveryLevel,
        lastOverloadAt: state.lastOverloadAt,
        lastOverloadStatus: state.lastOverloadStatus,
      };
      dirty = false;
    }
    return cachedSnapshot;
  }

  function isCoolingDown(): boolean {
    maybeAdvanceCooldown(now());
    return state.state === 'cooldown';
  }

  function effectiveConcurrency(configuredMax: number): number {
    maybeAdvanceCooldown(now());
    if (mode === 'observe') return configuredMax;
    if (state.state === 'healthy') return configuredMax;
    if (state.state === 'cooldown') return 0;
    // Recovery: quick drop, slow recovery (D12) -- scale by the ramp level,
    // but never fully clamp to 0 so a probe request can always get through.
    return Math.max(1, Math.floor(configuredMax * state.recoveryLevel));
  }

  function shouldDeferClaims(): boolean {
    maybeAdvanceCooldown(now());
    return mode === 'enforce' && state.state === 'cooldown';
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function reset(): void {
    state = createPristineState();
    markDirty();
    persistState();
    notify();
  }

  return {
    recordOverload,
    recordSuccess,
    setMode,
    getSnapshot,
    isCoolingDown,
    effectiveConcurrency,
    subscribe,
    reset,
    shouldDeferClaims,
  };
}

/**
 * Best-effort access to the browser `localStorage` global. Wrapped in
 * try/catch because merely *reading* `localStorage` can throw in sandboxed
 * contexts (Safari private mode, restricted webviews) — and, more
 * immediately, the global does not exist in the Node/Vitest test
 * environment, where `typeof localStorage` safely evaluates to `'undefined'`.
 */
function createDefaultStorage(): LlmOverloadStoragePort | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Module-level singleton — the guard instance the rest of the app shares
 * (api.ts, provider recording seams, the queue processor's admission gate,
 * the LlmCooldownBanner UI). One guard per browser tab sees every provider
 * path (D7); cross-tab sync is deliberately not built (D3) since each tab's
 * guard trips within one failed job cycle anyway.
 */
export const llmOverloadGuard: LlmOverloadGuard = createLlmOverloadGuard({ storage: createDefaultStorage() });

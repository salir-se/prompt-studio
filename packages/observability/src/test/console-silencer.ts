import type { TestContext } from 'vitest';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';

// Direct stderr write — bypasses console.error (which is spied/silenced
// by this same module). Typed inline so consumers don't need @types/node:
// the silencer is the only stderr-writer in the @prompt-studio/observability/test
// surface, so this narrow shape is enough.
declare const process: { stderr: { write(chunk: string): boolean } };

type ConsoleMethod = 'log' | 'warn' | 'info' | 'error' | 'debug';

const CONSOLE_METHODS: readonly ConsoleMethod[] = ['log', 'warn', 'info', 'error', 'debug'] as const;

/**
 * Per-test in-memory log buffer.
 *
 * Tests stay silent on success and dump captured output to stderr on failure —
 * which is what the observability narrative actually wants from a logger:
 * post-mortem evidence, not real-time noise. The same buffer doubles as a
 * milestone-coverage probe — `consoleBuffer.entries` lets a test assert that
 * the log line it expected was actually emitted at the right point.
 */
export interface ConsoleBufferEntry {
  method: ConsoleMethod;
  args: unknown[];
  testName?: string;
  timestamp: number;
}

class ConsoleBuffer {
  private _entries: ConsoleBufferEntry[] = [];
  private _currentTest: string | undefined;

  push(method: ConsoleMethod, args: unknown[]): void {
    this._entries.push({ method, args, testName: this._currentTest, timestamp: Date.now() });
  }

  /** Snapshot of captured entries (for assertions in tests). */
  get entries(): readonly ConsoleBufferEntry[] {
    return this._entries;
  }

  /** Number of buffered entries. */
  get length(): number {
    return this._entries.length;
  }

  /** Tag subsequent push() calls with this test's name. */
  setCurrentTest(name: string | undefined): void {
    this._currentTest = name;
  }

  dump(label?: string): void {
    if (this._entries.length === 0) return;
    const header = label
      ? `\n── ${label} (${this._entries.length} entries) ──`
      : `\n── captured console output (${this._entries.length} entries) ──`;
    process.stderr.write(`${header}\n`);
    for (const entry of this._entries) {
      const formatted = entry.args
        .map((a) => {
          if (a instanceof Error) return a.stack ?? a.message;
          if (typeof a === 'string') return a;
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join(' ');
      process.stderr.write(`[${entry.method}] ${formatted}\n`);
    }
    this._entries = [];
  }

  clear(): void {
    this._entries = [];
  }
}

export const consoleBuffer = new ConsoleBuffer();

const originals: Record<ConsoleMethod, (...args: unknown[]) => void> = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  info: console.info.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

interface InstallOptions {
  /**
   * Predicate run on each captured entry. Returning `false` drops the entry —
   * useful for known-noise patterns the buffer should ignore (e.g.
   * React's "not wrapped in act" warnings tracked by a separate guard).
   */
  filter?: (method: ConsoleMethod, args: unknown[]) => boolean;
  /**
   * If true, captured entries are also forwarded to the real console (visible
   * in test output). Defaults to false — silence on pass, dump on fail.
   */
  passthrough?: boolean;
}

/** Brand marking a console method as our capture fn, so re-installation is cheap and detectable. */
const CAPTURE_BRAND = Symbol.for('@prompt-studio/observability/console-capture');

type CaptureFn = ((...args: unknown[]) => void) & { [CAPTURE_BRAND]?: true };

/** True for a `vi.fn()`/`vi.spyOn()` result — those carry a `.mock` property. */
function isMockFunction(fn: unknown): boolean {
  return typeof fn === 'function' && 'mock' in (fn as object);
}

/**
 * Replace the console methods with capture functions.
 *
 * Deliberately a plain assignment rather than `vi.spyOn(...).mockImplementation(...)`.
 * A spy is registered in vitest's mock registry, so ANY `vi.restoreAllMocks()` /
 * `vi.resetAllMocks()` — including one a test file registers in its own
 * `beforeEach`, which runs AFTER this setup file's `beforeEach` — strips the
 * capture and un-silences the rest of the suite. That is exactly how
 * `services/auth/src/auth/microsoft-oauth.test.ts` leaked its degradation logs
 * into CI. A direct assignment is invisible to the mock registry, so the
 * silence survives; `restoreConsole()` in `afterAll` puts the originals back.
 *
 * A test that spies console itself still works: its `vi.spyOn` wraps our capture
 * fn, and its restore puts our capture fn back (not the raw console).
 */
function installCapture(opts: InstallOptions): void {
  for (const method of CONSOLE_METHODS) {
    const current = console[method] as CaptureFn;
    // Already capturing — nothing to do.
    if (current[CAPTURE_BRAND]) continue;
    // A test installed its own `vi.spyOn(console, …)` (e.g. to assert on printed
    // output). Leave it: clobbering it would empty its `.mock.calls`. Its own
    // restore hands control back here on the next `beforeEach`.
    if (isMockFunction(current)) continue;
    const capture: CaptureFn = (...args: unknown[]) => {
      if (opts.filter && opts.filter(method, args) === false) return;
      consoleBuffer.push(method, args);
      if (opts.passthrough) originals[method](...args);
    };
    capture[CAPTURE_BRAND] = true;
    console[method] = capture as Console[ConsoleMethod];
  }
}

/** Put the real console methods back. Paired with `installCapture` in `afterAll`. */
function restoreConsole(): void {
  for (const method of CONSOLE_METHODS) {
    console[method] = originals[method] as Console[ConsoleMethod];
  }
}

/**
 * Captures all console output to an in-memory buffer.
 *
 * Behaviour per test:
 * - Passing test → buffer is silently cleared in afterEach.
 * - Failing test → buffer is dumped to stderr, prefixed with the test name,
 *   so the captured logs become post-mortem evidence next to the assertion.
 *
 * Call once from a setupFile. The capture is a plain assignment, not a
 * `vi.spyOn` — see `installCapture` for why a spy could not hold the silence.
 * It is also re-installed in `beforeEach` so a suite that restores the raw
 * console mid-run goes quiet again on the next test.
 */
export function installConsoleSilencer(opts: InstallOptions = {}): void {
  installCapture(opts);

  beforeAll(() => {
    installCapture(opts);
  });

  beforeEach((ctx: TestContext) => {
    installCapture(opts);
    consoleBuffer.setCurrentTest(ctx.task.name);
  });

  afterEach((ctx: TestContext) => {
    const result = ctx.task.result;
    if (result?.state === 'fail') {
      consoleBuffer.dump(`captured logs · ${ctx.task.name}`);
    } else {
      consoleBuffer.clear();
    }
    consoleBuffer.setCurrentTest(undefined);
  });

  afterAll(() => {
    vi.restoreAllMocks();
    restoreConsole();
  });
}

/**
 * Same buffering as `installConsoleSilencer` but ALSO forwards every entry to
 * the real console — useful when debugging a flaky test locally.
 */
export function installConsolePassthrough(opts: Omit<InstallOptions, 'passthrough'> = {}): void {
  installConsoleSilencer({ ...opts, passthrough: true });
}

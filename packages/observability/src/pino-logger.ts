/**
 * Structured logging with pino (browser build).
 *
 * Provides namespace-scoped loggers that output to the browser console
 * with colored namespace prefixes (like the `debug` package).
 *
 * ## Usage
 *
 * ```ts
 * import { createLogger } from '@prompt-studio/observability';
 * const log = createLogger('auth');
 * log.info({ userId: 'gh-foo' }, 'User logged in');
 * log.warn({ ttlMs: 3600 }, 'Token expiring soon');
 * log.error({ err }, 'Failed to mint token');
 * log.debug('verbose detail');
 * ```
 *
 * ## Enable logging in Chrome DevTools
 *
 * ```js
 * localStorage.setItem('salir:log', 'debug')   // enable all
 * localStorage.setItem('salir:log', 'info')     // info + warn + error
 * localStorage.setItem('salir:log', 'warn')     // warn + error only
 * localStorage.removeItem('salir:log')           // disable (default)
 * ```
 * Then refresh. Or change immediately without refresh:
 * ```js
 * window.__salir_logger.level = 'debug'
 * ```
 *
 * ## Ship warn/error to Axiom (ADR-241)
 *
 * `configureBrowserLogTransmit(handler, level)` attaches a second, independent
 * threshold (default 'warn') that receives every event at or above it —
 * regardless of the console's own level — without changing what prints to
 * DevTools. The app's log-shipping batcher is the intended caller; see the
 * "Transmit (Axiom log-shipping) dual gate" section below for the mechanics.
 */

import pino from 'pino';
import { maskSensitiveData } from './masking';
import type { PinoBrowserLogEvent } from './otel/log-record';

// -- Log level from localStorage --

const LOG_STORAGE_KEY = 'salir:log';
const TAB_ID_STORAGE_KEY = 'salir:tab_id';
const DEFAULT_LEVEL = 'silent';

export type LoggerContext = Record<string, unknown>;

const loggerContext: LoggerContext = {};

function randomId(prefix: string): string {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${random}`;
}

function getOrCreateTabId(): string | undefined {
  if (typeof globalThis.sessionStorage === 'undefined') return undefined;
  try {
    const existing = globalThis.sessionStorage.getItem(TAB_ID_STORAGE_KEY);
    if (existing) return existing;
    const next = randomId('tab');
    globalThis.sessionStorage.setItem(TAB_ID_STORAGE_KEY, next);
    return next;
  } catch {
    return undefined;
  }
}

const browserBaseContext: LoggerContext =
  typeof window === 'undefined'
    ? {}
    : {
        tabId: getOrCreateTabId(),
        debugSessionId: randomId('debug'),
      };

function getStoredLevel(): string {
  try {
    return globalThis.localStorage?.getItem(LOG_STORAGE_KEY) ?? DEFAULT_LEVEL;
  } catch {
    return DEFAULT_LEVEL;
  }
}

// -- Namespace colors (debug-style) --

const NS_COLORS = [
  '#e6194b',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#42d4f4',
  '#f032e6',
  '#bfef45',
  '#fabed4',
  '#469990',
  '#dcbeff',
  '#9A6324',
  '#800000',
  '#aaffc3',
  '#808000',
];
let colorIndex = 0;
const nsColorMap = new Map<string, string>();

function getNamespaceColor(ns: string): string {
  let color = nsColorMap.get(ns);
  if (!color) {
    color = NS_COLORS[colorIndex % NS_COLORS.length];
    colorIndex++;
    nsColorMap.set(ns, color);
  }
  return color;
}

// -- Custom browser write (formatted console output) --

const LEVEL_TO_CONSOLE: Record<number, 'debug' | 'log' | 'info' | 'warn' | 'error'> = {
  10: 'debug', // trace
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'error', // fatal
};

export interface BrowserConsoleLog {
  method: 'debug' | 'log' | 'info' | 'warn' | 'error';
  args: unknown[];
}

export function formatBrowserLogForConsole(o: object): BrowserConsoleLog {
  const { level, msg, ns, time: _t, ...attrs } = o as Record<string, unknown>;
  const lvl = typeof level === 'number' ? level : 30;
  const message = maskSensitiveData(typeof msg === 'string' ? msg : '');
  const namespace = typeof ns === 'string' ? ns : 'salir';
  const method = LEVEL_TO_CONSOLE[lvl] ?? 'log';
  const color = getNamespaceColor(namespace);
  const maskedAttrs = maskSensitiveData({
    ...browserBaseContext,
    ...loggerContext,
    ...attrs,
  });
  const hasAttrs = Object.keys(maskedAttrs).length > 0;

  if (hasAttrs) {
    return {
      method,
      args: [`%c${namespace}%c ${message}`, `color:${color};font-weight:bold`, 'color:inherit', maskedAttrs],
    };
  }

  return {
    method,
    args: [`%c${namespace}%c ${message}`, `color:${color};font-weight:bold`, 'color:inherit'],
  };
}

/**
 * pino `browser.write` callback: formats + prints to the console, gated by
 * `consoleLevel` (see the dual-gate section below). Exported so tests can
 * invoke it directly with a hand-built log object — pino only calls this hook
 * when the BROWSER build of pino is loaded (the real Vite client bundle);
 * under vitest, `import pino from 'pino'` resolves to pino's Node build,
 * which never calls `browser.write`/`browser.transmit.send` at all.
 */
export function browserWrite(o: object): void {
  const record = o as Record<string, unknown>;
  const level = typeof record.level === 'number' ? record.level : 30;
  if (level < levelValue(consoleLevel)) return; // console gate — independent of rootLogger's own (possibly more verbose) level
  const { method, args } = formatBrowserLogForConsole(o);
  console[method](...args);
}

// -- Transmit (Axiom log-shipping) dual gate --
//
// A transmit handler (configureBrowserLogTransmit / clearBrowserLogTransmit)
// lets an app-level batcher observe warn/error events WITHOUT touching what
// prints to the console. Two independently-tracked thresholds:
//   - consoleLevel: today's localStorage-backed level (setLogLevel/getLogLevel).
//   - transmitLevelValue: the handler's floor (warn=40 by default, or error=50).
//
// pino's OWN level (rootLogger.level) only controls whether a given level's
// method is a no-op AT ALL — both `write` (console) and `transmit.send` fire
// TOGETHER whenever it isn't. So rootLogger.level is always recomputed to the
// MORE VERBOSE (lower-numbered) of the two thresholds — the "effective"
// level — and browserWrite/browserTransmitSend each re-filter against their
// OWN threshold below, splitting that one shared enabled-event stream back
// into two independently-gated outputs.

let consoleLevel: string = getStoredLevel();
let transmitHandler: ((event: PinoBrowserLogEvent) => void) | null = null;
let transmitLevelValue = 40; // warn
let transmitFilter: ((event: PinoBrowserLogEvent) => boolean) | null = null;
const childLoggers = typeof WeakRef === 'undefined' ? null : new Set<WeakRef<pino.Logger>>();
const childLoggerFinalizer =
  childLoggers && typeof FinalizationRegistry !== 'undefined'
    ? new FinalizationRegistry<WeakRef<pino.Logger>>((ref) => childLoggers.delete(ref))
    : null;

/** Numeric threshold for a pino level string. DEFAULT_LEVEL ('silent') sorts highest, so it blocks everything. */
function levelValue(level: string): number {
  if (level === DEFAULT_LEVEL) return Number.POSITIVE_INFINITY;
  return pino.levels.values[level] ?? Number.POSITIVE_INFINITY;
}

/** Recompute rootLogger.level from consoleLevel + (when a handler is attached) the transmit floor. */
function recomputeEffectiveLevel(): void {
  let effectiveLevel: string;
  if (!transmitHandler) {
    effectiveLevel = consoleLevel;
  } else if (transmitLevelValue < levelValue(consoleLevel)) {
    effectiveLevel = transmitLevelValue === 50 ? 'error' : transmitLevelValue === 40 ? 'warn' : 'info';
  } else {
    effectiveLevel = consoleLevel;
  }
  rootLogger.level = effectiveLevel;
  if (childLoggers) {
    for (const ref of childLoggers) {
      const child = ref.deref();
      if (child) child.level = effectiveLevel;
      else childLoggers.delete(ref);
    }
  }
}

/**
 * pino `browser.transmit.send` callback: re-checks the transmit floor
 * independently of rootLogger.level (now the more-verbose EFFECTIVE level,
 * not the transmit floor alone) so a handler configured at 'warn' only ever
 * sees warn/error, even while console verbosity is turned up past it. A
 * throwing handler never breaks app logging. Exported for direct testing —
 * see browserWrite's doc comment for why pino can't invoke this hook itself
 * under vitest.
 */
export function browserTransmitSend(_level: string, logEvent: PinoBrowserLogEvent): void {
  if (!transmitHandler || logEvent.level.value < transmitLevelValue) return;
  try {
    if (logEvent.level.value < 40 && transmitFilter && !transmitFilter(logEvent)) return;
    transmitHandler(logEvent);
  } catch {
    // A misbehaving handler must never break app logging.
  }
}

/**
 * Attach a transmit handler that receives every browser log event at or
 * above `level` (default 'warn'), independent of the console's own level —
 * the app-side log-shipping batcher (ADR-241) uses this to ship warn/error to
 * Axiom via the BFF relay without changing what a developer sees in DevTools.
 * Safe to call more than once; the latest handler + level wins.
 */
export function configureBrowserLogTransmit(
  handler: (event: PinoBrowserLogEvent) => void,
  level: 'info' | 'warn' | 'error' = 'warn',
  shouldTransmit?: (event: PinoBrowserLogEvent) => boolean,
): void {
  transmitHandler = handler;
  transmitLevelValue = level === 'error' ? 50 : level === 'warn' ? 40 : 30;
  transmitFilter = shouldTransmit ?? null;
  recomputeEffectiveLevel();
}

/** Detach the transmit handler and restore rootLogger.level to the console level alone. Needed by tests. */
export function clearBrowserLogTransmit(): void {
  transmitHandler = null;
  transmitFilter = null;
  recomputeEffectiveLevel();
}

// -- Error serializer --

// DOMException's 26 legacy code constants (ABORT_ERR, NETWORK_ERR, …) are enumerable
// on the instance (workerd) or its prototype chain (Node) — pino's `for (const key in
// err)` walk in stdSerializers.err copies every one onto the serialized object, so ONE
// DOMException mints 26 Axiom columns and can exhaust the dataset's 257-column budget
// (#1427). No `instanceof DOMException` check: the constants can also arrive on a plain
// object built from one (worker `serialize:true` path), and DOMException may be undefined.
function stripDomExceptionConstants(obj: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(obj)) {
    if (/^[A-Z][A-Z0-9_]*_ERR$/.test(key)) delete obj[key];
  }
  return obj;
}

/**
 * Serialize an `err` field into a structured `{ type, message, stack, … }` object.
 *
 * Guarded on purpose: pino's Node `stdSerializers.err` tolerates non-Error input,
 * but the browser build's equivalent does not — so we only serialize real `Error`
 * instances and pass everything else (strings, plain objects) through untouched.
 * This lets call sites pass the raw error (`logger.error({ err }, 'failed')`) and
 * keep the stack + cause chain instead of the lossy
 * `err instanceof Error ? err.message : String(err)` boilerplate.
 */
export function errSerializer(err: unknown): unknown {
  if (!(err instanceof Error)) return err;
  const base = stripDomExceptionConstants(pino.stdSerializers.err(err) as Record<string, unknown>);
  // pino's browser build — what production workers bundle — maps err →
  // `asErrValue`, which copies own enumerable properties WITHOUT recursing into
  // `cause`: an Error-typed cause serializes as {} because its message/stack
  // are non-enumerable (staging 2026-08-27: a DrizzleQueryError logged
  // cause:{} and hid the LibsqlError reason). Walk the chain ourselves so the
  // emitted shape — cause: [{ type, msg, stack }, …] — is identical in the
  // Node and worker builds (#1367).
  const causeChain: Array<Record<string, unknown>> = [];
  let cause: unknown = err.cause;
  for (let depth = 0; cause instanceof Error && depth < 5; depth++) {
    causeChain.push({ type: cause.constructor.name, msg: cause.message, stack: cause.stack });
    cause = cause.cause;
  }
  if (causeChain.length > 0) base.cause = causeChain;
  return base;
}

// -- Root logger --

const rootLogger = pino({
  level: consoleLevel,
  serializers: { err: errSerializer },
  browser: {
    asObject: true,
    write: browserWrite,
    // Apply top-level `serializers` on the browser path too — without this, the
    // raw Error reaches `browserWrite` with its non-enumerable fields stripped.
    serialize: true,
    transmit: { send: browserTransmitSend },
  },
});

// -- Startup confirmation --

if (consoleLevel !== DEFAULT_LEVEL) {
  rootLogger.info(`Logger active at level: ${consoleLevel}`);
}

// -- Public API --

/**
 * Create a namespaced logger. Namespace appears as a colored prefix
 * in Chrome DevTools console (like the `debug` package).
 *
 * @example
 * const log = createLogger('auth');
 * log.info({ userId }, 'session created');
 * // Console: [salir:auth] session created {userId: "gh-foo"}
 */
export function createLogger(namespace: string): pino.Logger {
  const ns = namespace.startsWith('salir:') ? namespace : `salir:${namespace}`;
  const child = rootLogger.child({ ns });
  if (childLoggers) {
    const ref = new WeakRef(child);
    childLoggers.add(ref);
    childLoggerFinalizer?.register(child, ref);
  }
  return child;
}

/**
 * Change log level at runtime. Persists to localStorage.
 */
export function setLogLevel(level: pino.LevelWithSilentOrString): void {
  consoleLevel = level;
  try {
    if (level === DEFAULT_LEVEL) {
      globalThis.localStorage?.removeItem(LOG_STORAGE_KEY);
    } else {
      globalThis.localStorage?.setItem(LOG_STORAGE_KEY, level);
    }
  } catch {
    // localStorage unavailable
  }
  recomputeEffectiveLevel();
}

/**
 * Get the current CONSOLE log level — what a human sees in DevTools.
 *
 * NOT necessarily rootLogger's own (internal) level: while a transmit handler
 * is attached at a floor more verbose than the console (configureBrowserLogTransmit),
 * rootLogger.level dips to that floor so pino still dispatches those events to
 * the transmit hook — but browserWrite's own console gate keeps them out of
 * DevTools regardless. Callers of getLogLevel (e.g. the Settings log-level
 * picker) want the observable console setting, so this returns consoleLevel,
 * never rootLogger.level.
 */
export function getLogLevel(): string {
  return consoleLevel;
}

/**
 * Merge app-level fields into every browser console log.
 * Passing `undefined` removes a field, which is useful for route/workspace
 * transitions where the previous value should not leak into future logs.
 */
export function setLoggerContext(context: LoggerContext): void {
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) {
      delete loggerContext[key];
    } else {
      loggerContext[key] = value;
    }
  }
}

/** Replace all mutable app-level logger context fields. */
export function replaceLoggerContext(context: LoggerContext): void {
  for (const key of Object.keys(loggerContext)) delete loggerContext[key];
  setLoggerContext(context);
}

/** Clear selected context fields, or all mutable fields when no keys are given. */
export function clearLoggerContext(...keys: string[]): void {
  if (keys.length === 0) {
    for (const key of Object.keys(loggerContext)) delete loggerContext[key];
    return;
  }
  for (const key of keys) delete loggerContext[key];
}

/** Return the current automatic + mutable browser logger context. */
export function getLoggerContext(): LoggerContext {
  return {
    ...browserBaseContext,
    ...loggerContext,
  };
}

// Expose on window for dynamic DevTools control while preserving legacy
// `window.__salir_logger.level = 'debug'` usage. NOTE: assigning `.level`
// directly bypasses the dual gate above — it sets rootLogger's level without
// updating consoleLevel or calling recomputeEffectiveLevel, so a later
// setLogLevel()/configureBrowserLogTransmit() call will clobber it. A legacy
// dev-console escape hatch, not a supported way to change the transmit floor.
if (typeof window !== 'undefined') {
  const exposed = rootLogger as pino.Logger & {
    setLogLevel: typeof setLogLevel;
    getLogLevel: typeof getLogLevel;
    setLoggerContext: typeof setLoggerContext;
    getLoggerContext: typeof getLoggerContext;
    clearLoggerContext: typeof clearLoggerContext;
  };
  exposed.setLogLevel = setLogLevel;
  exposed.getLogLevel = getLogLevel;
  exposed.setLoggerContext = setLoggerContext;
  exposed.getLoggerContext = getLoggerContext;
  exposed.clearLoggerContext = clearLoggerContext;
  (window as unknown as Record<string, unknown>).__salir_logger = exposed;
}

/** The root pino instance -- use createLogger() for namespaced loggers. */
export { rootLogger };

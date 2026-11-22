/**
 * Global error + unhandled-promise capture.
 *
 * Wires pino as the default handler for `window.error`,
 * `window.unhandledrejection`, and `window.rejectionhandled` so:
 *   1. Async failures escaping try/catch surface in DevTools and any
 *      configured ringbuffer/channel sink with the same structured
 *      shape as every other log line (status='failed', kind, route,
 *      err, stack).
 *   2. Operators can copy/paste the failure into a bug report and the
 *      reviewer sees the route + reason at the top of the message
 *      instead of just a vague stack from React.
 *   3. Late-handled promises (rejected then later `.catch`-ed) emit
 *      a warn-level event so race-y code paths surface in the log
 *      stream without escalating to error severity.
 *
 * Cross-environment caveat: some Chrome extensions raise the
 * "A listener indicated an asynchronous response by returning true,
 *  but the message channel closed before a response was received"
 * error from outside our code. It surfaces in `window.error` but
 * never has a useful stack (filename undefined). The filter below
 * demotes this and similar known noise to debug level so real
 * failures stay loud.
 *
 * Web Workers, service workers, and iframes have their own global
 * scopes — call `installGlobalErrorCapture(self)` from inside each
 * if you want pino-shaped error capture there too.
 */

import { createLogger } from './pino-logger';

const log = createLogger('observability:errors');

/** Strings that match Chrome-extension noise unrelated to our code.
 *  These are NOT silenced — they're still pushed at debug level so a
 *  curious operator can see them with the right log level — they just
 *  don't get the loud `error`-level treatment that hides real failures. */
const EXTENSION_NOISE = [
  'A listener indicated an asynchronous response by returning true',
  'message channel closed before a response was received',
  'extension context invalidated',
  'ResizeObserver loop completed with undelivered notifications',
];

function isExtensionNoise(message: string | null | undefined): boolean {
  if (!message) return false;
  return EXTENSION_NOISE.some((needle) => message.includes(needle));
}

/** Best-effort serialization of arbitrary thrown values into something
 *  pino can print without truncating to "[object Object]". Errors keep
 *  their stack; plain objects get JSON-stringified; primitives are
 *  coerced via String(). */
export function serializeReason(reason: unknown): { message: string; stack?: string; raw?: string } {
  if (reason instanceof Error) {
    return { message: reason.message || reason.name, stack: reason.stack };
  }
  if (typeof reason === 'string') {
    return { message: reason };
  }
  if (reason && typeof reason === 'object') {
    try {
      return { message: 'non-Error rejection', raw: JSON.stringify(reason) };
    } catch {
      return { message: 'non-Error rejection (unserializable)' };
    }
  }
  return { message: String(reason) };
}

/** The route-like context to log alongside each captured error. We
 *  prefer hash (used by both console.salir.se and app.salir.se for
 *  in-app routes) and fall back to pathname so the helper works on
 *  surfaces that don't use hash routing. */
function routeContext(target: Window): string {
  return target.location?.hash || target.location?.pathname || '';
}

let installed = false;

/** Install the listeners. Idempotent — calling twice is a no-op so
 *  React StrictMode's double-mount doesn't double-bind. */
export function installGlobalErrorCapture(target: Window = window): void {
  if (installed) return;
  installed = true;

  target.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const { message, stack, raw } = serializeReason(event.reason);
    if (isExtensionNoise(message)) {
      log.debug(
        { status: 'noise', kind: 'unhandledrejection', message },
        'Suppressed browser-extension noise (unhandled rejection)',
      );
      return;
    }
    log.error(
      {
        status: 'failed',
        kind: 'unhandledrejection',
        route: routeContext(target),
        message,
        stack,
        raw,
      },
      `Unhandled promise rejection: ${message}`,
    );
  });

  // `rejectionhandled` fires when a promise rejection that was already
  // surfaced via `unhandledrejection` later gets a `.catch(...)` /
  // `.then(_, h)` handler attached. The race is real: a microtask
  // ordering bug can let the rejection escape to the global handler,
  // then a subsequent `.catch()` quietly clears it. Logging at warn
  // gives operators a paper trail without escalating to the error tier
  // that wakes pagers.
  target.addEventListener('rejectionhandled', (event: PromiseRejectionEvent) => {
    const { message, stack, raw } = serializeReason(event.reason);
    if (isExtensionNoise(message)) return;
    log.warn(
      {
        status: 'recovered',
        kind: 'rejectionhandled',
        route: routeContext(target),
        message,
        stack,
        raw,
      },
      `Promise rejection was later handled: ${message}`,
    );
  });

  target.addEventListener('error', (event: ErrorEvent) => {
    const { message, filename, lineno, colno } = event;
    if (isExtensionNoise(message)) {
      log.debug({ status: 'noise', kind: 'error', message }, 'Suppressed browser-extension noise (error event)');
      return;
    }
    const reason = serializeReason(event.error ?? message);
    log.error(
      {
        status: 'failed',
        kind: 'window-error',
        route: routeContext(target),
        message: reason.message,
        stack: reason.stack,
        filename,
        lineno,
        colno,
      },
      `Uncaught error: ${reason.message}`,
    );
  });
}

/** Test-only — undo the installed flag so the module can be re-installed
 *  in a fresh environment. NOT exported from index because production
 *  code never needs to uninstall. */
export function __resetGlobalErrorCaptureForTest(): void {
  installed = false;
}

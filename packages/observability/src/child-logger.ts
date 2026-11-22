// Scoped child logger with arktype-projected bindings (ADR-114 §5, "scoped" layer).
//
// The middle layer of the three-layer context model:
//   - ambient    → pino `mixin` (correlationId), every line
//   - scoped     → THIS: bind a unit-of-work's stable context once via `.child()`
//   - per-message → `logFields(...).pick(payload)`, per call
//
// Binding context through a `logFields` projector keeps child bindings small and
// safe: only declared keys are bound (no huge objects / stray secrets attached to
// every line) — which also honors pino's guidance never to bind untrusted keys.
//
//   const log = childLogger(c.var.logger, OAuthScope, { workspaceId, scope: 'oauth' })
//   log.error(OAuthErrorCtx.pick({ err }), Logs.callbackError)

import type { LogProjector } from './log-fields';

/** Any logger that can spawn a child with extra bindings (pino, our Logger, …). */
export interface ChildableLogger {
  child(bindings: Record<string, unknown>): this;
}

/**
 * Create a child logger carrying `scope.pick(ctx)` as bound context. The bindings
 * are projected to the scope's declared fields (never throws — see `logFields`).
 */
export function childLogger<L extends ChildableLogger>(logger: L, scope: LogProjector, ctx: unknown): L {
  return logger.child(scope.pick(ctx));
}

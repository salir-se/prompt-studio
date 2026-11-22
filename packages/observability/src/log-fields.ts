// Arktype-projected, resilient log context (ADR-114 call-site convention).
//
// Logging must never break the request it is logging. A log call should also not
// dump a whole domain object (huge payloads, accidental secrets) into the line.
// `logFields(def)` builds a hoisted arktype projector whose `pick(ctx)` trims an
// arbitrary `ctx` down to the DECLARED fields only — and never throws.
//
// Call-site shape (paired with a per-module `Logs` text catalog):
//
//   import { logFields } from '@prompt-studio/observability'
//   export const Logs = { sessionIssued: 'session issued' } as const
//   export const SessionCtx = logFields({ 'userId?': 'string', 'workspaceId?': 'string' })
//
//   logger.info(SessionCtx.pick(ctx), Logs.sessionIssued)
//
// `pick` is the runtime projector. (arktype's own `.cast` is type-only — no runtime
// work — so the actual field reduction lives here under a clearer, intent-revealing name.)

import { type } from 'arktype';

/** Arktype object definition: declared keys (optionally `key?`) → arktype value defs. */
export type LogFieldsDef = Record<string, unknown>;

export interface LogProjector {
  /**
   * Project `ctx` to the declared fields. Whitelists declared keys, drops the
   * rest, applies arktype morphs/coercion on success, and NEVER throws:
   *   - non-object `ctx` → `{}`
   *   - validation failure (e.g. a wrong field type) → best-effort whitelist pick
   *     of the declared keys present on `ctx` (raw values, unvalidated)
   */
  pick(ctx: unknown): Record<string, unknown>;
}

/** arktype meta keys that are not real data fields. */
const META_KEYS = new Set(['+', '[string]']);

/** Declared top-level data keys, with the optional `?` marker stripped. */
function declaredKeys(def: LogFieldsDef): string[] {
  return Object.keys(def)
    .filter((k) => !META_KEYS.has(k))
    .map((k) => (k.endsWith('?') ? k.slice(0, -1) : k));
}

/**
 * Build a hoisted log-context projector. Construct ONCE at module scope and reuse
 * — building an arktype schema JIT-compiles a validator (do not call per log line).
 * The build itself happens on the first `pick`, so declaring a projector costs nothing at startup.
 */
export function logFields(def: LogFieldsDef): LogProjector {
  const keys = declaredKeys(def);

  // Strip undeclared keys via `'+': 'delete'`. The arktype validator is built on the first `pick`, not at import:
  // a Worker declares dozens of projectors at module scope and pays every build at startup otherwise (Worker startup
  // budget). If the def is somehow invalid we degrade to the plain whitelist pick rather than blowing up.
  let validate: ((data: unknown) => unknown) | undefined;
  let built = false;
  const validator = (): ((data: unknown) => unknown) | undefined => {
    if (!built) {
      built = true;
      try {
        validate = type({ ...def, '+': 'delete' }) as unknown as (data: unknown) => unknown;
      } catch {
        validate = undefined;
      }
    }
    return validate;
  };

  const pick = (obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      if (k in obj) out[k] = obj[k];
    }
    return out;
  };

  return {
    pick(ctx: unknown): Record<string, unknown> {
      if (ctx === null || typeof ctx !== 'object') return {};
      const obj = ctx as Record<string, unknown>;
      const validate = validator();
      if (validate) {
        try {
          const out = validate(obj);
          if (!(out instanceof type.errors)) return out as Record<string, unknown>;
        } catch {
          // fall through to the resilient pick
        }
      }
      return pick(obj);
    },
  };
}

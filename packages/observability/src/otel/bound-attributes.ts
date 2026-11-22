/**
 * Bound the SPA log relay's `attributes.*` key namespace (issue #1489).
 *
 * Axiom's `salir-logs-staging` dataset caps every dataset at 257 total
 * columns. Every distinct `attributes.<key>` seen by the relay mints its own
 * column the first time it is observed -- so ONE novel key (a typo, a
 * one-off debug field, a browser-specific error shape such as a
 * `DOMException`'s enumerable `ABORT_ERR`/`INDEX_SIZE_ERR`/... constants
 * spread across an `err` object by pino's serializer) can push the dataset
 * over the cap and get the WHOLE batch rejected by Axiom -- not just the
 * record carrying the novel key (see #1427 for the incident where exactly
 * this exhausted the column budget).
 *
 * `boundLogAttributes` closes that hole: only a fixed, reviewed allowlist of
 * keys (`INDEXED_LOG_ATTRIBUTE_KEYS`) may become their own Axiom column.
 * Everything else is folded into a single `extra` attribute (one JSON blob,
 * one column, regardless of how many distinct unknown keys show up). Adding
 * a key to the allowlist requires a free column slot in the dataset -- see
 * #1427 -- and every key here must already exist as a `salir-logs-staging`
 * column; this module is not the place to mint a new one.
 *
 * IMPORTANT -- keys arrive DOTTED, not nested: the SPA client flattens
 * fields before shipping (`log-record.ts`'s `flattenEntry`/`toOtelAttributes`,
 * see that file's docblock around lines 100-130), so by the time a record
 * reaches this module `err`/`req`/`res` are never plain-object values -- their
 * useful subfields already arrived as their OWN top-level attribute keys,
 * e.g. `err.message`, `err.stack`, `req.url`, `res.status`. Those dotted keys
 * are therefore listed in `INDEXED_LOG_ATTRIBUTE_KEYS` directly (not derived
 * from `PRUNED_OBJECT_SUBKEYS`), so they keep passing through as their own
 * column. A dotted key NOT listed -- e.g. a `DOMException`'s
 * `err.INDEX_SIZE_ERR`/`err.ABORT_ERR`/... enumerable constants -- is not
 * "err" and is not allowlisted, so it correctly folds into `extra` like any
 * other novel key.
 *
 * The `err`/`req`/`res` object-pruning branch below (`PRUNED_OBJECT_SUBKEYS`)
 * is defense-in-depth for a caller that hands this function an UNFLATTENED
 * object directly (this is a general-purpose pure function, not solely wired
 * to the post-flatten relay path) -- it is inert on the relay's own call path
 * today, but stays, and stays unit-tested, for that reason.
 *
 * `boundOtelAttributes` (below) is the OTLP-`OtelKeyValue[]`-level wrapper
 * around `boundLogAttributes` -- both emitter legs that ship OTLP records
 * directly call it: the SPA relay (`services/bff/src/routes/app-logs.ts`) and
 * the worker OTel tee (`packages/worker-http/src/axiom.ts`'s
 * `recordWorkerLogEvent`). One allowlist, one shared column budget.
 */

import type { OtelAttributeValue, OtelKeyValue } from './log-record';
import { MAX_ATTR_VALUE_CHARS } from './normalize';

/**
 * The only keys allowed to pass through as their own `attributes.<key>`
 * column. Each of these already exists as a `salir-logs-staging` column --
 * verified against the live dataset schema when this list was built. Do NOT
 * add a key here without first confirming a free column slot (#1427).
 */
export const INDEXED_LOG_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set([
  'correlationId',
  'originCorrelationId',
  'runId',
  'debugSessionId',
  'jobId',
  'workspaceId',
  'groupId',
  'orgId',
  'userId',
  'companyId',
  'signalId',
  'campaignId',
  'notificationId',
  'scope',
  'status',
  'resultStatus',
  'code',
  'statusCode',
  'kind',
  'source',
  'reason',
  'intent',
  'outcome',
  'milestone',
  'action',
  'component',
  'service',
  'app',
  'agentName',
  'provider',
  'toolName',
  'method',
  'path',
  'route',
  'page',
  'tab',
  'tabId',
  'durationMs',
  'latencyMs',
  'responseTime',
  'totalTokens',
  'iteration',
  'attempt',
  'count',
  'error',
  'stack',
  'seq',
  'stackChunks',
  // Dotted keys: the client flattens `err`/`req`/`res` before shipping (see
  // the module docblock above), so these are the ACTUAL top-level attribute
  // keys the relay sees -- not subkeys of a nested object.
  'err.message',
  'err.msg',
  'err.name',
  'err.code',
  'err.status',
  'err.type',
  'err.stack',
  'err.retryable',
  'err.cause',
  'err.kind',
  'req.method',
  'req.route',
  'req.url',
  'res.status',
  // Worker-leg keys (#1489 follow-up): already-existing columns emitted by
  // CacheFailureCtx / GroupSqlCtx / LlmProxyUpstreamCtx / TursoUsageCtx --
  // verified against the live schema 2026-09-02.
  'op',
  'store',
  'cacheKey',
  'ttlSeconds',
  'ms',
  'rows',
  'endpoint',
  'upstreamStatus',
  'openaiRequestId',
  'errorType',
  'errorCode',
  'errorParam',
  'errorMessage',
  'model',
  'hasTools',
  'reasoningEffort',
  'tursoDbName',
  // Outreach event log (`withOutreachEventLog`, @prompt-studio/pipeline): the two ids a
  // Salir user's "what happened to this email / conversation?" filters on.
  // New columns — the staging dataset held 234 of 257 on 2026-09-27 (#1427).
  'leadId',
  'messageId',
]);

/** Subkeys kept when `err`/`req`/`res` carries a plain-object value. Every
 *  other subkey (e.g. a `DOMException`'s `ABORT_ERR`, `INDEX_SIZE_ERR`, ...
 *  enumerable constants) is dropped outright -- not folded -- because it is
 *  derivable noise, not information: dropping it is precisely what stops
 *  those constants from minting a fresh dataset column apiece. */
const PRUNED_OBJECT_SUBKEYS: Record<'err' | 'req' | 'res', readonly string[]> = {
  err: ['name', 'message', 'msg', 'code', 'status', 'type', 'stack', 'retryable'],
  req: ['method', 'route', 'url'],
  res: ['status'],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function pruneKnownObject(kind: 'err' | 'req' | 'res', value: Record<string, unknown>): Record<string, unknown> {
  const keep = PRUNED_OBJECT_SUBKEYS[kind];
  const pruned: Record<string, unknown> = {};
  for (const key of keep) {
    if (key in value) pruned[key] = value[key];
  }
  return pruned;
}

function truncateExtra(json: string): string {
  return json.length <= MAX_ATTR_VALUE_CHARS ? json : `${json.slice(0, MAX_ATTR_VALUE_CHARS - 1)}…`;
}

/**
 * Bound an attributes record to the reviewed key allowlist. Pure, never
 * throws.
 *
 * - A key in `INDEXED_LOG_ATTRIBUTE_KEYS` passes through unchanged.
 * - `err`/`req`/`res` pass through too, but a plain-object value is pruned to
 *   its known subkeys only (see `PRUNED_OBJECT_SUBKEYS`); a non-object value
 *   (already a string, e.g.) passes through as-is.
 * - Every other key -- including an incoming `extra` -- is folded into a
 *   single relay-authored `extra` attribute: `JSON.stringify` of the fold
 *   map, truncated to `MAX_ATTR_VALUE_CHARS` with a trailing `…` when cut.
 * - `undefined`/empty input returns `{}`.
 */
export function boundLogAttributes(attrs: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!attrs) return {};

  const out: Record<string, unknown> = {};
  const fold: Record<string, unknown> = {};
  let hasFold = false;

  for (const [key, value] of Object.entries(attrs)) {
    if (INDEXED_LOG_ATTRIBUTE_KEYS.has(key)) {
      out[key] = value;
      continue;
    }
    if (key === 'err' || key === 'req' || key === 'res') {
      out[key] = isPlainObject(value) ? pruneKnownObject(key, value) : value;
      continue;
    }
    fold[key] = value;
    hasFold = true;
  }

  if (hasFold) {
    out.extra = truncateExtra(JSON.stringify(fold));
  }

  return out;
}

/**
 * Unwrap one OTLP `AnyValue` to its plain JS scalar. Inverse of `toAttributeValue`
 * in `./log-record.ts` -- `intValue` is OTLP's decimal-string int64 encoding, so it
 * round-trips back through `Number(...)` rather than staying a string (which would
 * flip it to `stringValue` on the way back out and risk a dataset column-type
 * mismatch for an allowlisted numeric key).
 */
function unwrapAttributeValue(value: OtelAttributeValue): unknown {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.intValue !== undefined) return Number(value.intValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  return undefined;
}

/** Inverse of `unwrapAttributeValue` -- rewrap a plain JS scalar as an OTLP `AnyValue`. */
function wrapAttributeValue(value: unknown): OtelAttributeValue {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }
  return { stringValue: JSON.stringify(value) };
}

/**
 * Bound one OTLP record's attribute-key namespace (#1489) to the same
 * reviewed allowlist as `boundLogAttributes`: unwrap each `OtelKeyValue` to a
 * plain scalar, run it through `boundLogAttributes`, then rewrap the bounded
 * map back into OTLP `AnyValue` form. Shared by both emitter legs that ship
 * OTLP records directly -- the SPA relay (`services/bff/src/routes/app-logs.ts`)
 * and the worker OTel tee (`packages/worker-http/src/axiom.ts`) -- so a novel
 * attribute key can never mint a new Axiom column from either leg.
 */
export function boundOtelAttributes(attributes: OtelKeyValue[]): OtelKeyValue[] {
  const attrsMap: Record<string, unknown> = {};
  for (const { key, value } of attributes) {
    attrsMap[key] = unwrapAttributeValue(value);
  }
  const bounded = boundLogAttributes(attrsMap);
  return Object.entries(bounded).map(([key, value]) => ({ key, value: wrapAttributeValue(value) }));
}

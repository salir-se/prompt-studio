// Pino native redaction config (ADR-114, "pino redact only" decision).
//
// fast-redact path-based secret redaction, applied at the pino sink. This is a
// BACKSTOP — `logFields(...).pick(payload)` (allowlist) remains the primary
// defense. Path-based redaction has inherent limits, by design:
//   - it replaces whole values at listed paths; it CANNOT scrub a secret embedded
//     inside a string (e.g. a token inside an error `stack`/`message`),
//   - wildcards match a single level, so it covers the listed leaf keys at the top
//     level and one level deep — not arbitrary depth,
//   - paths are static config (never user input — fast-redact compiles them).
// Keep secrets out of logs at the source (allowlist projection); this catches the rest.

import { maskSecretValue } from './masking';

/** Leaf key names that must never appear in a log value. */
const SENSITIVE_LEAF_KEYS = [
  'authorization',
  'cookie',
  'password',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'jwt',
  'sessionToken',
  'session_token',
  'privateKey',
  'private_key',
  'encryptionKey',
  'encryption_key',
] as const;

/** Pino `redact.paths` — each sensitive leaf at the top level and one level deep, plus known headers. */
export const WORKER_REDACT_PATHS: string[] = [
  ...SENSITIVE_LEAF_KEYS,
  ...SENSITIVE_LEAF_KEYS.map((k) => `*.${k}`),
  'req.headers.authorization',
  'req.headers.cookie',
];

/**
 * Identifiable censor: instead of an opaque token, keep the first/last 4 chars of
 * the secret (collapsing short values to `***`) so an operator can still tell
 * WHICH value was present without exposing it — e.g. `ghs_...9f2a`. Non-string
 * values are coerced before masking.
 */
export const redactCensor = (value: unknown): string =>
  maskSecretValue(typeof value === 'string' ? value : String(value));

/** Ready-to-use pino `redact` option for worker loggers: `pino({ redact: workerRedact })`. */
export const workerRedact: { paths: string[]; censor: (value: unknown) => string } = {
  paths: WORKER_REDACT_PATHS,
  censor: redactCensor,
};

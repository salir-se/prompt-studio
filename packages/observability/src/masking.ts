/**
 * Sensitive data masking for log output.
 *
 * Automatically redacts API keys, tokens, passwords, emails, and other
 * PII from log payloads before they reach any logger sink (console, server, UI).
 *
 * Applied to all three logger types (debug, observability, public).
 */

/** Patterns that identify sensitive field names (case-insensitive). */
const SENSITIVE_KEYS = new Set([
  'apikey',
  'api_key',
  'apiKey',
  'password',
  'secret',
  'token',
  'authtoken',
  'auth_token',
  'authToken',
  'accesstoken',
  'access_token',
  'accessToken',
  'refreshtoken',
  'refresh_token',
  'refreshToken',
  'authorization',
  'x-api-key',
  'encryptionkey',
  'encryption_key',
  'encryptionKey',
  'jwt',
  'sessiontoken',
  'session_token',
  'sessionToken',
  'privatekey',
  'private_key',
  'privateKey',
  'brevoApiKey',
  'brevo_api_key',
  'email',
  'emailAddress',
  'email_address',
  'senderEmail',
  'sender_email',
  'recipientEmail',
  'recipient_email',
]);

/** Regex patterns for inline value detection. */
const VALUE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Email addresses in messages or free-form fields.
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: '***@***' },
  // API keys (sk-..., key-..., etc.)
  { pattern: /\b(sk-[a-zA-Z0-9_-]{10,})/g, replacement: 'sk-***' },
  { pattern: /\b(key-[a-zA-Z0-9_-]{10,})/g, replacement: 'key-***' },
  // Bearer tokens in strings
  { pattern: /(Bearer\s+)[a-zA-Z0-9._-]{10,}/gi, replacement: '$1***' },
  // JWT tokens (three dot-separated base64 segments)
  { pattern: /\b(eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+)/g, replacement: 'jwt-***' },
];

const MASK = '***';

/** Below this length a 4+4 reveal would expose most of the value. */
const MIN_REVEALABLE_LENGTH = 12;

/**
 * Identifiable mask for an opaque secret: keep the first and last 4 characters so
 * an operator can recognise WHICH value it is (match it against a known key)
 * without exposing it — e.g. `ghs_...9f2a`. Values shorter than 12 chars collapse
 * to `***` so neither the value nor a guessable fraction leaks. Deterministic, so
 * repeated log lines for the same secret compare cleanly.
 */
export function maskSecretValue(value: string): string {
  if (!value) return '';
  if (value.length < MIN_REVEALABLE_LENGTH) return MASK;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

/** Mask a single value if it looks sensitive. */
function maskValue(value: unknown): unknown {
  if (typeof value === 'string') {
    let masked = value;
    for (const { pattern, replacement } of VALUE_PATTERNS) {
      // Reset lastIndex for global regexes
      pattern.lastIndex = 0;
      masked = masked.replace(pattern, replacement);
    }
    return masked;
  }
  return value;
}

/**
 * Deep-mask sensitive fields in a log payload.
 *
 * Traverses the object tree and:
 * 1. Replaces values of keys matching SENSITIVE_KEYS with '***'
 * 2. Scans string values for inline patterns (API keys, JWTs, Bearer tokens)
 * 3. Replaces unvisited deep subtrees and reference cycles with diagnostic markers
 *
 * Returns a new object — does not mutate the original.
 */
export function maskSensitiveData<T>(data: T, depth = 0): T {
  return maskData(data, depth, new WeakSet());
}

function maskData<T>(data: T, depth: number, ancestors: WeakSet<object>): T {
  // Never return an unvisited subtree: sinks can serialize secrets below the limit.
  if (depth > 10) return '[Truncated]' as T;

  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    return maskValue(data) as T;
  }

  if (typeof data === 'object') {
    if (ancestors.has(data)) return '[Circular]' as T;
    ancestors.add(data);
    if (Array.isArray(data)) {
      const result = data.map((item) => maskData(item, depth + 1, ancestors));
      ancestors.delete(data);
      return result as T;
    }
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(key.toLowerCase())) {
        result[key] = typeof value === 'string' ? MASK : value !== undefined ? MASK : undefined;
      } else {
        result[key] = maskData(value, depth + 1, ancestors);
      }
    }
    ancestors.delete(data);
    return result as T;
  }

  return data;
}

/** Check if a key name is considered sensitive. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(key.toLowerCase());
}

/** Register additional sensitive key names at runtime. */
export function addSensitiveKeys(...keys: string[]): void {
  for (const key of keys) {
    SENSITIVE_KEYS.add(key);
  }
}

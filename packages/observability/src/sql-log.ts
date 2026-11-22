// Pure SQL-log helpers shared by every layer that instruments a libSQL/Turso
// client — packages/storage's `TursoAdapter` (browser-side) and services/bff's
// group-DB fan-out (`instrumentGroupClient`, worker-side). Extracted here so
// both tiers emit directly comparable `*.sql` debug lines (same normalization,
// same target-derivation rule, same redaction discipline) without duplicating
// the parsing logic per call site.
//
// NEVER log arg VALUES — only counts. Collection KEYS (e.g. "config",
// "mailboxQuotaState") are the one exception `sqlTarget` surfaces: they are not
// secrets, whereas row data and other arg values are.

/** Whitespace-normalized, length-capped SQL text safe for a single log line. */
export function normalizeSqlText(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * Human label for the table/collection a statement targets — the key
 * discriminator when reconstructing a query sequence from the log stream.
 * `argsOrKey` is the statement's args (array/object) when available; only its
 * shape is inspected (for the `collections` key special case), never logged.
 */
export function sqlTarget(sql: string, argsOrKey?: unknown): string {
  if (/\bcollections\b/i.test(sql)) {
    const first = Array.isArray(argsOrKey) ? argsOrKey[0] : undefined;
    return typeof first === 'string' && first.length <= 64 ? `collections[${first}]` : 'collections';
  }
  const m = sql.match(
    /\b(?:insert\s+into|update|delete\s+from|from|table(?:\s+if\s+not\s+exists)?|index(?:\s+if\s+not\s+exists)?|trigger(?:\s+if\s+not\s+exists)?)\s+"?([a-z_][a-z0-9_]*)"?/i,
  );
  return m ? m[1] : '(other)';
}

/** Positional (array) or named (object) SQL arg count — never the values themselves. */
export function argCount(args: unknown): number {
  if (Array.isArray(args)) return args.length;
  return args && typeof args === 'object' ? Object.keys(args).length : 0;
}

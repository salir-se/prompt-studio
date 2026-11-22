/**
 * Compare the model a connection test *asked* for with the one the provider
 * actually *served*.
 *
 * Providers are free to resolve a requested id to something else: a dated
 * build (`claude-sonnet-4-6` → `claude-sonnet-4-6-20250929`), a routing form
 * (`anthropic/claude-sonnet-5` → `claude-sonnet-5`), or — the case this module
 * exists for — a wholly different model, e.g. z.ai answering a `glm-5.2`
 * request with `glm-5.3`. The first two are the same model wearing a different
 * label; the third means the configured id is NOT what will run.
 *
 * Reporting the served id alone (what the connection test used to do) hides
 * that difference behind a green check, so this returns both sides plus an
 * explicit `mismatch` the UI can escalate.
 */

/** Result of comparing a requested model id against the served one. */
export interface ServedModelComparison {
  /** The id the test asked for, verbatim (undefined when the caller sent none). */
  requested?: string;
  /** The id the provider echoed back, verbatim (undefined when it echoed none). */
  served?: string;
  /**
   * True only when both ids are known AND name different models. Unknown on
   * either side is never a mismatch — a provider that omits `model` from its
   * response must not produce a scary warning.
   */
  mismatch: boolean;
}

/**
 * Canonical form for comparison only — never for display.
 *
 * Drops the vendor routing prefix (`anthropic/`, `z-ai/`), any OpenRouter
 * variant suffix (`:free`, `:beta`), and folds `.` to `-` so the app's dotted
 * GLM convention (`glm-5.2`) matches a provider's dashed echo (`glm-5-2`).
 */
function canonical(model: string): string {
  const withoutVariant = model.trim().toLowerCase().split(':')[0];
  const lastSlash = withoutVariant.lastIndexOf('/');
  const withoutVendor = lastSlash === -1 ? withoutVariant : withoutVariant.slice(lastSlash + 1);
  return withoutVendor.replace(/\./g, '-');
}

/**
 * True when one id is the other plus a trailing segment — the shape a dated or
 * pinned build takes (`glm-5.2` vs `glm-5.2-0414`). The separator is required:
 * without it `glm-5.2` would swallow `glm-5.21`.
 */
function isSameFamily(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}-`) || b.startsWith(`${a}-`);
}

export function compareServedModel(requested?: string, served?: string): ServedModelComparison {
  if (!requested || !served) return { requested, served, mismatch: false };
  return { requested, served, mismatch: !isSameFamily(canonical(requested), canonical(served)) };
}

/**
 * The `, model: …` tail appended to a successful connection-test message.
 *
 * On a match it names the one id involved. On a mismatch it names both, in
 * served-vs-configured order, because a line carrying only the served id reads
 * as "your model connected fine" — the exact misreading this fix closes.
 */
export function describeServedModel(comparison: ServedModelComparison): string {
  const { requested, served, mismatch } = comparison;
  if (mismatch) return `, served model: ${served} — not the configured ${requested}`;
  const known = served || requested;
  return `, model: ${known || 'unknown'}`;
}

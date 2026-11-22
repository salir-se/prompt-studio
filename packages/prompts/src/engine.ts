/**
 * Mustache-style `{{variable}}` template engine for LLM prompts.
 *
 * Was previously backed by the `eta` package, but eta drags `node:fs` and
 * `node:path` into the browser bundle (Vite externalizes them, breaking any
 * eta code path that touches the filesystem). We use none of eta's
 * filesystem features — only `{{var}}` substitution — so a 5-line regex
 * replaces the dependency entirely.
 *
 * Behavior is identical to the old eta-backed implementation:
 *   - `{{ name }}` placeholders are substituted from the data record
 *   - Whitespace inside the braces is allowed
 *   - Single braces in JSON examples are left alone
 *   - Values are NOT HTML-escaped (LLM prompts are not HTML)
 *   - Numbers, booleans, etc. are coerced to string
 *   - `null` / `undefined` render as empty string
 */

/**
 * Matches `{{ name }}` placeholders. Identifier rules match JS variable names.
 * Exported so other prompt tooling (e.g. `variable-assist.ts`'s editor-assist
 * tokenizer) can tokenize by the exact same grammar instead of duplicating it.
 * Global regexes are stateful (`lastIndex`) — callers iterating manually
 * should create a fresh instance (`new RegExp(re.source, re.flags)`) per scan
 * rather than sharing this module-level singleton across call sites.
 */
export const PROMPT_PLACEHOLDER_RE = /\{\{\s*([A-Za-z_][\w]*)\s*\}\}/g;

function coerce(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Escape template delimiters to prevent prompt injection via external data
  return str.replace(/\{\{/g, '{ {').replace(/\}\}/g, '} }');
}

/**
 * Strict render — throws `ReferenceError` if a `{{key}}` placeholder is not
 * present in `data`. Use this when missing keys indicate a programming bug.
 */
export function renderTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(PROMPT_PLACEHOLDER_RE, (_match, key: string) => {
    if (!(key in data)) {
      throw new ReferenceError(`${key} is not defined`);
    }
    return coerce(data[key]);
  });
}

/**
 * Forgiving render — missing `{{key}}` placeholders become empty string,
 * matching the historical `.replace('{x}', y)` behavior where unfilled
 * placeholders silently disappeared. Use this at every prompt boot site.
 */
export function renderPrompt(template: string, data: Record<string, unknown> = {}): string {
  return template.replace(PROMPT_PLACEHOLDER_RE, (_match, key: string) => coerce(data[key]));
}

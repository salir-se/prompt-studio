import { LEGACY_PROMPT_ROOTS, type LegacyPromptSourceRef } from '@prompt-studio/prompts';
import type { PromptContentSource } from './prompt-content-source';
import { parseExportedToolArray } from './tools-literal-parser';

/**
 * The MOUNTED-repository implementation of the `PromptContentSource` seam (see
 * `./prompt-content-source.ts` for why the seam exists). Where `bundledPromptContentSource`
 * statically imports prompt text from `@prompt-studio/prompts` — baking it into the SPA bundle —
 * this implementation fetches the same text at RUNTIME from the operator's own checkout of
 * the repo, through the studio's read-only `/__studio/*` fs bridge (`../bridge/fs-bridge.ts`).
 * A container built against this source ships zero prompt prose; the operator supplies it by
 * mounting their repo at container start.
 *
 * NOT WIRED IN ANYWHERE YET. A later task decides where `vite.config.ts` / the container build
 * picks this over `bundledPromptContentSource`; this module only has to exist and be correct.
 *
 * ── Why this does NOT import from `../bridge/fs-bridge.ts` ─────────────────────────────────
 * `fs-bridge.ts` imports `node:crypto` and `node:fs/promises` — real Node built-ins with no
 * browser shim in this app's Vite config. It is a dev-server/Node-only module, imported today
 * only from `vite.config.ts` and `server/**`. `FinalPromptPanel.tsx` (browser-bundled) already
 * hit this: it duplicates the `x-studio-token` header name as a local constant instead of
 * importing `STUDIO_TOKEN_HEADER` from `fs-bridge.ts`, to keep Node built-ins out of the SPA
 * bundle. This module is imported by catalog builders that ship in the browser bundle too, so
 * it follows the same rule: read the bridge's HTTP *contract* (endpoint shape, header name,
 * response shape) by copying the tiny constant, never the module itself.
 *
 * ── Symbol → source-file resolution ─────────────────────────────────────────────────────────
 * `LEGACY_PROMPT_ROOTS` (imported from `@prompt-studio/prompts`, same as `root-catalog.ts` does) is
 * metadata, not prose — every `owner`/`variants` entry names a `{ module, symbol }` pair. This
 * module builds a `symbol -> module` map from those pairs and, for a requested symbol, fetches
 * that module's `.ts` text through the bridge and text-extracts the named export. It does NOT
 * hardcode which symbols are "real" prompt constants (that would duplicate knowledge the
 * inventory already holds) — a symbol whose owner is a function reference, or whose module
 * lives outside the bridge's allowlisted roots (`packages/prompts`, per `fs-bridge.ts`), simply
 * fails to extract and degrades to `null`, exactly like an unresolvable one does today.
 *
 * ── Async vs. sync ───────────────────────────────────────────────────────────────────────────
 * `PromptContentSource.getPromptText`/`getToolSourceLists` are synchronous, but fetching the
 * mount is inherently async. Rather than widen the interface (which would ripple into
 * `root-catalog.ts`, `tool-directory.ts`, and every caller — all synchronous today, all outside
 * this task's file scope), this source exposes an extra `prime(): Promise<void>` that resolves
 * every reachable symbol ONCE, up front, into an in-memory map; `getPromptText` then just reads
 * that map synchronously. `prime()` is not part of `PromptContentSource` itself — TypeScript's
 * structural typing means `bridgeContentSource` still satisfies the interface as-is, so this is
 * the smallest possible blast radius: zero changes to `prompt-content-source.ts` or any consumer.
 * Whoever wires this in for container builds calls `await bridgeContentSource.prime()` before
 * handing it to `buildRootCatalog`/`buildToolDirectory`, the same way `FinalPromptPanel` already
 * awaits `fetchSkillBody` before rendering.
 */

/** Duplicated from `fs-bridge.ts` on purpose — see the module doc above. */
const STUDIO_TOKEN_HEADER = 'x-studio-token';

/** An inline-assembled root's owner has no importable symbol at all (see `root-catalog.ts`). */
function isInlineOwner(owner: LegacyPromptSourceRef): boolean {
  return owner.symbol.startsWith('<');
}

/**
 * Every symbol `LEGACY_PROMPT_ROOTS` names as an `owner` or `variant` (the two shapes that can
 * be an actual `export const X = ...` prompt-text declaration), mapped to its declaring module.
 * First declaration wins on a name collision, matching `resolveVariants`'s dedupe convention in
 * `root-catalog.ts`. Excludes inline owners (no symbol to look up) and every other reference
 * kind (`consumers`, `dynamicSources`, `toolSets`, `ownedFragments`, `legacyIdentity`) — those
 * name call sites and fragments, not the root prompt-text constants this source resolves.
 */
function collectPromptTextSymbolModules(): ReadonlyMap<string, string> {
  const moduleBySymbol = new Map<string, string>();
  for (const entry of LEGACY_PROMPT_ROOTS) {
    const refs: LegacyPromptSourceRef[] = isInlineOwner(entry.owner) ? [] : [entry.owner];
    refs.push(...entry.variants);
    for (const ref of refs) {
      if (!moduleBySymbol.has(ref.symbol)) {
        moduleBySymbol.set(ref.symbol, ref.module);
      }
    }
  }
  return moduleBySymbol;
}

async function readStudioToken(): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  return document.querySelector('meta[name="studio-token"]')?.getAttribute('content') ?? null;
}

/**
 * Fetches one module's raw text through the bridge, following the exact pattern
 * `FinalPromptPanel.tsx`'s `fetchSkillBody` already uses (token from the `studio-token` meta
 * tag, sent as `x-studio-token`, against `/__studio/file?path=...`). Never throws: a missing
 * token, no `fetch` global (e.g. under vitest with no dev server), a network failure, a
 * non-2xx response, or an `{ ok: false }` body all degrade to `null` — logged, not surfaced.
 * The bridge's own `error` string (and any resolved path) is deliberately never returned to the
 * caller; only a generic, locally-authored log line names the module that failed.
 */
async function fetchModuleText(modulePath: string): Promise<string | null> {
  try {
    if (typeof fetch !== 'function') return null;
    const token = await readStudioToken();
    if (!token) {
      console.warn(`[bridge-content-source] no studio-token meta tag; cannot fetch "${modulePath}"`);
      return null;
    }
    const response = await fetch(`/__studio/file?path=${encodeURIComponent(modulePath)}`, {
      headers: { [STUDIO_TOKEN_HEADER]: token },
    });
    if (!response.ok) {
      console.warn(`[bridge-content-source] bridge responded ${response.status} for "${modulePath}"`);
      return null;
    }
    const body = (await response.json()) as { ok?: boolean; text?: string };
    if (!body.ok || typeof body.text !== 'string') {
      console.warn(`[bridge-content-source] bridge returned no usable text for "${modulePath}"`);
      return null;
    }
    return body.text;
  } catch (error) {
    console.warn(`[bridge-content-source] fetch failed for "${modulePath}"`, error);
    return null;
  }
}

const IDENTIFIER_CHAR_RE = /[A-Za-z0-9_$]/;
const WHITESPACE_RE = /\s/;
/** The three literal forms `export const X = ...` can take; anything else (array, object, function reference — see `getToolSourceLists`) is refused rather than mis-extracted. */
const STRING_DELIMITERS = new Set(['`', "'", '"']);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function skipWhile(source: string, index: number, matches: (ch: string) => boolean): number {
  let i = index;
  while (i < source.length && matches(source[i])) i++;
  return i;
}

/**
 * Text-extracts an exported string/template-literal constant's value from raw TypeScript
 * source, given its export name. Used against `.ts` files fetched from the mount, so this
 * is deliberately NOT an AST parser (see the constraints this app ships under) — a small,
 * honest, regex-plus-scan heuristic instead. Read the limits below before trusting it against
 * a new source shape.
 *
 * Algorithm: find `export const <symbol>` (word-boundary at the end, so `CRITIC_PROMPT` doesn't
 * false-match inside `CRITIC_PROMPT_V2`), find the following `=`, skip an optional `: Type`
 * gap and an optional TAGGED-TEMPLATE identifier (this codebase authors every prompt constant as
 * `` export const X: string = md`...` `` — see `packages/prompts/src/tags.ts` — so the literal
 * almost always has a tag immediately before it), then scan forward from the opening delimiter
 * for the matching, unescaped closing delimiter of the SAME kind. Backslash-escapes are only
 * used to find the true end (an escaped delimiter can't close the literal); the returned text is
 * the raw slice between delimiters, escape sequences included verbatim (not unescaped) — simpler
 * and it's exactly what every current prompt constant needs, since none of them escape anything.
 *
 * KNOWN LIMITS (non-AST, by design — a wrong string is worse than no string, so every one of
 * these degrades to `null` rather than guessing):
 *  - Only matches `export const <symbol>` declarations. A `let`, a function, a re-export
 *    (`export { X } from ...`), or `export { X as Y }` is not found.
 *  - Only understands escaping of the literal's OWN delimiter and a literal backslash — it does
 *    not evaluate the literal, so a `${expr}` interpolation is preserved as literal text, not
 *    substituted. Fine here: this app's prompt constants use `{{placeholder}}`, never `${...}`.
 *  - A backtick template literal containing a NESTED backtick (e.g. inside a `${...}`
 *    interpolation) would confuse the delimiter scan. None of this app's prompt constants do
 *    that today; if one ever did, this function does not detect the mismatch — it is not an
 *    AST parser and cannot verify structural correctness, only find a plausible delimiter pair.
 *  - The declaration search is textual, not scope-aware: a comment or a *different* string
 *    literal earlier in the file that happens to contain the literal text `export const <symbol>`
 *    would be matched instead. Not expected in this app's own source files.
 *  - Only the first matching declaration in the file is used.
 *  - Never returns a value if the closing delimiter isn't found before end-of-file — that would
 *    be a truncated prompt, which is explicitly worse than no prompt at all.
 */
export function extractConstant(source: string, symbol: string): string | null {
  const declarationRe = new RegExp(`export\\s+const\\s+${escapeRegExp(symbol)}\\b`);
  const declarationMatch = declarationRe.exec(source);
  if (!declarationMatch) return null;

  const eqIndex = source.indexOf('=', declarationMatch.index + declarationMatch[0].length);
  if (eqIndex === -1) return null;

  let cursor = skipWhile(source, eqIndex + 1, (ch) => WHITESPACE_RE.test(ch));
  // Tagged template (e.g. `md\`...\``): an identifier sits directly before the literal. Skip it
  // (and any whitespace after it) if present; a bare, untagged literal leaves cursor unchanged.
  if (IDENTIFIER_CHAR_RE.test(source[cursor] ?? '')) {
    cursor = skipWhile(source, cursor, (ch) => IDENTIFIER_CHAR_RE.test(ch));
    cursor = skipWhile(source, cursor, (ch) => WHITESPACE_RE.test(ch));
  }

  const delimiter = source[cursor];
  if (delimiter === undefined || !STRING_DELIMITERS.has(delimiter)) {
    // Not a string/template literal at all (array, object, function reference, ...) — refuse to
    // guess rather than returning something wrong. `getToolSourceLists` relies on this: it never
    // even tries to extract the `*_TOOLS` array constants for exactly this reason.
    return null;
  }

  const contentStart = cursor + 1;
  let i = contentStart;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2; // Skip the escaped character — it can never be the closing delimiter.
      continue;
    }
    if (ch === delimiter) {
      return source.slice(contentStart, i);
    }
    i += 1;
  }
  return null; // Ran off the end without a closing delimiter: never return a truncated literal.
}

export interface BridgeContentSource extends PromptContentSource {
  /**
   * Fetches (once per source file, memoized) and extracts every reachable prompt-text symbol.
   * Must be awaited before `getPromptText` returns anything — until then (or for any symbol it
   * couldn't resolve), `getPromptText` degrades to `null` exactly like an unknown symbol does.
   *
   * `extraSymbolModules` (ADR-235): manifest-declared fragment documents the inventory does not
   * know (icp/persona/discovery_protocol) — extra `symbol → module` pairs merged into the
   * inventory-derived set before fetching.
   */
  prime(extraSymbolModules?: ReadonlyMap<string, string>): Promise<void>;
}

/**
 * Built-in tool arrays, as metadata (module + symbol). Empty: Prompt Studio ships no built-in prompts or
 * tools. Project tools live in the project's Tools registry.
 */
const TOOL_ARRAY_SOURCES: readonly { source: string; module: string; symbol: string }[] = [];

/**
 * Builds an isolated `BridgeContentSource` instance. Exported (rather than only the singleton
 * below) so tests — and any future caller that wants a fresh, un-primed instance — don't share
 * cached state.
 */
export function createBridgeContentSource(): BridgeContentSource {
  // KISS per the task constraints: no cache eviction, no TTL, no re-validation — just enough
  // memoization that N symbols owned by the same file cause exactly one fetch of that file.
  const fileTextByModule = new Map<string, string>();
  const promptTextBySymbol = new Map<string, string>();

  return {
    getPromptText(symbol) {
      return promptTextBySymbol.get(symbol) ?? null;
    },

    getToolSourceLists() {
      // The `*_TOOLS` arrays are parsed from the module text the prime() above already fetched,
      // by the conservative literal parser (`tools-literal-parser.ts` — plain literals only,
      // any refusal drops that WHOLE list, never a partial guess). A module whose text is
      // missing (fetch failed) or whose array refuses to parse simply yields no list — the
      // Tools panel renders fewer sources rather than wrong ones, and the contract test against
      // the statically-imported lists pins this parser to the real sources.
      return TOOL_ARRAY_SOURCES.flatMap(({ source, module, symbol }) => {
        const text = fileTextByModule.get(module);
        if (text === undefined) return [];
        const tools = parseExportedToolArray(text, symbol);
        return tools === null ? [] : [{ source, tools }];
      });
    },

    async prime(extraSymbolModules?: ReadonlyMap<string, string>) {
      const symbolModules = new Map(collectPromptTextSymbolModules());
      for (const [symbol, modulePath] of extraSymbolModules ?? []) {
        if (!symbolModules.has(symbol)) {
          symbolModules.set(symbol, modulePath);
        }
      }
      // Tool-array modules are fetched too: a module that declares only a `*_TOOLS` array and no
      // prompt text (learning-tools.ts) is otherwise never fetched and its list never parsed.
      const modulesToFetch = new Set(
        [...symbolModules.values(), ...TOOL_ARRAY_SOURCES.map(({ module }) => module)].filter(
          (modulePath) => !fileTextByModule.has(modulePath),
        ),
      );

      await Promise.all(
        [...modulesToFetch].map(async (modulePath) => {
          const text = await fetchModuleText(modulePath);
          if (text !== null) {
            fileTextByModule.set(modulePath, text);
          }
        }),
      );

      for (const [symbol, modulePath] of symbolModules) {
        const fileText = fileTextByModule.get(modulePath);
        if (fileText === undefined) continue; // Fetch failed for this module; already logged.
        const extracted = extractConstant(fileText, symbol);
        if (extracted !== null) {
          promptTextBySymbol.set(symbol, extracted);
        } else {
          console.warn(`[bridge-content-source] "${symbol}" is not a string/template-literal export in ${modulePath}`);
        }
      }
    },
  };
}

/** Ready-to-use singleton, mirroring `bundledPromptContentSource`'s shape. Must be `prime()`d before use. */
export const bridgeContentSource: BridgeContentSource = createBridgeContentSource();

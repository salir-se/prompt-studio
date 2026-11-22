// @module-tag dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bundledPromptContentSource, primeContentSource } from './prompt-content-source';

/**
 * Coverage for the bridge-backed `PromptContentSource` seam (see that module's doc comment for the full
 * rationale). It is the only variant: the studio bundles no prompt prose and reads text through the bridge.
 */

// Derived from `import.meta.url`, NEVER `process.cwd()`. This suite runs both ways: `vitest` invoked
// inside `apps/prompt-studio` (cwd = package root) and the monorepo runner `bun run test:monorepo`
// (cwd = REPO root). A cwd-relative path resolves correctly only in the first case and fails in CI
// with `ENOENT: .../src/catalog/prompt-content-source.ts` — which is exactly how this
// broke the `PR quality` and `PR preview deploy` pipelines. `undeployable.test.ts` documents the same
// rule for the same reason; keep both file-relative.
const CONTAINER_MODULE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompt-content-source.ts');
const CONTAINER_SOURCE = readFileSync(CONTAINER_MODULE_PATH, 'utf-8');

function clearStudioToken(): void {
  for (const meta of document.head.querySelectorAll('meta[name="studio-token"]')) {
    meta.remove();
  }
}

afterEach(() => {
  clearStudioToken();
  vi.unstubAllGlobals();
});

describe('prompt-content-source: source-level guard', () => {
  it('imports nothing from @prompt-studio/prompts — not even a type-only import', () => {
    // Given: the module source
    // When: it is scanned for imports from the prompts package
    // Then: there are none. This is the entire point of the module: a future edit that adds a prompt-text
    // import from '@prompt-studio/prompts' here would bundle prose the seam exists to keep out. Fail loudly instead of relying on
    // someone noticing a stray value import from `@prompt-studio/prompts` in review. Since the tool-entry
    // types moved to a local mirror, ANY import line (value or type) is now suspicious.
    const importLine = CONTAINER_SOURCE.match(/^import .*from ['"]@prompt-studio\/prompts['"];?$/m);
    expect(importLine).toBeNull();
  });
});

describe('prompt-content-source: public shape', () => {
  it('exports the same public names as the bundled variant, function-shaped the same way', () => {
    // Given / When: the module is imported
    // Then: the seam's public names are functions
    expect(typeof bundledPromptContentSource.getPromptText).toBe('function');
    expect(typeof bundledPromptContentSource.getToolSourceLists).toBe('function');
    expect(typeof primeContentSource).toBe('function');
  });

  it('getToolSourceLists() is empty until the bridge has been primed (parser-backed after)', () => {
    // Given: an unprimed singleton
    // Then: no tool lists. Not a limitation: the lists are parsed from the module text primeContentSource() fetches
    // (tools-literal-parser.ts + its contract test against the real sources). This singleton has
    // not been primed in this test, so there is no text yet — empty, never wrong.
    expect(bundledPromptContentSource.getToolSourceLists()).toEqual([]);
  });

  it('getPromptText() degrades to null, never throws, before primeContentSource() resolves', () => {
    // Given: an unprimed singleton
    // When / Then: asking for any symbol returns null without throwing
    expect(() => bundledPromptContentSource.getPromptText('EXAMPLE_PROMPT')).not.toThrow();
    expect(bundledPromptContentSource.getPromptText('EXAMPLE_PROMPT')).toBeNull();
  });

  it('primeContentSource() never throws even when the bridge is entirely unreachable', async () => {
    // Given / When / Then: no studio-token meta tag and no fetch stub (a vitest/no-dev-server environment),
    // exactly like bridge-content-source.ts's own "no token" degrade path.
    await expect(primeContentSource()).resolves.toBeUndefined();
  });
});

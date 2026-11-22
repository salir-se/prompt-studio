// @module-tag dom
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Prompt Studio is a local editor. It reads the prompt project the user opens and renders its
 * structure, so it must never become a network service by accident.
 *
 * This file structurally proves: the filesystem bridge (`src/bridge/fs-bridge.ts`) stays a
 * dev-server-only (`apply: 'serve'`) and mutation-free Vite plugin; the repository has no
 * Cloudflare `wrangler` config; and the `bun run dev` server is pinned to loopback.
 *
 * Paths are derived from `import.meta.url`, not `process.cwd()`, so this test passes from any
 * working directory.
 */

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = dirname(here); // repository root
const appViteConfigPath = join(appRoot, 'vite.config.ts');
const fsBridgePath = join(here, 'bridge', 'fs-bridge.ts');

/** Node fs calls that write, move, or delete. The read-only bridge must contain none of them. */
const FS_MUTATION_CALL_NAMES = [
  'writeFile',
  'appendFile',
  'unlink',
  'rename',
  'mkdir',
  'rmdir',
  'rm',
  'copyFile',
  'chmod',
  'chown',
  'truncate',
] as const;

describe('Prompt Studio stays a local editor', () => {
  it("keeps the fs-bridge Vite plugin serve-only via apply: 'serve'", () => {
    const bridgeSource = readFileSync(fsBridgePath, 'utf-8');

    expect(
      /apply:\s*['"]serve['"]/.test(bridgeSource),
      "src/bridge/fs-bridge.ts must declare apply: 'serve' on its Vite " +
        'plugin. `transformIndexHtml` runs during `vite build` too, so without this restriction ' +
        'the per-boot studio token would be baked into the static `dist/index.html` — a single, ' +
        'permanently-valid token shipped inside every build, ' +
        "identical for every user. `apply: 'serve'` is what keeps token " +
        'generation (and the whole bridge middleware) confined to the local `vite dev` process, ' +
        'never a built artifact.',
    ).toBe(true);
  });

  it('has no filesystem mutation code path anywhere in the fs-bridge', () => {
    const bridgeSource = readFileSync(fsBridgePath, 'utf-8');
    const found = FS_MUTATION_CALL_NAMES.filter((name) => new RegExp(`\\b${name}\\w*\\s*\\(`).test(bridgeSource));

    expect(
      found,
      'src/bridge/fs-bridge.ts must contain none of these filesystem ' +
        `mutation calls: ${FS_MUTATION_CALL_NAMES.join(', ')}. Its own module doc guarantees "no ` +
        'write/create/delete/rename code path here, not even a disabled one" — that guarantee ' +
        'matters even more now that the tool runs against a user-mounted repository rather than ' +
        `only a maintainer's own checkout: a mutation path here would let a published editor ` +
        `image modify a stranger's repo through a read-only-sounding bridge. ` +
        `Found: ${found.join(', ') || '(none — this should stay empty)'}`,
    ).toEqual([]);
  });

  it('has no wrangler config anywhere in the repository', () => {
    const candidateNames = ['wrangler.toml', 'wrangler.jsonc', 'wrangler.json'];
    const found: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (candidateNames.includes(entry.name)) {
          found.push(full);
        }
      }
    };
    walk(appRoot);

    expect(
      found,
      'A wrangler.toml/wrangler.jsonc/wrangler.json under apps/prompt-studio would configure ' +
        'a Cloudflare Worker or Pages deployment target for this tool. It ships only as an ' +
        'editor-only Docker image on GHCR — it must never also grow a Cloudflare deploy target. ' +
        `Found: ${found.join(', ') || '(none — this should stay empty)'}`,
    ).toEqual([]);
  });

  it('pins the vite dev server to 127.0.0.1 and never widens it to 0.0.0.0', () => {
    const viteConfig = readFileSync(appViteConfigPath, 'utf-8');

    expect(
      /host:\s*['"]127\.0\.0\.1['"]/.test(viteConfig),
      "vite.config.ts must bind the dev server host to '127.0.0.1'. This " +
        'server reads and serves repository file contents (prompt sources, and the filesystem ' +
        'bridge) to whatever connects to it — binding to loopback only is what keeps it ' +
        'unreachable from the local network, let alone the internet. This posture is independent ' +
        'of the container image: it protects the `vite dev` process a contributor runs locally, ' +
        "regardless of how the published editor image is exposed by an operator's own " +
        '`docker run -p ...` choice.',
    ).toBe(true);

    // The config file is allowed to *mention* '0.0.0.0' in an explanatory comment warning
    // against it (as it currently does) — what must never happen is the `host:` option
    // actually being *set* to it, so this checks the assignment, not the whole file.
    expect(
      /host:\s*['"]0\.0\.0\.0['"]/.test(viteConfig),
      "vite.config.ts must never bind the dev server host to '0.0.0.0'. " +
        'That would make it reachable from any device on the local network, defeating the ' +
        'loopback-only security boundary this tool depends on to avoid leaking repository/prompt ' +
        'internals.',
    ).toBe(false);
  });
});

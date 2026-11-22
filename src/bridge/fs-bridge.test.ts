// @module-tag dom
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { HtmlTagDescriptor } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ALLOWED_EXTENSIONS,
  BridgeError,
  createStudioFsBridgePlugin,
  hasAllowedExtension,
  hasBlockedSegment,
  isWithinRoot,
  listDirEntries,
  readPermittedFile,
  resolvePermittedPath,
  validateOrigin,
  validateToken,
} from './fs-bridge';

describe('isWithinRoot (path-boundary-safe containment)', () => {
  it('accepts a target nested under the root', () => {
    expect(isWithinRoot('/repo/packages/prompts', '/repo/packages/prompts/sub/file.ts')).toBe(true);
  });

  it('accepts the root itself', () => {
    expect(isWithinRoot('/repo/packages/prompts', '/repo/packages/prompts')).toBe(true);
  });

  it('rejects a sibling directory whose name merely shares the root as a string prefix', () => {
    // /repo/packages/promptsEVIL starts with /repo/packages/prompts as a raw string,
    // but is NOT contained within it — a naive startsWith() check would wrongly allow this.
    expect(isWithinRoot('/repo/packages/prompts', '/repo/packages/promptsEVIL/leak.ts')).toBe(false);
  });

  it('rejects a parent directory', () => {
    expect(isWithinRoot('/repo/packages/prompts', '/repo/packages')).toBe(false);
  });

  it('rejects a traversal that escapes the root', () => {
    expect(isWithinRoot('/repo/packages/prompts', '/repo/packages/prompts/../../etc/passwd')).toBe(false);
  });
});

describe('hasBlockedSegment', () => {
  it('blocks dotfiles and dot-directories', () => {
    expect(hasBlockedSegment('.env')).toBe(true);
    expect(hasBlockedSegment('sub/.env.local')).toBe(true);
    expect(hasBlockedSegment('.git/config')).toBe(true);
  });

  it('blocks anything under a secrets/ directory', () => {
    expect(hasBlockedSegment('secrets/token.txt')).toBe(true);
    expect(hasBlockedSegment('sub/secrets/deep/file.ts')).toBe(true);
  });

  it('blocks *.sops.* files', () => {
    expect(hasBlockedSegment('config.sops.json')).toBe(true);
    expect(hasBlockedSegment('sub/prod.sops.yaml')).toBe(true);
  });

  it('allows ordinary nested paths', () => {
    expect(hasBlockedSegment('nested/good.ts')).toBe(false);
    expect(hasBlockedSegment('good.md')).toBe(false);
  });
});

describe('hasAllowedExtension', () => {
  it('allows every extension on the allowlist', () => {
    for (const ext of ALLOWED_EXTENSIONS) {
      expect(hasAllowedExtension(`file${ext}`)).toBe(true);
    }
  });

  it('rejects extensions not on the allowlist', () => {
    expect(hasAllowedExtension('file.png')).toBe(false);
    expect(hasAllowedExtension('file.exe')).toBe(false);
    expect(hasAllowedExtension('file')).toBe(false);
  });
});

describe('validateOrigin', () => {
  it('allows the studio dev origins', () => {
    expect(validateOrigin('http://127.0.0.1:5273')).toBe(true);
    expect(validateOrigin('http://localhost:5273')).toBe(true);
  });

  it('allows a request with no Origin header at all', () => {
    expect(validateOrigin(undefined)).toBe(true);
    expect(validateOrigin(null)).toBe(true);
  });

  it('rejects a foreign origin', () => {
    expect(validateOrigin('http://evil.example.com')).toBe(false);
    expect(validateOrigin('http://127.0.0.1:9999')).toBe(false);
  });
});

describe('validateToken', () => {
  const expected = randomUUID();

  it('accepts the exact expected token', () => {
    expect(validateToken(expected, expected)).toBe(true);
  });

  it('rejects a missing token', () => {
    expect(validateToken(undefined, expected)).toBe(false);
    expect(validateToken(null, expected)).toBe(false);
    expect(validateToken('', expected)).toBe(false);
  });

  it('rejects a wrong token', () => {
    expect(validateToken(randomUUID(), expected)).toBe(false);
    expect(validateToken(`${expected}x`, expected)).toBe(false);
  });
});

describe('resolvePermittedPath (integration over a real temp repo)', () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'prompt-studio-fs-bridge-'));

    await mkdir(path.join(repoRoot, 'packages/prompts/nested'), { recursive: true });
    await mkdir(path.join(repoRoot, 'packages/prompts/secrets'), { recursive: true });
    await mkdir(path.join(repoRoot, 'packages/promptsEVIL'), { recursive: true });
    await mkdir(path.join(repoRoot, 'packages/skills/skills/sample-skill'), { recursive: true });
    await mkdir(path.join(repoRoot, 'docs/prompts'), { recursive: true });
    await mkdir(path.join(repoRoot, 'outside'), { recursive: true });

    await writeFile(path.join(repoRoot, 'packages/prompts/good.ts'), 'export const x = 1;\n');
    await writeFile(path.join(repoRoot, 'packages/prompts/nested/note.md'), '# note\n');
    await writeFile(path.join(repoRoot, 'packages/prompts/.env'), 'SECRET=1\n');
    await writeFile(path.join(repoRoot, 'packages/prompts/secrets/token.txt'), 'sekret\n');
    await writeFile(path.join(repoRoot, 'packages/prompts/config.sops.json'), '{}\n');
    await writeFile(path.join(repoRoot, 'packages/prompts/image.png'), 'not-really-a-png');
    await writeFile(path.join(repoRoot, 'packages/promptsEVIL/leak.ts'), 'export const leak = true;\n');
    await writeFile(path.join(repoRoot, 'docs/prompts/readme.md'), '# docs\n');
    await writeFile(path.join(repoRoot, 'packages/skills/skills/sample-skill/SKILL.md'), '# skill\n');
    await writeFile(path.join(repoRoot, 'outside/secret.txt'), 'top secret\n');

    // Symlink inside an allowed root that escapes it, pointing at a file outside every allowed root.
    await symlink(path.join(repoRoot, 'outside/secret.txt'), path.join(repoRoot, 'packages/prompts/escape.txt'));
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('reads a real .ts file inside packages/prompts/', async () => {
    const resolved = await resolvePermittedPath({
      repoRoot,
      requestedPath: 'packages/prompts/good.ts',
      kind: 'file',
    });
    expect(resolved).toBe(path.join(repoRoot, 'packages/prompts/good.ts'));
  });

  it('lists a permitted directory', async () => {
    const resolved = await resolvePermittedPath({ repoRoot, requestedPath: 'packages/prompts', kind: 'dir' });
    expect(resolved).toBe(path.join(repoRoot, 'packages/prompts'));
  });

  it('rejects a ../../ traversal outside the repo root', async () => {
    await expect(
      resolvePermittedPath({ repoRoot, requestedPath: '../../etc/passwd', kind: 'file' }),
    ).rejects.toBeInstanceOf(BridgeError);
  });

  it('rejects an absolute path', async () => {
    await expect(resolvePermittedPath({ repoRoot, requestedPath: '/etc/passwd', kind: 'file' })).rejects.toBeInstanceOf(
      BridgeError,
    );
  });

  it('rejects a path that resolves inside the promptsEVIL sibling (separator-boundary case)', async () => {
    await expect(
      resolvePermittedPath({ repoRoot, requestedPath: 'packages/promptsEVIL/leak.ts', kind: 'file' }),
    ).rejects.toBeInstanceOf(BridgeError);
  });

  it('rejects a symlink that escapes its allowed root', async () => {
    await expect(
      resolvePermittedPath({ repoRoot, requestedPath: 'packages/prompts/escape.txt', kind: 'file' }),
    ).rejects.toBeInstanceOf(BridgeError);
  });

  it('rejects a disallowed extension', async () => {
    await expect(
      resolvePermittedPath({ repoRoot, requestedPath: 'packages/prompts/image.png', kind: 'file' }),
    ).rejects.toBeInstanceOf(BridgeError);
  });

  it('rejects a dotfile / .env file', async () => {
    await expect(
      resolvePermittedPath({ repoRoot, requestedPath: 'packages/prompts/.env', kind: 'file' }),
    ).rejects.toBeInstanceOf(BridgeError);
  });

  it('rejects anything under a secrets/ directory', async () => {
    await expect(
      resolvePermittedPath({ repoRoot, requestedPath: 'packages/prompts/secrets/token.txt', kind: 'file' }),
    ).rejects.toBeInstanceOf(BridgeError);
  });

  it('rejects a *.sops.* file even with an allowed extension', async () => {
    await expect(
      resolvePermittedPath({ repoRoot, requestedPath: 'packages/prompts/config.sops.json', kind: 'file' }),
    ).rejects.toBeInstanceOf(BridgeError);
  });

  it('never leaks the resolved absolute path or repo root in the rejection message', async () => {
    try {
      await resolvePermittedPath({ repoRoot, requestedPath: '../../etc/passwd', kind: 'file' });
      expect.unreachable('expected resolvePermittedPath to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(BridgeError);
      const message = (error as BridgeError).message;
      expect(message).not.toContain(repoRoot);
      expect(message).not.toContain('/etc/passwd');
    }
  });

  it('permits the other two allowed roots too', async () => {
    await expect(
      resolvePermittedPath({ repoRoot, requestedPath: 'docs/prompts/readme.md', kind: 'file' }),
    ).resolves.toBe(path.join(repoRoot, 'docs/prompts/readme.md'));

    await expect(
      resolvePermittedPath({
        repoRoot,
        requestedPath: 'packages/skills/skills/sample-skill/SKILL.md',
        kind: 'file',
      }),
    ).resolves.toBe(path.join(repoRoot, 'packages/skills/skills/sample-skill/SKILL.md'));
  });
});

describe('listDirEntries', () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'prompt-studio-fs-bridge-list-'));
    await mkdir(path.join(repoRoot, 'packages/prompts/nested'), { recursive: true });
    await writeFile(path.join(repoRoot, 'packages/prompts/good.ts'), 'export const x = 1;\n');
    await writeFile(path.join(repoRoot, 'packages/prompts/.env'), 'SECRET=1\n');
    await writeFile(path.join(repoRoot, 'packages/prompts/image.png'), 'nope');
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('lists visible, permitted entries with name and type', async () => {
    const entries = await listDirEntries(path.join(repoRoot, 'packages/prompts'));
    const names = entries.map((entry) => entry.name).sort();
    expect(names).toEqual(['good.ts', 'nested']);

    const file = entries.find((entry) => entry.name === 'good.ts');
    const dir = entries.find((entry) => entry.name === 'nested');
    expect(file?.type).toBe('file');
    expect(dir?.type).toBe('dir');
  });

  it('never includes dotfiles or disallowed extensions in a listing', async () => {
    const entries = await listDirEntries(path.join(repoRoot, 'packages/prompts'));
    const names = entries.map((entry) => entry.name);
    expect(names).not.toContain('.env');
    expect(names).not.toContain('image.png');
  });
});

describe('createStudioFsBridgePlugin (build safety)', () => {
  it('only applies while serving, never during `vite build`', () => {
    // Vite calls transformIndexHtml during BOTH `vite dev` and `vite build`. Without
    // `apply: 'serve'`, the per-boot token this plugin injects would get baked into the
    // static dist/index.html — a single, permanently-valid token shipped to every user of
    // the publicly published container image. `apply: 'serve'` is what makes Vite skip
    // this plugin entirely for a production build, so this must never be loosened.
    const plugin = createStudioFsBridgePlugin({ repoRoot: '/repo' });
    expect(plugin.apply).toBe('serve');
  });
});

describe('createStudioFsBridgePlugin manifest route', () => {
  type Plugin = ReturnType<typeof createStudioFsBridgePlugin>;

  /** Extracts the per-boot token the plugin injects as the `studio-token` meta tag. */
  function injectedToken(plugin: Plugin): string {
    // The plugin declares the plain-hook forms; the union type just isn't directly callable.
    const transform = plugin.transformIndexHtml as ((html: string) => HtmlTagDescriptor[]) | undefined;
    const tags = transform?.('') ?? [];
    const tag = (Array.isArray(tags) ? tags : [tags]).find(
      (candidate) => 'attrs' in candidate && candidate.attrs?.name === 'studio-token',
    );
    return String(tag?.attrs?.content ?? '');
  }

  /**
   * Minimal middleware harness: captures the handler `configureServer` registers and dispatches
   * one authenticated GET through it, recording the JSON response. No real Vite server — the
   * plugin only ever touches `server.middlewares.use`, exactly what this stands in for.
   */
  async function dispatchGet(plugin: Plugin, urlPath: string): Promise<{ status: number; body: unknown }> {
    let handler: ((req: unknown, res: unknown, next: () => void) => Promise<void> | void) | undefined;
    const configure = plugin.configureServer as ((server: unknown) => void) | undefined;
    configure?.({ middlewares: { use: (fn: typeof handler) => (handler = fn) } });
    if (!handler) throw new Error('plugin registered no middleware');
    const result: { status: number; body: unknown } = { status: 0, body: null };
    // Handled requests end the response; unmatched paths fall through to next() — resolve on
    // whichever happens first.
    let settle: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const res = {
      statusCode: 0,
      setHeader: () => {},
      end: (raw: string) => {
        result.body = JSON.parse(raw);
        settle();
      },
    };
    const req = { url: urlPath, method: 'GET', headers: { 'x-studio-token': injectedToken(plugin) } };
    void Promise.resolve(handler(req, res as never, settle));
    await done;
    result.status = res.statusCode;
    return result;
  }

  it('serves the STUDIO_MANIFEST_PATH override, not the app-tree manifest', async () => {
    const appRoot = await mkdtemp(path.join(tmpdir(), 'prompt-studio-bridge-app-'));
    const overrideDir = await mkdtemp(path.join(tmpdir(), 'prompt-studio-bridge-manifest-'));
    try {
      // The app-tree candidate (src/manifest/default.manifest.json) EXISTS here with name 'salir'
      // — the override must win over it, which is the whole point of the env var (the dev bridge
      // used to ignore `manifestPath` entirely, so an override only ever reached the standalone
      // server, never `bun run dev`).
      const shipped = await readFile(path.resolve(import.meta.dirname, '../manifest/default.manifest.json'), 'utf8');
      await mkdir(path.join(appRoot, 'src/manifest'), { recursive: true });
      await writeFile(path.join(appRoot, 'src/manifest/default.manifest.json'), shipped);
      const override = JSON.parse(shipped) as Record<string, unknown>;
      override.name = 'third-party-override';
      override.contentRoots = ['vendor/prompts'];
      const overridePath = path.join(overrideDir, 'custom.manifest.json');
      await writeFile(overridePath, `${JSON.stringify(override, null, 2)}\n`);

      const plugin = createStudioFsBridgePlugin({ repoRoot: '/repo', appRoot, manifestPath: overridePath });
      const response = await dispatchGet(plugin, '/__studio/manifest');
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ ok: true, manifest: { name: 'third-party-override' } });
    } finally {
      await rm(appRoot, { recursive: true, force: true });
      await rm(overrideDir, { recursive: true, force: true });
    }
  });
});

describe('readPermittedFile', () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'prompt-studio-fs-bridge-read-'));
    await mkdir(path.join(repoRoot, 'packages/prompts'), { recursive: true });
    await writeFile(path.join(repoRoot, 'packages/prompts/good.ts'), 'export const x = 1;\n');
    await writeFile(path.join(repoRoot, 'packages/prompts/huge.txt'), 'a'.repeat(3 * 1024 * 1024));
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('reads file contents as text', async () => {
    const text = await readPermittedFile(path.join(repoRoot, 'packages/prompts/good.ts'));
    expect(text).toBe('export const x = 1;\n');
  });

  it('rejects a file larger than 2 MB', async () => {
    await expect(readPermittedFile(path.join(repoRoot, 'packages/prompts/huge.txt'))).rejects.toBeInstanceOf(
      BridgeError,
    );
  });
});

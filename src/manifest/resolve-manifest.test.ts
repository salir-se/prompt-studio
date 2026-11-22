// @vitest-environment node
// @module-tag pure
// Filesystem resolution against temp fixtures — plain Node, no DOM (see server/config.test.ts for
// the same environment note).
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MANIFEST } from './default-manifest';
import { allowedRootsFor, BAKED_MANIFEST_PATH, resolveActiveManifest } from './resolve-manifest';

/**
 * Precedence and failure semantics of the active-manifest resolution chain (ADR-235):
 * env path > baked container path > app-tree fallback; "exists but invalid" NEVER falls through;
 * an absent REQUIRED candidate is invalid; an absent optional candidate (the baked path outside
 * the container) is skipped; invalid always degrades to the shipped default allowlist.
 */

const VALID_MANIFEST_JSON = JSON.stringify({
  schemaVersion: 1,
  name: 'override',
  contentRoots: ['custom/root'],
  skillsRoot: 'custom/skills',
  exportRoot: 'custom/export',
  catalog: { source: 'legacy-inventory' },
  baselines: [
    { id: 'default', label: 'Default', description: 'd', positioning: 'shipped', source: { kind: 'shipped' } },
  ],
});

const INVALID_MANIFEST_JSON = JSON.stringify({ schemaVersion: 1, name: 'broken', contentRoots: ['/etc'] });

let appRoot: string;
let bakedDir: string;

/** Builds an app tree whose src/manifest fallback is the real checked-in salir manifest. */
async function makeAppRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'prompt-studio-manifest-app-'));
  await mkdir(path.join(root, 'src/manifest'), { recursive: true });
  await writeFile(
    path.join(root, 'src/manifest/default.manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      name: 'salir',
      contentRoots: ['packages/prompts', 'packages/skills/skills', 'docs/prompts'],
      skillsRoot: 'packages/skills/skills',
      exportRoot: 'packages/prompts/src/blueprints',
      catalog: { source: 'legacy-inventory' },
      baselines: [
        {
          id: 'default',
          label: 'Your prompts',
          description: 'The prompts in this repository.',
          positioning: 'shipped',
          source: { kind: 'shipped' },
        },
      ],
    }),
  );
  return root;
}

beforeEach(async () => {
  appRoot = await makeAppRoot();
  bakedDir = await mkdtemp(path.join(tmpdir(), 'prompt-studio-manifest-baked-'));
});

afterEach(async () => {
  await rm(appRoot, { recursive: true, force: true });
  await rm(bakedDir, { recursive: true, force: true });
});

describe('resolveActiveManifest precedence', () => {
  it('resolves from the app-tree fallback when nothing else exists (the dev-server path)', async () => {
    const resolved = await resolveActiveManifest({
      appRoot,
      bakedManifestPath: path.join(bakedDir, 'manifest.json'), // absent in dev
    });
    expect(resolved).toMatchObject({ status: 'ok', source: 'app' });
  });

  it('prefers the baked container copy over the app tree', async () => {
    const bakedPath = path.join(bakedDir, 'manifest.json');
    await writeFile(bakedPath, VALID_MANIFEST_JSON);
    const resolved = await resolveActiveManifest({ appRoot, bakedManifestPath: bakedPath });
    expect(resolved).toMatchObject({ status: 'ok', source: 'baked' });
    if (resolved.status === 'ok') {
      expect(resolved.manifest.name).toBe('override');
    }
  });

  it('prefers an explicit env path over the baked copy', async () => {
    const bakedPath = path.join(bakedDir, 'manifest.json');
    await writeFile(bakedPath, VALID_MANIFEST_JSON);
    const envPath = path.join(bakedDir, 'env-manifest.json');
    await writeFile(envPath, VALID_MANIFEST_JSON.replace('"override"', '"env-wins"'));
    const resolved = await resolveActiveManifest({
      appRoot,
      manifestPath: envPath,
      bakedManifestPath: bakedPath,
    });
    expect(resolved).toMatchObject({ status: 'ok', source: 'env' });
    if (resolved.status === 'ok') {
      expect(resolved.manifest.name).toBe('env-wins');
    }
  });

  it('defaults the baked path to the container location', async () => {
    // Outside the container that path does not exist, so resolution must fall to the app tree —
    // asserting the DEFAULT is BAKED_MANIFEST_PATH guards accidental path drift in the constant.
    expect(BAKED_MANIFEST_PATH).toBe('/studio-manifest/manifest.json');
    const resolved = await resolveActiveManifest({ appRoot });
    expect(resolved).toMatchObject({ status: 'ok', source: 'app' });
  });
});

describe('resolveActiveManifest failure semantics', () => {
  it('treats a set-but-missing env path as invalid, not as an absence', async () => {
    const resolved = await resolveActiveManifest({
      appRoot,
      manifestPath: path.join(bakedDir, 'does-not-exist.json'),
      bakedManifestPath: path.join(bakedDir, 'manifest.json'),
    });
    expect(resolved).toMatchObject({ status: 'invalid', source: 'env' });
  });

  it('treats an invalid baked manifest as invalid — it must NOT fall through to the app tree', async () => {
    const bakedPath = path.join(bakedDir, 'manifest.json');
    await writeFile(bakedPath, INVALID_MANIFEST_JSON);
    const resolved = await resolveActiveManifest({ appRoot, bakedManifestPath: bakedPath });
    expect(resolved).toMatchObject({ status: 'invalid', source: 'baked' });
  });

  it('reports non-JSON content as invalid rather than throwing', async () => {
    const envPath = path.join(bakedDir, 'env-manifest.json');
    await writeFile(envPath, 'not json at all');
    const resolved = await resolveActiveManifest({ appRoot, manifestPath: envPath });
    expect(resolved).toMatchObject({ status: 'invalid', source: 'env' });
    if (resolved.status === 'invalid') {
      expect(resolved.detail.startsWith('manifest not valid JSON: ')).toBe(true);
      expect(resolved.detail).toContain('SyntaxError');
      expect(resolved.detail.endsWith(` (${envPath})`)).toBe(true);
    }
  });
});

describe('allowedRootsFor', () => {
  it('uses the active manifest roots when valid', async () => {
    const bakedPath = path.join(bakedDir, 'manifest.json');
    await writeFile(bakedPath, VALID_MANIFEST_JSON);
    const resolved = await resolveActiveManifest({ appRoot, bakedManifestPath: bakedPath });
    expect(allowedRootsFor(resolved)).toEqual(['custom/root']);
  });

  it('falls back to the shipped default roots when invalid — never wider, never a crash', async () => {
    const envPath = path.join(bakedDir, 'env-manifest.json');
    await writeFile(envPath, INVALID_MANIFEST_JSON);
    const resolved = await resolveActiveManifest({ appRoot, manifestPath: envPath });
    expect(allowedRootsFor(resolved)).toEqual([...DEFAULT_MANIFEST.contentRoots]);
  });
});

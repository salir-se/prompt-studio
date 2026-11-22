// @module-tag pure
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installedPromptRepoDir, prepareInstalledStudio } from './installed-studio';

describe('prepareInstalledStudio', () => {
  let home: string;

  afterEach(async () => {
    if (home) await rm(home, { recursive: true, force: true });
  });

  it("opens the person's prompt folder instead of the Salir source tree", async () => {
    // Given: a computer with no Salir checkout and no STUDIO_REPO_ROOT
    home = await mkdtemp(path.join(tmpdir(), 'prompt-studio-home-'));
    // When: the installed program prepares its editor
    const prepared = await prepareInstalledStudio({ HOME: home });
    // Then: prompts and skills live under the home folder, and the catalog is not packages/prompts
    expect(prepared).not.toBeNull();
    expect(prepared?.repoRoot).toBe(installedPromptRepoDir({ HOME: home }));
    expect(prepared?.repoRoot).not.toBe(path.resolve('/repo'));
    const manifest = JSON.parse(await readFile(prepared?.manifestPath ?? '', 'utf8')) as {
      contentRoots: string[];
      catalog: { source: string };
    };
    expect(manifest.contentRoots).toEqual(['prompts', 'skills']);
    expect(manifest.catalog.source).toBe('explicit');
    expect(JSON.stringify(manifest)).not.toContain('packages/prompts');
  });

  it('lists a prompt the person already saved', async () => {
    home = await mkdtemp(path.join(tmpdir(), 'prompt-studio-home-'));
    const prompts = path.join(installedPromptRepoDir({ HOME: home }), 'prompts');
    await prepareInstalledStudio({ HOME: home });
    await writeFile(path.join(prompts, 'scout.md'), '# Scout\n');
    const prepared = await prepareInstalledStudio({ HOME: home });
    const manifest = JSON.parse(await readFile(prepared?.manifestPath ?? '', 'utf8')) as {
      catalog: { documents: { id: string; source: { path: string } }[] };
    };
    expect(manifest.catalog.documents).toEqual([
      expect.objectContaining({ id: 'scout', source: { kind: 'file', path: 'prompts/scout.md' } }),
    ]);
  });

  it('leaves a chosen repository alone', async () => {
    home = await mkdtemp(path.join(tmpdir(), 'prompt-studio-home-'));
    expect(await prepareInstalledStudio({ HOME: home, STUDIO_REPO_ROOT: '/work/salir' })).toBeNull();
  });
});

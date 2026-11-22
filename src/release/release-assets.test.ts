// @module-tag integration
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RELEASE_OBJECTS } from './latest-json';
import { writeLatestJson } from './release-assets';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function releaseDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ps-release-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), text);
  return dir;
}

describe('writeLatestJson', () => {
  it('writes latest.json naming every platform asset with its checksum', async () => {
    // Given: one compiled binary per platform in the release directory
    const dir = await releaseDir(
      Object.fromEntries(Object.values(RELEASE_OBJECTS).map((name) => [name, `bin:${name}`])),
    );
    // When: the release step writes latest.json for version 1.2.3
    const target = await writeLatestJson('1.2.3', dir);
    // Then: the file names the version, each asset name, and a SHA-256 per asset
    const latest = JSON.parse(await readFile(target, 'utf8'));
    expect(latest.version).toBe('1.2.3');
    expect(latest.objects['linux-x64'].key).toBe('prompt-studio-linux-x64');
    expect(latest.objects['windows-x64'].key).toBe('prompt-studio-windows-x64.exe');
    expect(latest.objects['macos-arm64'].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses to publish when a platform binary is missing', async () => {
    // Given: a release directory without the Windows binary
    const dir = await releaseDir({
      'prompt-studio-macos-arm64': 'a',
      'prompt-studio-macos-x64': 'b',
      'prompt-studio-linux-x64': 'c',
    });
    // When / Then: writing latest.json fails instead of publishing a partial release
    await expect(writeLatestJson('1.2.3', dir)).rejects.toThrow();
  });
});

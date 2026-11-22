// @module-tag pure
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { standaloneAppRoot } from './compiled-root';

describe('standaloneAppRoot', () => {
  it('uses the app directory when the server file is on disk', () => {
    const root = standaloneAppRoot('file:///opt/prompt-studio/server/main.ts');
    expect(root).toBe(fileURLToPath('file:///opt/prompt-studio'));
  });

  it('uses the embedded asset directory inside a compiled binary', () => {
    // Given: bun build --compile, where this module's URL is the outfile
    const root = standaloneAppRoot('file:///$bunfs/root/prompt-studio');
    // Then: dist/ and src/manifest/ resolve beside the outfile, under /$bunfs/root
    expect(root).toBe('/$bunfs/root');
    expect(root.endsWith('/$bunfs')).toBe(false);
  });

  it('keeps embedded assets beside the outfile on a Windows compiled binary', () => {
    // Given: bun build --compile on Windows, where this module lives at B:\~BUN\root\<outfile>
    const root = standaloneAppRoot('file:///B:/~BUN/root/prompt-studio-windows-x64.exe');
    const indexHtml = path.join(root, 'dist', 'index.html');
    const manifest = path.join(root, 'src', 'manifest', 'default.manifest.json');
    // Then: dist/ and the manifest stay under ~BUN\root, not one folder higher at ~BUN
    for (const embedded of [indexHtml, manifest]) {
      const parts = embedded.split(path.sep);
      expect(parts[parts.indexOf('~BUN') + 1]).toBe('root');
    }
  });
});

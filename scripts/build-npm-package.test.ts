// @vitest-environment node
// @module-tag pure
import { describe, expect, it } from 'vitest';
import {
  buildPackageJson,
  findDisallowedTarballEntries,
  findProtectedTarballPaths,
  NPM_PUBLIC_REGISTRY,
  missingRequiredPackageFiles,
  normalizeVersion,
  NPM_PACKAGE_NAME,
  PROTECTED_TARBALL_PATHS,
  REQUIRED_PACKAGE_FILES,
  stripPackagePrefix,
} from './build-npm-package';

/**
 * Unit contract for the npm-package assembly helpers.
 *
 * The published package is `@salir/prompt-studio` on the public npm registry. The helpers encode its name,
 * public publishConfig, Apache-2.0 licence, bins and file list, plus the tarball scans that keep the private
 * build's prompt-content paths and any node_modules tree out of the published artifact.
 */

describe('normalizeVersion', () => {
  it('strips the release-tag v prefix and passes plain versions through', () => {
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3');
    expect(normalizeVersion('1.2.3')).toBe('1.2.3');
    expect(normalizeVersion('0.0.0-dev')).toBe('0.0.0-dev');
  });

  it('rejects empty and non-version input', () => {
    expect(() => normalizeVersion('')).toThrow();
    expect(() => normalizeVersion('latest')).toThrow();
    expect(() => normalizeVersion('prompt-studio-v1.2.3')).toThrow();
  });
});

describe('buildPackageJson', () => {
  const manifest = buildPackageJson('1.2.3');

  it('names the package with the GitHub organization scope', () => {
    expect(NPM_PACKAGE_NAME).toBe('@salir/prompt-studio');
    expect(manifest.name).toBe('@salir/prompt-studio');
  });

  it('publishes publicly to npmjs (no provenance flag: bun publish has none)', () => {
    expect(NPM_PUBLIC_REGISTRY).toBe('https://registry.npmjs.org');
    expect(manifest.publishConfig).toEqual({ registry: NPM_PUBLIC_REGISTRY, access: 'public' });
  });

  it('is publishable under the Apache-2.0 licence', () => {
    // npm publish refuses `private: true`; its absence is what makes the tarball publishable.
    expect(manifest.private).toBeUndefined();
    expect(manifest.license).toBe('Apache-2.0');
  });

  it('declares the three bins and ships exactly the runtime file tree', () => {
    expect(manifest.bin).toEqual({
      'prompt-studio': 'bin/prompt-studio.js',
      'prompt-studio-cli': 'bin/prompt-studio-cli.js',
      'prompt-studio-mcp': 'bin/prompt-studio-mcp.js',
    });
    expect(manifest.files).toEqual([
      'bin',
      'cli',
      'dist',
      'mcp',
      'server',
      'studio-manifest',
      'README.md',
      'LICENSE',
      'NOTICE',
    ]);
  });

  it('records the version, module type, engine floor, and source repository', () => {
    expect(manifest.version).toBe('1.2.3');
    expect(manifest.type).toBe('module');
    expect(manifest.engines).toEqual({ bun: '>=1.4.4' });
    expect(manifest.repository).toEqual({ type: 'git', url: 'git+https://github.com/salir-se/prompt-studio.git' });
  });
});

describe('stripPackagePrefix', () => {
  it('normalizes npm-pack file paths to package-relative paths', () => {
    expect(stripPackagePrefix('package/bin/prompt-studio.js')).toBe('bin/prompt-studio.js');
    expect(stripPackagePrefix('bin/prompt-studio.js')).toBe('bin/prompt-studio.js');
  });
});

describe('findProtectedTarballPaths', () => {
  it('flags the private prompt-content paths wherever they appear as files', () => {
    const files = [
      'package.json',
      'packages/prompts/src/blueprints/scout.md',
      'packages/skills/skills/skill-1/SKILL.md',
      'docs/prompts/baseline.json',
    ];
    expect(findProtectedTarballPaths(files)).toEqual([...PROTECTED_TARBALL_PATHS]);
  });

  it('passes a clean package file list', () => {
    const files = ['package.json', 'bin/prompt-studio.js', 'server/main.js', 'dist/index.html'];
    expect(findProtectedTarballPaths(files)).toEqual([]);
  });

  it('does not flag lookalike paths that only share a substring', () => {
    const files = ['src/catalog/prompt-content-source.ts', 'docs/prompts-guide.md', 'packages/prompts/src/index.ts'];
    expect(findProtectedTarballPaths(files)).toEqual([]);
  });
});

describe('findDisallowedTarballEntries', () => {
  it('flags node_modules trees in the package file list', () => {
    expect(findDisallowedTarballEntries(['node_modules/pino/index.js', 'bin/x.js'])).toEqual([
      'node_modules/pino/index.js',
    ]);
    expect(findDisallowedTarballEntries(['bin/x.js'])).toEqual([]);
  });
});

describe('missingRequiredPackageFiles', () => {
  it('reports each required file that the packed tarball lacks', () => {
    const files = ['package.json', 'bin/prompt-studio.js', 'dist/index.html'];
    expect(missingRequiredPackageFiles(files)).toEqual([
      ...REQUIRED_PACKAGE_FILES.filter((required) => !files.includes(required)),
    ]);
    expect(missingRequiredPackageFiles([...REQUIRED_PACKAGE_FILES, 'package.json'])).toEqual([]);
  });
});

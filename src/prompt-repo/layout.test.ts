// @module-tag pure
import { describe, expect, it } from 'vitest';
import { isInsidePromptRepo, manifestFromPromptRepoFiles } from './layout';

describe('manifestFromPromptRepoFiles', () => {
  it('maps prompt files and skills into a catalog', () => {
    // Given: a prompt repository with two prompts, one skill, and files outside that layout
    // When: the studio reads the folder into a catalog
    const layout = manifestFromPromptRepoFiles('acme-prompts', [
      'prompts/scout.md',
      'prompts/closer.md',
      'skills/follow-up/SKILL.md',
      'README.md',
      'prompts/notes/nested.md',
    ]);
    // Then: only the prompt files and the skill are editable documents
    expect(layout.ok).toBe(true);
    if (!layout.ok) return;
    expect(layout.documents.map((document) => document.path)).toEqual([
      'prompts/closer.md',
      'prompts/scout.md',
      'skills/follow-up/SKILL.md',
    ]);
    expect(layout.manifest.catalog.source).toBe('explicit');
    if (layout.manifest.catalog.source !== 'explicit') return;
    expect(layout.manifest.catalog.documents.map((document) => document.id)).toEqual(['closer', 'scout', 'follow-up']);
    expect(layout.manifest.contentRoots).toEqual(['prompts', 'skills']);
    expect(layout.manifest.name).toBe('acme-prompts');
  });

  it('accepts an empty checkout so the first prompt can be added', () => {
    // Given: a repository with no prompt files yet
    // When: the studio reads it
    const layout = manifestFromPromptRepoFiles('empty', []);
    // Then: the catalog is empty and ready for the first prompt
    expect(layout.ok).toBe(true);
    if (!layout.ok) return;
    expect(layout.documents).toEqual([]);
    expect(layout.manifest.catalog).toEqual({ source: 'explicit', documents: [] });
  });

  it('refuses a path that escapes the prompt or skill folders', () => {
    // Given: a path that climbs out of the prompt folder
    // When: the studio reads the file list
    // Then: the catalog is refused instead of following the path
    expect(manifestFromPromptRepoFiles('acme', ['prompts/../../secrets.md']).ok).toBe(false);
    expect(manifestFromPromptRepoFiles('acme', ['prompts/../../secrets.md'])).toEqual({
      ok: false,
      reason: 'escape',
    });
    expect(isInsidePromptRepo('skills/../prompts/scout.md')).toBe(false);
    expect(isInsidePromptRepo('/etc/passwd')).toBe(false);
  });

  it('refuses two documents that would share one id', () => {
    // Given: a prompt and a skill that would both be named scout
    // When: the studio reads the file list
    const layout = manifestFromPromptRepoFiles('acme', ['prompts/scout.md', 'skills/scout/SKILL.md']);
    // Then: it refuses the clash instead of hiding one of them
    expect(layout).toEqual({ ok: false, reason: 'duplicate' });
  });
});

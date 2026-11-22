// @module-tag pure
import { describe, expect, it } from 'vitest';
import { resolveProjectReference } from './references-resolver';

describe('project reference lookup', () => {
  const paths = ['docs/rules.md', 'skills/task/docs/rules.md', 'shared/a.txt', 'skills/task/notes.txt'];
  it('resolves relative and Windows paths without changing the source', () => {
    expect(resolveProjectReference('../../shared/a.txt', 'skills/task/SKILL.md', paths)).toEqual({
      state: 'Found',
      path: 'shared/a.txt',
    });
    expect(resolveProjectReference('.\\notes.txt', 'skills/task/SKILL.md', paths)).toEqual({
      state: 'Found',
      path: 'skills/task/notes.txt',
    });
    expect(resolveProjectReference('docs/rules.md', 'skills/task/SKILL.md', paths)).toEqual({
      state: 'Ambiguous',
      candidates: ['docs/rules.md', 'skills/task/docs/rules.md'],
    });
  });
  it('reports missing and outside-project paths without guessing host mappings', () => {
    expect(resolveProjectReference('missing.md', 'prompts/a.md', paths).state).toBe('Missing');
    for (const file of ['C:\\Users\\a.txt', '\\\\host\\a.txt', '/etc/passwd', '../../../secret', '.git/config'])
      expect(resolveProjectReference(file, 'prompts/a.md', paths).state).toBe('Outside project');
  });
});
